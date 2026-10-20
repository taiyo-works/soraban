import {
  distanceToPolygonBoundaryMeters,
  haversineMeters,
  pointInPolygon,
  pointInPolygonWithHoles,
  type LatLng,
  type Polygon,
} from "@soraban/geo";
import type { FlightContext } from "./clause-graph";
import type { ConfidenceLevel } from "./confidence";
import {
  applyExemptions,
  type DidDetail,
  type Regulation,
  type RegulationSource,
  type RegulationStatus,
  type RegulationWithStatus,
} from "./core";
import {
  AMENDMENT_MLIT_KOKUJI_435,
  DATASET_IDS,
  datasetRef,
} from "./datasets";
import type { DidCandidate, DidDataset } from "./did-data";
import {
  DEFAULT_INDUSTRIAL_SOURCE,
  type IndustrialExclusiveSource,
  type IndustrialZone,
} from "./industrial-exclusive";
import { evaluateSmallDroneLaw } from "./small-drone-law";
import type { FlightVerdict } from "./verdict";
import {
  ALL_SENSITIVE_FACILITIES,
  IZUMO_HERITAGE_SITES,
  IZUMO_PARKS,
  KURAYOSHI_HERITAGE_SITES,
  KURAYOSHI_PARKS,
  MATSUE_HERITAGE_SITES,
  MATSUE_PARKS,
  MISASA_HERITAGE_SITES,
  MISASA_PARKS,
  OHDA_HERITAGE_SITES,
  OHDA_PARKS,
  SAKAIMINATO_PARKS,
  SENSITIVE_FACILITY_BUFFER_M,
  TOTTORI_HERITAGE_SITES,
  TOTTORI_PARKS,
  UNNAN_HERITAGE_SITES,
  UNNAN_PARKS,
  YASUGI_HERITAGE_SITES,
  YASUGI_PARKS,
  YAZU_PARKS,
  YONAGO_HERITAGE_SITES,
  YONAGO_PARKS,
  YURIHAMA_HERITAGE_SITES,
  YURIHAMA_PARKS,
  type HeritageSite,
  type Park,
} from "./zones";

export type RegulationCheckResult = {
  /**
   * 元の判定の集約（computeOverall）。互換のため残す。0.4.0 からは許可を当てる前の元の判定から求める。
   * 画面の結論は verdict（4 段）を使う。
   */
  readonly overall: RegulationStatus;
  /** 判定（4 段＋判定不能。Sprint 11d）。地点だけの判定（飛行の方法なし）。 */
  readonly verdict?: FlightVerdict;
  readonly overallConfidence: ConfidenceLevel;
  readonly regulations: readonly RegulationWithStatus[];
  readonly checkedAt: string;
  readonly resolvedAddress?: string;
  readonly muniCode?: string;
  readonly evidenceId: string;
  readonly engineVersion: string;
  readonly disclaimer: string;
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
  title: "航空法第132条の85第1項第2号 — 人口集中地区(DID)上空の飛行",
  summary:
    "国勢調査に基づく人口集中地区（DID）の上空での無人航空機の飛行は、原則として国土交通大臣の許可・承認が必要です。",
  url: "https://www.mlit.go.jp/koku/koku_fr10_000041.html",
  legalTier: 1,
  dataYear: 2020,
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
        // Sprint 11d：DIPS の許可・承認を種類ごとに入力する。旧値 mlit は mlit:did として読む（LEGACY_PERMIT_ALIASES）。
        machine: { type: "permit_holder", value: "mlit:did" },
      },
      {
        id: "did-ex-industrial-exclusive",
        condition:
          "都市計画法第8条第1項第1号の工業専用地域内の区域（国土交通省告示第435号、2026-07-01 適用）では DID の飛行許可は不要",
        effect: "permit",
        machine: { type: "in_zone", value: "industrial_exclusive" },
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
    verifiedAt: "2026-10-19T00:00:00+09:00",
  },
  datasets: [datasetRef(DATASET_IDS.did), datasetRef(DATASET_IDS.industrialExclusive)],
  amendments: [AMENDMENT_MLIT_KOKUJI_435],
};

const AIRPORT_REG: Regulation = {
  id: "aviation-law-airport",
  source: "国",
  authority: "国土交通省",
  title: "航空法第132条の85第1項第1号 — 空港等の周辺における飛行",
  summary:
    "空港等の周辺（進入表面・転移表面・水平表面の上空）での無人航空機の飛行は、原則として国土交通大臣の許可が必要です。",
  url: "https://www.mlit.go.jp/koku/koku_fr10_000041.html",
  legalTier: 1,
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
        description: "進入表面等の上空に該当すること（現在は半径6kmの簡易バッファで判定）",
        machine: { type: "in_zone", value: "approach_surface_buffer" },
      },
    ],
  },
  confidence: {
    geometric: "medium",
    extraction: "high",
    verifiedAt: "2026-04-25T00:00:00+09:00",
  },
  datasets: [datasetRef(DATASET_IDS.airports)],
  amendments: [],
};

// 文化財保護法第125条 + 自治体文化財保護条例も自治体ごとに構造が同形のため、
// テンプレ関数で Regulation を生成する。authority のみ自治体名を差し込む。
const buildMunicipalHeritageReg = (params: {
  readonly muniCode: string;
  readonly muniName: string;
  readonly verifiedAt: string;
}): Regulation => ({
  id: `${params.muniCode}-heritage-protection`,
  source: "市町村",
  authority: `${params.muniName}教育委員会・文化庁`,
  title: `文化財保護法第125条 / ${params.muniName}文化財保護条例 — 史跡内の現状変更`,
  summary: `${params.muniName}内の国指定史跡では、文化財保護法第125条により現状変更には文化庁長官（実務上は教育委員会経由）の許可が必要。市指定文化財も${params.muniName}文化財保護条例で同様の規制があります。ドローン飛行に伴う墜落・離着陸・低空通過は史跡毀損リスクとして規制対象になり得ます。`,
  url: "https://www.bunka.go.jp/seisaku/bunkazai/shokai/shiseki/index.html",
  legalTier: 1,
  clauseGraph: {
    main: {
      text:
        "国指定史跡の現状を変更し、又はその保存に影響を及ぼす行為をしようとするときは、文化庁長官の許可を受けなければならない。",
      effect: "requires_application",
    },
    exceptions: [
      {
        id: `${params.muniCode}-heritage-ex-permit`,
        condition: "文化庁長官の許可（市指定の場合は教育委員会の許可）を取得している場合",
        effect: "permit",
        machine: { type: "permit_holder", value: "bunkacho_or_kyoiku" },
      },
      {
        id: `${params.muniCode}-heritage-ex-emergency`,
        condition: "災害復旧・人命救助等の緊急行為",
        effect: "permit",
        machine: { type: "purpose", value: "emergency" },
      },
    ],
    conditions: [
      {
        id: `${params.muniCode}-heritage-cond-zone`,
        description: "判定地点が指定史跡区域内に含まれること",
        machine: { type: "in_zone", value: "municipal_heritage_polygon" },
      },
    ],
  },
  confidence: {
    geometric: "low",
    extraction: "low",
    verifiedAt: params.verifiedAt,
  },
  datasets: [datasetRef(DATASET_IDS.heritage)],
  amendments: [],
});

