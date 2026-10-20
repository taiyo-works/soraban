import type { ReactNode } from "react";
import {
  MODEL_AIRCRAFT_REFERENCE_LINE,
  MODEL_AIRCRAFT_REFERENCES,
  MODEL_AIRCRAFT_RULES_CHECKED_AT,
  MODEL_AIRCRAFT_UNVERIFIED,
  PERMIT_SCOPE_NOT_VERIFIED_NOTE,
  VERDICT_HELP,
  type FlightVerdict,
  type ItemVerdict,
} from "@soraban/regulations";
import {
  BASE_STATUS_LABEL,
  baseStatusDisplay,
  CONDITIONAL_NOTE,
  deadlineCountdown,
  isConfirmProcedure,
  legalTierLabel,
  PROCEDURE_COLUMNS,
  unknownCountLabel,
  VERDICT_EDGE,
  VERDICT_LABEL,
  VERDICT_FAILED_LABEL,
  VERDICT_FAILED_NOTE,
  VERDICT_GEOMETRY as G,
  VERDICT_PENDING_LABEL,
  VERDICT_RETRY_LABEL,
  VERDICT_SCALE,
  VERDICT_SECTION_TITLE,
  VERDICT_TONE,
} from "@/lib/verdict-display";
import { TierGauge, VerdictGlyph, VerdictMark } from "./verdict-mark";

type Props = {
  /** 画面の結論に使う判定（/api/diagnose の verdict。飛行の方法を含む。未決 5）。 */
  readonly verdict: FlightVerdict | undefined;
  /** 判定の応答待ち（「判定中」を出す）。 */
  readonly pending: boolean;
  /** 申請支援の診断が失敗した（判定を出さず、再試行を促す）。 */
  readonly failed?: boolean;
  /** 失敗の説明（未指定は診断の失敗の説明）。 */
  readonly failedNote?: string;
  /** 再試行（診断をやり直す）。 */
  readonly onRetry?: () => void;
  /** 結論の行の右に置くもの（PDF 出力のボタンなど）。 */
  readonly actions?: ReactNode;
  /** 結論の下に置く補足（座標・住所など）。 */
  readonly meta?: ReactNode;
};

const DUTY_KIND_LABEL = { premise: "前提", per_flight: "飛行ごと" } as const;

// ── 見せ方（Sprint 11d D2）──
// 計器・運航票の語彙：結論は「表示板」（左端の帯＋記号＋段階の言葉＋現在位置を示す目盛り）、
// 段取りは「運航票」（行ごとに左端の帯、等幅の番号と期限の日付、残り日数、法的な重さの目盛り）。
// 色は補助。段階は言葉・記号の形・目盛りの位置の三つで読める（グレースケールでも区別できる）。

/** 区切りの見出し（等幅の番号の代わりに、細い罫で区切る）。 */
function SectionHead({ children, count }: { children: ReactNode; count?: number }) {
  return (
    <div className="flex items-baseline gap-3 border-b border-ink/70 pb-1">
      <p className="eyebrow !text-ink-soft">{children}</p>
      {count !== undefined ? (
        <span aria-hidden className="ml-auto font-mono text-[11px] tnum text-ink-mute">
          {String(count).padStart(2, "0")}
        </span>
      ) : null}
    </div>
  );
}

/** 結論の目盛り：重い順に 4 段の記号を並べ、現在の段階の位置に枠と下線を置く（読み上げは段階の言葉が担う）。 */
function VerdictScale({ level }: { level: ItemVerdict }) {
  return (
    <div aria-hidden className="flex items-end gap-1" data-scale-level={level}>
      {VERDICT_SCALE.map((l) => {
        const active = l === level;
        return (
          <span
            key={l}
            className={`flex h-9 w-9 items-center justify-center border-b-2 ${
              active ? `${VERDICT_TONE[l]} border-current bg-paper` : "border-rule text-ink-mute/55"
            }`}
          >
            <svg width={18} height={18} viewBox="0 0 24 24">
              <VerdictGlyph level={l} strokeWidth={2} />
            </svg>
          </span>
        );
      })}
    </div>
  );
}

// 規制ごとの判定の表のセル（狭い幅では「列名 値」の 1 行ずつに積む。列名は data-label を ::before で出す）。
const ITEM_CELL =
  "flex gap-2 py-0.5 pr-3 md:table-cell md:py-1.5 max-md:before:w-[5.5rem] max-md:before:shrink-0 max-md:before:text-[10px] max-md:before:leading-5 max-md:before:text-ink-mute max-md:before:content-[attr(data-label)]";

