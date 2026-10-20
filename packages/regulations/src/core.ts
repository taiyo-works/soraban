import {
  findExcludingExceptions,
  findSatisfyingExceptions,
  type ClauseException,
  type ClauseGraph,
  type FlightContext,
} from "./clause-graph";
import type { RegulationConfidence } from "./confidence";
import type { AmendmentRef, DatasetRef } from "./datasets";

export type RegulationSource = "国" | "都道府県" | "市町村";

export type RegulationStatus = "red" | "yellow" | "green" | "unknown";

/**
 * 法的な重さ（Sprint 11d、spec §13.9.6）。手続きの並べ方に使う。
 *   1: 国の法律（航空法・小型無人機等飛行禁止法・文化財保護法）
 *   2: 条例（都市公園条例・県の迷惑行為等防止条例）
 *   3: 施設管理者の取り決め
 */
export type LegalTier = 1 | 2 | 3;

export const LEGAL_TIER_LABEL: Readonly<Record<LegalTier, string>> = {
  1: "国の法律",
  2: "条例",
  3: "施設管理者の取り決め",
};

export type Regulation = {
  readonly id: string;
  readonly source: RegulationSource;
  readonly authority: string;
  readonly title: string;
  readonly summary: string;
  readonly url?: string;
  /** 法的な重さ（1 国の法律、2 条例、3 施設管理者の取り決め）。Sprint 11d。 */
  readonly legalTier: LegalTier;
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
  /**
   * 元の判定（Sprint 11d、spec §13.9.3）：許可・同意・目的の例外を当てる前の、法令上の該当。
   * red＝該当、yellow＝該当の可能性（要確認）、green＝非該当、unknown＝判定不能（データ未整備）。
   * 対象外にする例外（機体重量 100g 未満・工業専用地域）だけが green にする。
   */
  readonly status: RegulationStatus;
  readonly note: string;
  /**
   * 対象外にする例外（weight_below_g・in_zone）で当たった例外節。ここが非空なら status は green。
   */
  readonly appliedExceptions?: readonly ClauseException[];
  /**
   * 満たす例外（許可・同意・目的）で当たった例外節（Sprint 11d）。status は変えない。
   * 判定（verdict）はこれをもとに手続き済み（条件付き）になる。
   */
  readonly satisfiedBy?: readonly ClauseException[];
  /**
   * 飛行不可の区分（Sprint 11d A4）：空港の敷地内。満たす例外を当てず、判定は飛行不可。
   */
  readonly noFlyCategory?: boolean;
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
 * 評価器の status と ClauseGraph + ctx を受けて、例外節を当てる（Sprint 11d で二つに分けた）。
 *
 *   - 対象外にする例外（weight_below_g・in_zone）が当たる：status を green にし、appliedExceptions に記録、
 *     note の末尾に「※適用例外: …」を足す。
 *   - 満たす例外（permit_holder・permit_holder_all・purpose）が当たる：status と note は変えず、
 *     satisfiedBy に記録する（判定は deriveFlightVerdict が手続き済み（条件付き）にする）。
 *   - noFly（飛行不可の区分。空港の敷地内）：満たす例外は当てない。
 *   - green / unknown：何も当てない。
 */
export const applyExemptions = (
  base: { status: RegulationStatus; note: string; clauseGraph: ClauseGraph },
  ctx: FlightContext | undefined,
  opts: { readonly noFly?: boolean } = {},
): {
  status: RegulationStatus;
  note: string;
  appliedExceptions?: readonly ClauseException[];
  satisfiedBy?: readonly ClauseException[];
  noFlyCategory?: boolean;
} => {
  const noFly = opts.noFly === true ? { noFlyCategory: true } : {};
  if (base.status !== "red" && base.status !== "yellow") {
    return { status: base.status, note: base.note, ...noFly };
  }
  const excluded = findExcludingExceptions(base.clauseGraph, ctx);
  if (excluded.length > 0) {
    const reasons = excluded.map((m) => m.condition).join(" / ");
    return {
      status: "green",
      note: `${base.note} ※適用例外: ${reasons}`,
      appliedExceptions: excluded,
    };
  }
  if (opts.noFly === true) {
    return { status: base.status, note: base.note, ...noFly };
  }
  const satisfied = findSatisfyingExceptions(base.clauseGraph, ctx);
  return {
    status: base.status,
    note: base.note,
    ...(satisfied.length > 0 ? { satisfiedBy: satisfied } : {}),
  };
};
