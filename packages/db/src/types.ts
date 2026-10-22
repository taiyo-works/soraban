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
/** evidence_log.verdict（0009。Sprint 11d）。 */
export type VerdictLevelDb = "no_fly" | "needs_procedure" | "procedure_done" | "no_procedure";
/** evidence_log.per_regulation_verdict の値（規制ごとの判定。判定不能を含む）。 */
export type RegulationVerdictDb = VerdictLevelDb | "unknown";
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
  /** 0009 で追加（Sprint 11d）。0.3.0 までの行は null。 */
  readonly verdict: VerdictLevelDb | null;
  readonly verdict_unknown_count: number | null;
  readonly per_regulation_verdict: Record<string, RegulationVerdictDb> | null;
  readonly applied_permits: readonly string[] | null;
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
export type RecordEntityTypeDb =
  | "member"
  | "aircraft"
  | "pilot"
  | "daily_inspection"
  | "flight_record"
  | "flight_plan"
  | "saved_place"
  | "flight_report"
  | "permit_registration"
  | "incident_record";
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

// ---- 運航管理（Sprint 12a。0010・0011） ----

/** flight_plans.status。保存する状態は下書きと依頼済みだけ（確認待ち・確認済みなどは読み出しのたびに導出する）。取消は voided_at。 */
export type PlanStatusDb = "draft" | "active";
/** 判定に当てる目的の例外（flight_plans.judgement_purpose）。 */
export type JudgementPurposeDb = "emergency" | "public_duty" | "city_event";
/** judgement_snapshots.reason。 */
export type SnapshotReasonDb = "initial" | "input_changed" | "data_updated" | "manual";
/** judgement_snapshots.category（DiagnosisCategory と同じ値）。 */
export type SnapshotCategoryDb = "I" | "needs_verification" | "II_A" | "II_B_eligible" | "III_level4" | "emergency_no_fly";
export type ConfirmationDecisionDb = "approved" | "returned";

export type SavedPlaceRow = {
  readonly id: string;
  readonly org_id: string;
  readonly name: string;
  readonly address_text: string | null;
  /** numeric(9,6)。pg は文字列で返す。 */
  readonly latitude: string;
  readonly longitude: string;
  readonly note: string | null;
  readonly current_version: number;
  readonly created_at: string;
  readonly updated_at: string;
  readonly voided_at: string | null;
};

export type FlightPlanRow = {
  readonly id: string;
  readonly org_id: string;
  readonly title: string;
  readonly aircraft_id: string;
  readonly pilot_id: string;
  readonly planned_start_at: string;
  readonly duration_minutes: number;
  /** date。DB が planned_start_at の JST の日付から決める。 */
  readonly planned_date: string;
  readonly purpose: string;
  readonly place_name: string;
  /** numeric(9,6)。pg は文字列で返す。 */
  readonly latitude: string;
  readonly longitude: string;
  readonly radius_m: number | null;
  readonly saved_place_id: string | null;
  readonly max_altitude_m: number | null;
  /** 利用者が選んだ飛行の方法・空域のフラグ（SpecificFlightFlag の配列）。 */
  readonly flags: readonly string[];
  readonly pilot_permits: readonly string[];
  readonly judgement_purpose: JudgementPurposeDb | null;
  readonly access_control: boolean | null;
  readonly third_party_overflight: boolean | null;
  readonly bvlos_with_observer: boolean | null;
  readonly drone_weight_g: number | null;
  readonly permit_numbers: string | null;
  readonly notes: string | null;
  readonly status: PlanStatusDb;
  readonly current_snapshot_id: string;
  readonly client_request_id: string | null;
  readonly current_version: number;
  readonly created_at: string;
  readonly updated_at: string;
  readonly voided_at: string | null;
};

