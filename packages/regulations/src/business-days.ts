// 開庁日（営業日）計算 — 提出期限の逆算に使う純関数群。
//
// docs/spec.md §3.4・§7「提出期限の逆算：飛行予定日 − 10 開庁日（土日祝を除く）」を実装する。
//
// 設計の核:
//   - 祝日はコードに直書きせず、出典付きデータ（data/holidays/jp-holidays.json・内閣府公開 CSV 由来）
//     を型検証して読み込む。改正・新設時は JSON を差し替える。
//   - 日付は「ローカル日付（YYYY-MM-DD, JST 想定）」を文字列として扱い、UTC 変換による
//     日付ズレを避ける。内部では「1970-01-01 からの日数（dayNumber）」で四則演算する。
//   - すべて副作用のない純関数。ユニットテスト可能。

import holidaysData from "../data/holidays/jp-holidays.json";

// ── 祝日データの読み込み（型検証つき）──

type RawHoliday = { readonly date?: unknown; readonly name?: unknown };

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

// data/holidays/jp-holidays.json の各レコードを ISO 日付文字列に正規化する。
// 形式不正なレコードは安全側で捨てる（祝日の欠落＝期限が 1 日厳しくなる方向で、
// 不正データで期限を緩める事故は起きない）。
const HOLIDAY_SET: ReadonlySet<string> = (() => {
  const raw =
    (holidaysData as { holidays?: readonly RawHoliday[] }).holidays ?? [];
  const set = new Set<string>();
  for (const h of raw) {
    if (typeof h.date === "string" && ISO_DATE_RE.test(h.date)) {
      set.add(h.date);
    }
  }
  return set;
})();

// 祝日データがカバーする年の範囲（[from, to]）。範囲外の入力は計算可能だが
// 「祝日を考慮できない区間」になり得るため、UI 側で注意喚起できるよう公開する。
export const HOLIDAY_COVERAGE: { readonly from: number; readonly to: number } =
  (() => {
    const years = Array.from(HOLIDAY_SET).map((d) => Number(d.slice(0, 4)));
    if (years.length === 0) return { from: 0, to: 0 };
    return { from: Math.min(...years), to: Math.max(...years) };
  })();

export const ALL_HOLIDAYS: readonly string[] = Array.from(HOLIDAY_SET).sort();

// 指定 ISO 日付が国民の祝日かどうか。
export const isJapaneseHoliday = (isoDate: string): boolean =>
  HOLIDAY_SET.has(isoDate);

// ── 日付ユーティリティ（UTC ベースで日付のみを扱い、TZ ズレを排除）──

// ISO 日付（YYYY-MM-DD）を「1970-01-01 からの通日数」に変換する。
// 不正な形式は null。UTC で固定し、ローカルタイムゾーン依存をなくす。
const isoToDayNumber = (isoDate: string): number | null => {
  const m = ISO_DATE_RE.exec(isoDate);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  // Date.UTC でエポックミリ秒 → 日数。実在しない日（例: 2-30）は正規化されるため、
  // 往復チェックして弾く。
  const ms = Date.UTC(y, mo - 1, d);
  const back = dayNumberToIso(Math.floor(ms / 86_400_000));
  if (back !== isoDate) return null;
  return Math.floor(ms / 86_400_000);
};

