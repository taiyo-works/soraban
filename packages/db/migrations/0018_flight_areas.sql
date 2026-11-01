-- =============================================================
-- Soraban / Sprint 19-1b: 飛行計画の飛行範囲（flight_areas）
-- =============================================================
-- - flight_plans に flight_areas jsonb（null 可）を足す。範囲（多角形・円）の配列。座標は [経度, 緯度]（GeoJSON と同じ順）、
--   小数 6 桁。null は「範囲が未設定」（0017 までの計画・円や点だけの計画）。既存の行は書き換えない（追記専用。null のまま）。
-- - 版の data（record_versions）に flight_areas を持つ。content_hash の規則（soraban-record-v1）は変えない（data の中身が増えるだけ）。
-- - 0016 の大きな record_versions_before/after_insert は再定義しない。代わりに、追加後の小さなトリガー
--   record_versions_after_insert_flight_areas（名前の並びで record_versions_after_insert の後に動く）が、
--   flight_plans.flight_areas を版の data に合わせ、同じ版の latitude・longitude・radius_m が範囲を覆うことを検査する。
-- - 形の検査は専用の関数 flight_areas_valid(jsonb)（列の check）。覆うことの検査は flight_areas_covered(...)。
--   照合は verify_flight_areas(plan_id)（表の値と最新の版の data の一致）。verify_record_chain は変えない
--   （data に flight_areas の鍵があれば、既存の「表の列と版の data の一致」が比べる）。
-- - 上限（暫定・※要再確認）：1 計画の範囲 20 件、多角形の頂点 100（packages/geo の MAX_AREA_VERTICES と同じ）、円の半径 1〜10000 m。
-- =============================================================

-- ---- 形の検査 --------------------------------------------------

create or replace function flight_areas_position_valid(p jsonb)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select jsonb_typeof(p) = 'array'
     and jsonb_array_length(p) = 2
     and jsonb_typeof(p->0) = 'number'
     and jsonb_typeof(p->1) = 'number'
     and (p->>0)::numeric between -180 and 180
     and (p->>1)::numeric between -90 and 90
     and round((p->>0)::numeric, 6) = (p->>0)::numeric
     and round((p->>1)::numeric, 6) = (p->>1)::numeric
$$;

create or replace function flight_areas_valid(p_areas jsonb)
returns boolean
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  a jsonb;
  v jsonb;
  v_ids text[] := '{}';
  v_id text;
begin
  if p_areas is null then
    return true;
  end if;
  if jsonb_typeof(p_areas) <> 'array' or jsonb_array_length(p_areas) < 1 or jsonb_array_length(p_areas) > 20 then
    return false;
  end if;
  for a in select * from jsonb_array_elements(p_areas) loop
    if jsonb_typeof(a) <> 'object' then
      return false;
    end if;
    -- id（必須）：英数字・_・- の 1〜64 文字で、範囲の間で重複しない
    if jsonb_typeof(a->'id') is distinct from 'string' then
      return false;
    end if;
    v_id := a->>'id';
    if v_id !~ '^[A-Za-z0-9_-]{1,64}$' or v_id = any(v_ids) then
      return false;
    end if;
    v_ids := v_ids || v_id;
    -- name（任意）：文字で 50 文字以内、制御文字なし
    if a ? 'name' and (
      jsonb_typeof(a->'name') is distinct from 'string'
      or char_length(a->>'name') not between 1 and 50
      or (a->>'name') ~ '[[:cntrl:]]'
    ) then
      return false;
    end if;
    if a->>'kind' = 'polygon' then
      -- 鍵の欠落と余分な鍵を拒否する（null との比較で検査が素通りしないように、鍵は先に調べる）
      if exists (select 1 from jsonb_object_keys(a) k where k not in ('id', 'kind', 'name', 'vertices')) or not (a ? 'vertices') then
        return false;
      end if;
      if jsonb_typeof(a->'vertices') is distinct from 'array'
         or jsonb_array_length(a->'vertices') < 3 or jsonb_array_length(a->'vertices') > 100 then
        return false;
      end if;
      for v in select * from jsonb_array_elements(a->'vertices') loop
        if not coalesce(flight_areas_position_valid(v), false) then
          return false;
        end if;
      end loop;
    elsif a->>'kind' = 'circle' then
      if exists (select 1 from jsonb_object_keys(a) k where k not in ('id', 'kind', 'name', 'center', 'radius_m'))
         or not (a ? 'center') or not (a ? 'radius_m') then
        return false;
      end if;
      if not coalesce(flight_areas_position_valid(a->'center'), false) then
        return false;
      end if;
      if jsonb_typeof(a->'radius_m') is distinct from 'number'
         or (a->>'radius_m')::numeric <> trunc((a->>'radius_m')::numeric)
         or (a->>'radius_m')::numeric not between 1 and 10000 then
        return false;
      end if;
    else
      return false;
    end if;
  end loop;
  return true;
end;
$$;

-- ---- 距離と、代表点＋半径の円が範囲を覆うことの検査 --------------

-- packages/geo の haversineMeters と同じ球（半径 6371008.8 m）。
create or replace function flight_areas_distance_m(lat1 double precision, lng1 double precision,
                                                   lat2 double precision, lng2 double precision)
returns double precision
language sql
immutable
set search_path = public, pg_temp
as $$
  select 2 * 6371008.8 * asin(least(1, sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2)
    + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
  )))
$$;

