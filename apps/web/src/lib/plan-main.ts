// 通報の主画面（/ops/plans/[id]）の表示の決まり（Sprint 17-2）。画面から切り離した純粋な関数。
// 主操作は 1 つ（状態で決まる）。判定の 1 行は常に「判定（補助）：」で始め、通報の要否と混ざらない言い方にする。
// 通報の要否を打ち消すように読める語は使わない（判定を読み込めないときは要として扱う）。
import type { ReportStatusCode } from "@soraban/dips";
import { VERDICT_LABEL } from "@/lib/verdict-display";

export const JUDGE_LINE_PREFIX = "判定（補助）：";
export const JUDGE_UNREADABLE = "判定を確認できません。要として扱います";
export const SOURCE_STALE_LABEL = "出典が古い";

/** 固定の文言の短い版（全文は REPORT_FIXED_NOTE。画面では 1 回で開く）。 */
export const REPORT_NOTE_SHORT =
  "そらばんは DIPS に送信しません。通報は本人が DIPS 2.0 で行い、結果を記録します。記録があるまで、通報済みにはなりません。";

/** 中止した計画で、通報の記録が無いときの表示（事実だけを示す）。 */
export const VOIDED_NO_RECORD_LABEL = "中止（通報の記録はありません）";

export type JudgeLineModel =
  | { readonly kind: "ok"; readonly level: string; readonly levelLabel: string; readonly unknownCount: number; readonly stale: boolean; readonly sourcesStale: boolean }
  | { readonly kind: "unreadable"; readonly stale: boolean; readonly sourcesStale: boolean };

/** 判定の 1 行の中身。結論の段が分からないときは「判定を確認できません。要として扱います」。 */
export const judgeLineModel = (i: {
  readonly level: string | null | undefined;
  readonly unknownCount: number | null | undefined;
  readonly stale: boolean;
  readonly sourcesStale: boolean;
}): JudgeLineModel => {
  const label = i.level ? VERDICT_LABEL[i.level as keyof typeof VERDICT_LABEL] : undefined;
  if (!i.level || label === undefined) return { kind: "unreadable", stale: i.stale, sourcesStale: i.sourcesStale };
  const unknown = typeof i.unknownCount === "number" && Number.isFinite(i.unknownCount) && i.unknownCount > 0 ? Math.trunc(i.unknownCount) : 0;
  return { kind: "ok", level: i.level, levelLabel: label, unknownCount: unknown, stale: i.stale, sourcesStale: i.sourcesStale };
};

export type PrimaryActionInput = {
  readonly planId: string;
  readonly voided: boolean;
  /** 確認の状態（PlanState）。 */
  readonly state: string;
  readonly statusCode: ReportStatusCode;
  /** 次にやることのうち、操作できるか（id → canAct）。 */
  readonly canAct: Readonly<Record<string, boolean>>;
};

export type PrimaryAction = { readonly id: string; readonly label: string; readonly href: string };

/** 通報の主画面の主操作（1 つ）。状態で決まる。 */
export const primaryActionOf = (i: PrimaryActionInput): PrimaryAction => {
  const base = `/ops/plans/${i.planId}`;
  const view: PrimaryAction = { id: "view_report", label: "通報の内容を見る・通報する", href: `${base}/report` };
  if (i.voided) {
    if (i.statusCode === "cancel_needed") {
      return i.canAct["cancel_report"] === false
        ? { id: "view_history", label: "通報の履歴を見る", href: `${base}/report#history` }
        : { id: "record_cancel", label: "取消の結果を記録する", href: `${base}/report?kind=cancel#record` };
    }
    if (i.statusCode === "no_record") return { id: "view_plan", label: "計画の内容を見る", href: `${base}/overview` };
    return { id: "view_history", label: "通報の履歴を見る", href: `${base}/report#history` };
  }
  if (i.state === "draft") {
    return i.canAct["request_confirmation"] === false
      ? { id: "view_report", label: "通報の内容を見る", href: `${base}/report` }
      : { id: "request_confirmation", label: "確認を依頼する", href: `${base}/overview#request-confirmation` };
  }
  if (i.state === "returned" && i.canAct["fix_returned"] === true) {
    return { id: "fix_returned", label: "計画を訂正する", href: `${base}/edit` };
  }
  switch (i.statusCode) {
    case "change_review":
      return { id: "change_report", label: "変更の通報を準備する", href: `${base}/report?kind=change` };
    case "unknown":
    case "failed":
      return { id: "record_result", label: "結果を記録する", href: `${base}/report#record` };
    case "reported":
      return { id: "view_result", label: "通報の結果を見る", href: `${base}/report#history` };
    case "cancelled":
      return { id: "view_history", label: "通報の履歴を見る", href: `${base}/report#history` };
    case "not_applicable_model":
    case "sending":
      return { id: "view_report", label: "通報の内容を見る", href: `${base}/report` };
    case "cancel_needed":
    case "no_record":
      return view;
  }
};
