// 小型無人機等飛行禁止法（重要施設の周辺地域の上空における小型無人機等の飛行の禁止に関する法律）
// の判定（Sprint 7, spec §13.3.1）。
//
// 2026-07-14 施行の改正（令和8年法律第47号）で、周辺地域は「敷地又は区域及びその周囲
// おおむね 1,000m」になり、周辺地域での飛行そのものが罰則の対象になった。
//
// 判定は敷地境界からの距離で行う（中心点からの距離ではない）。
//   - 敷地内、または境界から aroundM（1,000m）以内 → red
//   - aroundM を超え aroundM + yellowWidthM（既定 300m）以内 → yellow（告示の区域図で要確認）
//   - それ以外 → green
// 敷地形状が未収録で中心点しかない施設は「中心点からの距離 − 推定敷地半径」を境界距離とみなし
// （保守側）、note に「敷地形状未収録のため概算」と出す。
import {
  distanceToPolygonMeters,
  haversineMeters,
  type LatLng,
  type Polygon,
} from "@soraban/geo";
import type { FlightContext } from "./clause-graph";
import {
  applyExemptions,
  type FacilityHit,
  type Regulation,
  type RegulationStatus,
  type RegulationWithStatus,
} from "./core";
import {
  AMENDMENT_SMALL_DRONE_LAW_2026,
  DATASET_IDS,
  datasetRef,
} from "./datasets";
import facilitiesJson from "../data/small-drone-law/facilities.json";

export type SmallDroneFacilityGeometry =
  | { readonly type: "polygon"; readonly rings: readonly Polygon[] }
  | {
      readonly type: "center";
      readonly center: LatLng;
      /** 敷地を覆う推定半径（m）。確認値ではない（保守側の推定）。 */
      readonly estimatedSiteRadiusM: number;
    };

export type SmallDroneFacility = {
  readonly id: string;
  readonly name: string;
  /** 対象防衛関係施設・対象原子力事業所 等 */
  readonly kind: string;
  readonly prefCode: string;
  readonly location: string;
  readonly designation: {
    readonly title: string;
    readonly date: string | null;
    readonly effectiveDate: string | null;
    readonly url: string;
  };
  readonly areaMapUrl: string;
  readonly geometry: SmallDroneFacilityGeometry;
  /** 敷地形状の出典（告示区域図のトレース／OpenStreetMap／中心点のみ 等） */
  readonly geometrySource: string;
  readonly aroundM: number;
  readonly yellowWidthM: number;
  readonly verifiedAt: string;
  readonly verifiedBy: string;
};

export const SMALL_DRONE_LAW_REG_ID = "small-drone-law";
/** Sprint 6 までの規制 ID（美保基地のみを扱っていた）。履歴の互換表示に使う。 */
export const LEGACY_MIHO_REG_ID = "miho-airbase-no-fly";

export const SMALL_DRONE_LAW_AROUND_M = 1000;
export const SMALL_DRONE_LAW_DEFAULT_YELLOW_WIDTH_M = 300;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

type RawFacility = Record<string, unknown>;

const parseLatLng = (raw: unknown): LatLng | null => {
  if (!raw || typeof raw !== "object") return null;
  const { lat, lng } = raw as { lat?: unknown; lng?: unknown };
  return typeof lat === "number" && typeof lng === "number" ? { lat, lng } : null;
};

const parseGeometry = (raw: unknown): SmallDroneFacilityGeometry | null => {
  if (!raw || typeof raw !== "object") return null;
  const g = raw as Record<string, unknown>;
  if (g["type"] === "center") {
    const center = parseLatLng(g["center"]);
    const r = g["estimatedSiteRadiusM"];
    if (!center || typeof r !== "number" || !(r >= 0)) return null;
    return { type: "center", center, estimatedSiteRadiusM: r };
  }
  if (g["type"] === "polygon" && Array.isArray(g["rings"])) {
    const rings: Polygon[] = [];
    for (const ring of g["rings"] as unknown[]) {
      if (!Array.isArray(ring)) return null;
      const pts = ring.map(parseLatLng);
      if (pts.some((p) => p === null) || pts.length < 3) return null;
      rings.push(pts as LatLng[]);
    }
    return rings.length > 0 ? { type: "polygon", rings } : null;
  }
  return null;
};

/**
 * facilities.json の 1 件を検証して取り込む。根拠告示の URL・敷地形状の出典・確認日のいずれかが
 * 欠けたレコードはデータ不備として例外にする（黙って捨てると過小判定になるため）。
 */