// 都道府県迷惑行為等防止条例も同形（鳥取県・島根県とも条文構造はほぼ一致）。
// authority と reiki URL のみ差し替えてテンプレ生成する。
const buildPrefecturalNuisanceReg = (params: {
  readonly prefCode: string;
  readonly prefName: string;
  readonly url: string;
  readonly verifiedAt: string;
}): Regulation => ({
  id: `${params.prefCode}-pref-nuisance-prevention`,
  source: "都道府県",
  authority: params.prefName,
  title: `${params.prefName}迷惑行為等防止条例 — 公衆密集地周辺での迷惑行為`,
  summary: `${params.prefName}迷惑行為等防止条例では、公衆に著しい迷惑をかける行為を禁じています。病院・学校・庁舎・駅・温泉街など公衆密集地周辺での無人航空機の飛行は、騒音・落下リスクの観点から自粛・事前調整が推奨されます。`,
  url: params.url,
  legalTier: 2,
  clauseGraph: {
    main: {
      text:
        "公衆に著しく迷惑をかける行為（騒音・粗野な行為等）をしてはならない。",
      effect: "deny",
    },
    exceptions: [
      {
        id: `${params.prefCode}-nuisance-ex-permit`,
        condition: "施設管理者・自治体担当部署と事前調整し、合意を得た場合",
        effect: "permit",
        machine: { type: "permit_holder", value: "facility_manager" },
      },
      {
        id: `${params.prefCode}-nuisance-ex-public`,
        condition: "警察・消防・自治体等の公務として行う飛行",
        effect: "permit",
        machine: { type: "purpose", value: "public_duty" },
      },
    ],
    conditions: [
      {
        id: `${params.prefCode}-nuisance-cond-buffer`,
        description:
          "判定地点が病院・学校・庁舎・駅・温泉街等の公衆密集施設からおおむね100m以内であること",
        machine: { type: "in_zone", value: "sensitive_facility_buffer" },
      },
    ],
  },
  confidence: {
    geometric: "low",
    extraction: "low",
    verifiedAt: params.verifiedAt,
  },
  datasets: [datasetRef(DATASET_IDS.sensitiveFacilities)],
  amendments: [],
});

// 都市公園条例は自治体ごとに条文・例外節がほぼ同形のため、
// 同じテンプレートから自治体名差し替えで Regulation を生成する。
// 自治体固有の条例 URL や verifiedAt はテンプレ呼び出し時に上書きする。
const buildMunicipalParkReg = (params: {
  readonly muniCode: string;
  readonly muniName: string;
  readonly url: string;
  readonly verifiedAt: string;
}): Regulation => ({
  id: `${params.muniCode}-park-ordinance`,
  source: "市町村",
  authority: params.muniName,
  title: `${params.muniName}都市公園条例 — 都市公園内での無人航空機の使用`,
  summary: `${params.muniName}内の都市公園内では、利用者の安全確保のため無人航空機（ドローン）の飛行は原則として禁止または事前申請が必要です。`,
  url: params.url,
  legalTier: 2,
  clauseGraph: {
    main: {
      text:
        "都市公園内における無人航空機（ドローン等）の飛行又は使用は禁止する。",
      effect: "deny",
    },
    exceptions: [
      {
        id: `${params.muniCode}-park-ex-permit`,
        condition: "都市公園の管理者の許可を受けた場合は、この限りでない。",
        effect: "permit",
        machine: { type: "permit_holder", value: "park_manager" },
      },
      {
        id: `${params.muniCode}-park-ex-event`,
        condition: "市が主催し、又は後援する行事のために行う飛行",
        effect: "permit",
        machine: { type: "purpose", value: "city_event" },
      },
    ],
    conditions: [
      {
        id: `${params.muniCode}-park-cond-zone`,
        description: `判定地点が${params.muniName}内の都市公園区域に含まれること`,
        machine: { type: "in_zone", value: "municipal_park_polygon" },
      },
    ],
  },
  confidence: {
    geometric: "low",
    extraction: "medium",
    verifiedAt: params.verifiedAt,
  },
  datasets: [datasetRef(DATASET_IDS.parks)],
  amendments: [],
});

const TOTTORI_PARK_REG = buildMunicipalParkReg({
  muniCode: "31201",
  muniName: "鳥取市",
  url: "https://www.city.tottori.lg.jp/",
  verifiedAt: "2026-04-30T00:00:00+09:00",
});

const YONAGO_PARK_REG = buildMunicipalParkReg({
  muniCode: "31202",
  muniName: "米子市",
  url: "https://www.city.yonago.lg.jp/",
  verifiedAt: "2026-04-25T00:00:00+09:00",
});

const KURAYOSHI_PARK_REG = buildMunicipalParkReg({
  muniCode: "31203",
  muniName: "倉吉市",
  url: "https://www.city.kurayoshi.lg.jp/",
  verifiedAt: "2026-04-30T00:00:00+09:00",
});

const SAKAIMINATO_PARK_REG = buildMunicipalParkReg({
  muniCode: "31204",
  muniName: "境港市",
  url: "https://www.city.sakaiminato.lg.jp/",
  verifiedAt: "2026-04-29T00:00:00+09:00",
});

const MATSUE_PARK_REG = buildMunicipalParkReg({
  muniCode: "32201",
  muniName: "松江市",
  url: "https://www.city.matsue.lg.jp/",
  verifiedAt: "2026-04-30T00:00:00+09:00",
});

const IZUMO_PARK_REG = buildMunicipalParkReg({
  muniCode: "32203",
  muniName: "出雲市",
  url: "https://www.city.izumo.shimane.jp/",
  verifiedAt: "2026-04-29T00:00:00+09:00",
});

const MISASA_PARK_REG = buildMunicipalParkReg({
  muniCode: "31364",
  muniName: "三朝町",
  url: "https://www.town.misasa.tottori.jp/",
  verifiedAt: "2026-04-30T00:00:00+09:00",
});

