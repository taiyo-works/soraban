import type { ReactNode } from "react";
import { tidyEngineText } from "@/lib/field-message";
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
  VERDICT_PENDING_LABEL,
  VERDICT_RETRY_LABEL,
  VERDICT_SCALE,
  VERDICT_SECTION_TITLE,
  VERDICT_TONE,
  DUTIES_HEADING_SCREEN,
} from "@/lib/verdict-display";
import { BOUNDARY_SHORT } from "@/lib/boundary";
import type { JudgementTotal } from "@/lib/judgement-total";
import { TierGauge } from "./verdict-mark";
import { PillButton, VERDICT_KEY, VERDICT_STATE, VerdictBig, VerdictSign, VerdictTag } from "./ui/sb-parts";

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
  /**
   * 運航管理の計画の画面だけが渡す、許可・承認の登録に基づく「表示だけの置き換え」（Sprint 12d）。
   * applied：登録が根拠の項目の id → 「照合していません」の代わりの文。item：項目の id → 項目に添える文（判定の段は変えない）。
   * 判定の結論・段は常に verdict のものをそのまま使い、ここでは文だけを差し替える。未指定（判定画面 `/` など）は従来どおり。
   */
  readonly permitNotes?: {
    readonly applied: Readonly<Record<string, string>>;
    readonly item: Readonly<Record<string, string>>;
  };
  /**
   * どの部分を出すか。`/` は結論を入力の直下に、手続き以降を地図の下に置くため 2 つに分けて描く（Sprint 12h PR ②）。
   * all＝従来どおり全部（運航管理の画面）。conclusion＝結論のカードだけ。details＝飛行できない理由・手続き・義務・項目ごとの判定。
   */
  readonly part?: "all" | "conclusion" | "details";
  /**
   * 結論のカードの下に出す「確認日」「出典つき」の札と、責任の注記（判定画面 `/` だけが渡す）。
   * checkedDate：判定に使ったデータの確認日のうち最も新しい日（YYYY-MM-DD）。sourced：出典のリンクを持つ規制の数。
   */
  readonly evidence?: { readonly checkedDate: string | undefined; readonly sourced: number };
  /**
   * 判定の総合の語（計画の段 ⑥ の第 1 層。Sprint 16-H2）。渡すと、結論の語の位置に総合の語（`judgement-total`）を出し、
   * 判定エンジンの段（`verdict-level`）はその下の「判定の段」に小さく出す。判定の結果は変えない。
   */
  readonly total?: JudgementTotal;
  /**
   * 過去の判定の表示（運航管理のスナップショットの画面）。結論のカードに状態の面と帯を付けず、判定不能と同じ灰にする。
   * 帯は「いまの判定」の色なので、過去の記録には付けない。5 段の札・文言・目盛り・data-testid は変えない（表示だけの指定）。
   */
  readonly plainCard?: boolean;
};

/** 手続きの責任の線（北極星：本人名義・本人提出）。境界の文（lib/boundary.ts）をそのまま使う。 */
export const RESPONSIBILITY_NOTE = BOUNDARY_SHORT;
/** 「手続き済み」は記録の表示であって、そらばんが手続きをしたのではない。 */
export const DONE_RECORD_NOTE =
  "「手続き済み」は、ご本人が自分で手続きを済ませた記録の表示です。そらばんが手続きを行ったわけではありません。";

const DUTY_KIND_LABEL = { premise: "前提", per_flight: "飛行ごと" } as const;

// ── 見せ方（Sprint 11d D2）──
// 計器・運航票の語彙：結論は「表示板」（左端の帯＋記号＋段階の言葉＋現在位置を示す目盛り）、
// 段取りは「運航票」（行ごとに左端の帯、等幅の番号と期限の日付、残り日数、法的な重さの目盛り）。
// 色は補助。段階は言葉・記号の形・目盛りの位置の三つで読める（グレースケールでも区別できる）。

/** 区切りの見出し（等幅の番号の代わりに、細い罫で区切る）。 */
function SectionHead({ children, count }: { children: ReactNode; count?: number }) {
  return (
    <div className="flex items-baseline gap-3 border-b border-sb-edge pb-1">
      <p data-note="" className="sb-eyebrow !text-sb-ink-2">{children}</p>
      {count !== undefined ? (
        <span aria-hidden className="ml-auto sb-num text-sm tnum text-sb-ink-3">
          {String(count).padStart(2, "0")}
        </span>
      ) : null}
    </div>
  );
}

