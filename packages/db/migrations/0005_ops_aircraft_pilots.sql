-- =============================================================
-- Soraban / Sprint 10: 機体と操縦者（ヘッド表）
-- =============================================================
-- 項目は「無人航空機の飛行日誌の取扱要領」（令和4年12月1日制定）の記載事項に合わせる
-- （docs/sprints/sprint-10.md 設計 D）。どちらも record_versions（0006）への追加から DB が作る。
-- 物理削除はしない。取消は voided_at を埋める（行は残る）。
-- =============================================================

create table aircraft (
  id uuid primary key,
  org_id uuid not null references organizations(id),
  -- 登録記号（英大文字に正規化。JU で始まる英数字。桁数は未確認のため検査しない）
  registration_mark text not null check (registration_mark ~ '^JU[A-Z0-9]+$' and length(registration_mark) <= 20),
  model_name text not null check (length(btrim(model_name)) between 1 and 100),
  manufacturer text not null check (length(btrim(manufacturer)) between 1 and 100),
  serial_number text not null check (length(btrim(serial_number)) between 1 and 100),
  type_certified boolean not null,
  type_cert_category text,
  type_cert_model text,
  type_cert_number text,
  airworthiness_class text check (airworthiness_class is null or airworthiness_class in ('first', 'second')),
  airworthiness_cert_number text,
  max_takeoff_weight_kg numeric(7, 1) check (max_takeoff_weight_kg is null or max_takeoff_weight_kg > 0),
  -- 使用開始時点の既存の総飛行時間（分）。累計は Sprint 11
  initial_flight_minutes integer not null default 0 check (initial_flight_minutes >= 0),
  status text not null check (status in ('active', 'suspended', 'deregistered')),
  current_version integer not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  voided_at timestamptz,
  check (
    (type_certified and type_cert_category is not null and type_cert_model is not null and type_cert_number is not null)
    or (not type_certified and type_cert_category is null and type_cert_model is null and type_cert_number is null)
  ),
  check ((airworthiness_class is null) = (airworthiness_cert_number is null))
);

-- 組織内で取消していない機体の登録記号は重複させない（取消済みと同じ記号は登録できる）
create unique index uq_aircraft_org_registration on aircraft (org_id, registration_mark) where voided_at is null;
create index idx_aircraft_org on aircraft (org_id);

comment on table aircraft is
  '機体（Sprint 10）。record_versions（entity_type = aircraft）から DB が作るヘッド表。';
comment on column aircraft.initial_flight_minutes is '使用開始時点の既存の総飛行時間（分）。';
comment on column aircraft.status is 'active 使用中／suspended 休止／deregistered 抹消';

create table pilots (
  id uuid primary key,
  org_id uuid not null references organizations(id),
  full_name text not null check (length(btrim(full_name)) between 1 and 100),
  has_license boolean not null,
  license_class text check (license_class is null or license_class in ('first', 'second')),
  -- 技能証明書番号。形式は未確認のため、英数字と - の 30 文字以内
  license_number text check (license_number is null or license_number ~ '^[A-Za-z0-9-]{1,30}$'),
  license_expires_on date,
  limitation_type boolean not null default false,
  limitation_weight boolean not null default false,
  limitation_daytime boolean not null default false,
  limitation_vlos boolean not null default false,
  member_id uuid references members(id),
  current_version integer not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  voided_at timestamptz,
  check (
    (has_license and license_class is not null and license_number is not null)
    or (not has_license and license_class is null and license_number is null)
  )
);

-- 1 人の利用者に結び付く（取消していない）操縦者は 1 件まで
create unique index uq_pilots_member on pilots (member_id) where member_id is not null and voided_at is null;
create index idx_pilots_org on pilots (org_id);

comment on table pilots is
  '操縦者（Sprint 10）。record_versions（entity_type = pilot）から DB が作るヘッド表。';
comment on column pilots.license_number is '技能証明書番号。一覧では末尾 4 桁以外を伏せ、全桁は運航管理者と本人にだけ返す（アプリ層）。';