const YURIHAMA_PARK_REG = buildMunicipalParkReg({
  muniCode: "31370",
  muniName: "湯梨浜町",
  url: "https://www.yurihama.jp/",
  verifiedAt: "2026-04-30T00:00:00+09:00",
});

const YAZU_PARK_REG = buildMunicipalParkReg({
  muniCode: "31329",
  muniName: "八頭町",
  url: "https://www.town.yazu.tottori.jp/",
  verifiedAt: "2026-04-30T00:00:00+09:00",
});

const YASUGI_PARK_REG = buildMunicipalParkReg({
  muniCode: "32206",
  muniName: "安来市",
  url: "https://www.city.yasugi.shimane.jp/",
  verifiedAt: "2026-04-30T00:00:00+09:00",
});

const UNNAN_PARK_REG = buildMunicipalParkReg({
  muniCode: "32209",
  muniName: "雲南市",
  url: "https://www.city.unnan.shimane.jp/",
  verifiedAt: "2026-04-30T00:00:00+09:00",
});

const OHDA_PARK_REG = buildMunicipalParkReg({
  muniCode: "32205",
  muniName: "大田市",
  url: "https://www.city.ohda.lg.jp/",
  verifiedAt: "2026-04-30T00:00:00+09:00",
});

const TOTTORI_HERITAGE_REG = buildMunicipalHeritageReg({
  muniCode: "31201",
  muniName: "鳥取市",
  verifiedAt: "2026-04-30T00:00:00+09:00",
});

const YONAGO_HERITAGE_REG = buildMunicipalHeritageReg({
  muniCode: "31202",
  muniName: "米子市",
  verifiedAt: "2026-04-26T00:00:00+09:00",
});

const KURAYOSHI_HERITAGE_REG = buildMunicipalHeritageReg({
  muniCode: "31203",
  muniName: "倉吉市",
  verifiedAt: "2026-04-30T00:00:00+09:00",
});

const MATSUE_HERITAGE_REG = buildMunicipalHeritageReg({
  muniCode: "32201",
  muniName: "松江市",
  verifiedAt: "2026-04-30T00:00:00+09:00",
});

const IZUMO_HERITAGE_REG = buildMunicipalHeritageReg({
  muniCode: "32203",
  muniName: "出雲市",
  verifiedAt: "2026-04-29T00:00:00+09:00",
});

const MISASA_HERITAGE_REG = buildMunicipalHeritageReg({
  muniCode: "31364",
  muniName: "三朝町",
  verifiedAt: "2026-04-30T00:00:00+09:00",
});

const YURIHAMA_HERITAGE_REG = buildMunicipalHeritageReg({
  muniCode: "31370",
  muniName: "湯梨浜町",
  verifiedAt: "2026-04-30T00:00:00+09:00",
});

const YASUGI_HERITAGE_REG = buildMunicipalHeritageReg({
  muniCode: "32206",
  muniName: "安来市",
  verifiedAt: "2026-04-30T00:00:00+09:00",
});

const UNNAN_HERITAGE_REG = buildMunicipalHeritageReg({
  muniCode: "32209",
  muniName: "雲南市",
  verifiedAt: "2026-04-30T00:00:00+09:00",
});

const OHDA_HERITAGE_REG = buildMunicipalHeritageReg({
  muniCode: "32205",
  muniName: "大田市",
  verifiedAt: "2026-04-30T00:00:00+09:00",
});

const TOTTORI_NUISANCE_REG = buildPrefecturalNuisanceReg({
  prefCode: "31",
  prefName: "鳥取県",
  url: "https://www1.g-reiki.net/tottori/",
  verifiedAt: "2026-04-26T00:00:00+09:00",
});

const SHIMANE_NUISANCE_REG = buildPrefecturalNuisanceReg({
  prefCode: "32",
  prefName: "島根県",
  url: "https://www1.g-reiki.net/pref-shimane/",
  verifiedAt: "2026-04-29T00:00:00+09:00",
});

export type EvaluateDidOptions = {
  /** 工業専用地域データの読み込み口。未指定は同梱データ（DEFAULT_INDUSTRIAL_SOURCE）。 */
  readonly industrial?: IndustrialExclusiveSource;
  /** DID データの基準年（note の表記用）。未指定は 2020（令和2年国勢調査）。 */
  readonly baseYear?: number | null;
};

const didYearLabel = (baseYear: number | null | undefined): string =>
  baseYear === 2020 || baseYear === undefined
    ? "令和2年国勢調査"
    : baseYear === null
      ? "基準年不明のデータ"
      : `${baseYear}年国勢調査`;

/** 工業専用地域の除外が未確認（データ未収録）の場合に note・UI に出す文言。 */
export const INDUSTRIAL_EXCLUSION_UNVERIFIED_NOTE =
  "工業専用地域の除外：未確認（データ未収録）。工業専用地域内であれば DID の飛行許可は不要。市の用途地域図で確認してください。";

/**
 * 航空法の DID（人口集中地区）判定。工業専用地域（国土交通省告示第435号、2026-07-01 適用）を差し引く。
 *
 *   1. DID データなし → unknown（未確認）
 *   2. DID 外 → green（非該当）
 *   3. DID 内・当該市町村の工業専用地域が収録済み・境界から内側余裕（既定 10m）以上内側 → green（非該当（工業専用地域））
 *   4. DID 内・収録済み・工業専用地域外、または境界から内側余裕未満 → red（該当。境界付近はその旨を note に出す）
 *   5. DID 内・当該市町村の工業専用地域が未収録 → red（該当として扱う）＋「工業専用地域の除外：未確認」
 *
 * candidates には DidCandidate[]（後方互換）または DidDataset を渡せる。
 */
