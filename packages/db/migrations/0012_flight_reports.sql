-- =============================================================
-- Soraban / Sprint 12b: 通報の記録（flight_reports）、版の履歴に flight_report を加える
-- =============================================================
-- 通報（DIPS 2.0 の飛行計画の通報）の記録。そらばんは DIPS に送信しない。手動の記録（利用者の申告）と、開発用の模擬の送信を、
-- 同じ表・同じ状態で残す（docs/sprints/sprint-12b.md 設計 D1）。
--
-- - flight_reports は record_versions（entity_type = flight_report）から DB が作るヘッド表。状態の変更・訂正は版として追記する。
--   通報の記録に voided_at は設けない（取消は種別 cancel の別の行、誤りは状態 retracted の版）。物理削除はしない。
-- - 追加前のトリガー：新規・変更は計画が取消されておらず（voided）、確認を依頼済み（not_requested）で、最新の版（version_conflict）
--   であること。取消（cancel）は取消された計画でも作れる。有効な通報がある計画への新規は already_reported、有効な通報がない計画への
--   変更・取消は no_active_report、元の通報が現在の有効な通報でなければ base_changed、有効な手動の通報がある計画への模擬・API の
--   新規・変更は manual_report_exists（いずれも SQLSTATE SB409）。同じ冪等性キーは 23505（uq_flight_reports_idem_request）。
--   計画ごとに pg_advisory_xact_lock で直列化する。状態の遷移の許可はアプリの遷移表（packages/dips/src/transitions.ts）が決める。
-- - 追加後のトリガー：data からヘッド表の行を作る・更新する。作成時に決まる列（計画・種別・元の通報・スナップショット・指紋・
--   送信元・冪等性キー・内容）は更新で変えられない（23514 report_immutable）。
-- - flight_report_effective_id：有効な通報（新規・変更で、完了した状態の最新の 1 件。それより後に完了した取消が無い）。
--   アプリの effectiveReport（packages/dips/src/status.ts）と同じ規則。
-- - verify_record_chain：flight_report の表の対応と、通報日時（日本時間の `YYYY-MM-DDTHH:MM`）の比較を加える。
-- - 関数は 0011 の定義を置き換える（既存の分岐は 0011 と同じ。flight_report の分岐だけを足す）。
-- - 追記のみ。適用済みのマイグレーション（0001〜0011）は変えない。
-- =============================================================

alter table record_versions drop constraint record_versions_entity_type_check;
alter table record_versions add constraint record_versions_entity_type_check
  check (entity_type in ('member', 'aircraft', 'pilot', 'daily_inspection', 'flight_record', 'flight_plan', 'saved_place', 'flight_report'));

-- ---- 通報の記録（ヘッド表） ----------------------------------

