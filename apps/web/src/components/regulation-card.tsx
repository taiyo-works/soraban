import {
  AIRPORT_MLIT_PERMIT_NOT_APPLIED_NOTE,
  CONFIDENCE_LABEL,
  formatMachineCondition,
  getDataset,
  shouldShowAirportMlitNote,
  summarizeConfidence,
  type DidDetail,
  type RegulationWithStatus,
  type VerdictItem,
} from "@soraban/regulations";
import { PROVISIONAL_ITEM_NOTE, baseStatusDisplay, regulationBaseLabel, isModelAircraftDidExcluded, regulationNoteDisplay, MODEL_AIRCRAFT_DID_DETAIL_LABEL, EXCLUDED_BY_WEIGHT_HEADING, EXCLUDED_HEADING, statusBeforeExclusionLine, legalTierLabel, VERDICT_EDGE, VERDICT_LABEL } from "@/lib/verdict-display";
import { TierGauge } from "./verdict-mark";
import { Disclosure, VerdictTag } from "./ui/sb-parts";

type Props = {
  readonly regulation: RegulationWithStatus;
  /** この判定に使った取得済みの許可（表示の補足を出すかどうかだけに使う）。 */
  readonly pilotPermits?: readonly string[];
  /** この規制の判定（Sprint 11d。元の判定 → 適用した許可 → 判定）。 */
  readonly verdictItem?: VerdictItem;
  /**
   * 結論が確定していない（判定中・判定できません）。地点だけの判定の札を出さず、注記を出す（差し戻し 3 回目）。
   */
  readonly provisional?: boolean;
};

// 確信度のトーン: ブランド藍と信号色のみ使用。zinc/amber/emerald の混入を避ける。
const confidenceTone = {
  high: "text-sb-v-none-fg",
  medium: "text-sb-v-needs-fg",
  low: "text-sb-v-no-fg",
} as const;

// ステータスバッジ: 塗りでなく細い枠線で表現。LED 感を消し製図インクに寄せる。
const statusBadgeClass = {
  red: "border-sb-v-no-fg text-sb-v-no-fg bg-sb-surface",
  yellow: "border-sb-v-needs-fg text-sb-v-needs-fg bg-sb-surface",
  green: "border-sb-v-none-fg text-sb-v-none-fg bg-sb-surface",
  unknown: "border-sb-rule text-sb-ink-3 bg-sb-surface",
} as const;

// Sprint 11d：札は元の判定（BASE_STATUS_LABEL：該当／該当の可能性（要確認）／非該当／判定不能（データ未整備））。
// 判定（4 段）は札の下の「元の判定 → 適用した許可 → 判定」の行に出す。

// 出典バッジ: ブランド藍 1 系統で塗り/抜き/罫線の 3 段階に分ける。
const sourceTone = {
  国: "border-sb-edge text-sb-ink",
  都道府県: "border-sb-ink text-sb-ink",
  市町村: "border-sb-rule text-sb-ink-2",
} as const;

// DID の判定詳細の表示（「非該当（工業専用地域）」「除外未確認」を区別する）。
const DID_DETAIL_LABEL: Readonly<Record<DidDetail, string>> = {
  no_data: "DID：未確認（データなし）",
  outside_did: "DID：非該当",
  industrial_exclusive: "DID：非該当（工業専用地域）",
  in_did: "DID：該当",
  in_did_near_industrial_boundary: "DID：該当（工業専用地域の境界付近）",
  in_did_exclusion_unverified: "DID：該当（工業専用地域の除外：未確認）",
};

// DID 判定詳細の左罫線の色。文言に結論を含めたうえで、罫線は補助として信号色に揃える。
const DID_DETAIL_TONE: Readonly<Record<DidDetail, string>> = {
  no_data: "border-sb-v-needs-fg",
  outside_did: "border-sb-rule",
  industrial_exclusive: "border-sb-v-none-fg",
  in_did: "border-sb-v-no-fg",
  in_did_near_industrial_boundary: "border-sb-v-no-fg",
  in_did_exclusion_unverified: "border-sb-v-needs-fg",
};

/** 台帳の版（データセット台帳 sources.json の version）。台帳から引けないときは出さない。 */
const datasetVersion = (id: string): string | undefined => {
  try {
    return getDataset(id).version;
  } catch {
    return undefined;
  }
};

