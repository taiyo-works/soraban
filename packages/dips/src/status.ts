// 有効な通報と通報の状況（導出。Sprint 12b 設計 E）。純粋関数。保存しない（記録の有無から毎回導出する）。
//
// 有効な通報：計画の通報の行のうち、種別が new／change、状態が reported_manual／submitted_api（retracted でない）で、
//   それより後に完了した cancel の行（状態が reported_manual／submitted_api）が無い最新の 1 件。
//   DB 側の関数 flight_report_effective_id（0012）と同じ規則（reports.db.test.ts で一致を確かめる）。
import {
  cancelStateLabel,
  REPORT_STATUS_LABEL,
  REPORT_STATUS_MARK,
  REPORT_STATUS_SHORT_LABEL,
  reportStateLabel,
  type ReportStatusCode,
} from "./messages";
import { COMPLETED_STATES, effectiveState } from "./transitions";
import type { ReportChannel, ReportKind, ReportState, RequirementKind } from "./types";

/** 通報の行のうち、導出に使う列。 */
export type ReportRowLite = {
  readonly id: string;
  readonly kind: ReportKind;
  readonly status: ReportState;
  readonly channel: ReportChannel;
  /** 作成時刻（マイクロ秒つきの ISO 文字列、または Date）。並べ替えに使う。 */
  readonly createdAt: string | Date;
  readonly updatedAt: string | Date;
  readonly fingerprint: string;
  /** 通報日時（JST の分）。 */
  readonly reportedAt?: string | null;
  readonly dipsNumber?: string | null;
  readonly numberUnavailable?: boolean;
};

/** 時刻を、文字列の比較で正しく並ぶ形（UTC・小数 6 桁の ISO 文字列）にする。 */
export const timeKey = (v: string | Date): string => {
  if (v instanceof Date) return v.toISOString().replace(/\.(\d{3})Z$/, ".$1000Z");
  const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:?\d{2})$/.exec(v);
  if (!m) return v;
  if (m[3] !== "Z") return new Date(v).toISOString().replace(/\.(\d{3})Z$/, ".$1000Z");
  return `${m[1]}.${(m[2] ?? "").padEnd(6, "0").slice(0, 6)}Z`;
};

/** 作成の新しい順に比べる（同時刻は ID）。 */
const compareCreated = (a: ReportRowLite, b: ReportRowLite): number => {
  const ka = timeKey(a.createdAt);
  const kb = timeKey(b.createdAt);
  if (ka !== kb) return ka < kb ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
};

const isCompleted = (r: ReportRowLite): boolean => COMPLETED_STATES.includes(r.status);

/** 有効な通報（無ければ null）。 */
export const effectiveReport = <T extends ReportRowLite>(rows: readonly T[]): T | null => {
  const candidates = rows.filter((r) => (r.kind === "new" || r.kind === "change") && isCompleted(r)).sort(compareCreated);
  const latest = candidates[candidates.length - 1];
  if (!latest) return null;
  const cancelled = rows.some((r) => r.kind === "cancel" && isCompleted(r) && compareCreated(latest, r) < 0);
  return cancelled ? null : latest;
};

/** 完了した取消の件数（新規の冪等性キーの「世代」）。取り下げた取消は数えない。 */
export const cancelGeneration = (rows: readonly ReportRowLite[]): number =>
  rows.filter((r) => r.kind === "cancel" && isCompleted(r)).length;

/** 取り下げていない最新の行（取り下げ可否・状況の判定に使う）。 */
export const latestLiveReport = <T extends ReportRowLite>(rows: readonly T[]): T | null => {
  const live = rows.filter((r) => r.status !== "retracted").sort(compareCreated);
  return live[live.length - 1] ?? null;
};

export type ReportStatusInput = {
  readonly requirementKind: RequirementKind;
  readonly rows: readonly ReportRowLite[];
  /** 現在の計画の指紋。 */
  readonly currentFingerprint: string;
  readonly planVoided: boolean;
  readonly now: Date;
};

export type ReportStatusResult = {
  readonly code: ReportStatusCode;
  readonly label: string;
  readonly shortLabel: string;
  /** 一覧の印（文字と記号。色だけで区別しない）。 */
  readonly mark: string;
  /** 日時・番号などの補足（通報済みのとき）。 */
  readonly detail: string | null;
  readonly effectiveId: string | null;
  readonly latestId: string | null;
  /** 利用者の対応が要る状況か。 */
  readonly needsAttention: boolean;
};

const reportedDetail = (r: ReportRowLite): string => {
  const at = r.reportedAt ? r.reportedAt.replace("T", " ") : "日時なし";
  const num = r.dipsNumber ? `番号 ${r.dipsNumber}` : r.numberUnavailable ? "番号なし（表示されなかった）" : "番号なし";
  return `${at}・${num}`;
};

/**
 * 通報の状況を導出する。要否と有効な通報・指紋・計画の取消・時刻から、次のどれかを返す。
 *   対象外（模型航空機）／記録なし／通報済み／変更通報の要否を確認／取消が必要／取消済み／結果不明／失敗／送信中
 * 記録（reported_manual・submitted_api）が無いうちは「通報済み」を返さない。
 */
export const reportStatus = (i: ReportStatusInput): ReportStatusResult => {
  const make = (code: ReportStatusCode, extra: Partial<ReportStatusResult> = {}): ReportStatusResult => ({
    code,
    label: REPORT_STATUS_LABEL[code],
    shortLabel: REPORT_STATUS_SHORT_LABEL[code],
    mark: REPORT_STATUS_MARK[code],
    detail: null,
    effectiveId: null,
    latestId: null,
    needsAttention: code !== "reported" && code !== "not_applicable_model" && code !== "cancelled",
    ...extra,
  });

  if (i.requirementKind === "not_applicable_model") return make("not_applicable_model");

  const eff = effectiveReport(i.rows);
  const latest = latestLiveReport(i.rows);
  const ids = { effectiveId: eff?.id ?? null, latestId: latest?.id ?? null };

  if (latest) {
    const st = effectiveState(latest, i.now);
    if (latest.kind === "cancel" && isCompleted(latest)) {
      return make("cancelled", { ...ids, detail: reportedDetail(latest) });
    }
    if (st === "unknown") return make("unknown", { ...ids, label: stateLabelOf(latest, i.now) });
    if (st === "failed") return make("failed", ids);
    if (st === "prepared") return make("sending", ids);
  }

  if (eff) {
    const detail = reportedDetail(eff);
    if (i.planVoided) return make("cancel_needed", { ...ids, detail });
    if (eff.fingerprint !== i.currentFingerprint) return make("change_review", { ...ids, detail });
    return make("reported", { ...ids, detail, label: `${reportStateLabel(eff.status, eff.channel)}：${detail}` });
  }
  return make("no_record", ids);
};

/** 行の状態の表示（取消の行は取消の言い回し）。 */
export const stateLabelOf = (r: ReportRowLite, now: Date): string => {
  const stale = r.status === "prepared" && effectiveState(r, now) === "unknown";
  return r.kind === "cancel" ? cancelStateLabel(r.status, stale) : reportStateLabel(r.status, r.channel, stale);
};
