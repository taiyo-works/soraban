// 飛行記録（様式1）・日常点検記録（様式2）の項目の定義（Sprint 11）。サーバー（入力検査）と画面の両方が使う。
// 出典：「無人航空機の飛行日誌の取扱要領」（令和4年12月1日制定）様式1・様式2、6(1)d・6(2)a・7(1)d。

/** 日常点検の 9 項目（様式2 の順・名前）。項目ごとの具体的な点検内容は機体の取扱説明書による（画面に出さない）。 */
export const INSPECTION_ITEMS = [
  { key: "general", label: "機体全般" },
  { key: "propeller", label: "プロペラ" },
  { key: "frame", label: "フレーム" },
  { key: "communication", label: "通信系統" },
  { key: "propulsion", label: "推進系統" },
  { key: "power", label: "電源系統" },
  { key: "autopilot", label: "自動制御系統" },
  { key: "controller", label: "操縦装置" },
  { key: "battery", label: "バッテリー・燃料" },
] as const;

export type InspectionItemKey = (typeof INSPECTION_ITEMS)[number]["key"];

/**
 * 点検の入力で 9 項目を系統の群に分けて見せるための並び（Sprint 16-I）。項目の名前・意味・保存の形（キー）は変えない。
 * 9 項目はどれもちょうど 1 つの群に入る（ops-records.test.ts が確かめる）。項目の番号は様式2 の番号（INSPECTION_ITEMS の順）のまま。
 */
export const INSPECTION_GROUPS: readonly { readonly key: string; readonly label: string; readonly items: readonly InspectionItemKey[] }[] = [
  { key: "body", label: "機体", items: ["general", "propeller", "frame"] },
  { key: "link", label: "通信・制御", items: ["communication", "autopilot", "controller"] },
  { key: "power", label: "動力・電源", items: ["propulsion", "power", "battery"] },
];
export type InspectionResult = "normal" | "abnormal";
export const INSPECTION_RESULT_LABELS: Readonly<Record<InspectionResult, string>> = { normal: "正常", abnormal: "異常" };

export const INSPECTION_TIMINGS = ["pre_flight", "post_flight"] as const;
export type InspectionTiming = (typeof INSPECTION_TIMINGS)[number];
export const INSPECTION_TIMING_LABELS: Readonly<Record<InspectionTiming, string>> = {
  pre_flight: "飛行前",
  post_flight: "飛行後",
};

/** 特定飛行の形態（飛行禁止空域の飛行と、飛行の方法）。複数選択、0 件可。 */
export const SPECIFIC_FLIGHT_TYPES = [
  { key: "airport_vicinity", label: "空港等周辺", group: "airspace" },
  { key: "emergency_airspace", label: "緊急用務空域", group: "airspace" },
  { key: "above_150m", label: "地表・水面から 150m 以上", group: "airspace" },
  { key: "did", label: "人口集中地区（DID）上空", group: "airspace" },
  { key: "night", label: "夜間飛行", group: "method" },
  { key: "bvlos", label: "目視外飛行", group: "method" },
  { key: "within_30m", label: "人・物件から 30m 未満", group: "method" },
  { key: "event", label: "催し場所上空", group: "method" },
  { key: "dangerous_goods", label: "危険物輸送", group: "method" },
  { key: "dropping", label: "物件投下", group: "method" },
] as const;

export type SpecificFlightType = (typeof SPECIFIC_FLIGHT_TYPES)[number]["key"];
export const SPECIFIC_FLIGHT_TYPE_LABELS: Readonly<Record<string, string>> = Object.fromEntries(
  SPECIFIC_FLIGHT_TYPES.map((t) => [t.key, t.label]),
);

export const MAX_PURPOSE = 100;
export const MAX_PLACE = 100;
export const MAX_WAYPOINTS = 200;
export const MAX_LONG_TEXT = 500;
export const MAX_DEFECTS = 20;
