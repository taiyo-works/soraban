-- =============================================================
-- Soraban / Sprint 12b: 通報の試行・監査（flight_report_attempts）、手続きの「済み」の記録（plan_procedure_records）
-- =============================================================
-- どちらも追記専用。更新・削除・TRUNCATE は、権限を持つオーナーロールでも拒む（reject_append_only_change。SQLSTATE SB409、
-- detail immutable。judgement_snapshots・plan_confirmations と同じ作法）。アプリ用ロール soraban_app には参照と追加だけを与える。
--
-- - flight_report_attempts：ゲートウェイの操作 1 回ごとに 1 行（コピー・記録・訂正・取り下げ・結果不明の確定・送信・取消・状況）。
--   「誰が（利用者の ID と、その時点の表示名・役割の写し）・いつ（DB の時刻）・何を（操作・冪等性キー・内容のハッシュと要約・
--   対応表の版・証跡 ID）・どこへ（アダプター）・結果」を残す。秘密・トークン・技能証明書番号・氏名・内容の全文は入れない。
--   member_name・member_role・created_at は追加前のトリガーが決める（アプリが送った値は使わない）。
-- - plan_procedure_records：許可・承認の申請（dips_permit）と、小型無人機等飛行禁止法の同意・通報（small_drone_law）の
--   「済み」の記録（利用者の申告）。done はすべての確認が真のときだけ（CHECK）。取り下げ（retract）も理由つきの行として残る。
--   有効な記録は、計画ごと・種別ごとの最新の行が done のもの。recorded_by_name・created_at・content_hash は追加前のトリガーが決める。
--   content_hash の規則は soraban-procedure-record-v1（packages/db/README.md）。
-- - 追記のみ。適用済みのマイグレーション（0001〜0012）は変えない。
-- =============================================================

-- ---- 通報の試行・監査（追記専用） ----------------------------

create table flight_report_attempts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  plan_id uuid not null,
  report_id uuid,
  operation text not null check (operation in ('copy', 'submit', 'status', 'cancel', 'manual_record', 'correct', 'retract', 'resolve')),
  member_id uuid not null references members(id),
  -- その時点の表示名・役割の写し（追加前のトリガーが利用者の行から写す）
  member_name text not null check (length(btrim(member_name)) between 1 and 100),
  member_role text not null check (member_role in ('manager', 'pilot', 'viewer')),
  adapter text not null check (adapter in ('manual', 'mock', 'api')),
  idempotency_key text check (idempotency_key is null or length(idempotency_key) between 8 and 128),
  -- 送った・記録した内容の SHA-256 と、短い要約（内容の全文は入れない）
  payload_hash text check (payload_hash is null or payload_hash ~ '^[0-9a-f]{64}$'),
  summary text check (summary is null or length(summary) <= 500),
  map_revision integer check (map_revision is null or map_revision >= 1),
  check_evidence_id text check (check_evidence_id is null or length(check_evidence_id) <= 200),
  diagnosis_evidence_id text check (diagnosis_evidence_id is null or length(diagnosis_evidence_id) <= 200),
  result text not null check (result in ('success', 'failure', 'unknown')),
  http_status integer check (http_status is null or http_status between 100 and 599),
  error_kind text check (error_kind is null or length(error_kind) <= 50),
  dips_number text check (dips_number is null or length(dips_number) <= 50),
  created_at timestamptz not null,
  foreign key (plan_id, org_id) references flight_plans (id, org_id),
  foreign key (report_id, plan_id, org_id) references flight_reports (id, plan_id, org_id)
);

create index idx_flight_report_attempts_plan on flight_report_attempts (org_id, plan_id, created_at);

comment on table flight_report_attempts is
  '通報の試行・監査（Sprint 12b）。追記専用。ゲートウェイの操作 1 回ごとに 1 行。秘密・トークン・技能証明書番号・氏名・内容の全文は入れない。';

create trigger flight_report_attempts_no_update_delete
  before update or delete on flight_report_attempts
  for each row execute function reject_append_only_change();

create trigger flight_report_attempts_no_truncate
  before truncate on flight_report_attempts
  for each statement execute function reject_append_only_change();

-- 追加前のトリガー：利用者は同じ組織に限る（SB404）。member_name・member_role・created_at は DB が決める。
create or replace function flight_report_attempts_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m members%rowtype;
begin
  select * into m from members where id = new.member_id and org_id = new.org_id;
  if not found then
    raise exception 'member not found' using errcode = 'SB404';
  end if;
  new.member_name := m.display_name;
  new.member_role := m.role;
  new.created_at := clock_timestamp();
  return new;
end;
$$;

create trigger flight_report_attempts_before_insert
  before insert on flight_report_attempts
  for each row execute function flight_report_attempts_before_insert();

-- ---- 手続きの「済み」の記録（追記専用） ----------------------

