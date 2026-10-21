// 通報の記録の状態の遷移表（Sprint 12b 設計 E）。1 か所に置き、画面・アダプター・サービス・テストが同じ表を使う。
// 表にない遷移は拒否する。DB は列の整合（CHECK）と組織・計画・版の検査だけを持ち、遷移の許可はここが決める。
//
// 保存する状態：prepared・reported_manual・submitted_api・failed・unknown・retracted。
// copied は保存せず監査に残す。cancelled は状態でなく、種別 cancel の別の行で表す。
import type { ReportChannel, ReportState } from "./types";

export type TransitionVia =
  /** 手動：利用者が DIPS で通報した結果を記録する。 */
  | "record_manual"
  /** 模擬・API：外部を呼ぶ前に prepared を記録する。 */
  | "begin_send"
  /** 模擬・API：外部の結果を記録する。 */
  | "send_result"
  /** 失敗した送信の再送（同じ行・同じキー）。 */
  | "retry"
  /** 結果不明の確定（確認の後。理由が必須）。 */
  | "resolve"
  /** 記録の誤りの取り下げ（理由が必須）。取消（種別 cancel）とは別。 */
  | "retract";

export type Transition = {
  /** 元の状態。null は「まだ行がない」（作成）。 */
  readonly from: ReportState | null;
  readonly to: ReportState;
  readonly via: TransitionVia;
  /** この遷移を行える送信元。 */
  readonly channels: readonly ReportChannel[];
  readonly needsReason: boolean;
  /** 元が prepared のまま 5 分を超えた行（結果不明として扱う）のときだけ許す。 */
  readonly onlyWhenStale?: true;
};

const DIRECT: readonly ReportChannel[] = ["mock", "api"];
const ALL: readonly ReportChannel[] = ["manual", "mock", "api"];

export const REPORT_TRANSITIONS: readonly Transition[] = [
  { from: null, to: "reported_manual", via: "record_manual", channels: ["manual"], needsReason: false },
  { from: null, to: "prepared", via: "begin_send", channels: DIRECT, needsReason: false },
  { from: "prepared", to: "submitted_api", via: "send_result", channels: DIRECT, needsReason: false },
  { from: "prepared", to: "failed", via: "send_result", channels: DIRECT, needsReason: false },
  { from: "prepared", to: "unknown", via: "send_result", channels: DIRECT, needsReason: false },
  { from: "failed", to: "prepared", via: "retry", channels: DIRECT, needsReason: false },
  { from: "unknown", to: "submitted_api", via: "resolve", channels: DIRECT, needsReason: true },
  { from: "unknown", to: "failed", via: "resolve", channels: DIRECT, needsReason: true },
  { from: "unknown", to: "reported_manual", via: "resolve", channels: DIRECT, needsReason: true },
  // prepared のまま 5 分を超えた行は結果不明として扱うため、unknown と同じ確定ができる
  { from: "prepared", to: "submitted_api", via: "resolve", channels: DIRECT, needsReason: true, onlyWhenStale: true },
  { from: "prepared", to: "failed", via: "resolve", channels: DIRECT, needsReason: true, onlyWhenStale: true },
  { from: "prepared", to: "reported_manual", via: "resolve", channels: DIRECT, needsReason: true, onlyWhenStale: true },
  { from: "reported_manual", to: "retracted", via: "retract", channels: ALL, needsReason: true },
];

/** prepared のまま、この分数を超えた行は「送信の途中で止まった可能性」（結果不明として扱う）。自動で再送しない。 */
export const PREPARED_STALE_MINUTES = 5;

const matches = (t: Transition, from: ReportState | null, to: ReportState, channel: ReportChannel, stale: boolean): boolean =>
  t.from === from && t.to === to && t.channels.includes(channel) && (t.onlyWhenStale !== true || stale);

/** from → to が表にあるか。stale は元が prepared のまま 5 分を超えているか。 */
export const canTransition = (
  from: ReportState | null,
  to: ReportState,
  channel: ReportChannel,
  opts: { readonly stale?: boolean } = {},
): boolean => REPORT_TRANSITIONS.some((t) => matches(t, from, to, channel, opts.stale === true));

/** 表にある遷移（無ければ undefined）。 */
export const findTransition = (
  from: ReportState | null,
  to: ReportState,
  channel: ReportChannel,
  opts: { readonly stale?: boolean } = {},
): Transition | undefined => REPORT_TRANSITIONS.find((t) => matches(t, from, to, channel, opts.stale === true));

/** from から行ける状態の一覧。 */
export const allowedNext = (
  from: ReportState | null,
  channel: ReportChannel,
  opts: { readonly stale?: boolean } = {},
): ReportState[] => [
  ...new Set(REPORT_TRANSITIONS.filter((t) => matches(t, from, t.to, channel, opts.stale === true)).map((t) => t.to)),
];

/** 遷移が許されないとき投げる誤り。 */
export class TransitionError extends Error {
  override readonly name = "TransitionError";
  constructor(
    readonly from: ReportState | null,
    readonly to: ReportState,
    readonly channel: ReportChannel,
  ) {
    super(`transition not allowed: ${from ?? "(none)"} -> ${to} (${channel})`);
  }
}

/** 遷移を検査する。表になければ TransitionError。 */
export const assertTransition = (
  from: ReportState | null,
  to: ReportState,
  channel: ReportChannel,
  opts: { readonly stale?: boolean } = {},
): Transition => {
  const t = findTransition(from, to, channel, opts);
  if (!t) throw new TransitionError(from, to, channel);
  return t;
};

/** 行の状態を、表示・判定のために実効の状態にする。prepared のまま 5 分を超えたら unknown（結果不明）として扱う。 */
export const isPreparedStale = (row: { readonly status: ReportState; readonly updatedAt: Date | string }, now: Date): boolean => {
  if (row.status !== "prepared") return false;
  const t = row.updatedAt instanceof Date ? row.updatedAt.getTime() : Date.parse(row.updatedAt);
  if (!Number.isFinite(t)) return true;
  return now.getTime() - t > PREPARED_STALE_MINUTES * 60 * 1000;
};

export const effectiveState = (row: { readonly status: ReportState; readonly updatedAt: Date | string }, now: Date): ReportState =>
  isPreparedStale(row, now) ? "unknown" : row.status;

/** 完了した状態（有効な通報・有効な取消の判定に使う）。 */
export const COMPLETED_STATES: readonly ReportState[] = ["reported_manual", "submitted_api"];

/** 手動記録・API の結果の訂正ができる状態（状態は変えず、番号・日時・メモを理由つきの新しい版で直す）。 */
export const CORRECTABLE_STATES: readonly ReportState[] = ["reported_manual", "submitted_api"];
