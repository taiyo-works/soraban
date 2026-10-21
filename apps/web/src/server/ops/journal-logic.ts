// 日誌（飛行記録）と計画・通報の食い違い（Sprint 12c 設計 D）。純粋関数。DB・時計・ネットワークに触れない。
//   journalMismatches  飛行記録 1 件と、結び付いた計画・通報の行から導出する（保存しない。一覧・詳細に毎回出す）
//
// 守ること：
//   - 知らせるだけ。保存は止めない（飛んだ事実の記録を止めない）。機体・操縦者の違いは従来の differs_from_plan に任せる。
//   - 計画なしの記録は食い違いなし（「判定の根拠が紐づいていません」は 12a のまま）。
//   - 通報の食い違いは要・要確認の計画だけ。推奨・対象外（模型航空機）には出さない。
//   - 離陸の後に記録された通報は、事前の通報として数えない（飛行開始後の通報は事前の通報ではない）。
//   - 通報を免除するような語（禁止語。12a 契約 15）を作らない。罰則・条番号を新しく書かない。
import { COMPLETED_STATES, effectiveReport, type ReportRowLite } from "@soraban/dips";
import {
  JOURNAL_MISMATCH_REPORT_AFTER_TAKEOFF,
  JOURNAL_MISMATCH_REPORT_MISSING,
  outsidePlanWindowLabel,
  type JournalMismatchCode,
} from "@/lib/ops-field";
import { parseJstMinute } from "@/lib/ops-time";

export type JournalMismatch = {
  readonly code: JournalMismatchCode;
  /** 表示（例：計画の時間帯の外で飛行しています（離陸が 12 分早い／着陸が 8 分遅い）。）。 */
  readonly label: string;
  /** outside_plan_window：離陸が予定開始より早い分（無ければ 0）。 */
  readonly earlyMinutes: number;
  /** outside_plan_window：着陸が予定終了より遅い分（無ければ 0）。 */
  readonly lateMinutes: number;
};

export type JournalMismatchInput = {
  readonly takeoffAt: Date;
  readonly landingAt: Date;
  /** 結び付いた計画（無ければ null）。requirementKind は計画の現在のスナップショットの通報の要否。 */
  readonly plan: {
    readonly plannedStartAt: Date;
    readonly durationMinutes: number;
    readonly requirementKind: string;
  } | null;
  /** 計画の通報の行（reportedAt は JST の `YYYY-MM-DDTHH:MM`）。 */
  readonly reports: readonly ReportRowLite[];
};

const MINUTE_MS = 60_000;
const NEEDS_REPORT = new Set(["required", "confirm"]);

const reportedAtOf = (r: ReportRowLite): Date | null => (r.reportedAt ? parseJstMinute(r.reportedAt) : null);

/**
 * 飛行記録の食い違いを導出する（順は outside_plan_window、report_missing、report_after_takeoff）。
 *   outside_plan_window  離陸が計画の予定開始より前、または着陸が予定終了（開始 + 所要時間）より後（早い・遅いの分数つき）
 *   report_missing       要・要確認で、離陸の時点で有効な通報の記録が無い（通報日時が離陸より後のものは有効と数えない）
 *   report_after_takeoff 要・要確認で、有効な通報の通報日時が離陸より後
 * 「離陸の時点で有効」は、完了した通報の行（新規・変更・取消）のうち通報日時が離陸以前のものだけで有効な通報を求めて決める。
 */
export const journalMismatches = (i: JournalMismatchInput): JournalMismatch[] => {
  const plan = i.plan;
  if (plan === null) return [];
  const out: JournalMismatch[] = [];

  const start = plan.plannedStartAt.getTime();
  const end = start + plan.durationMinutes * MINUTE_MS;
  const early = Math.max(0, Math.ceil((start - i.takeoffAt.getTime()) / MINUTE_MS));
  const late = Math.max(0, Math.ceil((i.landingAt.getTime() - end) / MINUTE_MS));
  if (early > 0 || late > 0) {
    out.push({ code: "outside_plan_window", label: outsidePlanWindowLabel(early, late), earlyMinutes: early, lateMinutes: late });
  }

  if (NEEDS_REPORT.has(plan.requirementKind)) {
    const completed = i.reports.filter((r) => COMPLETED_STATES.includes(r.status));
    const asOfTakeoff = effectiveReport(
      completed.filter((r) => {
        const at = reportedAtOf(r);
        return at !== null && at.getTime() <= i.takeoffAt.getTime();
      }),
    );
    if (asOfTakeoff === null) {
      out.push({ code: "report_missing", label: JOURNAL_MISMATCH_REPORT_MISSING, earlyMinutes: 0, lateMinutes: 0 });
      const now = effectiveReport(completed);
      const nowAt = now ? reportedAtOf(now) : null;
      if (nowAt !== null && nowAt.getTime() > i.takeoffAt.getTime()) {
        out.push({ code: "report_after_takeoff", label: JOURNAL_MISMATCH_REPORT_AFTER_TAKEOFF, earlyMinutes: 0, lateMinutes: 0 });
      }
    }
  }
  return out;
};
