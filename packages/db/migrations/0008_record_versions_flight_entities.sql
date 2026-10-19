-- =============================================================
-- Soraban / Sprint 11: 版の履歴に日常点検記録・飛行記録を加える
-- =============================================================
-- - record_versions.entity_type に daily_inspection・flight_record を加える（検査制約の差し替え。値を増やすだけ）。
-- - 追加前のトリガー：飛行記録・日常点検の版の data に、DB が求める値（flight_minutes・flight_date、
--   inspected_date・has_abnormal）を入れる（アプリが送った値は上書きする）。content_hash はこの値を含めて計算する。
--   飛行記録の版の追加は組織単位で直列化する（重なりの検査のため）。
-- - 追加後のトリガー：data から daily_inspections・flight_records の行を作る・更新する。
--   同じ機体、または同じ操縦者で、取消していない飛行記録どうしの時間帯〔離陸, 離陸＋飛行時間）が重なれば
--   SQLSTATE SB409（detail overlap）で版の追加ごと失敗する。
-- - verify_record_chain：daily_inspection・flight_record の表の対応と、時刻（日本時間の `YYYY-MM-DDTHH:MM`）の比較を加える。
-- - content_hash の計算規則（soraban-record-v1）は変えない。要素 3（entity_type）の値が増えるだけ。
-- 関数は 0006 の定義を置き換える（member・aircraft・pilot の扱いは 0006 と同じ）。
-- =============================================================

alter table record_versions drop constraint record_versions_entity_type_check;
alter table record_versions add constraint record_versions_entity_type_check
  check (entity_type in ('member', 'aircraft', 'pilot', 'daily_inspection', 'flight_record'));

-- ---- 追加前のトリガー ---------------------------------------

create or replace function record_versions_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_prev_no integer;
  v_prev_hash text;
  v_prev_org uuid;
  v_prev_op text;
  v_expected text;
  v_takeoff timestamptz;
  v_landing timestamptz;
  v_at timestamptz;
  v_abnormal boolean;
begin
  perform pg_advisory_xact_lock(hashtextextended('record_versions:' || new.entity_type || ':' || new.entity_id::text, 0));
  if new.entity_type = 'member' then
    -- 最後の運航管理者の判定を組織単位で直列化する
    perform pg_advisory_xact_lock(hashtextextended('members_org:' || new.org_id::text, 0));
  elsif new.entity_type = 'flight_record' then
    -- 飛行記録の重なりの検査（追加後のトリガー）を組織単位で直列化する
    perform pg_advisory_xact_lock(hashtextextended('flight_records_org:' || new.org_id::text, 0));
  end if;

  select version_no, content_hash, org_id, op
    into v_prev_no, v_prev_hash, v_prev_org, v_prev_op
    from record_versions
   where entity_type = new.entity_type and entity_id = new.entity_id
   order by version_no desc
   limit 1;

  if v_prev_no is null then
    if new.op <> 'create' then
      raise exception 'record not found' using errcode = 'SB404';
    end if;
    new.version_no := 1;
    new.prev_hash := '';
  else
    if new.op = 'create' then
      raise exception 'record already exists' using errcode = 'SB409', detail = 'already_exists';
    end if;
    if v_prev_org <> new.org_id then
      raise exception 'record not found' using errcode = 'SB404';
    end if;
    if v_prev_op = 'void' then
      raise exception 'record is voided' using errcode = 'SB409', detail = 'voided';
    end if;
    v_expected := nullif(current_setting('soraban.expected_version', true), '');
    if v_expected is not null and v_expected::integer <> v_prev_no then
      raise exception 'version conflict' using errcode = 'SB409', detail = 'version_conflict';
    end if;
    new.version_no := v_prev_no + 1;
    new.prev_hash := v_prev_hash;
  end if;

  -- DB が求める値を data に入れる（アプリが送った値は使わない）
  if new.entity_type = 'flight_record' then
    v_takeoff := ops_jst_minute_to_timestamptz(new.data->>'takeoff_at');
    v_landing := ops_jst_minute_to_timestamptz(new.data->>'landing_at');
    new.data := new.data || jsonb_build_object(
      'flight_minutes', ops_flight_minutes(v_takeoff, v_landing),
      'flight_date', to_char(ops_jst_date(v_takeoff), 'YYYY-MM-DD')
    );
  elsif new.entity_type = 'daily_inspection' then
    v_at := ops_jst_minute_to_timestamptz(new.data->>'inspected_at');
    select coalesce(bool_or(value->>'result' = 'abnormal'), false)
      into v_abnormal
      from jsonb_each(case when jsonb_typeof(new.data->'items') = 'object' then new.data->'items' else '{}'::jsonb end);
    new.data := new.data || jsonb_build_object(
      'inspected_date', to_char(ops_jst_date(v_at), 'YYYY-MM-DD'),
      'has_abnormal', v_abnormal
    );
  end if;

  new.created_at := clock_timestamp();
  new.content_hash := record_version_hash(
    new.prev_hash, new.entity_type, new.entity_id, new.version_no, new.op, new.data,
    new.reason, new.actor_kind, new.actor_member_id, new.created_at
  );
  return new;
