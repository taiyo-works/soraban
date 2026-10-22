import Link from "next/link";
import type { ReactNode } from "react";
import {
  INCIDENT_FACT_NOTICE,
  INCIDENT_OFFICIAL_PROCEDURE_NOTICE,
  INCIDENT_REPORT_RECORD_NOTICE,
  INCIDENT_SAFETY_FIRST_LINES,
  incidentHref,
  type IncidentGuidanceLevel,
} from "@/lib/ops-incident";
import type { FlightIncidentsDto, IncidentDto, IncidentReportStateDto, PlanIncidentsDto } from "@/server/ops/incidents";
import { Badge, buttonOutlineBrandClass, Section } from "./ui";

// 事故・ヒヤリハット（Sprint 12e 設計 A・E）の表示の部品（サーバー・クライアントのどちらからも使える）。
// 固定の文言（G1・N1〜N7）は lib/ops-incident.ts の定数をそのまま出す（ここで書き換えない）。
// 目安・報告の状態・簡易記録の印・取消は、文字と記号で示す（色だけで区別しない）。見た目は最低限（designer が磨く）。

/** G1（最初の案内）。入力画面の最上部（入力欄より前。DOM の順でも）に置く。警告の赤一色にしない。 */
export function IncidentSafetyFirst({ large = false }: { readonly large?: boolean }) {
  return (
    <section
      aria-label="最初の案内"
      className={`flex flex-col gap-2 rounded-sharp border-2 border-l-8 border-signal-amber bg-signal-amber-soft p-4 text-ink ${large ? "text-lg leading-relaxed" : "text-sm leading-relaxed"}`}
      data-testid="incident-safety-first"
    >
      {INCIDENT_SAFETY_FIRST_LINES.map((line, i) => (
        <p key={i} className={i === 0 ? "font-bold" : ""} data-testid="incident-safety-first-line">
          {line}
        </p>
      ))}
    </section>
  );
}

/** N1（事実の記録の注意）。事故・ヒヤリハットのすべての画面に出す。 */
export function IncidentFactNotice({ large = false }: { readonly large?: boolean }) {
  return (
    <p className={`border-l-4 border-brand-700 py-0.5 pl-3 text-ink ${large ? "text-lg leading-relaxed" : "text-sm leading-relaxed"}`} data-testid="incident-fact-notice">
      {INCIDENT_FACT_NOTICE}
    </p>
  );
}

/** N2（公式の手続き）。 */
export function IncidentOfficialNotice({ large = false }: { readonly large?: boolean }) {
  return (
    <p className={`border-l-4 border-ink-soft py-0.5 pl-3 text-ink ${large ? "text-lg leading-relaxed" : "text-sm leading-relaxed"}`} data-testid="incident-official-notice">
      {INCIDENT_OFFICIAL_PROCEDURE_NOTICE}
    </p>
  );
}

/** N3（報告の記録は利用者の申告）。 */
export function IncidentReportRecordNotice() {
  return (
    <p className="border-l-4 border-ink-soft py-0.5 pl-3 text-sm leading-relaxed text-ink" data-testid="incident-report-record-notice">
      {INCIDENT_REPORT_RECORD_NOTICE}
    </p>
  );
}

export type GuidanceViewModel = {
  readonly level: IncidentGuidanceLevel;
  readonly label: string;
  readonly mark: string;
  readonly text: string;
  /** N4（目安のすぐ下）。 */
  readonly note: string;
  readonly revision?: number;
  readonly source?: string;
  readonly statusLabel?: string;
};

/** 目安（2 段）。見出し（記号と文字）→ 案内の文 → N4 → 類型のデータの版・出典。 */
export function IncidentGuidanceView({ g, testId = "incident-guidance" }: { readonly g: GuidanceViewModel; readonly testId?: string }) {
  return (
    <div
      className={`flex flex-col gap-2 rounded-sharp border-2 p-3 text-ink ${g.level === "possible" ? "border-l-8 border-signal-amber bg-paper" : "border-rule bg-paper"}`}
      data-testid={testId}
      data-level={g.level}
      role="status"
      aria-live="polite"
    >
      <p className="text-base font-bold" data-testid={`${testId}-label`}>
        <span aria-hidden>{g.mark} </span>
        {g.label}
      </p>
      <p className="text-sm leading-relaxed" data-testid={`${testId}-text`}>
        {g.text}
      </p>
      <p className="text-xs leading-relaxed text-ink-soft" data-testid={`${testId}-note`}>
        {g.note}
      </p>
      {g.revision !== undefined ? (
        <p className="text-xs leading-relaxed text-ink-soft" data-testid={`${testId}-source`}>
          類型のデータの版 {g.revision}（{g.statusLabel}）：{g.source}
        </p>
      ) : null}
    </div>
  );
}

