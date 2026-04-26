import { haversineMeters, pointInPolygon, type LatLng, type Polygon } from "@soraban/geo";
import type { ClauseGraph } from "./clause-graph";
import type { ConfidenceLevel, RegulationConfidence } from "./confidence";
import {
  MIHO_AIRBASE_CENTER,
  MIHO_AIRBASE_RED_M,
  MIHO_AIRBASE_YELLOW_M,
  YONAGO_PARKS,
} from "./zones";

export type RegulationSource = "国" | "都道府県" | "市町村";

export type RegulationStatus = "red" | "yellow" | "green" | "unknown";

export type Regulation = {
  readonly id: string;
  readonly source: RegulationSource;
  readonly authority: string;
  readonly title: string;
  readonly summary: string;
  readonly url?: string;
  readonly dataYear?: number;
  readonly clauseGraph: ClauseGraph;
  readonly confidence: RegulationConfidence;
};

export type RegulationWithStatus = Regulation & {
  readonly status: RegulationStatus;
  readonly note: string;
};

export type RegulationCheckResult = {
  readonly overall: RegulationStatus;
  readonly overallConfidence: ConfidenceLevel;
  readonly regulations: readonly RegulationWithStatus[];
  readonly checkedAt: string;
  readonly resolvedAddress?: string;
  readonly muniCode?: string;
  readonly evidenceId: string;
  readonly engineVersion: string;
  readonly disclaimer: string;
};

export type DidCandidate = {
  readonly muniCode: string;
  readonly muniName: string;
  readonly polygon: Polygon;
};

export type AirportCandidate = {
  readonly id: string;
  readonly name: string;
  readonly polygons: readonly Polygon[];
  readonly center: LatLng;
};

export const AIRPORT_AROUND_M = 6000;

const DID_REG: Regulation = {
  id: "aviation-law-did",
  source: "国",
  authority: "国土交通省",
  title: "航空法第132条 — 人口集中地区(DID)上空の飛行",
  summary:
    "国勢調査に基づく人口集中地区（DID）の上空での無人航空機の飛行は、原則として国土交通大臣の許可・承認が必要です。",
  url: "https://www.mlit.go.jp/koku/koku_fr10_000041.html",
  dataYear: 2015,
  clauseGraph: {
    main: {
      text:
        "国勢調査に基づく人口集中地区（DID）の上空において、無人航空機の飛行は原則として国土交通大臣の許可・承認を要する。",
      effect: "requires_application",
    },
    exceptions: [
      {
        id: "did-ex-weight-100g",
        condition: "機体重量が100g未満の場合は航空法上の無人航空機に該当しない",
        effect: "permit",
        machine: { type: "weight_below_g", value: 100 },
      },
      {
        id: "did-ex-permit",
        condition: "国土交通大臣の許可・承認を取得している場合",
        effect: "permit",
        machine: { type: "permit_holder", value: "mlit" },
      },
    ],
    conditions: [
      {
        id: "did-cond-zone",
        description: "判定地点がDIDポリゴン内に含まれること",
        machine: { type: "in_zone", value: "did" },
      },
    ],
  },
  confidence: {
    geometric: "high",
    extraction: "high",
    verifiedAt: "2025-12-01T00:00:00+09:00",
  },
};

const MIHO_REG: Regulation = {
  id: "miho-airbase-no-fly",
  source: "国",
  authority: "防衛省・警察庁",
  title: "小型無人機等飛行禁止法 — 自衛隊美保基地周辺",
  summary:
    "自衛隊美保基地は重要施設として小型無人機等飛行禁止法の対象。基地敷地および周囲おおむね 300m 上空での飛行は禁止されています。",
  url: "https://www.npa.go.jp/bureau/security/kogata_muzin/index.html",
  clauseGraph: {
    main: {
      text:
        "対象施設の敷地および周囲おおむね300m上空での小型無人機等の飛行を禁止する。",
      effect: "deny",
    },
    exceptions: [
      {
        id: "miho-ex-notice",
        condition:
          "対象施設の管理者の同意を得たうえで、都道府県公安委員会へ事前通報を行った場合",
        effect: "permit",
        machine: { type: "permit_holder", value: "facility_manager_and_pref_pubsafety" },
      },
    ],
    conditions: [
      {
        id: "miho-cond-300m",
        description: "対象施設の敷地境界からおおむね300m以内であること",
        machine: { type: "in_zone", value: "300m_buffer" },
      },
    ],
  },
  confidence: {
    geometric: "medium",
    extraction: "high",
    verifiedAt: "2026-04-25T00:00:00+09:00",
  },
};

