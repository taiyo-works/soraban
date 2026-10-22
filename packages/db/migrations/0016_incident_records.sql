-- =============================================================
-- Soraban / Sprint 12e: 事故・ヒヤリハットの記録（incident_records）と、国への報告の記録（incident_report_records。追記専用）
-- =============================================================
-- 起きたことの事実を残す（docs/sprints/sprint-12e.md 設計 B）。記録は事実の記録であり、法的な報告の完了も、責任の判断も
-- 意味しない。そらばんは国へ報告を送信しない（DIPS・国への接続はしない）。
--
-- - incident_records は record_versions（entity_type = incident_record）から DB が作るヘッド表。訂正・取消はすべて版として
--   追記する（理由は record_versions の CHECK で必須。物理削除はしない）。soraban_app は参照だけ。
--   事象の類型（event_types）の値の一覧は版つきのデータ（アプリ）が正で、DB の CHECK に列挙しない（配列で空でないことだけ）。
--   目安（guidance_level・guidance_revision）は保存のたびにアプリのサーバーが事実から計算して版の data に入れる。
--   個人を特定する情報（氏名・連絡先・住所・病状・写真・端末の識別子・軌跡）の列は作らない。けがの人数と有無だけを持つ。
-- - 追加前のトリガー（incident_record の分岐）：計画・飛行記録・機体・操縦者が同じ組織であること、計画と飛行記録が同じ計画で
--   あること（SB404）。snapshot_id は DB が決める（計画を結んだ版で、その時点の計画の現在のスナップショット。同じ計画のままの
--   訂正では前の版の値を引き継ぐ。計画がなければ NULL）。アプリが送った値は使わない。
-- - incident_report_records は追記専用（reject_append_only_change。SQLSTATE SB409、detail immutable）。soraban_app は参照と追加
--   だけ。recorded_by_name・recorded_by_role・incident_version・created_at・content_hash は追加前のトリガーが決める
--   （ハッシュ soraban-incident-report-record-v1）。報告の記録は利用者の申告で、そらばんが報告の完了を確認したものではない。
--   有効な報告の記録は、取り下げられていない reported・consulted の行（状態は保存せず、行から毎回導出する）。
-- - verify_incident_report_records(p_incident_id)：ハッシュの再計算で改変を検出する。soraban_app は実行できない。
-- - record_versions のトリガー関数と verify_record_chain は 0015 の定義を丸ごと置き換える（既存の分岐は 0015 と同じ。
--   incident_record の分岐だけを足す）。content_hash の計算規則（soraban-record-v1）は変えない。
-- - 追記のみ。適用済みのマイグレーション（0001〜0015）は変えない。既存の表の列は変えない。
-- =============================================================

alter table record_versions drop constraint record_versions_entity_type_check;
alter table record_versions add constraint record_versions_entity_type_check
  check (entity_type in ('member', 'aircraft', 'pilot', 'daily_inspection', 'flight_record', 'flight_plan', 'saved_place', 'flight_report', 'permit_registration', 'incident_record'));

-- ---- 事故・ヒヤリハットの記録（ヘッド表） ----------------------

