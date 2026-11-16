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
  /** 有効な通報（DIPS に通報が残っているもの）があるか（status.effectiveId !== null）。 */
  readonly hasEffective: boolean;
  /** 次にやることのうち、操作できるか（id → canAct）。無い id は「操作できる」とみなす。 */
  readonly canAct: Readonly<Record<string, boolean>>;
  /** 次にやることに「通報」(report)がある（取消済みでも、通報がまだ必要なとき）。 */
  readonly reportDue?: boolean;
};

export type PrimaryAction = { readonly id: string; readonly label: string; readonly href: string };

/** 中止した計画で、有効な通報が DIPS に残っている(取消が必要な)状態。 */
export const voidedCancelRequired = (i: Pick<PrimaryActionInput, "voided" | "statusCode" | "hasEffective">): boolean =>
  i.voided && i.statusCode !== "cancelled" && (i.hasEffective || i.statusCode === "cancel_needed");

/** 状況カードに明示する、中止後の案内（無ければ null）。有効な通報が残るときは「取消が必要です」と書く。 */
export const voidedCancelNotice = (i: Pick<PrimaryActionInput, "voided" | "statusCode" | "hasEffective">): string | null => {
  if (!i.voided || i.statusCode === "cancelled") return null;
  if (voidedCancelRequired(i)) {
    return "取消が必要です。この計画は中止されましたが、DIPS に通報が残っているおそれがあります。DIPS で取り消し、取消の結果を記録してください。";
  }
  if (i.statusCode === "unknown" || i.statusCode === "sending") {
    return "この計画は中止されました。通報の結果が分かりません。DIPS の画面で通報の有無を確かめ、履歴の「結果不明を確定する」で結果を記録してください。";
  }
  if (i.statusCode === "failed") {
    return "この計画は中止されました。通報は失敗のままで、再送や新しい記録はできません。DIPS に通報が残っていないかは、DIPS の画面で確かめてください。";
  }
  return null;
};

/** 中止・記録なしのときの 1 行（そらばんでは取消を記録できない旨）。 */
export const VOIDED_NO_RECORD_NOTE =
  "そらばんには通報の記録がありません。DIPS で通報していた場合は、DIPS で取り消してください（通報の記録がないため、そらばんでは取消を記録できません）。";

/** 次にやることを、表示する分と畳む分に分ける。期限超過（tier 2 以下）は、件数の上限に関わらず必ず表示する。 */
export const splitNextActions = <T extends { readonly tier: number }>(actions: readonly T[], limit: number): { readonly shown: readonly T[]; readonly rest: readonly T[] } => {
  const shown: T[] = [];
  const rest: T[] = [];
  actions.forEach((a, idx) => (idx < limit || a.tier <= 2 ? shown : rest).push(a));
  return { shown, rest };
};

/** 通報の主画面の主操作（1 つ）。状態で決まる。押せない操作は主操作にせず、内容を見るに寄せる。 */
export const primaryActionOf = (i: PrimaryActionInput): PrimaryAction => {
  const base = `/ops/plans/${i.planId}`;
  const history: PrimaryAction = { id: "view_history", label: "通報の履歴を見る", href: `${base}/report#history` };
  const viewOnly: PrimaryAction = { id: "view_report", label: "通報の内容を見る", href: `${base}/report` };
  const denied = (id: string): boolean => i.canAct[id] === false;
  if (i.voided) {
    if (i.statusCode === "cancelled") return history;
    if (voidedCancelRequired(i)) {
      return denied("cancel_report") ? history : { id: "record_cancel", label: "取消の結果を記録する", href: `${base}/report?kind=cancel#record` };
    }
    // 中止した計画は新しい記録ができない。結果不明の確定は履歴の行にある
    if (i.statusCode === "unknown") return { id: "settle_unknown", label: "結果不明を確定する", href: `${base}/report#history` };
    if (i.statusCode === "sending" || i.statusCode === "failed") return history;
    if (i.statusCode === "no_record") return { id: "view_plan", label: "計画の内容を見る", href: `${base}/overview` };
    return history;
  }
  if (i.state === "draft") {
    return denied("request_confirmation") ? viewOnly : { id: "request_confirmation", label: "確認を依頼する", href: `${base}/overview#request-confirmation` };
  }
  // 二重通報や通報の食い違いを避けるため、通報の状態の確認を差し戻しの訂正より先にする
  switch (i.statusCode) {
    case "change_review":
      return denied("change_report") ? viewOnly : { id: "change_report", label: "変更の通報を準備する", href: `${base}/report?kind=change` };
    case "unknown":
    case "failed":
      return denied("record_result") ? viewOnly : { id: "record_result", label: "結果を記録する", href: `${base}/report#record` };
    case "cancel_needed":
      return denied("cancel_report") ? viewOnly : { id: "record_cancel", label: "取消の結果を記録する", href: `${base}/report?kind=cancel#record` };
    default:
      break;
  }
  if (i.state === "returned" && i.canAct["fix_returned"] === true) {
    return { id: "fix_returned", label: "計画を訂正する", href: `${base}/edit` };
  }
  switch (i.statusCode) {
    case "reported":
      return { id: "view_result", label: "通報の結果を見る", href: `${base}/report#history` };
    case "cancelled":
      // 中止していない計画の取消済み：通報がまだ必要なら「通報する」(済みと読ませない)
      return i.reportDue === true ? { id: "view_report", label: "通報する", href: `${base}/report` } : history;
    case "not_applicable_model":
    case "sending":
      return viewOnly;
    default:
      return denied("report") ? viewOnly : { id: "view_report", label: "通報の内容を見る・通報する", href: `${base}/report` };
  }
};

/**
 * 状況カードの見出し。通報の状況に応じて変える（通報済みなのに「通報：要」のままにしない）。
 * 通報の要否の言葉（requirementLabel）は、記録が無いうち（または結果待ちでないとき）にだけ使う。
 */
export const cardHeading = (i: {
  readonly voided: boolean;
  readonly statusCode: ReportStatusCode;
  readonly hasEffective: boolean;
  readonly requirementLabel: string;
  /** 通報済みのときの言い方(経路に応じた status.label の「：」より前)。無ければ「通報済み」。 */
  readonly reportedLabel?: string;
  readonly reportDue?: boolean;
}): string => {
  if (i.voided && i.statusCode === "no_record") return VOIDED_NO_RECORD_LABEL;
  if (i.voided) {
    if (i.statusCode === "cancelled") return "取消済み（利用者の申告）";
    if (voidedCancelRequired(i)) return "取消の結果を記録してください";
    if (i.statusCode === "failed") return "中止（通報は失敗のままです）";
    if (i.statusCode === "unknown" || i.statusCode === "sending") return "中止（通報の結果を確かめてください）";
    return i.requirementLabel;
  }
  if (i.statusCode === "reported") return i.reportedLabel && i.reportedLabel.length > 0 ? i.reportedLabel : "通報済み";
  if (i.statusCode === "cancelled") return i.reportDue === true ? `${i.requirementLabel}（前の通報は取消済み）` : "取消済み（利用者の申告）";
  return i.requirementLabel;
};
