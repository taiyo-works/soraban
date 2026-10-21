// 通報の期限・漏れと、計画ごとの「次にやること」（Sprint 12b 設計 E）。純粋関数。DB・時計・ネットワークに触れない。
//   reportDeadlineState  目安の時刻（飛行開始の 24 時間前。report-policy.json）の前後・飛行開始の前後の状態
//   planNextActions      計画の状態から、保存せずに導出した動詞で始まる 1 行の一覧（並びは tier、飛行開始までの時間の順）
//
// 守ること：
//   - 目安は社内のもの。法定の期限として日付・時刻を作らない。罰則の文言には「※要確認」を付け、金額を出さない。
//   - 推奨は警告にしない（tier 5。次にやることの末尾に出すだけ）。要確認は要と同じに扱う。
//   - 許可・警察の期限の表示は、スナップショットの手続きが持つ期限の文言と日付をそのまま使う（新しい期限の日付を作らない）。
//   - 保存された「状態」は読まない。記録の有無から毎回導出する（記録を足すだけで一覧が変わる）。
import {
  deadlinePenaltyNote,
  DEADLINE_GUIDE_DISCLAIMER,
  DEADLINE_OVERDUE_STARTED_MESSAGE,
  DEADLINE_PAST_GUIDE_MESSAGE,
  DEADLINE_RECOMMENDED_MESSAGE,
  deadlineUpcomingMessage,
  NEXT_ACTION_LABEL,
  PROCEDURE_RECORD_STALE_LABEL,
  REPORT_POLICY,
  type NextActionId,
  type ProcedureRecordKind,
  type ReportPolicy,
  type ReportStatusResult,
  type RequirementKind,
} from "@soraban/dips";
import { jstDate } from "@/lib/ops-time";

// ---- 期限 ----------------------------------------------------------

export type DeadlineStateCode =
  /** 期限の対象でない（通報済み・模型航空機・中止した計画 など）。 */
  | "none"
  /** 目安の時刻より前。情報。 */
  | "upcoming"
  /** 目安の時刻を過ぎた。警告。 */
  | "past_guide"
  /** 飛行開始の時刻を過ぎている。最上位の警告。 */
  | "overdue_started"
  /** 推奨で記録がない。警告にしない。 */
  | "recommended_open";

export type DeadlineState = {
  readonly state: DeadlineStateCode;
  /** 次にやることの tier（1 通報の漏れ・2 目安の超過・3 未了・5 推奨）。none は null。 */
  readonly tier: 1 | 2 | 3 | 5 | null;
  /** 目安の時刻（ISO）。法定の期限ではない。none・recommended_open は null。 */
  readonly guideAt: string | null;
  /** 目安の時刻の表示（JST。社内の目安）。 */
  readonly guideAtJst: string | null;
  readonly startAt: string;
  /** upcoming のとき、目安までの時間（切り上げ）。 */
  readonly hoursToGuide: number | null;
  readonly message: string | null;
  /** 「社内の目安であり、法定の期限ではありません」。目安に触れる表示に必ず添える。 */
  readonly guideNote: string | null;
  /** overdue_started のときの罰則の文言（※要確認つき、金額なし）。 */
  readonly penaltyNote: string | null;
  /** 通報システムの障害時の例外の注記（※要確認）。 */
  readonly outageNote: string | null;
  /** 小型無人機等飛行禁止法の通報は別の手続きであること。 */
  readonly smallDroneLawNote: string;
};

export type DeadlineInput = {
  readonly requirementKind: RequirementKind;
  /** 有効な通報（完了した新規・変更）があるか。 */
  readonly hasEffective: boolean;
  readonly planVoided: boolean;
  readonly plannedStartAt: Date;
  readonly now: Date;
  readonly policy?: ReportPolicy;
};

const HOUR_MS = 60 * 60 * 1000;