export type JudgementSnapshotRow = {
  readonly id: string;
  readonly org_id: string;
  readonly plan_id: string;
  readonly seq: number;
  readonly reason: SnapshotReasonDb;
  readonly input: Record<string, unknown>;
  /** runDiagnosis の応答そのもの。 */
  readonly result: Record<string, unknown>;
  readonly verdict_level: VerdictLevelDb;
  readonly verdict_unknown_count: number;
  readonly category: SnapshotCategoryDb;
  readonly engine_version: string;
  readonly checked_at: string;
  readonly check_evidence_id: string;
  readonly diagnosis_evidence_id: string;
  readonly datasets: readonly EvidenceDatasetDb[];
  readonly procedures_revision: number;
  readonly procedures_verified_at: string;
  readonly created_by_member_id: string;
  readonly created_at: string;
  readonly prev_hash: string;
  readonly content_hash: string;
};

export type PlanConfirmationRow = {
  readonly id: string;
  readonly org_id: string;
  readonly plan_id: string;
  readonly plan_version: number;
  readonly snapshot_id: string;
  readonly decision: ConfirmationDecisionDb;
  readonly reason: string | null;
  readonly confirmer_member_id: string;
  readonly confirmer_name: string;
  readonly self_confirmation: boolean;
  readonly created_at: string;
  readonly content_hash: string;
};

// ---- 通報（Sprint 12b。0012・0013） ----

/** flight_reports.kind。新規・変更・取消（取消は元の通報を指す別の行）。 */
export type ReportKindDb = "new" | "change" | "cancel";
/** flight_reports.channel。api は 12b では使わない。 */
export type ReportChannelDb = "manual" | "mock" | "api";
/** flight_reports.status。copied は保存せず監査に残す。取消は種別 cancel の別の行。 */
export type ReportStatusDb = "prepared" | "reported_manual" | "submitted_api" | "failed" | "unknown" | "retracted";
export type ReportAttemptOperationDb =
  | "copy"
  | "submit"
  | "status"
  | "cancel"
  | "manual_record"
  | "correct"
  | "retract"
  | "resolve";
export type ReportAttemptResultDb = "success" | "failure" | "unknown";
export type ProcedureRecordKindDb = "dips_permit" | "small_drone_law";
export type ProcedureRecordActionDb = "done" | "retract";

export type FlightReportRow = {
  readonly id: string;
  readonly org_id: string;
  readonly plan_id: string;
  readonly kind: ReportKindDb;
  readonly base_report_id: string | null;
  readonly snapshot_id: string;
  readonly plan_version: number;
  readonly fingerprint: string;
  readonly fingerprint_parts: Record<string, unknown>;
  readonly map_revision: number;
  readonly channel: ReportChannelDb;
  readonly status: ReportStatusDb;
  readonly idempotency_key: string;
  /** timestamptz（日本時間の分）。 */
  readonly reported_at: string | null;
  readonly dips_number: string | null;
  readonly number_unavailable: boolean;
  readonly confirmed_dips_done: boolean;
  readonly confirmed_matches_latest: boolean;
  /** 整えた通報内容の写し。技能証明書番号・氏名は入れない。 */
  readonly content: Record<string, unknown>;
  readonly memo: string | null;
  readonly error_kind: string | null;
  readonly external_ref: Record<string, unknown> | null;
  readonly external_status: Record<string, unknown> | null;
  readonly current_version: number;
  readonly created_at: string;
  readonly updated_at: string;
};

export type FlightReportAttemptRow = {
  readonly id: string;
  readonly org_id: string;
  readonly plan_id: string;
  readonly report_id: string | null;
  readonly operation: ReportAttemptOperationDb;
  readonly member_id: string;
  readonly member_name: string;
  readonly member_role: MemberRoleDb;
  readonly adapter: ReportChannelDb;
  readonly idempotency_key: string | null;
  readonly payload_hash: string | null;
  readonly summary: string | null;
  readonly map_revision: number | null;
  readonly check_evidence_id: string | null;
  readonly diagnosis_evidence_id: string | null;
  readonly result: ReportAttemptResultDb;
  readonly http_status: number | null;
  readonly error_kind: string | null;
  readonly dips_number: string | null;
  readonly created_at: string;
};

