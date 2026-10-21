-- =============================================================
-- Soraban / Sprint 12c: 現場の事実の記録（flight_field_events。追記専用）
-- =============================================================
-- 飛行前の確認（check）・離陸（takeoff）・着陸（landing）・取り消す（undo）・日誌との結び付き（journal_linked）を、
-- 1 回のタップ = 1 行で残す。離陸・着陸・確認は「その時刻にあった事実」で、訂正して版を重ねるものではない。誤りは
-- 「取り消す」（undo の行）で戻す。record_versions（版の履歴）は使わない。
--
-- - 追記専用：更新・削除・TRUNCATE は、権限を持つオーナーロールでも拒む（reject_append_only_change。SQLSTATE SB409、
--   detail immutable。judgement_snapshots・plan_confirmations・flight_report_attempts・plan_procedure_records と同じ作法）。
--   アプリ用ロール soraban_app には参照と追加だけを与える。
-- - 追加前のトリガーが決める列（アプリが送った値は使わない）：snapshot_id・plan_version（計画の現在のスナップショットと版）、
--   recorded_by_name・recorded_by_role（その時点の表示名・役割の写し）、recorded_at（DB の時刻）、content_hash。
-- - 状態の整合（離陸中に離陸はできない、着陸は開いた離陸が必要、日誌済みの着陸は取り消せない 等）はアプリの遷移の関数
--   （apps/web/src/server/ops/field-logic.ts）が 1 か所で決める。DB は列の整合（CHECK）・組織と計画の検査・指す行の種別の検査だけを持つ。
--   二重の離陸を並行リクエストですり抜けられないよう、サービス層は計画ごとの pg_advisory_xact_lock の下で検査して書く。
-- - 冪等性：(org_id, client_event_id) は一意。同じ識別子の再送は、アプリが同じ内容なら既存の行を返す。
-- - 既存のテーブルは列を変えない。journal_linked が指す飛行記録・日常点検の複合外部キーのために、flight_records と
--   daily_inspections に一意制約（id を含む組。常に一意なので既存の行・動作に影響しない）だけを足す。
-- - 追記のみ。適用済みのマイグレーション（0001〜0013）は変えない。
-- =============================================================

-- ---- 複合外部キーの受け皿（一意制約。列は増やさない） ------------

alter table daily_inspections add constraint uq_daily_inspections_id_org unique (id, org_id);
alter table flight_records add constraint uq_flight_records_id_plan_org unique (id, flight_plan_id, org_id);

-- ---- 現場の事実の記録（追記専用） ---------------------------------

create table flight_field_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  plan_id uuid not null,
  -- check：飛行前の確認／takeoff：離陸／landing：着陸／undo：取り消す／journal_linked：日誌（飛行記録）との結び付き
  kind text not null check (kind in ('check', 'takeoff', 'landing', 'undo', 'journal_linked')),
  -- check のとき必須。inspection は日常点検、emergency_airspace は緊急用務空域、report_recheck は通報済みの再確認、carry は携行品
  item text check (item is null or item in ('inspection', 'emergency_airspace', 'report_recheck', 'carry')),
  -- emergency_airspace は not_designated／designated、他の項目は done
  result text check (result is null or result in ('done', 'not_designated', 'designated')),
  -- 緊急用務空域の確認元（アプリの選択肢の ID）。emergency_airspace は必須
  source text check (source is null or length(source) <= 100),
  -- landing は対応する takeoff、undo は取り消す行、journal_linked は結び付けた takeoff（同じ計画・組織の行だけ）
  target_event_id uuid,
  flight_record_id uuid,
  inspection_id uuid,
  report_id uuid,
  -- 事実の時刻（1 分単位）。端末の時計を元にするが、サーバーが範囲を検査する
  occurred_at timestamptz not null check (occurred_at = date_trunc('minute', occurred_at)),
  -- 記録した時点の計画の現在のスナップショットと版（追加前のトリガーが入れる）
  snapshot_id uuid not null,
  plan_version integer not null check (plan_version >= 1),
  -- takeoff だけ：離陸の時点の未了事項の写し（アプリが導出して入れる。[{"item": "...", "state": "..."}]）
  gaps jsonb check (gaps is null or jsonb_typeof(gaps) = 'array'),
  note text check (note is null or length(note) <= 300),
  -- 端末に保存してから送ったか（送信待ちの経由か）。表示に使う
  queued boolean not null default false,
  client_event_id uuid not null,
  recorded_by_member_id uuid not null references members(id),
  -- その時点の表示名・役割の写し（追加前のトリガーが利用者の行から写す）
  recorded_by_name text not null check (length(btrim(recorded_by_name)) between 1 and 100),
  recorded_by_role text not null check (recorded_by_role in ('manager', 'pilot', 'viewer')),
  recorded_at timestamptz not null,
  content_hash text not null,
  constraint uq_flight_field_events_client_event unique (org_id, client_event_id),
  constraint uq_flight_field_events_id_plan_org unique (id, plan_id, org_id),
  foreign key (plan_id, org_id) references flight_plans (id, org_id),
  foreign key (snapshot_id, plan_id, org_id) references judgement_snapshots (id, plan_id, org_id),
  foreign key (target_event_id, plan_id, org_id) references flight_field_events (id, plan_id, org_id),
  foreign key (flight_record_id, plan_id, org_id) references flight_records (id, flight_plan_id, org_id),
  foreign key (inspection_id, org_id) references daily_inspections (id, org_id),
  foreign key (report_id, plan_id, org_id) references flight_reports (id, plan_id, org_id),
  -- 種別ごとの必須の列
  constraint flight_field_events_check_cols check (
    kind <> 'check'
    or (
      item is not null
      and result is not null
      and (
        (item = 'emergency_airspace' and result in ('not_designated', 'designated') and source is not null and length(btrim(source)) > 0)
        or (item <> 'emergency_airspace' and result = 'done')
      )
    )
  ),
  constraint flight_field_events_noncheck_cols check (
    kind = 'check' or (item is null and result is null and source is null)
  ),
  constraint flight_field_events_target_cols check (
    (kind in ('landing', 'undo', 'journal_linked') and target_event_id is not null)
    or (kind in ('check', 'takeoff') and target_event_id is null)
  ),
  constraint flight_field_events_journal_cols check (
    (kind = 'journal_linked' and flight_record_id is not null) or (kind <> 'journal_linked' and flight_record_id is null)
  ),
  constraint flight_field_events_inspection_cols check (
    inspection_id is null or (kind = 'check' and item = 'inspection')
  ),
  constraint flight_field_events_report_cols check (
    report_id is null or (kind = 'check' and item = 'report_recheck')
  ),
  constraint flight_field_events_gaps_cols check (
    (kind = 'takeoff' and gaps is not null) or (kind <> 'takeoff' and gaps is null)
  )
);

