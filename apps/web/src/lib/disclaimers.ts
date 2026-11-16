// 免責の文（暫定版。専門家の確認の前。Sprint 18）。
// 18-1 で DISCLAIMER_JUDGEMENT、18-3 で DISCLAIMER_INSPECTION・DISCLAIMER_RECORD を足した。

/** 判定（補助）の免責。公開の `/` の詳細な指定の常設の注記と、結果の免責に出す。 */
export const DISCLAIMER_JUDGEMENT =
  "判定は入力された情報の範囲での参考情報です。データの更新の遅れ・欠落がありえます。制度の最新性・正確性は保証しません。飛行の前に、国土交通省（DIPS 2.0）・警察・各自治体の最新の情報を確認してください。";

/** 点検の免責（Sprint 18-3 §5.3）。点検の入力の先頭（/ops/inspections/new と現場の点検の段）。 */
export const DISCLAIMER_INSPECTION = "点検は利用者の確認の記録です。項目の説明は参考で、機体の取扱説明書に従ってください。";

/** 記録の免責（Sprint 18-3 §5.3）。既存の REPORT_SELF_REPORT_NOTE などはそのままで、重複させない（このアプリについてで示す）。 */
export const DISCLAIMER_RECORD = "記録は利用者の申告です。";
