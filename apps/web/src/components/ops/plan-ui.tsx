import type React from "react";
import type { FingerprintChange, ReportStatusCode, ReportStatusResult } from "@soraban/dips";
import { REPORT_STATUS_MARK, REPORT_STATUS_SHORT_LABEL, NEXT_ACTIONS_EMPTY_LABEL } from "@soraban/dips";
import type { ItemVerdict, ReportRequirement } from "@soraban/regulations";
import { REPORT_FIXED_NOTE } from "@soraban/regulations";
import type { DeadlineState, NextAction } from "@/server/ops/report-logic";
import { VERDICT_LABEL, unknownCountLabel } from "@/lib/verdict-display";
import { STALE_JUDGEMENT_LABEL, type PlanState } from "@/server/ops/plan-logic";
import { VerdictMark } from "../verdict-mark";
import { type Tone } from "./ui";

// 飛行計画の画面で共通に使う小さな部品（サーバー・クライアントのどちらからも使える）。
// 状態・通報の要否・判定の結論は、色だけで区別せず、記号と文字を必ず添える（Sprint 12a 契約 20）。

const STATE_TONE: Readonly<Record<PlanState, Tone>> = {
  draft: "mute",
  pending: "amber",
  approved: "green",
  approved_stale: "amber",
  returned: "red",
  returned_stale: "amber",
  voided: "mute",
};

const STATE_GLYPH: Readonly<Record<PlanState, string>> = {
  draft: "✎",
  pending: "…",
  approved: "✓",
  approved_stale: "!",
  returned: "↩",
  returned_stale: "…",
  voided: "×",
};

// 札：文字は常に ink（背景の淡い色の上でも 4.5:1 以上）。色は枠・背景・記号だけに使い、意味は記号と文字が担う。
const CHIP_BOX: Record<Tone, string> = {
  neutral: "border-rule bg-paper",
  brand: "border-brand-500 bg-brand-50",
  green: "border-signal-green/60 bg-signal-green-soft",
  amber: "border-signal-amber/70 bg-signal-amber-soft",
  red: "border-signal-red/60 bg-signal-red-soft",
  mute: "border-rule bg-paper-soft",
};
const CHIP_GLYPH: Record<Tone, string> = {
  neutral: "text-ink-soft",
  brand: "text-brand-700",
  green: "text-signal-green",
  amber: "text-signal-amber",
  red: "text-signal-red",
  mute: "text-ink-soft",
};

type ChipProps = { readonly tone: Tone; readonly glyph: string; readonly children: React.ReactNode } & Record<`data-${string}`, string | undefined>;

