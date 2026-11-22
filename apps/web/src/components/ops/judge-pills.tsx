import { PillLink } from "@/components/ui/sb-parts";

/**
 * 判定への入口（ホームの上部と、計画の作成画面の上部）。「現在地で判定」「場所を調べる」の 2 つのピル（高さ 48px 以上、2 列、間 8px）。
 * 行き先は判定画面 `/` の入口（`?start=here`・`?start=search`）。押しても位置は取らない：`/` 側でボタン（住所の欄）にフォーカスが移るだけで、
 * 位置を取るかは利用者がそこで押して決める（docs/sprints/sprint-12h-pr3.md §5.1）。判定は下タブに置かないので、スマホではここが入口になる。
 * サーバー・クライアントのどちらからも使える（描くだけ）。
 */
export function JudgePills({ testId = "judge-pills", lead = "飛ばす前に、地点を判定する" }: { readonly testId?: string; readonly lead?: string }) {
  return (
    <section aria-label="地点を判定する" className="flex flex-col gap-2" data-testid={testId}>
      <p className="text-[0.875rem] font-bold text-sb-ink-2">{lead}</p>
      <div className="grid grid-cols-2 gap-2 sm:max-w-md">
        <PillLink small block icon="locate" className="sb-pill-tight" href="/?start=here" data-testid="judge-pill-here">
          現在地で判定
        </PillLink>
        <PillLink small block className="sb-pill-tight" href="/?start=search" data-testid="judge-pill-search">
          場所を調べる
        </PillLink>
      </div>
    </section>
  );
}