const AIRPORT_REG: Regulation = {
  id: "aviation-law-airport",
  source: "国",
  authority: "国土交通省",
  title: "航空法 — 空港等の周辺における飛行",
  summary:
    "空港等の周辺（進入表面・転移表面・水平表面の上空）での無人航空機の飛行は、原則として国土交通大臣の許可が必要です。",
  url: "https://www.mlit.go.jp/koku/koku_fr10_000041.html",
  dataYear: 2020,
  clauseGraph: {
    main: {
      text:
        "空港等の周辺（進入表面・転移表面・水平表面の上空）における無人航空機の飛行は、国土交通大臣の許可を要する。",
      effect: "requires_application",
    },
    exceptions: [
      {
        id: "airport-ex-weight-100g",
        condition: "機体重量が100g未満の場合は航空法上の無人航空機に該当しない",
        effect: "permit",
        machine: { type: "weight_below_g", value: 100 },
      },
    ],
    conditions: [
      {
        id: "airport-cond-zone",
        description: "進入表面等の上空に該当すること（PoC では半径6kmの簡易バッファで判定）",
        machine: { type: "in_zone", value: "approach_surface_buffer" },
      },
    ],
  },
  confidence: {
    geometric: "medium",
    extraction: "high",
    verifiedAt: "2026-04-25T00:00:00+09:00",
  },
};

const YONAGO_PARK_REG: Regulation = {
  id: "yonago-park-ordinance",
  source: "市町村",
  authority: "米子市",
  title: "米子市都市公園条例 — 都市公園内での無人航空機の使用",
  summary:
    "米子市内の都市公園内では、利用者の安全確保のため無人航空機（ドローン）の飛行は原則として禁止または事前申請が必要です。",
  url: "https://www.city.yonago.lg.jp/",
  clauseGraph: {
    main: {
      text:
        "都市公園内における無人航空機（ドローン等）の飛行又は使用は禁止する。",
      effect: "deny",
    },
    exceptions: [
      {
        id: "yonago-park-ex-permit",
        condition: "都市公園の管理者の許可を受けた場合は、この限りでない。",
        effect: "permit",
        machine: { type: "permit_holder", value: "park_manager" },
      },
      {
        id: "yonago-park-ex-event",
        condition: "市が主催し、又は後援する行事のために行う飛行",
        effect: "permit",
        machine: { type: "purpose", value: "city_event" },
      },
    ],
    conditions: [
      {
        id: "yonago-park-cond-zone",
        description: "判定地点が米子市内の都市公園区域に含まれること",
        machine: { type: "in_zone", value: "yonago_park_polygon" },
      },
    ],
  },
  confidence: {
    geometric: "low",
    extraction: "medium",
    verifiedAt: "2026-04-25T00:00:00+09:00",
  },
};

export const evaluateDid = (
  loc: LatLng,
  candidates: readonly DidCandidate[],
): RegulationWithStatus => {
  const hit = candidates.find((c) => pointInPolygon(loc, c.polygon));
  if (hit) {
    return {
      ...DID_REG,
      status: "red",
      note: `判定地点は ${hit.muniName} の DID（人口集中地区, 平成27年国勢調査）内です。原則として許可・承認なく飛行できません。`,
    };
  }
  return {
    ...DID_REG,
    status: "green",
    note: "判定地点は平成27年国勢調査ベースの DID 外です。最新は国土交通省 DIPS で要再確認。",
  };
};

export const evaluateAirports = (
  loc: LatLng,
  airports: readonly AirportCandidate[],
): RegulationWithStatus => {
  const onAirport = airports.find((a) =>
    a.polygons.some((p) => pointInPolygon(loc, p)),
  );
  if (onAirport) {
    return {
      ...AIRPORT_REG,
      status: "red",
      note: `判定地点は ${onAirport.name} の敷地内です。航空法に基づき、許可・承認なしに飛行できません。`,
    };
  }
  let nearest: { name: string; distance: number } | null = null;
  for (const a of airports) {
    const d = haversineMeters(loc, a.center);
    if (nearest === null || d < nearest.distance) nearest = { name: a.name, distance: d };
  }
  if (nearest !== null && nearest.distance <= AIRPORT_AROUND_M) {
    return {
      ...AIRPORT_REG,
      status: "yellow",
      note: `最寄りの ${nearest.name} までおよそ ${(nearest.distance / 1000).toFixed(1)} km。空港等周辺の進入表面・水平表面（半径6km の概算）に該当する可能性があります。`,
    };
  }
  if (nearest !== null) {
    return {
      ...AIRPORT_REG,
      status: "green",
      note: `最寄りの ${nearest.name} までおよそ ${(nearest.distance / 1000).toFixed(1)} km。空港等周辺の制限対象外と判定。`,
    };
  }
  return {
    ...AIRPORT_REG,
    status: "unknown",
    note: "空港データを読み込めませんでした。",
  };
};

