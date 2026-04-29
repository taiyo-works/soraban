import type { LatLng, Polygon } from "@soraban/geo";

// 都市公園 polygon は data/parks/by-muni/{muniCode}.json から読み込む。
// 自治体追加・正規ポリゴン置換時はこの JSON を更新すれば evaluator/UI に
// 自動反映される。詳細フローは packages/regulations/scripts/README.md。
import yonagoParksJson from "../data/parks/by-muni/31202.json";
import sakaiminatoParksJson from "../data/parks/by-muni/31204.json";
import izumoParksJson from "../data/parks/by-muni/32203.json";

// 自衛隊美保基地（米子鬼太郎空港共用） — 滑走路中央付近。
// 35°29′37″N 133°14′10″E
export const MIHO_AIRBASE_CENTER: LatLng = {
  lat: 35.4936,
  lng: 133.2361,
};

// 小型無人機等飛行禁止法の対象範囲（おおむね 300m）。
export const MIHO_AIRBASE_RED_M = 300;

// 空港周辺の進入表面・要確認エリアの簡易バッファ（1.5km）。
export const MIHO_AIRBASE_YELLOW_M = 1500;

export type Park = {
  readonly id: string;
  readonly name: string;
  readonly polygon: Polygon;
};

// JSON で取り込んだ raw data を Park[] に整形する。
// 将来の N06 GeoJSON 置換時もここを通すことでスキーマ変更を 1 箇所で吸収できる。
type ParksFile = {
  readonly muniCode: string;
  readonly muniName: string;
  readonly parks: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly polygon: ReadonlyArray<{ readonly lat: number; readonly lng: number }>;
  }>;
};

const toParks = (file: ParksFile): readonly Park[] =>
  file.parks.map((p) => ({
    id: p.id,
    name: p.name,
    polygon: p.polygon.map((pt) => ({ lat: pt.lat, lng: pt.lng })),
  }));

// 米子市内の主要都市公園。data/parks/by-muni/31202.json から取り込み。
export const YONAGO_PARKS: readonly Park[] = toParks(yonagoParksJson);

// 文化財・史跡（簡易ポリゴン）。
// 国指定史跡は文化財保護法第125条により現状変更には文化庁長官の許可が必要。
// Phase 1 で文化庁国指定文化財データベースから正規ポリゴンに置換する。
export type HeritageSite = {
  readonly id: string;
  readonly name: string;
  readonly designation: "国指定史跡" | "県指定" | "市指定";
  readonly polygon: Polygon;
};

export const YONAGO_HERITAGE_SITES: readonly HeritageSite[] = [
  {
    id: "yonago-castle-ruins",
    name: "米子城跡（国指定史跡）",
    designation: "国指定史跡",
    polygon: [
      { lat: 35.4280, lng: 133.3199 },
      { lat: 35.4280, lng: 133.3238 },
      { lat: 35.4253, lng: 133.3238 },
      { lat: 35.4253, lng: 133.3199 },
    ],
  },
  {
    id: "fukuichi-ruins",
    name: "福市遺跡（県指定史跡）",
    designation: "県指定",
    polygon: [
      { lat: 35.4008, lng: 133.3220 },
      { lat: 35.4008, lng: 133.3255 },
      { lat: 35.3990, lng: 133.3255 },
      { lat: 35.3990, lng: 133.3220 },
    ],
  },
];

// 米子市内の "公衆密集地" 想定エリア。鳥取県迷惑行為等防止条例の
// 第7条系統（公衆に対する著しい迷惑）の運用上、上空飛行の自粛が
// 推奨されることが多い場所。半径 100m を半径バッファとして適用する。
export type SensitiveFacility = {
  readonly id: string;
  readonly name: string;
  readonly category: "病院" | "学校" | "庁舎" | "駅" | "宿泊地";
  readonly center: LatLng;
};

export const YONAGO_SENSITIVE_FACILITIES: readonly SensitiveFacility[] = [
  {
    id: "yonago-city-hall",
    name: "米子市役所",
    category: "庁舎",
    center: { lat: 35.4283, lng: 133.3306 },
  },
  {
    id: "yonago-medical-center",
    name: "鳥取大学医学部附属病院",
    category: "病院",
    center: { lat: 35.4495, lng: 133.3430 },
  },
  {
    id: "yonago-station",
    name: "JR米子駅",
    category: "駅",
    center: { lat: 35.4258, lng: 133.3349 },
  },
  {
    id: "kaike-onsen",
    name: "皆生温泉街",
    category: "宿泊地",
    center: { lat: 35.4538, lng: 133.3333 },
  },
];

