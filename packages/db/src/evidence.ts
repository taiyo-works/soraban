// evidence_log への書き込み（Sprint 8）。地点判定 1 件 = 1 行。
// client_user_agent と IP アドレスは記録しない。evidence_id の重複は無視する。
import type {
  ConfidenceLevelDb,
  EvidenceDatasetDb,
  RegulationStatusDb,
  RegulationVerdictDb,
  VerdictLevelDb,
} from "./types";

export type EvidenceLogInsert = {
  readonly evidenceId: string;
  readonly engineVersion: string;
  readonly checkedAt: string;
  readonly lat: number;
  readonly lng: number;
  readonly muniCode: string | null;
  readonly resolvedAddress: string | null;
  readonly overall: RegulationStatusDb;
  readonly overallConfidence: ConfidenceLevelDb;
  readonly regulationIds: readonly string[];
  readonly perRegulationStatus: Readonly<Record<string, RegulationStatusDb>>;
  readonly datasets: readonly EvidenceDatasetDb[];
  /** 0009（Sprint 11d）：判定（4 段）。0.3.0 までの行は null。 */
  readonly verdict: VerdictLevelDb | null;
  readonly verdictUnknownCount: number | null;
  readonly perRegulationVerdict: Readonly<Record<string, RegulationVerdictDb>> | null;
  /** 判定に当てた許可・同意の値（入力。旧値の読み替え後、並べ替え済み）。 */
  readonly appliedPermits: readonly string[] | null;
};

/** 書き込みに使う最小インターフェース（pg.Pool・pg.Client が満たす）。 */
export type Queryable = {
  query: (sql: string, params: unknown[]) => Promise<unknown>;
};

export const INSERT_EVIDENCE_LOG_SQL = `
insert into evidence_log (
  evidence_id, engine_version, checked_at, loc, muni_code, resolved_address,
  overall, overall_confidence, regulation_ids, per_regulation_status, datasets, client_user_agent,
  verdict, verdict_unknown_count, per_regulation_verdict, applied_permits
) values (
  $1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography, $6, $7,
  $8::regulation_status, $9::confidence_level, $10::text[], $11::jsonb, $12::jsonb, null,
  $13, $14, $15::jsonb, $16::text[]
)
on conflict (evidence_id) do nothing`;

export const evidenceLogParams = (row: EvidenceLogInsert): unknown[] => [
  row.evidenceId,
  row.engineVersion,
  row.checkedAt,
  row.lng,
  row.lat,
  row.muniCode,
  row.resolvedAddress,
  row.overall,
  row.overallConfidence,
  [...row.regulationIds],
  JSON.stringify(row.perRegulationStatus),
  JSON.stringify(row.datasets),
  row.verdict,
  row.verdictUnknownCount,
  row.perRegulationVerdict === null ? null : JSON.stringify(row.perRegulationVerdict),
  row.appliedPermits === null ? null : [...row.appliedPermits],
];

export const insertEvidenceLog = async (db: Queryable, row: EvidenceLogInsert): Promise<void> => {
  await db.query(INSERT_EVIDENCE_LOG_SQL, evidenceLogParams(row));
};
