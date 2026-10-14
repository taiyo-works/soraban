import "server-only";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { cacheLife, cacheTag } from "next/cache";
import type { LatLng, Polygon } from "@soraban/geo";
import { DID_DIR } from "./regulation-data-dir";
import {
  AIRPORTS_GEOJSON,
  DEFAULT_DISCLAIMER,
  buildDiagnosisEvidencePayload,
  computeOverall,
  computeOverallConfidence,
  evaluateAirports,
  evaluateDid,
  evaluateMihoBase,
  evaluateMunicipalHeritage,
  evaluateMunicipalParks,
  evaluatePrefecturalNuisance,
  type AirportCandidate,
  type DiagnosisEvidencePayloadInput,
  type DidCandidate,
  type FlightContext,
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
  readonly ctx?: FlightContext;
};

// FlightContext を決定論的にシリアライズ（キー順を固定）。
// 機体条件が変われば evidenceId も変わる（同一座標・同一時刻でも別 ID）。
const stableCtx = (ctx: FlightContext | undefined): unknown => {
  if (!ctx) return null;
  const out: Record<string, unknown> = {};
  if (typeof ctx.droneWeightG === "number") out["w"] = ctx.droneWeightG;
  if (Array.isArray(ctx.pilotPermits)) out["p"] = [...ctx.pilotPermits].sort();
  if (typeof ctx.purpose === "string") out["u"] = ctx.purpose;
  if (typeof ctx.droneClass === "string") out["c"] = ctx.droneClass;
  return Object.keys(out).length > 0 ? out : null;
};

const computeEvidenceId = (input: EvidenceInputs): string => {
  const sortedIds = [...input.regulationIds].sort();
  const payload = JSON.stringify({
    v: ENGINE_VERSION,
    lat: Number(input.lat.toFixed(6)),
    lng: Number(input.lng.toFixed(6)),
    t: input.checkedAt,
    r: sortedIds,
    x: stableCtx(input.ctx),
  });
  const hex = createHash("sha256").update(payload).digest("hex");
  return `ev_${hex.slice(0, 16)}`;
};

// 申請支援診断（/api/diagnose）用の証跡ID採番。
// 位置・規制リストに加えて、選択フラグ・飛行予定日・立入管理措置・導出カテゴリー・必要手続きID群を
// SHA-256 ハッシュに含めることで「どの条件の申請支援診断か」を一意に同定する（spec §6.3）。
export const computeDiagnosisEvidenceId = (
  input: Omit<DiagnosisEvidencePayloadInput, "engineVersion">,
): string => {
  const payload = buildDiagnosisEvidencePayload({
    ...input,
    engineVersion: ENGINE_VERSION,
  });
  const hex = createHash("sha256").update(payload).digest("hex");
  return `ev_${hex.slice(0, 16)}`;
};

// 空港 GeoJSON は @soraban/regulations が静的 import で同梱 (AIRPORTS_GEOJSON)。
// DID は regulation-data-dir の DID_DIR (実データ未追跡の本番では unknown に縮退)。

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

// 空港候補は @soraban/regulations が静的 import で同梱した GeoJSON から組み立てる。
// ファイル I/O が無いので Vercel serverless でも確実に動く (バンドル済み)。
const loadAirports = (): readonly AirportCandidate[] => {
  return AIRPORTS_GEOJSON.features.map((f) => {
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
  ctx?: FlightContext,
): Promise<RegulationCheckResult> => {
  const [geocode, airportCandidates] = await Promise.all([
    reverseGeocode(loc),
    loadAirports(),
  ]);
  const prefCode = geocode.muniCode?.slice(0, 2);
  const didCandidates = prefCode ? await loadPrefDid(prefCode) : null;

  const regulations: readonly RegulationWithStatus[] = [
    evaluateDid(loc, didCandidates, ctx),
    evaluateAirports(loc, airportCandidates ?? [], ctx),
    evaluateMihoBase(loc, ctx),
    evaluateMunicipalParks(loc, geocode.muniCode, ctx),
    evaluateMunicipalHeritage(loc, geocode.muniCode, ctx),
    evaluatePrefecturalNuisance(loc, geocode.muniCode, ctx),
  ];

  const checkedAt = new Date().toISOString();
  const evidenceId = computeEvidenceId({
    lat: loc.lat,
    lng: loc.lng,
    checkedAt,
    regulationIds: regulations.map((r) => r.id),
    ctx,
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