export type PlanProcedureRecordRow = {
  readonly id: string;
  readonly org_id: string;
  readonly plan_id: string;
  readonly kind: ProcedureRecordKindDb;
  readonly action: ProcedureRecordActionDb;
  readonly done_at: string | null;
  readonly reference: string | null;
  readonly checks: Record<string, boolean>;
  readonly snapshot_id: string;
  readonly plan_version: number;
  readonly recorded_by_member_id: string;
  readonly recorded_by_name: string;
  readonly reason: string | null;
  readonly created_at: string;
  readonly content_hash: string;
};

// ---- 現場の事実の記録（Sprint 12c。0014） ----

/** flight_field_events.kind。check＝飛行前の確認／takeoff＝離陸／landing＝着陸／undo＝取り消す／journal_linked＝日誌との結び付き。 */
export type FieldEventKindDb = "check" | "takeoff" | "landing" | "undo" | "journal_linked";
/** flight_field_events.item（check のとき）。inspection＝日常点検／emergency_airspace＝緊急用務空域／report_recheck＝通報済みの再確認／carry＝携行品。 */
export type FieldCheckItemDb = "inspection" | "emergency_airspace" | "report_recheck" | "carry";
export type FieldCheckResultDb = "done" | "not_designated" | "designated";
/** takeoff の gaps（離陸の時点の未了事項の写し）の 1 要素。 */
export type FieldGapDb = { readonly item: string; readonly state: string };

export type FlightFieldEventRow = {
  readonly id: string;
  readonly org_id: string;
  readonly plan_id: string;
  readonly kind: FieldEventKindDb;
  readonly item: FieldCheckItemDb | null;
  readonly result: FieldCheckResultDb | null;
  readonly source: string | null;
  readonly target_event_id: string | null;
  readonly flight_record_id: string | null;
  readonly inspection_id: string | null;
  readonly report_id: string | null;
  /** timestamptz（1 分単位）。事実の時刻。 */
  readonly occurred_at: string;
  readonly snapshot_id: string;
  readonly plan_version: number;
  readonly gaps: readonly FieldGapDb[] | null;
  readonly note: string | null;
  readonly queued: boolean;
  readonly client_event_id: string;
  readonly recorded_by_member_id: string;
  readonly recorded_by_name: string;
  readonly recorded_by_role: MemberRoleDb;
  readonly recorded_at: string;
  readonly content_hash: string;
};

// ---- 許可・承認の登録（Sprint 12d。0015） ----

/** permit_registrations.coverage。包括許可・個別許可。 */
export type PermitCoverageDb = "blanket" | "individual";
/** permit_registrations.kinds の要素。DIPS の許可・承認の 8 種と airport（空港等周辺の個別許可）。 */
export type PermitKindDb = "did" | "150m" | "night" | "bvlos" | "30m" | "event" | "dangerous" | "drop" | "airport";
export type PermitStatusDb = "active" | "revoked";
export type PermitSourceDb = "manual" | "dips_fpa";

export type PermitCircleDb = {
  readonly name?: string;
  readonly lat: number;
  readonly lng: number;
  readonly radiusM: number;
};

/** 場所の範囲。nationwide は包括のみ。text は文章のみ（照合できない）。 */
export type PermitPlaceScopeDb =
  | { readonly type: "nationwide" }
  | { readonly type: "circles"; readonly circles: readonly PermitCircleDb[] }
  | { readonly type: "text"; readonly text: string };

/** 機体・操縦者の範囲。listed は運航管理の機体・操縦者の ID（同じ組織）。any は許可書に限定がない。 */
export type PermitListedScopeDb = { readonly type: "any" } | { readonly type: "listed"; readonly ids: readonly string[] };