/** 結論の目盛り：重い順に 4 段の印を並べ、現在の段階の位置に太い下線を置く（装飾。読み上げは段階の言葉が担う）。 */
function VerdictScale({ level }: { level: ItemVerdict }) {
  return (
    <div aria-hidden className="flex items-end gap-1" data-scale-level={level}>
      {VERDICT_SCALE.map((l) => {
        const active = l === level;
        return (
          <span
            key={l}
            className={`flex h-10 w-11 items-center justify-center border-b-4 ${
              active ? `${VERDICT_TONE[l]} border-current` : "border-transparent text-sb-ink-3 opacity-60"
            }`}
          >
            <VerdictSign level={l} className="h-5 w-5" />
          </span>
        );
      })}
    </div>
  );
}

// 規制ごとの判定の表のセル（狭い幅では「列名 値」の 1 行ずつに積む。列名は data-label を ::before で出す）。
const ITEM_CELL =
  "flex gap-2 pr-2 max-md:flex-wrap md:table-cell md:py-1.5 max-md:before:shrink-0 max-md:before:text-sm max-md:before:leading-5 max-md:before:text-sb-ink-3 max-md:before:content-[attr(data-label)]";

/** 段階の言葉。括弧の中（「条件付き」）は折り返しても一塊で読めるよう、小さく続ける（文字列は変えない）。 */
function LevelWords({ label }: { label: string }) {
  const i = label.indexOf("（");
  if (i < 0) return <>{label}</>;
  return (
    <>
      {label.slice(0, i)}
      <span className="whitespace-nowrap text-[0.875em] tracking-normal">{label.slice(i)}</span>
    </>
  );
}

