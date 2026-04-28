import "server-only";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { cacheLife, cacheTag } from "next/cache";
import type { LatLng, Polygon } from "@soraban/geo";
import {
  DEFAULT_DISCLAIMER,
  computeOverall,
  computeOverallConfidence,
  evaluateAirports,
  evaluateDid,
  evaluateMihoBase,
  evaluateMunicipalHeritage,
  evaluateMunicipalParks,
  evaluatePrefecturalNuisance,
  type AirportCandidate,
  type DidCandidate,
  type RegulationCheckResult,
  type RegulationWithStatus,
} from "@soraban/regulations";

// 判定エンジンのバージョンタグ。証跡IDと一緒にレスポンスへ含めることで、
// 後段（損保引受・監査・特許出願明細書の実施例）で「いつのロジックで判定したか」を
// 一意に同定できるようにする。
const ENGINE_VERSION = "soraban-0.2.0-clausegraph";

type EvidenceInputs = {
  readonly lat: number;
  readonly lng: number;
  readonly checkedAt: string;
  readonly regulationIds: readonly string[];
};

const computeEvidenceId = (input: EvidenceInputs): string => {
  const sortedIds = [...input.regulationIds].sort();
  const payload = JSON.stringify({
    v: ENGINE_VERSION,
    lat: Number(input.lat.toFixed(6)),
    lng: Number(input.lng.toFixed(6)),
    t: input.checkedAt,
    r: sortedIds,
  });
  const hex = createHash("sha256").update(payload).digest("hex");
  return `ev_${hex.slice(0, 16)}`;
};

// Turbopack の require.resolve は virtual path (`[project]/...`) を返すため、
// process.cwd() (= apps/web) からモノレポルート相対で解決する。
// 本番ビルドではデータの配置戦略を見直し（公開バケット or 同梱）。
const DATA_ROOT = path.resolve(
  process.env["REGULATION_DATA_DIR"] ??
    path.join(process.cwd(), "..", "..", "packages", "regulations", "data"),
);
const DID_DIR = path.join(DATA_ROOT, "did", "by-pref");
const AIRPORTS_FILE = path.join(DATA_ROOT, "airports", "airports.geojson");

type DidGeoJson = {
  readonly type: "FeatureCollection";
  readonly features: ReadonlyArray<{
    readonly type: "Feature";
    readonly geometry:
      | { readonly type: "Polygon"; readonly coordinates: number[][][] }
      | { readonly type: "MultiPolygon"; readonly coordinates: number[][][][] };
    readonly properties: {
      readonly muniCode: string;
      readonly muniName: string;
    };
  }>;
};

const ringToPolygon = (ring: number[][]): Polygon =>
  ring.map(([lng, lat]) => ({ lat: lat ?? 0, lng: lng ?? 0 }));

const flattenFeatureToCandidates = (
  feature: DidGeoJson["features"][number],
): DidCandidate[] => {
  const { muniCode, muniName } = feature.properties;
  if (feature.geometry.type === "Polygon") {
    const outer = feature.geometry.coordinates[0];
    if (!outer) return [];
    return [{ muniCode, muniName, polygon: ringToPolygon(outer) }];
  }
  return feature.geometry.coordinates
    .map((poly) => poly[0])
    .filter((ring): ring is number[][] => Array.isArray(ring))
    .map((ring) => ({ muniCode, muniName, polygon: ringToPolygon(ring) }));
};

type AirportGeoJson = {
  readonly type: "FeatureCollection";
  readonly features: ReadonlyArray<{
    readonly type: "Feature";
    readonly geometry:
      | { readonly type: "Polygon"; readonly coordinates: number[][][] }
      | { readonly type: "MultiPolygon"; readonly coordinates: number[][][][] };
    readonly properties: {
      readonly id: string;
      readonly name: string;
      readonly status: string;
      readonly centerLat: number;
      readonly centerLng: number;
    };
  }>;
};