create table flight_reports (
  id uuid primary key,
  org_id uuid not null references organizations(id),
  plan_id uuid not null,
  -- 新規（new）・変更（change）・取消（cancel）。変更・取消は元の通報（有効な通報）を指す別の行
  kind text not null check (kind in ('new', 'change', 'cancel')),
  base_report_id uuid,
  -- 通報の対象のスナップショット（証跡 ID は judgement_snapshots から引ける）
  snapshot_id uuid not null,
  -- 通報時の計画の版
  plan_version integer not null check (plan_version >= 1),
  -- 通報の指紋（soraban-report-fp-v1。SHA-256 の 16 進小文字 64 桁）と、その元の値（変わった項目の表示に使う）
  fingerprint text not null check (fingerprint ~ '^[0-9a-f]{64}$'),
  fingerprint_parts jsonb not null check (jsonb_typeof(fingerprint_parts) = 'object'),
  -- 項目の対応表の版（packages/dips/data/report-fields.json の revision）
  map_revision integer not null check (map_revision >= 1),
  -- 送信元。api は 12b では使わない（API アダプターは作らない）が、値には含める
  channel text not null check (channel in ('manual', 'mock', 'api')),
  status text not null check (status in ('prepared', 'reported_manual', 'submitted_api', 'failed', 'unknown', 'retracted')),
  idempotency_key text not null check (idempotency_key ~ '^[0-9a-f]{64}$'),
  -- 通報日時（日本時間の分）。reported_manual・submitted_api は必須
  reported_at timestamptz check (reported_at is null or reported_at = date_trunc('minute', reported_at)),
  -- DIPS 側の番号、または「番号が表示されなかった」の宣言
  dips_number text check (dips_number is null or length(btrim(dips_number)) between 1 and 50),
  number_unavailable boolean not null default false,
  -- 手動の記録の二つの確認（DIPS の画面で通報を完了した／最新の版と一致している）
  confirmed_dips_done boolean not null default false,
  confirmed_matches_latest boolean not null default false,
  -- 整えた通報内容の写し。技能証明書番号・氏名（personal の項目）は入れない
  content jsonb not null check (jsonb_typeof(content) = 'object'),
  memo text check (memo is null or length(memo) <= 500),
  error_kind text check (error_kind is null or length(error_kind) <= 50),
  -- API 連携用の拡張点（空でよい。模擬は FPR の応答と同じ形で入れる）／未知の外部状況の生の値と取得日時
  external_ref jsonb check (external_ref is null or jsonb_typeof(external_ref) = 'object'),
  external_status jsonb check (external_status is null or jsonb_typeof(external_status) = 'object'),
  current_version integer not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique (id, plan_id, org_id),
  constraint uq_flight_reports_idem_request unique (org_id, idempotency_key),
  constraint flight_reports_plan_fk foreign key (plan_id, org_id) references flight_plans (id, org_id),
  constraint flight_reports_base_fk foreign key (base_report_id, plan_id, org_id) references flight_reports (id, plan_id, org_id),
  constraint flight_reports_snapshot_fk foreign key (snapshot_id, plan_id, org_id) references judgement_snapshots (id, plan_id, org_id),
  -- 変更・取消は元の通報が必須、新規は元の通報なし
  constraint flight_reports_base_check check ((kind = 'new') = (base_report_id is null)),
  -- 手動の送信元の状態は、手動の記録と取り下げだけ
  constraint flight_reports_manual_status_check check (channel <> 'manual' or status in ('reported_manual', 'retracted')),
  -- 完了した状態は通報日時が必須
  constraint flight_reports_reported_at_required check (status not in ('reported_manual', 'submitted_api') or reported_at is not null),
  -- 手動の記録：二つの確認が揃い、番号か「番号なし」の宣言のどちらか一方があり、宣言のときはメモが必須
  constraint flight_reports_manual_record_check check (
    status <> 'reported_manual'
    or (
      confirmed_dips_done
      and confirmed_matches_latest
      and ((dips_number is not null) <> number_unavailable)
      and (not number_unavailable or (memo is not null and length(btrim(memo)) > 0))
    )
  )
);

create index idx_flight_reports_org_plan on flight_reports (org_id, plan_id, created_at);

comment on table flight_reports is
  '通報の記録（Sprint 12b）。record_versions（entity_type = flight_report）から DB が作るヘッド表。そらばんは DIPS に送信しない。手動の記録は利用者の申告。';
comment on column flight_reports.content is
  '整えた通報内容の写し（項目の key と整形済みの値、通報の画面で入力した項目）。技能証明書番号・氏名は入れない。';
comment on column flight_reports.fingerprint is
  '通報時の計画の指紋（soraban-report-fp-v1）。fingerprint_parts がその元の値。';

-- ---- 有効な通報 ----------------------------------------------

-- 計画の通報の行のうち、種別が new／change、状態が reported_manual／submitted_api で、それより後に完了した cancel
-- （状態が reported_manual／submitted_api）が無い最新の 1 件の ID。無ければ NULL。
-- アプリの effectiveReport（packages/dips/src/status.ts）と同じ規則（reports.db.test.ts で一致を確かめる）。
create or replace function flight_report_effective_id(p_plan_id uuid)
returns uuid
language sql
stable
set search_path = public, pg_temp
as $$
  select r.id
    from flight_reports r
   where r.plan_id = p_plan_id
     and r.kind in ('new', 'change')
     and r.status in ('reported_manual', 'submitted_api')
     and not exists (
       select 1 from flight_reports c
        where c.plan_id = r.plan_id
          and c.kind = 'cancel'
          and c.status in ('reported_manual', 'submitted_api')
          and (c.created_at, c.id) > (r.created_at, r.id)
     )
   order by r.created_at desc, r.id desc
   limit 1
$$;

revoke execute on function flight_report_effective_id(uuid) from public;

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
  v_start timestamptz;
  v_plan flight_plans%rowtype;
  v_effective uuid;
  v_effective_channel text;
  v_kind text;
  v_channel text;
