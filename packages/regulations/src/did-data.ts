// DID（人口集中地区）データの同梱形式と、判定用の候補への変換（Sprint 7）。
//
// 同梱形式（data/did/r2/pref-XX.json）は scripts/build-did-r2.mjs が国土数値情報 A16（令和2年）から生成する。
// 座標は [経度, 緯度]、小数 6 桁に丸める。形状の単純化はしない（境界が縮むと過小判定になる）。
import type { Polygon } from "@soraban/geo";
import { DID_BUNDLE } from "./data-bundle/did-bundle";

export type DidCandidate = {
  readonly muniCode: string;
  readonly muniName: string;
  /** 外周リング。穴（DID 内の非 DID 区域）は保守側に無視する（DID 扱い＝過大判定側）。 */
  readonly polygon: Polygon;
};

export type DidBundleFeature = {
  readonly muniCode: string;
  readonly muniName: string;
  /** rings[0] が外周。各点は [経度, 緯度]。 */
  readonly rings: readonly (readonly (readonly number[])[])[];
};

export type DidBundleFile = {
  readonly datasetId: string;
  readonly baseYear: number;
  readonly prefCode: string;
  readonly source: string;
  readonly generatedAt: string;
  readonly features: readonly DidBundleFeature[];
};

/** 判定に渡す DID データ一式（候補ポリゴンと、その基準年・データセット ID）。 */
export type DidDataset = {
  readonly datasetId: string;
  readonly baseYear: number | null;
  readonly candidates: readonly DidCandidate[];
};

const ringToPolygon = (ring: readonly (readonly number[])[]): Polygon =>
  ring.map(([lng, lat]) => ({ lat: lat ?? 0, lng: lng ?? 0 }));

export const didBundleToDataset = (file: DidBundleFile): DidDataset => ({
  datasetId: file.datasetId,
  baseYear: file.baseYear,
  candidates: file.features
    .filter((f) => Array.isArray(f.rings[0]) && f.rings[0]!.length >= 3)
    .map((f) => ({
      muniCode: f.muniCode,
      muniName: f.muniName,
      polygon: ringToPolygon(f.rings[0]!),
    })),
});

/** 同梱済みの都道府県コード一覧。 */
export const BUNDLED_DID_PREF_CODES: readonly string[] = Object.keys(DID_BUNDLE).sort();

/** 同梱の DID（都道府県単位）。未同梱は null（判定は未確認に縮退）。 */
export const loadBundledDid = (prefCode: string): DidDataset | null => {
  const file = DID_BUNDLE[prefCode];
  return file ? didBundleToDataset(file) : null;
};

/** 同梱の DID 生データ（地図レイヤー配信用）。未同梱は null。 */
export const getBundledDidFile = (prefCode: string): DidBundleFile | null =>
  DID_BUNDLE[prefCode] ?? null;
