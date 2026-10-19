// 地点判定の本体（Sprint 7）。データの読み込み口（RegulationDataProvider）を引数で受け取る純粋な層。
//
// - 本番の読み込み口（同梱データ・GSI 逆ジオコーダ）は regulation-check.ts が組み立てる。
// - 統合テストは読み込み口をフィクスチャに差し替えて /api/check・/api/diagnose を検証する。
// - DB 化（Sprint 13）ではこの読み込み口だけを差し替える。
//
// "server-only" や next/cache に依存しない（vitest から import できるようにするため）。
import { createHash } from "node:crypto";
import type { LatLng } from "@soraban/geo";
import {
  AIRPORTS_GEOJSON,
  buildCheckEvidencePayload,
  buildDiagnosisEvidencePayload,
  computeOverall,
  computeOverallConfidence,
  DEFAULT_DISCLAIMER,
  ENGINE_VERSION,
  evaluateAirports,
  evaluateDid,
  evaluateMunicipalHeritage,
  evaluateMunicipalParks,
  evaluatePrefecturalNuisance,
  evaluateSmallDroneLaw,
  type AirportCandidate,
  type DatasetRef,
  type DiagnosisEvidencePayloadInput,
  type DidCandidate,
  type DidDataset,
  type FlightContext,
  type IndustrialExclusiveSource,
  type RegulationCheckResult,
  type RegulationWithStatus,
  type SmallDroneFacility,
} from "@soraban/regulations";
import type { Polygon } from "@soraban/geo";

export type ReverseGeocode = {
  readonly muniCode?: string;
  readonly address?: string;
};

export type RegulationDataProvider = {
  /** 都道府県単位の DID。未整備は null（判定は未確認に縮退）。 */
  readonly loadDid: (prefCode: string) => Promise<DidDataset | null>;
  /** DID を持っている都道府県コード（逆ジオコーディング失敗時に全件で当たりを探す）。 */
  readonly didPrefCodes: () => Promise<readonly string[]>;
  readonly industrial: IndustrialExclusiveSource;
  readonly reverseGeocode: (loc: LatLng) => Promise<ReverseGeocode>;
  /** 飛行禁止法の対象施設（未指定は同梱データ）。 */
  readonly smallDroneFacilities?: readonly SmallDroneFacility[];
};

const ringToPolygon = (ring: number[][]): Polygon =>
  ring.map(([lng, lat]) => ({ lat: lat ?? 0, lng: lng ?? 0 }));

// 空港候補は @soraban/regulations が静的 import で同梱した GeoJSON から組み立てる。
export const loadAirports = (): readonly AirportCandidate[] =>
  AIRPORTS_GEOJSON.features.map((f) => {
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

/** 判定結果に含まれるデータセット参照（重複除去）。証跡 ID の入力にする。 */
export const collectDatasets = (
  regulations: readonly RegulationWithStatus[],
): readonly DatasetRef[] => {
  const map = new Map<string, DatasetRef>();
  for (const r of regulations) for (const d of r.datasets) map.set(d.id, d);
  return Array.from(map.values()).sort((a, b) => a.id.localeCompare(b.id));
};

const sha16 = (payload: string): string =>
  `ev_${createHash("sha256").update(payload).digest("hex").slice(0, 16)}`;

export const computeCheckEvidenceId = (input: {
  readonly lat: number;
  readonly lng: number;
  readonly checkedAt: string;
  readonly regulationIds: readonly string[];
  readonly ctx?: FlightContext;
  readonly datasets: readonly DatasetRef[];
}): string =>
  sha16(buildCheckEvidencePayload({ ...input, engineVersion: ENGINE_VERSION }));

// 申請支援診断（/api/diagnose）用の証跡ID採番。
// 位置・規制リストに加えて、選択フラグ・飛行予定日・立入管理措置・導出カテゴリー・必要手続きID群・
// 使用データセットの確認日を SHA-256 ハッシュに含める（spec §6.3・§13.3.3）。
export const computeDiagnosisEvidenceId = (
  input: Omit<DiagnosisEvidencePayloadInput, "engineVersion">,
): string => sha16(buildDiagnosisEvidencePayload({ ...input, engineVersion: ENGINE_VERSION }));

const UNRESOLVED_PREF_NOTE =
  "判定地点の市町村を特定できず（逆ジオコーディング失敗）、同梱の DID にも該当しなかったため、DID 該当／非該当を確認できません（未確認）。地理院地図・DIPS で必ず確認してください。";

// DID の読み込み。市町村が分かれば当該都道府県、分からなければ同梱の全都道府県から当たりを探す。
// 市町村不明で当たりが無い場合は、収録外の都道府県の可能性があるため未確認に倒す。
const evaluateDidWith = async (
  provider: RegulationDataProvider,
  loc: LatLng,
  prefCode: string | undefined,
  ctx: FlightContext | undefined,
): Promise<RegulationWithStatus> => {
  const opts = { industrial: provider.industrial };
  if (prefCode) {
    return evaluateDid(loc, await provider.loadDid(prefCode), ctx, opts);
  }
  const codes = await provider.didPrefCodes();
  const sets = (await Promise.all(codes.map((c) => provider.loadDid(c)))).filter(
    (d): d is DidDataset => d !== null,
  );
  const merged: DidCandidate[] = sets.flatMap((d) => [...d.candidates]);
  const baseYear = sets[0]?.baseYear ?? null;
  const dataset: DidDataset = { datasetId: sets[0]?.datasetId ?? "did-r2", baseYear, candidates: merged };
  const r = evaluateDid(loc, sets.length > 0 ? dataset : null, ctx, opts);
  if (r.status === "green" && r.didDetail === "outside_did") {
    return { ...evaluateDid(loc, null, ctx, opts), note: UNRESOLVED_PREF_NOTE };
  }
  return r;
};

export const runRegulationCheckWith = async (
  provider: RegulationDataProvider,
  loc: LatLng,
  ctx?: FlightContext,
  now: () => Date = () => new Date(),
): Promise<RegulationCheckResult> => {
  const geocode = await provider.reverseGeocode(loc);
  const prefCode = geocode.muniCode?.slice(0, 2);

  const regulations: readonly RegulationWithStatus[] = [
    await evaluateDidWith(provider, loc, prefCode, ctx),
    evaluateAirports(loc, loadAirports(), ctx),
    evaluateSmallDroneLaw(loc, ctx, provider.smallDroneFacilities),
    evaluateMunicipalParks(loc, geocode.muniCode, ctx),
    evaluateMunicipalHeritage(loc, geocode.muniCode, ctx),
    evaluatePrefecturalNuisance(loc, geocode.muniCode, ctx),
  ];

  const checkedAt = now().toISOString();
  const evidenceId = computeCheckEvidenceId({
    lat: loc.lat,
    lng: loc.lng,
    checkedAt,
    regulationIds: regulations.map((r) => r.id),
    ctx,
    datasets: collectDatasets(regulations),
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
