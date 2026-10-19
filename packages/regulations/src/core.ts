import {
  findPermittingExceptions,
  type ClauseException,
  type ClauseGraph,
  type FlightContext,
} from "./clause-graph";
import type { RegulationConfidence } from "./confidence";
import type { AmendmentRef, DatasetRef } from "./datasets";

export type RegulationSource = "国" | "都道府県" | "市町村";

export type RegulationStatus = "red" | "yellow" | "green" | "unknown";

export type Regulation = {
  readonly id: string;
  readonly source: RegulationSource;
  readonly authority: string;
  readonly title: string;
  readonly summary: string;
  readonly url?: string;
  /** 統計の基準年（DID の国勢調査年など）。基準年のない概算データ（空港など）には付けない。 */
  readonly dataYear?: number;
  readonly clauseGraph: ClauseGraph;
  readonly confidence: RegulationConfidence;
  /** 判定に使ったデータセット（台帳 data/sources.json の参照）。1 件以上。 */
  readonly datasets: readonly DatasetRef[];
  /** 反映済みの法令改正（根拠と施行日）。該当がなければ空配列。 */
  readonly amendments: readonly AmendmentRef[];
};

/**
 * DID 判定の詳細（画面・PDF・履歴の表示用）。
 *   - no_data: DID データなし（未確認）
 *   - outside_did: DID 外（非該当）
 *   - industrial_exclusive: DID 内だが工業専用地域内（非該当（工業専用地域））
 *   - in_did: DID 内・工業専用地域外（該当）
 *   - in_did_near_industrial_boundary: DID 内・工業専用地域の境界から内側余裕未満（該当）
 *   - in_did_exclusion_unverified: DID 内・当該市町村の工業専用地域が未収録（該当・除外未確認）
 */
export type DidDetail =
  | "no_data"
  | "outside_did"
  | "industrial_exclusive"
  | "in_did"
  | "in_did_near_industrial_boundary"
  | "in_did_exclusion_unverified";

export type RegulationWithStatus = Regulation & {
  readonly status: RegulationStatus;
  readonly note: string;
  /**
   * FlightContext との照合で適用された permit 効果の例外節。
   * ここが非空なら、当該規制は status が一段降格されている（red→green / yellow→green）。
   * UI 側で「この条件で適用された例外」として可視化する。
   */
  readonly appliedExceptions?: readonly ClauseException[];
  /** DID 規制（aviation-law-did）のみ：判定の詳細。 */
  readonly didDetail?: DidDetail;
  /** 小型無人機等飛行禁止法（small-drone-law）のみ：周辺地域に該当した施設。 */
  readonly facilityHits?: readonly FacilityHit[];
};

/** 飛行禁止法の対象施設との位置関係（敷地境界からの距離）。 */
export type FacilityHit = {
  readonly facilityId: string;
  readonly facilityName: string;
  /** 敷地境界からの距離（m）。敷地内は 0。中心点のみの施設は推定半径を差し引いた概算。 */
  readonly distanceFromBoundaryM: number;
  readonly zone: "red" | "yellow";
  /** 敷地形状未収録（中心点＋推定半径）のため概算。 */
  readonly approximate: boolean;
};

/**
 * 評価器の status と ClauseGraph + ctx を受けて、permit 例外がマッチしていれば
 * status を green に降格しつつ、適用された例外節と note を返すヘルパー。
 * 評価器ごとに同じパターンを書かずに済むよう共通化する。
 *
 * 動作:
 *   - ctx 未指定 / 例外マッチ無し: そのまま返す
 *   - red / yellow から permit 例外マッチ: status="green", appliedExceptions に保存、
 *     note の末尾に「(機体重量 100g 未満により対象外)」のような追記を挿入
 *   - green / unknown: 例外マッチがあっても status は触らない (既に最弱なので)
 */
export const applyExemptions = (
  base: { status: RegulationStatus; note: string; clauseGraph: ClauseGraph },
  ctx: FlightContext | undefined,
): { status: RegulationStatus; note: string; appliedExceptions?: readonly ClauseException[] } => {
  if (base.status !== "red" && base.status !== "yellow") return base;
  const matched = findPermittingExceptions(base.clauseGraph, ctx);
  if (matched.length === 0) return base;
  const reasons = matched.map((m) => m.condition).join(" / ");
  return {
    status: "green",
    note: `${base.note} ※適用例外: ${reasons}`,
    appliedExceptions: matched,
  };
};