export const parseSmallDroneFacility = (
  raw: RawFacility,
  defaults: { readonly aroundM: number; readonly yellowWidthM: number },
): SmallDroneFacility => {
  const id = raw["id"];
  const fail = (what: string): never => {
    throw new Error(`small-drone-law/facilities.json: ${String(id)} の ${what} が不正です（データ不備）`);
  };
  const str = (k: string): string => {
    const v = raw[k];
    return typeof v === "string" && v.length > 0 ? v : fail(k);
  };
  const des = raw["designation"] as Record<string, unknown> | undefined;
  if (!des || typeof des["url"] !== "string" || des["url"].length === 0) fail("designation.url");
  if (!des || typeof des["title"] !== "string" || des["title"].length === 0) fail("designation.title");
  const geometry = parseGeometry(raw["geometry"]) ?? fail("geometry");
  const verifiedAt = str("verifiedAt");
  if (!ISO_DATE.test(verifiedAt)) fail("verifiedAt");
  const aroundM = typeof raw["aroundM"] === "number" ? raw["aroundM"] : defaults.aroundM;
  const yellowWidthM =
    typeof raw["yellowWidthM"] === "number" ? raw["yellowWidthM"] : defaults.yellowWidthM;
  return {
    id: str("id"),
    name: str("name"),
    kind: str("kind"),
    prefCode: str("prefCode"),
    location: str("location"),
    designation: {
      title: des!["title"] as string,
      date: typeof des!["date"] === "string" ? des!["date"] : null,
      effectiveDate: typeof des!["effectiveDate"] === "string" ? des!["effectiveDate"] : null,
      url: des!["url"] as string,
    },
    areaMapUrl: str("areaMapUrl"),
    geometry,
    geometrySource: str("geometrySource"),
    aroundM,
    yellowWidthM,
    verifiedAt,
    verifiedBy: str("verifiedBy"),
  };
};

const FACILITY_FILE = facilitiesJson as {
  readonly defaultAroundM?: number;
  readonly defaultYellowWidthM?: number;
  readonly facilities?: readonly RawFacility[];
};

export const SMALL_DRONE_LAW_FACILITIES: readonly SmallDroneFacility[] = (
  FACILITY_FILE.facilities ?? []
).map((f) =>
  parseSmallDroneFacility(f, {
    aroundM: FACILITY_FILE.defaultAroundM ?? SMALL_DRONE_LAW_AROUND_M,
    yellowWidthM: FACILITY_FILE.defaultYellowWidthM ?? SMALL_DRONE_LAW_DEFAULT_YELLOW_WIDTH_M,
  }),
);

/** 地点と施設の位置関係（敷地境界からの距離）。 */
export type FacilityMeasurement = {
  readonly facility: SmallDroneFacility;
  readonly distanceFromBoundaryM: number;
  readonly approximate: boolean;
  readonly zone: "red" | "yellow" | "green";
};

export const measureFacility = (
  loc: LatLng,
  facility: SmallDroneFacility,
): FacilityMeasurement => {
  const g = facility.geometry;
  const distance =
    g.type === "polygon"
      ? distanceToPolygonMeters(loc, g.rings)
      : Math.max(0, haversineMeters(loc, g.center) - g.estimatedSiteRadiusM);
  const zone =
    distance <= facility.aroundM
      ? "red"
      : distance <= facility.aroundM + facility.yellowWidthM
        ? "yellow"
        : "green";
  return {
    facility,
    distanceFromBoundaryM: distance,
    approximate: g.type === "center",
    zone,
  };
};

const SMALL_DRONE_LAW_REG: Regulation = {
  id: SMALL_DRONE_LAW_REG_ID,
  source: "国",
  authority: "警察庁（国家公安委員会）・防衛省",
  title: "小型無人機等飛行禁止法 — 対象施設の周辺地域（おおむね 1,000m）",
  summary:
    "防衛関係施設・原子力事業所などの対象施設の敷地又は区域及びその周囲おおむね 1,000m の上空では、小型無人機等（重量に関係なく 100g 未満の機体も含む）の飛行が禁止されています。2026年7月14日施行の改正（令和8年法律第47号）で周辺地域がおおむね 1,000m に広がり、周辺地域での飛行そのものも罰則（6月以下の拘禁刑又は50万円以下の罰金）の対象になりました。施設管理者の同意を得て、飛行の 48 時間前までに都道府県公安委員会へ通報すれば飛行できます。警察庁は敷地上空を「レッドゾーン」、周辺地域を「イエローゾーン」と呼びますが、どちらも飛行禁止のため、このアプリではいずれも赤（飛行不可）で表示します。黄（要確認）は、告示の区域図との誤差を見込んで周辺地域の外側に設けた要確認帯で、法律上のイエローゾーンではありません。",
  url: "https://www.npa.go.jp/bureau/security/kogatamujinki/index.html",
  clauseGraph: {
    main: {
      text:
        "対象施設の敷地又は区域及びその周囲おおむね 1,000m の地域の上空においては、小型無人機等の飛行を行ってはならない。",
      effect: "deny",
    },
    exceptions: [
      {
        id: "small-drone-law-ex-consent-notice",
        condition:
          "対象施設の管理者の同意を得たうえで、飛行の 48 時間前までに都道府県公安委員会へ通報した場合",
        effect: "permit",
        machine: { type: "permit_holder", value: "facility_manager_and_pref_pubsafety" },
      },
    ],
    conditions: [
      {
        id: "small-drone-law-cond-1000m",
        description: "対象施設の敷地境界からおおむね 1,000m 以内であること（告示の区域図で確定）",
        machine: { type: "in_zone", value: "small_drone_law_1000m" },
      },
    ],
  },
  confidence: {
    // 敷地形状が中心点のみ（推定半径）のため幾何の確度は低い。
    geometric: "low",
    extraction: "high",
    verifiedAt: "2026-10-19T00:00:00+09:00",
  },
  datasets: [datasetRef(DATASET_IDS.smallDroneLawFacilities)],
  amendments: [AMENDMENT_SMALL_DRONE_LAW_2026],
};