end;
$$;

-- ---- 追加後のトリガー（ヘッド表の作成・更新） ---------------

create or replace function record_versions_after_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  d jsonb := new.data;
  v_was_manager boolean;
  v_head_aircraft uuid;
  v_conflict uuid;
  r record;
begin
  if new.entity_type = 'member' then
    select (role = 'manager' and status = 'active' and voided_at is null)
      into v_was_manager
      from members where id = new.entity_id;

    if new.op = 'create' then
      insert into members (id, org_id, email, display_name, role, status, auth_provider, auth_user_id,
                           current_version, created_at, updated_at)
      values (new.entity_id, new.org_id, d->>'email', d->>'display_name', d->>'role', d->>'status',
              d->>'auth_provider', d->>'auth_user_id', new.version_no, new.created_at, new.created_at);
    elsif new.op = 'update' then
      update members
         set email = d->>'email', display_name = d->>'display_name', role = d->>'role', status = d->>'status',
             auth_provider = d->>'auth_provider', auth_user_id = d->>'auth_user_id',
             current_version = new.version_no, updated_at = new.created_at
       where id = new.entity_id;
    else
      update members set voided_at = new.created_at, current_version = new.version_no, updated_at = new.created_at
       where id = new.entity_id;
    end if;

    if coalesce(v_was_manager, false) and not exists (
      select 1 from members
       where org_id = new.org_id and role = 'manager' and status = 'active' and voided_at is null
    ) then
      raise exception 'last active manager' using errcode = 'SB409', detail = 'last_manager';
    end if;

  elsif new.entity_type = 'aircraft' then
    if new.op = 'create' then
      insert into aircraft (id, org_id, registration_mark, model_name, manufacturer, serial_number,
                            type_certified, type_cert_category, type_cert_model, type_cert_number,
                            airworthiness_class, airworthiness_cert_number, max_takeoff_weight_kg,
                            initial_flight_minutes, status, current_version, created_at, updated_at)
      values (new.entity_id, new.org_id, d->>'registration_mark', d->>'model_name', d->>'manufacturer',
              d->>'serial_number', (d->>'type_certified')::boolean, d->>'type_cert_category',
              d->>'type_cert_model', d->>'type_cert_number', d->>'airworthiness_class',
              d->>'airworthiness_cert_number', (d->>'max_takeoff_weight_kg')::numeric,
              (d->>'initial_flight_minutes')::integer, d->>'status', new.version_no, new.created_at, new.created_at);
    elsif new.op = 'update' then
      update aircraft
         set registration_mark = d->>'registration_mark', model_name = d->>'model_name',
             manufacturer = d->>'manufacturer', serial_number = d->>'serial_number',
             type_certified = (d->>'type_certified')::boolean, type_cert_category = d->>'type_cert_category',
             type_cert_model = d->>'type_cert_model', type_cert_number = d->>'type_cert_number',
             airworthiness_class = d->>'airworthiness_class', airworthiness_cert_number = d->>'airworthiness_cert_number',
             max_takeoff_weight_kg = (d->>'max_takeoff_weight_kg')::numeric,
             initial_flight_minutes = (d->>'initial_flight_minutes')::integer, status = d->>'status',
             current_version = new.version_no, updated_at = new.created_at
       where id = new.entity_id;
    else
      update aircraft set voided_at = new.created_at, current_version = new.version_no, updated_at = new.created_at
       where id = new.entity_id;
    end if;

  elsif new.entity_type = 'pilot' then
    if new.op = 'create' then
      insert into pilots (id, org_id, full_name, has_license, license_class, license_number, license_expires_on,
                          limitation_type, limitation_weight, limitation_daytime, limitation_vlos, member_id,
                          current_version, created_at, updated_at)
      values (new.entity_id, new.org_id, d->>'full_name', (d->>'has_license')::boolean, d->>'license_class',
              d->>'license_number', (d->>'license_expires_on')::date,
              coalesce((d->>'limitation_type')::boolean, false), coalesce((d->>'limitation_weight')::boolean, false),
              coalesce((d->>'limitation_daytime')::boolean, false), coalesce((d->>'limitation_vlos')::boolean, false),
              (d->>'member_id')::uuid, new.version_no, new.created_at, new.created_at);
    elsif new.op = 'update' then
      update pilots
         set full_name = d->>'full_name', has_license = (d->>'has_license')::boolean,
             license_class = d->>'license_class', license_number = d->>'license_number',
             license_expires_on = (d->>'license_expires_on')::date,
             limitation_type = coalesce((d->>'limitation_type')::boolean, false),
             limitation_weight = coalesce((d->>'limitation_weight')::boolean, false),
             limitation_daytime = coalesce((d->>'limitation_daytime')::boolean, false),
             limitation_vlos = coalesce((d->>'limitation_vlos')::boolean, false),
             member_id = (d->>'member_id')::uuid,
             current_version = new.version_no, updated_at = new.created_at
       where id = new.entity_id;
    else
      update pilots set voided_at = new.created_at, current_version = new.version_no, updated_at = new.created_at
       where id = new.entity_id;
    end if;
    -- 操縦者に結び付ける利用者は同じ組織の利用者に限る
    if (d->>'member_id') is not null and not exists (
      select 1 from members where id = (d->>'member_id')::uuid and org_id = new.org_id
    ) then
      raise exception 'member not found' using errcode = 'SB404';
    end if;

  elsif new.entity_type = 'daily_inspection' then
    if new.op in ('create', 'update') then
      -- 機体・実施者は同じ組織のものに限る。機体は訂正で変えられない
      if not exists (select 1 from aircraft where id = (d->>'aircraft_id')::uuid and org_id = new.org_id)
         or not exists (select 1 from pilots where id = (d->>'pilot_id')::uuid and org_id = new.org_id) then
        raise exception 'aircraft or pilot not found' using errcode = 'SB404';
      end if;
    end if;
    if new.op = 'create' then
      insert into daily_inspections (id, org_id, aircraft_id, pilot_id, inspected_at, inspected_date, timing, place_name,
                                     latitude, longitude, accuracy_m, items, has_abnormal, special_notes,
                                     inspector_name, inspector_version, client_request_id,
                                     current_version, created_at, updated_at)
      values (new.entity_id, new.org_id, (d->>'aircraft_id')::uuid, (d->>'pilot_id')::uuid,
              ops_jst_minute_to_timestamptz(d->>'inspected_at'), (d->>'inspected_date')::date, d->>'timing',
              d->>'place_name', (d->>'latitude')::numeric, (d->>'longitude')::numeric, (d->>'accuracy_m')::integer,
              d->'items', (d->>'has_abnormal')::boolean, d->>'special_notes',
              d->>'inspector_name', (d->>'inspector_version')::integer, (d->>'client_request_id')::uuid,
              new.version_no, new.created_at, new.created_at);
    elsif new.op = 'update' then
      select aircraft_id into v_head_aircraft from daily_inspections where id = new.entity_id;
      if v_head_aircraft is distinct from (d->>'aircraft_id')::uuid then
        raise exception 'aircraft is immutable' using errcode = '23514', detail = 'aircraft_immutable';
      end if;
      update daily_inspections
         set pilot_id = (d->>'pilot_id')::uuid, inspected_at = ops_jst_minute_to_timestamptz(d->>'inspected_at'),
             inspected_date = (d->>'inspected_date')::date, timing = d->>'timing', place_name = d->>'place_name',
             latitude = (d->>'latitude')::numeric, longitude = (d->>'longitude')::numeric,
             accuracy_m = (d->>'accuracy_m')::integer, items = d->'items', has_abnormal = (d->>'has_abnormal')::boolean,
             special_notes = d->>'special_notes', inspector_name = d->>'inspector_name',
             inspector_version = (d->>'inspector_version')::integer, client_request_id = (d->>'client_request_id')::uuid,
             current_version = new.version_no, updated_at = new.created_at
       where id = new.entity_id;
    else
      update daily_inspections set voided_at = new.created_at, current_version = new.version_no, updated_at = new.created_at
       where id = new.entity_id;
    end if;

  elsif new.entity_type = 'flight_record' then
    if new.op in ('create', 'update') then
      if not exists (select 1 from aircraft where id = (d->>'aircraft_id')::uuid and org_id = new.org_id)
         or not exists (select 1 from pilots where id = (d->>'pilot_id')::uuid and org_id = new.org_id) then
        raise exception 'aircraft or pilot not found' using errcode = 'SB404';
      end if;
      -- 日常点検の紐付けは同じ組織・同じ機体の点検に限る
      if (d->>'daily_inspection_id') is not null and not exists (
        select 1 from daily_inspections
         where id = (d->>'daily_inspection_id')::uuid and org_id = new.org_id and aircraft_id = (d->>'aircraft_id')::uuid
      ) then
        raise exception 'inspection of another aircraft' using errcode = '23514', detail = 'inspection_mismatch';
      end if;
    end if;
    if new.op = 'create' then
      insert into flight_records (id, org_id, aircraft_id, pilot_id, daily_inspection_id, flight_plan_id, snapshot_id,
                                  purpose, waypoints, specific_flight_types,
                                  takeoff_place, takeoff_lat, takeoff_lng, takeoff_accuracy_m,
                                  landing_place, landing_lat, landing_lng, landing_accuracy_m,
                                  takeoff_at, landing_at, flight_minutes, flight_date,
                                  safety_issue, safety_issue_detail, defects,
                                  pilot_name, pilot_license_number, pilot_version, client_request_id,
                                  current_version, created_at, updated_at)
      values (new.entity_id, new.org_id, (d->>'aircraft_id')::uuid, (d->>'pilot_id')::uuid,
              (d->>'daily_inspection_id')::uuid, (d->>'flight_plan_id')::uuid, (d->>'snapshot_id')::uuid,
              d->>'purpose', d->>'waypoints', coalesce(d->'specific_flight_types', '[]'::jsonb),
              d->>'takeoff_place', (d->>'takeoff_lat')::numeric, (d->>'takeoff_lng')::numeric, (d->>'takeoff_accuracy_m')::integer,
              d->>'landing_place', (d->>'landing_lat')::numeric, (d->>'landing_lng')::numeric, (d->>'landing_accuracy_m')::integer,
              ops_jst_minute_to_timestamptz(d->>'takeoff_at'), ops_jst_minute_to_timestamptz(d->>'landing_at'),
              (d->>'flight_minutes')::integer, (d->>'flight_date')::date,
              (d->>'safety_issue')::boolean, d->>'safety_issue_detail', coalesce(d->'defects', '[]'::jsonb),
              d->>'pilot_name', d->>'pilot_license_number', (d->>'pilot_version')::integer, (d->>'client_request_id')::uuid,
              new.version_no, new.created_at, new.created_at);
    elsif new.op = 'update' then
      select aircraft_id into v_head_aircraft from flight_records where id = new.entity_id;
      if v_head_aircraft is distinct from (d->>'aircraft_id')::uuid then
        raise exception 'aircraft is immutable' using errcode = '23514', detail = 'aircraft_immutable';
      end if;
      update flight_records
         set pilot_id = (d->>'pilot_id')::uuid, daily_inspection_id = (d->>'daily_inspection_id')::uuid,
             flight_plan_id = (d->>'flight_plan_id')::uuid, snapshot_id = (d->>'snapshot_id')::uuid,
             purpose = d->>'purpose', waypoints = d->>'waypoints',
             specific_flight_types = coalesce(d->'specific_flight_types', '[]'::jsonb),
             takeoff_place = d->>'takeoff_place', takeoff_lat = (d->>'takeoff_lat')::numeric,
             takeoff_lng = (d->>'takeoff_lng')::numeric, takeoff_accuracy_m = (d->>'takeoff_accuracy_m')::integer,
             landing_place = d->>'landing_place', landing_lat = (d->>'landing_lat')::numeric,
             landing_lng = (d->>'landing_lng')::numeric, landing_accuracy_m = (d->>'landing_accuracy_m')::integer,
             takeoff_at = ops_jst_minute_to_timestamptz(d->>'takeoff_at'),
             landing_at = ops_jst_minute_to_timestamptz(d->>'landing_at'),
             flight_minutes = (d->>'flight_minutes')::integer, flight_date = (d->>'flight_date')::date,
             safety_issue = (d->>'safety_issue')::boolean, safety_issue_detail = d->>'safety_issue_detail',
             defects = coalesce(d->'defects', '[]'::jsonb),
             pilot_name = d->>'pilot_name', pilot_license_number = d->>'pilot_license_number',
             pilot_version = (d->>'pilot_version')::integer, client_request_id = (d->>'client_request_id')::uuid,
             current_version = new.version_no, updated_at = new.created_at
       where id = new.entity_id;
    else
      update flight_records set voided_at = new.created_at, current_version = new.version_no, updated_at = new.created_at
       where id = new.entity_id;
    end if;

    -- 重なりの拒否：同じ機体、または同じ操縦者で、取消していない飛行記録どうしの〔離陸, 離陸＋飛行時間）が重なる。
    -- 接するだけ（前の着陸の分 = 次の離陸の分）は重ならない。取消した記録とは比べない。
    if new.op in ('create', 'update') then
      select f.takeoff_at, f.flight_minutes, f.aircraft_id, f.pilot_id into r from flight_records f where f.id = new.entity_id;
      select o.id into v_conflict
        from flight_records o
       where o.org_id = new.org_id
         and o.id <> new.entity_id
         and o.voided_at is null
         and (o.aircraft_id = r.aircraft_id or o.pilot_id = r.pilot_id)
         and o.takeoff_at < r.takeoff_at + make_interval(mins => r.flight_minutes)
         and r.takeoff_at < o.takeoff_at + make_interval(mins => o.flight_minutes)
       limit 1;
      if v_conflict is not null then
        raise exception 'flight records overlap' using errcode = 'SB409', detail = 'overlap';
      end if;
    end if;
  end if;
  return null;
