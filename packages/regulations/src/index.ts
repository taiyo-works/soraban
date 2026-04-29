import { haversineMeters, pointInPolygon, type LatLng, type Polygon } from "@soraban/geo";
import {
  findPermittingExceptions,
  type ClauseException,
  type ClauseGraph,
  type FlightContext,
} from "./clause-graph";
import type { ConfidenceLevel, RegulationConfidence } from "./confidence";
import {
  ALL_SENSITIVE_FACILITIES,
  IZUMO_HERITAGE_SITES,
  IZUMO_PARKS,
  KURAYOSHI_HERITAGE_SITES,
  KURAYOSHI_PARKS,
  MATSUE_HERITAGE_SITES,
  MATSUE_PARKS,
  MIHO_AIRBASE_CENTER,
  MIHO_AIRBASE_RED_M,
  MIHO_AIRBASE_YELLOW_M,
  SAKAIMINATO_PARKS,
  SENSITIVE_FACILITY_BUFFER_M,
  TOTTORI_HERITAGE_SITES,
  TOTTORI_PARKS,
  YONAGO_HERITAGE_SITES,
  YONAGO_PARKS,
  type HeritageSite,
  type Park,
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
  /**
   * FlightContext との照合で適用された permit 効果の例外節。
   * ここが非空なら、当該規制は status が一段降格されている（red→green / yellow→green）。
   * UI 側で「この条件で適用された例外」として可視化する。
   */
  readonly appliedExceptions?: readonly ClauseException[];
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
const applyExemptions = (
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

export const evaluateDid = (
  loc: LatLng,
  candidates: readonly DidCandidate[],
  ctx?: FlightContext,
): RegulationWithStatus => {
  const hit = candidates.find((c) => pointInPolygon(loc, c.polygon));
  const base = hit
    ? {
        status: "red" as RegulationStatus,
        note: `判定地点は ${hit.muniName} の DID（人口集中地区, 平成27年国勢調査）内です。原則として許可・承認なく飛行できません。`,
      }
    : {
        status: "green" as RegulationStatus,
        note: "判定地点は平成27年国勢調査ベースの DID 外です。最新は国土交通省 DIPS で要再確認。",
      };
  return { ...DID_REG, ...applyExemptions({ ...base, clauseGraph: DID_REG.clauseGraph }, ctx) };
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
          note: `判定地点は ${onAirport.name} の敷地内です。航空法に基づき、許可・承認なしに飛行できません。`,
          clauseGraph: AIRPORT_REG.clauseGraph,
        },
        ctx,
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

export const evaluateMihoBase = (
  loc: LatLng,
  ctx?: FlightContext,
): RegulationWithStatus => {
  const distance = haversineMeters(loc, MIHO_AIRBASE_CENTER);
  if (distance <= MIHO_AIRBASE_RED_M) {
    return {
      ...MIHO_REG,
      ...applyExemptions(
        {
          status: "red",
          note: `判定地点は美保基地中心からおよそ ${Math.round(distance)} m。小型無人機等飛行禁止法の対象範囲（おおむね 300m）に含まれます。`,
          clauseGraph: MIHO_REG.clauseGraph,
        },
        ctx,
      ),
    };
  }
  if (distance <= MIHO_AIRBASE_YELLOW_M) {
    return {
      ...MIHO_REG,
      ...applyExemptions(
        {
          status: "yellow",
          note: `判定地点は美保基地中心からおよそ ${Math.round(distance)} m。空港周辺の進入表面・要確認エリアに該当する可能性があります。`,
          clauseGraph: MIHO_REG.clauseGraph,
        },
        ctx,
      ),
    };
  }
  return {
    ...MIHO_REG,
    status: "green",
    note: `判定地点は美保基地中心からおよそ ${(distance / 1000).toFixed(1)} km 離れており、小型無人機等飛行禁止法の対象外です。`,
  };
};

const TOTTORI_MUNI_CODE = "31201";
const YONAGO_MUNI_CODE = "31202";
const KURAYOSHI_MUNI_CODE = "31203";
const SAKAIMINATO_MUNI_CODE = "31204";
const MATSUE_MUNI_CODE = "32201";
const IZUMO_MUNI_CODE = "32203";

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
    ["松江市", 5],
    ["出雲市", 5],
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
      note: `判定地点はカバレッジ対象自治体外です。Phase 1 のカバレッジは ${COVERAGE_MUNI_NAMES}。当該市町村の都市公園条例データは未整備のため判定できません。`,
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
    note: `判定地点は登録された${entry.muniName}内の都市公園ポリゴン外です（Phase 1 のデータは ${entry.parks.length} 公園のみ。最終確認は${entry.muniName}公園台帳で）。`,
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
    note: `判定地点は登録された${entry.muniName}内の指定史跡区域外です（Phase 1 のデータは ${entry.sites.length} 件のみ。最終確認は${entry.muniName}教育委員会・文化庁データベースで）。`,
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
  MIHO_AIRBASE_RED_M,
  MIHO_AIRBASE_YELLOW_M,
  SAKAIMINATO_PARKS,
  SAKAIMINATO_SENSITIVE_FACILITIES,
  SENSITIVE_FACILITY_BUFFER_M,
  TOTTORI_HERITAGE_SITES,
  TOTTORI_PARKS,
  TOTTORI_SENSITIVE_FACILITIES,
  YONAGO_HERITAGE_SITES,
  YONAGO_PARKS,
  YONAGO_SENSITIVE_FACILITIES,
} from "./zones";
export type { HeritageSite, Park, SensitiveFacility } from "./zones";

export type {
  ClauseEffect,
  ClauseException,
  ClauseCondition,
  ClauseGraph,
  FlightContext,
  MachineCondition,
  MachineConditionType,
} from "./clause-graph";
export { CLAUSE_EFFECT_LABEL, findPermittingExceptions, matchesException } from "./clause-graph";

export type { ConfidenceLevel, RegulationConfidence } from "./confidence";
export { CONFIDENCE_LABEL, summarizeConfidence } from "./confidence";
