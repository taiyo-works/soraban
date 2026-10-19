// 飛行日誌の時刻と飛行時間（Sprint 11 設計 A）。純粋関数 1 か所にまとめ、サーバー（API の入力検査）と画面（入力中の表示）が同じものを使う。
// DB のトリガー（0008 の ops_jst_minute_to_timestamptz・ops_flight_minutes）も同じ規則で計算する（ops.db.test.ts で一致を確かめる）。
// - 入力は `YYYY-MM-DDTHH:MM` だけ。常に日本標準時（UTC+9）として解釈し、実行環境の TZ・端末のタイムゾーンに依らない。
//   秒付き・タイムゾーン付き・存在しない日付は丸めずに time_format（飛行日誌は 1 分単位。秒を黙って捨てると記録と実際がずれる）。
// - 飛行時間（分）＝着陸−離陸。同じ分なら 1 分（GL p.10〜11「1 分（0:01）になるよう、切り上げ」）。
// - Date の地方時の関数（getHours 等）は使わない（TZ に依らないようにするため）。

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
/** 飛行時間の上限（これ以上は入力の誤りとみなす）。 */
export const MAX_FLIGHT_MINUTES = 24 * 60 - 1;

export type TimeErrorCode = "time_format" | "landing_before_takeoff" | "flight_too_long" | "takeoff_in_future";

const JST_INPUT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/** `YYYY-MM-DDTHH:MM`（JST）を解釈する。形が違う・存在しない日時は null。 */
export const parseJstMinute = (s: unknown): Date | null => {
  if (typeof s !== "string") return null;
  const m = JST_INPUT.exec(s);
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number) as [number, number, number, number, number];
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || y < 1900) return null;
  const utc = Date.UTC(y, mo - 1, d, h, mi) - JST_OFFSET_MS;
  const back = new Date(utc + JST_OFFSET_MS);
  // 2 月 30 日などの存在しない日付は、繰り上がって別の日になるので拒否する
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return new Date(utc);
};

const p2 = (n: number) => String(n).padStart(2, "0");

const jstParts = (d: Date) => {
  const j = new Date(d.getTime() + JST_OFFSET_MS);
  return {
    y: j.getUTCFullYear(),
    mo: p2(j.getUTCMonth() + 1),
    d: p2(j.getUTCDate()),
    h: p2(j.getUTCHours()),
    mi: p2(j.getUTCMinutes()),
  };
};

/** 入力の形（`YYYY-MM-DDTHH:MM`、JST）。秒は切り捨てる。 */
export const toJstInput = (d: Date): string => {
  const p = jstParts(d);
  return `${p.y}-${p.mo}-${p.d}T${p.h}:${p.mi}`;
};

/** 表示の形（`YYYY-MM-DD HH:MM`、JST）。 */
export const formatJst = (d: Date): string => {
  const p = jstParts(d);
  return `${p.y}-${p.mo}-${p.d} ${p.h}:${p.mi}`;
};

/** JST の日付（`YYYY-MM-DD`）。 */
export const jstDate = (d: Date): string => {
  const p = jstParts(d);
  return `${p.y}-${p.mo}-${p.d}`;
};

/** JST の時刻（`HH:MM`）。 */
export const jstTime = (d: Date): string => {
  const p = jstParts(d);
  return `${p.h}:${p.mi}`;
};

/** 現在の JST の分（秒は切り捨て）を入力の形で返す（「今」ボタン）。 */
export const nowJstInput = (now: Date = new Date()): string => toJstInput(now);

/** 分の始まりに切り捨てる。 */
export const floorToMinute = (d: Date): Date => new Date(Math.floor(d.getTime() / MINUTE_MS) * MINUTE_MS);