end;
$$;

-- ---- 検証 ----------------------------------------------------

-- 0006 の verify_record_chain に、daily_inspection・flight_record の表の対応を加える。
-- 時刻の列（inspected_at・takeoff_at・landing_at）は、版の data と同じ日本時間の `YYYY-MM-DDTHH:MM` にして比べる。
create or replace function verify_record_chain(p_entity_type text, p_entity_id uuid)
returns table (version_no integer, problem text)
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  r record;
  v_expected_no integer := 1;
  v_prev_hash text := '';
  v_last record;
  v_head jsonb;
  v_table text;
  v_key text;
  v_found boolean := false;
begin
  for r in
    select * from record_versions v
     where v.entity_type = p_entity_type and v.entity_id = p_entity_id
     order by v.version_no
  loop
    if r.version_no <> v_expected_no then
      version_no := r.version_no; problem := 'missing_version'; return next;
    end if;
    if r.prev_hash <> v_prev_hash then
      version_no := r.version_no; problem := 'prev_hash_mismatch'; return next;
    end if;
    if r.content_hash <> record_version_hash(r.prev_hash, r.entity_type, r.entity_id, r.version_no, r.op, r.data,
                                             r.reason, r.actor_kind, r.actor_member_id, r.created_at) then
      version_no := r.version_no; problem := 'content_hash_mismatch'; return next;
    end if;
    v_expected_no := r.version_no + 1;
    v_prev_hash := r.content_hash;
    v_last := r;
    v_found := true;
  end loop;

  v_table := case p_entity_type
               when 'member' then 'members'
               when 'aircraft' then 'aircraft'
               when 'pilot' then 'pilots'
               when 'daily_inspection' then 'daily_inspections'
               when 'flight_record' then 'flight_records'
             end;
  if v_table is null then
    return;
  end if;
  if p_entity_type = 'flight_record' then
    select to_jsonb(t) || jsonb_build_object('takeoff_at', ops_timestamptz_to_jst_minute(t.takeoff_at),
                                             'landing_at', ops_timestamptz_to_jst_minute(t.landing_at))
      into v_head from flight_records t where t.id = p_entity_id;
  elsif p_entity_type = 'daily_inspection' then
    select to_jsonb(t) || jsonb_build_object('inspected_at', ops_timestamptz_to_jst_minute(t.inspected_at))
      into v_head from daily_inspections t where t.id = p_entity_id;
  else
    execute format('select to_jsonb(t) from %I t where t.id = $1', v_table) into v_head using p_entity_id;
  end if;

  if not v_found then
    if v_head is not null then
      version_no := 0; problem := 'head_without_versions'; return next;
    end if;
    return;
  end if;
  if v_head is null then
    version_no := v_last.version_no; problem := 'head_missing'; return next;
    return;
  end if;
  if (v_head->>'current_version')::integer is distinct from v_last.version_no then
    version_no := v_last.version_no; problem := 'head_version_mismatch'; return next;
  end if;
  for v_key in select jsonb_object_keys(v_last.data) loop
    if v_head ? v_key and (v_head->v_key) is distinct from (v_last.data->v_key) then
      version_no := v_last.version_no; problem := 'head_data_mismatch'; return next;
      exit;
    end if;
  end loop;
  if (v_last.op = 'void') is distinct from (v_head->>'voided_at' is not null) then
    version_no := v_last.version_no; problem := 'head_void_mismatch'; return next;
  end if;
end;
$$;

revoke execute on function verify_record_chain(text, uuid) from public;
