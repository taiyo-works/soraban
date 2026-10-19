-- =============================================================
-- Soraban / Sprint 10: 版の履歴（共通の版テーブルとハッシュ連鎖）
-- =============================================================
-- 版の表（record_versions）を正とし、ヘッド表（members・aircraft・pilots）は版の追加から DB が作る。
-- アプリ用ロール soraban_app は record_versions に追加できるだけで、ヘッド表を直接書けない。
-- 上書き・物理削除はしない。訂正は新しい版（update）、取消は void の版として追記する。
--
-- - 追加前のトリガー：同じ実体の版を pg_advisory_xact_lock で直列化し、version_no・created_at・prev_hash・
--   content_hash を DB が決める（アプリが送った値は使わない）。
--   楽観的排他：トランザクション内で set_config('soraban.expected_version', '<版番号>', true) を設定すると、
--   最新の版番号と違う場合に SQLSTATE SB409（version_conflict）で失敗する。
-- - 追加後のトリガー：data からヘッド表の行を作る・更新する。void はヘッド表の voided_at を埋める。
--   ヘッド表の制約に反すれば版の追加ごと失敗する。
-- - content_hash の計算規則は packages/db/README.md「版の履歴」に書く（Sprint 15 の出力の照合で使う）。
-- - 独自の SQLSTATE：SB404（実体がない・他の組織）、SB409（版の競合・取消済み・最後の運航管理者）。
-- =============================================================

create table record_versions (
  id bigint generated always as identity primary key,
  org_id uuid not null references organizations(id),
  entity_type text not null check (entity_type in ('member', 'aircraft', 'pilot')),
  entity_id uuid not null,
  version_no integer not null check (version_no >= 1),
  op text not null check (op in ('create', 'update', 'void')),
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  reason text check (reason is null or length(reason) <= 500),
  actor_kind text not null check (actor_kind in ('member', 'system')),
  actor_member_id uuid references members(id),
  created_at timestamptz not null,
  prev_hash text not null,
  content_hash text not null,
  unique (entity_type, entity_id, version_no),
  check (op = 'create' or (reason is not null and length(btrim(reason)) > 0)),
  check ((actor_kind = 'member') = (actor_member_id is not null))
);

create index idx_record_versions_org_entity on record_versions (org_id, entity_type, entity_id);

comment on table record_versions is
  '版の履歴（Sprint 10）。追加のみ。version_no・created_at・prev_hash・content_hash は追加前のトリガーが決める。';
comment on column record_versions.data is 'その版の全項目（ヘッド表の列名をキーにした jsonb）。';
comment on column record_versions.actor_kind is 'member 利用者の操作／system 初回ログインの結び付け・ops_bootstrap 等';

-- ---- ハッシュ ------------------------------------------------

-- 版の内容のハッシュ。入力は jsonb の配列の文字列表現（UTF-8）、出力は SHA-256 の 16 進小文字。
create or replace function record_version_hash(
  p_prev_hash text,
  p_entity_type text,
  p_entity_id uuid,
  p_version_no integer,
  p_op text,
  p_data jsonb,
  p_reason text,
  p_actor_kind text,
  p_actor_member_id uuid,
  p_created_at timestamptz
) returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select encode(
    sha256(convert_to(
      jsonb_build_array(
        'soraban-record-v1',
        p_prev_hash,
        p_entity_type,
        p_entity_id::text,
        p_version_no,
        p_op,
        p_data,
        p_reason,
        p_actor_kind,
        p_actor_member_id::text,
        to_char(p_created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
      )::text,
      'UTF8'
    )),
    'hex'
  )
$$;

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
begin
  perform pg_advisory_xact_lock(hashtextextended('record_versions:' || new.entity_type || ':' || new.entity_id::text, 0));
  if new.entity_type = 'member' then
    -- 最後の運航管理者の判定を組織単位で直列化する
    perform pg_advisory_xact_lock(hashtextextended('members_org:' || new.org_id::text, 0));
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

  new.created_at := clock_timestamp();
  new.content_hash := record_version_hash(
    new.prev_hash, new.entity_type, new.entity_id, new.version_no, new.op, new.data,
    new.reason, new.actor_kind, new.actor_member_id, new.created_at
  );
  return new;
end;
$$;

create trigger record_versions_before_insert
  before insert on record_versions
  for each row execute function record_versions_before_insert();

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
  end if;
  return null;
end;
$$;

create trigger record_versions_after_insert
  after insert on record_versions
  for each row execute function record_versions_after_insert();

-- ---- 検証 ----------------------------------------------------

-- 連番の欠け、prev_hash のつながり、content_hash の再計算の不一致がある版を返す（改変がなければ 0 行）。
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
  end loop;
end;
$$;

-- ---- 最初の運航管理者 ----------------------------------------

-- 本番の準備でオーナーロールが 1 回実行する（Neon の SQL Editor）。組織が無ければ作り、招待中の運航管理者を 1 人登録する。
-- 有効または招待中の運航管理者が既にいる組織では何もしない。soraban_app には実行権限を与えない。
create or replace function ops_bootstrap(p_org_name text, p_email text, p_display_name text)
returns uuid
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_email text := lower(btrim(p_email));
begin
  select id into v_org from organizations where name = btrim(p_org_name);
  if v_org is null then
    insert into organizations (name) values (btrim(p_org_name)) returning id into v_org;
  end if;
  if exists (
    select 1 from members
     where org_id = v_org and role = 'manager' and status in ('active', 'invited') and voided_at is null
  ) then
    raise notice 'ops_bootstrap: 運航管理者が既にいるため何もしません';
    return v_org;
  end if;
  insert into record_versions (org_id, entity_type, entity_id, op, data, reason, actor_kind, actor_member_id,
                               version_no, created_at, prev_hash, content_hash)
  values (v_org, 'member', gen_random_uuid(), 'create',
          jsonb_build_object('email', v_email, 'display_name', btrim(p_display_name), 'role', 'manager',
                             'status', 'invited', 'auth_provider', null, 'auth_user_id', null),
          null, 'system', null, 0, now(), '', '');
  return v_org;
end;
$$;

revoke execute on function ops_bootstrap(text, text, text) from public;
revoke execute on function verify_record_chain(text, uuid) from public;

-- ---- アプリ用ロールの権限 -----------------------------------
-- record_versions は参照と追加だけ。ヘッド表と organizations は参照だけ。どの表にも更新・削除・TRUNCATE を与えない。
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'soraban_app') then
    grant usage on schema public to soraban_app;
    grant select, insert on record_versions to soraban_app;
    grant select on organizations, members, aircraft, pilots to soraban_app;
    revoke update, delete, truncate on record_versions from soraban_app;
    revoke insert, update, delete, truncate on organizations, members, aircraft, pilots from soraban_app;
  end if;
end
$$;
