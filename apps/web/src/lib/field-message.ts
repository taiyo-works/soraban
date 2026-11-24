// 入力の誤りの文の整え（Sprint 16-H2）。
/**
 * サーバーの項目の誤りの文は「緯度：緯度は −90〜90…」のように項目名で始まり、文の中でも項目名を繰り返すことがある。
 * 画面では項目名を段の名前と欄の見出しで示すので、重なる先頭の「項目名：」を 1 つにする（文の中身は変えない）。
 */
export const tidyFieldMessage = (m: string): string => m.replace(/^([^：\s]{1,16})：(?=\1)/, "");
export const tidyFieldErrors = (e: Readonly<Record<string, string>>): Record<string, string> =>
  Object.fromEntries(Object.entries(e).map(([k, m]) => [k, typeof m === "string" ? tidyFieldMessage(m) : m]));
