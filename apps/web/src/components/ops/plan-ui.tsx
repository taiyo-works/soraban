import type React from "react";
import type { FingerprintChange, ReportStatusCode, ReportStatusResult } from "@soraban/dips";
import { REPORT_STATUS_MARK, REPORT_STATUS_SHORT_LABEL, NEXT_ACTIONS_EMPTY_LABEL } from "@soraban/dips";
import type { ItemVerdict, ReportRequirement } from "@soraban/regulations";
import { REPORT_FIXED_NOTE } from "@soraban/regulations";
import type { DeadlineState, NextAction } from "@/server/ops/report-logic";
import { VERDICT_LABEL, unknownCountLabel } from "@/lib/verdict-display";
import { STALE_JUDGEMENT_LABEL, type PlanState } from "@/server/ops/plan-logic";
import { VerdictTag } from "@/components/ui/sb-parts";
import { cx } from "@/components/ui/cx";
import { Icon, type IconName } from "@/components/ui/icons";
import { JUDGE_LINE_PREFIX, JUDGE_UNREADABLE, REPORT_NOTE_SHORT, SOURCE_STALE_LABEL, VOIDED_NO_RECORD_LABEL, VOIDED_NO_RECORD_NOTE, judgeLineModel, splitNextActions } from "@/lib/plan-main";
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

// 札：文字は常に墨（面の上でも 4.5:1 以上）。意味は記号と文字が担い、形（実線・破線・反転）で補う。判定の色（赤・琥珀・緑）は判定の印だけに使う。
const CHIP_BOX: Record<Tone, string> = {
  neutral: "border border-sb-rule bg-sb-base text-sb-ink",
  brand: "border border-transparent bg-sb-inverse text-sb-inverse-fg font-bold",
  green: "border-[1.5px] border-sb-ink bg-sb-base text-sb-ink font-bold",
  amber: "border-[1.5px] border-dashed border-sb-ink bg-sb-st-warn-face text-sb-ink font-bold",
  red: "border-[1.5px] border-sb-v-no-fg bg-sb-base text-sb-v-no-fg font-bold",
  mute: "border border-dashed border-sb-edge bg-sb-sunken text-sb-ink-3",
};
const CHIP_GLYPH: Record<Tone, string> = {
  neutral: "text-current",
  brand: "text-current",
  green: "text-current",
  amber: "text-current",
  red: "text-current",
  mute: "text-current",
};

type ChipProps = { readonly tone: Tone; readonly glyph: string; readonly children: React.ReactNode } & Record<`data-${string}`, string | undefined>;