/** 期限と漏れの状態。要・要確認で有効な通報が無いときだけ、飛行開始の前後と目安の前後で分ける。推奨は警告にしない。 */
export const reportDeadlineState = (i: DeadlineInput): DeadlineState => {
  const policy = i.policy ?? REPORT_POLICY;
  const guideAtDate = new Date(i.plannedStartAt.getTime() - policy.guideLeadHours * HOUR_MS);
  const base = {
    startAt: i.plannedStartAt.toISOString(),
    outageNote: policy.outageNote,
    smallDroneLawNote: policy.smallDroneLawNote,
  };
  const none: DeadlineState = {
    ...base,
    state: "none",
    tier: null,
    guideAt: null,
    guideAtJst: null,
    hoursToGuide: null,
    message: null,
    guideNote: null,
    penaltyNote: null,
    outageNote: null,
  };
  if (i.planVoided || i.hasEffective || i.requirementKind === "not_applicable_model") return none;

  if (i.requirementKind === "recommended") {
    return { ...none, ...base, state: "recommended_open", tier: 5, message: DEADLINE_RECOMMENDED_MESSAGE };
  }

  // 要・要確認（要確認は要と同じに扱う）
  const guide = {
    guideAt: guideAtDate.toISOString(),
    guideAtJst: jstMinute(guideAtDate),
    guideNote: DEADLINE_GUIDE_DISCLAIMER,
  };
  if (i.now.getTime() >= i.plannedStartAt.getTime()) {
    return {
      ...none,
      ...base,
      ...guide,
      state: "overdue_started",
      tier: 1,
      message: DEADLINE_OVERDUE_STARTED_MESSAGE,
      penaltyNote: deadlinePenaltyNote(policy),
    };
  }
  if (i.now.getTime() >= guideAtDate.getTime()) {
    return { ...none, ...base, ...guide, state: "past_guide", tier: 2, message: DEADLINE_PAST_GUIDE_MESSAGE };
  }
  const hours = Math.max(1, Math.ceil((guideAtDate.getTime() - i.now.getTime()) / HOUR_MS));
  return {
    ...none,
    ...base,
    ...guide,
    state: "upcoming",
    tier: 3,
    hoursToGuide: hours,
    message: deadlineUpcomingMessage(hours),
  };
};

const jstMinute = (d: Date): string => {
  const j = new Date(d.getTime() + 9 * HOUR_MS).toISOString();
  return `${j.slice(0, 10)} ${j.slice(11, 16)}`;
};

// ---- 次にやること --------------------------------------------------

export type NextActionTier = 1 | 2 | 3 | 4 | 5;

export type NextAction = {
  readonly id: NextActionId;
  /** 動詞で始まる 1 行（messages.ts の NEXT_ACTION_LABEL）。 */
  readonly label: string;
  readonly reason: string;
  /** 押すと移る画面（アンカーつき）。 */
  readonly href: string;
  readonly tier: NextActionTier;
  /** 期限・目安の表示（スナップショットの文言か、社内の目安）。 */
  readonly dueLabel: string | null;
  /** 要求した利用者がこの操作を行えるか（false なら、リンクにせず「運航管理者に依頼」などと示す）。 */
  readonly canAct: boolean;
  /** 飛行開始までの分（過ぎていれば負）。複数の計画の「次にやること」を並べるときの第 2 の並び順。 */
  readonly startsInMinutes: number;
};

/** 並び：tier の順、同じなら飛行開始までの時間が短い順（複数の計画をまたいでも使える）。 */
export const compareNextActions = (a: NextAction, b: NextAction): number =>
  a.tier - b.tier || a.startsInMinutes - b.startsInMinutes;

export type NextActionPlanState = "draft" | "pending" | "approved" | "approved_stale" | "returned" | "returned_stale" | "voided";

export type SnapshotProcedureLite = {
  readonly procedureId: string;
  readonly deadlineLabel: string | null;
  /** 期限の日付（YYYY-MM-DD）。決まらないときは null。 */
  readonly deadlineDate: string | null;
};