/** 記号＋文字の札。折り返さず、行の中では 1 つの塊として動く。 */
function Chip({ tone, glyph, children, ...rest }: ChipProps) {
  const attrs = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
  return (
    <span
      {...attrs}
      className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-sharp border px-2 py-0.5 text-xs font-medium leading-5 text-ink ${CHIP_BOX[tone]}`}
    >
      <span aria-hidden className={`w-3 text-center font-mono text-[13px] font-bold leading-none ${CHIP_GLYPH[tone]}`}>
        {glyph}
      </span>
      {children}
    </span>
  );
}

/** 導出の状態の札。label は PlanDto.stateLabel（「確認済み（自己確認）」を含む）。bare は詳細の要点など、testid を重ねたくない場所用。 */
export function PlanStateBadge({ state, label, bare }: { readonly state: PlanState; readonly label: string; readonly bare?: boolean }) {
  return (
    <Chip tone={STATE_TONE[state]} glyph={STATE_GLYPH[state]} data-testid={bare ? undefined : "plan-state"} data-state={bare ? undefined : state}>
      {label}
    </Chip>
  );
}

const REPORT_TONE: Readonly<Record<ReportRequirement["kind"], Tone>> = {
  confirm: "amber",
  not_applicable_model: "neutral",
  required: "brand",
  recommended: "green",
};

const REPORT_GLYPH: Readonly<Record<ReportRequirement["kind"], string>> = {
  confirm: "?",
  not_applicable_model: "－",
  required: "●",
  recommended: "○",
};

/** 通報の要否の札（一覧用）。 */
export function ReportBadge({ report, bare }: { readonly report: ReportRequirement; readonly bare?: boolean }) {
  return (
    <Chip tone={REPORT_TONE[report.kind]} glyph={REPORT_GLYPH[report.kind]} data-testid={bare ? undefined : "plan-report"} data-kind={bare ? undefined : report.kind}>
      {report.label}
    </Chip>
  );
}

const REPORT_BAR: Record<ReportRequirement["kind"], string> = {
  confirm: "border-l-signal-amber",
  not_applicable_model: "border-l-rule",
  required: "border-l-brand-700",
  recommended: "border-l-signal-green",
};

/** 通報の要否（根拠つき）。固定の文言（そらばんは DIPS に送信しません…）を必ず添える。 */
export function ReportBox({ report }: { readonly report: ReportRequirement }) {
  return (
    <div
      className={`flex flex-col gap-3 rounded-sharp border border-l-4 border-rule bg-paper px-3 py-3 sm:px-4 ${REPORT_BAR[report.kind]}`}
      data-testid="plan-report-box"
      data-kind={report.kind}
    >
      <p className="flex items-start gap-3 text-base font-medium leading-snug text-ink">
        <span
          aria-hidden
          className={`mt-px flex h-7 w-7 shrink-0 items-center justify-center rounded-sharp border font-mono text-sm font-bold ${CHIP_BOX[REPORT_TONE[report.kind]]} ${CHIP_GLYPH[REPORT_TONE[report.kind]]}`}
        >
          {REPORT_GLYPH[report.kind]}
        </span>
        <span className="pt-0.5" data-testid="plan-report-label">{report.label}</span>
      </p>
      {report.reasons.length > 0 ? (
        <ul className="flex list-disc flex-col gap-1 pl-12 text-sm leading-relaxed text-ink-soft" data-testid="plan-report-reasons">
          {report.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      ) : null}
      {report.exceptionNote ? (
        <p className="ml-10 border-l-2 border-signal-amber pl-3 text-xs leading-relaxed text-ink-soft" data-testid="plan-report-exception">
          {report.exceptionNote}
        </p>
      ) : null}
      <div className="ml-10">
        <DipsNotice text={report.note} />
      </div>
    </div>
  );
}

/** 「そらばんは DIPS に送信しません。…」の固定の文言。 */
export function DipsNotice({ text = REPORT_FIXED_NOTE }: { readonly text?: string }) {
  return (
    <p className="border-l-2 border-brand-700 pl-3 text-xs leading-relaxed text-ink-soft" data-testid="plan-dips-notice">
      {text}
    </p>
  );
}

/** 判定の結論の札（4 段の言葉＋記号。判定不能の件数があれば添える）。 */
export function VerdictBadge({ level, unknownCount, bare }: { readonly level: string; readonly unknownCount?: number; readonly bare?: boolean }) {
  const label = VERDICT_LABEL[level as ItemVerdict] ?? level;
  return (
    <span
      className="inline-flex flex-wrap items-center gap-x-1.5 text-sm font-medium text-ink"
      {...(bare ? {} : { "data-testid": "plan-verdict", "data-level": level })}
    >
      {level in VERDICT_LABEL ? <VerdictMark level={level as ItemVerdict} size="sm" decorative /> : null}
      <span>{label}</span>
      {unknownCount ? <span className="text-xs font-normal text-ink-soft">（{unknownCountLabel(unknownCount)}）</span> : null}
    </span>
  );
}

/** 「判定が古い」の札。理由は詳細の画面（判定の要約）に並べる（札を長くしない）。 */
export function StaleBadge({ bare }: { readonly bare?: boolean }) {
  return (
    <Chip tone="amber" glyph="!" data-testid={bare ? undefined : "plan-stale"}>
      {STALE_JUDGEMENT_LABEL}
    </Chip>
  );
}

/**
 * 詳細の先頭の要点：結論 → 通報の要否 → 確認の状況（情報の優先順位）。各行は該当の節へ飛ぶ（タップの的は 44px 以上）。
 * 詳細は下の節にあるため、ここは札だけを置く（testid は節の側にあり、ここでは重ねない）。
 */
export function PlanDigest({
  verdictLevel,
  unknownCount,
  report,
  state,
  stateLabel,
  stale,
}: {
  readonly verdictLevel: string;
  readonly unknownCount: number;
  readonly report: ReportRequirement;
  readonly state: PlanState;
  readonly stateLabel: string;
  readonly stale: boolean;
}) {
  const row = "grid min-h-11 grid-cols-[4.5rem_minmax(0,1fr)_auto] items-center gap-x-3 border-b border-rule-soft px-3 py-2 last:border-b-0 hover:bg-paper-soft";
  return (
    <nav aria-label="要点" className="rounded-sharp border border-rule bg-paper" data-testid="plan-digest">
      <a href="#sec-verdict" className={row}>
        <span className="text-xs text-ink-mute">結論</span>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <VerdictBadge level={verdictLevel} unknownCount={unknownCount} bare />
          {stale ? <StaleBadge bare /> : null}
        </span>
        <span aria-hidden className="text-ink-mute">↓</span>
      </a>
      <a href="#sec-report" className={row}>
        <span className="text-xs text-ink-mute">通報</span>
        <span className="flex flex-wrap items-center gap-1.5">
          <ReportBadge report={report} bare />
        </span>
        <span aria-hidden className="text-ink-mute">↓</span>
      </a>
      <a href="#sec-confirm" className={row}>
        <span className="text-xs text-ink-mute">確認</span>
        <span className="flex flex-wrap items-center gap-1.5">
          <PlanStateBadge state={state} label={stateLabel} bare />
        </span>
        <span aria-hidden className="text-ink-mute">↓</span>
      </a>
    </nav>
  );
}

/** 飛行記録の「判定の根拠が紐づいていません」。特定飛行の形態があるのに計画がない記録を、一覧・詳細で見落とさないための表示（記号＋文字＋左の太い線）。 */
export function JudgementMissing({ label, testId }: { readonly label: string; readonly testId?: string }) {
  return (
    <span
      {...(testId ? { "data-testid": testId } : {})}
      className="inline-flex items-center gap-2 rounded-sharp border border-l-4 border-signal-amber/70 border-l-signal-amber bg-signal-amber-soft px-2.5 py-1.5 text-sm font-medium leading-snug text-ink"
    >
      <span aria-hidden className="font-mono text-sm font-bold text-signal-amber">
        !
      </span>
      {label}
    </span>
  );
}

/** スナップショットを作った理由の表示。 */
export const SNAPSHOT_REASON_LABEL: Readonly<Record<string, string>> = {
  initial: "作成（初回の判定）",
  input_changed: "判定に関わる項目の訂正",
  data_updated: "根拠のデータ・エンジンの版の更新による再判定",
  manual: "手動の再判定",
};

// ---- Sprint 12b：通報の状況・期限・次にやること ------------------------------------------

const STATUS_TONE: Readonly<Record<ReportStatusCode, Tone>> = {
  not_applicable_model: "neutral",
  no_record: "amber",
  reported: "green",
  change_review: "amber",
  cancel_needed: "red",
  cancelled: "mute",
  unknown: "amber",
  failed: "red",
  sending: "mute",
};

/** 通報の状況（導出）の札。記録が無いうちは「通報済み」を出さない（状況の語は記録の有無から導出されたもの）。 */
export function ReportStatusBadge({ status, bare }: { readonly status: Pick<ReportStatusResult, "code">; readonly bare?: boolean }) {
  const code = status.code;
  return (
    <Chip
      tone={STATUS_TONE[code]}
      glyph={REPORT_STATUS_MARK[code]}
      data-testid={bare ? undefined : "plan-report-status-badge"}
      data-code={bare ? undefined : code}
    >
      {REPORT_STATUS_SHORT_LABEL[code]}
    </Chip>
  );
}

const TIER_TONE: Readonly<Record<number, Tone>> = { 1: "red", 2: "amber", 3: "brand", 4: "neutral", 5: "mute" };
const TIER_GLYPH: Readonly<Record<number, string>> = { 1: "!!", 2: "!", 3: "●", 4: "○", 5: "－" };
const TIER_TEXT: Readonly<Record<number, string>> = { 1: "最優先", 2: "期限超過", 3: "未了", 4: "確認・変更", 5: "推奨" };

/** 次にやることの 1 行（動詞で始まる）。押すと該当の画面へ移る。canAct が偽なら、押せないことを文で示す。 */
export function NextActionItem({ action, testId = "next-action" }: { readonly action: NextAction; readonly testId?: string }) {
  const tone = TIER_TONE[action.tier] ?? "neutral";
  const body = (
    <>
      <span aria-hidden className={`w-6 shrink-0 text-center font-mono text-[13px] font-bold ${CHIP_GLYPH[tone]}`}>
        {TIER_GLYPH[action.tier]}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-sm font-medium text-ink" data-testid={`${testId}-label`}>{action.label}</span>
          <span className="text-[11px] text-ink-mute">［{TIER_TEXT[action.tier]}］</span>
        </span>
        <span className="text-xs leading-relaxed text-ink-soft">{action.reason}</span>
        {action.dueLabel ? <span className="text-xs leading-relaxed text-ink-soft" data-testid={`${testId}-due`}>{action.dueLabel}</span> : null}
        {!action.canAct ? <span className="text-xs text-ink-mute">この操作は運航管理者または計画の操縦者本人が行います。</span> : null}
      </span>
      {action.canAct ? <span aria-hidden className="text-ink-mute">→</span> : null}
    </>
  );
  const box = `flex min-h-11 items-center gap-3 border-l-4 px-3 py-2 ${
    tone === "red" ? "border-l-signal-red" : tone === "amber" ? "border-l-signal-amber" : tone === "brand" ? "border-l-brand-700" : "border-l-rule"
  }`;
  return action.canAct ? (
    <a href={action.href} className={`${box} hover:bg-paper-soft`} data-testid={`${testId}-link`} data-action-id={action.id}>
      {body}
    </a>
  ) : (
    <div className={box} data-testid={`${testId}-link`} data-action-id={action.id}>
      {body}
    </div>
  );
}

/** 計画の詳細の「次にやること」。保存した状態ではなく、毎回導出した一覧。 */
export function NextActionsList({ actions }: { readonly actions: readonly NextAction[] }) {
  return (
    <section aria-label="次にやること" className="flex flex-col gap-2" data-testid="next-actions">
      <h2 className="eyebrow">次にやること</h2>
      {actions.length === 0 ? (
        <p className="rounded-sharp border border-rule bg-paper px-3 py-3 text-sm text-ink-mute" data-testid="next-actions-empty">
          {NEXT_ACTIONS_EMPTY_LABEL}
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-rule-soft rounded-sharp border border-rule bg-paper">
          {actions.map((a) => (
            <li key={a.id} data-testid="next-action" data-action-id={a.id} data-tier={String(a.tier)}>
              <NextActionItem action={a} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const DEADLINE_BAR: Readonly<Record<DeadlineState["state"], string>> = {
  none: "border-l-rule",
  upcoming: "border-l-brand-700",
  past_guide: "border-l-signal-amber",
  overdue_started: "border-l-signal-red",
  recommended_open: "border-l-signal-green",
};
const DEADLINE_GLYPH: Readonly<Record<DeadlineState["state"], string>> = {
  none: "－",
  upcoming: "○",
  past_guide: "!",
  overdue_started: "!!",
  recommended_open: "○",
};

/** 期限の状態（社内の目安。法定の期限ではない）。通報の記録がない要・要確認のときだけ出る。 */
export function DeadlineBox({ deadline }: { readonly deadline: DeadlineState }) {
  if (deadline.state === "none" || !deadline.message) return null;
  return (
    <div
      className={`flex flex-col gap-1.5 rounded-sharp border border-l-4 border-rule bg-paper px-3 py-2.5 text-sm ${DEADLINE_BAR[deadline.state]}`}
      data-testid="plan-report-deadline"
      data-state={deadline.state}
    >
      <p className="flex items-start gap-2 font-medium text-ink">
        <span aria-hidden className="w-5 shrink-0 text-center font-mono text-[13px] font-bold">{DEADLINE_GLYPH[deadline.state]}</span>
        <span data-testid="plan-report-deadline-message">{deadline.message}</span>
      </p>
      {deadline.guideAtJst ? (
        <p className="pl-7 text-xs leading-relaxed text-ink-soft" data-testid="plan-report-guide-at">
          社内の目安の時刻：{deadline.guideAtJst}（日本時間）
        </p>
      ) : null}
      {deadline.guideNote ? (
        <p className="pl-7 text-xs leading-relaxed text-ink-soft" data-testid="plan-report-guide-note">
          {deadline.guideNote}
        </p>
      ) : null}
      {deadline.penaltyNote ? (
        <p className="pl-7 text-xs leading-relaxed text-ink" data-testid="plan-report-penalty">
          {deadline.penaltyNote}
        </p>
      ) : null}
      {deadline.outageNote ? <p className="pl-7 text-xs leading-relaxed text-ink-mute">{deadline.outageNote}</p> : null}
      <p className="pl-7 text-xs leading-relaxed text-ink-mute">{deadline.smallDroneLawNote}</p>
    </div>
  );
}

/** 通報の状況（導出）と変更点。記録の有無から毎回導出した状況で、記録が無いうちは「通報済み」と出ない。 */
export function ReportStatusBox({ status, changes }: { readonly status: ReportStatusResult; readonly changes: readonly FingerprintChange[] }) {
  const tone = STATUS_TONE[status.code];
  return (
    <div className="flex flex-col gap-2" data-testid="plan-report-status" data-code={status.code}>
      <p className="flex items-start gap-3 text-sm font-medium leading-snug text-ink">
        <span
          aria-hidden
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-sharp border font-mono text-sm font-bold ${CHIP_BOX[tone]} ${CHIP_GLYPH[tone]}`}
        >
          {status.mark}
        </span>
        <span className="pt-0.5" data-testid="plan-report-status-label">{status.label}</span>
      </p>
      {status.detail && status.code !== "reported" ? <p className="pl-10 font-mono text-xs tnum text-ink-soft">{status.detail}</p> : null}
      {changes.length > 0 ? (
        <div className="ml-10 flex flex-col gap-1 border-l-2 border-signal-amber pl-3" data-testid="plan-report-changes">
          <p className="text-xs font-medium text-ink">通報時から変わった点</p>
          <ul className="flex flex-col gap-0.5 text-xs leading-relaxed text-ink-soft">
            {changes.map((c) => (
              <li key={c.key} data-testid="plan-report-change-row" data-key={c.key}>
                {c.label}：<span className="font-mono tnum">{c.before}</span> → <span className="font-mono tnum">{c.after}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