begin
  perform pg_advisory_xact_lock(hashtextextended('record_versions:' || new.entity_type || ':' || new.entity_id::text, 0));
  if new.entity_type = 'member' then
    -- 最後の運航管理者の判定を組織単位で直列化する
    perform pg_advisory_xact_lock(hashtextextended('members_org:' || new.org_id::text, 0));
  elsif new.entity_type = 'flight_record' then
    -- 飛行記録の重なりの検査（追加後のトリガー）を組織単位で直列化する
    perform pg_advisory_xact_lock(hashtextextended('flight_records_org:' || new.org_id::text, 0));
  elsif new.entity_type = 'flight_report' then
    -- 通報の記録の検査（有効な通報・二重の通報）を計画単位で直列化する
    perform pg_advisory_xact_lock(hashtextextended('flight_reports_plan:' || (new.data->>'plan_id'), 0));
    if new.op = 'void' then
      -- 通報の記録は取消（void）しない。取消は種別 cancel の別の行、誤りは retracted の版で表す
      raise exception 'flight reports cannot be voided' using errcode = 'SB409', detail = 'not_voidable';
    end if;
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
  elsif new.entity_type = 'flight_plan' then
    -- 予定日（JST の日付）は予定開始から DB が決める
    v_start := ops_jst_minute_to_timestamptz(new.data->>'planned_start_at');
    new.data := new.data || jsonb_build_object('planned_date', to_char(ops_jst_date(v_start), 'YYYY-MM-DD'));
  elsif new.entity_type = 'flight_report' then
    -- 通報の記録の新規：計画・冪等性キー・計画の状態と版・有効な通報を検査する（状態の遷移の許可はアプリの遷移表が決める）
    if new.op = 'create' then
      select * into v_plan from flight_plans where id = (new.data->>'plan_id')::uuid and org_id = new.org_id;
      if not found then
        raise exception 'plan not found' using errcode = 'SB404';
      end if;
      -- 同じ冪等性キーの記録があれば、新しい行を作らない（アプリは既存の記録を返す）
      if exists (select 1 from flight_reports where org_id = new.org_id and idempotency_key = new.data->>'idempotency_key') then
        raise exception 'duplicate idempotency key' using errcode = '23505', constraint = 'uq_flight_reports_idem_request';
      end if;
      v_kind := new.data->>'kind';
      v_channel := new.data->>'channel';
      if v_kind in ('new', 'change') then
        -- 新規・変更は、取消されておらず、確認を依頼済みで、最新の版に対してだけ。取消は取消された計画でも作れる
        if v_plan.voided_at is not null then
          raise exception 'plan is voided' using errcode = 'SB409', detail = 'voided';
        end if;
        if v_plan.status <> 'active' then
          raise exception 'confirmation is not requested' using errcode = 'SB409', detail = 'not_requested';
        end if;
        if (new.data->>'plan_version')::integer <> v_plan.current_version then
          raise exception 'version conflict' using errcode = 'SB409', detail = 'version_conflict';
        end if;
      end if;
      v_effective := flight_report_effective_id(v_plan.id);
      select channel into v_effective_channel from flight_reports where id = v_effective;
      if v_kind = 'new' then
        -- 手動の通報が有効な計画に、模擬・API で新規を送らない（DIPS 上で二重になる）
        if v_channel in ('mock', 'api') and v_effective_channel = 'manual' then
          raise exception 'manual report exists' using errcode = 'SB409', detail = 'manual_report_exists';
        end if;
        if v_effective is not null then
          raise exception 'already reported' using errcode = 'SB409', detail = 'already_reported';
        end if;
      else
        if v_effective is null then
          raise exception 'no active report' using errcode = 'SB409', detail = 'no_active_report';
        end if;
        if (new.data->>'base_report_id')::uuid is distinct from v_effective then
          raise exception 'base report changed' using errcode = 'SB409', detail = 'base_changed';
        end if;
        if v_kind = 'change' and v_channel in ('mock', 'api') and v_effective_channel = 'manual' then
          raise exception 'manual report exists' using errcode = 'SB409', detail = 'manual_report_exists';
        end if;
      end if;
    end if;
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
  hr flight_reports%rowtype;
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

  elsif new.entity_type = 'flight_plan' then
    if new.op in ('create', 'update') then
      -- 機体・操縦者・よく使う地点は同じ組織のものに限る。機体は訂正で変えられない
      if not exists (select 1 from aircraft where id = (d->>'aircraft_id')::uuid and org_id = new.org_id)
         or not exists (select 1 from pilots where id = (d->>'pilot_id')::uuid and org_id = new.org_id) then
        raise exception 'aircraft or pilot not found' using errcode = 'SB404';
      end if;
      if (d->>'saved_place_id') is not null and not exists (
        select 1 from saved_places where id = (d->>'saved_place_id')::uuid and org_id = new.org_id
      ) then
        raise exception 'saved place not found' using errcode = 'SB404';
      end if;
    end if;
    if new.op = 'create' then
      insert into flight_plans (id, org_id, title, aircraft_id, pilot_id, planned_start_at, duration_minutes, planned_date,
                                purpose, place_name, latitude, longitude, radius_m, saved_place_id, max_altitude_m,
                                flags, pilot_permits, judgement_purpose, access_control, third_party_overflight,
                                bvlos_with_observer, drone_weight_g, permit_numbers, notes, status, current_snapshot_id,
                                client_request_id, current_version, created_at, updated_at)
      values (new.entity_id, new.org_id, d->>'title', (d->>'aircraft_id')::uuid, (d->>'pilot_id')::uuid,
              ops_jst_minute_to_timestamptz(d->>'planned_start_at'), (d->>'duration_minutes')::integer,
              (d->>'planned_date')::date, d->>'purpose', d->>'place_name', (d->>'latitude')::numeric,
              (d->>'longitude')::numeric, (d->>'radius_m')::integer, (d->>'saved_place_id')::uuid,
              (d->>'max_altitude_m')::integer, coalesce(d->'flags', '[]'::jsonb), coalesce(d->'pilot_permits', '[]'::jsonb),
              d->>'judgement_purpose', (d->>'access_control')::boolean, (d->>'third_party_overflight')::boolean,
              (d->>'bvlos_with_observer')::boolean, (d->>'drone_weight_g')::integer, d->>'permit_numbers', d->>'notes',
              d->>'status', (d->>'current_snapshot_id')::uuid, (d->>'client_request_id')::uuid,
              new.version_no, new.created_at, new.created_at);
    elsif new.op = 'update' then
      select aircraft_id into v_head_aircraft from flight_plans where id = new.entity_id;
      if v_head_aircraft is distinct from (d->>'aircraft_id')::uuid then
        raise exception 'aircraft is immutable' using errcode = '23514', detail = 'aircraft_immutable';
      end if;
      update flight_plans
         set title = d->>'title', pilot_id = (d->>'pilot_id')::uuid,
             planned_start_at = ops_jst_minute_to_timestamptz(d->>'planned_start_at'),
             duration_minutes = (d->>'duration_minutes')::integer, planned_date = (d->>'planned_date')::date,
             purpose = d->>'purpose', place_name = d->>'place_name', latitude = (d->>'latitude')::numeric,
             longitude = (d->>'longitude')::numeric, radius_m = (d->>'radius_m')::integer,
             saved_place_id = (d->>'saved_place_id')::uuid, max_altitude_m = (d->>'max_altitude_m')::integer,
             flags = coalesce(d->'flags', '[]'::jsonb), pilot_permits = coalesce(d->'pilot_permits', '[]'::jsonb),
             judgement_purpose = d->>'judgement_purpose', access_control = (d->>'access_control')::boolean,
             third_party_overflight = (d->>'third_party_overflight')::boolean,
             bvlos_with_observer = (d->>'bvlos_with_observer')::boolean, drone_weight_g = (d->>'drone_weight_g')::integer,
             permit_numbers = d->>'permit_numbers', notes = d->>'notes', status = d->>'status',
             current_snapshot_id = (d->>'current_snapshot_id')::uuid, client_request_id = (d->>'client_request_id')::uuid,
             current_version = new.version_no, updated_at = new.created_at
       where id = new.entity_id;
    else
      update flight_plans set voided_at = new.created_at, current_version = new.version_no, updated_at = new.created_at
       where id = new.entity_id;
    end if;

  elsif new.entity_type = 'flight_report' then
    if new.op = 'create' then
      insert into flight_reports (id, org_id, plan_id, kind, base_report_id, snapshot_id, plan_version, fingerprint,
                                  fingerprint_parts, map_revision, channel, status, idempotency_key, reported_at,
                                  dips_number, number_unavailable, confirmed_dips_done, confirmed_matches_latest,
                                  content, memo, error_kind, external_ref, external_status,
                                  current_version, created_at, updated_at)
      values (new.entity_id, new.org_id, (d->>'plan_id')::uuid, d->>'kind', (d->>'base_report_id')::uuid,
              (d->>'snapshot_id')::uuid, (d->>'plan_version')::integer, d->>'fingerprint', d->'fingerprint_parts',
              (d->>'map_revision')::integer, d->>'channel', d->>'status', d->>'idempotency_key',
              ops_jst_minute_to_timestamptz(d->>'reported_at'), d->>'dips_number',
              coalesce((d->>'number_unavailable')::boolean, false), coalesce((d->>'confirmed_dips_done')::boolean, false),
              coalesce((d->>'confirmed_matches_latest')::boolean, false), d->'content', d->>'memo', d->>'error_kind',
              nullif(d->'external_ref', 'null'::jsonb), nullif(d->'external_status', 'null'::jsonb), new.version_no, new.created_at, new.created_at);
    else
      -- 更新（状態の変更・訂正）：作成時に決まる列は変えられない。状態の遷移の許可はアプリの遷移表が決める
      select * into hr from flight_reports where id = new.entity_id;
      if hr.plan_id is distinct from (d->>'plan_id')::uuid
         or hr.kind is distinct from d->>'kind'
         or hr.base_report_id is distinct from (d->>'base_report_id')::uuid
         or hr.snapshot_id is distinct from (d->>'snapshot_id')::uuid
         or hr.plan_version is distinct from (d->>'plan_version')::integer
         or hr.fingerprint is distinct from d->>'fingerprint'
         or hr.fingerprint_parts is distinct from d->'fingerprint_parts'
         or hr.map_revision is distinct from (d->>'map_revision')::integer
         or hr.channel is distinct from d->>'channel'
         or hr.idempotency_key is distinct from d->>'idempotency_key'
         or hr.content is distinct from d->'content' then
        raise exception 'report is immutable' using errcode = '23514', detail = 'report_immutable';
      end if;
      update flight_reports
         set status = d->>'status', reported_at = ops_jst_minute_to_timestamptz(d->>'reported_at'),
             dips_number = d->>'dips_number', number_unavailable = coalesce((d->>'number_unavailable')::boolean, false),
             confirmed_dips_done = coalesce((d->>'confirmed_dips_done')::boolean, false),
             confirmed_matches_latest = coalesce((d->>'confirmed_matches_latest')::boolean, false),
             memo = d->>'memo', error_kind = d->>'error_kind', external_ref = nullif(d->'external_ref', 'null'::jsonb),
             external_status = nullif(d->'external_status', 'null'::jsonb), current_version = new.version_no, updated_at = new.created_at
       where id = new.entity_id;
    end if;

  elsif new.entity_type = 'saved_place' then
    if new.op = 'create' then
      insert into saved_places (id, org_id, name, address_text, latitude, longitude, note,
                                current_version, created_at, updated_at)
      values (new.entity_id, new.org_id, d->>'name', d->>'address_text', (d->>'latitude')::numeric,
              (d->>'longitude')::numeric, d->>'note', new.version_no, new.created_at, new.created_at);
    elsif new.op = 'update' then
      update saved_places
         set name = d->>'name', address_text = d->>'address_text', latitude = (d->>'latitude')::numeric,
             longitude = (d->>'longitude')::numeric, note = d->>'note',
             current_version = new.version_no, updated_at = new.created_at
       where id = new.entity_id;
    else
      update saved_places set voided_at = new.created_at, current_version = new.version_no, updated_at = new.created_at
       where id = new.entity_id;
    end if;
  end if;
  return null;