export type ProcedureRecordLite = {
  readonly action: "done" | "retract";
  readonly snapshotId: string;
};

export type NextActionsInput = {
  readonly planId: string;
  readonly plannedStartAt: Date;
  readonly now: Date;
  readonly planState: NextActionPlanState;
  readonly judgementStale: boolean;
  readonly currentSnapshotId: string;
  readonly requirementKind: RequirementKind;
  readonly requirementLabel: string;
  readonly status: Pick<ReportStatusResult, "code" | "effectiveId" | "label">;
  readonly deadline: DeadlineState;
  /** 通報内容のコピーの監査が、最後の通報の記録より後にある（通報内容を開いて記録がない場合の入口）。 */
  readonly copiedWithoutRecord: boolean;
  /** 現在のスナップショットの手続きのうち、procedureId があるもの。 */
  readonly procedures: readonly SnapshotProcedureLite[];
  /** 種別ごとの最新の手続きの記録（無ければ undefined）。 */
  readonly procedureRecords: Readonly<Partial<Record<ProcedureRecordKind, ProcedureRecordLite>>>;
  readonly can: { readonly update: boolean; readonly confirm: boolean; readonly record: boolean };
};

const PERMIT_PROCEDURE = /^(flight-permission-|flight-approval-)/;
/** 緊急用務空域は申請する手続きでない（指定中は飛行できない）。 */
const NOT_AN_APPLICATION = new Set(["flight-permission-emergency-airspace"]);
const POLICE_PROCEDURE_ID = "small-drone-law-consent-notice";

export const planHref = (planId: string, id: NextActionId): string => {
  const base = `/ops/plans/${planId}`;
  switch (id) {
    case "request_confirmation":
      return `${base}#request-confirmation`;
    case "confirm":
      return `${base}#confirm`;
    case "fix_returned":
      return `${base}/edit`;
    case "rejudge":
      return `${base}#rejudge`;
    case "report":
    case "consider_report":
      return `${base}/report`;
    case "record_result":
      return `${base}/report#record`;
    case "change_report":
      return `${base}/report?kind=change#record`;
    case "cancel_report":
      return `${base}/report?kind=cancel#record`;
    case "apply_permit":
    case "notify_police":
      return `${base}#procedures`;
  }
};

/** 手続きのうち、期限の日付が最も早いもの（日付が無ければ最初のもの）。期限の文言と日付はスナップショットのものをそのまま使う。 */
const pickEarliest = (list: readonly SnapshotProcedureLite[]): SnapshotProcedureLite | null => {
  if (list.length === 0) return null;
  const dated = list.filter((p) => p.deadlineDate !== null).sort((a, b) => (a.deadlineDate! < b.deadlineDate! ? -1 : 1));
  return dated[0] ?? list[0]!;
};

/**
 * 計画の「次にやること」を導出する。tier（1 通報の漏れ（飛行開始後）＞ 2 通報・許可・警察の目安または期限の超過 ＞
 * 3 通報・許可・警察の未了 ＞ 4 確認・再判定・変更 ＞ 5 推奨）の順、同じなら飛行開始までの時間が短い順。
 */
