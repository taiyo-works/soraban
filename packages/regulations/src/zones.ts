import type { LatLng, Polygon } from "@soraban/geo";

// 都市公園 polygon は data/parks/by-muni/{muniCode}.json から読み込む。
// 自治体追加・正規ポリゴン置換時はこの JSON を更新すれば evaluator/UI に
// 自動反映される。詳細フローは packages/regulations/scripts/README.md。
import tottoriParksJson from "../data/parks/by-muni/31201.json";
import yonagoParksJson from "../data/parks/by-muni/31202.json";
import kurayoshiParksJson from "../data/parks/by-muni/31203.json";
import sakaiminatoParksJson from "../data/parks/by-muni/31204.json";
import yazuParksJson from "../data/parks/by-muni/31329.json";
import misasaParksJson from "../data/parks/by-muni/31364.json";
import yurihamaParksJson from "../data/parks/by-muni/31370.json";
import matsueParksJson from "../data/parks/by-muni/32201.json";
import izumoParksJson from "../data/parks/by-muni/32203.json";
import ohdaParksJson from "../data/parks/by-muni/32205.json";
import yasugiParksJson from "../data/parks/by-muni/32206.json";
import unnanParksJson from "../data/parks/by-muni/32209.json";

// 自衛隊美保基地（米子鬼太郎空港共用） — 滑走路中央付近。
// 35°29′37″N 133°14′10″E
export const MIHO_AIRBASE_CENTER: LatLng = {
  lat: 35.4936,
  lng: 133.2361,
};

