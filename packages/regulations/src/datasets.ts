// データセット台帳（data/sources.json）と、反映済みの法令改正（Sprint 7, spec §13.3.3）。
//
// 各規制評価器の返り値（RegulationWithStatus）は、判定に使ったデータセットの参照（datasets）と
// 反映済みの改正（amendments）を持つ。画面・PDF はここから「データ名・基準年・確認日」と
// 「改正の根拠・施行日」を表示し、証跡 ID の入力にもデータセットの ID と確認日を含める。
import sourcesJson from "../data/sources.json";

export type DatasetRecord = {
  readonly id: string;
  readonly name: string;
  readonly provider: string;
  readonly url: string;
  readonly license: string;
  /** 基準年（例：令和2年国勢調査 → 2020）。基準年のない手描き seed は null。 */
  readonly baseYear: number | null;
  readonly version: string;
  /** 本体データの取得日（ISO 日付）。未取得は null。 */
  readonly acquiredAt: string | null;
  /** 出典・内容を確認した日（ISO 日付）。 */
  readonly verifiedAt: string;
  readonly verifiedBy: string;
  readonly coverage: string;
  /** 本体データをリポジトリに同梱しているか（false は判定が縮退する）。 */
  readonly bundled: boolean;
};

/** 規制評価の返り値に付けるデータセット参照（台帳からの抜粋）。 */
export type DatasetRef = {
  readonly id: string;
  readonly name: string;
  readonly baseYear: number | null;
  readonly verifiedAt: string;
};

/** 反映済みの法令改正。 */
export type AmendmentRef = {
  readonly id: string;
  readonly title: string;
  /** 施行日・適用日（ISO 日付）。 */
  readonly effectiveDate: string;
  readonly url: string;
};

type RawDataset = { readonly [K in keyof DatasetRecord]?: unknown };

const parseDataset = (raw: RawDataset): DatasetRecord => {
  const str = (k: keyof DatasetRecord): string => {
    const v = raw[k];
    if (typeof v !== "string" || v.length === 0) {
      throw new Error(`sources.json: ${String(raw.id)} の ${k} が空です（データ不備）`);
    }
    return v;
  };
  return {
    id: str("id"),
    name: str("name"),
    provider: str("provider"),
    url: str("url"),
    license: str("license"),
    baseYear: typeof raw.baseYear === "number" ? raw.baseYear : null,
    version: str("version"),
    acquiredAt: typeof raw.acquiredAt === "string" ? raw.acquiredAt : null,
    verifiedAt: str("verifiedAt"),
    verifiedBy: str("verifiedBy"),
    coverage: str("coverage"),
    bundled: raw.bundled === true,
  };
};

export const ALL_DATASETS: readonly DatasetRecord[] = (
  (sourcesJson as { datasets?: readonly RawDataset[] }).datasets ?? []
).map(parseDataset);

const DATASET_INDEX: ReadonlyMap<string, DatasetRecord> = new Map(
  ALL_DATASETS.map((d) => [d.id, d]),
);

export const getDataset = (id: string): DatasetRecord => {
  const d = DATASET_INDEX.get(id);
  if (!d) throw new Error(`データセット台帳に ${id} がありません（データ不備）`);
  return d;
};

export const datasetRef = (id: string): DatasetRef => {
  const d = getDataset(id);
  return { id: d.id, name: d.name, baseYear: d.baseYear, verifiedAt: d.verifiedAt };
};

export const DATASET_IDS = {
  did: "did-r2",
  industrialExclusive: "industrial-exclusive",
  smallDroneLawFacilities: "small-drone-law-facilities",
  airports: "airports-seed",
  parks: "parks-osm-seed",
  heritage: "heritage-seed",
  sensitiveFacilities: "sensitive-facilities-seed",
} as const;

// ── 反映済みの法令改正 ──

/** 国土交通省告示第435号（DID から工業専用地域を除く）。適用日 2026-07-01。 */
export const AMENDMENT_MLIT_KOKUJI_435: AmendmentRef = {
  id: "mlit-kokuji-435",
  title:
    "国土交通省告示第435号（令和8年3月31日）— 工業専用地域内の区域を DID の飛行許可の対象から除く（航空法施行規則第236条の72）",
  effectiveDate: "2026-07-01",
  url: "https://www.mlit.go.jp/koku/koku_fr10_000041.html",
};

/** 改正小型無人機等飛行禁止法（令和8年法律第47号）。施行日 2026-07-14。 */
export const AMENDMENT_SMALL_DRONE_LAW_2026: AmendmentRef = {
  id: "small-drone-law-2026",
  title:
    "改正小型無人機等飛行禁止法（令和8年法律第47号）— 周辺地域をおおむね 1,000m に拡大、周辺地域での飛行に罰則",
  effectiveDate: "2026-07-14",
  url: "https://www.npa.go.jp/bureau/security/kogatamujinki/index.html",
};

export const ALL_AMENDMENTS: readonly AmendmentRef[] = [
  AMENDMENT_MLIT_KOKUJI_435,
  AMENDMENT_SMALL_DRONE_LAW_2026,
];

/** 「データ名（基準年）確認日 YYYY-MM-DD」形式の表示文字列。 */
export const formatDatasetRef = (d: DatasetRef): string =>
  `${d.name}${d.baseYear !== null ? `（基準年 ${d.baseYear}）` : ""} 確認日 ${d.verifiedAt}`;

/** 「根拠（施行日 YYYY-MM-DD）」形式の表示文字列。 */
export const formatAmendmentRef = (a: AmendmentRef): string =>
  `${a.title}（施行・適用 ${a.effectiveDate}）`;
