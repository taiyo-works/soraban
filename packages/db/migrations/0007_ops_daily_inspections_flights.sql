-- =============================================================
-- Soraban / Sprint 11: 日常点検記録と飛行記録（ヘッド表）・総飛行時間のビュー
-- =============================================================
-- 項目は「無人航空機の飛行日誌の取扱要領」（令和4年12月1日制定）の様式1（飛行記録）・様式2（日常点検記録）に合わせる
-- （docs/sprints/sprint-11.md）。どちらも record_versions（0006・0008）への追加から DB が作る。物理削除はしない。
--
-- - 時刻は timestamptz で保存する。版の data では日本時間の `YYYY-MM-DDTHH:MM`（1 分単位）で持ち、
--   ops_jst_minute_to_timestamptz で変換する（DB の TimeZone の設定に依らない）。
-- - 飛行時間（flight_minutes）と飛行年月日（flight_date）は、離陸・着陸の時刻から DB が求める（ops_flight_minutes。
--   アプリの apps/web/src/lib/ops-time.ts と同じ規則：着陸−離陸の分、同じ分なら 1）。アプリが送った値は使わない（0008）。
-- - 総飛行時間は保存しない。読み出しのたびに flight_record_totals 等のビューで求める（訂正・取消で自動的に正しくなる）。
-- =============================================================

-- ---- 時刻の関数 ----------------------------------------------

-- 日本時間の `YYYY-MM-DDTHH:MM` を timestamptz にする。形が違う・存在しない日時は SQLSTATE 22007 で失敗する。
create or replace function ops_jst_minute_to_timestamptz(p text)
returns timestamptz
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v timestamptz;
begin
  if p is null then
    return null;
  end if;
  if p !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$' then
    raise exception 'invalid jst minute' using errcode = '22007';
  end if;
  -- 明示的なオフセット（+09:00）付きで解釈するため、セッションの TimeZone に依らない
  v := (p || ':00+09:00')::timestamptz;
  if ops_timestamptz_to_jst_minute(v) <> p then
    -- 2 月 30 日など（PostgreSQL は拒否するが、念のため往復で確かめる）
    raise exception 'invalid jst minute' using errcode = '22007';
  end if;
  return v;
end;
$$;

-- timestamptz を日本時間の `YYYY-MM-DDTHH:MM` にする（版の data・検証で使う）。
create or replace function ops_timestamptz_to_jst_minute(p timestamptz)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select to_char((p at time zone 'UTC') + interval '9 hours', 'YYYY-MM-DD"T"HH24:MI')
$$;

-- timestamptz の日本時間の日付。
create or replace function ops_jst_date(p timestamptz)
returns date
language sql
immutable
set search_path = public, pg_temp
as $$
  select ((p at time zone 'UTC') + interval '9 hours')::date
$$;

-- 飛行時間（分）。着陸−離陸の分。同じ分なら 1（GL p.10〜11 の切り上げ）。着陸が前なら負の値を返す（表の検査制約で拒否する）。
create or replace function ops_flight_minutes(p_takeoff timestamptz, p_landing timestamptz)
returns integer
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
           when d = 0 then 1
           else d
         end
    from (select (floor(extract(epoch from (p_landing - p_takeoff)) / 60))::integer as d) s
$$;

-- ---- 日常点検記録（様式2） ----------------------------------

create table daily_inspections (
  id uuid primary key,
  org_id uuid not null references organizations(id),
  aircraft_id uuid not null references aircraft(id),
  -- 実施者（操縦者の行）。氏名は作成・訂正の時点の写しを inspector_name に持つ
  pilot_id uuid not null references pilots(id),
  inspected_at timestamptz not null check (inspected_at = date_trunc('minute', inspected_at)),
  inspected_date date not null,
  timing text not null check (timing in ('pre_flight', 'post_flight')),
  place_name text not null check (length(btrim(place_name)) between 1 and 100),
  latitude numeric(9, 6) check (latitude is null or latitude between -90 and 90),
  longitude numeric(9, 6) check (longitude is null or longitude between -180 and 180),
  accuracy_m integer check (accuracy_m is null or accuracy_m between 0 and 100000),
  -- 9 項目の結果（{"general": {"result": "normal", "note": null}, ...}）。項目の一覧はアプリの INSPECTION_ITEMS
  items jsonb not null check (jsonb_typeof(items) = 'object'),
  has_abnormal boolean not null,
  special_notes text check (special_notes is null or length(special_notes) <= 500),
  inspector_name text not null check (length(btrim(inspector_name)) between 1 and 100),
  inspector_version integer not null,
  client_request_id uuid,
  current_version integer not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  voided_at timestamptz,
  check ((latitude is null) = (longitude is null)),
  check (accuracy_m is null or latitude is not null)
);

