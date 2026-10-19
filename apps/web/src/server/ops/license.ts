// 技能証明の有効期限の注意（Sprint 11a E）。
//
// 一次資料（国土交通省「無人航空機操縦者技能証明」、確認日 2026-10-19）：
//   有効期間は 3 年。有効期間満了の 6 か月前から更新を申請でき、満了の 1 か月前までに
//   更新講習・身体適性検査まで完了する必要がある。
// 新しい個人情報の項目は足さない（Sprint 10 E）。既存の任意項目 license_expires_on だけを使う純粋関数。

export const LICENSE_RENEWAL_SOURCE_URL = "https://www.mlit.go.jp/koku/level4/license/";

export type LicenseRenewalStatus = "none" | "renewal_window" | "past_deadline" | "expired";

export const LICENSE_RENEWAL_LABEL: Readonly<Record<Exclude<LicenseRenewalStatus, "none">, string>> = {
  renewal_window: "更新の申請期間です（満了の 1 か月前まで）",
  past_deadline: "更新の申請期間（満了の 1 か月前まで）を過ぎています",
  expired: "有効期限が切れています",
};

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const pad = (n: number): string => String(n).padStart(2, "0");

/**
 * YYYY-MM-DD から暦の月で months か月前の日を返す。その月に同じ日が無ければ月末にする
 * （例：2027-03-31 の 6 か月前 → 2026-09-30、1 か月前 → 2027-02-28）。
 */
export const subtractCalendarMonths = (date: string, months: number): string | null => {
  const m = DATE_RE.exec(date);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const total = y * 12 + (mo - 1) - months;
  const ny = Math.floor(total / 12);
  const nmo = total - ny * 12; // 0..11
  const lastDay = new Date(Date.UTC(ny, nmo + 1, 0)).getUTCDate();
  return `${ny}-${pad(nmo + 1)}-${pad(Math.min(d, lastDay))}`;
};

/** 日本時間（JST）の今日の日付（YYYY-MM-DD）。 */
export const todayJst = (now: Date = new Date()): string => {
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return `${jst.getUTCFullYear()}-${pad(jst.getUTCMonth() + 1)}-${pad(jst.getUTCDate())}`;
};

/**
 * 技能証明の有効期限（満了日）と今日（JST の日付）から、更新の注意の状態を返す。
 *   none           … 期限が未入力、または満了日の 6 か月前の日より前
 *   renewal_window … 満了日の 6 か月前の日から、満了日の 1 か月前の日まで
 *   past_deadline  … 満了日の 1 か月前の日の翌日から満了日まで
 *   expired        … 満了日の翌日以降
 */
export const licenseRenewalStatus = (
  expiresOn: string | null,
  today: string,
): LicenseRenewalStatus => {
  if (!expiresOn || !DATE_RE.test(expiresOn) || !DATE_RE.test(today)) return "none";
  const windowStart = subtractCalendarMonths(expiresOn, 6);
  const deadline = subtractCalendarMonths(expiresOn, 1);
  if (!windowStart || !deadline) return "none";
  if (today > expiresOn) return "expired";
  if (today > deadline) return "past_deadline";
  if (today >= windowStart) return "renewal_window";
  return "none";
};