export const evaluateMihoBase = (loc: LatLng): RegulationWithStatus => {
  const distance = haversineMeters(loc, MIHO_AIRBASE_CENTER);
  if (distance <= MIHO_AIRBASE_RED_M) {
    return {
      ...MIHO_REG,
      status: "red",
      note: `判定地点は美保基地中心からおよそ ${Math.round(distance)} m。小型無人機等飛行禁止法の対象範囲（おおむね 300m）に含まれます。`,
    };
  }
  if (distance <= MIHO_AIRBASE_YELLOW_M) {
    return {
      ...MIHO_REG,
      status: "yellow",
      note: `判定地点は美保基地中心からおよそ ${Math.round(distance)} m。空港周辺の進入表面・要確認エリアに該当する可能性があります。`,
    };
  }
  return {
    ...MIHO_REG,
    status: "green",
    note: `判定地点は美保基地中心からおよそ ${(distance / 1000).toFixed(1)} km 離れており、小型無人機等飛行禁止法の対象外です。`,
  };
};

const YONAGO_MUNI_CODE = "31202";

export const evaluateYonagoParks = (
  loc: LatLng,
  muniCode: string | undefined,
): RegulationWithStatus => {
  if (muniCode !== YONAGO_MUNI_CODE) {
    return {
      ...YONAGO_PARK_REG,
      status: "unknown",
      note: "判定地点は米子市外です。当該市町村の都市公園条例データは未整備のため判定できません（Phase 0 では米子市のみ対応）。",
    };
  }
  const hit = YONAGO_PARKS.find((p) => pointInPolygon(loc, p.polygon));
  if (hit) {
    return {
      ...YONAGO_PARK_REG,
      status: "red",
      note: `判定地点は「${hit.name}」内です。米子市都市公園条例に基づき、原則飛行禁止または事前申請が必要です。`,
    };
  }
  return {
    ...YONAGO_PARK_REG,
    status: "green",
    note: "判定地点は登録された米子市内の都市公園ポリゴン外です（Phase 0 のデータは2公園のみ。最終確認は米子市公園台帳で）。",
  };
};

export const computeOverall = (
  items: readonly RegulationWithStatus[],
): RegulationStatus => {
  const known = items.filter((r) => r.status !== "unknown");
  if (known.length === 0) return "unknown";
  if (known.some((r) => r.status === "red")) return "red";
  if (known.some((r) => r.status === "yellow")) return "yellow";
  return "green";
};

// 全規制の確信度を集約。判定に効いた（unknown 以外）レコードのうち、
// もっとも低い確信度を全体の確信度とする（弱い鎖が全体を律速する）。
export const computeOverallConfidence = (
  items: readonly RegulationWithStatus[],
): ConfidenceLevel => {
  const order: Readonly<Record<ConfidenceLevel, number>> = { low: 0, medium: 1, high: 2 };
  const known = items.filter((r) => r.status !== "unknown");
  if (known.length === 0) return "low";
  let worst: ConfidenceLevel = "high";
  for (const r of known) {
    const min: ConfidenceLevel =
      order[r.confidence.geometric] <= order[r.confidence.extraction]
        ? r.confidence.geometric
        : r.confidence.extraction;
    if (order[min] < order[worst]) worst = min;
  }
  return worst;
};

export const STATUS_LABEL: Readonly<Record<RegulationStatus, string>> = {
  red: "飛行不可",
  yellow: "要確認・要許可",
  green: "飛行可能",
  unknown: "判定不能（未整備）",
};

export const SOURCE_LABEL: Readonly<Record<RegulationSource, string>> = {
  国: "国",
  都道府県: "都道府県",
  市町村: "市町村",
};

export const DEFAULT_DISCLAIMER =
  "本ツールは参考情報であり、飛行可否を最終的に保証するものではありません。実運用前に必ず国土交通省 DIPS、警察庁、各自治体の最新情報をご確認ください。";

export {
  MIHO_AIRBASE_CENTER,
  MIHO_AIRBASE_RED_M,
  MIHO_AIRBASE_YELLOW_M,
  YONAGO_PARKS,
} from "./zones";
export type { Park } from "./zones";

export type {
  ClauseEffect,
  ClauseException,
  ClauseCondition,
  ClauseGraph,
  MachineCondition,
  MachineConditionType,
} from "./clause-graph";
export { CLAUSE_EFFECT_LABEL } from "./clause-graph";

export type { ConfidenceLevel, RegulationConfidence } from "./confidence";
export { CONFIDENCE_LABEL, summarizeConfidence } from "./confidence";
