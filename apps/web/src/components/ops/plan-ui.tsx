import type { ItemVerdict, ReportRequirement } from "@soraban/regulations";
import { REPORT_FIXED_NOTE } from "@soraban/regulations";
import { VERDICT_LABEL, unknownCountLabel } from "@/lib/verdict-display";
import { STALE_JUDGEMENT_LABEL, type PlanState } from "@/server/ops/plan-logic";
import { VerdictMark } from "../verdict-mark";
import { Badge, type Tone } from "./ui";

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

/** 導出の状態の札。label は PlanDto.stateLabel（「確認済み（自己確認）」を含む）。 */
export function PlanStateBadge({ state, label }: { readonly state: PlanState; readonly label: string }) {
  return (
    <Badge tone={STATE_TONE[state]} data-testid="plan-state" data-state={state}>
      <span aria-hidden className="mr-1">
        {STATE_GLYPH[state]}
      </span>
      {label}
    </Badge>
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
export function ReportBadge({ report }: { readonly report: ReportRequirement }) {
  return (
    <Badge tone={REPORT_TONE[report.kind]} data-testid="plan-report" data-kind={report.kind}>
      <span aria-hidden className="mr-1">
        {REPORT_GLYPH[report.kind]}
      </span>
      {report.label}
    </Badge>
  );
}

/** 通報の要否（根拠つき）。固定の文言（そらばんは DIPS に送信しません…）を必ず添える。 */
export function ReportBox({ report }: { readonly report: ReportRequirement }) {
  return (
    <div
      className="flex flex-col gap-2.5 rounded-sharp border border-rule bg-paper px-3 py-3 sm:px-4"
      data-testid="plan-report-box"
      data-kind={report.kind}
    >
      <p className="flex items-start gap-2 text-base font-medium leading-snug text-ink">
        <span aria-hidden className="mt-px font-mono">
          {REPORT_GLYPH[report.kind]}
        </span>
        <span data-testid="plan-report-label">{report.label}</span>
      </p>
      {report.reasons.length > 0 ? (
        <ul className="flex list-disc flex-col gap-1 pl-5 text-sm leading-relaxed text-ink-soft" data-testid="plan-report-reasons">
          {report.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      ) : null}
      {report.exceptionNote ? (
        <p className="border-l-2 border-signal-amber pl-3 text-xs leading-relaxed text-ink-soft" data-testid="plan-report-exception">
          {report.exceptionNote}
        </p>
      ) : null}
      <DipsNotice text={report.note} />
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
export function VerdictBadge({ level, unknownCount }: { readonly level: string; readonly unknownCount?: number }) {
  const label = VERDICT_LABEL[level as ItemVerdict] ?? level;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-ink" data-testid="plan-verdict" data-level={level}>
      {level in VERDICT_LABEL ? <VerdictMark level={level as ItemVerdict} size="sm" decorative /> : null}
      <span>{label}</span>
      {unknownCount ? <span className="text-ink-mute">（{unknownCountLabel(unknownCount)}）</span> : null}
    </span>
  );
}

/** 「判定が古い」の札。理由は詳細の画面（判定の要約）に並べる（札を長くしない）。 */
export function StaleBadge() {
  return (
    <Badge tone="amber" data-testid="plan-stale">
      <span aria-hidden className="mr-1">
        !
      </span>
      {STALE_JUDGEMENT_LABEL}
    </Badge>
  );
}

/** スナップショットを作った理由の表示。 */
export const SNAPSHOT_REASON_LABEL: Readonly<Record<string, string>> = {
  initial: "作成（初回の判定）",
  input_changed: "判定に関わる項目の訂正",
  data_updated: "根拠のデータ・エンジンの版の更新による再判定",
  manual: "手動の再判定",
};
