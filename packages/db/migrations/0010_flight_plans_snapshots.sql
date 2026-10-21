-- =============================================================
-- Soraban / Sprint 12a: 飛行計画・判定スナップショット・よく使う地点（表）
-- =============================================================
-- 判定の結果から「飛行計画」を作り、その時点の判定を不変のスナップショットとして残す（docs/sprints/sprint-12a.md 設計 B）。
--
-- - saved_places（よく使う地点）・flight_plans（飛行計画）は record_versions から DB が作るヘッド表。
--   追加後のトリガー（record_versions の flight_plan・saved_place の分岐）は 0011 で置き換える。
-- - judgement_snapshots は追記専用。seq・prev_hash・content_hash・created_at は追加前のトリガーが決める（アプリが送った値は使わない）。
--   更新・削除・TRUNCATE は、権限を持つオーナーロールでも拒む（SQLSTATE SB409、detail immutable）。
--   計画 ↔ スナップショットは循環するため、遅延可能な複合外部キー（同じ組織・同じ計画に限る）で DB が守る。
-- - flight_records の flight_plan_id・snapshot_id（予約列）に外部キーを足し、別の計画のスナップショットを結べないようにする。
-- - content_hash の計算規則（soraban-snapshot-v1）は packages/db/README.md「判定スナップショット」に書く。
-- - 追記のみ。適用済みのマイグレーション（0001〜0009）は変えない。
-- =============================================================

-- ---- よく使う地点（ヘッド表） --------------------------------

create table saved_places (
  id uuid primary key,
  org_id uuid not null references organizations(id),
  name text not null check (length(btrim(name)) between 1 and 100),
  -- 事業所などの所在地（任意）。個人の住所ではない
  address_text text check (address_text is null or length(address_text) <= 200),
  latitude numeric(9, 6) not null check (latitude between -90 and 90),
  longitude numeric(9, 6) not null check (longitude between -180 and 180),
  note text check (note is null or length(note) <= 200),
  current_version integer not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  voided_at timestamptz,
  unique (id, org_id)
);

-- 名称は取消していないものの中で組織内一意
create unique index uq_saved_places_name on saved_places (org_id, name) where voided_at is null;

comment on table saved_places is
  'よく使う地点（Sprint 12a）。record_versions（entity_type = saved_place）から DB が作るヘッド表。社内拠点などを運航管理者が登録する。';

-- ---- 飛行計画（ヘッド表） ------------------------------------

create table flight_plans (
  id uuid primary key,
  org_id uuid not null references organizations(id),
  title text not null check (length(btrim(title)) between 1 and 100),
  aircraft_id uuid not null references aircraft(id),
  pilot_id uuid not null references pilots(id),
  -- 予定開始（JST の分単位。flight_records と同じ時刻の扱い）
  planned_start_at timestamptz not null check (planned_start_at = date_trunc('minute', planned_start_at)),
  duration_minutes integer not null check (duration_minutes between 1 and 1440),
  -- 予定日（JST の日付）。DB が planned_start_at から決める（追加前のトリガーが data に入れる）
  planned_date date not null,
  purpose text not null check (length(btrim(purpose)) between 1 and 100),
  place_name text not null check (length(btrim(place_name)) between 1 and 100),
  latitude numeric(9, 6) not null check (latitude between -90 and 90),
  longitude numeric(9, 6) not null check (longitude between -180 and 180),
  radius_m integer check (radius_m is null or radius_m between 1 and 10000),
  saved_place_id uuid,
  max_altitude_m integer check (max_altitude_m is null or max_altitude_m between 0 and 2000),
  -- 利用者が選んだ飛行の方法・空域のフラグ（SpecificFlightFlag の配列）
  flags jsonb not null default '[]'::jsonb check (jsonb_typeof(flags) = 'array'),
  -- 判定画面と同じ入力（許可・承認の種類、目的の例外、立入管理措置など）
  pilot_permits jsonb not null default '[]'::jsonb check (jsonb_typeof(pilot_permits) = 'array'),
  judgement_purpose text check (judgement_purpose is null or judgement_purpose in ('emergency', 'public_duty', 'city_event')),
  access_control boolean,
  third_party_overflight boolean,
  bvlos_with_observer boolean,
  -- 判定した時点の機体重量（g）の写し
  drone_weight_g integer check (drone_weight_g is null or drone_weight_g >= 0),
  permit_numbers text check (permit_numbers is null or length(permit_numbers) <= 200),
  notes text check (notes is null or length(notes) <= 500),
  status text not null check (status in ('draft', 'active')),
  current_snapshot_id uuid not null,
  client_request_id uuid,
  current_version integer not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  voided_at timestamptz,
  unique (id, org_id),
  check (planned_date = ops_jst_date(planned_start_at))
);