/** 着陸時刻の表示。離陸と JST の日付が違えば「翌日 HH:MM」（2 日以上後は日付付き）。 */
export const formatLanding = (takeoff: Date, landing: Date): string => {
  const a = jstDate(takeoff);
  const b = jstDate(landing);
  if (a === b) return jstTime(landing);
  const next = jstDate(new Date(takeoff.getTime() + 24 * 60 * 60 * 1000));
  return b === next ? `翌日 ${jstTime(landing)}` : formatJst(landing);
};

export type FlightMinutesResult =
  | { readonly ok: true; readonly minutes: number; readonly roundedUp: boolean }
  | { readonly ok: false; readonly code: TimeErrorCode };

/**
 * 飛行時間（分）を求める。同じ分なら 1（切り上げ）。
 * now を渡すと、離陸が現在の分より後なら takeoff_in_future（過去の日付は制限しない：後入力のため）。
 */
export const flightMinutes = (takeoff: Date, landing: Date, now?: Date): FlightMinutesResult => {
  if (now !== undefined && takeoff.getTime() > floorToMinute(now).getTime()) return { ok: false, code: "takeoff_in_future" };
  const diff = Math.round((landing.getTime() - takeoff.getTime()) / MINUTE_MS);
  if (diff < 0) return { ok: false, code: "landing_before_takeoff" };
  if (diff > MAX_FLIGHT_MINUTES) return { ok: false, code: "flight_too_long" };
  return diff === 0 ? { ok: true, minutes: 1, roundedUp: true } : { ok: true, minutes: diff, roundedUp: false };
};

/** 入力の文字列 2 つから飛行時間を求める（どちらかの形が違えば time_format）。 */
export const flightMinutesFromInput = (takeoff: unknown, landing: unknown, now?: Date): FlightMinutesResult => {
  const t = parseJstMinute(takeoff);
  const l = parseJstMinute(landing);
  if (!t || !l) return { ok: false, code: "time_format" };
  return flightMinutes(t, l, now);
};

/** 分を `H:MM` にする（時間は 24 を超えてよい。例 0:01・123:45）。 */
export const formatHm = (minutes: number): string => {
  const m = Math.max(0, Math.trunc(minutes));
  return `${Math.floor(m / 60)}:${p2(m % 60)}`;
};

export const TIME_ERROR_MESSAGES: Readonly<Record<TimeErrorCode, string>> = {
  time_format: "日付と時刻を YYYY-MM-DD と HH:MM（日本時間、分まで）で入力してください",
  landing_before_takeoff: "着陸時刻が離陸時刻より前です",
  flight_too_long: "飛行時間が 24 時間以上です。日付を確かめてください",
  takeoff_in_future: "離陸時刻が現在より後です",
};

// ---- 位置（世界測地系 WGS84 の 10 進度、小数 6 桁まで） ----

export type CoordinateErrorCode = "coordinate_range" | "coordinate_precision" | "coordinate_format";

/** 緯度・経度を検査する。小数 7 桁以上は丸めずに拒否する。 */
export const checkCoordinate = (v: unknown, kind: "lat" | "lng"): { ok: true; value: number } | { ok: false; code: CoordinateErrorCode } => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v.trim()) : NaN;
  if (!Number.isFinite(n)) return { ok: false, code: "coordinate_format" };
  const limit = kind === "lat" ? 90 : 180;
  if (n < -limit || n > limit) return { ok: false, code: "coordinate_range" };
  // 小数の桁数は文字列の表現で数える（指数表記の小さな値は 7 桁以上とみなす）
  const s = typeof v === "string" ? v.trim() : String(n);
  if (/e/i.test(s)) return { ok: false, code: "coordinate_precision" };
  const frac = s.split(".")[1] ?? "";
  if (frac.length > 6) return { ok: false, code: "coordinate_precision" };
  return { ok: true, value: n };
};

/** 端末の位置（10 進度）を小数 6 桁に丸める（「現在地」ボタン。保存するまで送らない）。 */
export const roundCoordinate = (n: number): number => Math.round(n * 1e6) / 1e6;
