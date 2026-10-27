// 地図の規制レイヤー（7 層）の定義：一覧の行 ↔ 地図の層 ID ↔ 判定の規則 の対応を 1 か所に置く（Sprint 12h PR ② Q-25）。
// 層を足す・消すと regulation-map-layers.test.ts が落ちる。「準備中」の行は、チェック・層 ID・判定の規則を持たない。
// 状態の語（公式データ／概算／準備中）は、データセット台帳（packages/regulations/data/sources.json）から出す。画面に直書きしない。
//
// 色：地図の中の色は地図用の固定色（地図タイルが暗でも明るいため。設計書 §9.6）。判定色の 5 段（--sb-v-*）とは別の色にし、
// 色以外（線種・模様）でも区別する。MapLibre の paint（JS）と凡例の見本が同じ値を使うよう、ここに置く。
import {
  COVERAGE_SUMMARY,
  DATASET_IDS,
  getDataset,
  SENSITIVE_FACILITY_BUFFER_M,
  SMALL_DRONE_LAW_FACILITIES,
  SMALL_DRONE_LAW_REG_ID,
} from "@soraban/regulations";
import { BASE_ZONE_LAYER_IDS, BASE_ZONE_LEGEND } from "./regulation-map-zones";

export type LayerKey = "did" | "industrial" | "airports" | "base" | "parks" | "heritage" | "sensitive";

export type LayerGroupName = "航空法" | "小型無人機等飛行禁止法" | "そらばん追加" | "その他";
export type LayerStatus = "公式データ" | "概算" | "準備中";

/** 地図の固定色（soraban-ui.css の --sb-map-* と同じ値）。 */
export const MAP_COLORS = {
  ink: "#262523",
  didLine: "#b3500a",
  industrial: "#7a7a72",
  industrialLine: "#4a4843",
  airportLine: "#4a4843",
  airportFill: "#6b6a64",
  parkFill: "#2e8b57",
  parkLine: "#225f36",
  heritageFill: "#8b5cf6",
  heritageLine: "#262523",
  sensitiveFill: "#c2410c",
  sensitiveLine: "#9a3412",
  pin: "#dc2626",
  candidate: "#1d3557",
} as const;

export type SwatchKind = "did" | "industrial" | "airport" | "base" | "park" | "heritage" | "sensitive";

export type LayerDef = {
  readonly key: LayerKey;
  readonly group: LayerGroupName;
  /** 読み上げ・出典の一覧で使う正式な名前。 */
  readonly label: string;
  /** チップに見せる短い名前（装飾。読み上げは label が担う）。 */
  readonly shortLabel: string;
  /** 出典・確認日（台帳から組み立てる）。 */
  readonly source: string;
  /** 色の意味など、ラベルだけでは伝わらない補足（任意）。 */
  readonly detail?: string;
  readonly swatch: SwatchKind;
  /** 色分けの意味を文字ラベル付きで示す（任意）。色だけに頼らない。 */
  readonly zones?: typeof BASE_ZONE_LEGEND;
  /** この層が持つ MapLibre の層 ID。凡例のチェックで一括して表示を切り替える。 */
  readonly layerIds: readonly string[];
  /** この層が使う判定の規則（regulation の id。市町村・県ごとの規則は接尾辞）。 */
  readonly ruleId: string;
  readonly dataset: string;
  readonly status: LayerStatus;
};

/** 出典の表記（データセット台帳から組み立てる）。 */
export const datasetLegend = (id: string): string => {
  const d = getDataset(id);
  const year = d.baseYear !== null ? `・基準年 ${d.baseYear}` : "";
  const bundled = d.bundled ? "" : "・本体データ未同梱";
  return `${d.name}${year}・確認日 ${d.verifiedAt}${bundled}`;
};

/**
 * 状態の語。台帳に「概算」と書かれているデータ（名前・提供元・収録範囲）は「概算」、それ以外で公的な原典（国土数値情報）を同梱しているものは「公式データ」。
 * 敷地・区域の形が概算のもの（shapeApproximate）も「概算」。
 */
export const layerStatusFor = (datasetId: string, shapeApproximate = false): LayerStatus => {
  const d = getDataset(datasetId);
  if (shapeApproximate || /概算/.test(`${d.name}${d.provider}${d.coverage}`)) return "概算";
  return d.bundled ? "公式データ" : "準備中";
};

const formatMuniBreakdown = (entries: ReadonlyArray<readonly [string, number]>): string =>
  entries
    .filter(([, n]) => n > 0)
    .map(([name, n]) => `${name.replace(/[市区町村]$/, "")}${n}`)
    .join(" + ");

const PARK_BREAKDOWN = formatMuniBreakdown(COVERAGE_SUMMARY.municipalParkCounts);
const HERITAGE_BREAKDOWN = formatMuniBreakdown(COVERAGE_SUMMARY.municipalHeritageCounts);
const SENSITIVE_BREAKDOWN = formatMuniBreakdown(COVERAGE_SUMMARY.municipalSensitiveCounts);
const PARK_MUNI_LABEL = COVERAGE_SUMMARY.municipalParkNames.join("・");
const HERITAGE_MUNI_LABEL = COVERAGE_SUMMARY.municipalHeritageCounts.map(([name]) => name).join("・");
const PREF_NUISANCE_LABEL = COVERAGE_SUMMARY.prefectureNuisanceNames.join("・");