// 通日数 → ISO 日付（YYYY-MM-DD, UTC）。
const dayNumberToIso = (dayNumber: number): string => {
  const date = new Date(dayNumber * 86_400_000);
  const y = date.getUTCFullYear();
  const mo = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${mo}-${d}`;
};

// 通日数 → 曜日（0=日, 6=土）。
const dayNumberToWeekday = (dayNumber: number): number => {
  // 1970-01-01 は木曜（4）。負の剰余を避けて正規化。
  return ((dayNumber % 7) + 4 + 7) % 7;
};

// その日が開庁日（土日でも祝日でもない）か。
const isBusinessDayNumber = (dayNumber: number): boolean => {
  const wd = dayNumberToWeekday(dayNumber);
  if (wd === 0 || wd === 6) return false; // 日・土
  return !HOLIDAY_SET.has(dayNumberToIso(dayNumber));
};

/**
 * 指定日が開庁日（土日・国民の祝日でない平日）かどうか。
 * @param isoDate ISO 日付（YYYY-MM-DD）。形式不正は false。
 */
export const isBusinessDay = (isoDate: string): boolean => {
  const n = isoToDayNumber(isoDate);
  if (n === null) return false;
  return isBusinessDayNumber(n);
};

/**
 * 基準日から「n 開庁日前」の日付を返す（提出期限の逆算）。
 *
 * 定義（spec §3.4「飛行開始の 10 開庁日以上前までに提出」）:
 *   - 基準日（飛行予定日）自身は数えない。
 *   - そこから過去方向に向かって開庁日（土日・祝日を除く平日）を 1 日ずつ数え、
 *     n 個目の開庁日を返す。
 *   - 例: 飛行日が金曜で n=1 なら、直前の開庁日（木曜、祝日でなければ）。
 *
 * @param baseIsoDate 基準日（飛行予定日）ISO 日付（YYYY-MM-DD）
 * @param businessDays 逆算する開庁日数（>= 0 の整数）。0 なら基準日をそのまま返す。
 * @returns 期限の ISO 日付（YYYY-MM-DD）。基準日が不正形式 / businessDays が不正なら null。
 */
export const subtractBusinessDays = (
  baseIsoDate: string,
  businessDays: number,
): string | null => {
  const base = isoToDayNumber(baseIsoDate);
  if (base === null) return null;
  if (!Number.isInteger(businessDays) || businessDays < 0) return null;
  if (businessDays === 0) return baseIsoDate;

  let cursor = base;
  let counted = 0;
  // 無限ループ防止の上限（暦日で十分に余裕のある定数。10 開庁日 ≒ 2 週間程度）。
  // 連休が続いても businessDays * 7 + 30 日あれば必ず到達する。
  const maxIterations = businessDays * 7 + 60;
  for (let i = 0; i < maxIterations && counted < businessDays; i++) {
    cursor -= 1; // 過去方向へ 1 日
    if (isBusinessDayNumber(cursor)) counted += 1;
  }
  if (counted < businessDays) return null; // 到達できなかった（理論上起きない）
  return dayNumberToIso(cursor);
};

/**
 * 2 つの ISO 日付の間の「暦日差」（to - from, 日数）。
 * 残り日数アラートの判定に使う（締切超過は負、当日は 0）。
 * @returns 日数差。どちらかが不正形式なら null。
 */
export const daysBetween = (fromIso: string, toIso: string): number | null => {
  const a = isoToDayNumber(fromIso);
  const b = isoToDayNumber(toIso);
  if (a === null || b === null) return null;
  return b - a;
};

/**
 * 与えられた Date（実行時刻）を JST の ISO 日付（YYYY-MM-DD）に変換する。
 * 「今日」基準で締切までの残り日数を出すために使う。
 * @param now 基準時刻（既定は現在時刻）
 */
export const toJstIsoDate = (now: Date = new Date()): string => {
  // UTC+9（JST）。サマータイムがないため固定オフセットで十分。
  const jstMs = now.getTime() + 9 * 60 * 60 * 1000;
  return dayNumberToIso(Math.floor(jstMs / 86_400_000));
};

// 期限の逼迫度（UI のアラート色に対応）。
//   overdue … 期限を過ぎている（残り日数 < 0）→ red
//   urgent  … 残り日数が逆算開庁日数の半分以下かつ 0 以上 → amber
//   ok      … まだ余裕がある → 通常色
//   none    … 提出期限の概念がない手続き（leadTime 0）または日付未確定
export type DeadlineUrgency = "overdue" | "urgent" | "ok" | "none";

/**
 * 締切日と「今日」から逼迫度を判定する。
 * @param submitByIso 提出期限 ISO 日付（未確定なら undefined）
 * @param todayIso 今日の ISO 日付
 * @param leadTimeBusinessDays 当該手続きの逆算開庁日数（urgent 閾値の基準）
 */
export const classifyDeadlineUrgency = (
  submitByIso: string | undefined,
  todayIso: string,
  leadTimeBusinessDays: number,
): DeadlineUrgency => {
  if (!submitByIso || leadTimeBusinessDays <= 0) return "none";
  const remaining = daysBetween(todayIso, submitByIso);
  if (remaining === null) return "none";
  if (remaining < 0) return "overdue";
  // 残り暦日が「逆算開庁日数」相当を割り込んだら urgent（提出に必要な準備期間を切った）。
  // 10 開庁日 ≒ 14 暦日。半分（7 暦日）を urgent の目安にする。
  const urgentThreshold = Math.ceil(leadTimeBusinessDays * 0.7);
  if (remaining <= urgentThreshold) return "urgent";
  return "ok";
};