/** 記号＋文字の札。折り返さず、行の中では 1 つの塊として動く。 */
function Chip({ tone, glyph, children, ...rest }: ChipProps) {
  const attrs = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
  return (
    <span
      {...attrs}
      className={`inline-flex min-h-7 max-w-full items-start gap-1.5 break-words rounded-sb-pill px-3 py-0.5 text-sm font-medium leading-5 ${CHIP_BOX[tone]}`}
    >
      <span aria-hidden className={`w-3 text-center sb-num text-sm font-bold leading-none ${CHIP_GLYPH[tone]}`}>
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

/**
 * 通報の要否（根拠つき）。固定の文言（そらばんは DIPS に送信しません…）を添える。
 * compact（通報の主画面の状況カード）：見出しの 1 行と固定の文言の短い版だけを出し、根拠と全文は 1 回で開く（DOM には残る）。
 * voidedNoRecord：中止した計画で通報の記録が無いときは「中止（通報の記録はありません）」と事実を示す（要否は出さない）。
 */
export function ReportBox({
  report,
  compact = false,
  voidedNoRecord = false,
  heading,
  part,
}: {
  readonly report: ReportRequirement;
  readonly compact?: boolean;
  /** compact のとき、見出しだけ（head）か、根拠・固定の文言だけ（body）を出す。主操作を最初の画面に入れるため、カードの中で分けて置く。 */
  readonly part?: "head" | "body";
  /** 見出しの文言（通報の状況に応じた言い方。無ければ通報の要否の見出し）。 */
  readonly heading?: string;
  readonly voidedNoRecord?: boolean;
}) {
  if (compact) {
    const tone: Tone = voidedNoRecord ? "mute" : REPORT_TONE[report.kind];
    const glyph = voidedNoRecord ? "×" : REPORT_GLYPH[report.kind];
    const head = part !== "body";
    const body = part !== "head";
    return (
      <div className="flex flex-col gap-2" {...(head ? { "data-testid": "plan-report-box" } : { "data-testid": "plan-report-box-body" })} data-kind={report.kind}>
        {head ? (
        <p className="flex items-start gap-3 text-base font-bold leading-relaxed text-sb-ink">
          <span aria-hidden data-note="" className={`mt-px flex h-7 w-7 shrink-0 items-center justify-center rounded-sb-pill sb-num text-sm font-bold ${CHIP_BOX[tone]} ${CHIP_GLYPH[tone]}`}>
            {glyph}
          </span>
          <span className="pt-0.5" data-testid="plan-report-label">{voidedNoRecord ? VOIDED_NO_RECORD_LABEL : (heading ?? report.label)}</span>
        </p>
        ) : null}
        {!body ? null : voidedNoRecord ? (
          <>
            <p data-note="" className="pl-10 text-sm leading-relaxed text-sb-ink-2" data-testid="plan-report-note-short">
              {REPORT_NOTE_SHORT}
            </p>
            <p className="pl-10 font-medium text-sb-ink" data-testid="plan-voided-no-record-note">
              {VOIDED_NO_RECORD_NOTE}
            </p>
          </>
        ) : (
          <>
            {report.reasons.length > 0 ? (
              <details className="pl-10">
                <summary className="inline-flex min-h-12 cursor-pointer select-none items-center text-sm text-sb-ink underline-offset-2 hover:underline">
                  根拠を見る（{report.reasons.length} 件）
                </summary>
                <ul className="flex list-disc flex-col gap-1 pl-5 pb-2 text-sb-ink-2" data-testid="plan-report-reasons">
                  {report.reasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </details>
            ) : null}
            {report.exceptionNote ? (
              <p data-note="" className="opx-note ml-10" data-testid="plan-report-exception">
                {report.exceptionNote}
              </p>
            ) : null}
            <p data-note="" className="pl-10 text-sm leading-relaxed text-sb-ink-2" data-testid="plan-report-note-short">
              {REPORT_NOTE_SHORT}
            </p>
            <details className="pl-10">
              <summary className="inline-flex min-h-12 cursor-pointer select-none items-center text-sm text-sb-ink underline-offset-2 hover:underline">
                固定の文言の全文
              </summary>
              <div className="pb-2">
                <DipsNotice text={report.note} />
              </div>
            </details>
          </>
        )}
      </div>
    );
  }
  return (
    <div
      className="flex flex-col gap-3 rounded-sb-l bg-sb-base px-4 py-4 opx-shadow"
      data-testid="plan-report-box"
      data-kind={report.kind}
    >
      <p className="flex items-start gap-3 text-base font-bold leading-relaxed text-sb-ink">
        <span
          aria-hidden
          data-note=""
          className={`mt-px flex h-7 w-7 shrink-0 items-center justify-center rounded-sb-pill sb-num text-sm font-bold ${CHIP_BOX[REPORT_TONE[report.kind]]} ${CHIP_GLYPH[REPORT_TONE[report.kind]]}`}
        >
          {REPORT_GLYPH[report.kind]}
        </span>
        <span className="pt-0.5" data-testid="plan-report-label">{report.label}</span>
      </p>
      {report.reasons.length > 0 ? (
        <ul className="flex list-disc flex-col gap-1 pl-12 text-sb-ink-2" data-testid="plan-report-reasons">
          {report.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      ) : null}
      {report.exceptionNote ? (
        <p data-note="" className="opx-note ml-10" data-testid="plan-report-exception">
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
    <p data-note="" className="opx-note" data-testid="plan-dips-notice">
      {text}
    </p>
  );
}

/** 判定の結論の札（4 段の言葉＋形。判定不能の件数があれば添える）。判定の印は PR ② の部品（形と言葉を併用）。 */
export function VerdictBadge({ level, unknownCount, bare }: { readonly level: string; readonly unknownCount?: number; readonly bare?: boolean }) {
  const label = VERDICT_LABEL[level as ItemVerdict] ?? level;
  const known = level in VERDICT_LABEL;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium text-sb-ink" {...(bare ? {} : { "data-testid": "plan-verdict", "data-level": level })}>
      {known ? (
        <VerdictTag level={level as ItemVerdict}>{label}</VerdictTag>
      ) : (
        <span>{label}</span>
      )}
      {unknownCount ? <span className="text-sm font-normal text-sb-ink-2">（{unknownCountLabel(unknownCount)}）</span> : null}
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

/** 「出典が古い」の札（出典・確認日が 90 日超の項目がある。判定の古さ（判定が古い）とは別）。 */
export function SourceStaleBadge() {
  return (
    <Chip tone="amber" glyph="!" data-testid="plan-source-stale">
      {SOURCE_STALE_LABEL}
    </Chip>
  );
}

/**
 * 通報の主画面の「ほかの要点」：判定の 1 行（補助。常に出す）と確認の 1 行。押す面は 48px 以上。
 * 判定の行は必ず「判定（補助）：」で始め、通報の要否と混ざらないようにする。結論の段が読めないときは要として扱う。
 */
export function PlanDigest({
  planId,
  verdictLevel,
  unknownCount,
  state,
  stateLabel,
  stale,
  sourcesStale,
}: {
  readonly planId: string;
  readonly verdictLevel: string | null | undefined;
  readonly unknownCount: number | null | undefined;
  readonly state: PlanState;
  readonly stateLabel: string;
  readonly stale: boolean;
  readonly sourcesStale: boolean;
}) {
  const row = "flex min-h-12 items-center justify-between gap-x-3 border-b border-sb-rule px-4 py-2 last:border-b-0 hover:bg-sb-hover";
  const m = judgeLineModel({ level: verdictLevel, unknownCount, stale, sourcesStale });
  return (
    <nav aria-label="ほかの要点" className="overflow-hidden rounded-sb-l bg-sb-base opx-shadow" data-testid="plan-digest">
      <a href={`/ops/plans/${planId}/judgement`} className={row} data-testid="plan-judge-link">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1" data-testid="plan-judge-line" data-wording-scope="judgement">
          <span className="text-sm text-sb-ink-2">{JUDGE_LINE_PREFIX}</span>
          {m.kind === "ok" ? <VerdictBadge level={m.level} unknownCount={m.unknownCount} bare /> : <span className="text-sm font-bold text-sb-ink">{JUDGE_UNREADABLE}</span>}
          {m.stale ? <StaleBadge bare /> : null}
          {m.sourcesStale ? <SourceStaleBadge /> : null}
        </span>
        <span className="shrink-0 whitespace-nowrap text-sm font-bold text-sb-ink">判定を見る →</span>
      </a>
      <a href={`/ops/plans/${planId}/overview#sec-confirm`} className={row} data-testid="plan-confirm-link">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm text-sb-ink-2">確認：</span>
          <PlanStateBadge state={state} label={stateLabel} bare />
        </span>
        <span className="shrink-0 whitespace-nowrap text-sm font-bold text-sb-ink">計画の確認へ →</span>
      </a>
    </nav>
  );
}

/** 飛行記録の「判定の根拠が紐づいていません」。特定飛行の形態があるのに計画がない記録を、一覧・詳細で見落とさないための表示（記号＋文字＋左の太い線）。 */
export function JudgementMissing({ label, testId }: { readonly label: string; readonly testId?: string }) {
  return (
    <span
      {...(testId ? { "data-testid": testId } : {})}
      className="inline-flex items-center gap-2 rounded-sb-m border-[1.5px] border-dashed border-sb-ink bg-sb-base px-3 py-2 text-sm font-bold leading-snug text-sb-ink"
    >
      <span aria-hidden className="sb-num text-sm font-bold text-sb-ink">
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

// 次にやること：段（最優先〜推奨）は「印＋段の名前」で示す。色を使うのは最優先（危険）と期限超過（注意）の 2 段だけで、
// 札・左の太い線・行の塗りは使わない。残りの段は墨色の印と補助の文字（色がなくても段の名前で区別できる）。
const TIER_MARK: Readonly<Record<number, { readonly icon: IconName; readonly tone: string; readonly text: string }>> = {
  1: { icon: "alert", tone: "text-sb-ink", text: "text-sb-ink font-bold" },
  2: { icon: "clock", tone: "text-sb-ink", text: "text-sb-ink font-bold" },
  3: { icon: "dot", tone: "text-sb-ink-2", text: "text-sb-ink-3" },
  4: { icon: "info", tone: "text-sb-ink-3", text: "text-sb-ink-3" },
  5: { icon: "chevron-right", tone: "text-sb-ink-3", text: "text-sb-ink-3" },
};
const TIER_TEXT: Readonly<Record<number, string>> = { 1: "最優先", 2: "期限超過", 3: "未了", 4: "確認・変更", 5: "推奨" };

/** 日付（2027-01-05）がハイフンの位置で折り返されないよう、日付だけ 1 かたまりにする（文字は変えない）。 */
function KeepDates({ text }: { readonly text: string }) {
  return (
    <>
      {text.split(/(\d{4}-\d{2}-\d{2})/).map((part, i) =>
        i % 2 === 1 ? (
          <span key={i} className="whitespace-nowrap">
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </>
  );
}

/**
 * 次にやることの 1 行（動詞で始まる）。押すと該当の画面へ移る。canAct が偽なら、押せないことを文で示す。
 * flush：左右の余白を取らない（ホームの一覧。ほかの一覧と文字の左端をそろえる）。
 */
export function NextActionItem({
  action,
  testId = "next-action",
  tall = false,
  flush = false,
}: {
  readonly action: NextAction;
  readonly testId?: string;
  /** 屋外で押しやすい高さ（56px）にする（ホーム）。 */
  readonly tall?: boolean;
  readonly flush?: boolean;
}) {
  const mark = TIER_MARK[action.tier] ?? TIER_MARK[5]!;
  const body = (
    <>
      <Icon name={mark.icon} size={18} className={cx("mt-1 shrink-0", mark.tone)} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-[1rem] font-bold leading-snug text-sb-ink" data-testid={`${testId}-label`}>
            {action.label}
          </span>
          <span className={cx("whitespace-nowrap text-aux", mark.text)}>{TIER_TEXT[action.tier]}</span>
        </span>
        <span className="text-table text-sb-ink-2 [text-wrap:pretty]">
          <KeepDates text={action.reason} />
        </span>
        {action.dueLabel ? (
          <span className="text-table text-sb-ink [text-wrap:pretty]" data-testid={`${testId}-due`}>
            <KeepDates text={action.dueLabel} />
          </span>
        ) : null}
        {!action.canAct ? (
          <span className="text-table text-sb-ink-3" data-testid={`${testId}-cannot`}>
            {action.id === "register_permit" ? "運航管理者に依頼してください（許可・承認の登録は運航管理者だけが行えます）。" : "この操作は運航管理者または計画の操縦者本人が行います。"}
          </span>
        ) : null}
      </span>
      {action.canAct ? <Icon name="chevron-right" size={18} className="mt-1 shrink-0 self-start text-sb-ink-3" /> : null}
    </>
  );
  const box = cx("flex items-start gap-3 py-3 transition-colors duration-[var(--dur)] [line-break:strict] [word-break:auto-phrase]", tall ? "min-h-14" : "min-h-12", flush ? "" : "px-3");
  return action.canAct ? (
    <a href={action.href} className={cx(box, "hover:bg-sb-hover")} data-testid={`${testId}-link`} data-action-id={action.id}>
      {body}
    </a>
  ) : (
    <div className={box} data-testid={`${testId}-link`} data-action-id={action.id}>
      {body}
    </div>
  );
}

/** 計画の詳細の「次にやること」。保存した状態ではなく、毎回導出した一覧。 */
export function NextActionsList({ actions, limit }: { readonly actions: readonly NextAction[]; readonly limit?: number }) {
  const { shown, rest } = limit === undefined ? { shown: actions, rest: [] as readonly NextAction[] } : splitNextActions(actions, limit);
  const li = (a: NextAction) => (
    <li key={a.id} data-testid="next-action" data-action-id={a.id} data-tier={String(a.tier)}>
      <NextActionItem action={a} />
    </li>
  );
  return (
    <section aria-label="次にやること" className="flex flex-col gap-2" data-testid="next-actions">
      <h2 className="opx-eyebrow">
        次にやること
        {actions.length > 0 ? <span className="ml-2 sb-num tnum normal-case tracking-normal">{actions.length} 件</span> : null}
      </h2>
      {actions.length === 0 ? (
        <p className="rounded-sb-l bg-sb-base px-4 py-4 text-sm text-sb-ink-2 opx-shadow" data-testid="next-actions-empty">
          {NEXT_ACTIONS_EMPTY_LABEL}
        </p>
      ) : (
        <div className="overflow-hidden rounded-sb-l bg-sb-base opx-shadow">
          <ul className="flex flex-col divide-y divide-sb-rule">{shown.map(li)}</ul>
          {rest.length > 0 ? (
            <details className="border-t border-sb-rule" data-testid="next-actions-more">
              <summary className="flex min-h-12 cursor-pointer select-none items-center px-4 text-sm font-bold text-sb-ink">ほか {rest.length} 件を見る</summary>
              <ul className="flex flex-col divide-y divide-sb-rule border-t border-sb-rule">{rest.map(li)}</ul>
            </details>
          ) : null}
        </div>
      )}
    </section>
  );
}

const DEADLINE_BAR: Readonly<Record<DeadlineState["state"], string>> = {
  none: "bg-sb-base opx-shadow",
  upcoming: "bg-sb-base opx-shadow",
  past_guide: "border-[1.5px] border-dashed border-sb-ink bg-sb-base",
  overdue_started: "border-[1.5px] border-sb-v-no-fg bg-sb-surface",
  recommended_open: "bg-sb-base opx-shadow",
};
const DEADLINE_TONE: Readonly<Record<DeadlineState["state"], Tone>> = {
  none: "neutral",
  upcoming: "brand",
  past_guide: "amber",
  overdue_started: "red",
  recommended_open: "green",
};
const DEADLINE_GLYPH: Readonly<Record<DeadlineState["state"], string>> = {
  none: "－",
  upcoming: "○",
  past_guide: "!",
  overdue_started: "!!",
  recommended_open: "○",
};

/**
 * 期限の状態（社内の目安。法定の期限ではない）。通報の記録がない要・要確認のときだけ出る。
 * 上から「いまの状態（記号の札＋文）」「社内の目安の時刻」「注記」の順。飛行開始後は最上位の警告（赤の線と背景＋「!!」）。
 * 罰則の文言は注記の側に小さく置く（目立たせすぎない。※要確認が付く）。
 */
export function DeadlineBox({ deadline, compact = false }: { readonly deadline: DeadlineState; readonly compact?: boolean }) {
  if (deadline.state === "none" || !deadline.message) return null;
  const started = deadline.state === "overdue_started";
  if (compact) {
    return (
      <div className={`flex flex-col gap-1 rounded-sb-m px-3 py-3 ${DEADLINE_BAR[deadline.state]}`} data-testid="plan-report-deadline" data-state={deadline.state}>
        <p className="flex items-start gap-3 font-bold text-sb-ink">
          <span aria-hidden data-note="" className={`mt-px flex h-7 w-8 shrink-0 items-center justify-center rounded-sb-pill sb-num text-sm font-bold leading-none ${CHIP_BOX[DEADLINE_TONE[deadline.state]]}`}>
            {DEADLINE_GLYPH[deadline.state]}
          </span>
          <span className="pt-0.5" data-testid="plan-report-deadline-message">{deadline.message}</span>
        </p>
        {deadline.guideAtJst ? (
          <p className="pl-11 text-sb-ink-2" data-testid="plan-report-guide-at">
            社内の目安の時刻：<span className="sb-num tnum text-sb-ink">{deadline.guideAtJst}</span>（日本時間）
          </p>
        ) : null}
        <details className="pl-11" {...(started ? { open: true } : {})}>
          <summary className="inline-flex min-h-12 cursor-pointer select-none items-center text-sm text-sb-ink underline-offset-2 hover:underline">期限の注記</summary>
          <div className="flex flex-col gap-1.5 pb-2">
            {deadline.guideNote ? (
              <p data-note="" className="text-sm leading-relaxed text-sb-ink-2" data-testid="plan-report-guide-note">
                {deadline.guideNote}
              </p>
            ) : null}
            {deadline.penaltyNote ? (
              <p data-note="" className="text-sm leading-relaxed text-sb-ink-2" data-testid="plan-report-penalty">
                {deadline.penaltyNote}
              </p>
            ) : null}
            {deadline.outageNote ? <p data-note="" className="text-sm leading-relaxed text-sb-ink-2">{deadline.outageNote}</p> : null}
            <p data-note="" className="text-sm leading-relaxed text-sb-ink-2">{deadline.smallDroneLawNote}</p>
          </div>
        </details>
      </div>
    );
  }
  return (
    <div
      className={`flex flex-col gap-3 rounded-sb-l px-4 py-4 ${DEADLINE_BAR[deadline.state]}`}
      data-testid="plan-report-deadline"
      data-state={deadline.state}
    >
      <p className="flex items-start gap-3 font-bold text-sb-ink">
        <span
          aria-hidden
          data-note=""
          className={`mt-px flex h-7 w-8 shrink-0 items-center justify-center rounded-sb-pill sb-num text-sm font-bold leading-none ${CHIP_BOX[DEADLINE_TONE[deadline.state]]}`}
        >
          {DEADLINE_GLYPH[deadline.state]}
        </span>
        <span className={`pt-0.5 ${started ? "text-base" : ""}`} data-testid="plan-report-deadline-message">{deadline.message}</span>
      </p>
      {deadline.guideAtJst ? (
        <p className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 pl-11 text-sb-ink-2" data-testid="plan-report-guide-at">
          社内の目安の時刻：<span className="sb-num tnum text-sb-ink">{deadline.guideAtJst}</span>（日本時間）
        </p>
      ) : null}
      {deadline.guideNote ? (
        <p data-note="" className="pl-11 text-sm leading-relaxed text-sb-ink-2" data-testid="plan-report-guide-note">
          {deadline.guideNote}
        </p>
      ) : null}
      <div className="flex flex-col gap-1.5 border-t border-sb-rule pl-11 pt-2.5">
        {deadline.penaltyNote ? (
          <p data-note="" className="text-sm leading-relaxed text-sb-ink-2" data-testid="plan-report-penalty">
            {deadline.penaltyNote}
          </p>
        ) : null}
        {deadline.outageNote ? <p data-note="" className="text-sm leading-relaxed text-sb-ink-2">{deadline.outageNote}</p> : null}
        <p data-note="" className="text-sm leading-relaxed text-sb-ink-2">{deadline.smallDroneLawNote}</p>
      </div>
    </div>
  );
}

/** 通報の状況（導出）と変更点。記録の有無から毎回導出した状況で、記録が無いうちは「通報済み」と出ない。 */
export function ReportStatusBox({ status, changes }: { readonly status: ReportStatusResult; readonly changes: readonly FingerprintChange[] }) {
  const tone = STATUS_TONE[status.code];
  return (
    <div className="flex flex-col gap-2" data-testid="plan-report-status" data-code={status.code}>
      <p className="flex items-start gap-3 font-medium text-sb-ink">
        <span
          aria-hidden
          data-note=""
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-sb-pill sb-num text-sm font-bold ${CHIP_BOX[tone]} ${CHIP_GLYPH[tone]}`}
        >
          {status.mark}
        </span>
        <span className="pt-0.5" data-testid="plan-report-status-label">{status.label}</span>
      </p>
      {status.detail && status.code !== "reported" ? <p data-note="" className="pl-10 sb-num text-sm tnum text-sb-ink-2">{status.detail}</p> : null}
      {changes.length > 0 ? (
        <div className="opx-note opx-note-lg ml-10 flex flex-col gap-1" data-testid="plan-report-changes">
          <p data-note="" className="text-sm font-medium text-sb-ink">通報時から変わった点</p>
          <ul className="flex flex-col gap-0.5 text-sb-ink-2">
            {changes.map((c) => (
              <li key={c.key} data-testid="plan-report-change-row" data-key={c.key}>
                {c.label}：<span className="sb-num tnum">{c.before}</span> → <span className="sb-num tnum">{c.after}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