end;
$$;

-- ---- 検証 ----------------------------------------------------

-- 0011 の verify_record_chain に、flight_report の表の対応を加える。
-- 通報日時（reported_at）は、版の data と同じ日本時間の `YYYY-MM-DDTHH:MM` にして比べる。
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
               when 'flight_plan' then 'flight_plans'
               when 'saved_place' then 'saved_places'
               when 'flight_report' then 'flight_reports'
             end;
  if v_table is null then
    return;
  end if;
  if p_entity_type = 'flight_record' then
    select to_jsonb(t) || jsonb_build_object('takeoff_at', ops_timestamptz_to_jst_minute(t.takeoff_at),
                                             'landing_at', ops_timestamptz_to_jst_minute(t.landing_at))
      into v_head from flight_records t where t.id = p_entity_id;
  elsif p_entity_type = 'flight_plan' then
    select to_jsonb(t) || jsonb_build_object('planned_start_at', ops_timestamptz_to_jst_minute(t.planned_start_at))
      into v_head from flight_plans t where t.id = p_entity_id;
  elsif p_entity_type = 'flight_report' then
    select to_jsonb(t) || jsonb_build_object('reported_at', ops_timestamptz_to_jst_minute(t.reported_at))
      into v_head from flight_reports t where t.id = p_entity_id;
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

-- ---- アプリ用ロールの権限 -----------------------------------
-- flight_reports は参照だけ（書くのは record_versions への追加→トリガー）。更新・削除・TRUNCATE・直接の追加は与えない。
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'soraban_app') then
    grant select on flight_reports to soraban_app;
    revoke insert, update, delete, truncate on flight_reports from soraban_app;
  end if;
end
$$;
