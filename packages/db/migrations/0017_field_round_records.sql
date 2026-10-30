-- =============================================================
-- Soraban / Sprint 14: 現場の流れの再編（書類・手続きの確認、飛行自粛要請の確認、現場状況）
-- =============================================================
-- 現場の事実の記録 flight_field_events（0014。追記専用）に、次の 3 つの確認項目と、その構造化された列を足す。
--   docs_confirm      書類・手続きの「人が確認した」（doc_key で 6 項目のどれかを示す。計画ごとに持ち越す）
--   flight_restriction 飛行自粛要請の確認（ラウンドごと）
--   site_conditions   現場状況（第三者・他機・雨・視程の選択と、風速・気温の数値。ラウンドごとに毎回人が確認）
-- 新しい記録も同じ表・同じトリガーに入るため、追記専用（更新・削除・TRUNCATE は SB409 で拒否）・冪等性
-- （org_id, client_event_id）・取り消し（undo）・DB が決める列（snapshot_id・plan_version・recorded_by_*・recorded_at・content_hash）
-- は 0014 のものをそのまま引き継ぐ。
-- - 合否の閾値は決めない。風速・気温の範囲は入力の妥当性の検査（桁の誤り）であり、飛行の可否の基準ではない。
-- - 追記のみ。適用済みのマイグレーション（0001〜0016）は変えない。content_hash は新しい行から soraban-field-event-v2
--   （新しい列を含む）で計算する。既存の行の content_hash（v1）は書き換えない。
-- =============================================================

-- ---- 項目の追加 --------------------------------------------------

alter table flight_field_events drop constraint if exists flight_field_events_item_check;
alter table flight_field_events add constraint flight_field_events_item_check
  check (item is null or item in ('inspection', 'emergency_airspace', 'report_recheck', 'carry', 'docs_confirm', 'flight_restriction', 'site_conditions'));

alter table flight_field_events add column doc_key text check (doc_key is null or doc_key in ('permit', 'registration', 'remote_id', 'license', 'report', 'manual'));
alter table flight_field_events add column site_third_party text check (site_third_party is null or site_third_party in ('none', 'present'));
alter table flight_field_events add column site_other_aircraft text check (site_other_aircraft is null or site_other_aircraft in ('none', 'present'));
alter table flight_field_events add column site_rain text check (site_rain is null or site_rain in ('none', 'present'));
alter table flight_field_events add column site_visibility text check (site_visibility is null or site_visibility in ('good', 'limited'));
-- 風速・気温は任意（測れない現場がある）。入力の妥当性の範囲だけ（飛行の可否の基準ではない）
alter table flight_field_events add column site_wind_ms numeric(4, 1) check (site_wind_ms is null or (site_wind_ms >= 0 and site_wind_ms <= 60));
alter table flight_field_events add column site_temp_c numeric(4, 1) check (site_temp_c is null or (site_temp_c >= -50 and site_temp_c <= 60));

alter table flight_field_events add constraint flight_field_events_doc_cols check (
  (doc_key is not null) = (kind = 'check' and item = 'docs_confirm')
);

-- 現場状況：4 つの選択は site_conditions の行だけが持つ。数値は任意（site_conditions の行だけが持てる）
alter table flight_field_events add constraint flight_field_events_site_cols check (
  (
    kind = 'check' and item = 'site_conditions'
    and site_third_party is not null and site_other_aircraft is not null and site_rain is not null and site_visibility is not null
  )
  or (
    not (kind = 'check' and item = 'site_conditions')
    and site_third_party is null and site_other_aircraft is null and site_rain is null and site_visibility is null
    and site_wind_ms is null and site_temp_c is null
  )
);

-- 「いる／あり／制限あり」を選んだら備考が必須（DB も拒む）
alter table flight_field_events add constraint flight_field_events_site_note check (
  not (
    kind = 'check' and item = 'site_conditions'
    and (site_third_party = 'present' or site_other_aircraft = 'present' or site_rain = 'present' or site_visibility = 'limited')
  )
  or (note is not null and length(btrim(note)) > 0)
);

comment on column flight_field_events.doc_key is '書類・手続きの確認（item=docs_confirm）の対象。permit／registration／remote_id／license／report／manual（Sprint 14）。';
comment on column flight_field_events.site_wind_ms is '現場状況の風速（m/s）。任意。入力の妥当性の範囲だけで、飛行の可否の基準ではない（Sprint 14）。';