export function RegulationCard({ regulation, pilotPermits, verdictItem, provisional = false }: Props) {
  const exceptions = regulation.clauseGraph.exceptions;
  const confidence = summarizeConfidence(regulation.confidence);
  const verifiedAtDate = regulation.confidence.verifiedAt.slice(0, 10);
  const latestDataVerified = regulation.datasets
    .map((d) => d.verifiedAt.slice(0, 10))
    .sort()
    .at(-1);
  return (
    <article
      data-testid={`regulation-card-${regulation.id}`}
      data-status={regulation.status}
      data-verdict={verdictItem?.verdict ?? ""}
      className="sb-item-card flex flex-col gap-2.5"
    >
      <div className="flex items-center gap-2">
        <span
          className={`inline-flex items-center rounded-sb-pill border px-2.5 py-px text-xs font-bold ${sourceTone[regulation.source]}`}
        >
          {regulation.source}
        </span>
        <span className="text-xs text-sb-ink-3">{regulation.authority}</span>
        <span
          data-testid="regulation-base-status"
          className={`ml-auto inline-flex items-center rounded-sb-pill border-2 px-2.5 py-0.5 text-xs font-bold ${statusBadgeClass[regulation.status]}`}
        >
          {regulationBaseLabel(regulation)}
        </span>
      </div>
      {verdictItem ? (
        <p
          data-testid="regulation-verdict-line"
          className={`flex flex-wrap items-center gap-x-1.5 gap-y-1 rounded-sb-m border border-l-4 border-sb-rule py-1.5 pl-2 pr-2 text-xs text-sb-ink-2 ${provisional ? "border-l-sb-rule" : VERDICT_EDGE[verdictItem.verdict]}`}
        >
          <span>元の判定 {baseStatusDisplay(verdictItem)}</span>
          <span aria-hidden>→</span>
          <span>
            適用した許可{" "}
            {verdictItem.appliedPermits.length > 0
              ? verdictItem.appliedPermits.map((p) => p.label).join(" / ")
              : "なし"}
          </span>
          <span aria-hidden>→</span>
          {provisional ? (
            <span data-testid="regulation-verdict-provisional" className="font-medium text-sb-ink-3">
              {PROVISIONAL_ITEM_NOTE}
            </span>
          ) : (
            <VerdictTag level={verdictItem.verdict} testId="regulation-verdict">
              {VERDICT_LABEL[verdictItem.verdict]}
            </VerdictTag>
          )}
          <span className="ml-auto inline-flex items-end gap-1 text-sb-ink-3">
            <TierGauge tier={regulation.legalTier} />
            <span className="leading-none">{legalTierLabel(regulation.legalTier)}</span>
          </span>
        </p>
      ) : null}
      <h3 className="text-base font-bold leading-snug text-sb-ink">
        {regulation.title}
      </h3>
      {regulation.didDetail ? (
        <p
          data-testid="did-detail"
          className={`border-l-2 pl-3 text-xs font-medium leading-relaxed text-sb-ink ${isModelAircraftDidExcluded(regulation) ? "border-sb-rule" : DID_DETAIL_TONE[regulation.didDetail]}`}
        >
          {isModelAircraftDidExcluded(regulation) ? MODEL_AIRCRAFT_DID_DETAIL_LABEL : DID_DETAIL_LABEL[regulation.didDetail]}
        </p>
      ) : null}
      <p className="border-l border-sb-rule pl-3 text-xs leading-relaxed text-sb-ink-3">
        <span className="sb-eyebrow">この地点</span>{" "}
        <span className="text-sb-ink-2">{regulationNoteDisplay(regulation)}</span>
      </p>
      {shouldShowAirportMlitNote(regulation, pilotPermits) ? (
        <p
          data-testid="airport-mlit-note"
          className="rounded-sb-m border-l-4 border-sb-v-needs-fg bg-sb-surface px-3 py-2 text-xs leading-relaxed text-sb-ink-2"
        >
          <span className="sb-eyebrow block ">入力した許可について</span>{" "}
          {AIRPORT_MLIT_PERMIT_NOT_APPLIED_NOTE}
        </p>
      ) : null}
      {verdictItem && verdictItem.appliedPermits.length > 0 ? (
        <div
          data-testid="regulation-applied-permits"
          className="rounded-sb-m border-l-4 border-sb-ink bg-sb-hover px-3 py-2 text-xs leading-relaxed text-sb-ink-2"
        >
          <p className="sb-eyebrow">適用した許可・同意・目的（元の判定は変えない）</p>
          <ul className="mt-1 flex flex-col gap-1">
            {verdictItem.appliedPermits.map((p) => (
              <li key={p.id} className="leading-snug">
                <span>・{p.condition}</span>
                {p.machine ? (
                  <span className="block pl-2.5 text-xs tracking-wide text-sb-ink-3">{p.machine}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {regulation.appliedExceptions && regulation.appliedExceptions.length > 0 ? (
        <div
          data-testid="regulation-excluded"
          className="rounded-sb-m border-l-4 border-sb-v-none-fg bg-sb-surface px-3 py-2 text-xs leading-relaxed text-sb-v-none-fg"
        >
          <p className="sb-eyebrow !text-sb-v-none-fg">
            {regulation.statusBeforeExclusion !== undefined ? EXCLUDED_BY_WEIGHT_HEADING : EXCLUDED_HEADING}
          </p>
          {regulation.statusBeforeExclusion !== undefined ? (
            <p data-testid="regulation-status-before-exclusion" className="mt-1 font-medium leading-snug">
              {statusBeforeExclusionLine(regulation.statusBeforeExclusion)}
            </p>
          ) : null}
          <ul className="mt-1 flex flex-col gap-1">
            {regulation.appliedExceptions.map((ex) => (
              <li key={ex.id} className="leading-snug">
                <span>・{ex.condition}</span>
                {ex.machine ? (
                  <span className="block pl-2.5 text-xs tracking-wide text-sb-v-none-fg">
                    {formatMachineCondition(ex.machine)}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {/* 説明・使用データ・版・改正・例外節は「根拠の詳細」に畳む。出典・確認日・確からしさは下の 1 行に常に出す */}
      <Disclosure
        variant="plain"
        testId="regulation-detail"
        title="根拠の詳細"
        note="説明・使用データ・版・改正"
      >
        <p className="text-xs leading-relaxed text-sb-ink-2" data-testid="regulation-summary">
          {regulation.summary}
        </p>
        {exceptions.length > 0 ? (
          <div data-testid="regulation-exceptions" className="flex flex-col gap-1 text-xs leading-relaxed text-sb-ink-2">
            <p className="sb-eyebrow">例外節 {exceptions.length} 件</p>
            <ul className="flex flex-col gap-1.5">
              {exceptions.map((ex) => (
                <li key={ex.id} className="leading-snug">
                  ・{ex.condition}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      {/* データ出典と確認日（Sprint 7）・反映済みの改正。判定本文と区別するため脚注として置く */}
      <div
        data-testid="regulation-datasets"
        className="sb-block-soft flex flex-col gap-2 !p-3 text-xs leading-relaxed text-sb-ink-3"
      >
        <p className="text-sm font-bold text-sb-ink">根拠（使用データ・確認日・版・反映済みの改正・出典）</p>
        <div>
          <p className="sb-eyebrow">使用データ</p>
          <ul className="mt-0.5 flex flex-col gap-0.5">
            {regulation.datasets.map((d) => (
              <li key={d.id}>
                <span className="text-sb-ink-2">{d.name}</span>
                <span className="tnum">
                  {d.baseYear !== null ? `（基準年 ${d.baseYear}）` : ""}・確認日 {d.verifiedAt}
                  {datasetVersion(d.id) ? `・版 ${datasetVersion(d.id)}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
        {regulation.amendments.length > 0 ? (
          <div>
            <p className="sb-eyebrow">反映済みの改正</p>
            <ul className="mt-0.5 flex flex-col gap-0.5">
              {regulation.amendments.map((a) => (
                <li key={a.id}>
                  <a
                    href={a.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-11 min-w-11 items-center text-sb-ink underline decoration-sb-primary decoration-2 underline-offset-4"
                  >
                    {a.title}
                  </a>
                  <span className="tnum">（施行・適用 {a.effectiveDate}）</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
      </Disclosure>
      <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-sb-rule pt-2.5 text-xs tracking-wide text-sb-ink-3">
        {regulation.url ? (
          <a
            href={regulation.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 min-w-11 items-center font-bold text-sb-ink underline decoration-sb-primary decoration-2 underline-offset-4"
          >
            出典 ↗
          </a>
        ) : null}
        {latestDataVerified ? (
          <span title="使用データの確認日のうち最も新しい日" className="tnum" data-testid="regulation-data-verified">
            確認日 {latestDataVerified}
          </span>
        ) : null}
        {regulation.dataYear ? (
          <span className="tnum">基準年 {regulation.dataYear}</span>
        ) : null}
        <span
          title={`区域の位置: ${CONFIDENCE_LABEL[regulation.confidence.geometric]} / 条文の読み取り: ${CONFIDENCE_LABEL[regulation.confidence.extraction]}`}
          className={confidenceTone[confidence]}
        >
          確からしさ {CONFIDENCE_LABEL[confidence]}
        </span>
        <span
          title="条文・規制内容を確認した日（使用データの確認日は上の「使用データ」欄）"
          className="normal-case tracking-normal tnum"
        >
          条文確認 {verifiedAtDate}
        </span>
      </div>
    </article>
  );
}
