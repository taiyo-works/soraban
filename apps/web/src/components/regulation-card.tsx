import {
  CONFIDENCE_LABEL,
  summarizeConfidence,
  type RegulationWithStatus,
} from "@soraban/regulations";

type Props = {
  readonly regulation: RegulationWithStatus;
};

const confidenceTone = {
  high: "text-emerald-700 dark:text-emerald-300",
  medium: "text-amber-700 dark:text-amber-300",
  low: "text-rose-700 dark:text-rose-300",
} as const;

const statusBadgeClass = {
  red: "bg-rose-100 text-rose-800 ring-rose-300 dark:bg-rose-950 dark:text-rose-200 dark:ring-rose-800",
  yellow:
    "bg-amber-100 text-amber-800 ring-amber-300 dark:bg-amber-950 dark:text-amber-200 dark:ring-amber-800",
  green:
    "bg-emerald-100 text-emerald-800 ring-emerald-300 dark:bg-emerald-950 dark:text-emerald-200 dark:ring-emerald-800",
  unknown:
    "bg-zinc-100 text-zinc-700 ring-zinc-300 dark:bg-zinc-800 dark:text-zinc-200 dark:ring-zinc-700",
} as const;

const statusLabel = {
  red: "飛行不可",
  yellow: "要確認",
  green: "適用外",
  unknown: "未整備",
} as const;

const sourceTone = {
  国: "bg-indigo-50 text-indigo-700 ring-indigo-200 dark:bg-indigo-950 dark:text-indigo-200 dark:ring-indigo-800",
  都道府県:
    "bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-950 dark:text-sky-200 dark:ring-sky-800",
  市町村:
    "bg-teal-50 text-teal-700 ring-teal-200 dark:bg-teal-950 dark:text-teal-200 dark:ring-teal-800",
} as const;

export function RegulationCard({ regulation }: Props) {
  const exceptions = regulation.clauseGraph.exceptions;
  const confidence = summarizeConfidence(regulation.confidence);
  const verifiedAtDate = regulation.confidence.verifiedAt.slice(0, 10);
  return (
    <article className="flex flex-col gap-3 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm transition-colors hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-700">
      <div className="flex items-center gap-2">
        <span
          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${sourceTone[regulation.source]}`}
        >
          {regulation.source}
        </span>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">{regulation.authority}</span>
        <span
          className={`ml-auto inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${statusBadgeClass[regulation.status]}`}
        >
          {statusLabel[regulation.status]}
        </span>
      </div>
      <h3 className="text-base font-semibold leading-snug text-zinc-900 dark:text-zinc-50">
        {regulation.title}
      </h3>
      <p className="text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
        {regulation.summary}
      </p>
      <p className="text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
        <span className="font-medium text-zinc-700 dark:text-zinc-300">この地点での扱い: </span>
        {regulation.note}
      </p>
      {exceptions.length > 0 ? (
        <details className="rounded-md bg-zinc-50 px-3 py-2 text-xs leading-relaxed text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
          <summary className="cursor-pointer font-medium text-zinc-700 dark:text-zinc-300">
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
      <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-1 text-xs text-zinc-500 dark:text-zinc-400">
        {regulation.url ? (
          <a
            href={regulation.url}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-zinc-600 underline-offset-2 hover:underline dark:text-zinc-400"
          >
            出典を開く ↗
          </a>
        ) : null}
        {regulation.dataYear ? <span>データ年度: {regulation.dataYear}年</span> : null}
        <span
          title={`ジオメトリ: ${CONFIDENCE_LABEL[regulation.confidence.geometric]} / 抽出: ${CONFIDENCE_LABEL[regulation.confidence.extraction]}`}
          className={confidenceTone[confidence]}
        >
          確信度 {CONFIDENCE_LABEL[confidence]}
        </span>
        <span title="最終検証日">検証 {verifiedAtDate}</span>
      </div>
    </article>
  );
}