create index idx_daily_inspections_org_aircraft on daily_inspections (org_id, aircraft_id, inspected_at desc);
create unique index uq_daily_inspections_request on daily_inspections (org_id, client_request_id)
  where client_request_id is not null;

comment on table daily_inspections is
  '日常点検記録（Sprint 11、様式2）。record_versions（entity_type = daily_inspection）から DB が作るヘッド表。';
comment on column daily_inspections.inspector_name is '作成・訂正の時点の実施者の氏名の写し（サーバーが操縦者の行から写す）。';
comment on column daily_inspections.client_request_id is '画面の下書きごとの識別子（二重送信の防止）。';

-- ---- 飛行記録（様式1） --------------------------------------

create table flight_records (
  id uuid primary key,
  org_id uuid not null references organizations(id),
  aircraft_id uuid not null references aircraft(id),
  pilot_id uuid not null references pilots(id),
  daily_inspection_id uuid references daily_inspections(id),
  -- 紐付け用（Sprint 12 で使う。本スプリントは NULL のまま）
  flight_plan_id uuid,
  snapshot_id uuid,
  purpose text not null check (length(btrim(purpose)) between 1 and 100),
  waypoints text check (waypoints is null or length(waypoints) <= 200),
  specific_flight_types jsonb not null default '[]'::jsonb check (jsonb_typeof(specific_flight_types) = 'array'),
  takeoff_place text not null check (length(btrim(takeoff_place)) between 1 and 100),
  takeoff_lat numeric(9, 6) check (takeoff_lat is null or takeoff_lat between -90 and 90),
  takeoff_lng numeric(9, 6) check (takeoff_lng is null or takeoff_lng between -180 and 180),
  takeoff_accuracy_m integer check (takeoff_accuracy_m is null or takeoff_accuracy_m between 0 and 100000),
  landing_place text not null check (length(btrim(landing_place)) between 1 and 100),
  landing_lat numeric(9, 6) check (landing_lat is null or landing_lat between -90 and 90),
  landing_lng numeric(9, 6) check (landing_lng is null or landing_lng between -180 and 180),
  landing_accuracy_m integer check (landing_accuracy_m is null or landing_accuracy_m between 0 and 100000),
  takeoff_at timestamptz not null check (takeoff_at = date_trunc('minute', takeoff_at)),
  landing_at timestamptz not null check (landing_at = date_trunc('minute', landing_at)),
  -- DB が離陸・着陸の時刻から求める（ops_flight_minutes・ops_jst_date）
  flight_minutes integer not null check (flight_minutes between 1 and 1439),
  flight_date date not null,
  safety_issue boolean not null,
  safety_issue_detail text check (safety_issue_detail is null or length(safety_issue_detail) <= 500),
  -- 不具合（記事）。[{occurred_on, description, action_on, action, confirmer_name}]
  defects jsonb not null default '[]'::jsonb check (jsonb_typeof(defects) = 'array'),
  -- 作成・訂正の時点の操縦者の氏名・技能証明書番号の写し（サーバーが操縦者の行から写す）
  pilot_name text not null check (length(btrim(pilot_name)) between 1 and 100),
  pilot_license_number text,
  pilot_version integer not null,
  client_request_id uuid,
  current_version integer not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  voided_at timestamptz,
  check (landing_at >= takeoff_at),
  check ((not safety_issue and safety_issue_detail is null) or (safety_issue and length(btrim(safety_issue_detail)) > 0)),
  check ((takeoff_lat is null) = (takeoff_lng is null)),
  check ((landing_lat is null) = (landing_lng is null)),
  check (takeoff_accuracy_m is null or takeoff_lat is not null),
  check (landing_accuracy_m is null or landing_lat is not null)
);