create table plan_procedure_records (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  plan_id uuid not null,
  -- dips_permit：許可・承認の申請／small_drone_law：飛行禁止法の同意と公安委員会への通報
  kind text not null check (kind in ('dips_permit', 'small_drone_law')),
  action text not null check (action in ('done', 'retract')),
  -- done のときの日時（日本時間の分）
  done_at timestamptz check (done_at is null or done_at = date_trunc('minute', done_at)),
  -- 申請受付番号など（任意）
  reference text check (reference is null or length(reference) <= 100),
  -- 確認の項目。done はすべて真（CHECK）。retract は空のオブジェクト
  checks jsonb not null check (jsonb_typeof(checks) = 'object'),
  -- 記録した時点の計画の現在のスナップショットと版
  snapshot_id uuid not null,
  plan_version integer not null check (plan_version >= 1),
  recorded_by_member_id uuid not null references members(id),
  -- その時点の表示名の写し（追加前のトリガーが利用者の行から写す）
  recorded_by_name text not null check (length(btrim(recorded_by_name)) between 1 and 100),
  reason text check (reason is null or length(reason) <= 500),
  created_at timestamptz not null,
  content_hash text not null,
  constraint plan_procedure_records_done_check check (action <> 'done' or done_at is not null),
  constraint plan_procedure_records_retract_check check (action <> 'retract' or (reason is not null and length(btrim(reason)) > 0)),
  -- done はすべての確認が真のときだけ
  constraint plan_procedure_records_all_checked check (
    action <> 'done'
    or (kind = 'dips_permit' and checks = '{"applicationCompleted": true}'::jsonb)
    or (kind = 'small_drone_law' and checks = '{"facilityConsentObtained": true, "policeNoticeDone": true}'::jsonb)
  ),
  foreign key (plan_id, org_id) references flight_plans (id, org_id),
  foreign key (snapshot_id, plan_id, org_id) references judgement_snapshots (id, plan_id, org_id)
);

create index idx_plan_procedure_records_plan on plan_procedure_records (org_id, plan_id, kind, created_at);

comment on table plan_procedure_records is
  '手続きの「済み」の記録（Sprint 12b）。追記専用。利用者の申告であり、許可・承認が下りたことを示すものではない。有効な記録は、計画ごと・種別ごとの最新の行が done のもの。';

create trigger plan_procedure_records_no_update_delete
  before update or delete on plan_procedure_records
  for each row execute function reject_append_only_change();

create trigger plan_procedure_records_no_truncate
  before truncate on plan_procedure_records
  for each statement execute function reject_append_only_change();

-- 記録の内容のハッシュ（soraban-procedure-record-v1）。入力は jsonb の配列の文字列表現（UTF-8）、出力は SHA-256 の 16 進小文字。
create or replace function plan_procedure_record_hash(
  p_id uuid,
  p_org_id uuid,
  p_plan_id uuid,
  p_kind text,
  p_action text,
  p_done_at timestamptz,
  p_reference text,
  p_checks jsonb,
  p_snapshot_id uuid,
  p_plan_version integer,
  p_recorded_by_member_id uuid,
  p_recorded_by_name text,
  p_reason text,
  p_created_at timestamptz
) returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select encode(
    sha256(convert_to(
      jsonb_build_array(
        'soraban-procedure-record-v1',
        p_id::text,
        p_org_id::text,
        p_plan_id::text,
        p_kind,
        p_action,
        to_char(p_done_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        p_reference,
        p_checks,
        p_snapshot_id::text,
        p_plan_version,
        p_recorded_by_member_id::text,
        p_recorded_by_name,
        p_reason,
        to_char(p_created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
      )::text,
      'UTF8'
    )),
    'hex'
  )
$$;

-- 追加前のトリガー：計画・利用者の検査と、recorded_by_name・created_at・content_hash の決定（アプリが送った値は使わない）。
--   SB404 計画・利用者が同じ組織にない
--   SB409 voided（取消した計画への done）／snapshot_mismatch（計画の現在のスナップショットと違う done）／
--         version_conflict（計画の最新の版と違う done）／nothing_to_retract（有効な記録がない retract）
create or replace function plan_procedure_records_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  p flight_plans%rowtype;
  m members%rowtype;
  v_latest_action text;
begin
  -- 計画の版の追加と、同じ計画の記録を直列化する
  perform pg_advisory_xact_lock(hashtextextended('record_versions:flight_plan:' || new.plan_id::text, 0));

  select * into p from flight_plans where id = new.plan_id and org_id = new.org_id;
  if not found then
    raise exception 'plan not found' using errcode = 'SB404';
  end if;
  select * into m from members where id = new.recorded_by_member_id and org_id = new.org_id;
  if not found then
    raise exception 'member not found' using errcode = 'SB404';
  end if;

  if new.action = 'done' then
    if p.voided_at is not null then
      raise exception 'plan is voided' using errcode = 'SB409', detail = 'voided';
    end if;
    if new.snapshot_id is distinct from p.current_snapshot_id then
      raise exception 'snapshot mismatch' using errcode = 'SB409', detail = 'snapshot_mismatch';
    end if;
    if new.plan_version <> p.current_version then
      raise exception 'version conflict' using errcode = 'SB409', detail = 'version_conflict';
    end if;
  else
    select r.action into v_latest_action
      from plan_procedure_records r
     where r.plan_id = new.plan_id and r.org_id = new.org_id and r.kind = new.kind
     order by r.created_at desc, r.id desc
     limit 1;
    if v_latest_action is distinct from 'done' then
      raise exception 'nothing to retract' using errcode = 'SB409', detail = 'nothing_to_retract';
    end if;
  end if;

  new.recorded_by_name := m.display_name;
  new.created_at := clock_timestamp();
  new.content_hash := plan_procedure_record_hash(
    new.id, new.org_id, new.plan_id, new.kind, new.action, new.done_at, new.reference, new.checks, new.snapshot_id,
    new.plan_version, new.recorded_by_member_id, new.recorded_by_name, new.reason, new.created_at
  );
  return new;
end;
$$;

create trigger plan_procedure_records_before_insert
  before insert on plan_procedure_records
  for each row execute function plan_procedure_records_before_insert();

-- ---- アプリ用ロールの権限 -----------------------------------
-- flight_report_attempts・plan_procedure_records は参照と追加だけ。更新・削除・TRUNCATE は与えない。
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'soraban_app') then
    grant select, insert on flight_report_attempts, plan_procedure_records to soraban_app;
    revoke update, delete, truncate on flight_report_attempts, plan_procedure_records from soraban_app;
  end if;
end
$$;