/** 段階の言葉。括弧の中（「条件付き」）は折り返しても一塊で読めるよう、小さく続ける（文字列は変えない）。 */
function LevelWords({ label }: { label: string }) {
  const i = label.indexOf("（");
  if (i < 0) return <>{label}</>;
  return (
    <>
      {label.slice(0, i)}
      <span className="whitespace-nowrap text-[0.7em] tracking-normal">{label.slice(i)}</span>
    </>
  );
}

// 判定（4 段＋判定不能）の結論と段取り（Sprint 11d D1・D2）。
// 並び：結論 → 飛行できない理由 → 要手続きの手続き（期限順）→ 手続き済み（条件付き）→ 飛行の前後に必ず行うこと
//       → 規制ごとの判定（元の判定 → 適用した許可 → 判定）。地点判定の PDF も同じ順・同じ言葉。
/** 理由の末尾の参照先（模型航空機。Sprint 11e）を外し、題名のリンクとして出す。 */
const hasModelAircraftReferences = (reason: string): boolean => reason.includes(MODEL_AIRCRAFT_REFERENCE_LINE);

const REFERENCE_LIST_ID = "model-aircraft-reference-list";
const refNo = (i: number): string => `[${i + 1}]`;

/** 参照先のリンク（題名。読み上げ名は「参照先：（題名）（新しいタブで開く）」）。 */
function ReferenceLink({ title, url }: { readonly title: string; readonly url: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`参照先：${title}（新しいタブで開く）`}
      className="text-brand-700 underline decoration-brand-700/40 underline-offset-2 hover:text-ink hover:decoration-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700"
    >
      {title}
      {/* 矢印だけが次の行に送られないよう、語結合子でつなぐ */}
      <span aria-hidden className="font-mono text-[10px]">{"\u2060\u00a0↗"}</span>
    </a>
  );
}

/**
 * 理由と参照先（Sprint 11e の見せ方）。
 * - links：段取り表の行（手続きを済ませる場所）。番号付きの題名のリンクを 1 件 1 行で出す。
 * - pointer：規制ごとの判定の行。リンクを繰り返さず、表の下の参照先の一覧（1 か所）を指す。
 */
function ReasonWithReferences({
  reason,
  className,
  testId,
  mode,
}: {
  readonly reason: string;
  readonly className: string;
  readonly testId?: string;
  readonly mode: "links" | "pointer";
}) {
  if (!hasModelAircraftReferences(reason)) {
    return <span className={className}>{reason}</span>;
  }
  const text = reason.replace(MODEL_AIRCRAFT_REFERENCE_LINE, "").trim();
  return (
    <span className={className} {...(testId ? { "data-testid": testId } : {})}>
      {text}
      {mode === "links" ? (
        <span
          data-testid="model-aircraft-references"
          className="mt-1.5 block border-l border-rule pl-2.5"
        >
          <span className="block text-[10px] tracking-[0.08em] text-ink-mute">参照先</span>
          {MODEL_AIRCRAFT_REFERENCES.map((r, i) => (
            <span key={r.id} className="grid grid-cols-[1.75rem_minmax(0,1fr)] items-baseline">
              <span aria-hidden className="font-mono text-[10px] tnum text-ink-mute">{refNo(i)}</span>
              <span>
                <ReferenceLink title={r.title} url={r.url} />
              </span>
            </span>
          ))}
        </span>
      ) : (
        <span data-testid="model-aircraft-references" className="mt-0.5 block">
          参照先：
          <a
            href={`#${REFERENCE_LIST_ID}`}
            className="font-mono text-[10px] tnum text-brand-700 underline decoration-brand-700/40 underline-offset-2 hover:text-ink"
          >
            {refNo(0)}〜{refNo(MODEL_AIRCRAFT_REFERENCES.length - 1)}
          </a>
          （表の下の一覧）
        </span>
      )}
    </span>
  );
}