alter table flight_plans
  add constraint flight_plans_saved_place_fk
  foreign key (saved_place_id, org_id) references saved_places (id, org_id);

create index idx_flight_plans_org_date on flight_plans (org_id, planned_start_at desc);
create index idx_flight_plans_org_aircraft on flight_plans (org_id, aircraft_id);
create index idx_flight_plans_org_pilot on flight_plans (org_id, pilot_id);
create unique index uq_flight_plans_request on flight_plans (org_id, client_request_id)
  where client_request_id is not null;

comment on table flight_plans is
  '飛行計画（Sprint 12a）。record_versions（entity_type = flight_plan）から DB が作るヘッド表。保存する状態は draft・active と取消（voided_at）だけ。確認待ち・確認済みなどは plan_confirmations と版から読み出しのたびに求める。';
comment on column flight_plans.current_snapshot_id is
  '現在の判定スナップショット。(current_snapshot_id, id, org_id) は judgement_snapshots(id, plan_id, org_id) への遅延可能な複合外部キー。';
comment on column flight_plans.drone_weight_g is
  '判定した時点の機体重量（登録機体の最大離陸重量 × 1000）の写し。';

-- ---- 判定スナップショット（追記専用） -------------------------

create table judgement_snapshots (
  id uuid primary key,
  org_id uuid not null references organizations(id),
  plan_id uuid not null,
  -- 計画の中での通し番号（1, 2, …）。DB が決める
  seq integer not null check (seq >= 1),
  reason text not null check (reason in ('initial', 'input_changed', 'data_updated', 'manual')),
  -- 判定の入力（正規化済み。設計 A2）
  input jsonb not null check (jsonb_typeof(input) = 'object'),
  -- runDiagnosis の応答そのもの（/api/diagnose の応答と同じ形）
  result jsonb not null check (jsonb_typeof(result) = 'object'),
  -- 一覧用に取り出した値
  verdict_level text not null check (verdict_level in ('no_fly', 'needs_procedure', 'procedure_done', 'no_procedure')),
  verdict_unknown_count integer not null check (verdict_unknown_count >= 0),
  category text not null check (category in ('I', 'needs_verification', 'II_A', 'II_B_eligible', 'III_level4', 'emergency_no_fly')),
  engine_version text not null check (length(engine_version) > 0),
  checked_at timestamptz not null,
  -- 地点判定の証跡 ID。スナップショットを作る同じトランザクションで evidence_log に書く
  check_evidence_id text not null references evidence_log(evidence_id),
  -- 申請支援の証跡 ID（evidence_log には書かれない）
  diagnosis_evidence_id text not null check (length(diagnosis_evidence_id) > 0),
  -- 使ったデータセット（id・名称・基準年・確認日）
  datasets jsonb not null check (jsonb_typeof(datasets) = 'array'),
  procedures_revision integer not null check (procedures_revision >= 1),
  procedures_verified_at text not null,
  created_by_member_id uuid not null references members(id),
  created_at timestamptz not null,
  prev_hash text not null,
  content_hash text not null,
  unique (plan_id, seq),
  unique (id, plan_id, org_id)
);

create index idx_judgement_snapshots_org_plan on judgement_snapshots (org_id, plan_id, seq);

comment on table judgement_snapshots is
  '判定スナップショット（Sprint 12a）。追記専用。seq・prev_hash・content_hash・created_at は追加前のトリガーが決める。更新・削除・TRUNCATE はトリガーが拒む（SB409 immutable）。';
comment on column judgement_snapshots.result is
  'runDiagnosis の応答そのもの。計画の保存時にサーバーが実行した結果で、リクエストの値は使わない。';