create table incident_records (
  id uuid primary key,
  org_id uuid not null references organizations(id),
  -- 利用者が選ぶ区分（法令上の区分ではない）。accident：事故／near_miss：ヒヤリハット／undetermined：まだ分からない
  kind text not null check (kind in ('accident', 'near_miss', 'undetermined')),
  -- 起きた日時（1 分単位）。サーバーが範囲を検査する
  occurred_at timestamptz not null check (occurred_at = date_trunc('minute', occurred_at)),
  phase text check (phase is null or phase in ('preparation', 'takeoff', 'in_flight', 'landing', 'after_flight', 'other')),
  place_name text check (place_name is null or length(place_name) <= 100),
  latitude numeric(9, 6) check (latitude is null or latitude between -90 and 90),
  longitude numeric(9, 6) check (longitude is null or longitude between -180 and 180),
  plan_id uuid,
  snapshot_id uuid,
  flight_record_id uuid,
  aircraft_id uuid references aircraft(id),
  pilot_id uuid references pilots(id),
  -- 事象の類型のキーの配列（1 件以上）。値の一覧は版つきのデータが正で、ここでは列挙しない
  event_types jsonb not null check (jsonb_typeof(event_types) = 'array' and jsonb_array_length(event_types) >= 1),
  people_injury text not null check (people_injury in ('yes', 'no', 'unknown')),
  aircraft_damage text not null check (aircraft_damage in ('yes', 'no', 'unknown')),
  injured_count integer check (injured_count is null or injured_count between 0 and 999),
  contacts_made jsonb not null default '[]'::jsonb check (
    jsonb_typeof(contacts_made) = 'array'
    and contacts_made <@ '["emergency_119", "police_110", "site_manager", "client", "internal_manager"]'::jsonb
  ),
  summary text check (summary is null or length(btrim(summary)) between 1 and 200),
  details text check (details is null or length(details) <= 1000),
  factors_note text check (factors_note is null or length(factors_note) <= 500),
  actions_taken text check (actions_taken is null or length(actions_taken) <= 500),
  prevention_note text check (prevention_note is null or length(prevention_note) <= 500),
  -- 現場の簡易記録で、詳細をあとで補う印
  detail_pending boolean not null default false,
  source text not null check (source in ('office', 'field_quick')),
  follow_up_status text not null default 'open' check (follow_up_status in ('open', 'done')),
  follow_up_on date,
  -- 保存時にアプリのサーバーが計算した目安と、事象の類型のデータの版
  guidance_level text not null check (guidance_level in ('possible', 'none_selected')),
  guidance_revision integer not null check (guidance_revision >= 1),
  client_request_id uuid,
  current_version integer not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  voided_at timestamptz,
  unique (id, org_id),
  foreign key (plan_id, org_id) references flight_plans (id, org_id),
  foreign key (snapshot_id, plan_id, org_id) references judgement_snapshots (id, plan_id, org_id),
  foreign key (flight_record_id) references flight_records (id),
  constraint incident_records_snapshot_needs_plan check (snapshot_id is null or plan_id is not null),
  constraint incident_records_summary_pending_check check (summary is not null or detail_pending),
  constraint incident_records_follow_up_date_check check ((follow_up_status = 'done') = (follow_up_on is not null)),
  constraint incident_records_injured_count_requires_injury check (injured_count is null or people_injury = 'yes'),
  constraint incident_records_coordinates_check check ((latitude is null) = (longitude is null))
);

-- 二重登録の防止（NULL でないものの中で組織内一意）
create unique index uq_incident_records_request on incident_records (org_id, client_request_id) where client_request_id is not null;
create index idx_incident_records_org on incident_records (org_id, occurred_at desc, id);
create index idx_incident_records_plan on incident_records (org_id, plan_id) where plan_id is not null;
create index idx_incident_records_flight on incident_records (org_id, flight_record_id) where flight_record_id is not null;

comment on table incident_records is
  '事故・ヒヤリハットの記録（Sprint 12e）。record_versions（entity_type = incident_record）から DB が作るヘッド表。起きたことの事実の記録で、法的な報告の完了も責任の判断も意味しない。そらばんは国へ報告を送信しない。';
comment on column incident_records.kind is '利用者が選ぶ区分（記録の整理のため）。法令上の区分ではない。';
comment on column incident_records.event_types is '事象の類型のキーの配列。値の一覧はアプリの版つきのデータ（guidance_revision の版）が正。';
comment on column incident_records.guidance_level is '保存時にアプリのサーバーが事象の類型から計算した目安（possible／none_selected）。報告の要否を決めるものではない。';

-- ---- 国への報告の記録（追記専用） --------------------------------

