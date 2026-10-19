// 表の行の型（手書き）。packages/db/migrations の create table・alter table と一致させる。
// 列名の一致は src/schema-columns.test.ts が SQL ファイルを読んで確かめる。

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
  /** ClauseGraph（packages/regulations/src/clause-graph.ts）を JSONB で保持。 */
  readonly clause_graph: unknown;
  readonly confidence_geometric: ConfidenceLevelDb;
  readonly confidence_extraction: ConfidenceLevelDb;
  readonly verified_at: string;
  readonly created_at: string;
  readonly updated_at: string;
};

export type RegulationZoneRow = {
  readonly id: string;
  readonly regulation_id: string;
  readonly kind: ZoneKindDb;
  readonly name: string;
  readonly designation: string | null;
  /** PostGIS geography。取り出すときは ST_AsGeoJSON で GeoJSON 文字列にする。 */
  readonly geom: string;
  readonly buffer_m: number | null;
  readonly created_at: string;
};

/** evidence_log.datasets の 1 要素（packages/regulations の DatasetRef と同形）。 */
export type EvidenceDatasetDb = {
  readonly id: string;
  readonly name: string;
  readonly baseYear: number | null;
  readonly verifiedAt: string;
};

export type EvidenceLogRow = {
  readonly evidence_id: string;
  readonly engine_version: string;
  readonly checked_at: string;
  /** geography(Point, 4326)。 */
  readonly loc: string;
  readonly muni_code: string | null;
  readonly resolved_address: string | null;
  readonly overall: RegulationStatusDb;
  readonly overall_confidence: ConfidenceLevelDb;
  readonly regulation_ids: readonly string[];
  readonly per_regulation_status: Record<string, RegulationStatusDb>;
  readonly client_user_agent: string | null;
  readonly created_at: string;
  /** 0003 で追加。 */
  readonly datasets: readonly EvidenceDatasetDb[];
};

/** マイグレーションの適用記録（ランナーが作る表。マイグレーションファイルには含まない）。 */
export type SchemaMigrationRow = {
  readonly version: string;
  readonly name: string;
  readonly checksum: string;
  readonly applied_at: string;
  readonly duration_ms: number;
};

// ---- 列名の一覧（型の全キーを列挙していることを型で強制する） ----

type ExactKeys<Row, Cols extends readonly string[]> = [Exclude<keyof Row, Cols[number]>] extends [never]
  ? [Exclude<Cols[number], keyof Row>] extends [never]
    ? Cols
    : never
  : never;

const columns =
  <Row>() =>
  <const Cols extends readonly (keyof Row & string)[]>(cols: ExactKeys<Row, Cols>): Cols =>
    cols;

export const REGULATION_COLUMNS = columns<RegulationRow>()([
  "id",
  "source",
  "category",
  "jurisdiction_code",
  "authority",
  "title",
  "summary",
  "url",
  "data_year",
  "clause_graph",
  "confidence_geometric",
  "confidence_extraction",
  "verified_at",
  "created_at",
  "updated_at",
]);

export const REGULATION_ZONE_COLUMNS = columns<RegulationZoneRow>()([
  "id",
  "regulation_id",
  "kind",
  "name",
  "designation",
  "geom",
  "buffer_m",
  "created_at",
]);

export const EVIDENCE_LOG_COLUMNS = columns<EvidenceLogRow>()([
  "evidence_id",
  "engine_version",
  "checked_at",
  "loc",
  "muni_code",
  "resolved_address",
  "overall",
  "overall_confidence",
  "regulation_ids",
  "per_regulation_status",
  "client_user_agent",
  "created_at",
  "datasets",
]);

/** 表名 → 列名の一覧（schema-columns.test.ts で SQL と突き合わせる）。 */
export const TABLE_COLUMNS = {
  regulations: REGULATION_COLUMNS,
  regulation_zones: REGULATION_ZONE_COLUMNS,
  evidence_log: EVIDENCE_LOG_COLUMNS,
} as const;
