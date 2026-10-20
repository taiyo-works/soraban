// 100g 未満の機体（模型航空機）の扱い（Sprint 11e、docs/spec.md §13.9.9）。
//
// 条文・出す先・期限の文言・参照先・確認日は、このファイル 1 か所に置く。画面・地点判定の PDF・申請支援の PDF・
// 判定の理由（verdict.ts）は、すべてここを参照する。条番号・URL を他のファイルに書かない。
//
// ※要確認：一次資料未取得（2026-10-20 時点で作業環境から e-Gov・国交省の本文を取得できず、条文と照合していない）。
//   航空法施行規則の e-Gov の URL（法令 ID 327M50000800056。昭和27年運輸省令第56号）も、航空法施行規則を指すことを確かめていない。
//   確かめたら確認日（MODEL_AIRCRAFT_RULES_CHECKED_AT）を更新し、本注記を外す。
//   特に、許可と通報の対象空域の分け方（空港等の周辺・管制圏・情報圏、航空路内 150m／航空路外 250m）、
//   出す先（窓口）、期限は、条文と国交省の資料で確かめること。確かめるまでは安全側（要手続き）に倒す。
//   条番号は現行の航空法第134条の3・航空法施行規則第239条の2・第239条の3 を使う（旧い番号は使わない）。
//
// Sprint 11g（2026-10-21）：ユーザー提供の整理（管制圏・情報圏・高度変更禁止空域・特別管制空域の内側は許可、外側は事前の通報）を、
//   国土交通省の公開ページ（検索結果）と照合した。許可と通報の分け方（航空法第134条の3 第1項・第2項、
//   施行規則第239条の2・第239条の3）は、条文の原文とは照合していない。確認日は条文との照合日の意味で使うため変えない。

/** この定数を一次資料で確かめた日（※要確認：上の注記のとおり、本文との照合は未了）。 */
export const MODEL_AIRCRAFT_RULES_CHECKED_AT = "2026-10-20";

/** 条文の表記。 */
export const MODEL_AIRCRAFT_LAW = "航空法第134条の3";
export const MODEL_AIRCRAFT_ORDINANCE = "航空法施行規則第239条の2";
export const MODEL_AIRCRAFT_ORDINANCE_NOTICE = "航空法施行規則第239条の3";

/** 許可と通報の区分（A2・A3・A4・A6 の組み立てに使う）。 */
export const MODEL_AIRCRAFT_PERMIT_OR_NOTICE_RULE = `管制圏・情報圏・高度変更禁止空域・特別管制空域の内側は国土交通大臣の許可（${MODEL_AIRCRAFT_LAW} 第1項、${MODEL_AIRCRAFT_ORDINANCE}）、その外側は事前の通報（同条第2項、${MODEL_AIRCRAFT_ORDINANCE_NOTICE}）が要ります。`;
/** 重さの欄・申請支援の注記に使う短い区分。 */
export const MODEL_AIRCRAFT_PERMIT_OR_NOTICE_SHORT = "許可または通報（管制圏等の内側は許可、外側は通報）";

export type ModelAircraftReference = {
  readonly id: string;
  readonly title: string;
  readonly url: string;
};