export const evaluateDid = (
  loc: LatLng,
  candidates: readonly DidCandidate[] | DidDataset | null,
  ctx?: FlightContext,
  opts?: EvaluateDidOptions,
): RegulationWithStatus => {
  // DID ポリゴンデータ自体が読み込めない（未整備・未配置・都道府県不明）場合は
  // 「DID 外 = green」と断定せず unknown（未確認）に倒す（フェイルセーフ）。
  if (candidates === null) {
    return {
      ...DID_REG,
      status: "unknown",
      didDetail: "no_data",
      note: "DID（人口集中地区）データを読み込めないため、DID 該当／非該当を確認できません（未確認）。地理院地図・DIPS で必ず確認してください。",
    };
  }
  const list: readonly DidCandidate[] = Array.isArray(candidates)
    ? candidates
    : (candidates as DidDataset).candidates;
  const baseYear = Array.isArray(candidates)
    ? opts?.baseYear
    : ((candidates as DidDataset).baseYear ?? opts?.baseYear ?? null);
  const yearLabel = didYearLabel(baseYear);
  const hit = list.find((c) => pointInPolygon(loc, c.polygon));
  if (!hit) {
    return {
      ...DID_REG,
      status: "green",
      didDetail: "outside_did",
      note: `判定地点は DID（人口集中地区、${yearLabel}）の外です（非該当）。最新は国土交通省 DIPS・地理院地図で要再確認。`,
    };
  }

  const industrial = opts?.industrial ?? DEFAULT_INDUSTRIAL_SOURCE;
  const coverage = industrial.coverage(hit.muniCode);
  const inDidPrefix = `判定地点は ${hit.muniName} の DID（人口集中地区、${yearLabel}）内です。`;
  const margin = industrial.insideMarginM;
  const zoneMuniName = (code: string): string => industrial.coverage(code)?.muniName ?? code;

  // 地点を含む工専を、DID の市町村に限らず収録済みの全市町村から探す（市町村境をまたぐ重なりに対応）。
  // 複数に含まれる場合は境界から最も深いものを採る。
  let inside: { zone: IndustrialZone; depth: number } | null = null;
  for (const z of industrial.allZones()) {
    if (!pointInPolygonWithHoles(loc, z.rings)) continue;
    const depth = distanceToPolygonBoundaryMeters(loc, z.rings);
    if (inside === null || depth > inside.depth) inside = { zone: z, depth };
  }

  let status: RegulationStatus;
  let note: string;
  let didDetail: DidDetail;
  if (inside && inside.depth >= margin) {
    // 分岐 3: 工業専用地域の内側 → 非該当（工業専用地域）。
    const zName = zoneMuniName(inside.zone.muniCode);
    return {
      ...DID_REG,
      status: "green",
      didDetail: "industrial_exclusive",
      note: `${inDidPrefix}ただし ${zName} の工業専用地域内（境界から内側におよそ ${Math.floor(inside.depth)}m）のため、DID の飛行許可は不要です（非該当（工業専用地域）。国土交通省告示第435号、2026-07-01 適用）。空港等周辺・150m 以上の飛行許可と、夜間・目視外などの飛行の方法の承認は別途必要です。緊急用務空域は原則として飛行禁止で、指定中は他の飛行許可があっても飛行できません。この判定は地点単位であり、飛行範囲全体が工業専用地域内かは別途確認してください。`,
    };
  }
  if (inside) {
    // 分岐 4（境界付近）: 工専の内側だが内側余裕未満 → 除外せず該当（安全側）。
    status = "red";
    didDetail = "in_did_near_industrial_boundary";
    note = `${inDidPrefix}${zoneMuniName(inside.zone.muniCode)} の工業専用地域の境界から内側およそ ${Math.floor(inside.depth)}m で、境界付近（内側 ${margin}m 未満）のため除外せず該当として扱います。原則として許可・承認なく飛行できません。`;
  } else if (coverage?.status !== "recorded") {
    // 分岐 5: 当該市町村の工業専用地域が未収録 → 該当として扱い、除外は未確認と明示（縮退表示）。
    status = "red";
    didDetail = "in_did_exclusion_unverified";
    note = `${inDidPrefix}原則として許可・承認なく飛行できません。${INDUSTRIAL_EXCLUSION_UNVERIFIED_NOTE}`;
  } else {
    // 分岐 4: 収録済みの工業専用地域のいずれにも含まれない。
    status = "red";
    didDetail = "in_did";
    note = `${inDidPrefix}収録済みの工業専用地域（${hit.muniName} を含む）のいずれにも含まれません。原則として許可・承認なく飛行できません。`;
  }
  // 工業専用地域の permit 例外節は位置で判定済みのため、ctx の例外照合は重量・許可のみが効く。
  return {
    ...DID_REG,
    didDetail,
    ...applyExemptions({ status, note, clauseGraph: DID_REG.clauseGraph }, ctx),
  };
};

