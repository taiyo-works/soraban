-- =============================================================
-- Soraban / Sprint 10: 運航管理の組織と利用者（ヘッド表）
-- =============================================================
-- - organizations：組織。第1段階は自社 1 件。作成はオーナーロール（ops_bootstrap・テスト用の初期データ）だけが行う。
-- - members：利用者（組織の構成員）の現在の値。版の表（record_versions、0006）への追加から DB が作る
--   （アプリ用ロール soraban_app は参照だけ。直接書けない）。
-- - Neon Auth の neon_auth スキーマは参照しない（CI のコンテナには無く、表の名前も未確認のため）。
--   auth_provider・auth_user_id は初回ログインで結び付ける（結び付け前は NULL）。
-- - 保存しない個人情報（生年月日・住所・電話・画像・マイナンバー等）の列は作らない（docs/sprints/sprint-10.md 設計 E）。
-- =============================================================

create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 200),
  created_at timestamptz not null default now()
);

comment on table organizations is
  '運航管理の組織（Sprint 10）。第1段階は自社 1 件。作成はオーナーロールだけ（soraban_app は参照のみ）。';

create table members (
  id uuid primary key,
  org_id uuid not null references organizations(id),
  -- 小文字に正規化したメールアドレス（招待と本人確認の照合に使う）
  email text not null check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+$'),
  display_name text not null check (length(btrim(display_name)) between 1 and 100),
  role text not null check (role in ('manager', 'pilot', 'viewer')),
  status text not null check (status in ('invited', 'active', 'disabled')),
  auth_provider text check (auth_provider is null or auth_provider in ('neon', 'test')),
  auth_user_id text check (auth_user_id is null or length(auth_user_id) between 1 and 200),
  current_version integer not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  voided_at timestamptz,
  check ((auth_provider is null) = (auth_user_id is null)),
  -- 有効（active）な利用者は必ず本人確認の ID に結び付いている
  check (status <> 'active' or auth_user_id is not null)
);

create unique index uq_members_org_email on members (org_id, email);
create unique index uq_members_auth on members (auth_provider, auth_user_id) where auth_user_id is not null;
create index idx_members_org on members (org_id);

comment on table members is
  '運航管理の利用者（Sprint 10）。record_versions（entity_type = member）から DB が作るヘッド表。第1段階は 1 人 1 組織。';
comment on column members.role is 'manager 運航管理者／pilot 操縦者／viewer 閲覧者';
comment on column members.status is 'invited 招待中／active 有効／disabled 停止';
