import type { LatLng, Polygon } from "@soraban/geo";

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

// 米子市内の主要都市公園（簡易ポリゴン）。
// Phase 1 で米子市公園台帳の正規ポリゴンに置換予定。
export const YONAGO_PARKS: readonly Park[] = [
  {
    id: "minatoyama-park",
    name: "湊山公園（米子城跡）",
    polygon: [
      { lat: 35.4287, lng: 133.3194 },
      { lat: 35.4287, lng: 133.3245 },
      { lat: 35.4248, lng: 133.3245 },
      { lat: 35.4248, lng: 133.3194 },
    ],
  },
  {
    id: "higashiyama-park",
    name: "東山公園（どらドラパーク米子）",
    polygon: [
      { lat: 35.4180, lng: 133.3500 },
      { lat: 35.4180, lng: 133.3580 },
      { lat: 35.4130, lng: 133.3580 },
      { lat: 35.4130, lng: 133.3500 },
    ],
  },
  {
    id: "kamo-park",
    name: "加茂中央公園",
    polygon: [
      { lat: 35.4310, lng: 133.3340 },
      { lat: 35.4310, lng: 133.3375 },
      { lat: 35.4286, lng: 133.3375 },
      { lat: 35.4286, lng: 133.3340 },
    ],
  },
  {
    id: "kaike-onsen-park",
    name: "皆生温泉海浜公園",
    polygon: [
      { lat: 35.4540, lng: 133.3300 },
      { lat: 35.4540, lng: 133.3380 },
      { lat: 35.4510, lng: 133.3380 },
      { lat: 35.4510, lng: 133.3300 },
    ],
  },
  {
    id: "uchihama-park",
    name: "内浜産業道路緑地",
    polygon: [
      { lat: 35.4615, lng: 133.3120 },
      { lat: 35.4615, lng: 133.3185 },
      { lat: 35.4595, lng: 133.3185 },
      { lat: 35.4595, lng: 133.3120 },
    ],
  },
  {
    id: "yonago-stadium-park",
    name: "米子市民球場周辺緑地",
    polygon: [
      { lat: 35.4203, lng: 133.3445 },
      { lat: 35.4203, lng: 133.3490 },
      { lat: 35.4180, lng: 133.3490 },
      { lat: 35.4180, lng: 133.3445 },
    ],
  },
  {
    id: "fukuichi-park",
    name: "福市遺跡公園",
    polygon: [
      { lat: 35.4012, lng: 133.3215 },
      { lat: 35.4012, lng: 133.3260 },
      { lat: 35.3985, lng: 133.3260 },
      { lat: 35.3985, lng: 133.3215 },
    ],
  },
  {
    id: "yonago-waterfront-park",
    name: "中海ふれあい公園",
    polygon: [
      { lat: 35.4358, lng: 133.3070 },
      { lat: 35.4358, lng: 133.3125 },
      { lat: 35.4330, lng: 133.3125 },
      { lat: 35.4330, lng: 133.3070 },
    ],
  },
];

// 米子市内の文化財・史跡（簡易ポリゴン）。
// 米子城跡は国指定史跡（昭和31年指定）で、文化財保護法第125条により
// 現状変更には文化庁長官の許可が必要。Phase 1 で文化庁データベースから
// 正規ポリゴンに置換する。
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

export const SENSITIVE_FACILITY_BUFFER_M = 100;
