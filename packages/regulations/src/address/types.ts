// 住所検索（Sprint 9）の型。同梱索引の形式は scripts/build-address-index.mjs が書く JSON と一致させる。

/** 住所検索の出典。後続で出典（例：yahoo）を足すときはここに 1 つ加える。 */
export const GEOCODE_SOURCES = ["abr", "gsi"] as const;
export type GeocodeSource = (typeof GEOCODE_SOURCES)[number];

/** 一致した階層（深い順）。 */
export const GEOCODE_LEVELS = [
  "parcel",
  "residence",
  "block",
  "machiaza",
  "city",
  "prefecture",
  "unknown",
] as const;
export type GeocodeLevel = (typeof GEOCODE_LEVELS)[number];

export type GeocodeHit = {
  readonly source: GeocodeSource;
  readonly level: GeocodeLevel;
  /** 表示名（例：鳥取県米子市加茂町二丁目 1-2）。 */
  readonly title: string;
  readonly lat: number;
  readonly lng: number;
};

type Num = number | null;

/** index-<pref>.json */
export type AddressIndexFile = {
  readonly format: 1;
  readonly prefCode: string;
  readonly pref: string;
  readonly datasetId: string;
  readonly source: string;
  readonly license: string;
  readonly feed: string;
  readonly acquiredAt: string;
  readonly version: string;
  /** [lg_code, 郡, 市区町村, 区, 緯度, 経度] */
  readonly cities: readonly (readonly [string, string, string, string, Num, Num])[];
  /** [市区町村の添字, 町字 ID, 大字・町, 丁目, 小字, 緯度, 経度, 住居表示 1/0] */
  readonly towns: readonly (readonly [number, string, string, string, string, Num, Num, number])[];
  /** [町字の添字, 街区符号, 緯度, 経度] */
  readonly blocks: readonly (readonly [number, string, Num, Num])[];
  /** [街区の添字, 住居番号, 住居番号2, 緯度, 経度] */
  readonly residences: readonly (readonly [number, string, string, number, number])[];
};

/** parcels-<pref>.json（同梱した場合のみ） */
export type AddressParcelFile = {
  readonly format: 1;
  readonly prefCode: string;
  /** [町字の添字, 地番（例 "123-4"）, 緯度, 経度] */
  readonly parcels: readonly (readonly [number, string, number, number])[];
};

export type AddressBundleEntry = {
  readonly index: AddressIndexFile;
  readonly parcels: AddressParcelFile | null;
};