create index idx_flight_records_org_aircraft on flight_records (org_id, aircraft_id, takeoff_at);
create index idx_flight_records_org_pilot on flight_records (org_id, pilot_id, takeoff_at);
create unique index uq_flight_records_request on flight_records (org_id, client_request_id)
  where client_request_id is not null;

comment on table flight_records is
  '飛行記録（Sprint 11、様式1）。record_versions（entity_type = flight_record）から DB が作るヘッド表。総飛行時間は保存しない（flight_record_totals）。';
comment on column flight_records.flight_minutes is '飛行時間（分）。DB が離陸・着陸の時刻から求める。1 分未満は 1。';
comment on column flight_records.flight_date is '飛行年月日（離陸の日本時間の日付）。DB が求める。';
comment on column flight_records.pilot_license_number is '技能証明書番号の写し。一覧では末尾 4 桁以外を伏せ、全桁は運航管理者と本人にだけ返す（アプリ層）。';

-- ---- 総飛行時間（保存せず、読み出しのたびに求める） ---------

-- 飛行記録ごとの機体の総飛行時間 ＝ 機体の使用開始時の既存の総飛行時間 ＋ 同じ機体の取消していない飛行記録のうち、
-- 離陸時刻がその記録以前のものの飛行時間の合計（その記録を含む）。取消済みの記録は行に出ない（総飛行時間なし）。
create view flight_record_totals as
select f.id,
       f.org_id,
       f.aircraft_id,
       f.pilot_id,
       a.initial_flight_minutes
         + sum(f.flight_minutes) over (
             partition by f.org_id, f.aircraft_id
             order by f.takeoff_at, f.id
             rows between unbounded preceding and current row
           ) as total_flight_minutes
  from flight_records f
  join aircraft a on a.id = f.aircraft_id
 where f.voided_at is null;

-- 機体の現在の総飛行時間（既存の総飛行時間 ＋ 取消していない全飛行記録の飛行時間の合計）。
create view aircraft_flight_totals as
select a.id as aircraft_id,
       a.org_id,
       a.initial_flight_minutes + coalesce(sum(f.flight_minutes), 0)::integer as total_flight_minutes,
       count(f.id)::integer as flight_count
  from aircraft a
  left join flight_records f on f.aircraft_id = a.id and f.voided_at is null
 group by a.id, a.org_id, a.initial_flight_minutes;

-- 操縦者ごとの、そらばんで記録した飛行の累計（全機体。初期値は持たない）。
create view pilot_flight_totals as
select p.id as pilot_id,
       p.org_id,
       coalesce(sum(f.flight_minutes), 0)::integer as total_flight_minutes,
       count(f.id)::integer as flight_count
  from pilots p
  left join flight_records f on f.pilot_id = p.id and f.voided_at is null
 group by p.id, p.org_id;

comment on view flight_record_totals is '飛行記録ごとの機体の総飛行時間（Sprint 11 設計 C）。保存せず、問い合わせのたびに求める。';
comment on view aircraft_flight_totals is '機体の現在の総飛行時間（Sprint 11 設計 C）。';
comment on view pilot_flight_totals is '操縦者ごとの、そらばんで記録した飛行の累計（Sprint 11 設計 C。初期値なし）。';

-- ---- アプリ用ロールの権限 -----------------------------------
-- ヘッド表とビューは参照だけ。追加・更新・削除・TRUNCATE は与えない（版の追加から DB が作る）。
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'soraban_app') then
    grant select on daily_inspections, flight_records to soraban_app;
    grant select on flight_record_totals, aircraft_flight_totals, pilot_flight_totals to soraban_app;
    revoke insert, update, delete, truncate on daily_inspections, flight_records from soraban_app;
    grant execute on function ops_jst_minute_to_timestamptz(text), ops_timestamptz_to_jst_minute(timestamptz),
      ops_jst_date(timestamptz), ops_flight_minutes(timestamptz, timestamptz) to soraban_app;
  end if;
end
$$;