-- 中心 (p_lat, p_lng)・半径 p_radius_m の円が、すべての範囲（多角形は全頂点、円は縁）を覆うか。0.01 m の許容。
create or replace function flight_areas_covered(p_lat numeric, p_lng numeric, p_radius_m integer, p_areas jsonb)
returns boolean
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  a jsonb;
  v jsonb;
begin
  if p_areas is null then
    return true;
  end if;
  if p_radius_m is null then
    return false;
  end if;
  for a in select * from jsonb_array_elements(p_areas) loop
    if a->>'kind' = 'polygon' then
      if jsonb_typeof(a->'vertices') is distinct from 'array' then
        return false;
      end if;
      for v in select * from jsonb_array_elements(a->'vertices') loop
        if coalesce(flight_areas_distance_m(p_lat::double precision, p_lng::double precision,
                                            (v->>1)::double precision, (v->>0)::double precision) > p_radius_m + 0.01, true) then
          return false;
        end if;
      end loop;
    elsif a->>'kind' is distinct from 'circle' then
      return false;
    else
      -- 鍵が欠けていて距離が null になる場合も「覆わない」（null の比較で素通りさせない）
      if coalesce(flight_areas_distance_m(p_lat::double precision, p_lng::double precision,
                                          (a->'center'->>1)::double precision, (a->'center'->>0)::double precision)
                  + (a->>'radius_m')::double precision > p_radius_m + 0.01, true) then
        return false;
      end if;
    end if;
  end loop;
  return true;
end;
$$;

-- ---- 列 --------------------------------------------------------

alter table flight_plans add column flight_areas jsonb check (flight_areas_valid(flight_areas));

comment on column flight_plans.flight_areas is
  '飛行範囲（Sprint 19-1b）。[{id, kind: polygon|circle, name?, vertices?: [[経度,緯度],…]（閉じない）, center?: [経度,緯度], radius_m?}]。null は範囲が未設定。latitude・longitude・radius_m は、この範囲を覆う円（サーバーが packages/geo の coveringCircle で求める）。版の data から追加後のトリガーが写す。';

-- ---- 追加後のトリガー（record_versions_after_insert の後に動く） ------

create or replace function record_versions_after_insert_flight_areas()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_areas jsonb := nullif(new.data->'flight_areas', 'null'::jsonb);
  v_lat numeric;
  v_lng numeric;
  v_radius integer;
begin
  select latitude, longitude, radius_m into v_lat, v_lng, v_radius from flight_plans where id = new.entity_id;
  if not flight_areas_valid(v_areas) then
    raise exception 'flight_areas is invalid' using errcode = '23514', detail = 'flight_areas_invalid';
  end if;
  if v_areas is not null and not flight_areas_covered(v_lat, v_lng, v_radius, v_areas) then
    raise exception 'flight_areas are not covered by latitude/longitude/radius_m' using errcode = '23514', detail = 'flight_areas_not_covered';
  end if;
  update flight_plans set flight_areas = v_areas where id = new.entity_id and flight_areas is distinct from v_areas;
  return null;
end;
$$;

revoke execute on function record_versions_after_insert_flight_areas() from public;

create trigger record_versions_after_insert_flight_areas
  after insert on record_versions
  for each row
  when (new.entity_type = 'flight_plan' and new.op in ('create', 'update'))
  execute function record_versions_after_insert_flight_areas();

-- ---- 照合 -------------------------------------------------------

-- 表の flight_areas が、最新の（create・update の）版の data の flight_areas と一致するか。問題があれば行を返す（無ければ 0 行）。
create or replace function verify_flight_areas(p_plan_id uuid)
returns table (problem text)
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_head flight_plans%rowtype;
  v_data jsonb;
begin
  select * into v_head from flight_plans where id = p_plan_id;
  select nullif(v.data->'flight_areas', 'null'::jsonb) into v_data
    from record_versions v
   where v.entity_type = 'flight_plan' and v.entity_id = p_plan_id and v.op in ('create', 'update')
   order by v.version_no desc
   limit 1;
  if not found then
    if v_head.id is not null then
      problem := 'head_without_versions'; return next;
    end if;
    return;
  end if;
  if v_head.id is null then
    problem := 'head_missing'; return next;
    return;
  end if;
  if v_head.flight_areas is distinct from v_data then
    problem := 'flight_areas_mismatch'; return next;
  end if;
  if not flight_areas_valid(v_head.flight_areas) then
    problem := 'flight_areas_invalid'; return next;
  end if;
  if not flight_areas_covered(v_head.latitude, v_head.longitude, v_head.radius_m, v_head.flight_areas) then
    problem := 'flight_areas_not_covered'; return next;
  end if;
end;
$$;

revoke execute on function verify_flight_areas(uuid) from public;
revoke execute on function flight_areas_position_valid(jsonb) from public;
revoke execute on function flight_areas_valid(jsonb) from public;
revoke execute on function flight_areas_distance_m(double precision, double precision, double precision, double precision) from public;
revoke execute on function flight_areas_covered(numeric, numeric, integer, jsonb) from public;

-- ---- アプリ用ロールの権限 ---------------------------------------
-- flight_plans は参照だけ（0010 のまま。列を足しても INSERT・UPDATE・DELETE・TRUNCATE は与えない）。
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'soraban_app') then
    grant select on flight_plans to soraban_app;
    revoke insert, update, delete, truncate on flight_plans from soraban_app;
  end if;
end
$$;
