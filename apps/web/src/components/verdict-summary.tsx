import type { ReactNode } from "react";
import {
  PERMIT_SCOPE_NOT_VERIFIED_NOTE,
  VERDICT_HELP,
  type FlightVerdict,
} from "@soraban/regulations";
import {
  BASE_STATUS_LABEL,
  CONDITIONAL_NOTE,
  legalTierLabel,
  PROCEDURE_COLUMNS,
  unknownCountLabel,
  VERDICT_LABEL,
  VERDICT_PENDING_LABEL,
  VERDICT_SECTION_TITLE,
  VERDICT_TONE,
} from "@/lib/verdict-display";
import { VerdictMark } from "./verdict-mark";

type Props = {
  /** 画面の結論に使う判定（/api/diagnose の verdict。飛行の方法を含む。未決 5）。 */
  readonly verdict: FlightVerdict | undefined;
  /** 判定の応答待ち（「判定中」を出す）。 */
  readonly pending: boolean;
  /** 結論の行の右に置くもの（PDF 出力のボタンなど）。 */
  readonly actions?: ReactNode;
  /** 結論の下に置く補足（座標・住所など）。 */
  readonly meta?: ReactNode;
};

const DUTY_KIND_LABEL = { premise: "前提", per_flight: "飛行ごと" } as const;