export type PermitRegistrationRow = {
  readonly id: string;
  readonly org_id: string;
  readonly permit_number: string;
  /** 照合の鍵（normalizePermitNumber の結果。アプリが決めて版の data に入れる）。 */
  readonly permit_number_key: string;
  readonly coverage: PermitCoverageDb;
  readonly kinds: readonly PermitKindDb[];
  readonly airport_names: readonly string[];
  /** date（JST の日付）。ストアは YYYY-MM-DD の文字列で返す。 */
  readonly issued_on: string;
  readonly valid_from: string;
  readonly valid_to: string;
  readonly status: PermitStatusDb;
  /** 失効・取消された日（この日以降は使えない）。active は null。 */
  readonly revoked_on: string | null;
  readonly place_scope: PermitPlaceScopeDb;
  readonly aircraft_scope: PermitListedScopeDb;
  readonly pilot_scope: PermitListedScopeDb;
  readonly max_altitude_m: number | null;
  /** numeric(5,2)。pg は文字列で返す。 */
  readonly max_weight_kg: string | null;
  readonly requires_observer: boolean;
  readonly requires_access_control: boolean;
  readonly conditions_text: string | null;
  readonly source: PermitSourceDb;
  readonly external_ref: Record<string, unknown>;
  readonly current_version: number;
  readonly created_at: string;
  readonly updated_at: string;
  readonly voided_at: string | null;
};

// ---- 事故・ヒヤリハット（Sprint 12e。0016） ----

/** incident_records.kind。利用者が選ぶ区分（記録の整理のため。法令上の区分ではない）。 */
export type IncidentKindDb = "accident" | "near_miss" | "undetermined";
export type IncidentPhaseDb = "preparation" | "takeoff" | "in_flight" | "landing" | "after_flight" | "other";
export type YesNoUnknownDb = "yes" | "no" | "unknown";
export type IncidentContactDb = "emergency_119" | "police_110" | "site_manager" | "client" | "internal_manager";
export type IncidentSourceDb = "office" | "field_quick";
export type IncidentFollowUpDb = "open" | "done";
/** 保存時にサーバーが計算した目安（2 段）。報告の要否を決めるものではない。 */
export type IncidentGuidanceLevelDb = "possible" | "none_selected";

export type IncidentRecordRow = {
  readonly id: string;
  readonly org_id: string;
  readonly kind: IncidentKindDb;
  /** timestamptz（1 分単位）。 */
  readonly occurred_at: string;
  readonly phase: IncidentPhaseDb | null;
  readonly place_name: string | null;
  /** numeric(9,6)。pg は文字列で返す。 */
  readonly latitude: string | null;
  readonly longitude: string | null;
  readonly plan_id: string | null;
  readonly snapshot_id: string | null;
  readonly flight_record_id: string | null;
  readonly aircraft_id: string | null;
  readonly pilot_id: string | null;
  /** 事象の類型のキー（版つきのデータが正。特別な値 none・unknown を含む）。 */
  readonly event_types: readonly string[];
  readonly people_injury: YesNoUnknownDb;
  readonly aircraft_damage: YesNoUnknownDb;
  readonly injured_count: number | null;
  readonly contacts_made: readonly IncidentContactDb[];
  readonly summary: string | null;
  readonly details: string | null;
  readonly factors_note: string | null;
  readonly actions_taken: string | null;
  readonly prevention_note: string | null;
  readonly detail_pending: boolean;
  readonly source: IncidentSourceDb;
  readonly follow_up_status: IncidentFollowUpDb;
  /** date（YYYY-MM-DD）。 */
  readonly follow_up_on: string | null;
  readonly guidance_level: IncidentGuidanceLevelDb;
  readonly guidance_revision: number;
  readonly client_request_id: string | null;
  readonly current_version: number;
  readonly created_at: string;
  readonly updated_at: string;
  readonly voided_at: string | null;
};

/** incident_report_records.action。reported：DIPS 2.0 等で報告した／consulted：報告の要否を確かめた／retract：取り下げ。 */
export type IncidentReportActionDb = "reported" | "consulted" | "retract";
export type IncidentReportChannelDb = "dips" | "other";

