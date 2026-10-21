import type React from "react";
import type { ItemVerdict, ReportRequirement } from "@soraban/regulations";
import { REPORT_FIXED_NOTE } from "@soraban/regulations";
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