// 飛行禁止法の判定（周辺地域おおむね 1,000m・敷地境界基準）は small-drone-law.ts と
// data/small-drone-law/facilities.json に移した（Sprint 7）。旧 300m／1.5km の定数は廃止。

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
// 後続で文化庁国指定文化財データベースの正規ポリゴンに置き換える。
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
    // 米子市加茂町1-1: 35°25′40″N 133°19′53″E
    center: { lat: 35.4278, lng: 133.3314 },
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
    // 境港市上道町3000: 35°32′20″N 133°13′54″E
    center: { lat: 35.5389, lng: 133.2317 },
  },
  {
    id: "sakaiminato-station",
    name: "JR境港駅",
    category: "駅",
    // 境港市大正町209-1: 35°32′41″N 133°13′37″E
    center: { lat: 35.5447, lng: 133.2269 },
  },
  {
    id: "sakaiminato-general-hospital",
    name: "境港総合病院",
    category: "病院",
    // 境港市米川町10: 35°31′55″N 133°15′28″E
    center: { lat: 35.5320, lng: 133.2578 },
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
    // 出雲市今市町70: 35°22′06″N 132°45′24″E
    center: { lat: 35.3683, lng: 132.7567 },
  },
  {
    id: "izumo-station",
    name: "JR出雲市駅",
    category: "駅",
    // 出雲市駅北町: 35°21′45″N 132°45′24″E
    center: { lat: 35.3625, lng: 132.7567 },
  },
  {
    id: "izumo-taisha-mae-station",
    name: "一畑電車 出雲大社前駅",
    category: "駅",
    // 大社町杵築南: 35°23′59″N 132°41′16″E
    center: { lat: 35.3997, lng: 132.6878 },
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

// =====================================================================
// 鳥取市 (31201) — 鳥取県県都
// =====================================================================
export const TOTTORI_PARKS: readonly Park[] = toParks(tottoriParksJson);

export const TOTTORI_SENSITIVE_FACILITIES: readonly SensitiveFacility[] = [
  {
    id: "tottori-city-hall",
    name: "鳥取市役所",
    category: "庁舎",
    // 鳥取市尚徳町116: 35°30′13″N 134°14′20″E
    center: { lat: 35.5036, lng: 134.2389 },
  },
  {
    id: "tottori-pref-office",
    name: "鳥取県庁",
    category: "庁舎",
    // 鳥取市東町1: 35°30′13″N 134°14′17″E
    center: { lat: 35.5036, lng: 134.2381 },
  },
  {
    id: "tottori-station",
    name: "JR鳥取駅",
    category: "駅",
    // 鳥取市東品治町111-1: 35°29′41″N 134°13′47″E
    center: { lat: 35.4947, lng: 134.2297 },
  },
  {
    id: "tottori-pref-central-hospital",
    name: "鳥取県立中央病院",
    category: "病院",
    // 鳥取市江津730: 35°29′16″N 134°13′55″E
    center: { lat: 35.4878, lng: 134.2319 },
  },
];

// 鳥取城跡: 久松山一帯、戦国〜近世の山城・平山城。
// 1957 (昭和32) 年国指定史跡。文化財保護法第125条適用。
export const TOTTORI_HERITAGE_SITES: readonly HeritageSite[] = [
  {
    id: "tottori-castle-ruins",
    name: "鳥取城跡（国指定史跡）",
    designation: "国指定史跡",
    polygon: [
      { lat: 35.5060, lng: 134.2410 },
      { lat: 35.5060, lng: 134.2470 },
      { lat: 35.5020, lng: 134.2470 },
      { lat: 35.5020, lng: 134.2410 },
    ],
  },
];

// =====================================================================
// 倉吉市 (31203) — 鳥取県中部
// =====================================================================
export const KURAYOSHI_PARKS: readonly Park[] = toParks(kurayoshiParksJson);

export const KURAYOSHI_SENSITIVE_FACILITIES: readonly SensitiveFacility[] = [
  {
    id: "kurayoshi-city-hall",
    name: "倉吉市役所",
    category: "庁舎",
    // 倉吉市葵町722: 35°25′47″N 133°49′20″E
    center: { lat: 35.4297, lng: 133.8222 },
  },
  {
    id: "kurayoshi-station",
    name: "JR倉吉駅",
    category: "駅",
    // 倉吉市山根557-1: 35°26′01″N 133°50′24″E
    center: { lat: 35.4336, lng: 133.8400 },
  },
  {
    id: "kurayoshi-koseibyoin",
    name: "厚生病院（倉吉）",
    category: "病院",
    // 倉吉市東昭和町150: 35°25′25″N 133°49′17″E
    center: { lat: 35.4236, lng: 133.8214 },
  },
  {
    id: "kurayoshi-shirakabe-dozogun",
    name: "白壁土蔵群（観光客密集地）",
    category: "宿泊地",
    center: { lat: 35.4313, lng: 133.8230 },
  },
];

// 伯耆国分寺跡: 倉吉市国府、奈良時代の国分寺遺構。
// 国指定史跡 (1922 大正11年指定)。
export const KURAYOSHI_HERITAGE_SITES: readonly HeritageSite[] = [
  {
    id: "houki-kokubunji-ruins",
    name: "伯耆国分寺跡（国指定史跡）",
    designation: "国指定史跡",
    polygon: [
      { lat: 35.4318, lng: 133.7870 },
      { lat: 35.4318, lng: 133.7930 },
      { lat: 35.4290, lng: 133.7930 },
      { lat: 35.4290, lng: 133.7870 },
    ],
  },
];

// =====================================================================
// 松江市 (32201) — 島根県県都
// =====================================================================
export const MATSUE_PARKS: readonly Park[] = toParks(matsueParksJson);

export const MATSUE_SENSITIVE_FACILITIES: readonly SensitiveFacility[] = [
  {
    id: "matsue-city-hall",
    name: "松江市役所",
    category: "庁舎",
    // 松江市末次町86: 35°28′05″N 133°03′03″E
    center: { lat: 35.4681, lng: 133.0508 },
  },
  {
    id: "shimane-pref-office",
    name: "島根県庁",
    category: "庁舎",
    // 松江市殿町1: 35°28′16″N 133°03′04″E
    center: { lat: 35.4711, lng: 133.0511 },
  },
  {
    id: "matsue-station",
    name: "JR松江駅",
    category: "駅",
    // 松江市朝日町472-2: 35°27′27″N 133°03′07″E
    center: { lat: 35.4575, lng: 133.0519 },
  },
  {
    id: "matsue-redcross-hospital",
    name: "松江赤十字病院",
    category: "病院",
    // 松江市横浜町200: 35°28′10″N 133°03′37″E
    center: { lat: 35.4694, lng: 133.0603 },
  },
  {
    id: "matsue-shinjiko-onsen",
    name: "松江しんじ湖温泉",
    category: "宿泊地",
    // 一畑電車駅周辺 (松江市西茶町): 35°28′32″N 133°02′27″E
    center: { lat: 35.4756, lng: 133.0408 },
  },
];

// 松江城跡: 松江市殿町。慶長16年築城、現存12天守の1つ。
// 国宝 (天守、2015 平成27年指定) + 国指定史跡 (1934 昭和9年指定)。
export const MATSUE_HERITAGE_SITES: readonly HeritageSite[] = [
  {
    id: "matsue-castle-ruins",
    name: "松江城跡（国指定史跡・天守国宝）",
    designation: "国指定史跡",
    polygon: [
      { lat: 35.4760, lng: 133.0490 },
      { lat: 35.4760, lng: 133.0540 },
      { lat: 35.4730, lng: 133.0540 },
      { lat: 35.4730, lng: 133.0490 },
    ],
  },
];

// =====================================================================
// 三朝町 (31364) — 鳥取県中部・三朝温泉/三徳山
// =====================================================================
export const MISASA_PARKS: readonly Park[] = toParks(misasaParksJson);

export const MISASA_SENSITIVE_FACILITIES: readonly SensitiveFacility[] = [
  {
    id: "misasa-town-hall",
    name: "三朝町役場",
    category: "庁舎",
    // 三朝町大瀬1156-6: 35°24′12″N 133°52′40″E
    center: { lat: 35.4033, lng: 133.8778 },
  },
  {
    id: "misasa-onsen",
    name: "三朝温泉街",
    category: "宿泊地",
    center: { lat: 35.4030, lng: 133.8755 },
  },
  {
    id: "misasa-medical-center",
    name: "鳥取大学医学部附属病院 三朝医療センター",
    category: "病院",
    center: { lat: 35.4045, lng: 133.8800 },
  },
];

// 三徳山: 三佛寺奥院（投入堂）は国宝、三徳山一帯は「国指定名勝及び史跡」
// （1934 昭和9年指定）。文化財保護法第125条適用。
// 「日本遺産」第一号（2015 平成27年認定: 三徳山・三朝温泉）。
export const MISASA_HERITAGE_SITES: readonly HeritageSite[] = [
  {
    id: "mitokusan-sanbutsuji",
    name: "三徳山（三佛寺・投入堂）（国指定名勝及び史跡）",
    designation: "国指定史跡",
    polygon: [
      { lat: 35.4010, lng: 133.9340 },
      { lat: 35.4010, lng: 133.9420 },
      { lat: 35.3960, lng: 133.9420 },
      { lat: 35.3960, lng: 133.9340 },
    ],
  },
];

// =====================================================================
// 湯梨浜町 (31370) — 鳥取県中部・東郷池/はわい温泉
// =====================================================================
export const YURIHAMA_PARKS: readonly Park[] = toParks(yurihamaParksJson);

export const YURIHAMA_SENSITIVE_FACILITIES: readonly SensitiveFacility[] = [
  {
    id: "yurihama-town-hall",
    name: "湯梨浜町役場",
    category: "庁舎",
    // 湯梨浜町久留19-1: 35°29′11″N 133°54′32″E
    center: { lat: 35.4864, lng: 133.9089 },
  },
  {
    id: "matsuzaki-station",
    name: "JR松崎駅",
    category: "駅",
    // 湯梨浜町松崎: 35°28′44″N 133°54′40″E
    center: { lat: 35.4789, lng: 133.9111 },
  },
  {
    id: "hawai-onsen",
    name: "はわい温泉街",
    category: "宿泊地",
    center: { lat: 35.4880, lng: 133.8990 },
  },
];

// 馬ノ山古墳群: 4世紀後半〜5世紀の前方後円墳群、県指定史跡。
export const YURIHAMA_HERITAGE_SITES: readonly HeritageSite[] = [
  {
    id: "umanoyama-kofun-gun",
    name: "馬ノ山古墳群（県指定史跡）",
    designation: "県指定",
    polygon: [
      { lat: 35.4940, lng: 133.8830 },
      { lat: 35.4940, lng: 133.8880 },
      { lat: 35.4910, lng: 133.8880 },
      { lat: 35.4910, lng: 133.8830 },
    ],
  },
];

// =====================================================================
// 八頭町 (31329) — 鳥取県東部・郡家/船岡/八東 (3町合併)
// =====================================================================
export const YAZU_PARKS: readonly Park[] = toParks(yazuParksJson);

// 現在は簡易ポイント。GSI 逆ジオコーダで 31329 領域内であることを確認済み。
// 後続で国交省 P-Hospital 等の正規データに置き換える。
export const YAZU_SENSITIVE_FACILITIES: readonly SensitiveFacility[] = [
  {
    id: "yazu-town-hall",
    name: "八頭町役場（郡家本庁舎）",
    category: "庁舎",
    // 八頭町宮谷254: 35°26′35″N 134°17′27″E
    center: { lat: 35.4431, lng: 134.2908 },
  },
  {
    id: "kunge-station",
    name: "JR郡家駅（若桜鉄道分岐）",
    category: "駅",
    // 八頭町郡家64: 35°26′16″N 134°17′28″E
    center: { lat: 35.4378, lng: 134.2911 },
  },
  {
    id: "yazu-funaoka-clinic",
    name: "公立八頭病院",
    category: "病院",
    // 八頭町久能寺725-3: 35°25′10″N 134°16′44″E
    center: { lat: 35.4194, lng: 134.2789 },
  },
];

// =====================================================================
// 安来市 (32206) — 島根県東部・足立美術館/月山富田城跡
// =====================================================================
export const YASUGI_PARKS: readonly Park[] = toParks(yasugiParksJson);

export const YASUGI_SENSITIVE_FACILITIES: readonly SensitiveFacility[] = [
  {
    id: "yasugi-city-hall",
    name: "安来市役所",
    category: "庁舎",
    // 安来市安来町878-2: 35°25′55″N 133°14′59″E
    center: { lat: 35.4319, lng: 133.2497 },
  },
  {
    id: "yasugi-station",
    name: "JR安来駅",
    category: "駅",
    // 安来市安来町2093-2: 35°26′05″N 133°15′29″E
    center: { lat: 35.4347, lng: 133.2581 },
  },
  {
    id: "yasugi-municipal-hospital",
    name: "安来市立病院",
    category: "病院",
    // 安来市安来町96-1: 35°25′44″N 133°14′53″E
    center: { lat: 35.4289, lng: 133.2481 },
  },
  {
    id: "adachi-museum",
    name: "足立美術館（観光客密集地）",
    category: "宿泊地",
    // 安来市古川町320: 35°22′47″N 133°10′57″E
    center: { lat: 35.3797, lng: 133.1825 },
  },
];

// 月山富田城跡: 戦国大名尼子氏の本拠地。1934 昭和9年国指定史跡。
// 文化財保護法第125条適用。
export const YASUGI_HERITAGE_SITES: readonly HeritageSite[] = [
  {
    id: "gassan-toda-castle-ruins",
    name: "月山富田城跡（国指定史跡）",
    designation: "国指定史跡",
    polygon: [
      { lat: 35.3740, lng: 133.1950 },
      { lat: 35.3740, lng: 133.2015 },
      { lat: 35.3695, lng: 133.2015 },
      { lat: 35.3695, lng: 133.1950 },
    ],
  },
];

// =====================================================================
// 雲南市 (32209) — 島根県東部・加茂岩倉遺跡
// =====================================================================
export const UNNAN_PARKS: readonly Park[] = toParks(unnanParksJson);

export const UNNAN_SENSITIVE_FACILITIES: readonly SensitiveFacility[] = [
  {
    id: "unnan-city-hall",
    name: "雲南市役所",
    category: "庁舎",
    // 雲南市木次町里方531-1: 35°17′50″N 132°53′53″E
    center: { lat: 35.2972, lng: 132.8981 },
  },
  {
    id: "kisuki-station",
    name: "JR木次駅",
    category: "駅",
    // 雲南市木次町木次: 35°17′47″N 132°53′54″E
    center: { lat: 35.2964, lng: 132.8983 },
  },
  {
    id: "unnan-shimin-hospital",
    name: "雲南市立病院",
    category: "病院",
    // 雲南市大東町飯田96-1: 35°19′59″N 132°56′13″E
    center: { lat: 35.3331, lng: 132.9369 },
  },
];

// 加茂岩倉遺跡: 1996 平成8年に銅鐸39個一括出土、平成11年国指定史跡。
// 神原神社古墳: 4世紀後半の方墳、出土の三角縁神獣鏡で著名。県指定史跡。
export const UNNAN_HERITAGE_SITES: readonly HeritageSite[] = [
  {
    id: "kamoiwakura-iseki",
    name: "加茂岩倉遺跡（国指定史跡）",
    designation: "国指定史跡",
    polygon: [
      { lat: 35.3625, lng: 132.9020 },
      { lat: 35.3625, lng: 132.9065 },
      { lat: 35.3595, lng: 132.9065 },
      { lat: 35.3595, lng: 132.9020 },
    ],
  },
  {
    id: "kanbara-jinja-kofun",
    name: "神原神社古墳（県指定史跡）",
    designation: "県指定",
    polygon: [
      { lat: 35.3105, lng: 132.9215 },
      { lat: 35.3105, lng: 132.9245 },
      { lat: 35.3088, lng: 132.9245 },
      { lat: 35.3088, lng: 132.9215 },
    ],
  },
];

// =====================================================================
// 大田市 (32205) — 島根県中部・石見銀山遺跡(世界遺産)
// =====================================================================
export const OHDA_PARKS: readonly Park[] = toParks(ohdaParksJson);

export const OHDA_SENSITIVE_FACILITIES: readonly SensitiveFacility[] = [
  {
    id: "ohda-city-hall",
    name: "大田市役所",
    category: "庁舎",
    // 大田市大田町大田ハ111: 35°11′33″N 132°30′10″E
    center: { lat: 35.1925, lng: 132.5028 },
  },
  {
    id: "ohda-shi-station",
    name: "JR大田市駅",
    category: "駅",
    // 大田市大田町: 35°11′40″N 132°30′23″E
    center: { lat: 35.1944, lng: 132.5064 },
  },
  {
    id: "ohda-municipal-hospital",
    name: "大田市立病院",
    category: "病院",
    // 大田市大田町吉永1428: 35°11′23″N 132°30′21″E
    center: { lat: 35.1897, lng: 132.5058 },
  },
  {
    id: "iwami-ginzan-omori",
    name: "石見銀山大森地区（世界遺産観光客密集地）",
    category: "宿泊地",
    center: { lat: 35.1170, lng: 132.4380 },
  },
];

// 石見銀山遺跡: 1969 昭和44年国指定史跡、2007 平成19年世界文化遺産登録。
// 文化財保護法第125条適用。世界遺産条約による国際的保護義務も加わる。
// 物部神社: 石見国一宮、本殿は国重要文化財。
export const OHDA_HERITAGE_SITES: readonly HeritageSite[] = [
  {
    id: "iwami-ginzan-iseki",
    name: "石見銀山遺跡（国指定史跡・世界文化遺産）",
    designation: "国指定史跡",
    polygon: [
      { lat: 35.1230, lng: 132.4280 },
      { lat: 35.1230, lng: 132.4470 },
      { lat: 35.1090, lng: 132.4470 },
      { lat: 35.1090, lng: 132.4280 },
    ],
  },
];

// =====================================================================
// 全自治体合算（地図レイヤ・県条例の公衆密集地評価で使用）。
// 自治体追加時はここに append するだけで、UI 側は変更不要。
// =====================================================================
export const ALL_MUNICIPAL_PARKS: readonly Park[] = [
  ...TOTTORI_PARKS,
  ...YONAGO_PARKS,
  ...KURAYOSHI_PARKS,
  ...SAKAIMINATO_PARKS,
  ...YAZU_PARKS,
  ...MISASA_PARKS,
  ...YURIHAMA_PARKS,
  ...MATSUE_PARKS,
  ...IZUMO_PARKS,
  ...OHDA_PARKS,
  ...YASUGI_PARKS,
  ...UNNAN_PARKS,
];

export const ALL_SENSITIVE_FACILITIES: readonly SensitiveFacility[] = [
  ...TOTTORI_SENSITIVE_FACILITIES,
  ...YONAGO_SENSITIVE_FACILITIES,
  ...KURAYOSHI_SENSITIVE_FACILITIES,
  ...SAKAIMINATO_SENSITIVE_FACILITIES,
  ...YAZU_SENSITIVE_FACILITIES,
  ...MISASA_SENSITIVE_FACILITIES,
  ...YURIHAMA_SENSITIVE_FACILITIES,
  ...MATSUE_SENSITIVE_FACILITIES,
  ...IZUMO_SENSITIVE_FACILITIES,
  ...OHDA_SENSITIVE_FACILITIES,
  ...YASUGI_SENSITIVE_FACILITIES,
  ...UNNAN_SENSITIVE_FACILITIES,
];

export const ALL_HERITAGE_SITES: readonly HeritageSite[] = [
  ...TOTTORI_HERITAGE_SITES,
  ...YONAGO_HERITAGE_SITES,
  ...KURAYOSHI_HERITAGE_SITES,
  ...MISASA_HERITAGE_SITES,
  ...YURIHAMA_HERITAGE_SITES,
  ...MATSUE_HERITAGE_SITES,
  ...IZUMO_HERITAGE_SITES,
  ...OHDA_HERITAGE_SITES,
  ...YASUGI_HERITAGE_SITES,
  ...UNNAN_HERITAGE_SITES,
];

export const SENSITIVE_FACILITY_BUFFER_M = 100;