export const planNextActions = (i: NextActionsInput): NextAction[] => {
  const out: NextAction[] = [];
  const voided = i.planState === "voided";
  const startsInMinutes = Math.floor((i.plannedStartAt.getTime() - i.now.getTime()) / 60_000);
  const add = (id: NextActionId, tier: NextActionTier, reason: string, canAct: boolean, dueLabel: string | null = null): void => {
    out.push({ id, label: NEXT_ACTION_LABEL[id], reason, href: planHref(i.planId, id), tier, dueLabel, canAct, startsInMinutes });
  };

  // ---- 確認・再判定 ----
  if (!voided) {
    if (i.planState === "draft") add("request_confirmation", 4, "計画は下書きです。運航管理者に確認を依頼します", i.can.update);
    if (i.planState === "pending" || i.planState === "returned_stale" || i.planState === "approved_stale") {
      add(
        "confirm",
        4,
        i.planState === "pending" ? "確認待ちです" : i.planState === "returned_stale" ? "修正済みです。再確認が必要です" : "前の版への確認です。再確認が必要です",
        i.can.confirm,
      );
    }
    if (i.planState === "returned") add("fix_returned", 4, "運航管理者に差し戻されました。理由を確かめて計画を直します", i.can.update);
    if (i.judgementStale) add("rejudge", 4, "判定が古くなっています", i.can.update);
  }

  // ---- 通報 ----
  const needsReport = i.requirementKind === "required" || i.requirementKind === "confirm";
  const deadlineTier = (i.deadline.tier ?? 3) as NextActionTier;
  const dueLabel = i.deadline.message
    ? [i.deadline.message, i.deadline.guideNote].filter((x): x is string => !!x).join(" ")
    : null;
  switch (i.status.code) {
    case "cancel_needed":
      add("cancel_report", 3, i.status.label, i.can.record);
      break;
    case "change_review":
      add("change_report", 4, i.status.label, i.can.record);
      break;
    case "unknown":
      // 登録されたか分からない通報がある（二重通報を避けるため、DIPS の画面で確かめて結果を記録する）
      if (i.requirementKind !== "not_applicable_model") {
        add("record_result", needsReport ? deadlineTier : 3, i.status.label, i.can.record, needsReport ? dueLabel : null);
      }
      break;
    case "failed":
    case "no_record":
    case "cancelled":
      if (!voided) {
        if (needsReport) {
          if (i.copiedWithoutRecord && i.status.code !== "failed") {
            add("record_result", deadlineTier, "通報内容を開きましたが、記録がありません。DIPS で通報したら結果を記録します", i.can.record, dueLabel);
          } else {
            add("report", deadlineTier, `${i.requirementLabel}。${i.status.label}`, i.can.record, dueLabel);
          }
        } else if (i.requirementKind === "recommended") {
          add("consider_report", 5, `${i.requirementLabel}。${i.status.label}`, i.can.record, i.deadline.message);
        }
      }
      break;
    case "sending":
    case "reported":
    case "not_applicable_model":
      break;
  }

  // ---- 許可・承認の申請、警察への通報（利用者の申告の記録） ----
  if (!voided) {
    const today = jstDate(i.now);
    const procedureAction = (
      kind: ProcedureRecordKind,
      id: "apply_permit" | "notify_police",
      list: readonly SnapshotProcedureLite[],
      reason: string,
    ): void => {
      if (list.length === 0) return;
      const rec = i.procedureRecords[kind];
      const valid = rec !== undefined && rec.action === "done" && rec.snapshotId === i.currentSnapshotId;
      if (valid) return;
      const stale = rec !== undefined && rec.action === "done";
      const pick = pickEarliest(list)!;
      const overdue = pick.deadlineDate !== null && pick.deadlineDate < today;
      add(id, overdue ? 2 : 3, stale ? PROCEDURE_RECORD_STALE_LABEL : reason, i.can.record, pick.deadlineLabel);
    };
    procedureAction(
      "dips_permit",
      "apply_permit",
      i.procedures.filter((p) => PERMIT_PROCEDURE.test(p.procedureId) && !NOT_AN_APPLICATION.has(p.procedureId)),
      "判定の結論に、DIPS の許可・承認の手続きがあります。申請したら記録します",
    );
    procedureAction(
      "small_drone_law",
      "notify_police",
      i.procedures.filter((p) => p.procedureId === POLICE_PROCEDURE_ID),
      "判定の結論に、飛行禁止法の同意・通報の手続きがあります。済ませたら記録します",
    );
  }

  // 同じ計画の中では飛行開始までの時間が同じなので、tier の順（同じ tier は上の導出の順）
  return out.sort(compareNextActions);
};