export type IncidentReportRecordRow = {
  readonly id: string;
  readonly org_id: string;
  readonly incident_id: string;
  readonly action: IncidentReportActionDb;
  readonly done_at: string | null;
  readonly channel: IncidentReportChannelDb | null;
  readonly channel_note: string | null;
  readonly reference: string | null;
  readonly reference_absent: boolean;
  readonly note: string | null;
  readonly checks: Record<string, boolean>;
  readonly target_record_id: string | null;
  readonly incident_version: number;
  readonly facts_fingerprint: string;
  readonly reason: string | null;
  readonly recorded_by_member_id: string;
  readonly recorded_by_name: string;
  readonly recorded_by_role: MemberRoleDb;
  readonly created_at: string;
  readonly content_hash: string;
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
  "verdict",
  "verdict_unknown_count",
  "per_regulation_verdict",
  "applied_permits",
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

export const SAVED_PLACE_COLUMNS = columns<SavedPlaceRow>()([
  "id",
  "org_id",
  "name",
  "address_text",
  "latitude",
  "longitude",
  "note",
  "current_version",
  "created_at",
  "updated_at",
  "voided_at",
]);

export const FLIGHT_PLAN_COLUMNS = columns<FlightPlanRow>()([
  "id",
  "org_id",
  "title",
  "aircraft_id",
  "pilot_id",
  "planned_start_at",
  "duration_minutes",
  "planned_date",
  "purpose",
  "place_name",
  "latitude",
  "longitude",
  "radius_m",
  "saved_place_id",
  "max_altitude_m",
  "flags",
  "pilot_permits",
  "judgement_purpose",
  "access_control",
  "third_party_overflight",
  "bvlos_with_observer",
  "drone_weight_g",
  "permit_numbers",
  "notes",
  "status",
  "current_snapshot_id",
  "client_request_id",
  "current_version",
  "created_at",
  "updated_at",
  "voided_at",
]);

export const JUDGEMENT_SNAPSHOT_COLUMNS = columns<JudgementSnapshotRow>()([
  "id",
  "org_id",
  "plan_id",
  "seq",
  "reason",
  "input",
  "result",
  "verdict_level",
  "verdict_unknown_count",
  "category",
  "engine_version",
  "checked_at",
  "check_evidence_id",
  "diagnosis_evidence_id",
  "datasets",
  "procedures_revision",
  "procedures_verified_at",
  "created_by_member_id",
  "created_at",
  "prev_hash",
  "content_hash",
]);

export const PLAN_CONFIRMATION_COLUMNS = columns<PlanConfirmationRow>()([
  "id",
  "org_id",
  "plan_id",
  "plan_version",
  "snapshot_id",
  "decision",
  "reason",
  "confirmer_member_id",
  "confirmer_name",
  "self_confirmation",
  "created_at",
  "content_hash",
]);

export const FLIGHT_REPORT_COLUMNS = columns<FlightReportRow>()([
  "id",
  "org_id",
  "plan_id",
  "kind",
  "base_report_id",
  "snapshot_id",
  "plan_version",
  "fingerprint",
  "fingerprint_parts",
  "map_revision",
  "channel",
  "status",
  "idempotency_key",
  "reported_at",
  "dips_number",
  "number_unavailable",
  "confirmed_dips_done",
  "confirmed_matches_latest",
  "content",
  "memo",
  "error_kind",
  "external_ref",
  "external_status",
  "current_version",
  "created_at",
  "updated_at",
]);

export const FLIGHT_REPORT_ATTEMPT_COLUMNS = columns<FlightReportAttemptRow>()([
  "id",
  "org_id",
  "plan_id",
  "report_id",
  "operation",
  "member_id",
  "member_name",
  "member_role",
  "adapter",
  "idempotency_key",
  "payload_hash",
  "summary",
  "map_revision",
  "check_evidence_id",
  "diagnosis_evidence_id",
  "result",
  "http_status",
  "error_kind",
  "dips_number",
  "created_at",
]);

export const PLAN_PROCEDURE_RECORD_COLUMNS = columns<PlanProcedureRecordRow>()([
  "id",
  "org_id",
  "plan_id",
  "kind",
  "action",
  "done_at",
  "reference",
  "checks",
  "snapshot_id",
  "plan_version",
  "recorded_by_member_id",
  "recorded_by_name",
  "reason",
  "created_at",
  "content_hash",
]);

export const FLIGHT_FIELD_EVENT_COLUMNS = columns<FlightFieldEventRow>()([
  "id",
  "org_id",
  "plan_id",
  "kind",
  "item",
  "result",
  "source",
  "target_event_id",
  "flight_record_id",
  "inspection_id",
  "report_id",
  "occurred_at",
  "snapshot_id",
  "plan_version",
  "gaps",
  "note",
  "queued",
  "client_event_id",
  "recorded_by_member_id",
  "recorded_by_name",
  "recorded_by_role",
  "recorded_at",
  "content_hash",
]);

export const PERMIT_REGISTRATION_COLUMNS = columns<PermitRegistrationRow>()([
  "id",
  "org_id",
  "permit_number",
  "permit_number_key",
  "coverage",
  "kinds",
  "airport_names",
  "issued_on",
  "valid_from",
  "valid_to",
  "status",
  "revoked_on",
  "place_scope",
  "aircraft_scope",
  "pilot_scope",
  "max_altitude_m",
  "max_weight_kg",
  "requires_observer",
  "requires_access_control",
  "conditions_text",
  "source",
  "external_ref",
  "current_version",
  "created_at",
  "updated_at",
  "voided_at",
]);

export const INCIDENT_RECORD_COLUMNS = columns<IncidentRecordRow>()([
  "id",
  "org_id",
  "kind",
  "occurred_at",
  "phase",
  "place_name",
  "latitude",
  "longitude",
  "plan_id",
  "snapshot_id",
  "flight_record_id",
  "aircraft_id",
  "pilot_id",
  "event_types",
  "people_injury",
  "aircraft_damage",
  "injured_count",
  "contacts_made",
  "summary",
  "details",
  "factors_note",
  "actions_taken",
  "prevention_note",
  "detail_pending",
  "source",
  "follow_up_status",
  "follow_up_on",
  "guidance_level",
  "guidance_revision",
  "client_request_id",
  "current_version",
  "created_at",
  "updated_at",
  "voided_at",
]);

export const INCIDENT_REPORT_RECORD_COLUMNS = columns<IncidentReportRecordRow>()([
  "id",
  "org_id",
  "incident_id",
  "action",
  "done_at",
  "channel",
  "channel_note",
  "reference",
  "reference_absent",
  "note",
  "checks",
  "target_record_id",
  "incident_version",
  "facts_fingerprint",
  "reason",
  "recorded_by_member_id",
  "recorded_by_name",
  "recorded_by_role",
  "created_at",
  "content_hash",
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
  saved_places: SAVED_PLACE_COLUMNS,
  flight_plans: FLIGHT_PLAN_COLUMNS,
  judgement_snapshots: JUDGEMENT_SNAPSHOT_COLUMNS,
  plan_confirmations: PLAN_CONFIRMATION_COLUMNS,
  flight_reports: FLIGHT_REPORT_COLUMNS,
  flight_report_attempts: FLIGHT_REPORT_ATTEMPT_COLUMNS,
  plan_procedure_records: PLAN_PROCEDURE_RECORD_COLUMNS,
  flight_field_events: FLIGHT_FIELD_EVENT_COLUMNS,
  permit_registrations: PERMIT_REGISTRATION_COLUMNS,
  incident_records: INCIDENT_RECORD_COLUMNS,
  incident_report_records: INCIDENT_REPORT_RECORD_COLUMNS,
} as const;

/** 運航管理の表（Sprint 10・11・12a・12b・12c・12d・12e）。個人情報の禁止列の検査（schema-columns.test.ts）の対象。 */
export const OPS_TABLES = [
  "organizations",
  "members",
  "aircraft",
  "pilots",
  "record_versions",
  "daily_inspections",
  "flight_records",
  "saved_places",
  "flight_plans",
  "judgement_snapshots",
  "plan_confirmations",
  "flight_reports",
  "flight_report_attempts",
  "plan_procedure_records",
  "flight_field_events",
  "permit_registrations",
  "incident_records",
  "incident_report_records",
] as const;
