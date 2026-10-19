// 地点判定の証跡（evidenceId）の入力を決定論的な JSON 文字列に正規化する（Sprint 7）。
//
// ハッシュ化（SHA-256）はサーバ側（apps/web/src/server）で行う。ここはペイロードの組み立てだけを
// 純関数として持ち、単体テストで「データセットの確認日を変えると証跡 ID が変わる」ことを確かめる。
import type { FlightContext } from "./clause-graph";
import type { DatasetRef } from "./datasets";

/**
 * 判定エンジンの版。証跡 ID の入力に含め、どのロジックで判定したかを同定する。
 * Sprint 7：飛行禁止法 1,000m（敷地境界基準）・DID 令和2年＋工業専用地域の除外・データ出典台帳。
 */
export const ENGINE_VERSION = "soraban-0.3.0-regulations-2026-07";

/** 過去の版（履歴の互換表示用）。 */
export const PREVIOUS_ENGINE_VERSIONS: readonly string[] = ["soraban-0.2.0-clausegraph"];

export type CheckEvidencePayloadInput = {
  readonly engineVersion: string;
  readonly lat: number;
  readonly lng: number;
  readonly checkedAt: string;
  readonly regulationIds: readonly string[];
  readonly ctx?: FlightContext;
  /** 判定に使ったデータセット（ID と確認日を証跡に含める）。 */
  readonly datasets: readonly Pick<DatasetRef, "id" | "verifiedAt">[];
};

// FlightContext を決定論的にシリアライズ（キー順を固定）。
const stableCtx = (ctx: FlightContext | undefined): unknown => {
  if (!ctx) return null;
  const out: Record<string, unknown> = {};
  if (typeof ctx.droneWeightG === "number") out["w"] = ctx.droneWeightG;
  if (Array.isArray(ctx.pilotPermits)) out["p"] = [...ctx.pilotPermits].sort();
  if (typeof ctx.purpose === "string") out["u"] = ctx.purpose;
  if (typeof ctx.droneClass === "string") out["c"] = ctx.droneClass;
  return Object.keys(out).length > 0 ? out : null;
};

/** データセット参照を「id@確認日」の重複なし・昇順の配列に正規化する。 */
export const normalizeDatasetKeys = (
  datasets: readonly Pick<DatasetRef, "id" | "verifiedAt">[],
): readonly string[] =>
  Array.from(new Set(datasets.map((d) => `${d.id}@${d.verifiedAt}`))).sort();

export const buildCheckEvidencePayload = (input: CheckEvidencePayloadInput): string =>
  JSON.stringify({
    v: input.engineVersion,
    lat: Number(input.lat.toFixed(6)),
    lng: Number(input.lng.toFixed(6)),
    t: input.checkedAt,
    r: [...input.regulationIds].sort(),
    x: stableCtx(input.ctx),
    ds: normalizeDatasetKeys(input.datasets),
  });
