// スケルトン（Sprint 16-D D-4。見た目は soraban-ui.css の .sb-skel*）。カードの形の静止した帯（動かさない：V-6）。
// 帯は aria-hidden。親に aria-busy="true" と読み上げの文「読み込み中」を持つ。サーバー・クライアントのどちらからも使える（状態を持たない）。

/** 帯 1 本（装飾。aria-hidden）。 */
export function Skeleton({ className = "" }: { readonly className?: string }) {
  return <span aria-hidden="true" className={`sb-skel ${className}`.trim()} />;
}

/** カードの形のスケルトン（タイトルの帯＋本文の帯 lines 本）。親に aria-busy と「読み込み中」。 */
export function SkeletonCard({ lines = 3, testId }: { readonly lines?: number; readonly testId?: string }) {
  return (
    <div className="sb-skel-card" aria-busy="true" {...(testId ? { "data-testid": testId } : {})}>
      <span className="sb-sr">読み込み中</span>
      <Skeleton className="sb-skel-title" />
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className="sb-skel-line" />
      ))}
    </div>
  );
}
