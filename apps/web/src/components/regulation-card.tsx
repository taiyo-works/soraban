import type { RegulationWithStatus } from "@soraban/regulations";

type Props = {
  readonly regulation: RegulationWithStatus;
};

const statusBadgeClass = {
  red: "bg-rose-100 text-rose-800 ring-rose-300 dark:bg-rose-950 dark:text-rose-200 dark:ring-rose-800",
  yellow:
    "bg-amber-100 text-amber-800 ring-amber-300 dark:bg-amber-950 dark:text-amber-200 dark:ring-amber-800",
  green:
    "bg-emerald-100 text-emerald-800 ring-emerald-300 dark:bg-emerald-950 dark:text-emerald-200 dark:ring-emerald-800",
} as const;

const statusLabel = {
  red: "飛行不可",
  yellow: "要確認",
  green: "適用外",
} as const;

const sourceTone = {
  国: "bg-indigo-50 text-indigo-700 ring-indigo-200 dark:bg-indigo-950 dark:text-indigo-200 dark:ring-indigo-800",
  都道府県:
    "bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-950 dark:text-sky-200 dark:ring-sky-800",
  市町村:
    "bg-teal-50 text-teal-700 ring-teal-200 dark:bg-teal-950 dark:text-teal-200 dark:ring-teal-800",
} as const;

export function RegulationCard({ regulation }: Props) {
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
      {regulation.url ? (
        <a
          href={regulation.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs font-medium text-zinc-600 underline-offset-2 hover:underline dark:text-zinc-400"
        >
          出典を開く ↗
        </a>
      ) : null}
    </article>
  );
}
