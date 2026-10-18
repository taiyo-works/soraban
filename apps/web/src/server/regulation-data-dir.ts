import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  createIndustrialSource,
  DEFAULT_INDUSTRIAL_SOURCE,
  getBundledDidFile,
  BUNDLED_DID_PREF_CODES,
  didBundleToDataset,
  industrialBundleToZones,
  INDUSTRIAL_INSIDE_MARGIN_M,
  type DidBundleFile,
  type DidDataset,
  type IndustrialBundleFile,
  type IndustrialCoverageEntry,
  type IndustrialExclusiveSource,
  type IndustrialZone,
} from "@soraban/regulations";

// 規制データの読み込み口（Sprint 7）。
//
// 既定（本番）：@soraban/regulations が静的 import で同梱したデータ（鳥取県・島根県の DID 令和2年、
// 工業専用地域）を使う。ファイル I/O がないので Vercel の関数バンドルでも確実に読める。
//
// 差し替え（任意）：環境変数でディレクトリを指定すると、そちらを優先して読む。
//   - DID_DATA_DIR：pref-XX.json（同梱形式）または pref-XX.geojson（FeatureCollection。properties に muniCode・muniName）
//   - INDUSTRIAL_DATA_DIR：coverage.json と by-muni/{muniCode}.json（同梱形式）
// E2E のフィクスチャ用サーバーと、手元での検証に使う。

export const DID_DATA_DIR_OVERRIDE: string | undefined = process.env["DID_DATA_DIR"] || undefined;
export const INDUSTRIAL_DATA_DIR_OVERRIDE: string | undefined =
  process.env["INDUSTRIAL_DATA_DIR"] || undefined;

type LegacyDidGeoJson = {
  readonly type: "FeatureCollection";
  readonly features: ReadonlyArray<{
    readonly geometry:
      | { readonly type: "Polygon"; readonly coordinates: number[][][] }
      | { readonly type: "MultiPolygon"; readonly coordinates: number[][][][] };
    readonly properties: { readonly muniCode: string; readonly muniName: string; readonly year?: unknown };
  }>;
};

const legacyToBundle = (prefCode: string, json: LegacyDidGeoJson): DidBundleFile => {
  const year = json.features.find((f) => typeof f.properties.year === "number")?.properties.year;
  return {
    datasetId: "did-r2",
    baseYear: typeof year === "number" ? year : 0,
    prefCode,
    source: "DID_DATA_DIR（FeatureCollection）",
    generatedAt: "",
    features: json.features.flatMap((f) =>
      (f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates).map(
        (rings) => ({ muniCode: f.properties.muniCode, muniName: f.properties.muniName, rings }),
      ),
    ),
  };
};

const readJson = async <T,>(file: string): Promise<T | null> => {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
};

/** 都道府県単位の DID 生データ（同梱形式）。差し替えディレクトリ → 同梱 の順。 */
export const readDidBundleFile = async (prefCode: string): Promise<DidBundleFile | null> => {
  if (!/^\d{2}$/.test(prefCode)) return null;
  if (DID_DATA_DIR_OVERRIDE) {
    const bundle = await readJson<DidBundleFile>(path.join(DID_DATA_DIR_OVERRIDE, `pref-${prefCode}.json`));
    if (bundle) return bundle;
    const legacy = await readJson<LegacyDidGeoJson>(
      path.join(DID_DATA_DIR_OVERRIDE, `pref-${prefCode}.geojson`),
    );
    return legacy ? legacyToBundle(prefCode, legacy) : null;
  }
  return getBundledDidFile(prefCode);
};

export const readDidDataset = async (prefCode: string): Promise<DidDataset | null> => {
  const file = await readDidBundleFile(prefCode);
  if (!file) return null;
  const ds = didBundleToDataset(file);
  return file.baseYear > 0 ? ds : { ...ds, baseYear: null };
};

export const listDidPrefCodes = async (): Promise<readonly string[]> => {
  if (!DID_DATA_DIR_OVERRIDE) return BUNDLED_DID_PREF_CODES;
  try {
    const names = await fs.readdir(DID_DATA_DIR_OVERRIDE);
    return Array.from(
      new Set(
        names
          .map((n) => /^pref-(\d{2})\.(?:json|geojson)$/.exec(n)?.[1])
          .filter((c): c is string => typeof c === "string"),
      ),
    ).sort();
  } catch {
    return [];
  }
};

type IndustrialOverride = {
  readonly source: IndustrialExclusiveSource;
};

let industrialOverride: Promise<IndustrialOverride> | null = null;

const loadIndustrialOverride = async (dir: string): Promise<IndustrialOverride> => {
  const cov =
    (await readJson<{ insideMarginM?: number; municipalities?: IndustrialCoverageEntry[] }>(
      path.join(dir, "coverage.json"),
    )) ?? {};
  const coverage = cov.municipalities ?? [];
  const zonesByMuni: Record<string, readonly IndustrialZone[]> = {};
  for (const e of coverage) {
    const f = await readJson<IndustrialBundleFile>(path.join(dir, "by-muni", `${e.muniCode}.json`));
    if (f) zonesByMuni[e.muniCode] = industrialBundleToZones(f);
  }
  return {
    source: createIndustrialSource({
      coverage,
      zonesByMuni,
      insideMarginM: typeof cov.insideMarginM === "number" ? cov.insideMarginM : INDUSTRIAL_INSIDE_MARGIN_M,
    }),
  };
};

/** 工業専用地域の読み込み口。差し替えディレクトリがあればそちら、なければ同梱。 */
export const getIndustrialSource = async (): Promise<IndustrialExclusiveSource> => {
  if (!INDUSTRIAL_DATA_DIR_OVERRIDE) return DEFAULT_INDUSTRIAL_SOURCE;
  industrialOverride ??= loadIndustrialOverride(INDUSTRIAL_DATA_DIR_OVERRIDE);
  return (await industrialOverride).source;
};