create table incident_report_records (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  incident_id uuid not null,
  -- reported：DIPS 2.0 等で報告した／consulted：報告の要否を国土交通省などに確かめた／retract：取り下げ
  action text not null check (action in ('reported', 'consulted', 'retract')),
  -- 報告した・確かめた日時（日本時間の分）
  done_at timestamptz check (done_at is null or done_at = date_trunc('minute', done_at)),
  channel text check (channel is null or channel in ('dips', 'other')),
  channel_note text check (channel_note is null or length(btrim(channel_note)) between 1 and 100),
  reference text check (reference is null or length(btrim(reference)) between 1 and 50),
  reference_absent boolean not null default false,
  note text check (note is null or length(note) <= 500),
  checks jsonb not null check (jsonb_typeof(checks) = 'object'),
  target_record_id uuid,
  -- 記録した時点の記録の版（追加前のトリガーが入れる）と、事実の指紋（アプリのサーバーが決める）
  incident_version integer not null check (incident_version >= 1),
  facts_fingerprint text not null check (facts_fingerprint ~ '^[0-9a-f]{64}$'),
  reason text check (reason is null or length(reason) <= 500),
  recorded_by_member_id uuid not null references members(id),
  -- その時点の表示名・役割の写し（追加前のトリガーが利用者の行から写す）
  recorded_by_name text not null check (length(btrim(recorded_by_name)) between 1 and 100),
  recorded_by_role text not null check (recorded_by_role in ('manager', 'pilot', 'viewer')),
  created_at timestamptz not null,
  content_hash text not null,
  constraint uq_incident_report_records_id_incident_org unique (id, incident_id, org_id),
  foreign key (incident_id, org_id) references incident_records (id, org_id),
  foreign key (target_record_id, incident_id, org_id) references incident_report_records (id, incident_id, org_id),
  -- reported：日時・送り先が必須。その他は送り先の補足が必須。番号か「表示されなかった」のどちらか一方。確認がすべて真
  constraint incident_report_records_reported_check check (
    action <> 'reported'
    or (
      done_at is not null
      and channel is not null
      and ((channel = 'other') = (channel_note is not null))
      and ((reference is not null) <> reference_absent)
      and checks = '{"reportCompleted": true}'::jsonb
      and target_record_id is null
      and reason is null
    )
  ),
  -- consulted：日時と、確かめた相手と結果の要点（note）が必須。確認が真
  constraint incident_report_records_consulted_check check (
    action <> 'consulted'
    or (
      done_at is not null
      and note is not null and length(btrim(note)) > 0
      and checks = '{"consultationDone": true}'::jsonb
      and channel is null and channel_note is null and reference is null and not reference_absent
      and target_record_id is null
      and reason is null
    )
  ),
  -- retract：取り下げる行と理由が必須
  constraint incident_report_records_retract_check check (
    action <> 'retract'
    or (
      target_record_id is not null
      and reason is not null and length(btrim(reason)) > 0
      and checks = '{}'::jsonb
      and done_at is null and channel is null and channel_note is null and reference is null and not reference_absent
    )
  )
);

create index idx_incident_report_records_incident on incident_report_records (org_id, incident_id, created_at, id);
-- 同じ行を 2 回取り下げられない
create unique index uq_incident_report_records_retract_target on incident_report_records (target_record_id) where action = 'retract';

comment on table incident_report_records is
  '国への報告の記録（Sprint 12e）。追記専用。利用者の申告であり、そらばんが報告の完了を確認したものではない。有効な記録は、取り下げられていない reported・consulted の行（行から毎回導出する）。';

create trigger incident_report_records_no_update_delete
  before update or delete on incident_report_records
  for each row execute function reject_append_only_change();

create trigger incident_report_records_no_truncate
  before truncate on incident_report_records
  for each statement execute function reject_append_only_change();

