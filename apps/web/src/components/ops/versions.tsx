import type { VersionDto } from "@/server/ops/service";
import { OP_LABELS } from "@/server/ops/page";
import { Badge, OP_TONE, Section } from "./ui";

// 詳細画面の版の一覧（版番号、操作、訂正者、日時（JST、分まで）、理由、変わった項目名）。
// 狭い画面でも横スクロールしないよう、表ではなく項目の並びで示す。古い版から順に並べる（台帳と同じ向き）。
export function VersionList({ versions }: { readonly versions: readonly VersionDto[] }) {
  return (
    <Section
      title="版の一覧"
      aria-label="版の一覧"
      description="登録・訂正・取消のたびに版が 1 つ増えます。前の版は書き換えられず、誰がいつ何を変えたかが残ります。"
    >
      <ol className="flex flex-col border-t border-rule" data-testid="version-list">
        {versions.map((v) => (
          <li
            key={v.versionNo}
            className="grid grid-cols-1 gap-2 border-b border-rule-soft py-3 text-sm sm:grid-cols-[7.5rem_minmax(0,1fr)] sm:gap-4"
            data-testid="version-row"
          >
            <div className="flex items-center gap-2 sm:flex-col sm:items-start sm:gap-1.5">
              <span className="font-mono text-xs tnum text-ink-mute">版 {v.versionNo}</span>
              <Badge tone={OP_TONE[v.op]} data-testid="version-op">
                {OP_LABELS[v.op]}
              </Badge>
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <p className="flex flex-wrap items-baseline gap-x-4 gap-y-0.5 text-ink">
                <span className="flex items-baseline gap-1.5">
                  <span className="text-xs text-ink-mute">日時</span>
                  <time dateTime={v.createdAt} className="font-mono text-[13px] tnum" data-testid="version-time">
                    {v.createdAtJst}
                  </time>
                </span>
                <span className="flex min-w-0 items-baseline gap-1.5">
                  <span className="shrink-0 text-xs text-ink-mute">操作した人</span>
                  <span className="break-all" data-testid="version-actor">
                    {v.actorName}
                  </span>
                </span>
              </p>
              {v.reason ? (
                <p className="break-all leading-relaxed text-ink-soft" data-testid="version-reason">
                  <span className="text-xs text-ink-mute">理由：</span>
                  {v.reason}
                </p>
              ) : null}
              {v.changedFields.length > 0 ? (
                <p className="leading-relaxed text-ink-soft" data-testid="version-changed">
                  <span className="text-xs text-ink-mute">変わった項目：</span>
                  {v.changedFields.join("、")}
                </p>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    </Section>
  );
}

export function Forbidden() {
  return (
    <main className="flex max-w-xl flex-col gap-4">
      <h1 className="font-display text-2xl font-light leading-tight text-ink sm:text-3xl">権限がありません</h1>
      <p className="border-l-2 border-brand-700 pl-3 text-sm leading-relaxed text-ink-soft">
        この操作は運航管理者だけが行えます。
      </p>
    </main>
  );
}