create index idx_flight_field_events_plan on flight_field_events (org_id, plan_id, recorded_at, id);
-- 今日の画面が、飛行中・日誌待ちの計画を拾うために離陸の行をさかのぼる（事実の時刻で数える）
create index idx_flight_field_events_takeoff on flight_field_events (org_id, occurred_at) where kind = 'takeoff';
create index idx_flight_field_events_flight_record on flight_field_events (org_id, flight_record_id) where flight_record_id is not null;
-- 同じ行を 2 回取り消せない（二重の undo を DB も拒む）
create unique index uq_flight_field_events_undo_target on flight_field_events (target_event_id) where kind = 'undo';

comment on table flight_field_events is
  '現場の事実の記録（Sprint 12c）。追記専用。飛行前の確認・離陸・着陸・取り消す・日誌との結び付きを 1 タップ = 1 行で残す。状態は行から毎回導出し、保存しない。';
comment on column flight_field_events.occurred_at is '事実の時刻（1 分単位）。端末の時計を元にし、サーバーが範囲を検査する。計画の予定時刻は入れない。';
comment on column flight_field_events.gaps is '離陸の時点の未了事項の写し（takeoff だけ）。アプリが導出して入れる。';

create trigger flight_field_events_no_update_delete
  before update or delete on flight_field_events
  for each row execute function reject_append_only_change();

create trigger flight_field_events_no_truncate
  before truncate on flight_field_events
  for each statement execute function reject_append_only_change();

-- 記録の内容のハッシュ（soraban-field-event-v1）。入力は jsonb の配列の文字列表現（UTF-8）、出力は SHA-256 の 16 進小文字。
create or replace function flight_field_event_hash(
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
  p_recorded_at timestamptz
) returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select encode(
    sha256(convert_to(
      jsonb_build_array(
        'soraban-field-event-v1',
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
        to_char(p_recorded_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
      )::text,
      'UTF8'
    )),
    'hex'
  )
$$;

-- 追加前のトリガー：計画・利用者の検査と、snapshot_id・plan_version・recorded_by_name・recorded_by_role・recorded_at・content_hash の決定
-- （アプリが送った値は使わない）。
--   SB404 計画・利用者が同じ組織にない
--   SB409 plan_cancelled（取消した計画への check・takeoff。開いている離陸の着陸・undo・日誌との結び付きは取消後も記録できる）／
--         invalid_target（landing・journal_linked が takeoff でない行を指す、undo が check・takeoff・landing 以外を指す）
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
  -- 計画の版の追加・計画ごとの現場の記録と直列化する（アプリの検査と同じ排他）
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
  new.content_hash := flight_field_event_hash(
    new.id, new.org_id, new.plan_id, new.kind, new.item, new.result, new.source, new.target_event_id, new.flight_record_id,
    new.inspection_id, new.report_id, new.occurred_at, new.snapshot_id, new.plan_version, new.gaps, new.note, new.queued,
    new.client_event_id, new.recorded_by_member_id, new.recorded_by_name, new.recorded_by_role, new.recorded_at
  );
  return new;
end;
$$;

create trigger flight_field_events_before_insert
  before insert on flight_field_events
  for each row execute function flight_field_events_before_insert();

-- ---- アプリ用ロールの権限 -----------------------------------
-- flight_field_events は参照と追加だけ。更新・削除・TRUNCATE は与えない。
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'soraban_app') then
    grant select, insert on flight_field_events to soraban_app;
    revoke update, delete, truncate on flight_field_events from soraban_app;
  end if;
end
$$;