// Next.js 16 Cache Components: 'use cache' を関数単位に付け、
// 引数（airports は無し / prefCode）を自動的にキャッシュキーに含める。
// ファイル更新時は cacheTag を revalidateTag/updateTag で叩いて即時無効化できる。
const loadAirports = async (): Promise<readonly AirportCandidate[] | null> => {
  "use cache";
  cacheLife("days");
  cacheTag("regulation-data:airports");
  try {
    const json = JSON.parse(
      await fs.readFile(AIRPORTS_FILE, "utf8"),
    ) as AirportGeoJson;
    const candidates: AirportCandidate[] = json.features.map((f) => {
      const polygons: Polygon[] =
        f.geometry.type === "Polygon"
          ? f.geometry.coordinates[0]
            ? [ringToPolygon(f.geometry.coordinates[0])]
            : []
          : f.geometry.coordinates
              .map((poly) => poly[0])
              .filter((r): r is number[][] => Array.isArray(r))
              .map(ringToPolygon);
      return {
        id: f.properties.id,
        name: f.properties.name,
        polygons,
        center: { lat: f.properties.centerLat, lng: f.properties.centerLng },
      };
    });
    return candidates;
  } catch {
    return null;
  }
};

const loadPrefDid = async (
  prefCode: string,
): Promise<readonly DidCandidate[] | null> => {
  "use cache";
  cacheLife("days");
  cacheTag("regulation-data:did", `regulation-data:did:pref-${prefCode}`);
  const file = path.join(DID_DIR, `pref-${prefCode}.geojson`);
  try {
    const json = JSON.parse(await fs.readFile(file, "utf8")) as DidGeoJson;
    const candidates = json.features.flatMap(flattenFeatureToCandidates);
    return candidates;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
};

type ReverseGeocode = {
  readonly muniCode?: string;
  readonly address?: string;
};

const reverseGeocode = async (loc: LatLng): Promise<ReverseGeocode> => {
  const url = `https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress?lon=${loc.lng}&lat=${loc.lat}`;
  try {
    const res = await fetch(url, {
      headers: { accept: "application/json" },
      // GSI 推奨: keep small, no body
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return {};
    const data = (await res.json()) as { results?: { muniCd?: string; lv01Nm?: string } };
    const muniCd = data.results?.muniCd;
    const muniCode =
      typeof muniCd === "string" && /^\d{5,6}$/.test(muniCd)
        ? muniCd.padStart(5, "0").slice(-5)
        : undefined;
    return { muniCode, address: data.results?.lv01Nm };
  } catch {
    return {};
  }
};

export const runRegulationCheck = async (
  loc: LatLng,
): Promise<RegulationCheckResult> => {
  const [geocode, airportCandidates] = await Promise.all([
    reverseGeocode(loc),
    loadAirports(),
  ]);
  const prefCode = geocode.muniCode?.slice(0, 2);
  const didCandidates = prefCode ? await loadPrefDid(prefCode) : null;

  const regulations: readonly RegulationWithStatus[] = [
    evaluateDid(loc, didCandidates ?? []),
    evaluateAirports(loc, airportCandidates ?? []),
    evaluateMihoBase(loc),
    evaluateMunicipalParks(loc, geocode.muniCode),
    evaluateMunicipalHeritage(loc, geocode.muniCode),
    evaluatePrefecturalNuisance(loc, geocode.muniCode),
  ];

  const checkedAt = new Date().toISOString();
  const evidenceId = computeEvidenceId({
    lat: loc.lat,
    lng: loc.lng,
    checkedAt,
    regulationIds: regulations.map((r) => r.id),
  });

  return {
    overall: computeOverall(regulations),
    overallConfidence: computeOverallConfidence(regulations),
    regulations,
    checkedAt,
    resolvedAddress: geocode.address,
    muniCode: geocode.muniCode,
    evidenceId,
    engineVersion: ENGINE_VERSION,
    disclaimer: DEFAULT_DISCLAIMER,
  };
};