export const evaluateAirports = (
  loc: LatLng,
  airports: readonly AirportCandidate[],
  ctx?: FlightContext,
): RegulationWithStatus => {
  const onAirport = airports.find((a) =>
    a.polygons.some((p) => pointInPolygon(loc, p)),
  );
  if (onAirport) {
    return {
      ...AIRPORT_REG,
      ...applyExemptions(
        {
          status: "red",
          note: `判定地点は ${onAirport.name} の敷地内です。空港の敷地内は飛行できません（許可・同意を入力しても変わりません）。`,
          clauseGraph: AIRPORT_REG.clauseGraph,
        },
        ctx,
        // 空港の敷地内は飛行不可の区分（Sprint 11d A4）。満たす例外を当てない。
        { noFly: true },
      ),
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
      ...applyExemptions(
        {
          status: "yellow",
          note: `最寄りの ${nearest.name} までおよそ ${(nearest.distance / 1000).toFixed(1)} km。空港等周辺の進入表面・水平表面（半径6km の概算）に該当する可能性があります。`,
          clauseGraph: AIRPORT_REG.clauseGraph,
        },
        ctx,
      ),
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

/**
 * @deprecated Sprint 7 で evaluateSmallDroneLaw（対象施設データ・敷地境界から 1,000m）に置き換え。
 * 後方互換のため残す（美保基地だけでなく全対象施設で判定する）。
 */
export const evaluateMihoBase = (
  loc: LatLng,
  ctx?: FlightContext,
): RegulationWithStatus => evaluateSmallDroneLaw(loc, ctx);

const TOTTORI_MUNI_CODE = "31201";
const YONAGO_MUNI_CODE = "31202";
const KURAYOSHI_MUNI_CODE = "31203";
const SAKAIMINATO_MUNI_CODE = "31204";
const YAZU_MUNI_CODE = "31329";
const MISASA_MUNI_CODE = "31364";
const YURIHAMA_MUNI_CODE = "31370";
const MATSUE_MUNI_CODE = "32201";
const IZUMO_MUNI_CODE = "32203";
const OHDA_MUNI_CODE = "32205";
const YASUGI_MUNI_CODE = "32206";
const UNNAN_MUNI_CODE = "32209";

// muniCode → 当該市町村の公園条例レコード + 公園ポリゴン群。
// 自治体追加時はここに 1 行追加するだけで evaluator は自動対応する。
type MunicipalParkEntry = {
  readonly muniName: string;
  readonly parks: readonly Park[];
  readonly reg: Regulation;
};

const MUNICIPAL_PARKS: Readonly<Record<string, MunicipalParkEntry>> = {
  [TOTTORI_MUNI_CODE]: {
    muniName: "鳥取市",
    parks: TOTTORI_PARKS,
    reg: TOTTORI_PARK_REG,
  },
  [YONAGO_MUNI_CODE]: {
    muniName: "米子市",
    parks: YONAGO_PARKS,
    reg: YONAGO_PARK_REG,
  },
  [KURAYOSHI_MUNI_CODE]: {
    muniName: "倉吉市",
    parks: KURAYOSHI_PARKS,
    reg: KURAYOSHI_PARK_REG,
  },
  [SAKAIMINATO_MUNI_CODE]: {
    muniName: "境港市",
    parks: SAKAIMINATO_PARKS,
    reg: SAKAIMINATO_PARK_REG,
  },
  [MATSUE_MUNI_CODE]: {
    muniName: "松江市",
    parks: MATSUE_PARKS,
    reg: MATSUE_PARK_REG,
  },
  [IZUMO_MUNI_CODE]: {
    muniName: "出雲市",
    parks: IZUMO_PARKS,
    reg: IZUMO_PARK_REG,
  },
  [MISASA_MUNI_CODE]: {
    muniName: "三朝町",
    parks: MISASA_PARKS,
    reg: MISASA_PARK_REG,
  },
  [YURIHAMA_MUNI_CODE]: {
    muniName: "湯梨浜町",
    parks: YURIHAMA_PARKS,
    reg: YURIHAMA_PARK_REG,
  },
  [YAZU_MUNI_CODE]: {
    muniName: "八頭町",
    parks: YAZU_PARKS,
    reg: YAZU_PARK_REG,
  },
  [YASUGI_MUNI_CODE]: {
    muniName: "安来市",
    parks: YASUGI_PARKS,
    reg: YASUGI_PARK_REG,
  },
  [UNNAN_MUNI_CODE]: {
    muniName: "雲南市",
    parks: UNNAN_PARKS,
    reg: UNNAN_PARK_REG,
  },
  [OHDA_MUNI_CODE]: {
    muniName: "大田市",
    parks: OHDA_PARKS,
    reg: OHDA_PARK_REG,
  },
};

// muniCode → 当該市町村の文化財保護レコード + 史跡ポリゴン群。
type MunicipalHeritageEntry = {
  readonly muniName: string;
  readonly sites: readonly HeritageSite[];
  readonly reg: Regulation;
};

const MUNICIPAL_HERITAGE: Readonly<Record<string, MunicipalHeritageEntry>> = {
  [TOTTORI_MUNI_CODE]: {
    muniName: "鳥取市",
    sites: TOTTORI_HERITAGE_SITES,
    reg: TOTTORI_HERITAGE_REG,
  },
  [YONAGO_MUNI_CODE]: {
    muniName: "米子市",
    sites: YONAGO_HERITAGE_SITES,
    reg: YONAGO_HERITAGE_REG,
  },
  [KURAYOSHI_MUNI_CODE]: {
    muniName: "倉吉市",
    sites: KURAYOSHI_HERITAGE_SITES,
    reg: KURAYOSHI_HERITAGE_REG,
  },
  [MATSUE_MUNI_CODE]: {
    muniName: "松江市",
    sites: MATSUE_HERITAGE_SITES,
    reg: MATSUE_HERITAGE_REG,
  },
  [IZUMO_MUNI_CODE]: {
    muniName: "出雲市",
    sites: IZUMO_HERITAGE_SITES,
    reg: IZUMO_HERITAGE_REG,
  },
  [MISASA_MUNI_CODE]: {
    muniName: "三朝町",
    sites: MISASA_HERITAGE_SITES,
    reg: MISASA_HERITAGE_REG,
  },
  [YURIHAMA_MUNI_CODE]: {
    muniName: "湯梨浜町",
    sites: YURIHAMA_HERITAGE_SITES,
    reg: YURIHAMA_HERITAGE_REG,
  },
  [YASUGI_MUNI_CODE]: {
    muniName: "安来市",
    sites: YASUGI_HERITAGE_SITES,
    reg: YASUGI_HERITAGE_REG,
  },
  [UNNAN_MUNI_CODE]: {
    muniName: "雲南市",
    sites: UNNAN_HERITAGE_SITES,
    reg: UNNAN_HERITAGE_REG,
  },
  [OHDA_MUNI_CODE]: {
    muniName: "大田市",
    sites: OHDA_HERITAGE_SITES,
    reg: OHDA_HERITAGE_REG,
  },
};

// prefCode (muniCode の先頭2桁) → 当該都道府県の迷惑行為等防止条例レコード。
type PrefecturalNuisanceEntry = {
  readonly prefName: string;
  readonly reg: Regulation;
};

const PREFECTURAL_NUISANCE: Readonly<Record<string, PrefecturalNuisanceEntry>> = {
  "31": { prefName: "鳥取県", reg: TOTTORI_NUISANCE_REG },
  "32": { prefName: "島根県", reg: SHIMANE_NUISANCE_REG },
};

// UI 表示用のカバレッジサマリ（自治体一覧・都道府県一覧・件数）。
// page.tsx / regulation-map.tsx 側のハードコードを撤廃するために export する。
export type CoverageSummary = {
  readonly municipalParkNames: readonly string[];
  readonly municipalParkCounts: ReadonlyArray<readonly [muniName: string, count: number]>;
  readonly municipalHeritageCounts: ReadonlyArray<readonly [muniName: string, count: number]>;
  readonly municipalSensitiveCounts: ReadonlyArray<readonly [muniName: string, count: number]>;
  readonly prefectureNuisanceNames: readonly string[];
  readonly totalParks: number;
  readonly totalHeritage: number;
  readonly totalSensitive: number;
};

export const COVERAGE_SUMMARY: CoverageSummary = {
  municipalParkNames: Object.values(MUNICIPAL_PARKS).map((e) => e.muniName),
  municipalParkCounts: Object.values(MUNICIPAL_PARKS).map(
    (e) => [e.muniName, e.parks.length] as const,
  ),
  municipalHeritageCounts: Object.values(MUNICIPAL_HERITAGE).map(
    (e) => [e.muniName, e.sites.length] as const,
  ),
  // 公衆密集地は zones 側でフラット集約しているので、再集計するために
  // facility id のプレフィックスから自治体を逆引きする運用を避け、
  // ここでは parks と同じ自治体集合に対する件数を別マップで管理する。
  municipalSensitiveCounts: [
    ["鳥取市", 4],
    ["米子市", 4],
    ["倉吉市", 4],
    ["境港市", 3],
    ["八頭町", 3],
    ["三朝町", 3],
    ["湯梨浜町", 3],
    ["松江市", 5],
    ["出雲市", 5],
    ["大田市", 4],
    ["安来市", 4],
    ["雲南市", 3],
  ],
  prefectureNuisanceNames: Object.values(PREFECTURAL_NUISANCE).map((e) => e.prefName),
  totalParks: Object.values(MUNICIPAL_PARKS).reduce((acc, e) => acc + e.parks.length, 0),
  totalHeritage: Object.values(MUNICIPAL_HERITAGE).reduce((acc, e) => acc + e.sites.length, 0),
  totalSensitive: ALL_SENSITIVE_FACILITIES.length,
};

const COVERAGE_MUNI_NAMES = COVERAGE_SUMMARY.municipalParkNames.join("・");
const COVERAGE_HERITAGE_MUNI_NAMES = Object.values(MUNICIPAL_HERITAGE)
  .map((e) => e.muniName)
  .join("・");
const COVERAGE_PREFECTURE_NAMES = COVERAGE_SUMMARY.prefectureNuisanceNames.join("・");

export const evaluateMunicipalParks = (
  loc: LatLng,
  muniCode: string | undefined,
  ctx?: FlightContext,
): RegulationWithStatus => {
  const entry = muniCode !== undefined ? MUNICIPAL_PARKS[muniCode] : undefined;
  if (!entry) {
    return {
      ...YONAGO_PARK_REG,
      status: "unknown",
      note: `判定地点はカバレッジ対象自治体外です。現在の収録範囲は ${COVERAGE_MUNI_NAMES}。当該市町村の都市公園条例データは未整備のため判定できません。`,
    };
  }
  const hit = entry.parks.find((p) => pointInPolygon(loc, p.polygon));
  if (hit) {
    return {
      ...entry.reg,
      ...applyExemptions(
        {
          status: "red",
          note: `判定地点は「${hit.name}」内です。${entry.muniName}都市公園条例に基づき、原則飛行禁止または事前申請が必要です。`,
          clauseGraph: entry.reg.clauseGraph,
        },
        ctx,
      ),
    };
  }
  return {
    ...entry.reg,
    status: "green",
    note: `判定地点は登録された${entry.muniName}内の都市公園ポリゴン外です（現在収録しているのは ${entry.parks.length} 公園のみ。最終確認は${entry.muniName}公園台帳で）。`,
  };
};

// 後方互換: 旧 API を残しておき、apps/web 側の段階的移行を許容。
/** @deprecated evaluateMunicipalParks に置き換え予定 */
export const evaluateYonagoParks = evaluateMunicipalParks;

export const evaluateMunicipalHeritage = (
  loc: LatLng,
  muniCode: string | undefined,
  ctx?: FlightContext,
): RegulationWithStatus => {
  const entry = muniCode !== undefined ? MUNICIPAL_HERITAGE[muniCode] : undefined;
  if (!entry) {
    return {
      ...YONAGO_HERITAGE_REG,
      status: "unknown",
      note: `判定地点はカバレッジ対象自治体（${COVERAGE_HERITAGE_MUNI_NAMES}）外です。当該市町村の指定文化財データは未整備のため判定できません。`,
    };
  }
  const hit = entry.sites.find((s) => pointInPolygon(loc, s.polygon));
  if (hit) {
    const requireBunkacho = hit.designation === "国指定史跡";
    return {
      ...entry.reg,
      ...applyExemptions(
        {
          status: "red",
          note: `判定地点は「${hit.name}」(${hit.designation})の区域内です。${
            requireBunkacho ? "文化財保護法第125条" : `${entry.muniName}文化財保護条例`
          }に基づき、現状変更には事前許可が必要です。ドローン飛行は史跡毀損リスクの観点から原則として申請対象です。`,
          clauseGraph: entry.reg.clauseGraph,
        },
        ctx,
      ),
    };
  }
  return {
    ...entry.reg,
    status: "green",
    note: `判定地点は登録された${entry.muniName}内の指定史跡区域外です（現在収録しているのは ${entry.sites.length} 件のみ。最終確認は${entry.muniName}教育委員会・文化庁データベースで）。`,
  };
};

/** @deprecated evaluateMunicipalHeritage に置き換え予定 */
export const evaluateYonagoHeritage = evaluateMunicipalHeritage;

export const evaluatePrefecturalNuisance = (
  loc: LatLng,
  muniCode: string | undefined,
  ctx?: FlightContext,
): RegulationWithStatus => {
  const prefCode = muniCode?.slice(0, 2);
  const entry = prefCode !== undefined ? PREFECTURAL_NUISANCE[prefCode] : undefined;
  if (!entry) {
    return {
      ...TOTTORI_NUISANCE_REG,
      status: "unknown",
      note: `判定地点はカバレッジ対象都道府県（${COVERAGE_PREFECTURE_NAMES}）外、または市町村コード未解決のため、県条例の適用判定をスキップしました。`,
    };
  }
  let nearest: { name: string; category: string; distance: number } | null = null;
  for (const f of ALL_SENSITIVE_FACILITIES) {
    const d = haversineMeters(loc, f.center);
    if (nearest === null || d < nearest.distance) {
      nearest = { name: f.name, category: f.category, distance: d };
    }
  }
  if (nearest === null) {
    return {
      ...entry.reg,
      status: "unknown",
      note: "公衆密集地データを読み込めませんでした。",
    };
  }
  if (nearest.distance <= SENSITIVE_FACILITY_BUFFER_M) {
    return {
      ...entry.reg,
      ...applyExemptions(
        {
          status: "yellow",
          note: `判定地点は ${nearest.category}「${nearest.name}」からおよそ ${Math.round(nearest.distance)} m。${entry.prefName}迷惑行為等防止条例の運用上、施設管理者との事前調整が推奨されます。`,
          clauseGraph: entry.reg.clauseGraph,
        },
        ctx,
      ),
    };
  }
  return {
    ...entry.reg,
    status: "green",
    note: `最寄りの公衆密集地は「${nearest.name}」(${nearest.category})までおよそ ${(nearest.distance / 1000).toFixed(1)} km。条例運用上の推奨バッファ（${SENSITIVE_FACILITY_BUFFER_M}m）外です。`,
  };
};

/** @deprecated evaluatePrefecturalNuisance に置き換え予定 */
export const evaluateTottoriNuisance = evaluatePrefecturalNuisance;

// 総合判定の集約。red/yellow は確定的な規制適用なので unknown より優先する。
// 一方で、known が全部 green でも unknown が混ざっているケースは「データ欠落
// による飛行可断定」というサイレント false-OK を生むため、green に降格させず
// unknown のまま返す。コンプライアンス用途では「カバレッジに穴がある」ことを
// 利用者に明示的に伝える方が安全側。
//   red    > yellow > green = all known green AND no unknown
//   unknown = any unknown alongside green-only-or-empty known set
export const computeOverall = (
  items: readonly RegulationWithStatus[],
): RegulationStatus => {
  if (items.some((r) => r.status === "red")) return "red";
  if (items.some((r) => r.status === "yellow")) return "yellow";
  if (items.some((r) => r.status === "unknown")) return "unknown";
  if (items.length === 0) return "unknown";
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

// Sprint 11d：旧 STATUS_LABEL（信号の 3 色の表示）は廃止。画面・PDF の結論は VERDICT_LABEL（4 段＋判定不能）、
// 規制ごとの元の判定は BASE_STATUS_LABEL、旧版の履歴は LEGACY_STATUS_LABEL を使う（verdict.ts）。

export const SOURCE_LABEL: Readonly<Record<RegulationSource, string>> = {
  国: "国",
  都道府県: "都道府県",
  市町村: "市町村",
};

export const DEFAULT_DISCLAIMER =
  "本ツールは参考情報であり、飛行可否を最終的に保証するものではありません。実運用前に必ず国土交通省 DIPS、警察庁、各自治体の最新情報をご確認ください。";

export {
  ALL_HERITAGE_SITES,
  ALL_MUNICIPAL_PARKS,
  ALL_SENSITIVE_FACILITIES,
  IZUMO_HERITAGE_SITES,
  IZUMO_PARKS,
  IZUMO_SENSITIVE_FACILITIES,
  KURAYOSHI_HERITAGE_SITES,
  KURAYOSHI_PARKS,
  KURAYOSHI_SENSITIVE_FACILITIES,
  MATSUE_HERITAGE_SITES,
  MATSUE_PARKS,
  MATSUE_SENSITIVE_FACILITIES,
  MIHO_AIRBASE_CENTER,
  MISASA_HERITAGE_SITES,
  MISASA_PARKS,
  MISASA_SENSITIVE_FACILITIES,
  OHDA_HERITAGE_SITES,
  OHDA_PARKS,
  OHDA_SENSITIVE_FACILITIES,
  SAKAIMINATO_PARKS,
  SAKAIMINATO_SENSITIVE_FACILITIES,
  SENSITIVE_FACILITY_BUFFER_M,
  TOTTORI_HERITAGE_SITES,
  TOTTORI_PARKS,
  TOTTORI_SENSITIVE_FACILITIES,
  UNNAN_HERITAGE_SITES,
  UNNAN_PARKS,
  UNNAN_SENSITIVE_FACILITIES,
  YASUGI_HERITAGE_SITES,
  YASUGI_PARKS,
  YASUGI_SENSITIVE_FACILITIES,
  YAZU_PARKS,
  YAZU_SENSITIVE_FACILITIES,
  YONAGO_HERITAGE_SITES,
  YONAGO_PARKS,
  YONAGO_SENSITIVE_FACILITIES,
  YURIHAMA_HERITAGE_SITES,
  YURIHAMA_PARKS,
  YURIHAMA_SENSITIVE_FACILITIES,
} from "./zones";
export type { HeritageSite, Park, SensitiveFacility } from "./zones";

export type {
  DidDetail,
  FacilityHit,
  LegalTier,
  Regulation,
  RegulationSource,
  RegulationStatus,
  RegulationWithStatus,
} from "./core";
export { applyExemptions, LEGAL_TIER_LABEL } from "./core";

// ── 判定の 4 段（Sprint 11d）──
export type {
  AppliedPermit,
  DeriveFlightVerdictInput,
  DipsPermitKind,
  FlightVerdict,
  ItemVerdict,
  PerFlightDuty,
  PerFlightDutyKind,
  VerdictDeadline,
  VerdictDoneItem,
  VerdictItem,
  VerdictLevel,
  VerdictNoFlyItem,
  VerdictProcedure,
} from "./verdict";
export {
  aggregateVerdictLevel,
  BASE_STATUS_LABEL,
  deriveFlightVerdict,
  DIPS_PERMIT_BY_FLAG,
  DIPS_PERMIT_KINDS,
  DIPS_PERMIT_LABEL,
  dipsDeadline,
  dipsPermitValue,
  LEGACY_STATUS_LABEL,
  PERMIT_SCOPE_NOT_VERIFIED_NOTE,
  PERMIT_VALUE_LABEL,
  perRegulationVerdict,
  PURPOSE_EXCEPTION_CONDITION,
  PURPOSE_VALUE_LABEL,
  smallDroneConsentDeadline,
  smallDroneNoticeDeadline,
  sortVerdictProcedures,
  VERDICT_HELP,
  VERDICT_LABEL,
  VERDICT_LEVELS,
} from "./verdict";

// ── データセット台帳・反映済みの法令改正（Sprint 7）──
export type { AmendmentRef, DatasetRecord, DatasetRef } from "./datasets";
export {
  ALL_AMENDMENTS,
  ALL_DATASETS,
  AMENDMENT_MLIT_KOKUJI_435,
  AMENDMENT_SMALL_DRONE_LAW_2026,
  DATASET_IDS,
  datasetRef,
  formatAmendmentRef,
  formatDatasetRef,
  getDataset,
} from "./datasets";

// ── DID・工業専用地域のデータ読み込み口（Sprint 7）──
export type {
  DidBundleFeature,
  DidBundleFile,
  DidCandidate,
  DidDataset,
} from "./did-data";
export {
  BUNDLED_DID_PREF_CODES,
  didBundleToDataset,
  getBundledDidFile,
  loadBundledDid,
} from "./did-data";
export type {
  IndustrialBundleFile,
  IndustrialCoverageEntry,
  IndustrialCoverageStatus,
  IndustrialDidOverlap,
  IndustrialExclusiveSource,
  IndustrialZone,
} from "./industrial-exclusive";
export {
  createIndustrialSource,
  DEFAULT_INDUSTRIAL_SOURCE,
  getBundledIndustrialFiles,
  INDUSTRIAL_COVERAGE,
  INDUSTRIAL_INSIDE_MARGIN_M,
  industrialBundleToZones,
} from "./industrial-exclusive";

// ── 小型無人機等飛行禁止法（Sprint 7）──
export type {
  FacilityMeasurement,
  SmallDroneFacility,
  SmallDroneFacilityGeometry,
} from "./small-drone-law";
export {
  evaluateSmallDroneLaw,
  isSmallDroneLawTriggered,
  LEGACY_MIHO_REG_ID,
  measureFacility,
  parseSmallDroneFacility,
  SMALL_DRONE_LAW_AROUND_M,
  SMALL_DRONE_LAW_DEFAULT_YELLOW_WIDTH_M,
  SMALL_DRONE_LAW_FACILITIES,
  SMALL_DRONE_LAW_REG_ID,
} from "./small-drone-law";

// ── 証跡（Sprint 7）──
export type { CheckEvidencePayloadInput } from "./evidence";
export { buildCheckEvidencePayload, ENGINE_VERSION, PREVIOUS_ENGINE_VERSIONS } from "./evidence";

// ── 許可の入力に対する表示の補足（Sprint 11c）──
export {
  AIRPORT_MLIT_PERMIT_NOT_APPLIED_NOTE,
  AIRPORT_REGULATION_ID,
  isDipsPermitValue,
  shouldShowAirportMlitNote,
} from "./permit-notes";

export type {
  ClauseEffect,
  ClauseException,
  ClauseCondition,
  ClauseGraph,
  FlightContext,
  MachineCondition,
  MachineConditionType,
} from "./clause-graph";
export type { ExceptionKind } from "./clause-graph";
export {
  CLAUSE_EFFECT_LABEL,
  exceptionKind,
  findExcludingExceptions,
  findPermittingExceptions,
  findSatisfyingExceptions,
  formatMachineCondition,
  LEGACY_PERMIT_ALIASES,
  matchesException,
  normalizePilotPermits,
} from "./clause-graph";

export type { ConfidenceLevel, RegulationConfidence } from "./confidence";
export {
  CONFIDENCE_LABEL,
  LOW_CONFIDENCE_THRESHOLD,
  shouldWarnConfidence,
  summarizeConfidence,
} from "./confidence";

export type { AirportFeature, AirportFeatureCollection } from "./airports";
export { AIRPORTS_GEOJSON } from "./airports";

// ── DIPS 飛行許可・承認 申請支援（手続き診断）──
export type {
  SpecificFlightFlag,
  RequiredProcedure,
  RequiredProcedureKind,
  ProcedureSystem,
  DiagnosisCategory,
  CategoryDefinition,
  FlightMethodContext,
  ApplicationDiagnosis,
  DeriveDiagnosisInput,
  DiagnosisEvidencePayloadInput,
  AirspaceDeterminationStatus,
} from "./diagnosis";
export {
  FLIGHT_METHOD_FLAGS,
  AIRSPACE_FLAGS,
  SPECIFIC_FLIGHT_FLAG_LABEL,
  REQUIRED_PROCEDURE_KIND_LABEL,
  ALL_PROCEDURES,
  ALL_CATEGORY_DEFINITIONS,
  DRONE_THRESHOLD_G,
  HEAVY_DRONE_THRESHOLD_G,
  AIRSPACE_DETERMINATION_LABEL,
  deriveDidStatusFromRegulations,
  DIAGNOSIS_DISCLAIMER,
  PROCEDURES_VERIFIED_AT,
  PROCEDURES_REVISION,
  EMERGENCY_NO_FLY_NOTE,
  verificationNoteLabel,
  PESTICIDE_NOTICE_URL,
  INSURANCE_SOURCE_URL,
  CATEGORY_II_REVIEW_GUIDELINE_URL,
  deriveDiagnosis,
  getCategoryDefinition,
  extractAirspaceFlagsFromRegulations,
  buildDiagnosisEvidencePayload,
  deriveDidDetailFromRegulations,
  formatDidDetermination,
  mergeAirspaceFlags,
  SMALL_DRONE_LAW_PROCEDURE_ID,
} from "./diagnosis";

// ── 開庁日計算（提出期限の逆算・期限カレンダー）──
export type { DeadlineUrgency } from "./business-days";
export {
  ALL_HOLIDAYS,
  HOLIDAY_COVERAGE,
  isJapaneseHoliday,
  isBusinessDay,
  subtractBusinessDays,
  daysBetween,
  toJstIsoDate,
  classifyDeadlineUrgency,
} from "./business-days";

// ── DIPS 入力プリフィル ＋ 独自飛行マニュアル骨子ドラフト（Sprint 3）──
export type {
  PrefillField,
  PrefillSystem,
  BuildPrefillInput,
  ManualBaseSection,
  ManualMethodSection,
  StandardManualReference,
  ManualChoice,
  FlightManualDraft,
  BuildManualInput,
} from "./prefill";
export {
  buildPrefillFields,
  buildFlightManualDraft,
  formatManualDraftText,
  STANDARD_MANUAL_REFERENCE,
  ALL_MANUAL_BASE_SECTIONS,
  ALL_MANUAL_METHOD_SECTIONS,
} from "./prefill";

// 住所検索（Sprint 9）の型と定数。検索本体（索引を含む）は "@soraban/regulations/address" から import する。
export type { GeocodeHit, GeocodeLevel, GeocodeSource } from "./address/types";
export { GEOCODE_LEVELS, GEOCODE_SOURCES } from "./address/types";

// ── 100g 未満の機体（模型航空機）の扱い（Sprint 11e）──
export type { ModelAircraftReference } from "./model-aircraft";
export {
  MODEL_AIRCRAFT_AIRPORT_ITEM_TITLE,
  MODEL_AIRCRAFT_AIRPORT_PROCEDURE_TITLE,
  MODEL_AIRCRAFT_AIRPORT_REASON,
  MODEL_AIRCRAFT_CATEGORY_HEADLINE,
  MODEL_AIRCRAFT_CATEGORY_NOTE,
  MODEL_AIRCRAFT_CONTROL_ZONE_DUTY_DETAIL,
  MODEL_AIRCRAFT_CONTROL_ZONE_DUTY_TITLE,
  MODEL_AIRCRAFT_DEADLINE_LABEL,
  MODEL_AIRCRAFT_EXEMPT_REASON,
  MODEL_AIRCRAFT_HIGH_PROCEDURE_TITLE,
  MODEL_AIRCRAFT_HIGH_REASON,
  MODEL_AIRCRAFT_LAW,
  MODEL_AIRCRAFT_ORDINANCE,
  MODEL_AIRCRAFT_REFERENCE_LINE,
  MODEL_AIRCRAFT_REFERENCES,
  MODEL_AIRCRAFT_RULES_CHECKED_AT,
  MODEL_AIRCRAFT_SUBMIT_TO,
  MODEL_AIRCRAFT_WEIGHT_NOTE,
  MODEL_AIRCRAFT_WEIGHT_TAG,
} from "./model-aircraft";
