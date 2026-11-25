// 入力の誤りの文の整え（Sprint 16-H2）。
/**
 * サーバーの項目の誤りの文は「緯度：緯度は −90〜90…」のように項目名で始まり、文の中でも項目名を繰り返すことがある。
 * 画面では項目名を段の名前と欄の見出しで示すので、重なる先頭の「項目名：」を 1 つにする（文の中身は変えない）。
 */
export const tidyFieldMessage = (m: string): string => m.replace(/^([^：\s]{1,16})：(?=\1)/, "");
export const tidyFieldErrors = (e: Readonly<Record<string, string>>): Record<string, string> =>
  Object.fromEntries(Object.entries(e).map(([k, m]) => [k, typeof m === "string" ? tidyFieldMessage(m) : m]));

/**
 * 判定エンジンの文を画面に出すときの整え（Sprint 16-L の L-3）。エンジンの文（「…DIPS で必ず確認してください」）は変えない（K-11）。
 * 画面では「必ず」を外して出す（不変条件 3：確認していないことを断定する語を使わない）。文の中身（確認する先・対象）は変えない。
 * 出ている面（棚卸し）：運航管理の判定の画面のシート（judgement-sheet-reason）。判定の一覧・段取り表（verdict-summary）の理由。
 */
export const tidyEngineText = (m: string): string => m.replace(/必ず/g, "");