-- 記録の内容のハッシュ（soraban-incident-report-record-v1）。入力は jsonb の配列の文字列表現（UTF-8）、出力は SHA-256 の 16 進小文字。
create or replace function incident_report_record_hash(
  p_id uuid,
  p_org_id uuid,
  p_incident_id uuid,
  p_action text,
  p_done_at timestamptz,
  p_channel text,
  p_channel_note text,
  p_reference text,
  p_reference_absent boolean,
  p_note text,
  p_checks jsonb,
  p_target_record_id uuid,
  p_incident_version integer,
  p_facts_fingerprint text,
  p_reason text,
  p_recorded_by_member_id uuid,
  p_recorded_by_name text,
  p_recorded_by_role text,
  p_created_at timestamptz
) returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select encode(
    sha256(convert_to(
      jsonb_build_array(
        'soraban-incident-report-record-v1',
        p_id::text,
        p_org_id::text,
        p_incident_id::text,
        p_action,
        to_char(p_done_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        p_channel,
        p_channel_note,
        p_reference,
        p_reference_absent,
        p_note,
        p_checks,
        p_target_record_id::text,
        p_incident_version,
        p_facts_fingerprint,
        p_reason,
        p_recorded_by_member_id::text,
        p_recorded_by_name,
        p_recorded_by_role,
        to_char(p_created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
      )::text,
      'UTF8'
    )),
    'hex'
  )
$$;

-- 追加前のトリガー：記録・利用者の検査と、recorded_by_name・recorded_by_role・incident_version・created_at・content_hash の決定
-- （アプリが送った値は使わない）。
--   SB404 記録・利用者が同じ組織にない
--   SB409 voided（取消した記録への reported・consulted）／invalid_target（retract が同じ記録の reported・consulted 以外を指す）
create or replace function incident_report_records_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  h incident_records%rowtype;
  m members%rowtype;
  t_action text;
begin
  -- 記録の版の追加と、同じ記録の報告の記録を直列化する
  perform pg_advisory_xact_lock(hashtextextended('record_versions:incident_record:' || new.incident_id::text, 0));

  select * into h from incident_records where id = new.incident_id and org_id = new.org_id;
  if not found then
    raise exception 'incident not found' using errcode = 'SB404';
  end if;
  select * into m from members where id = new.recorded_by_member_id and org_id = new.org_id;
  if not found then
    raise exception 'member not found' using errcode = 'SB404';
  end if;

  if new.action in ('reported', 'consulted') and h.voided_at is not null then
    raise exception 'incident is voided' using errcode = 'SB409', detail = 'voided';
  end if;
  if new.action = 'retract' then
    select r.action into t_action from incident_report_records r
     where r.id = new.target_record_id and r.incident_id = new.incident_id and r.org_id = new.org_id;
    if not found then
      raise exception 'target not found' using errcode = 'SB404';
    end if;
    if t_action not in ('reported', 'consulted') then
      raise exception 'invalid target' using errcode = 'SB409', detail = 'invalid_target';
    end if;
  end if;

  new.incident_version := h.current_version;
  new.recorded_by_name := m.display_name;
  new.recorded_by_role := m.role;
  new.created_at := clock_timestamp();
  new.content_hash := incident_report_record_hash(
    new.id, new.org_id, new.incident_id, new.action, new.done_at, new.channel, new.channel_note, new.reference,
    new.reference_absent, new.note, new.checks, new.target_record_id, new.incident_version, new.facts_fingerprint,
    new.reason, new.recorded_by_member_id, new.recorded_by_name, new.recorded_by_role, new.created_at
  );
  return new;
end;
$$;

create trigger incident_report_records_before_insert
  before insert on incident_report_records
  for each row execute function incident_report_records_before_insert();

-- 報告の記録の改変を検出する（ハッシュの再計算）。改変がなければ 0 行。DB 移行の前後の検証にも使う（docs/spec.md §13.8.1）。
--   content_hash_mismatch   content_hash の再計算が一致しない
--   invalid_target          retract が同じ記録の reported・consulted 以外を指している
-- 限界：オーナーロールが行を消して作り直した改変は検出できない（外部の控えは Sprint 15 で検討）。
create or replace function verify_incident_report_records(p_incident_id uuid)
returns table (record_id uuid, problem text)
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  r record;
begin
  for r in
    select * from incident_report_records x where x.incident_id = p_incident_id order by x.created_at, x.id
  loop
    if r.content_hash <> incident_report_record_hash(
         r.id, r.org_id, r.incident_id, r.action, r.done_at, r.channel, r.channel_note, r.reference,
         r.reference_absent, r.note, r.checks, r.target_record_id, r.incident_version, r.facts_fingerprint,
         r.reason, r.recorded_by_member_id, r.recorded_by_name, r.recorded_by_role, r.created_at
       ) then
      record_id := r.id; problem := 'content_hash_mismatch'; return next;
    end if;
    if r.action = 'retract' and not exists (
      select 1 from incident_report_records t
       where t.id = r.target_record_id and t.incident_id = r.incident_id and t.action in ('reported', 'consulted')
    ) then
      record_id := r.id; problem := 'invalid_target'; return next;
    end if;
  end loop;
end;
$$;

revoke execute on function verify_incident_report_records(uuid) from public;

-- ---- 追加前のトリガー（0015 の関数に incident_record の分岐を足す） ----

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
  v_prev_data jsonb;
  v_aid text;
  v_fr_plan uuid;
  v_snapshot uuid;
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
  elsif new.entity_type = 'permit_registration' then
    -- 許可番号の一意の検査（追加前のトリガー）を組織単位で直列化する
    perform pg_advisory_xact_lock(hashtextextended('permit_registrations_org:' || new.org_id::text, 0));
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
  elsif new.entity_type = 'permit_registration' then
    -- 許可・承認の登録：番号の一意・機体と操縦者の組織・新規は有効・失効の版の内容を検査する（取消は元の版の内容のまま）
    if new.op in ('create', 'update') then
      if exists (
        select 1 from permit_registrations
         where org_id = new.org_id and permit_number_key = new.data->>'permit_number_key'
           and id <> new.entity_id and voided_at is null
      ) then
        raise exception 'duplicate permit number' using errcode = 'SB409', detail = 'duplicate_number';
      end if;
      for v_aid in
        select jsonb_array_elements_text(
          case when jsonb_typeof(new.data->'aircraft_scope'->'ids') = 'array' then new.data->'aircraft_scope'->'ids' else '[]'::jsonb end)
      loop
        if not exists (select 1 from aircraft where org_id = new.org_id and id::text = v_aid) then
          raise exception 'aircraft not found' using errcode = 'SB404';
        end if;
      end loop;
      for v_aid in
        select jsonb_array_elements_text(
          case when jsonb_typeof(new.data->'pilot_scope'->'ids') = 'array' then new.data->'pilot_scope'->'ids' else '[]'::jsonb end)
      loop
        if not exists (select 1 from pilots where org_id = new.org_id and id::text = v_aid) then
          raise exception 'pilot not found' using errcode = 'SB404';
        end if;
      end loop;
    end if;
    if new.op = 'create' then
      if new.data->>'status' is distinct from 'active' then
        raise exception 'a new registration must be active' using errcode = '23514', detail = 'invalid_status';
      end if;
    elsif new.op = 'update' then
      select r.data into v_prev_data from record_versions r
       where r.entity_type = new.entity_type and r.entity_id = new.entity_id
       order by r.version_no desc limit 1;
      if v_prev_data->>'status' = 'revoked' then
        raise exception 'permit is revoked' using errcode = 'SB409', detail = 'revoked';
      end if;
      -- 失効の版は、状態と失効日以外の内容を変えない
      if new.data->>'status' = 'revoked'
         and (new.data - 'status' - 'revoked_on') is distinct from (v_prev_data - 'status' - 'revoked_on') then
        raise exception 'revocation must not change the content' using errcode = 'SB409', detail = 'revoke_changes_content';
      end if;
    end if;
  elsif new.entity_type = 'incident_record' then
    -- 事故・ヒヤリハットの記録：計画・飛行記録・機体・操縦者が同じ組織であること、計画と飛行記録が同じ計画であることを検査する
    -- （SB404）。スナップショットは DB が決める（計画を結んだ版で、その時点の計画の現在のスナップショット。同じ計画のままの訂正
    -- では前の版の値を引き継ぐ。アプリが送った値は使わない）。取消（void）は元の版の内容のまま。
    if new.op in ('create', 'update') then
      v_snapshot := null;
      if new.data->>'plan_id' is not null then
        select * into v_plan from flight_plans where id = (new.data->>'plan_id')::uuid and org_id = new.org_id;
        if not found then
          raise exception 'plan not found' using errcode = 'SB404';
        end if;
        v_snapshot := v_plan.current_snapshot_id;
        if new.op = 'update' then
          select r.data into v_prev_data from record_versions r
           where r.entity_type = new.entity_type and r.entity_id = new.entity_id
           order by r.version_no desc limit 1;
          if v_prev_data->>'plan_id' is not distinct from new.data->>'plan_id' and v_prev_data->>'snapshot_id' is not null then
            v_snapshot := (v_prev_data->>'snapshot_id')::uuid;
          end if;
        end if;
      end if;
      new.data := new.data || jsonb_build_object('snapshot_id', v_snapshot);
      if new.data->>'flight_record_id' is not null then
        select f.flight_plan_id into v_fr_plan from flight_records f
         where f.id = (new.data->>'flight_record_id')::uuid and f.org_id = new.org_id;
        if not found then
          raise exception 'flight record not found' using errcode = 'SB404';
        end if;
        if new.data->>'plan_id' is not null and v_fr_plan is distinct from (new.data->>'plan_id')::uuid then
          raise exception 'flight record of another plan' using errcode = 'SB404';
        end if;
      end if;
      if new.data->>'aircraft_id' is not null
         and not exists (select 1 from aircraft where id = (new.data->>'aircraft_id')::uuid and org_id = new.org_id) then
        raise exception 'aircraft not found' using errcode = 'SB404';
      end if;
      if new.data->>'pilot_id' is not null
         and not exists (select 1 from pilots where id = (new.data->>'pilot_id')::uuid and org_id = new.org_id) then
        raise exception 'pilot not found' using errcode = 'SB404';
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

-- ---- 追加後のトリガー（ヘッド表の作成・更新。0015 の関数に incident_record の分岐を足す） ----

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

  elsif new.entity_type = 'permit_registration' then
    if new.op = 'create' then
      insert into permit_registrations (id, org_id, permit_number, permit_number_key, coverage, kinds, airport_names,
                                        issued_on, valid_from, valid_to, status, revoked_on, place_scope, aircraft_scope,
                                        pilot_scope, max_altitude_m, max_weight_kg, requires_observer,
                                        requires_access_control, conditions_text, source, external_ref,
                                        current_version, created_at, updated_at)
      values (new.entity_id, new.org_id, d->>'permit_number', d->>'permit_number_key', d->>'coverage', d->'kinds',
              coalesce(nullif(d->'airport_names', 'null'::jsonb), '[]'::jsonb),
              (d->>'issued_on')::date, (d->>'valid_from')::date, (d->>'valid_to')::date, d->>'status',
              (d->>'revoked_on')::date, d->'place_scope', d->'aircraft_scope', d->'pilot_scope',
              (d->>'max_altitude_m')::integer, (d->>'max_weight_kg')::numeric,
              coalesce((d->>'requires_observer')::boolean, false), coalesce((d->>'requires_access_control')::boolean, false),
              d->>'conditions_text', coalesce(d->>'source', 'manual'),
              coalesce(nullif(d->'external_ref', 'null'::jsonb), '{}'::jsonb),
              new.version_no, new.created_at, new.created_at);
    elsif new.op = 'update' then
      update permit_registrations
         set permit_number = d->>'permit_number', permit_number_key = d->>'permit_number_key', coverage = d->>'coverage',
             kinds = d->'kinds', airport_names = coalesce(nullif(d->'airport_names', 'null'::jsonb), '[]'::jsonb),
             issued_on = (d->>'issued_on')::date, valid_from = (d->>'valid_from')::date, valid_to = (d->>'valid_to')::date,
             status = d->>'status', revoked_on = (d->>'revoked_on')::date, place_scope = d->'place_scope',
             aircraft_scope = d->'aircraft_scope', pilot_scope = d->'pilot_scope',
             max_altitude_m = (d->>'max_altitude_m')::integer, max_weight_kg = (d->>'max_weight_kg')::numeric,
             requires_observer = coalesce((d->>'requires_observer')::boolean, false),
             requires_access_control = coalesce((d->>'requires_access_control')::boolean, false),
             conditions_text = d->>'conditions_text', source = coalesce(d->>'source', 'manual'),
             external_ref = coalesce(nullif(d->'external_ref', 'null'::jsonb), '{}'::jsonb),
             current_version = new.version_no, updated_at = new.created_at
       where id = new.entity_id;
    else
      update permit_registrations set voided_at = new.created_at, current_version = new.version_no, updated_at = new.created_at
       where id = new.entity_id;
    end if;

  elsif new.entity_type = 'incident_record' then
    if new.op = 'create' then
      insert into incident_records (id, org_id, kind, occurred_at, phase, place_name, latitude, longitude, plan_id, snapshot_id,
                                    flight_record_id, aircraft_id, pilot_id, event_types, people_injury, aircraft_damage,
                                    injured_count, contacts_made, summary, details, factors_note, actions_taken, prevention_note,
                                    detail_pending, source, follow_up_status, follow_up_on, guidance_level, guidance_revision,
                                    client_request_id, current_version, created_at, updated_at)
      values (new.entity_id, new.org_id, d->>'kind', ops_jst_minute_to_timestamptz(d->>'occurred_at'), d->>'phase', d->>'place_name',
              (d->>'latitude')::numeric, (d->>'longitude')::numeric, (d->>'plan_id')::uuid, (d->>'snapshot_id')::uuid,
              (d->>'flight_record_id')::uuid, (d->>'aircraft_id')::uuid, (d->>'pilot_id')::uuid, d->'event_types',
              d->>'people_injury', d->>'aircraft_damage', (d->>'injured_count')::integer,
              coalesce(nullif(d->'contacts_made', 'null'::jsonb), '[]'::jsonb), d->>'summary', d->>'details', d->>'factors_note',
              d->>'actions_taken', d->>'prevention_note', coalesce((d->>'detail_pending')::boolean, false), d->>'source',
              coalesce(d->>'follow_up_status', 'open'), (d->>'follow_up_on')::date, d->>'guidance_level',
              (d->>'guidance_revision')::integer, (d->>'client_request_id')::uuid,
              new.version_no, new.created_at, new.created_at);
    elsif new.op = 'update' then
      update incident_records
         set kind = d->>'kind', occurred_at = ops_jst_minute_to_timestamptz(d->>'occurred_at'), phase = d->>'phase',
             place_name = d->>'place_name', latitude = (d->>'latitude')::numeric, longitude = (d->>'longitude')::numeric,
             plan_id = (d->>'plan_id')::uuid, snapshot_id = (d->>'snapshot_id')::uuid,
             flight_record_id = (d->>'flight_record_id')::uuid, aircraft_id = (d->>'aircraft_id')::uuid,
             pilot_id = (d->>'pilot_id')::uuid, event_types = d->'event_types', people_injury = d->>'people_injury',
             aircraft_damage = d->>'aircraft_damage', injured_count = (d->>'injured_count')::integer,
             contacts_made = coalesce(nullif(d->'contacts_made', 'null'::jsonb), '[]'::jsonb), summary = d->>'summary',
             details = d->>'details', factors_note = d->>'factors_note', actions_taken = d->>'actions_taken',
             prevention_note = d->>'prevention_note', detail_pending = coalesce((d->>'detail_pending')::boolean, false),
             source = d->>'source', follow_up_status = coalesce(d->>'follow_up_status', 'open'),
             follow_up_on = (d->>'follow_up_on')::date, guidance_level = d->>'guidance_level',
             guidance_revision = (d->>'guidance_revision')::integer, client_request_id = (d->>'client_request_id')::uuid,
             current_version = new.version_no, updated_at = new.created_at
       where id = new.entity_id;
    else
      update incident_records set voided_at = new.created_at, current_version = new.version_no, updated_at = new.created_at
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

-- 0015 の verify_record_chain に、incident_record の表の対応を加える（起きた日時は版の data と同じ日本時間の `YYYY-MM-DDTHH:MM` にして比べる）。
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
               when 'permit_registration' then 'permit_registrations'
               when 'incident_record' then 'incident_records'
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
  elsif p_entity_type = 'incident_record' then
    select to_jsonb(t) || jsonb_build_object('occurred_at', ops_timestamptz_to_jst_minute(t.occurred_at))
      into v_head from incident_records t where t.id = p_entity_id;
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
-- incident_records は参照だけ（書くのは record_versions への追加→トリガー）。incident_report_records は参照と追加だけ。
-- どちらにも更新・削除・TRUNCATE を与えない。verify_incident_report_records は実行させない（public から外した）。
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'soraban_app') then
    grant select on incident_records to soraban_app;
    revoke insert, update, delete, truncate on incident_records from soraban_app;
    grant select, insert on incident_report_records to soraban_app;
    revoke update, delete, truncate on incident_report_records from soraban_app;
  end if;
end
$$;
