import {
  CONFIDENCE_LABEL,
  formatMachineCondition,
  summarizeConfidence,
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

export function RegulationCard({ regulation }: Props) {
  const exceptions = regulation.clauseGraph.exceptions;
  const confidence = summarizeConfidence(regulation.confidence);
  const verifiedAtDate = regulation.confidence.verifiedAt.slice(0, 10);
  return (
    <article className="flex flex-col gap-3 border border-rule bg-paper p-5 transition-colors hover:border-ink/40">
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
      <p className="border-l border-rule pl-3 text-xs leading-relaxed text-ink-mute">
        <span className="eyebrow !text-[9px]">この地点</span>{" "}
        <span className="text-ink-soft">{regulation.note}</span>
      </p>
      {regulation.appliedExceptions && regulation.appliedExceptions.length > 0 ? (
        <div className="border-l-2 border-signal-green bg-signal-green-soft px-3 py-2 text-[11px] leading-relaxed text-signal-green">
          <p className="eyebrow !text-[9px] !text-signal-green">
            <span aria-hidden>✓ </span>
            適用された例外節
          </p>
          <ul className="mt-1 flex flex-col gap-1">
            {regulation.appliedExceptions.map((ex) => (
              <li key={ex.id} className="leading-snug">
                <span>・{ex.condition}</span>
                {ex.machine ? (
                  <span className="block pl-2.5 font-mono text-[10px] uppercase tracking-wider text-signal-green/70">
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
          <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-wider text-ink-mute">
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
      <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-rule pt-2.5 font-mono text-[10px] uppercase tracking-wider text-ink-mute">
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
          <span className="tnum">{regulation.dataYear} year</span>
        ) : null}
        <span
          title={`ジオメトリ: ${CONFIDENCE_LABEL[regulation.confidence.geometric]} / 抽出: ${CONFIDENCE_LABEL[regulation.confidence.extraction]}`}
          className={confidenceTone[confidence]}
        >
          conf · {CONFIDENCE_LABEL[confidence]}
        </span>
        <span title="最終検証日" className="tnum">
          v · {verifiedAtDate}
        </span>
      </div>
    </article>
  );
}
