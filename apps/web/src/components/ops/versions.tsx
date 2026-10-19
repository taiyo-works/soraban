import type { VersionDto } from "@/server/ops/service";
import { OP_LABELS } from "@/server/ops/page";

// 詳細画面の版の一覧（版番号、操作、訂正者、日時（JST、分まで）、理由、変わった項目名）。
// 狭い画面でも横スクロールしないよう、表ではなく項目の並びで示す。
export function VersionList({ versions }: { readonly versions: readonly VersionDto[] }) {
  return (
    <section className="flex flex-col gap-2" aria-label="版の一覧">
      <h2 className="text-base text-ink">版の一覧</h2>
      <ol className="flex flex-col gap-2" data-testid="version-list">
        {versions.map((v) => (
          <li key={v.versionNo} className="flex flex-col gap-0.5 border border-rule px-3 py-2 text-sm" data-testid="version-row">
            <p className="flex flex-wrap gap-x-3">
              <span>版 {v.versionNo}</span>
              <span data-testid="version-op">{OP_LABELS[v.op]}</span>
              <span data-testid="version-actor">{v.actorName}</span>
              <time dateTime={v.createdAt} data-testid="version-time">
                {v.createdAtJst}
              </time>
            </p>
            {v.reason ? <p data-testid="version-reason">理由：{v.reason}</p> : null}
            {v.changedFields.length > 0 ? (
              <p data-testid="version-changed">変わった項目：{v.changedFields.join("、")}</p>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}

export function Forbidden() {
  return (
    <main className="flex flex-col gap-2">
      <h1 className="text-lg text-ink">権限がありません</h1>
      <p className="text-sm text-ink-soft">この操作は運航管理者だけが行えます。</p>
    </main>
  );
}