// 判定（4 段＋判定不能）の結論と段取り（Sprint 11d D1）。構造だけを作り、見せ方は designer が磨く。
// 並び：結論 → 飛行できない理由 → 要手続きの手続き（期限順）→ 手続き済み（条件付き）→ 飛行の前後に必ず行うこと
//       → 規制ごとの判定（元の判定 → 適用した許可 → 判定）。地点判定の PDF も同じ順・同じ言葉。
export function VerdictSummary({ verdict, pending, actions, meta }: Props) {
  const ready = verdict !== undefined && !pending;
  return (
    <div
      data-testid="verdict-summary"
      data-level={ready ? verdict.level : "pending"}
      className="flex flex-col gap-6"
    >
      {/* 結論 */}
      <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-start">
        <div data-testid="verdict-conclusion" className="flex flex-1 flex-col gap-1.5">
          <p className="eyebrow">
            <span aria-hidden className="bearing-mark" />
            {VERDICT_SECTION_TITLE.conclusion}
          </p>
          {ready ? (
            <>
              <div className="flex items-center gap-3">
                <VerdictMark level={verdict.level} size="lg" decorative />
                <p
                  data-testid="verdict-level"
                  className={`font-display text-3xl font-light tracking-tight ${VERDICT_TONE[verdict.level]}`}
                >
                  {VERDICT_LABEL[verdict.level]}
                </p>
              </div>
              {verdict.unknownCount > 0 ? (
                <p
                  data-testid="verdict-unknown-count"
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-ink"
                >
                  <VerdictMark level="unknown" size="sm" decorative />
                  {unknownCountLabel(verdict.unknownCount)}
                </p>
              ) : null}
              {verdict.level === "procedure_done" ? (
                <p data-testid="verdict-conditional" className="text-sm font-medium text-ink">
                  {CONDITIONAL_NOTE}
                  {PERMIT_SCOPE_NOT_VERIFIED_NOTE}
                </p>
              ) : null}
              <p className="text-sm leading-relaxed text-ink-soft">{VERDICT_HELP[verdict.level]}</p>
            </>
          ) : (
            <p
              data-testid="verdict-pending"
              className="font-display text-3xl font-light tracking-tight text-ink-mute"
              role="status"
            >
              {VERDICT_PENDING_LABEL}
            </p>
          )}
          {meta}
        </div>
        {actions}
      </div>

      {ready ? (
        <>
          {/* 飛行できない理由 */}
          {verdict.noFly.length > 0 ? (
            <div data-testid="verdict-no-fly" className="flex flex-col gap-2">
              <p className="eyebrow">{VERDICT_SECTION_TITLE.noFly}</p>
              <ul className="flex flex-col gap-1.5">
                {verdict.noFly.map((n) => (
                  <li
                    key={n.itemId}
                    data-testid="verdict-no-fly-item"
                    data-item-id={n.itemId}
                    className="flex items-start gap-2 border-l-2 border-signal-red pl-3 text-sm text-ink"
                  >
                    <VerdictMark level="no_fly" size="sm" decorative />
                    <span>
                      <span className="font-medium">{n.title}</span>
                      <span className="block text-xs text-ink-soft">{n.reason}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* 要手続きの手続き（期限順の段取り） */}
          <div data-testid="verdict-procedures-section" className="flex flex-col gap-2">
            <p className="eyebrow">
              {VERDICT_SECTION_TITLE.procedures}（{verdict.procedures.length} 件）
            </p>
            {verdict.procedures.length === 0 ? (
              <p className="text-xs text-ink-mute">要手続きの手続きはありません。</p>
            ) : (
              <div className="overflow-x-auto">
                <table data-testid="verdict-procedures" className="w-full border-collapse text-left text-xs">
                  <thead>
                    <tr className="border-b border-rule text-[11px] text-ink-mute">
                      <th className="py-1.5 pr-2 font-normal">#</th>
                      {PROCEDURE_COLUMNS.map((c) => (
                        <th key={c} className="py-1.5 pr-2 font-normal">
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {verdict.procedures.map((p, i) => (
                      <tr
                        key={p.id}
                        data-testid="verdict-procedure"
                        data-procedure-id={p.id}
                        data-item-id={p.itemId}
                        data-legal-tier={p.legalTier}
                        data-deadline-date={p.deadline.date ?? ""}
                        className="border-b border-rule align-top"
                      >
                        <td className="py-2 pr-2 font-mono tnum text-ink-mute">{String(i + 1).padStart(2, "0")}</td>
                        <td className="py-2 pr-2">
                          <span className="font-medium text-ink">{p.title}</span>
                          <span className="block text-[11px] text-ink-mute">{p.reason}</span>
                        </td>
                        <td className="py-2 pr-2 text-ink-soft">{p.submitTo}</td>
                        <td data-testid="verdict-procedure-deadline" className="py-2 pr-2 text-ink">
                          {p.deadline.label}
                        </td>
                        <td className="py-2 pr-2 text-ink-soft">{legalTierLabel(p.legalTier)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* 手続き済み（条件付き） */}
          {verdict.done.length > 0 ? (
            <div data-testid="verdict-done" className="flex flex-col gap-2">
              <p className="eyebrow">{VERDICT_SECTION_TITLE.done}</p>
              <ul className="flex flex-col gap-2">
                {verdict.done.map((d) => (
                  <li
                    key={d.itemId}
                    data-testid="verdict-done-item"
                    data-item-id={d.itemId}
                    className="flex flex-col gap-1 border-l-2 border-brand-700 pl-3 text-xs text-ink-soft"
                  >
                    <span className="flex items-center gap-2 text-sm font-medium text-ink">
                      <VerdictMark level="procedure_done" size="sm" decorative />
                      {d.title}
                    </span>
                    <span>
                      元の判定：<span className="text-ink">{BASE_STATUS_LABEL[d.baseStatus]}</span>
                    </span>
                    <span>
                      適用した許可：
                      <span className="text-ink">{d.appliedPermits.map((p) => p.label).join(" / ")}</span>
                    </span>
                    <ul className="flex flex-col gap-0.5">
                      {d.conditions.map((c) => (
                        <li key={c} data-testid="verdict-done-condition">
                          ・{c}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* 飛行の前後に必ず行うこと */}
          <div data-testid="verdict-duties-section" className="flex flex-col gap-2">
            <p className="eyebrow">{VERDICT_SECTION_TITLE.duties}</p>
            <ul data-testid="verdict-duties" className="flex flex-col gap-1">
              {verdict.perFlightDuties.map((d) => (
                <li
                  key={d.id}
                  data-testid="verdict-duty"
                  data-duty-id={d.id}
                  data-kind={d.kind}
                  className="text-xs text-ink-soft"
                >
                  <span className="mr-1.5 border border-rule px-1 py-px text-[10px] text-ink-mute">
                    {DUTY_KIND_LABEL[d.kind]}
                  </span>
                  <span className="font-medium text-ink">{d.title}</span>
                  <span className="block pl-1 text-[11px] text-ink-mute">{d.detail}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* 規制・飛行の条件ごとの判定 */}
          <div className="flex flex-col gap-2">
            <p className="eyebrow">{VERDICT_SECTION_TITLE.items}</p>
            <div className="overflow-x-auto">
              <table data-testid="verdict-items" className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-rule text-[11px] text-ink-mute">
                    <th className="py-1.5 pr-2 font-normal">規制・飛行の条件</th>
                    <th className="py-1.5 pr-2 font-normal">元の判定</th>
                    <th className="py-1.5 pr-2 font-normal">適用した許可</th>
                    <th className="py-1.5 pr-2 font-normal">判定</th>
                  </tr>
                </thead>
                <tbody>
                  {verdict.items.map((it) => (
                    <tr
                      key={it.id}
                      data-testid="verdict-item"
                      data-item-id={it.id}
                      data-base-status={it.baseStatus}
                      data-verdict={it.verdict}
                      className="border-b border-rule align-top"
                    >
                      <td className="py-1.5 pr-2 text-ink">{it.title}</td>
                      <td className="py-1.5 pr-2 text-ink-soft">{BASE_STATUS_LABEL[it.baseStatus]}</td>
                      <td className="py-1.5 pr-2 text-ink-soft">
                        {it.appliedPermits.length > 0 ? it.appliedPermits.map((p) => p.label).join(" / ") : "—"}
                      </td>
                      <td className="py-1.5 pr-2">
                        <span className={`inline-flex items-center gap-1.5 ${VERDICT_TONE[it.verdict]}`}>
                          <VerdictMark level={it.verdict} size="sm" decorative />
                          {VERDICT_LABEL[it.verdict]}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