/** 報告の状態（なし／報告の記録あり（利用者の申告）／要否を確かめた記録あり／内容が変わった）。 */
export function IncidentReportStateView({ s, testId = "incident-report-state" }: { readonly s: IncidentReportStateDto; readonly testId?: string }) {
  return (
    <span className="flex flex-col gap-0.5" data-testid={testId} data-code={s.code} data-changed={s.changedSinceReport ? "true" : "false"}>
      <span>
        <span aria-hidden>{s.mark} </span>
        {s.label}
      </span>
      {s.changedLabel ? (
        <span className="font-bold text-ink" data-testid={`${testId}-changed`}>
          <span aria-hidden>！ </span>
          {s.changedLabel}
        </span>
      ) : null}
    </span>
  );
}

/** 一覧の 1 行（事故・ヒヤリハットの一覧・計画・日誌の節で共通）。 */
export function IncidentRow({ d }: { readonly d: IncidentDto }) {
  return (
    <Link
      prefetch={false}
      href={incidentHref(d.id)}
      className={`flex min-h-11 flex-col gap-1.5 border-b border-rule-soft px-1 py-3 text-sm hover:bg-paper-soft ${d.voided ? "text-ink-mute" : "text-ink"}`}
      data-testid="incident-row"
      data-id={d.id}
      data-level={d.guidance.level}
      data-report={d.reportState.code}
      data-detail-pending={d.detailPending ? "true" : "false"}
      data-voided={d.voided ? "true" : "false"}
    >
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-mono tnum" data-testid="incident-row-time">
          {d.occurredAtJst}
        </span>
        <Badge tone="neutral" data-testid="incident-row-kind">
          {d.kindLabel}
        </Badge>
        {d.detailPending ? (
          <Badge tone="amber" data-testid="incident-row-pending">
            {`${d.detailPendingMark ?? ""} ${d.detailPendingLabel ?? ""}`.trim()}
          </Badge>
        ) : null}
        {d.voided ? (
          <Badge tone="red" data-testid="incident-row-voided">
            {`× ${d.voidedLabel ?? ""}`}
          </Badge>
        ) : null}
      </span>
      <span className="break-all font-medium" data-testid="incident-row-summary">
        {d.summary ?? "（何が起きたかは未記入）"}
      </span>
      <span className="flex flex-col gap-0.5 text-xs text-ink-soft sm:flex-row sm:flex-wrap sm:gap-x-4">
        <span data-testid="incident-row-guidance">
          目安：<span aria-hidden>{d.guidance.mark} </span>
          {d.guidance.label}
        </span>
        <span className="flex gap-1">
          報告：
          <IncidentReportStateView s={d.reportState} testId="incident-row-report" />
        </span>
        <span data-testid="incident-row-follow-up">対応：{d.followUpLabel}</span>
      </span>
    </Link>
  );
}

export function IncidentList({ rows, empty }: { readonly rows: readonly IncidentDto[]; readonly empty: ReactNode }) {
  return rows.length === 0 ? (
    <p className="border-y border-rule py-6 text-center text-sm text-ink-mute" data-testid="incident-empty">
      {empty}
    </p>
  ) : (
    <ul className="flex flex-col border-t border-rule" data-testid="incident-list">
      {rows.map((d) => (
        <li key={d.id}>
          <IncidentRow d={d} />
        </li>
      ))}
    </ul>
  );
}

/** 計画・日誌の画面の「この飛行の事故・ヒヤリハット」の節（件数・一覧・「記録する」）。記録は自動で作らない。 */
export function LinkedIncidentsSection({ dto }: { readonly dto: PlanIncidentsDto | FlightIncidentsDto }) {
  const safetyHref = "safetyIssueHref" in dto ? dto.safetyIssueHref : null;
  return (
    <Section title="この飛行の事故・ヒヤリハット" aria-label="この飛行の事故・ヒヤリハット">
      <div className="flex flex-col gap-3" data-testid="incident-linked">
        <p className="text-sm text-ink-soft" data-testid="incident-linked-count" data-count={dto.count}>
          {dto.count} 件
        </p>
        <IncidentList rows={dto.incidents} empty="この飛行に結び付いた事故・ヒヤリハットの記録はありません。" />
        {safetyHref && dto.canCreate ? (
          <div className="flex flex-col gap-1.5">
            <Link prefetch={false} href={safetyHref} className={`${buttonOutlineBrandClass} self-start`} data-testid="incident-linked-safety">
              事故・ヒヤリハットとして記録する
            </Link>
            <p className="text-xs text-ink-mute">日誌の「安全に影響のあった事項」を、要約の初期値に入れて入力画面を開きます。記録は保存するまで作られません。</p>
          </div>
        ) : null}
        {dto.canCreate ? (
          <Link prefetch={false} href={dto.newHref} className={`${buttonOutlineBrandClass} self-start`} data-testid="incident-linked-new">
            記録する
          </Link>
        ) : null}
        <p className="text-xs leading-relaxed text-ink-soft" data-testid="incident-linked-fact">
          {dto.notices.fact}
        </p>
      </div>
    </Section>
  );
}
