-- =============================================================
-- Soraban / Phase 1 初期スキーマ
-- =============================================================
-- マスタープラン §11 の regulations テーブル定義を Phase 0/1 で確立した
-- ClauseGraph + 多 polygon (1規則 = N ゾーン) の現実に合わせて拡張する。
--
-- 設計判断:
-- - regulations: 1 行 = 1 (規則 × 管轄)。例: "31202-park-ordinance" (米子市都市公園条例)。
-- - regulation_zones: 1 行 = 1 ポリゴン or 中心+バッファ。米子市公園条例には
--   8 ゾーン、鳥取県迷惑行為等防止条例には公衆密集地 4 ゾーン、と 1:N で紐付く。
-- - clause_graph は JSONB で保持。特許①の「機械可読化された例外節グラフ」を
--   そのまま投入できる構造。GIN index で例外節検索を高速化する。
-- - geom は GEOGRAPHY(Geometry, 4326)。Polygon と Point（バッファ運用）を
--   同居させるため Geometry にしてある。GiST index で空間検索を高速化。
-- - jurisdiction_code は柔軟運用: 5桁=市町村 / 2桁=都道府県 / NULL=国。
-- - 2026-10（Sprint 8）: 旧 DB 製品向けのマイグレーション置き場から packages/db/migrations へ移した。
--   表・列・制約・索引の意味は変えていない（コメントのみ修正）。
-- =============================================================

create extension if not exists postgis;

-- ---- enums --------------------------------------------------

create type regulation_source as enum ('国', '都道府県', '市町村');

create type regulation_status as enum ('green', 'yellow', 'red', 'unknown');

create type regulation_category as enum (
  'aviation_law_did',
  'aviation_law_airport',
  'small_drone_law',
  'municipal_park',
  'heritage_protection',
  'prefectural_nuisance'
);

create type confidence_level as enum ('low', 'medium', 'high');

-- ---- regulations -------------------------------------------

create table regulations (
  -- ts 側の Regulation.id に対応 (例: "31202-park-ordinance")。
  -- 自治体名・カテゴリから決まる安定キーなので text を主キーに採用。
  id text primary key,

  source regulation_source not null,
  category regulation_category not null,

  -- 5桁=市町村コード / 2桁=都道府県コード / NULL=国
  jurisdiction_code text check (
    jurisdiction_code is null
    or jurisdiction_code ~ '^\d{2}$'
    or jurisdiction_code ~ '^\d{5}$'
  ),

  authority text not null,
  title text not null,
  summary text not null,
  url text,
  data_year integer,

  -- 特許①コア: 例外節を機械可読化した ClauseGraph を JSONB で保持。
  -- packages/regulations/src/clause-graph.ts の ClauseGraph 型と一致。
  clause_graph jsonb not null,

  confidence_geometric confidence_level not null,
  confidence_extraction confidence_level not null,
  verified_at timestamptz not null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_regulations_jurisdiction on regulations (jurisdiction_code);
create index idx_regulations_category on regulations (category);
create index idx_regulations_clause_graph on regulations using gin (clause_graph);

comment on table regulations is
  'Phase 1 規則メタ。1 行 = 1 (規則 × 管轄)。多ポリゴンは regulation_zones へ。';
comment on column regulations.clause_graph is
  '特許①コア: 例外節を機械可読化した ClauseGraph (JSONB)。packages/regulations の ClauseGraph 型と一致させる。';

-- ---- regulation_zones --------------------------------------

create type zone_kind as enum (
  'park_polygon',         -- 都市公園
  'heritage_polygon',     -- 指定史跡
  'sensitive_buffer',     -- 公衆密集地（中心 + buffer_m で運用）
  'airbase_buffer',       -- 小型無人機等飛行禁止法の対象施設（中心点＋推定半径の暫定運用）
  'did_polygon',          -- 人口集中地区
  'airport_polygon'       -- 空港等
);

create table regulation_zones (
  -- ts 側の各種 id に対応 (例: "minatoyama-park", "yonago-castle-ruins")。
  id text primary key,

  regulation_id text not null references regulations(id) on delete cascade,

  kind zone_kind not null,
  name text not null,

  -- 史跡なら designation = '国指定史跡' / '県指定' / '市指定'
  -- 公衆密集地なら designation = '病院' / '駅' / '庁舎' / ...
  -- それ以外は NULL
  designation text,

  -- Polygon (kind=*_polygon) または Point (kind=*_buffer)
  geom geography(Geometry, 4326) not null,

  -- 中心 + バッファ運用の場合のみ NOT NULL（公衆密集地 100m など。飛行禁止法の周辺地域は
  -- 敷地境界からおおむね 1,000m で、判定ロジックは packages/regulations 側に持つ）
  buffer_m integer check (buffer_m is null or buffer_m > 0),

  created_at timestamptz not null default now()
);

create index idx_regulation_zones_geom on regulation_zones using gist (geom);
create index idx_regulation_zones_regulation on regulation_zones (regulation_id);
create index idx_regulation_zones_kind on regulation_zones (kind);

comment on table regulation_zones is
  '1 規則に対する N ポリゴン or バッファ中心点を保持。米子市公園条例 → 8 ゾーンなど。';

-- ---- updated_at trigger ------------------------------------

create or replace function set_updated_at()
returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger regulations_set_updated_at
  before update on regulations
  for each row execute function set_updated_at();