/** 参照先（題名と URL）。画面はリンク、PDF は題名と URL の文字列で出す。 */
export const MODEL_AIRCRAFT_REFERENCES: readonly ModelAircraftReference[] = [
  {
    id: "egov-aviation-act",
    title: `e-Gov 法令検索 航空法（${MODEL_AIRCRAFT_LAW}）`,
    url: "https://laws.e-gov.go.jp/law/327AC0000000231",
  },
  {
    id: "egov-aviation-regulation",
    title: `e-Gov 法令検索 航空法施行規則（${MODEL_AIRCRAFT_ORDINANCE}）`,
    url: "https://laws.e-gov.go.jp/law/327M50000800056",
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
  // 以下 3 件の題名は検索結果と記述内容からの暫定（※要確認：ページの正式な題名は未確認）。
  {
    id: "mlit-uas-rules",
    title: "国土交通省「無人航空機の飛行ルール」（100g 未満の機体・空港等の周辺の記述）",
    url: "https://www.mlit.go.jp/koku/koku_fr10_000040.html",
  },
  {
    id: "mlit-emergency-airspace-qa",
    title: "国土交通省「緊急用務空域の Q&A」",
    url: "https://www.mlit.go.jp/koku/content/001407133.pdf",
  },
  {
    id: "mlit-uas-permit-procedure",
    title: "国土交通省「無人航空機の飛行許可・承認手続」",
    url: "https://www.mlit.go.jp/koku/koku_fr10_000042.html",
  },
];

/** 判定の理由・PDF に添える参照先の一行（題名と URL）。 */
export const MODEL_AIRCRAFT_REFERENCE_LINE = `参照先：${MODEL_AIRCRAFT_REFERENCES.map((r) => `${r.title} ${r.url}`).join(" ／ ")}`;

/**
 * 100g 未満で、機体重量の例外により対象外にした規制（DID・空港等周辺など）と飛行の方法の「元の判定」の表示（Sprint 11f）。
 * 表示の言葉だけで、status・baseStatus・証跡の値は変えない。
 */
export const MODEL_AIRCRAFT_EXEMPT_LABEL = "対象外（模型航空機）";

/** DID 内の地点で 100g 未満のとき、カード・PDF の DID の行と本文に出す言葉（Sprint 11f。表示だけで didDetail の値は変えない）。 */
export const MODEL_AIRCRAFT_DID_DETAIL_LABEL = "DID：該当（模型航空機のため対象外）";
export const MODEL_AIRCRAFT_DID_NOTE = "100g 未満の機体（模型航空機）は、航空法の無人航空機の規制（DID 上空の飛行許可）の対象外です。";
/** 評価器の note にある「許可・承認なく飛行できません」の一文（対象外のとき上の言葉に置き換える）。 */
export const DID_NOTE_PERMIT_SENTENCE = "原則として許可・承認なく飛行できません。";

/** 100g 未満で航空法の無人航空機の規制が対象外になる理由。 */
export const MODEL_AIRCRAFT_EXEMPT_REASON =
  "対象外（模型航空機）：100g 未満の機体は航空法の無人航空機に当たりません（DID・空港等周辺・150m 以上の許可、飛行の方法の承認、機体登録、飛行計画の通報、飛行日誌の対象外）。";

/** 第134条の3 の手続きの出す先と期限。期限は一次資料で確かめるまで日付を作らない。 */
export const MODEL_AIRCRAFT_SUBMIT_TO = "国土交通大臣（窓口の空港事務所等は参照先で確認）";
export const MODEL_AIRCRAFT_DEADLINE_LABEL = "事前に（参照先で確認）";

/** 空港等の周辺（敷地の外）の許可または通報。 */
export const MODEL_AIRCRAFT_AIRPORT_PROCEDURE_TITLE = `${MODEL_AIRCRAFT_LAW} に基づく飛行の許可または通報（模型航空機・空港等の周辺）`;
export const MODEL_AIRCRAFT_AIRPORT_ITEM_TITLE = `模型航空機の空港等の周辺での飛行（${MODEL_AIRCRAFT_LAW}。許可または通報）`;
export const MODEL_AIRCRAFT_AIRPORT_REASON = `100g 未満の機体（模型航空機）でも、空港等の周辺は ${MODEL_AIRCRAFT_LAW} の対象です。${MODEL_AIRCRAFT_PERMIT_OR_NOTICE_RULE}このアプリは管制圏・情報圏・高度変更禁止空域・特別管制空域を収録していないため、許可か通報かを決められず、どちらも要手続きとして出します。6km の概算の外でも手続きが要る場合があります（参照先で確認）。DIPS の許可（無人航空機の許可）では満たしません。`;

/** 150m 以上の許可または通報。 */
export const MODEL_AIRCRAFT_HIGH_PROCEDURE_TITLE = `${MODEL_AIRCRAFT_LAW} に基づく飛行の許可または通報（模型航空機・高い空域）`;
export const MODEL_AIRCRAFT_HIGH_REASON = `100g 未満の機体（模型航空機）でも、${MODEL_AIRCRAFT_LAW} により、あらかじめ国土交通大臣への手続きが要ります。対象は、航空路内は地表・水面から 150m 以上、航空路外は 250m 以上です。このアプリは航空路の地理データを持たないため、150m 以上を一律に要手続きとしています。250m 未満で航空路の外なら要らない可能性があります（参照先で確認）。${MODEL_AIRCRAFT_PERMIT_OR_NOTICE_RULE}管制圏等は収録していないため、許可か通報かは決められません。DIPS の許可（無人航空機の許可）では満たしません。`;

/** 100g 未満のとき、飛行の前後に確かめること（段階には影響させない）。 */
export const MODEL_AIRCRAFT_CONTROL_ZONE_DUTY_TITLE = "許可か通報かの確認（管制圏・情報圏・高度変更禁止空域・特別管制空域の内か外か）";
export const MODEL_AIRCRAFT_CONTROL_ZONE_DUTY_DETAIL = `このアプリは管制圏・情報圏・高度変更禁止空域・特別管制空域・航空路を収録していません。飛行の前に、飛行場所が内側（許可）か外側（通報）かを、空港事務所・管制機関・空港管理者に確かめてください。内側なら許可を得てから、外側なら事前に通報してから飛行します（${MODEL_AIRCRAFT_LAW}）。`;

/** 重さの欄の補足（100g 未満の入力時）。 */
export const MODEL_AIRCRAFT_WEIGHT_NOTE = `100g 未満（模型航空機）：航空法の無人航空機の規制（DID・特定飛行・機体登録など）は対象外。空港等の周辺と高い空域では${MODEL_AIRCRAFT_LAW}の${MODEL_AIRCRAFT_PERMIT_OR_NOTICE_SHORT}が要ります。小型無人機等飛行禁止法・条例は重量に関係なく対象です。`;
/** 重さの欄の中立の札（緩和を示す言葉を使わない）。 */
export const MODEL_AIRCRAFT_WEIGHT_TAG = "模型航空機として判定";

/** 申請支援のカテゴリーの表示（100g 未満。category の値 I は証跡に入るため変えず、表示だけを変える）。 */
export const MODEL_AIRCRAFT_CATEGORY_HEADLINE = "対象外（模型航空機。航空法の無人航空機の区分に当たらない）";
export const MODEL_AIRCRAFT_CATEGORY_NOTE = `100g 未満の機体は航空法の無人航空機に当たらず、特定飛行の許可・承認、機体登録の対象外です。空港等の周辺と高い空域では ${MODEL_AIRCRAFT_LAW} の${MODEL_AIRCRAFT_PERMIT_OR_NOTICE_SHORT}が要ります（判定の段取りを参照）。小型無人機等飛行禁止法・条例は重量に関係なく対象です。`;

/**
 * 飛行マニュアル骨子（独自マニュアル）の追記観点を、100g 未満の機体（模型航空機）向けに置き換える内容（Sprint 11e）。
 * 無人航空機の特定飛行の根拠（航空法第132条の85・第132条の86）は当たらないため出さない。
 *   - airspace_150m：第134条の3 の許可または通報の観点
 *   - airspace_airport：第134条の3 の許可または通報の観点
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
/** 一次資料と照合していないことの注記（画面・PDF の参照先の一覧に添える）。 */
export const MODEL_AIRCRAFT_UNVERIFIED = "※要確認：一次資料未取得";

export const modelAircraftManualOverride = (flag: string): ModelAircraftManualOverride | null => {
  if (flag === "airspace_emergency") return null;
  if (flag === "airspace_150m") {
    return {
      outline: "100g 未満の機体（模型航空機）で高い空域を飛ばす場合の観点。",
      points: [
        "管制圏・情報圏・高度変更禁止空域・特別管制空域の内側なら許可を、外側なら事前の通報を、あらかじめ国土交通大臣へ行う手順を定める（許可の条件を守る体制と、通報の内容（日時・場所・高さ）を記録する方法を含む）。",
        "内側（許可）か外側（通報）かは、空港事務所・管制機関・空港管理者に確かめる。",
        "対象は、航空路内は地表・水面から 150m 以上、航空路外は 250m 以上（参照先で確認）。",
      ],
      legalBasis: `${MODEL_AIRCRAFT_LAW}・${MODEL_AIRCRAFT_ORDINANCE}・${MODEL_AIRCRAFT_ORDINANCE_NOTICE}（模型航空機の許可または通報）。${MODEL_AIRCRAFT_UNVERIFIED}`,
      sourceUrl: MODEL_AIRCRAFT_PRIMARY_URL,
    };
  }
  if (flag === "airspace_airport") {
    return {
      outline: "100g 未満の機体（模型航空機）で空港等の周辺を飛ばす場合の観点。",
      points: [
        "管制圏・情報圏・高度変更禁止空域・特別管制空域の内側なら許可を、外側なら事前の通報を、あらかじめ国土交通大臣へ行う手順を定める（窓口は参照先で確認）。",
        "内側（許可）か外側（通報）かは、空港事務所・管制機関・空港管理者に確かめる。",
      ],
      legalBasis: `${MODEL_AIRCRAFT_LAW}・${MODEL_AIRCRAFT_ORDINANCE}・${MODEL_AIRCRAFT_ORDINANCE_NOTICE}（模型航空機の許可または通報）。${MODEL_AIRCRAFT_UNVERIFIED}`,
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
