// 日付の読みやすい表示（ホームなど）。保存・API・サーバーが作る文言は YYYY-MM-DD のまま変えず、画面に出すときだけ「1/5（火）」にする。
// 年は、今日と違う年のときだけ付ける（「2028/1/5（水）」）。純粋関数（タイムゾーンに依らない：日付の文字列だけから曜日を出す）。

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"] as const;
const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

/** 存在する日付なら { y, m, d, w }（w は曜日 0=日）。存在しない・形式違いは null。 */
const parts = (iso: string): { y: number; m: number; d: number; w: number } | null => {
  const m = ISO.exec(iso);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null;
  return { y, m: mo, d, w: t.getUTCDay() };
};

/** 「1/5（火）」。today と年が違うときだけ「2028/1/5（水）」。読めない形式はそのまま返す。 */
export const formatDay = (iso: string, today: string): string => {
  const p = parts(iso);
  if (!p) return iso;
  const t = parts(today);
  const year = t && t.y === p.y ? "" : `${p.y}/`;
  return `${year}${p.m}/${p.d}（${WEEKDAYS[p.w]}）`;
};

/** 文の中の YYYY-MM-DD を、すべて formatDay にする（文字列の分割。日付以外は触れない）。 */
export const formatDaysIn = (text: string, today: string): string => text.replace(/\d{4}-\d{2}-\d{2}/g, (s) => formatDay(s, today));
