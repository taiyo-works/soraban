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

// ---- 運航管理（Sprint 10。0004〜0006） ----

export type MemberRoleDb = "manager" | "pilot" | "viewer";
export type MemberStatusDb = "invited" | "active" | "disabled";
export type AuthProviderDb = "neon" | "test";
export type AircraftStatusDb = "active" | "suspended" | "deregistered";
export type CertClassDb = "first" | "second";
export type RecordEntityTypeDb = "member" | "aircraft" | "pilot" | "daily_inspection" | "flight_record";
export type RecordOpDb = "create" | "update" | "void";
export type RecordActorKindDb = "member" | "system";

export type OrganizationRow = {
  readonly id: string;
  readonly name: string;
  readonly created_at: string;
};

export type MemberRow = {
  readonly id: string;
  readonly org_id: string;
  readonly email: string;
  readonly display_name: string;
  readonly role: MemberRoleDb;
  readonly status: MemberStatusDb;
  readonly auth_provider: AuthProviderDb | null;
  readonly auth_user_id: string | null;
  readonly current_version: number;
  readonly created_at: string;
  readonly updated_at: string;
  readonly voided_at: string | null;
};

export type AircraftRow = {
  readonly id: string;
  readonly org_id: string;
  readonly registration_mark: string;
  readonly model_name: string;
  readonly manufacturer: string;
  readonly serial_number: string;
  readonly type_certified: boolean;
  readonly type_cert_category: string | null;
  readonly type_cert_model: string | null;
  readonly type_cert_number: string | null;
  readonly airworthiness_class: CertClassDb | null;
  readonly airworthiness_cert_number: string | null;
  /** numeric(7,1)。pg は文字列で返す。 */
  readonly max_takeoff_weight_kg: string | null;
  readonly initial_flight_minutes: number;
  readonly status: AircraftStatusDb;
  readonly current_version: number;
  readonly created_at: string;
  readonly updated_at: string;
  readonly voided_at: string | null;
};

export type PilotRow = {
  readonly id: string;
  readonly org_id: string;
  readonly full_name: string;
  readonly has_license: boolean;
  readonly license_class: CertClassDb | null;
  readonly license_number: string | null;
  readonly license_expires_on: string | null;
  readonly limitation_type: boolean;
  readonly limitation_weight: boolean;
  readonly limitation_daytime: boolean;
  readonly limitation_vlos: boolean;
  readonly member_id: string | null;
  readonly current_version: number;
  readonly created_at: string;
  readonly updated_at: string;
  readonly voided_at: string | null;
};

// ---- 運航管理（Sprint 11。0007・0008） ----

export type InspectionTimingDb = "pre_flight" | "post_flight";

export type DailyInspectionRow = {
  readonly id: string;
  readonly org_id: string;
  readonly aircraft_id: string;
  readonly pilot_id: string;
  readonly inspected_at: string;
  /** date。pg はローカル時刻の 0 時の Date で返す。 */
  readonly inspected_date: string;
  readonly timing: InspectionTimingDb;
  readonly place_name: string;
  /** numeric(9,6)。pg は文字列で返す。 */
  readonly latitude: string | null;
  readonly longitude: string | null;
  readonly accuracy_m: number | null;
  readonly items: Record<string, { readonly result: "normal" | "abnormal"; readonly note: string | null }>;
  readonly has_abnormal: boolean;
  readonly special_notes: string | null;
  readonly inspector_name: string;
  readonly inspector_version: number;
  readonly client_request_id: string | null;
  readonly current_version: number;
  readonly created_at: string;
  readonly updated_at: string;
  readonly voided_at: string | null;
};

export type FlightDefectDb = {
  readonly occurred_on: string;
  readonly description: string;
  readonly action_on: string | null;
  readonly action: string | null;
  readonly confirmer_name: string | null;
};

export type FlightRecordRow = {
  readonly id: string;
  readonly org_id: string;
  readonly aircraft_id: string;
  readonly pilot_id: string;
  readonly daily_inspection_id: string | null;
  readonly flight_plan_id: string | null;
  readonly snapshot_id: string | null;
  readonly purpose: string;
  readonly waypoints: string | null;
  readonly specific_flight_types: readonly string[];
  readonly takeoff_place: string;
  /** numeric(9,6)。pg は文字列で返す。 */
  readonly takeoff_lat: string | null;
  readonly takeoff_lng: string | null;
  readonly takeoff_accuracy_m: number | null;
  readonly landing_place: string;
  readonly landing_lat: string | null;
  readonly landing_lng: string | null;
  readonly landing_accuracy_m: number | null;
  readonly takeoff_at: string;
  readonly landing_at: string;
  readonly flight_minutes: number;
  readonly flight_date: string;
  readonly safety_issue: boolean;
  readonly safety_issue_detail: string | null;
  readonly defects: readonly FlightDefectDb[];
  readonly pilot_name: string;
  readonly pilot_license_number: string | null;
  readonly pilot_version: number;
  readonly client_request_id: string | null;
  readonly current_version: number;
  readonly created_at: string;
  readonly updated_at: string;
  readonly voided_at: string | null;
};