const roundM = (m: number): string => `${Math.round(m).toLocaleString("ja-JP")}m`;

const describeHit = (m: FacilityMeasurement): string => {
  const where =
    m.distanceFromBoundaryM === 0
      ? `「${m.facility.name}」の敷地内${m.approximate ? "（推定）" : ""}`
      : `「${m.facility.name}」の敷地境界からおよそ ${roundM(m.distanceFromBoundaryM)}`;
  return m.approximate ? `${where}（敷地形状未収録のため概算）` : where;
};

/**
 * 小型無人機等飛行禁止法の判定。対象施設のうち最も厳しい区分を返す。
 * 小型無人機等には重量の下限がないため、航空法の 100g 未満例外は適用しない。
 */
export const evaluateSmallDroneLaw = (
  loc: LatLng,
  ctx?: FlightContext,
  facilities: readonly SmallDroneFacility[] = SMALL_DRONE_LAW_FACILITIES,
): RegulationWithStatus => {
  if (facilities.length === 0) {
    return {
      ...SMALL_DRONE_LAW_REG,
      status: "unknown",
      note: "小型無人機等飛行禁止法の対象施設データを読み込めませんでした（未確認）。警察庁・各県警察の対象施設一覧で確認してください。",
    };
  }
  const measured = facilities
    .map((f) => measureFacility(loc, f))
    .sort((a, b) => a.distanceFromBoundaryM - b.distanceFromBoundaryM);
  const hits = measured.filter((m) => m.zone !== "green");
  const facilityHits: FacilityHit[] = hits.map((m) => ({
    facilityId: m.facility.id,
    facilityName: m.facility.name,
    distanceFromBoundaryM: Math.round(m.distanceFromBoundaryM),
    zone: m.zone as "red" | "yellow",
    approximate: m.approximate,
  }));
  const reds = hits.filter((m) => m.zone === "red");
  const yellows = hits.filter((m) => m.zone === "yellow");

  let status: RegulationStatus;
  let note: string;
  if (reds.length > 0) {
    status = "red";
    note = `判定地点は${reds.map(describeHit).join("、")}です。対象施設の敷地又は周辺地域（敷地及びその周囲おおむね 1,000m。周辺地域は警察庁のいう「イエローゾーン」で、飛行は罰則の対象）に含まれ、施設管理者の同意と都道府県公安委員会への事前通報（飛行の 48 時間前まで）なしには飛行できません。`;
  } else if (yellows.length > 0) {
    status = "yellow";
    note = `判定地点は${yellows.map(describeHit).join("、")}です。周辺地域（おおむね 1,000m）の外側付近のため、告示の区域図で要確認です。この帯は区域図との誤差を見込んだ要確認帯で、法律上のイエローゾーン（周辺地域）ではありません。`;
  } else {
    const nearest = measured[0]!;
    status = "green";
    note = `最寄りの対象施設は「${nearest.facility.name}」で、敷地境界からおよそ ${(nearest.distanceFromBoundaryM / 1000).toFixed(1)}km${nearest.approximate ? "（敷地形状未収録のため概算）" : ""}。周辺地域（おおむね 1,000m）の外です。`;
  }
  const base = { ...SMALL_DRONE_LAW_REG, facilityHits };
  if (status === "green") return { ...base, status, note };
  return {
    ...base,
    ...applyExemptions({ status, note, clauseGraph: SMALL_DRONE_LAW_REG.clauseGraph }, ctx),
  };
};

/** 申請支援の手続き（施設管理者の同意＋公安委員会への事前通報）を出すべきか。 */
export const isSmallDroneLawTriggered = (
  regulations: readonly { readonly id: string; readonly status: string }[],
): boolean =>
  regulations.some(
    (r) =>
      (r.id === SMALL_DRONE_LAW_REG_ID || r.id === LEGACY_MIHO_REG_ID) &&
      (r.status === "red" || r.status === "yellow"),
  );
