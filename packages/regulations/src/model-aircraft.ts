// 100g 未満の機体（模型航空機）の扱い（Sprint 11e、docs/spec.md §13.9.9）。
//
// 条文・出す先・期限の文言・参照先・確認日は、このファイル 1 か所に置く。画面・地点判定の PDF・申請支援の PDF・
// 判定の理由（verdict.ts）は、すべてここを参照する。条番号・URL を他のファイルに書かない。
//
// ※要確認：一次資料未取得（2026-10-20 時点で作業環境から e-Gov・国交省の本文を取得できず、条文と照合していない）。
//   確かめたら確認日（MODEL_AIRCRAFT_RULES_CHECKED_AT）を更新し、本注記を外す。
//   特に、許可と通報の対象空域の分け方（空港等の周辺・管制圏・情報圏、航空路内 150m／航空路外 250m）、
//   出す先（窓口）、期限は、条文と国交省の資料で確かめること。確かめるまでは安全側（要手続き）に倒す。
//   条番号は現行の航空法第134条の3・航空法施行規則第239条の2 を使う（旧い番号は使わない）。

/** この定数を一次資料で確かめた日（※要確認：上の注記のとおり、本文との照合は未了）。 */
export const MODEL_AIRCRAFT_RULES_CHECKED_AT = "2026-10-20";

/** 条文の表記。 */
export const MODEL_AIRCRAFT_LAW = "航空法第134条の3";
export const MODEL_AIRCRAFT_ORDINANCE = "航空法施行規則第239条の2";

export type ModelAircraftReference = {
  readonly id: string;
  readonly title: string;
  readonly url: string;
};

/** 参照先（題名と URL）。画面はリンク、PDF は題名と URL の文字列で出す。 */
export const MODEL_AIRCRAFT_REFERENCES: readonly ModelAircraftReference[] = [
  {
    id: "egov-aviation-act",
    title: `e-Gov 法令検索 航空法（${MODEL_AIRCRAFT_LAW}。${MODEL_AIRCRAFT_ORDINANCE} は航空法施行規則）`,
    url: "https://laws.e-gov.go.jp/law/327AC0000000231",
  },
  {
    id: "mlit-laser-kite",
    title: "国土交通省「レーザー照射や凧揚げの規制について」",
    url: "https://www.mlit.go.jp/koku/koku_tk1_000048.html",
  },
  {
    id: "mlit-affecting-acts",
    title: "国土交通省「航空機の飛行に影響を及ぼすおそれのある行為（気球、花火、凧揚げ等）」",
    url: "https://www.mlit.go.jp/common/001708524.pdf",
  },
  {
    id: "mlit-kyosoku-5",
    title: "国土交通省「無人航空機の飛行の安全に関する教則」第5版",
    url: "https://www.mlit.go.jp/common/002010809.pdf",
  },
  {
    id: "npa-small-drone-law",
    title: "警察庁「小型無人機等飛行禁止法関係」",
    url: "https://www.npa.go.jp/bureau/security/kogatamujinki/index.html",
  },
];

/** 判定の理由・PDF に添える参照先の一行（題名と URL）。 */
export const MODEL_AIRCRAFT_REFERENCE_LINE = `参照先：${MODEL_AIRCRAFT_REFERENCES.map((r) => `${r.title} ${r.url}`).join(" ／ ")}`;

/** 100g 未満で航空法の無人航空機の規制が対象外になる理由。 */
export const MODEL_AIRCRAFT_EXEMPT_REASON =
  "対象外（模型航空機）：100g 未満の機体は航空法の無人航空機に当たりません（DID・空港等周辺・150m 以上の許可、飛行の方法の承認、機体登録、飛行計画の通報、飛行日誌の対象外）。";

/** 第134条の3 の手続きの出す先と期限。期限は一次資料で確かめるまで日付を作らない。 */
export const MODEL_AIRCRAFT_SUBMIT_TO = "国土交通大臣（窓口の空港事務所等は参照先で確認）";
export const MODEL_AIRCRAFT_DEADLINE_LABEL = "事前に（参照先で確認）";

/** 空港等の周辺（敷地の外）の許可。 */
export const MODEL_AIRCRAFT_AIRPORT_PROCEDURE_TITLE = `${MODEL_AIRCRAFT_LAW} に基づく飛行の許可（模型航空機・空港等の周辺）`;
export const MODEL_AIRCRAFT_AIRPORT_ITEM_TITLE = `模型航空機の空港等の周辺での飛行（${MODEL_AIRCRAFT_LAW}）`;
export const MODEL_AIRCRAFT_AIRPORT_REASON = `100g 未満の機体（模型航空機）でも、空港等の周辺では ${MODEL_AIRCRAFT_LAW}（${MODEL_AIRCRAFT_ORDINANCE}）により国土交通大臣の許可が要ります。DIPS の許可（無人航空機の許可）では満たしません。このアプリは管制圏・情報圏を収録していないため、6km の概算の外でも許可が要る場合があります（参照先で確認）。`;

