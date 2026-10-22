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

/**
 * G1（最初の案内）。入力画面の最上部（入力欄より前。DOM の順でも）に置く。警告の赤一色にしない：
 * 琥珀の淡い地に細い枠と左の太線、3 つの段落に番号の印（形）を添えて、落ち着いて上から読めるようにする。
 * large は現場の簡易記録用（文字 18px 以上・番号の印も 18px 以上・比 7:1 以上）。
 */
export function IncidentSafetyFirst({ large = false }: { readonly large?: boolean }) {
  return (
    <section
      aria-label="最初の案内"
      className={`rounded-sharp border border-l-[6px] border-signal-amber/70 border-l-signal-amber bg-signal-amber-soft text-ink ${large ? "px-4 py-4 text-lg leading-relaxed" : "px-4 py-4 text-sm leading-relaxed sm:px-5"}`}
      data-testid="incident-safety-first"
    >
      <ol className={`flex flex-col ${large ? "gap-3" : "gap-2.5"}`}>
        {INCIDENT_SAFETY_FIRST_LINES.map((line, i) => (
          <li key={i} className={`flex items-start ${large ? "gap-3" : "gap-2.5"}`}>
            <span
              aria-hidden
              className={`inline-flex shrink-0 items-center justify-center rounded-full border font-mono leading-none tnum ${
                i === 0 ? "border-ink bg-ink text-paper" : "border-ink-soft text-ink"
              } ${large ? "mt-0.5 h-8 w-8 text-lg" : "mt-px h-6 w-6 text-xs"}`}
            >
              {i + 1}
            </span>
            <p className={`min-w-0 ${i === 0 ? (large ? "font-bold" : "text-[15px] font-bold leading-relaxed") : ""}`} data-testid="incident-safety-first-line">
              {line}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** N1（事実の記録の注意）。事故・ヒヤリハットのすべての画面に出す。読めるが邪魔をしない、藍の細い左線の注記。 */
export function IncidentFactNotice({ large = false }: { readonly large?: boolean }) {
  return (
    <p
      className={large ? "border-l-4 border-brand-700 py-0.5 pl-3 text-lg leading-relaxed text-ink" : "border-l-2 border-brand-700 py-0.5 pl-3 text-sm leading-relaxed text-ink-soft"}
      data-testid="incident-fact-notice"
    >
      {INCIDENT_FACT_NOTICE}
    </p>
  );
}

/** N2（公式の手続き）。N1 より一段控えめ（罫線色の左線）。 */
export function IncidentOfficialNotice({ large = false }: { readonly large?: boolean }) {
  return (
    <p
      className={large ? "border-l-4 border-ink-soft py-0.5 pl-3 text-lg leading-relaxed text-ink" : "border-l-2 border-rule py-0.5 pl-3 text-sm leading-relaxed text-ink-soft"}
      data-testid="incident-official-notice"
    >
      {INCIDENT_OFFICIAL_PROCEDURE_NOTICE}
    </p>
  );
}

/** N3（報告の記録は利用者の申告）。 */
export function IncidentReportRecordNotice() {
  return (
    <p className="border-l-2 border-rule py-0.5 pl-3 text-sm leading-relaxed text-ink-soft" data-testid="incident-report-record-notice">
      {INCIDENT_REPORT_RECORD_NOTICE}
    </p>
  );
}

/** 記号の小さな札（目安・報告の状態の印）。文字と並べて使い、色だけで意味を伝えない。 */
const markChipClass =
  "inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-sharp border px-0.5 font-mono text-xs font-bold leading-none";

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

/**
 * 目安（2 段）。見出し（記号と文字）→ 案内の文 → N4 → 類型のデータの版・出典。
 * 断定に見えないよう、太字の大見出しや警告色の地にはしない（左の線の色と記号・文字で区別。色は補助）。
 * 可能性がある：琥珀の左線と淡い地。選ばれた事象はない：罫線色の左線と紙の地。
 */
export function IncidentGuidanceView({ g, testId = "incident-guidance" }: { readonly g: GuidanceViewModel; readonly testId?: string }) {
  const possible = g.level === "possible";
  return (
    <div
      className={`flex flex-col gap-2.5 rounded-sharp border border-l-4 px-4 py-3.5 text-ink ${
        possible ? "border-signal-amber/60 border-l-signal-amber bg-signal-amber-soft/45" : "border-rule border-l-ink-mute bg-paper"
      }`}
      data-testid={testId}
      data-level={g.level}
      role="status"
      aria-live="polite"
    >
      <p className="flex items-start gap-2 text-base font-medium leading-snug" data-testid={`${testId}-label`}>
        <span aria-hidden className={`${markChipClass} mt-px ${possible ? "border-signal-amber bg-signal-amber-soft text-ink" : "border-ink-mute text-ink-soft"}`}>
          {g.mark}
        </span>
        <span className="min-w-0">{g.label}</span>
      </p>
      <p className="text-sm leading-relaxed" data-testid={`${testId}-text`}>
        {g.text}
      </p>
      <p className="border-t border-rule-soft pt-2.5 text-xs leading-relaxed text-ink-soft" data-testid={`${testId}-note`}>
        {g.note}
      </p>
      {g.revision !== undefined ? (
        <p className="text-xs leading-relaxed text-ink-soft" data-testid={`${testId}-source`}>
          <span className="font-mono tnum">類型のデータの版 {g.revision}</span>（{g.statusLabel}）：{g.source}
        </p>
      ) : null}
    </div>
  );
}

/** 報告の状態（なし／報告の記録あり（利用者の申告）／要否を確かめた記録あり／内容が変わった）。記号と文字で示す。 */
export function IncidentReportStateView({ s, testId = "incident-report-state" }: { readonly s: IncidentReportStateDto; readonly testId?: string }) {
  return (
    <span className="flex min-w-0 flex-col gap-1" data-testid={testId} data-code={s.code} data-changed={s.changedSinceReport ? "true" : "false"}>
      <span>
        <span aria-hidden>{s.mark} </span>
        {s.label}
      </span>
      {s.changedLabel ? (
        <span className="flex items-start gap-1.5 font-bold text-ink" data-testid={`${testId}-changed`}>
          <span aria-hidden className={`${markChipClass} border-signal-amber bg-signal-amber-soft text-ink`}>
            ！
          </span>
          <span className="min-w-0">{s.changedLabel}</span>
        </span>
      ) : null}
    </span>
  );
}

/**
 * 一覧の 1 行（事故・ヒヤリハットの一覧・計画・日誌の節で共通）。12d の一覧と同じく、左の細い線で目安を補助的に示す
 * （可能性がある＝琥珀、そのほか・取消＝罫線色）。意味は「目安：」の記号と文字が担う。
 */
export function IncidentRow({ d }: { readonly d: IncidentDto }) {
  const bar = !d.voided && d.guidance.level === "possible" ? "border-l-signal-amber" : "border-l-rule";
  return (
    <Link
      prefetch={false}
      href={incidentHref(d.id)}
      className={`flex min-h-11 flex-col gap-2 border-b border-l-2 border-b-rule-soft py-3 pl-3 pr-2 text-sm transition-colors hover:bg-paper-soft focus-visible:bg-paper-soft sm:pl-4 ${bar} ${d.voided ? "text-ink-mute" : "text-ink"}`}
      data-testid="incident-row"
      data-id={d.id}
      data-level={d.guidance.level}
      data-report={d.reportState.code}
      data-detail-pending={d.detailPending ? "true" : "false"}
      data-voided={d.voided ? "true" : "false"}
    >
      <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <span className="font-mono text-[13px] tnum text-ink-soft" data-testid="incident-row-time">
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
      <span className={`break-all text-[15px] font-medium leading-snug ${d.summary ? "" : "text-ink-soft"}`} data-testid="incident-row-summary">
        {d.summary ?? "（何が起きたかは未記入）"}
      </span>
      <span className="grid grid-cols-1 gap-1 text-xs leading-relaxed text-ink-soft sm:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_minmax(0,0.5fr)] sm:gap-4">
        <span data-testid="incident-row-guidance">
          <span className="text-ink-mute">目安：</span>
          <span aria-hidden>{d.guidance.mark} </span>
          {d.guidance.label}
        </span>
        <span className="flex gap-1">
          <span className="shrink-0 text-ink-mute">報告：</span>
          <IncidentReportStateView s={d.reportState} testId="incident-row-report" />
        </span>
        <span data-testid="incident-row-follow-up">
          <span className="text-ink-mute">対応：</span>
          {d.followUpLabel}
        </span>
      </span>
    </Link>
  );
}

export function IncidentList({ rows, empty }: { readonly rows: readonly IncidentDto[]; readonly empty: ReactNode }) {
  return rows.length === 0 ? (
    <p className="border-y border-dashed border-rule px-3 py-6 text-center text-sm text-ink-soft" data-testid="incident-empty">
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

/**
 * 計画・日誌の画面の「この飛行の事故・ヒヤリハット」の節（件数・一覧・「記録する」）。記録は自動で作らない。
 * 12d の「許可・承認」の節と同じ紙面調：件数は等幅の小さな札、操作は一覧の下に横並び（狭い画面では縦）、注意書きは最後に細い左線で。
 */
export function LinkedIncidentsSection({ dto }: { readonly dto: PlanIncidentsDto | FlightIncidentsDto }) {
  const safetyHref = "safetyIssueHref" in dto ? dto.safetyIssueHref : null;
  return (
    <Section title="この飛行の事故・ヒヤリハット" aria-label="この飛行の事故・ヒヤリハット">
      <div className="flex flex-col gap-4" data-testid="incident-linked">
        <p className="self-start font-mono text-xs tnum text-ink-soft" data-testid="incident-linked-count" data-count={dto.count}>
          {dto.count} 件
        </p>
        <IncidentList rows={dto.incidents} empty="この飛行に結び付いた事故・ヒヤリハットの記録はありません。" />
        {safetyHref && dto.canCreate ? (
          <div className="flex flex-col gap-2 rounded-sharp border border-l-4 border-rule border-l-brand-700 bg-paper px-3 py-3 sm:px-4">
            <Link prefetch={false} href={safetyHref} className={`${buttonOutlineBrandClass} self-start`} data-testid="incident-linked-safety">
              事故・ヒヤリハットとして記録する
            </Link>
            <p className="text-xs leading-relaxed text-ink-soft">日誌の「安全に影響のあった事項」を、要約の初期値に入れて入力画面を開きます。記録は保存するまで作られません。</p>
          </div>
        ) : null}
        {dto.canCreate ? (
          <Link prefetch={false} href={dto.newHref} className={`${buttonOutlineBrandClass} self-start`} data-testid="incident-linked-new">
            <span aria-hidden className="mr-1.5">＋</span>
            記録する
          </Link>
        ) : null}
        <p className="border-l-2 border-brand-700 pl-3 text-xs leading-relaxed text-ink-soft" data-testid="incident-linked-fact">
          {dto.notices.fact}
        </p>
      </div>
    </Section>
  );
}