// 境港市内の主要都市公園。data/parks/by-muni/31204.json から取り込み。
export const SAKAIMINATO_PARKS: readonly Park[] = toParks(sakaiminatoParksJson);

// 境港市内の "公衆密集地" 想定エリア。鳥取県迷惑行為等防止条例の運用上、
// 上空飛行の自粛が推奨される場所。半径 100m を半径バッファとして適用する。
export const SAKAIMINATO_SENSITIVE_FACILITIES: readonly SensitiveFacility[] = [
  {
    id: "sakaiminato-city-hall",
    name: "境港市役所",
    category: "庁舎",
    center: { lat: 35.5404, lng: 133.2326 },
  },
  {
    id: "sakaiminato-station",
    name: "JR境港駅",
    category: "駅",
    center: { lat: 35.5430, lng: 133.2280 },
  },
  {
    id: "sakaiminato-general-hospital",
    name: "境港総合病院",
    category: "病院",
    center: { lat: 35.5310, lng: 133.2440 },
  },
];

// 出雲市内の主要都市公園。data/parks/by-muni/32203.json から取り込み。
// 荒神谷史跡公園は史跡レイヤと一部重なる構造で「公園条例 × 文化財保護法」
// の同時 red を出雲側でも再現できるよう、JSON 側で明示している。
export const IZUMO_PARKS: readonly Park[] = toParks(izumoParksJson);

// 出雲市内の "公衆密集地" 想定エリア。
// 島根県迷惑行為等防止条例の運用上、上空飛行の自粛が推奨される場所。
export const IZUMO_SENSITIVE_FACILITIES: readonly SensitiveFacility[] = [
  {
    id: "izumo-city-hall",
    name: "出雲市役所",
    category: "庁舎",
    center: { lat: 35.3676, lng: 132.7549 },
  },
  {
    id: "izumo-station",
    name: "JR出雲市駅",
    category: "駅",
    center: { lat: 35.3625, lng: 132.7549 },
  },
  {
    id: "izumo-taisha-mae-station",
    name: "一畑電車 出雲大社前駅",
    category: "駅",
    center: { lat: 35.3994, lng: 132.6862 },
  },
  {
    id: "shimane-pref-central-hospital",
    name: "島根県立中央病院",
    category: "病院",
    center: { lat: 35.3712, lng: 132.7519 },
  },
  {
    id: "izumo-taisha",
    name: "出雲大社（参拝者密集地）",
    category: "宿泊地",
    center: { lat: 35.4019, lng: 132.6852 },
  },
];

// 出雲市内の指定文化財・史跡（簡易ポリゴン）。
// 荒神谷遺跡: 銅剣358本ほか出土、昭和62年国指定史跡。文化財保護法第125条適用。
// 出雲大社境内遺跡: 平成16年国指定史跡（巨大柱遺構等）。
export const IZUMO_HERITAGE_SITES: readonly HeritageSite[] = [
  {
    id: "kojindani-ruins",
    name: "荒神谷遺跡（国指定史跡）",
    designation: "国指定史跡",
    polygon: [
      { lat: 35.3878, lng: 132.8425 },
      { lat: 35.3878, lng: 132.8455 },
      { lat: 35.3858, lng: 132.8455 },
      { lat: 35.3858, lng: 132.8425 },
    ],
  },
  {
    id: "izumo-taisha-keidai-ruins",
    name: "出雲大社境内遺跡（国指定史跡）",
    designation: "国指定史跡",
    polygon: [
      { lat: 35.4030, lng: 132.6840 },
      { lat: 35.4030, lng: 132.6870 },
      { lat: 35.4008, lng: 132.6870 },
      { lat: 35.4008, lng: 132.6840 },
    ],
  },
];

// 全自治体合算（地図レイヤ・県条例の公衆密集地評価で使用）。
// 自治体追加時はここに append するだけで、UI 側は変更不要。
export const ALL_MUNICIPAL_PARKS: readonly Park[] = [
  ...YONAGO_PARKS,
  ...SAKAIMINATO_PARKS,
  ...IZUMO_PARKS,
];

export const ALL_SENSITIVE_FACILITIES: readonly SensitiveFacility[] = [
  ...YONAGO_SENSITIVE_FACILITIES,
  ...SAKAIMINATO_SENSITIVE_FACILITIES,
  ...IZUMO_SENSITIVE_FACILITIES,
];

export const ALL_HERITAGE_SITES: readonly HeritageSite[] = [
  ...YONAGO_HERITAGE_SITES,
  ...IZUMO_HERITAGE_SITES,
];

export const SENSITIVE_FACILITY_BUFFER_M = 100;
