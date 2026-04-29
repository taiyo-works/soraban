// Phase 1 の Supabase 接続準備。Phase 0/1 前半は in-memory + ローカル GeoJSON で
// 評価エンジンを動かしているため、このモジュールから実際に DB へクエリを投げる
// ことはない。型と client factory を整えておくことで、Phase 1 中盤の "DB 接続化"
// で diff を最小化することが目的。
//
// スキーマは supabase/migrations/0001_initial_schema.sql を参照。
// 型を再生成するときは:
//   supabase gen types typescript --local > packages/db/src/database.types.ts
// その後、本ファイルの Database type を import 置き換える。

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type SorabanDbConfig = {
  readonly url: string;
  readonly anonKey: string;
};

// supabase/migrations/0001_initial_schema.sql の enum / table と一致させる。
// supabase gen types で再生成すれば import 置換で差し替え可能。
export type RegulationSourceDb = "国" | "都道府県" | "市町村";
export type RegulationStatusDb = "green" | "yellow" | "red" | "unknown";
export type RegulationCategoryDb =
  | "aviation_law_did"
  | "aviation_law_airport"
  | "small_drone_law"
  | "municipal_park"
  | "heritage_protection"
  | "prefectural_nuisance";
export type ConfidenceLevelDb = "low" | "medium" | "high";
export type ZoneKindDb =
  | "park_polygon"
  | "heritage_polygon"
  | "sensitive_buffer"
  | "airbase_buffer"
  | "did_polygon"
  | "airport_polygon";

export type RegulationRow = {
  readonly id: string;
  readonly source: RegulationSourceDb;
  readonly category: RegulationCategoryDb;
  readonly jurisdiction_code: string | null;
  readonly authority: string;
  readonly title: string;
  readonly summary: string;
  readonly url: string | null;
  readonly data_year: number | null;
  // ClauseGraph (packages/regulations/src/clause-graph.ts) を JSONB で保持。
  // 型互換性は呼び出し側で `unknown` → 型ガードを通すか、
  // packages/regulations から ClauseGraph 型を import して充てる。
  readonly clause_graph: unknown;
  readonly confidence_geometric: ConfidenceLevelDb;
  readonly confidence_extraction: ConfidenceLevelDb;
  readonly verified_at: string;
  readonly created_at: string;
  readonly updated_at: string;
};

export type RegulationInsert = Omit<
  RegulationRow,
  "created_at" | "updated_at"
> & {
  readonly created_at?: string;
  readonly updated_at?: string;
};

export type RegulationZoneRow = {
  readonly id: string;
  readonly regulation_id: string;
  readonly kind: ZoneKindDb;
  readonly name: string;
  readonly designation: string | null;
  // PostGIS GEOGRAPHY は WKT / GeoJSON どちらでも入る。
  // 取り出す時は ST_AsGeoJSON 経由で GeoJSON 文字列にする運用を推奨。
  readonly geom: string;
  readonly buffer_m: number | null;
  readonly created_at: string;
};

export type RegulationZoneInsert = Omit<RegulationZoneRow, "created_at"> & {
  readonly created_at?: string;
};

export type EvidenceLogRow = {
  readonly evidence_id: string;
  readonly engine_version: string;
  readonly checked_at: string;
  readonly loc: string;
  readonly muni_code: string | null;
  readonly resolved_address: string | null;
  readonly overall: RegulationStatusDb;
  readonly overall_confidence: ConfidenceLevelDb;
  readonly regulation_ids: readonly string[];
  readonly per_regulation_status: Record<string, RegulationStatusDb>;
  readonly client_user_agent: string | null;
  readonly created_at: string;
};

export type EvidenceLogInsert = Omit<EvidenceLogRow, "created_at"> & {
  readonly created_at?: string;
};

export type Database = {
  public: {
    Tables: {
      regulations: {
        Row: RegulationRow;
        Insert: RegulationInsert;
        Update: Partial<RegulationInsert>;
      };
      regulation_zones: {
        Row: RegulationZoneRow;
        Insert: RegulationZoneInsert;
        Update: Partial<RegulationZoneInsert>;
      };
      evidence_log: {
        Row: EvidenceLogRow;
        Insert: EvidenceLogInsert;
        Update: Partial<EvidenceLogInsert>;
      };
    };
    Enums: {
      regulation_source: RegulationSourceDb;
      regulation_status: RegulationStatusDb;
      regulation_category: RegulationCategoryDb;
      confidence_level: ConfidenceLevelDb;
      zone_kind: ZoneKindDb;
    };
  };
};

export type SorabanSupabaseClient = SupabaseClient<Database>;

export const createSorabanClient = (
  config: SorabanDbConfig,
): SorabanSupabaseClient =>
  createClient<Database>(config.url, config.anonKey, {
    auth: { persistSession: false },
  });

// 環境変数から構成を読み込む helper。Phase 1 接続化のときに採用。
// .env に SUPABASE_URL / SUPABASE_ANON_KEY を入れる前提。
export const sorabanConfigFromEnv = (
  env: NodeJS.ProcessEnv = process.env,
): SorabanDbConfig | null => {
  const url = env["SUPABASE_URL"];
  const anonKey = env["SUPABASE_ANON_KEY"];
  if (typeof url !== "string" || typeof anonKey !== "string") return null;
  return { url, anonKey };
};

// ---- 後方互換 stub (Phase 0 web app から参照されている可能性に備える) -----

/** @deprecated Phase 1 接続化で createSorabanClient に置換予定 */
export type DatabaseClient = { readonly url: string };

/** @deprecated Phase 1 接続化で createSorabanClient に置換予定 */
export const createDatabaseClient = (
  url: string,
  _anonKey: string,
): DatabaseClient => ({
  url,
});
