import {
  CONFIDENCE_LABEL,
  formatMachineCondition,
  summarizeConfidence,
  type DidDetail,
  type RegulationWithStatus,
} from "@soraban/regulations";

type Props = {
  readonly regulation: RegulationWithStatus;
};

// 確信度のトーン: ブランド藍と信号色のみ使用。zinc/amber/emerald の混入を避ける。
const confidenceTone = {
  high: "text-signal-green",
  medium: "text-signal-amber",
  low: "text-signal-red",
} as const;

// ステータスバッジ: 塗りでなく細い枠線で表現。LED 感を消し製図インクに寄せる。
const statusBadgeClass = {
  red: "border-signal-red text-signal-red bg-signal-red-soft",
  yellow: "border-signal-amber text-signal-amber bg-signal-amber-soft",
  green: "border-signal-green text-signal-green bg-signal-green-soft",
  unknown: "border-rule text-ink-mute bg-paper-soft",
} as const;

const statusLabel = {
  red: "飛行不可",
  yellow: "要確認",
  green: "適用外",
  unknown: "未整備",
} as const;

// 出典バッジ: ブランド藍 1 系統で塗り/抜き/罫線の 3 段階に分ける。
const sourceTone = {
  国: "border-ink text-ink",
  都道府県: "border-brand-700 text-brand-700",
  市町村: "border-rule text-ink-soft",
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
  no_data: "border-signal-amber",
  outside_did: "border-rule",
  industrial_exclusive: "border-signal-green",
  in_did: "border-signal-red",
  in_did_near_industrial_boundary: "border-signal-red",
  in_did_exclusion_unverified: "border-signal-amber",
};

export function RegulationCard({ regulation }: Props) {
  const exceptions = regulation.clauseGraph.exceptions;
  const confidence = summarizeConfidence(regulation.confidence);
  const verifiedAtDate = regulation.confidence.verifiedAt.slice(0, 10);
  return (
    <article
      data-testid={`regulation-card-${regulation.id}`}
      data-status={regulation.status}
      className="flex flex-col gap-3 border border-rule bg-paper p-5 transition-colors hover:border-ink/40"
    >
      <div className="flex items-center gap-2">
        <span
          className={`inline-flex items-center border px-1.5 py-px text-[10px] font-medium uppercase tracking-wider ${sourceTone[regulation.source]}`}
        >
          {regulation.source}
        </span>
        <span className="text-[11px] text-ink-mute">{regulation.authority}</span>
        <span
          className={`ml-auto inline-flex items-center border px-2 py-0.5 text-[11px] font-semibold ${statusBadgeClass[regulation.status]}`}
        >
          {statusLabel[regulation.status]}
        </span>
      </div>
      <h3 className="font-display text-base font-medium leading-snug text-ink">
        {regulation.title}
      </h3>
      <p className="text-xs leading-relaxed text-ink-soft">
        {regulation.summary}
      </p>
      {regulation.didDetail ? (
        <p
          data-testid="did-detail"
          className={`border-l-2 pl-3 text-xs font-medium leading-relaxed text-ink ${DID_DETAIL_TONE[regulation.didDetail]}`}
        >
          {DID_DETAIL_LABEL[regulation.didDetail]}
        </p>
      ) : null}
      <p className="border-l border-rule pl-3 text-xs leading-relaxed text-ink-mute">
        <span className="eyebrow !text-[11px]">この地点</span>{" "}
        <span className="text-ink-soft">{regulation.note}</span>
      </p>
      {regulation.appliedExceptions && regulation.appliedExceptions.length > 0 ? (
        <div className="border-l-2 border-signal-green bg-signal-green-soft px-3 py-2 text-[11px] leading-relaxed text-signal-green">
          <p className="eyebrow !text-[11px] !text-signal-green">
            <span aria-hidden>✓ </span>
            適用された例外節
          </p>
          <ul className="mt-1 flex flex-col gap-1">
            {regulation.appliedExceptions.map((ex) => (
              <li key={ex.id} className="leading-snug">
                <span>・{ex.condition}</span>
                {ex.machine ? (
                  <span className="block pl-2.5 text-[11px] tracking-wide text-signal-green/70">
                    {formatMachineCondition(ex.machine)}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-[10px] text-ink-mute">
            このため status を一段降格しました
          </p>
        </div>
      ) : null}
      {exceptions.length > 0 ? (
        <details className="border border-rule bg-paper-soft px-3 py-2 text-[11px] leading-relaxed text-ink-soft">
          <summary className="cursor-pointer text-[11px] tracking-wide text-ink-mute">
            例外節 {exceptions.length} 件
          </summary>
          <ul className="mt-2 flex flex-col gap-1.5">
            {exceptions.map((ex) => (
              <li key={ex.id} className="leading-snug">
                ・{ex.condition}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {/* データ出典と確認日（Sprint 7）・反映済みの改正。判定本文と区別するため脚注として置く */}
      <div
        data-testid="regulation-datasets"
        className="flex flex-col gap-1.5 border-t border-dashed border-rule pt-2.5 text-[11px] leading-relaxed text-ink-mute"
      >
        <div>
          <p className="eyebrow !text-[11px]">使用データ</p>
          <ul className="mt-0.5 flex flex-col gap-0.5">
            {regulation.datasets.map((d) => (
              <li key={d.id}>
                <span className="text-ink-soft">{d.name}</span>
                <span className="tnum">
                  {d.baseYear !== null ? `（基準年 ${d.baseYear}）` : ""}・確認日 {d.verifiedAt}
                </span>
              </li>
            ))}
          </ul>
        </div>
        {regulation.amendments.length > 0 ? (
          <div>
            <p className="eyebrow !text-[11px]">反映済みの改正</p>
            <ul className="mt-0.5 flex flex-col gap-0.5">
              {regulation.amendments.map((a) => (
                <li key={a.id}>
                  <a
                    href={a.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-brand-700 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-1 focus-visible:ring-offset-paper"
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
      <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-rule pt-2.5 text-[11px] tracking-wide text-ink-mute">
        {regulation.url ? (
          <a
            href={regulation.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-brand-700 underline-offset-2 hover:underline"
          >
            出典 ↗
          </a>
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