/** 参照先の一覧（模型航空機。画面に 1 か所だけ。PDF の一覧と同じ並び・同じ番号）。 */
function ModelAircraftReferenceList() {
  return (
    <div id={REFERENCE_LIST_ID} data-testid={REFERENCE_LIST_ID} className="flex scroll-mt-4 flex-col gap-2">
      <SectionHead count={MODEL_AIRCRAFT_REFERENCES.length}>
        <span className="normal-case">参照先（100g 未満の機体・模型航空機）</span>
      </SectionHead>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-soft">
        <span className="font-mono tnum">確認日 {MODEL_AIRCRAFT_RULES_CHECKED_AT}</span>
        <span className="border border-dashed border-verdict-needs px-1.5 py-px font-medium text-verdict-needs">
          {MODEL_AIRCRAFT_UNVERIFIED}
        </span>
      </p>
      <ol className="flex flex-col divide-y divide-rule border-y border-rule text-xs">
        {MODEL_AIRCRAFT_REFERENCES.map((r, i) => (
          <li key={r.id} className="grid grid-cols-[2rem_minmax(0,1fr)] items-baseline gap-x-1 py-1.5">
            <span aria-hidden className="font-mono text-[11px] tnum text-ink-mute">{refNo(i)}</span>
            <span className="flex min-w-0 flex-col">
              <ReferenceLink title={r.title} url={r.url} />
              <span className="break-all font-mono text-[10px] text-ink-mute">{r.url}</span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function VerdictSummary({ verdict, pending, failed, failedNote, onRetry, actions, meta }: Props) {
  // 診断が失敗したときは判定を出さない（古い判定・地点だけの判定で代えない。差し戻し 2 回目）。
  const ready = verdict !== undefined && !pending && !failed;
  return (
    <div
      data-testid="verdict-summary"
      data-level={ready ? verdict.level : failed ? "failed" : "pending"}
      className="flex flex-col gap-7"
    >
      {/* 結論（表示板） */}
      <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-start">
        <div data-testid="verdict-conclusion" className="flex min-w-0 flex-1 flex-col gap-2">
          <p className="eyebrow">
            <span aria-hidden className="bearing-mark" />
            {VERDICT_SECTION_TITLE.conclusion}
          </p>
          {ready ? (
            <div
              className={`flex flex-col gap-3 border border-ink/60 border-l-[6px] bg-paper px-4 py-3.5 sm:px-5 ${VERDICT_EDGE[verdict.level]}`}
            >
              <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
                <div className="flex min-w-0 items-center gap-3">
                  <VerdictMark level={verdict.level} size="lg" decorative />
                  <p
                    data-testid="verdict-level"
                    className={`font-display text-[1.75rem] font-normal leading-none tracking-tight sm:text-[2rem] ${VERDICT_TONE[verdict.level]}`}
                  >
                    <LevelWords label={VERDICT_LABEL[verdict.level]} />
                  </p>
                </div>
                <div className="ml-auto">
                  <VerdictScale level={verdict.level} />
                </div>
              </div>
              {verdict.unknownCount > 0 || verdict.level === "procedure_done" ? (
                <div className="flex flex-col gap-1.5 border-t border-rule pt-2.5">
                  {verdict.unknownCount > 0 ? (
                    <p
                      data-testid="verdict-unknown-count"
                      className="inline-flex items-center gap-2 text-sm font-medium text-ink"
                    >
                      <VerdictMark level="unknown" size="sm" decorative />
                      {unknownCountLabel(verdict.unknownCount)}
                    </p>
                  ) : null}
                  {verdict.level === "procedure_done" ? (
                    <p
                      data-testid="verdict-conditional"
                      className="border-l-2 border-dashed border-verdict-done pl-2.5 text-sm font-medium leading-relaxed text-ink"
                    >
                      {CONDITIONAL_NOTE}
                      {PERMIT_SCOPE_NOT_VERIFIED_NOTE}
                    </p>
                  ) : null}
                </div>
              ) : null}
              <p className="text-sm leading-relaxed text-ink-soft">{VERDICT_HELP[verdict.level]}</p>
            </div>
          ) : failed ? (
            <div
              data-testid="verdict-failed"
              role="alert"
              className="flex flex-col gap-2.5 border border-dashed border-ink/60 border-l-[6px] bg-paper px-4 py-3.5 sm:px-5"
            >
              <div className="flex items-center gap-3">
                {/* 判定できない記号（破線の四角に「×」）。判定不能（破線の四角に「？」）と同じ枠で、中の記号で区別する。 */}
                <svg aria-hidden width={40} height={40} viewBox="0 0 24 24" className="shrink-0 text-ink">
                  <rect
                    x={G.square.x}
                    y={G.square.y}
                    width={G.square.size}
                    height={G.square.size}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.35}
                    strokeDasharray={G.square.dash}
                  />
                  <line x1={8.5} y1={8.5} x2={15.5} y2={15.5} stroke="currentColor" strokeWidth={1.6} />
                  <line x1={15.5} y1={8.5} x2={8.5} y2={15.5} stroke="currentColor" strokeWidth={1.6} />
                </svg>
                <p className="font-display text-[1.75rem] font-light leading-none tracking-tight text-ink sm:text-[2rem]">
                  {VERDICT_FAILED_LABEL}
                </p>
              </div>
              <p data-testid="verdict-failed-note" className="text-sm leading-relaxed text-ink-soft">
                {failedNote ?? VERDICT_FAILED_NOTE}
              </p>
              {onRetry ? (
                <button
                  type="button"
                  data-testid="verdict-retry"
                  onClick={onRetry}
                  className="inline-flex h-10 w-fit items-center rounded-sharp border border-brand-700 bg-paper px-4 text-xs font-medium text-brand-700 transition-colors hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700"
                >
                  {VERDICT_RETRY_LABEL}
                </button>
              ) : null}
            </div>
          ) : (
            <div className="flex items-center gap-3 border border-dashed border-rule border-l-[6px] bg-paper px-4 py-3.5 sm:px-5">
              <span aria-hidden className="h-10 w-10 shrink-0 border border-dashed border-ink-mute/60" />
              <p
                data-testid="verdict-pending"
                className="font-display text-[1.75rem] font-light leading-none tracking-tight text-ink-mute sm:text-[2rem]"
                role="status"
              >
                {VERDICT_PENDING_LABEL}
              </p>
            </div>
          )}
          {meta}
        </div>
        {actions ? <div className="sm:pt-6">{actions}</div> : null}
      </div>

      {ready ? (
        <>
          {/* 飛行できない理由 */}
          {verdict.noFly.length > 0 ? (
            <div data-testid="verdict-no-fly" className="flex flex-col gap-2">
              <SectionHead count={verdict.noFly.length}>{VERDICT_SECTION_TITLE.noFly}</SectionHead>
              <ul className="flex flex-col gap-1.5">
                {verdict.noFly.map((n) => (
                  <li
                    key={n.itemId}
                    data-testid="verdict-no-fly-item"
                    data-item-id={n.itemId}
                    className={`flex items-start gap-2.5 border border-rule border-l-4 bg-paper px-3 py-2 text-sm text-ink ${VERDICT_EDGE.no_fly}`}
                  >
                    <span className="pt-0.5">
                      <VerdictMark level="no_fly" size="sm" decorative />
                    </span>
                    <span>
                      <span className="font-medium">{n.title}</span>
                      <span className="block text-xs leading-relaxed text-ink-soft">{n.reason}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* 要手続きの手続き（期限順の段取り＝運航票） */}
          <div data-testid="verdict-procedures-section" className="flex flex-col gap-2">
            <SectionHead>
              {VERDICT_SECTION_TITLE.procedures}（{verdict.procedures.length} 件）
            </SectionHead>
            {verdict.procedures.length === 0 ? (
              <p className="text-xs text-ink-mute">要手続きの手続きはありません。</p>
            ) : (
              <div className="overflow-x-auto">
                <table
                  data-testid="verdict-procedures"
                  className="block w-full text-left text-xs md:table md:min-w-[640px] md:border-separate md:border-spacing-y-1"
                >
                  <thead className="max-md:hidden">
                    <tr className="text-[10px] tracking-[0.08em] text-ink-mute">
                      <th className="w-12 py-1 pl-3 pr-2 font-medium">#</th>
                      {PROCEDURE_COLUMNS.map((c, i) => (
                        <th
                          key={c}
                          className={`py-1 pr-3 font-medium ${i === 2 ? "w-[30%]" : ""} ${i === 3 ? "w-24" : ""}`}
                        >
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="flex flex-col gap-1.5 md:table-row-group">
                    {verdict.procedures.map((p, i) => {
                      const countdown = deadlineCountdown(p.deadline.date);
                      const edge = VERDICT_EDGE[isConfirmProcedure(p.id) ? "unknown" : "needs_procedure"];
                      // 768px 以上は表の行、狭い幅は 1 件ずつの票（左端の帯・番号の列・手続き名 → 出す先 → 期限 → 法的な重さ）。
                      const cell =
                        "block bg-paper py-1 pr-3 align-top md:table-cell md:border-y md:border-rule md:py-2.5";
                      const labelled =
                        "max-md:col-start-2 max-md:before:mb-0.5 max-md:before:block max-md:before:text-[10px] max-md:before:tracking-[0.08em] max-md:before:text-ink-mute max-md:before:content-[attr(data-label)]";
                      return (
                        <tr
                          key={p.id}
                          data-testid="verdict-procedure"
                          data-procedure-id={p.id}
                          data-item-id={p.itemId}
                          data-legal-tier={p.legalTier}
                          data-deadline-date={p.deadline.date ?? ""}
                          className={`grid grid-cols-[2.5rem_minmax(0,1fr)] border border-l-4 border-rule bg-paper pb-1.5 md:table-row md:border-0 md:bg-transparent md:pb-0 ${edge}`}
                        >
                          <td
                            className={`${cell} pl-2.5 pt-2.5 font-mono text-sm font-medium tnum text-ink max-md:row-span-4 md:border-l-4 md:pl-3 ${edge}`}
                          >
                            {String(i + 1).padStart(2, "0")}
                            {isConfirmProcedure(p.id) ? (
                              <svg aria-hidden width={14} height={14} viewBox="0 0 24 24" className={`mt-1 block ${VERDICT_TONE.unknown}`}>
                                <VerdictGlyph level="unknown" strokeWidth={2.4} />
                              </svg>
                            ) : null}
                          </td>
                          <td className={`${cell} max-md:col-start-2 max-md:pt-2.5`}>
                            <span className="text-[13px] font-medium leading-snug text-ink">{p.title}</span>
                            <ReasonWithReferences
                              reason={p.reason}
                              mode="links"
                              className="mt-0.5 block text-[11px] leading-relaxed text-ink-mute"
                            />
                          </td>
                          <td data-label={PROCEDURE_COLUMNS[1]} className={`${cell} ${labelled} leading-relaxed text-ink-soft`}>
                            {p.submitTo}
                          </td>
                          <td
                            data-testid="verdict-procedure-deadline"
                            data-label={PROCEDURE_COLUMNS[2]}
                            className={`${cell} ${labelled} text-ink`}
                          >
                            {p.deadline.date ? (
                              <span className="mb-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                                <span className="font-mono text-sm font-medium tnum text-ink">{p.deadline.date}</span>
                                {countdown ? (
                                  <span className="border border-ink/50 px-1 font-mono text-[10px] tnum text-ink">
                                    {countdown}
                                  </span>
                                ) : null}
                              </span>
                            ) : null}
                            <span
                              className={`block leading-relaxed ${p.deadline.date ? "text-[11px] text-ink-mute" : "text-ink"}`}
                            >
                              {p.deadline.label}
                            </span>
                          </td>
                          <td data-label={PROCEDURE_COLUMNS[3]} className={`${cell} ${labelled} text-ink-soft md:border-r`}>
                            <span className="inline-flex items-end gap-1.5">
                              <TierGauge tier={p.legalTier} />
                              <span className="leading-none">{legalTierLabel(p.legalTier)}</span>
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* 手続き済み（条件付き） */}
          {verdict.done.length > 0 ? (
            <div data-testid="verdict-done" className="flex flex-col gap-2">
              <SectionHead count={verdict.done.length}>{VERDICT_SECTION_TITLE.done}</SectionHead>
              <ul className="flex flex-col gap-1.5">
                {verdict.done.map((d) => (
                  <li
                    key={d.itemId}
                    data-testid="verdict-done-item"
                    data-item-id={d.itemId}
                    className={`flex flex-col gap-2 border border-rule border-l-4 bg-paper px-3 py-2.5 text-xs text-ink-soft ${VERDICT_EDGE.procedure_done}`}
                  >
                    <span className="flex items-start gap-2 text-[13px] font-medium leading-snug text-ink">
                      <span className="pt-0.5">
                        <VerdictMark level="procedure_done" size="sm" decorative />
                      </span>
                      <span className="flex-1">{d.title}</span>
                      <span className="hidden shrink-0 items-end gap-1.5 text-[11px] font-normal text-ink-soft sm:inline-flex">
                        <TierGauge tier={d.legalTier} />
                        <span className="leading-none">{legalTierLabel(d.legalTier)}</span>
                      </span>
                    </span>
                    <span className="grid grid-cols-1 gap-x-4 gap-y-0.5 pl-[22px] sm:grid-cols-[auto_1fr]">
                      <span className="text-ink-mute">元の判定：</span>
                      <span className="text-ink">{BASE_STATUS_LABEL[d.baseStatus]}</span>
                      <span className="text-ink-mute">適用した許可：</span>
                      <span className="text-ink">{d.appliedPermits.map((p) => p.label).join(" / ")}</span>
                    </span>
                    <ul className="ml-[22px] flex flex-col gap-0.5 border-l-2 border-dashed border-verdict-done pl-2.5 leading-relaxed">
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

          {/* 飛行の前後に必ず行うこと（点検表） */}
          <div data-testid="verdict-duties-section" className="flex flex-col gap-2">
            <SectionHead count={verdict.perFlightDuties.length}>{VERDICT_SECTION_TITLE.duties}</SectionHead>
            <ul data-testid="verdict-duties" className="flex flex-col divide-y divide-rule border-b border-rule">
              {verdict.perFlightDuties.map((d) => (
                <li
                  key={d.id}
                  data-testid="verdict-duty"
                  data-duty-id={d.id}
                  data-kind={d.kind}
                  className="grid grid-cols-[4.5rem_1fr] items-baseline gap-x-3 py-1.5 text-xs text-ink-soft"
                >
                  <span
                    className={`justify-self-start border px-1.5 py-px text-[10px] leading-tight ${
                      d.kind === "premise" ? "border-rule text-ink-mute" : "border-ink/70 text-ink"
                    }`}
                  >
                    {DUTY_KIND_LABEL[d.kind]}
                  </span>
                  <span>
                    <span className="font-medium text-ink">{d.title}</span>
                    <span className="block text-[11px] leading-relaxed text-ink-mute">{d.detail}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {/* 規制・飛行の条件ごとの判定 */}
          <div className="flex flex-col gap-2">
            <SectionHead count={verdict.items.length}>{VERDICT_SECTION_TITLE.items}</SectionHead>
            <div className="overflow-x-auto">
              <table
                data-testid="verdict-items"
                className="block w-full text-left text-xs md:table md:min-w-[600px] md:border-collapse"
              >
                <thead className="max-md:hidden">
                  <tr className="border-b border-rule text-[10px] tracking-[0.08em] text-ink-mute">
                    <th className="py-1 pl-3 pr-3 font-medium">規制・飛行の条件</th>
                    <th className="py-1 pr-3 font-medium">元の判定</th>
                    <th className="py-1 pr-3 font-medium">適用した許可</th>
                    <th className="py-1 pr-2 font-medium">判定</th>
                  </tr>
                </thead>
                <tbody className="block border-t border-rule md:table-row-group md:border-t-0">
                  {verdict.items.map((it) => (
                    <tr
                      key={it.id}
                      data-testid="verdict-item"
                      data-item-id={it.id}
                      data-base-status={it.baseStatus}
                      data-verdict={it.verdict}
                      className={`block border-b border-l-2 border-rule py-1.5 pl-3 align-top md:table-row md:border-l-0 md:py-0 md:pl-0 ${VERDICT_EDGE[it.verdict]}`}
                    >
                      <td className={`block pb-1 pr-3 text-ink md:table-cell md:border-l-2 md:py-1.5 md:pl-3 ${VERDICT_EDGE[it.verdict]}`}>
                        {it.title}
                        {hasModelAircraftReferences(it.reason) ? (
                          <ReasonWithReferences
                            reason={it.reason}
                            testId="verdict-item-reason"
                            mode="pointer"
                            className="mt-0.5 block text-[11px] leading-relaxed text-ink-mute"
                          />
                        ) : null}
                      </td>
                      <td data-label="元の判定" className={`${ITEM_CELL} text-ink-soft`}>
                        {baseStatusDisplay(it)}
                      </td>
                      <td data-label="適用した許可" className={`${ITEM_CELL} text-ink-soft`}>
                        {it.appliedPermits.length > 0 ? it.appliedPermits.map((p) => p.label).join(" / ") : "—"}
                      </td>
                      <td data-label="判定" className={`${ITEM_CELL} whitespace-nowrap md:pr-2`}>
                        <span className={`inline-flex items-center gap-1.5 font-medium ${VERDICT_TONE[it.verdict]}`}>
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

          {/* 参照先（模型航空機。理由に参照先を持つ項目があるときだけ、1 か所に出す） */}
          {verdict.items.some((it) => hasModelAircraftReferences(it.reason)) ||
          verdict.procedures.some((p) => hasModelAircraftReferences(p.reason)) ? (
            <ModelAircraftReferenceList />
          ) : null}
        </>
      ) : null}
    </div>
  );
}