export type RecordVersionRow = {
  readonly id: string;
  readonly org_id: string;
  readonly entity_type: RecordEntityTypeDb;
  readonly entity_id: string;
  readonly version_no: number;
  readonly op: RecordOpDb;
  readonly data: Record<string, unknown>;
  readonly reason: string | null;
  readonly actor_kind: RecordActorKindDb;
  readonly actor_member_id: string | null;
  readonly created_at: string;
  readonly prev_hash: string;
  readonly content_hash: string;
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

export const ORGANIZATION_COLUMNS = columns<OrganizationRow>()(["id", "name", "created_at"]);

export const MEMBER_COLUMNS = columns<MemberRow>()([
  "id",
  "org_id",
  "email",
  "display_name",
  "role",
  "status",
  "auth_provider",
  "auth_user_id",
  "current_version",
  "created_at",
  "updated_at",
  "voided_at",
]);

export const AIRCRAFT_COLUMNS = columns<AircraftRow>()([
  "id",
  "org_id",
  "registration_mark",
  "model_name",
  "manufacturer",
  "serial_number",
  "type_certified",
  "type_cert_category",
  "type_cert_model",
  "type_cert_number",
  "airworthiness_class",
  "airworthiness_cert_number",
  "max_takeoff_weight_kg",
  "initial_flight_minutes",
  "status",
  "current_version",
  "created_at",
  "updated_at",
  "voided_at",
]);

export const PILOT_COLUMNS = columns<PilotRow>()([
  "id",
  "org_id",
  "full_name",
  "has_license",
  "license_class",
  "license_number",
  "license_expires_on",
  "limitation_type",
  "limitation_weight",
  "limitation_daytime",
  "limitation_vlos",
  "member_id",
  "current_version",
  "created_at",
  "updated_at",
  "voided_at",
]);

export const RECORD_VERSION_COLUMNS = columns<RecordVersionRow>()([
  "id",
  "org_id",
  "entity_type",
  "entity_id",
  "version_no",
  "op",
  "data",
  "reason",
  "actor_kind",
  "actor_member_id",
  "created_at",
  "prev_hash",
  "content_hash",
]);

export const DAILY_INSPECTION_COLUMNS = columns<DailyInspectionRow>()([
  "id",
  "org_id",
  "aircraft_id",
  "pilot_id",
  "inspected_at",
  "inspected_date",
  "timing",
  "place_name",
  "latitude",
  "longitude",
  "accuracy_m",
  "items",
  "has_abnormal",
  "special_notes",
  "inspector_name",
  "inspector_version",
  "client_request_id",
  "current_version",
  "created_at",
  "updated_at",
  "voided_at",
]);

export const FLIGHT_RECORD_COLUMNS = columns<FlightRecordRow>()([
  "id",
  "org_id",
  "aircraft_id",
  "pilot_id",
  "daily_inspection_id",
  "flight_plan_id",
  "snapshot_id",
  "purpose",
  "waypoints",
  "specific_flight_types",
  "takeoff_place",
  "takeoff_lat",
  "takeoff_lng",
  "takeoff_accuracy_m",
  "landing_place",
  "landing_lat",
  "landing_lng",
  "landing_accuracy_m",
  "takeoff_at",
  "landing_at",
  "flight_minutes",
  "flight_date",
  "safety_issue",
  "safety_issue_detail",
  "defects",
  "pilot_name",
  "pilot_license_number",
  "pilot_version",
  "client_request_id",
  "current_version",
  "created_at",
  "updated_at",
  "voided_at",
]);

/** 表名 → 列名の一覧（schema-columns.test.ts で SQL と突き合わせる）。 */
export const TABLE_COLUMNS = {
  regulations: REGULATION_COLUMNS,
  regulation_zones: REGULATION_ZONE_COLUMNS,
  evidence_log: EVIDENCE_LOG_COLUMNS,
  organizations: ORGANIZATION_COLUMNS,
  members: MEMBER_COLUMNS,
  aircraft: AIRCRAFT_COLUMNS,
  pilots: PILOT_COLUMNS,
  record_versions: RECORD_VERSION_COLUMNS,
  daily_inspections: DAILY_INSPECTION_COLUMNS,
  flight_records: FLIGHT_RECORD_COLUMNS,
} as const;

/** 運航管理の表（Sprint 10・11）。個人情報の禁止列の検査（schema-columns.test.ts）の対象。 */
export const OPS_TABLES = [
  "organizations",
  "members",
  "aircraft",
  "pilots",
  "record_versions",
  "daily_inspections",
  "flight_records",
] as const;