/** 150m 以上の通報。 */
export const MODEL_AIRCRAFT_HIGH_PROCEDURE_TITLE = `${MODEL_AIRCRAFT_LAW} に基づく飛行の通報（模型航空機・高い空域）`;
export const MODEL_AIRCRAFT_HIGH_REASON = `100g 未満の機体（模型航空機）でも、${MODEL_AIRCRAFT_LAW}（${MODEL_AIRCRAFT_ORDINANCE}）により、あらかじめ国土交通大臣への通報が要ります。通報の対象は、航空路内は地表・水面から 150m 以上、航空路外は 250m 以上です。このアプリは航空路の地理データを持たないため、150m 以上を一律に要手続きとしています。250m 未満で航空路の外なら通報が要らない可能性があります（参照先で確認）。DIPS の許可（無人航空機の許可）では満たしません。`;

/** 100g 未満のとき、飛行の前後に確かめること（段階には影響させない）。 */
export const MODEL_AIRCRAFT_CONTROL_ZONE_DUTY_TITLE = "空港の管制圏等（収録していない空域）の確認";
export const MODEL_AIRCRAFT_CONTROL_ZONE_DUTY_DETAIL = `このアプリは管制圏・情報圏・航空路を収録していません。飛行の前に、${MODEL_AIRCRAFT_LAW} の許可・通報が要る空域に当たらないかを参照先で確かめてください。`;

/** 重さの欄の補足（100g 未満の入力時）。 */
export const MODEL_AIRCRAFT_WEIGHT_NOTE = `100g 未満（模型航空機）：航空法の無人航空機の規制（DID・特定飛行・機体登録など）は対象外。空港等の周辺と高い空域では${MODEL_AIRCRAFT_LAW}の許可・通報が要ります。小型無人機等飛行禁止法・条例は重量に関係なく対象です。`;
/** 重さの欄の中立の札（緩和を示す言葉を使わない）。 */
export const MODEL_AIRCRAFT_WEIGHT_TAG = "模型航空機として判定";

/** 申請支援のカテゴリーの表示（100g 未満。category の値 I は証跡に入るため変えず、表示だけを変える）。 */
export const MODEL_AIRCRAFT_CATEGORY_HEADLINE = "対象外（模型航空機。航空法の無人航空機の区分に当たらない）";
export const MODEL_AIRCRAFT_CATEGORY_NOTE = `100g 未満の機体は航空法の無人航空機に当たらず、特定飛行の許可・承認、機体登録の対象外です。空港等の周辺と高い空域では ${MODEL_AIRCRAFT_LAW} の許可・通報が要ります（判定の段取りを参照）。小型無人機等飛行禁止法・条例は重量に関係なく対象です。`;

/**
 * 飛行マニュアル骨子（独自マニュアル）の追記観点を、100g 未満の機体（模型航空機）向けに置き換える内容（Sprint 11e）。
 * 無人航空機の特定飛行の根拠（航空法第132条の85・第132条の86）は当たらないため出さない。
 *   - airspace_150m：第134条の3 の通報の観点
 *   - airspace_airport：第134条の3 の許可の観点
 *   - airspace_emergency：重量に関係なく従来どおり（null を返し、置き換えない）
 *   - それ以外（DID・飛行の方法）：対象外（模型航空機）
 */
export type ModelAircraftManualOverride = {
  readonly outline: string;
  readonly points: readonly string[];
  readonly legalBasis: string;
  readonly sourceUrl: string;
};

const MODEL_AIRCRAFT_PRIMARY_URL = MODEL_AIRCRAFT_REFERENCES[0]!.url;
const MODEL_AIRCRAFT_UNVERIFIED = "※要確認：一次資料未取得";

export const modelAircraftManualOverride = (flag: string): ModelAircraftManualOverride | null => {
  if (flag === "airspace_emergency") return null;
  if (flag === "airspace_150m") {
    return {
      outline: "100g 未満の機体（模型航空機）で高い空域を飛ばす場合の観点。",
      points: [
        "あらかじめ国土交通大臣へ通報する手順と、通報の内容（日時・場所・高さ）を記録する方法を定める。",
        "通報の対象は、航空路内は地表・水面から 150m 以上、航空路外は 250m 以上（参照先で確認）。",
      ],
      legalBasis: `${MODEL_AIRCRAFT_LAW}・${MODEL_AIRCRAFT_ORDINANCE}（模型航空機の通報）。${MODEL_AIRCRAFT_UNVERIFIED}`,
      sourceUrl: MODEL_AIRCRAFT_PRIMARY_URL,
    };
  }
  if (flag === "airspace_airport") {
    return {
      outline: "100g 未満の機体（模型航空機）で空港等の周辺を飛ばす場合の観点。",
      points: [
        "国土交通大臣の許可を事前に得る手順と、許可の条件を守る体制を定める（窓口は参照先で確認）。",
        "管制圏・情報圏に当たらないかの確認方法を定める。",
      ],
      legalBasis: `${MODEL_AIRCRAFT_LAW}・${MODEL_AIRCRAFT_ORDINANCE}（模型航空機の許可）。${MODEL_AIRCRAFT_UNVERIFIED}`,
      sourceUrl: MODEL_AIRCRAFT_PRIMARY_URL,
    };
  }
  return {
    outline: MODEL_AIRCRAFT_EXEMPT_REASON,
    points: [],
    legalBasis: `対象外（模型航空機）。${MODEL_AIRCRAFT_UNVERIFIED}`,
    sourceUrl: MODEL_AIRCRAFT_PRIMARY_URL,
  };
};