-- ---- 記録の内容のハッシュ（soraban-field-event-v2。新しい列を含む） ---------------------

create or replace function flight_field_event_hash_v2(
  p_id uuid,
  p_org_id uuid,
  p_plan_id uuid,
  p_kind text,
  p_item text,
  p_result text,
  p_source text,
  p_target_event_id uuid,
  p_flight_record_id uuid,
  p_inspection_id uuid,
  p_report_id uuid,
  p_occurred_at timestamptz,
  p_snapshot_id uuid,
  p_plan_version integer,
  p_gaps jsonb,
  p_note text,
  p_queued boolean,
  p_client_event_id uuid,
  p_recorded_by_member_id uuid,
  p_recorded_by_name text,
  p_recorded_by_role text,
  p_recorded_at timestamptz,
  p_doc_key text,
  p_site_third_party text,
  p_site_other_aircraft text,
  p_site_rain text,
  p_site_visibility text,
  p_site_wind_ms numeric,
  p_site_temp_c numeric
) returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select encode(
    sha256(convert_to(
      jsonb_build_array(
        'soraban-field-event-v2',
        p_id::text,
        p_org_id::text,
        p_plan_id::text,
        p_kind,
        p_item,
        p_result,
        p_source,
        p_target_event_id::text,
        p_flight_record_id::text,
        p_inspection_id::text,
        p_report_id::text,
        to_char(p_occurred_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        p_snapshot_id::text,
        p_plan_version,
        p_gaps,
        p_note,
        p_queued,
        p_client_event_id::text,
        p_recorded_by_member_id::text,
        p_recorded_by_name,
        p_recorded_by_role,
        to_char(p_recorded_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        p_doc_key,
        p_site_third_party,
        p_site_other_aircraft,
        p_site_rain,
        p_site_visibility,
        p_site_wind_ms,
        p_site_temp_c
      )::text,
      'UTF8'
    )),
    'hex'
  )
$$;

-- 追加前のトリガー：0014 と同じ検査に、v2 のハッシュを使う（snapshot_id・plan_version・recorded_by_*・recorded_at・content_hash は DB が決める）。
create or replace function flight_field_events_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  p flight_plans%rowtype;
  m members%rowtype;
  t_kind text;
begin
  perform pg_advisory_xact_lock(hashtextextended('record_versions:flight_plan:' || new.plan_id::text, 0));

  select * into p from flight_plans where id = new.plan_id and org_id = new.org_id;
  if not found then
    raise exception 'plan not found' using errcode = 'SB404';
  end if;
  select * into m from members where id = new.recorded_by_member_id and org_id = new.org_id;
  if not found then
    raise exception 'member not found' using errcode = 'SB404';
  end if;

  if new.kind in ('check', 'takeoff') and p.voided_at is not null then
    raise exception 'plan is voided' using errcode = 'SB409', detail = 'plan_cancelled';
  end if;

  if new.target_event_id is not null then
    select e.kind into t_kind from flight_field_events e
     where e.id = new.target_event_id and e.plan_id = new.plan_id and e.org_id = new.org_id;
    if not found then
      raise exception 'target not found' using errcode = 'SB404';
    end if;
    if (new.kind in ('landing', 'journal_linked') and t_kind <> 'takeoff')
       or (new.kind = 'undo' and t_kind not in ('check', 'takeoff', 'landing')) then
      raise exception 'invalid target' using errcode = 'SB409', detail = 'invalid_target';
    end if;
  end if;

  new.snapshot_id := p.current_snapshot_id;
  new.plan_version := p.current_version;
  new.recorded_by_name := m.display_name;
  new.recorded_by_role := m.role;
  new.recorded_at := clock_timestamp();
  new.content_hash := flight_field_event_hash_v2(
    new.id, new.org_id, new.plan_id, new.kind, new.item, new.result, new.source, new.target_event_id, new.flight_record_id,
    new.inspection_id, new.report_id, new.occurred_at, new.snapshot_id, new.plan_version, new.gaps, new.note, new.queued,
    new.client_event_id, new.recorded_by_member_id, new.recorded_by_name, new.recorded_by_role, new.recorded_at,
    new.doc_key, new.site_third_party, new.site_other_aircraft, new.site_rain, new.site_visibility, new.site_wind_ms, new.site_temp_c
  );
  return new;
end;
$$;
