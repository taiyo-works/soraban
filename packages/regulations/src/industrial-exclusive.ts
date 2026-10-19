// 工業専用地域（DID からの除外、国土交通省告示第435号・2026-07-01 適用）のデータ（Sprint 7）。
//
// 収録範囲台帳（data/industrial-exclusive/coverage.json）で status=recorded の市町村だけ
// ポリゴン（data/industrial-exclusive/by-muni/{muniCode}.json、静的 import）で除外判定を行う。
// 台帳と同梱データが食い違う場合（recorded なのにポリゴンがない 等）は未収録として扱う（安全側）。
import type { Polygon } from "@soraban/geo";
import coverageJson from "../data/industrial-exclusive/coverage.json";
import { INDUSTRIAL_BUNDLE } from "./data-bundle/industrial-bundle";

export type IndustrialCoverageStatus = "recorded" | "not_recorded";
export type IndustrialDidOverlap = "overlap" | "no_overlap" | "unverified";

export type IndustrialCoverageEntry = {
  readonly muniCode: string;
  readonly muniName: string;
  readonly status: IndustrialCoverageStatus;
  readonly didOverlap: IndustrialDidOverlap;
  readonly source: string | null;
  readonly baseDate: string | null;
  readonly checkedAt: string;
  readonly note?: string;
};

export type IndustrialZone = {
  readonly muniCode: string;
  /** rings[0] が外周、rings[1..] が穴。 */
  readonly rings: readonly Polygon[];
};

export type IndustrialBundleFile = {
  readonly muniCode: string;
  readonly muniName: string;
  readonly datasetId: string;
  readonly source: string;
  readonly sourceUrl: string | null;
  readonly baseDate: string | null;
  readonly generatedAt: string;
  /** 各 zone の rings は [経度, 緯度] の配列。 */
  readonly zones: readonly { readonly rings: readonly (readonly (readonly number[])[])[] }[];
};

/** 判定に渡す工業専用地域データの読み込み口（DB 化の際はこれを差し替える）。 */
export type IndustrialExclusiveSource = {
  readonly insideMarginM: number;
  readonly coverage: (muniCode: string) => IndustrialCoverageEntry | undefined;
  readonly zones: (muniCode: string) => readonly IndustrialZone[];
  /**
   * 収録済みの全市町村の工専。地点を含む工専を市町村境をまたいで探すために使う
   * （例：日吉津村の工専が米子市の DID に重なる帯）。
   */
  readonly allZones: () => readonly IndustrialZone[];
};

/** 工業専用地域の境界から内側に取る余裕（m）。ユーザー承認値 10m。 */
export const INDUSTRIAL_INSIDE_MARGIN_M = 10;

type RawCoverage = {
  readonly insideMarginM?: number;
  readonly municipalities?: readonly Record<string, unknown>[];
};

const parseCoverageEntry = (raw: Record<string, unknown>): IndustrialCoverageEntry | null => {
  const muniCode = raw["muniCode"];
  const muniName = raw["muniName"];
  const checkedAt = raw["checkedAt"];
  if (typeof muniCode !== "string" || typeof muniName !== "string") return null;
  if (typeof checkedAt !== "string" || checkedAt.length === 0) return null;
  const status: IndustrialCoverageStatus = raw["status"] === "recorded" ? "recorded" : "not_recorded";
  const overlap = raw["didOverlap"];
  return {
    muniCode,
    muniName,
    status,
    didOverlap:
      overlap === "overlap" || overlap === "no_overlap" ? overlap : "unverified",
    source: typeof raw["source"] === "string" ? raw["source"] : null,
    baseDate: typeof raw["baseDate"] === "string" ? raw["baseDate"] : null,
    checkedAt,
    ...(typeof raw["note"] === "string" ? { note: raw["note"] } : {}),
  };
};

export const INDUSTRIAL_COVERAGE: readonly IndustrialCoverageEntry[] = (
  (coverageJson as RawCoverage).municipalities ?? []
)
  .map(parseCoverageEntry)
  .filter((e): e is IndustrialCoverageEntry => e !== null);

const ringFromLngLat = (ring: readonly (readonly number[])[]): Polygon =>
  ring.map(([lng, lat]) => ({ lat: lat ?? 0, lng: lng ?? 0 }));

export const industrialBundleToZones = (file: IndustrialBundleFile): IndustrialZone[] =>
  file.zones.map((z) => ({ muniCode: file.muniCode, rings: z.rings.map(ringFromLngLat) }));

export const createIndustrialSource = (params: {
  readonly coverage: readonly IndustrialCoverageEntry[];
  readonly zonesByMuni: Readonly<Record<string, readonly IndustrialZone[]>>;
  readonly insideMarginM?: number;
}): IndustrialExclusiveSource => {
  const index = new Map(params.coverage.map((e) => [e.muniCode, e]));
  return {
    insideMarginM: params.insideMarginM ?? INDUSTRIAL_INSIDE_MARGIN_M,
    coverage: (muniCode) => {
      const e = index.get(muniCode);
      if (!e) return undefined;
      // 台帳が recorded でもポリゴンが同梱されていなければ未収録として扱う。
      if (e.status === "recorded" && !(params.zonesByMuni[muniCode]?.length)) {
        return { ...e, status: "not_recorded" };
      }
      return e;
    },
    zones: (muniCode) => {
      const e = index.get(muniCode);
      return e?.status === "recorded" ? (params.zonesByMuni[muniCode] ?? []) : [];
    },
    allZones: () =>
      params.coverage
        .filter((e) => e.status === "recorded")
        .flatMap((e) => params.zonesByMuni[e.muniCode] ?? []),
  };
};

export const DEFAULT_INDUSTRIAL_SOURCE: IndustrialExclusiveSource = createIndustrialSource({
  coverage: INDUSTRIAL_COVERAGE,
  zonesByMuni: Object.fromEntries(
    Object.entries(INDUSTRIAL_BUNDLE).map(([code, file]) => [code, industrialBundleToZones(file)]),
  ),
  insideMarginM:
    typeof (coverageJson as RawCoverage).insideMarginM === "number"
      ? (coverageJson as RawCoverage).insideMarginM
      : INDUSTRIAL_INSIDE_MARGIN_M,
});

/** 同梱の工業専用地域（地図レイヤー配信用）。 */
export const getBundledIndustrialFiles = (): readonly IndustrialBundleFile[] =>
  Object.values(INDUSTRIAL_BUNDLE);