// 判定（4 段＋判定不能）の結論と段取り（Sprint 11d D1・D2）。
// 並び：結論 → 飛行できない理由 → 要手続きの手続き（期限順）→ 手続き済み（条件付き）→ 飛行の前後に行うこと
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
      className="text-sb-ink underline decoration-sb-primary underline-offset-2 hover:text-sb-ink hover:decoration-sb-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sb-focus"
    >
      {title}
      {/* 矢印だけが次の行に送られないよう、語結合子でつなぐ */}
      <span aria-hidden className="sb-num text-sm">{"\u2060\u00a0↗"}</span>
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
    return <span className={className}>{tidyEngineText(reason)}</span>;
  }
  const text = tidyEngineText(reason.replace(MODEL_AIRCRAFT_REFERENCE_LINE, "").trim());
  return (
    <span className={className} {...(testId ? { "data-testid": testId } : {})}>
      {text}
      {mode === "links" ? (
        <span
          data-testid="model-aircraft-references"
          className="mt-1.5 block border-l border-sb-rule pl-2.5"
        >
          <span className="block text-sm tracking-[0.08em] text-sb-ink-3">参照先</span>
          {MODEL_AIRCRAFT_REFERENCES.map((r, i) => (
            <span key={r.id} className="grid grid-cols-[1.75rem_minmax(0,1fr)] items-baseline">
              <span aria-hidden className="sb-num text-sm tnum text-sb-ink-3">{refNo(i)}</span>
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
            className="sb-num text-sm tnum text-sb-ink underline decoration-sb-primary underline-offset-2 hover:text-sb-ink"
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
      <p data-note="" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-sb-ink-2">
        <span className="sb-num tnum">確認日 {MODEL_AIRCRAFT_RULES_CHECKED_AT}</span>
        <span className="border border-dashed border-sb-v-needs-fg px-1.5 py-px font-medium text-sb-v-needs-fg">
          {MODEL_AIRCRAFT_UNVERIFIED}
        </span>
      </p>
      <ol data-note="" className="flex flex-col divide-y divide-sb-rule border-y border-sb-rule text-sm">
        {MODEL_AIRCRAFT_REFERENCES.map((r, i) => (
          <li key={r.id} className="grid grid-cols-[2rem_minmax(0,1fr)] items-baseline gap-x-1 py-1.5">
            <span aria-hidden className="sb-num text-sm tnum text-sb-ink-3">{refNo(i)}</span>
            <span className="flex min-w-0 flex-col">
              <ReferenceLink title={r.title} url={r.url} />
              <span className="break-all sb-num text-sm text-sb-ink-3">{r.url}</span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function VerdictSummary({ verdict, pending, failed, failedNote, onRetry, actions, meta, permitNotes, part = "all", evidence, total, plainCard }: Props) {
  // 診断が失敗したときは判定を出さない（古い判定・地点だけの判定で代えない。差し戻し 2 回目）。
  const ready = verdict !== undefined && !pending && !failed;
  const showConclusion = part !== "details";
  const showDetails = part !== "conclusion";
  // 手続き以降は、結論が確定したときだけ出る。確定していないとき、詳細の部分は何も描かない
  if (part === "details" && !ready) return null;
  // 結論のカードは「判定の帯のカード」（16-M の M-1）。帯の色は総合の印（総合の語を出さない画面は判定の段）。判定不能・判定中・失敗・過去の判定（plainCard）は帯なし（未確認の灰）。
  const cardState = ready && !plainCard ? VERDICT_STATE[total ? total.sign : verdict.level] : undefined;
  return (
    <div
      data-testid={part === "details" ? "verdict-details" : "verdict-summary"}
      data-level={ready ? verdict.level : failed ? "failed" : "pending"}
      className="flex flex-col gap-7"
    >
      {/* 結論（見本：結果カード。形の印＋語＋短い説明＋確認日・出典つきの札＋ボタン） */}
      {showConclusion ? (
      <div className="flex flex-col items-stretch gap-3">
        <div
          data-testid="verdict-conclusion"
          className={`sb-block flex min-w-0 flex-1 flex-col gap-2.5 ${ready ? "sb-rise" : ""} ${cardState ? "sb-card-state" : ""}`}
          {...(cardState ? { "data-state": cardState } : {})}
          aria-labelledby="verdict-heading"
        >
          {ready ? (
            <>
              <div className="flex items-center gap-3.5">
                <VerdictBig level={total ? total.sign : verdict.level} />
                <div className="min-w-0">
                  <p id="verdict-heading" tabIndex={-1} data-note="" className="sb-v-eyebrow">
                    {VERDICT_SECTION_TITLE.conclusion}
                  </p>
                  {total ? (
                    <>
                      <p data-testid="judgement-total" data-total-key={total.key} data-stale={total.stale ? "true" : "false"} className="sb-v-total">
                        {total.text}
                      </p>
                      <p data-note="" className="sb-v-sub">
                        判定の段：<span data-testid="verdict-level" data-verdict-key={VERDICT_KEY[verdict.level]}><LevelWords label={VERDICT_LABEL[verdict.level]} /></span>
                      </p>
                    </>
                  ) : (
                    <p data-testid="verdict-level" className="sb-v-word" data-verdict-key={VERDICT_KEY[verdict.level]}>
                      <LevelWords label={VERDICT_LABEL[verdict.level]} />
                    </p>
                  )}
                  {meta}
                </div>
              </div>
              {total?.note ? (
                <p data-testid="judgement-total-note" data-note="" className="text-sb-ink-2">{total.note}</p>
              ) : null}
              {/* 判定の印の 4 段の目盛り（装飾。読み上げは段階の言葉が担う。総合の語を出す画面では省く） */}
              {total ? null : <VerdictScale level={verdict.level} />}
              {verdict.unknownCount > 0 || verdict.level === "procedure_done" ? (
                <div className="flex flex-col gap-1.5 border-t border-sb-rule pt-2.5">
                  {verdict.unknownCount > 0 ? (
                    <p data-testid="verdict-unknown-count" data-note="" className="inline-flex items-center gap-2 text-sm font-bold text-sb-ink">
                      <VerdictSign level="unknown" />
                      {unknownCountLabel(verdict.unknownCount)}
                    </p>
                  ) : null}
                  {verdict.level === "procedure_done" ? (
                    <p data-testid="verdict-conditional" className="rounded-sb-m border-l-4 border-sb-v-done-fg bg-sb-sunken px-3 py-2 font-bold text-sb-ink">
                      {CONDITIONAL_NOTE}
                      {permitNotes && verdict.done.length > 0 && verdict.done.every((d) => permitNotes.applied[d.itemId] !== undefined)
                        ? [...new Set(verdict.done.map((d) => permitNotes.applied[d.itemId]))].join("")
                        : PERMIT_SCOPE_NOT_VERIFIED_NOTE}
                    </p>
                  ) : null}
                </div>
              ) : null}
              <p className="sb-lead !text-sb-ink">{tidyEngineText(VERDICT_HELP[verdict.level])}</p>
            </>
          ) : failed ? (
            <div data-testid="verdict-failed" role="alert" className="flex flex-col gap-2.5">
              <div className="flex items-center gap-3">
                <div className="sb-v-big sb-vb-unknown" aria-hidden>
                  <VerdictSign level="unknown" className="" />
                </div>
                <div className="min-w-0">
                  <p id="verdict-heading" tabIndex={-1} data-note="" className="sb-v-eyebrow">
                    {VERDICT_SECTION_TITLE.conclusion}
                  </p>
                  {total ? (
                    <p data-testid="judgement-total" data-total-key={total.key} data-stale={total.stale ? "true" : "false"} className="sb-v-total">
                      {total.text}
                    </p>
                  ) : (
                    <p className="sb-v-word">{VERDICT_FAILED_LABEL}</p>
                  )}
                  {meta}
                </div>
              </div>
              <p data-testid="verdict-failed-note" className="text-sb-ink-2">
                {failedNote ?? VERDICT_FAILED_NOTE}
              </p>
              {onRetry ? (
                <PillButton small variant="secondary" data-testid="verdict-retry" onClick={onRetry} className="self-start">
                  {VERDICT_RETRY_LABEL}
                </PillButton>
              ) : null}
            </div>
          ) : (
            <div className="flex items-center gap-3.5">
              <span aria-hidden className="sb-v-big border-2 border-dashed border-sb-edge" />
              <div className="min-w-0">
                <p id="verdict-heading" tabIndex={-1} data-note="" className="sb-v-eyebrow">
                  {VERDICT_SECTION_TITLE.conclusion}
                </p>
                <p data-testid="verdict-pending" className="sb-v-word !text-sb-ink-3" role="status">
                  {VERDICT_PENDING_LABEL}
                </p>
                {meta}
              </div>
            </div>
          )}
          {ready && evidence ? (
            <div className="flex flex-col gap-1.5 border-t border-sb-rule pt-2.5" data-testid="verdict-evidence">
              <p className="flex flex-wrap items-center gap-2">
                <span data-note="" className="sb-tag" data-testid="verdict-checked-date">
                  確認日 <span className="sb-num">{evidence.checkedDate ?? "—"}</span>
                </span>
                <span data-note="" className="sb-tag" data-testid="verdict-sourced">
                  出典つき{evidence.sourced > 0 ? <span className="sb-num">（{evidence.sourced} 件）</span> : null}
                </span>
              </p>
              <p data-note="" className="text-sm leading-snug text-sb-ink-2" data-testid="verdict-responsibility">
                {RESPONSIBILITY_NOTE}
                {verdict.level === "procedure_done" ? <> {DONE_RECORD_NOTE}</> : null}
              </p>
            </div>
          ) : null}
          {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
        </div>
      </div>
      ) : null}

      {showDetails && ready ? (
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
                    data-state="danger"
                    className="sb-vcard flex items-start gap-2.5 py-3 pl-[22px] pr-4 text-sb-ink"
                  >
                    <span className="pt-0.5">
                      <VerdictSign level="no_fly" />
                    </span>
                    <span>
                      <span className="font-medium">{n.title}</span>
                      <span className="block text-sb-ink-2">{tidyEngineText(n.reason)}</span>
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
              <p className="text-sb-ink-3">要手続きの手続きはありません。</p>
            ) : (
              <div className="overflow-x-auto">
                <table
                  data-testid="verdict-procedures"
                  className="block w-full text-left text-sm md:table md:min-w-[640px] md:border-separate md:border-spacing-y-1"
                >
                  <thead className="max-md:hidden">
                    <tr className="text-sm tracking-[0.08em] text-sb-ink-3">
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
                  <tbody className="flex flex-col gap-2 md:table-row-group">
                    {verdict.procedures.map((p, i) => {
                      const countdown = deadlineCountdown(p.deadline.date);
                      const edge = VERDICT_EDGE[isConfirmProcedure(p.id) ? "unknown" : "needs_procedure"];
                      // 768px 以上は表の行、狭い幅は 1 件ずつの「判定の帯のカード」（面＋左端 6px の帯。手続き名 → 出す先と法的な重さ（2 列）→ 期限）。
                      const cell =
                        "block bg-transparent py-0.5 pr-2 align-top max-md:py-px md:table-cell md:border-y md:border-sb-rule md:bg-sb-base md:py-2.5";
                      const labelled =
                        "max-md:before:mb-0.5 max-md:before:block max-md:before:text-sm max-md:before:tracking-[0.08em] max-md:before:text-sb-ink-3 max-md:before:content-[attr(data-label)]";
                      return (
                        <tr
                          key={p.id}
                          data-testid="verdict-procedure"
                          data-procedure-id={p.id}
                          data-item-id={p.itemId}
                          data-legal-tier={p.legalTier}
                          data-deadline-date={p.deadline.date ?? ""}
                          {...(isConfirmProcedure(p.id) ? {} : { "data-state": "warn" })}
                          className="sb-vrow grid grid-cols-[2rem_minmax(0,1fr)_auto] rounded-sb-l pb-1 max-md:pl-[6px] md:table-row md:rounded-none md:border-0 md:pb-0"
                        >
                          <td
                            className={`${cell} pl-2.5 pt-2.5 sb-num text-sm font-medium tnum text-sb-ink max-md:pl-1.5 max-md:pt-1.5 max-md:row-span-3 max-md:row-start-1 md:border-l-4 md:pl-3 ${edge}`}
                          >
                            {String(i + 1).padStart(2, "0")}
                            {isConfirmProcedure(p.id) ? (
                              <svg aria-hidden width={14} height={14} viewBox="0 0 24 24" className={`mt-1 block ${VERDICT_TONE.unknown}`}>
                                <VerdictSign level="unknown" />
                              </svg>
                            ) : null}
                          </td>
                          <td className={`${cell} max-md:col-span-2 max-md:col-start-2 max-md:row-start-1 max-md:pt-1.5`}>
                            <span className="text-sm font-medium leading-snug text-sb-ink">{p.title}</span>
                            <ReasonWithReferences
                              reason={p.reason}
                              mode="links"
                              className="mt-0.5 block text-sm leading-normal text-sb-ink-3"
                            />
                          </td>
                          <td data-label={PROCEDURE_COLUMNS[1]} className={`${cell} ${labelled} max-md:col-start-2 max-md:row-start-2 leading-normal text-sb-ink-2`}>
                            {p.submitTo}
                          </td>
                          <td
                            data-testid="verdict-procedure-deadline"
                            data-label={PROCEDURE_COLUMNS[2]}
                            className={`${cell} text-sb-ink max-md:col-span-2 max-md:col-start-2 max-md:row-start-3 max-md:grid max-md:grid-cols-[2.25rem_minmax(0,1fr)] max-md:gap-x-1 max-md:before:whitespace-nowrap max-md:before:text-sm max-md:before:leading-normal max-md:before:text-sb-ink-3 max-md:before:content-[attr(data-label)]`}
                          >
                            <span className="block min-w-0">
                            {p.deadline.date ? (
                              <span className="mb-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                                <span className="sb-num text-sm font-medium tnum text-sb-ink">{p.deadline.date}</span>
                                {countdown ? (
                                  <span className="border border-sb-edge px-1 sb-num text-sm tnum text-sb-ink">
                                    {countdown}
                                  </span>
                                ) : null}
                              </span>
                            ) : null}
                            <span
                              className={`block leading-normal ${p.deadline.date ? "text-sm text-sb-ink-3" : "text-sb-ink"}`}
                            >
                              {p.deadline.label}
                            </span>
                            </span>
                          </td>
                          <td data-label={PROCEDURE_COLUMNS[3]} className={`${cell} ${labelled} max-md:col-start-3 max-md:row-start-2 text-sb-ink-2 md:border-r`}>
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
                    data-state="info"
                    className="sb-vcard flex flex-col gap-2 py-2.5 pl-[18px] pr-3 text-sb-ink-2"
                  >
                    <span className="flex items-start gap-2 font-medium text-sb-ink">
                      <span className="pt-0.5">
                        <VerdictSign level="procedure_done" />
                      </span>
                      <span className="flex-1">{d.title}</span>
                      <span data-note="" className="hidden shrink-0 items-end gap-1.5 text-sm font-normal text-sb-ink-2 sm:inline-flex">
                        <TierGauge tier={d.legalTier} />
                        <span>{legalTierLabel(d.legalTier)}</span>
                      </span>
                    </span>
                    <span className="grid grid-cols-1 gap-x-4 gap-y-0.5 pl-[22px] sm:grid-cols-[auto_1fr]">
                      <span className="text-sb-ink-3">元の判定：</span>
                      <span className="text-sb-ink">{BASE_STATUS_LABEL[d.baseStatus]}</span>
                      <span className="text-sb-ink-3">適用した許可：</span>
                      <span className="text-sb-ink">{d.appliedPermits.map((p) => p.label).join(" / ")}</span>
                    </span>
                    <ul className="ml-[22px] flex flex-col gap-0.5 border-l-2 border-dashed border-sb-v-done-fg pl-2.5">
                      {d.conditions.map((c) => {
                        const replaced = c === PERMIT_SCOPE_NOT_VERIFIED_NOTE ? permitNotes?.applied[d.itemId] : undefined;
                        return (
                          <li key={c} data-testid="verdict-done-condition" {...(replaced ? { "data-permit-registry": "true" } : {})}>
                            ・{replaced ?? tidyEngineText(c)}
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* 飛行の前後に行うこと（点検表。見出しは画面・PDF 共通の VERDICT_SECTION_TITLE.duties。DUTIES_HEADING_SCREEN はその別名） */}
          <div data-testid="verdict-duties-section" className="flex flex-col gap-2">
            <SectionHead count={verdict.perFlightDuties.length}>{DUTIES_HEADING_SCREEN}</SectionHead>
            <ul data-testid="verdict-duties" className="flex flex-col divide-y divide-sb-rule rounded-sb-l bg-sb-base px-4 py-1 shadow-sb">
              {verdict.perFlightDuties.map((d) => (
                <li
                  key={d.id}
                  data-testid="verdict-duty"
                  data-duty-id={d.id}
                  data-kind={d.kind}
                  className="flex flex-col gap-1 py-2 text-sb-ink-2"
                >
                  <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                    <span
                      data-note=""
                      className={`whitespace-nowrap rounded-sb-pill border px-2 py-px text-sm leading-tight ${
                        d.kind === "premise" ? "border-sb-rule text-sb-ink-3" : "border-sb-edge text-sb-ink"
                      }`}
                    >
                      {DUTY_KIND_LABEL[d.kind]}
                    </span>
                    <span className="font-medium text-sb-ink">{tidyEngineText(d.title)}</span>
                  </span>
                  <span className="block text-sb-ink-3">{tidyEngineText(d.detail)}</span>
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
                className="block w-full text-left text-sm md:table md:min-w-[600px] md:border-collapse"
              >
                <thead className="max-md:hidden">
                  <tr className="border-b border-sb-rule text-sm tracking-[0.08em] text-sb-ink-3">
                    <th className="py-1 pl-3 pr-3 font-medium">規制・飛行の条件</th>
                    <th className="py-1 pr-3 font-medium">元の判定</th>
                    <th className="py-1 pr-3 font-medium">適用した許可</th>
                    <th className="py-1 pr-2 font-medium">判定</th>
                  </tr>
                </thead>
                <tbody className="flex flex-col gap-2 md:table-row-group">
                  {verdict.items.map((it) => (
                    <tr
                      key={it.id}
                      data-testid="verdict-item"
                      data-item-id={it.id}
                      data-base-status={it.baseStatus}
                      data-verdict={it.verdict}
                      {...(VERDICT_STATE[it.verdict] ? { "data-state": VERDICT_STATE[it.verdict] } : {})}
                      className="sb-vrow block rounded-sb-l py-2 align-top max-md:flex max-md:flex-wrap max-md:items-baseline max-md:gap-x-4 max-md:gap-y-1 max-md:pl-[18px] md:table-row md:rounded-none md:border-b md:border-sb-rule md:py-0"
                    >
                      <td className={`block pr-2 text-sb-ink max-md:basis-full md:table-cell md:border-l-2 md:py-1.5 md:pl-3 ${VERDICT_EDGE[it.verdict]}`}>
                        {it.title}
                        {permitNotes?.item[it.id] ? (
                          <span data-testid="verdict-item-permit-note" className="mt-0.5 block text-sm leading-relaxed text-sb-ink-2">
                            {permitNotes.item[it.id]}
                          </span>
                        ) : null}
                        {hasModelAircraftReferences(it.reason) ? (
                          <ReasonWithReferences
                            reason={it.reason}
                            testId="verdict-item-reason"
                            mode="pointer"
                            className="mt-0.5 block text-sm leading-relaxed text-sb-ink-3"
                          />
                        ) : null}
                      </td>
                      <td data-label="元の判定" className={`${ITEM_CELL} text-sb-ink-2`}>
                        {baseStatusDisplay(it)}
                      </td>
                      <td data-label="適用した許可" className={`${ITEM_CELL} text-sb-ink-2`}>
                        {it.appliedPermits.length > 0 ? it.appliedPermits.map((p) => p.label).join(" / ") : "—"}
                      </td>
                      <td data-label="判定" className={`${ITEM_CELL} max-md:basis-full md:whitespace-nowrap md:pr-2`}>
                        <VerdictTag level={it.verdict}>{VERDICT_LABEL[it.verdict]}</VerdictTag>
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
