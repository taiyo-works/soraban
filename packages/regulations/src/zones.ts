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

// 境港市内の主要都市公園（簡易ポリゴン）。
// Phase 1 で境港市公園台帳から正規ポリゴン置換予定。
// 鳥取県境港市の市町村コード = 31204。
export const SAKAIMINATO_PARKS: readonly Park[] = [
  {
    id: "yume-minato-park",
    name: "夢みなと公園",
    polygon: [
      // JR 境港駅 (35.543, 133.228) を含めないため、駅の北西側に配置。
      { lat: 35.5470, lng: 133.2210 },
      { lat: 35.5470, lng: 133.2255 },
      { lat: 35.5445, lng: 133.2255 },
      { lat: 35.5445, lng: 133.2210 },
    ],
  },
  {
    id: "watari-park",
    name: "渡公園",
    polygon: [
      { lat: 35.5250, lng: 133.2400 },
      { lat: 35.5250, lng: 133.2435 },
      { lat: 35.5230, lng: 133.2435 },
      { lat: 35.5230, lng: 133.2400 },
    ],
  },
  {
    id: "amari-park",
    name: "余子公園",
    polygon: [
      { lat: 35.5400, lng: 133.2420 },
      { lat: 35.5400, lng: 133.2455 },
      { lat: 35.5375, lng: 133.2455 },
      { lat: 35.5375, lng: 133.2420 },
    ],
  },
  {
    id: "nakano-park",
    name: "中野公園",
    polygon: [
      { lat: 35.5475, lng: 133.2255 },
      { lat: 35.5475, lng: 133.2290 },
      { lat: 35.5450, lng: 133.2290 },
      { lat: 35.5450, lng: 133.2255 },
    ],
  },
];

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

// 出雲市内の主要都市公園（簡易ポリゴン）。
// Phase 1 で出雲市公園台帳から正規ポリゴン置換予定。
// 島根県出雲市の市町村コード = 32203。
export const IZUMO_PARKS: readonly Park[] = [
  {
    id: "izumo-dome-park",
    name: "出雲ドーム公園",
    polygon: [
      { lat: 35.3700, lng: 132.7550 },
      { lat: 35.3700, lng: 132.7595 },
      { lat: 35.3672, lng: 132.7595 },
      { lat: 35.3672, lng: 132.7550 },
    ],
  },
  {
    id: "izumo-taisha-park",
    name: "大社公園（出雲大社東側）",
    polygon: [
      // 出雲大社境内遺跡を含めず、東側の市営公園相当エリアを対象。
      { lat: 35.4030, lng: 132.6885 },
      { lat: 35.4030, lng: 132.6920 },
      { lat: 35.4002, lng: 132.6920 },
      { lat: 35.4002, lng: 132.6885 },
    ],
  },
  {
    id: "hamayama-park",
    name: "浜山公園",
    polygon: [
      { lat: 35.3810, lng: 132.7320 },
      { lat: 35.3810, lng: 132.7390 },
      { lat: 35.3760, lng: 132.7390 },
      { lat: 35.3760, lng: 132.7320 },
    ],
  },
  {
    id: "takasegawa-park",
    name: "高瀬川河川敷公園",
    polygon: [
      { lat: 35.3700, lng: 132.7610 },
      { lat: 35.3700, lng: 132.7660 },
      { lat: 35.3675, lng: 132.7660 },
      { lat: 35.3675, lng: 132.7610 },
    ],
  },
  {
    id: "kojindani-historic-park",
    name: "荒神谷史跡公園",
    polygon: [
      // 国指定史跡「荒神谷遺跡」を含む史跡公園。史跡レイヤと一部重なる構造で
      // "公園条例 × 文化財保護法" の同時 red を出雲側でも再現できる。
      { lat: 35.3885, lng: 132.8420 },
      { lat: 35.3885, lng: 132.8460 },
      { lat: 35.3855, lng: 132.8460 },
      { lat: 35.3855, lng: 132.8420 },
    ],
  },
];

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
