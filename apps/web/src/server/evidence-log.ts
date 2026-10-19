// 地点判定の証跡を evidence_log に書く（Sprint 8）。
// /api/check の応答を返した後に実行する。DB 未設定・不達・書き込み失敗のいずれでも応答は変えない。
import type { LatLng } from "@soraban/geo";
import {
  describeDbError,
  getPool,
  insertEvidenceLog,
  type DbEnv,
  type EvidenceLogInsert,
} from "@soraban/db";
import type { RegulationCheckResult } from "@soraban/regulations";
import { collectDatasets } from "./check-core";

/** 証跡の書き込み関数（handleCheckPost に渡し、テストで差し替える）。 */
export type WriteEvidence = (result: RegulationCheckResult, loc: LatLng) => Promise<void>;

/** 判定結果から evidence_log の 1 行を組み立てる。client_user_agent・IP は含めない。 */
export const toEvidenceLogInsert = (result: RegulationCheckResult, loc: LatLng): EvidenceLogInsert => ({
  evidenceId: result.evidenceId,
  engineVersion: result.engineVersion,
  checkedAt: result.checkedAt,
  lat: loc.lat,
  lng: loc.lng,
  muniCode: result.muniCode ?? null,
  resolvedAddress: result.resolvedAddress ?? null,
  overall: result.overall,
  overallConfidence: result.overallConfidence,
  regulationIds: result.regulations.map((r) => r.id),
  perRegulationStatus: Object.fromEntries(result.regulations.map((r) => [r.id, r.status])),
  datasets: collectDatasets(result.regulations).map((d) => ({
    id: d.id,
    name: d.name,
    baseYear: d.baseYear,
    verifiedAt: d.verifiedAt,
  })),
});

/** DATABASE_URL が設定されていれば書き込み関数を返す。未設定なら undefined（接続を試みない）。 */
export const dbEvidenceWriter = (env: DbEnv = process.env): WriteEvidence | undefined => {
  const pool = getPool(env);
  if (!pool) return undefined;
  return (result, loc) => insertEvidenceLog(pool, toEvidenceLogInsert(result, loc));
};

/** 書き込みを実行し、失敗はサーバーログに 1 行（エラー種別とコードのみ）出して握りつぶす。 */
export const runEvidenceWriteSafely = async (
  write: WriteEvidence,
  result: RegulationCheckResult,
  loc: LatLng,
): Promise<void> => {
  try {
    await write(result, loc);
  } catch (e) {
    console.error(`[evidence_log] write failed: ${describeDbError(e)}`);
  }
};