// 指定は確認できたが位置を確認できず、地図に収録していない施設（README.md「確認できなかった事項」）。
const UNMAPPED_FACILITY_NOTE = "情報本部 美保通信所は位置を確認できず未収録";

/** 一覧の並び（DIPS と同じ群：航空法／小型無人機等飛行禁止法／そらばん追加）。 */
export const LAYER_DEFS: readonly LayerDef[] = [
  {
    key: "airports",
    shortLabel: "空港等周辺",
    group: "航空法",
    label: "空港等周辺",
    source: datasetLegend(DATASET_IDS.airports),
    swatch: "airport",
    layerIds: ["airports-fill", "airports-outline"],
    ruleId: "aviation-law-airport",
    dataset: DATASET_IDS.airports,
    status: layerStatusFor(DATASET_IDS.airports),
  },
  {
    key: "did",
    shortLabel: "DID",
    group: "航空法",
    label: "DID（航空法第132条の85）",
    source: datasetLegend(DATASET_IDS.did),
    swatch: "did",
    layerIds: ["did-fill", "did-outline"],
    ruleId: "aviation-law-did",
    dataset: DATASET_IDS.did,
    status: layerStatusFor(DATASET_IDS.did),
  },
  {
    key: "industrial",
    shortLabel: "工業専用",
    group: "航空法",
    label: "工業専用地域（DID から除外・告示第435号）",
    source: datasetLegend(DATASET_IDS.industrialExclusive),
    detail: "収録済みの市町村のみ表示",
    swatch: "industrial",
    layerIds: ["industrial-fill", "industrial-outline"],
    // DID の規則の例外（工業専用地域は DID の許可が不要）として使う
    ruleId: "aviation-law-did",
    dataset: DATASET_IDS.industrialExclusive,
    status: layerStatusFor(DATASET_IDS.industrialExclusive),
  },
  {
    key: "base",
    shortLabel: "小型無人機法",
    group: "小型無人機等飛行禁止法",
    label: `小型無人機等飛行禁止法 対象施設 ${SMALL_DRONE_LAW_FACILITIES.length} 件（地図に収録）`,
    source: `${datasetLegend(DATASET_IDS.smallDroneLawFacilities)}・敷地形状は概算`,
    detail: `指定を確認できた施設のうち地図に収録できたのは${SMALL_DRONE_LAW_FACILITIES.length}件。${UNMAPPED_FACILITY_NOTE}`,
    swatch: "base",
    zones: BASE_ZONE_LEGEND,
    layerIds: BASE_ZONE_LAYER_IDS,
    ruleId: SMALL_DRONE_LAW_REG_ID,
    dataset: DATASET_IDS.smallDroneLawFacilities,
    status: layerStatusFor(DATASET_IDS.smallDroneLawFacilities, true),
  },
  {
    key: "parks",
    shortLabel: "都市公園",
    group: "そらばん追加",
    label: `都市公園（${PARK_BREAKDOWN} / 計 ${COVERAGE_SUMMARY.totalParks} 件）`,
    source: `${PARK_MUNI_LABEL} 都市公園条例`,
    swatch: "park",
    layerIds: ["parks-fill", "parks-outline"],
    ruleId: "park-ordinance",
    dataset: "parks-osm-seed",
    status: layerStatusFor("parks-osm-seed"),
  },
  {
    key: "heritage",
    shortLabel: "指定史跡",
    group: "そらばん追加",
    label: `指定史跡（${HERITAGE_BREAKDOWN} / 計 ${COVERAGE_SUMMARY.totalHeritage} 件）`,
    source: `文化財保護法125条 / ${HERITAGE_MUNI_LABEL} 文化財条例`,
    swatch: "heritage",
    layerIds: ["heritage-fill", "heritage-outline"],
    ruleId: "heritage-protection",
    dataset: "heritage-seed",
    status: layerStatusFor("heritage-seed"),
  },
  {
    key: "sensitive",
    shortLabel: "公衆密集地",
    group: "そらばん追加",
    label: `公衆密集地 ${SENSITIVE_FACILITY_BUFFER_M}m（${SENSITIVE_BREAKDOWN} / 計 ${COVERAGE_SUMMARY.totalSensitive} 件）`,
    source: `${PREF_NUISANCE_LABEL} 迷惑行為等防止条例`,
    swatch: "sensitive",
    layerIds: ["sensitive-fill", "sensitive-outline"],
    ruleId: "pref-nuisance-prevention",
    dataset: "sensitive-facilities-seed",
    status: layerStatusFor("sensitive-facilities-seed"),
  },
];

/** 地図に出さない行（チェックも層 ID も判定の規則も持たない）。判定に使っている層を「準備中」とは書かない。 */
export const NO_LAYER_ROWS: ReadonlyArray<{ readonly group: LayerGroupName; readonly label: string; readonly note: string }> = [
  {
    group: "その他",
    label: "緊急用務空域",
    note: "動的な情報のため、地図には出しません。この判定にも反映していません。飛行の前に必ず DIPS でご確認ください",
  },
];

export const LAYER_GROUP_ORDER: readonly LayerGroupName[] = ["航空法", "小型無人機等飛行禁止法", "その他", "そらばん追加"];
