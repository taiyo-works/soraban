-- =============================================================
-- Soraban / Phase 1 evidence log
-- =============================================================
-- 監査トレイル: 1 件の判定リクエスト = 1 行。
-- evidence_id ("ev_" + SHA-256 ハッシュの先頭16文字) を主キーにする。
-- ハッシュの入力には判定時刻・エンジン版・データセットの確認日を含むため、
-- 同じ地点でも判定ごとに異なる id になる（0003 で説明を更新）。
--
-- 損保引受・自治体審査・特許明細書の実施例で「いつのロジックでどの規制が
-- どう判定されたか」を後から再現可能にするのが目的。
-- =============================================================

create table evidence_log (
  evidence_id text primary key,         -- ts 側 computeEvidenceId と一致
  engine_version text not null,         -- 例: "soraban-0.2.0-clausegraph"
  checked_at timestamptz not null,

  loc geography(Point, 4326) not null,  -- 判定地点
  muni_code text,
  resolved_address text,

  overall regulation_status not null,
  overall_confidence confidence_level not null,

  -- 判定で参照した regulations.id 配列（順序維持）
  regulation_ids text[] not null,

  -- 各レイヤごとの status（regulations.id → status）。
  -- ClauseGraph 自体は regulations 側にあるので、ここでは結果のみ。
  per_regulation_status jsonb not null,

  -- リクエスト元情報（任意）。ロード／プライバシ観点で IP は保持しない方針
  client_user_agent text,

  created_at timestamptz not null default now()
);

create index idx_evidence_log_loc on evidence_log using gist (loc);
create index idx_evidence_log_checked_at on evidence_log (checked_at desc);
create index idx_evidence_log_muni on evidence_log (muni_code);

comment on table evidence_log is
  '監査トレイル: 判定リクエスト 1 件 = 1 行。evidence_id は決定論的 SHA-256（先頭16文字）。';