-- 循環する外部キー（計画 ↔ スナップショット）。コミット時に検査する
alter table judgement_snapshots
  add constraint judgement_snapshots_plan_fk
  foreign key (plan_id, org_id) references flight_plans (id, org_id)
  deferrable initially deferred;

alter table flight_plans
  add constraint flight_plans_current_snapshot_fk
  foreign key (current_snapshot_id, id, org_id) references judgement_snapshots (id, plan_id, org_id)
  deferrable initially deferred;

-- ---- 追記専用（更新・削除・TRUNCATE を拒む） ------------------

-- オーナーロールでも拒む（権限ではなくトリガーで守る）。plan_confirmations（0011）も使う。
create or replace function reject_append_only_change()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = 'SB409', detail = 'immutable';
end;
$$;

create trigger judgement_snapshots_no_update_delete
  before update or delete on judgement_snapshots
  for each row execute function reject_append_only_change();

create trigger judgement_snapshots_no_truncate
  before truncate on judgement_snapshots
  for each statement execute function reject_append_only_change();

-- ---- ハッシュ ------------------------------------------------

-- スナップショットの内容のハッシュ。入力は jsonb の配列の文字列表現（UTF-8）、出力は SHA-256 の 16 進小文字。
create or replace function judgement_snapshot_hash(
  p_prev_hash text,
  p_id uuid,
  p_org_id uuid,
  p_plan_id uuid,
  p_seq integer,
  p_reason text,
  p_input jsonb,
  p_result jsonb,
  p_verdict_level text,
  p_verdict_unknown_count integer,
  p_category text,
  p_engine_version text,
  p_checked_at timestamptz,
  p_check_evidence_id text,
  p_diagnosis_evidence_id text,
  p_datasets jsonb,
  p_procedures_revision integer,
  p_procedures_verified_at text,
  p_created_by_member_id uuid,
  p_created_at timestamptz
) returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select encode(
    sha256(convert_to(
      jsonb_build_array(
        'soraban-snapshot-v1',
        p_prev_hash,
        p_id::text,
        p_org_id::text,
        p_plan_id::text,
        p_seq,
        p_reason,
        p_input,
        p_result,
        p_verdict_level,
        p_verdict_unknown_count,
        p_category,
        p_engine_version,
        to_char(p_checked_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        p_check_evidence_id,
        p_diagnosis_evidence_id,
        p_datasets,
        p_procedures_revision,
        p_procedures_verified_at,
        p_created_by_member_id::text,
        to_char(p_created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
      )::text,
      'UTF8'
    )),
    'hex'
  )
$$;

-- ---- 追加前のトリガー ---------------------------------------

-- seq・prev_hash・created_at・content_hash を DB が決める（アプリが送った値は使わない）。
-- 計画ごとに pg_advisory_xact_lock で直列化し、同じ計画の直前のスナップショットとハッシュを連鎖させる。
create or replace function judgement_snapshots_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_prev_seq integer;
  v_prev_hash text;
begin
  perform pg_advisory_xact_lock(hashtextextended('judgement_snapshots:' || new.plan_id::text, 0));

  -- 作成者は同じ組織の利用者に限る
  if not exists (select 1 from members where id = new.created_by_member_id and org_id = new.org_id) then
    raise exception 'member not found' using errcode = 'SB404';
  end if;

  select s.seq, s.content_hash
    into v_prev_seq, v_prev_hash
    from judgement_snapshots s
   where s.plan_id = new.plan_id
   order by s.seq desc
   limit 1;

  new.seq := coalesce(v_prev_seq, 0) + 1;
  new.prev_hash := coalesce(v_prev_hash, '');
  new.created_at := clock_timestamp();
  new.content_hash := judgement_snapshot_hash(
    new.prev_hash, new.id, new.org_id, new.plan_id, new.seq, new.reason, new.input, new.result,
    new.verdict_level, new.verdict_unknown_count, new.category, new.engine_version, new.checked_at,
    new.check_evidence_id, new.diagnosis_evidence_id, new.datasets, new.procedures_revision,
    new.procedures_verified_at, new.created_by_member_id, new.created_at
  );
  return new;
end;
$$;

create trigger judgement_snapshots_before_insert
  before insert on judgement_snapshots
  for each row execute function judgement_snapshots_before_insert();

-- ---- 検証 ----------------------------------------------------

-- 計画のスナップショットの連鎖を検証する。問題のあるスナップショットの seq（計画に関する問題は最後の seq、無ければ 0）を返す。
-- 改変がなければ 0 行。DB 移行の前後の検証にも使う（docs/spec.md §13.8.1）。
--   missing_seq             連番の欠け
--   prev_hash_mismatch      prev_hash が直前のスナップショットの content_hash と一致しない
--   content_hash_mismatch   content_hash の再計算が一致しない
--   head_snapshot_missing   計画の current_snapshot_id のスナップショットが無い
--   head_snapshot_not_latest 計画の current_snapshot_id が最新のスナップショットでない
-- 限界：オーナーロールが最新から後ろを全部作り直した改変は検出できない（外部の控えは Sprint 15 で検討）。
create or replace function verify_judgement_snapshots(p_plan_id uuid)
returns table (seq integer, problem text)
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  r record;
  v_expected integer := 1;
  v_prev text := '';
  v_last_seq integer := 0;
  v_last_id uuid;
  v_head_snapshot uuid;
  v_head_exists boolean := false;
begin
  for r in
    select * from judgement_snapshots s where s.plan_id = p_plan_id order by s.seq
  loop
    if r.seq <> v_expected then
      seq := r.seq; problem := 'missing_seq'; return next;
    end if;
    if r.prev_hash <> v_prev then
      seq := r.seq; problem := 'prev_hash_mismatch'; return next;
    end if;
    if r.content_hash <> judgement_snapshot_hash(
         r.prev_hash, r.id, r.org_id, r.plan_id, r.seq, r.reason, r.input, r.result,
         r.verdict_level, r.verdict_unknown_count, r.category, r.engine_version, r.checked_at,
         r.check_evidence_id, r.diagnosis_evidence_id, r.datasets, r.procedures_revision,
         r.procedures_verified_at, r.created_by_member_id, r.created_at
       ) then
      seq := r.seq; problem := 'content_hash_mismatch'; return next;
    end if;
    v_expected := r.seq + 1;
    v_prev := r.content_hash;
    v_last_seq := r.seq;
    v_last_id := r.id;
  end loop;

  select p.current_snapshot_id, true into v_head_snapshot, v_head_exists from flight_plans p where p.id = p_plan_id;
  if v_head_exists then
    if not exists (select 1 from judgement_snapshots s where s.plan_id = p_plan_id and s.id = v_head_snapshot) then
      seq := v_last_seq; problem := 'head_snapshot_missing'; return next;
    elsif v_head_snapshot is distinct from v_last_id then
      seq := v_last_seq; problem := 'head_snapshot_not_latest'; return next;
    end if;
  end if;
end;
$$;

revoke execute on function verify_judgement_snapshots(uuid) from public;

-- ---- 飛行記録との紐付け（予約列に外部キー） ------------------

-- 同じ組織の計画だけ、その計画のスナップショットだけを結べる。NULL のときは検査しない（MATCH SIMPLE）。
alter table flight_records
  add constraint flight_records_plan_fk
  foreign key (flight_plan_id, org_id) references flight_plans (id, org_id);

alter table flight_records
  add constraint flight_records_snapshot_fk
  foreign key (snapshot_id, flight_plan_id, org_id) references judgement_snapshots (id, plan_id, org_id);

-- スナップショットだけで計画なし、は許さない（MATCH SIMPLE の検査抜けを防ぐ）
alter table flight_records
  add constraint flight_records_snapshot_needs_plan
  check (snapshot_id is null or flight_plan_id is not null);

-- ---- アプリ用ロールの権限 -----------------------------------
-- judgement_snapshots は参照と追加だけ。flight_plans・saved_places は参照だけ（書くのは record_versions への追加→トリガー）。
-- どの表にも更新・削除・TRUNCATE を与えない。
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'soraban_app') then
    grant select, insert on judgement_snapshots to soraban_app;
    revoke update, delete, truncate on judgement_snapshots from soraban_app;
    grant select on flight_plans, saved_places to soraban_app;
    revoke insert, update, delete, truncate on flight_plans, saved_places from soraban_app;
  end if;
end
$$;
