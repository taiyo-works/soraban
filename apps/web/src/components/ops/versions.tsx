import type { VersionDto } from "@/server/ops/service";
import { OP_LABELS } from "@/server/ops/page";
import { ChangeNotice } from "./change-notice";
import { Badge, OP_TONE, Section, VERSION_NOTICE_TARGET } from "./ui";

// 詳細画面の版の一覧（版番号、操作、訂正者、日時（JST、分まで）、理由、変わった項目名）。
// 狭い画面でも横スクロールしないよう、表ではなく項目の並びで示す。古い版から順に並べる（台帳と同じ向き）。
// 登録・訂正・取消で読み直した直後は、結果を示して新しい行（最後の行）へスクロールし、フォーカスを移す。
export function VersionList({ versions, recent }: { readonly versions: readonly VersionDto[]; readonly recent?: number }) {
  // recent：最新の N 件だけ出し、古い版は畳む（件数を summary に出す。DOM の順は古い版から新しい版のまま）
  const older = recent !== undefined && versions.length > recent ? versions.slice(0, versions.length - recent) : [];
  const shown = older.length > 0 ? versions.slice(older.length) : versions;
  const row = (v: VersionDto) => (
    <li
          key={v.versionNo}
            className="grid scroll-mt-24 grid-cols-1 gap-1 border-b border-sb-rule py-1.5 text-sm outline-none focus-visible:bg-sb-hover focus-visible:ring-2 focus-visible:ring-sb-focus sm:grid-cols-[7.5rem_minmax(0,1fr)] sm:gap-4"
            data-testid="version-row"
            tabIndex={-1}
          >
            <div className="flex items-center gap-2 sm:flex-col sm:items-start sm:gap-1.5">
              <span className="sb-num text-sm tnum text-sb-ink-3">版 {v.versionNo}</span>
              <Badge tone={OP_TONE[v.op]} data-testid="version-op">
                {OP_LABELS[v.op]}
              </Badge>
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <p className="flex flex-wrap items-baseline gap-x-4 gap-y-0.5 text-sb-ink">
                <span className="flex items-baseline gap-1.5">
                  <span className="text-sm text-sb-ink-3">日時</span>
                  <time dateTime={v.createdAt} className="sb-num text-sm tnum" data-testid="version-time">
                    {v.createdAtJst}
                  </time>
                </span>
                <span className="flex min-w-0 items-baseline gap-1.5">
                  <span className="shrink-0 text-sm text-sb-ink-3">操作した人</span>
                  <span className="break-all" data-testid="version-actor">
                    {v.actorName}
                  </span>
                </span>
              </p>
              {v.reason ? (
                <p className="break-all leading-relaxed text-sb-ink-2" data-testid="version-reason">
                  <span className="text-sm text-sb-ink-3">理由：</span>
                  {v.reason}
                </p>
              ) : null}
              {v.changedFields.length > 0 ? (
                <p className="leading-relaxed text-sb-ink-2" data-testid="version-changed">
                  <span className="text-sm text-sb-ink-3">変わった項目：</span>
                  {v.changedFields.join("、")}
                </p>
              ) : null}
            </div>
          </li>
  );
  return (
    <Section
      title="版の一覧"
      aria-label="版の一覧"
      description={recent === undefined ? "登録・訂正・取消のたびに版が 1 つ増えます。前の版は書き換えられず、誰がいつ何を変えたかが残ります。" : "前の版は書き換えられず、追記されます。"}
    >
      <ChangeNotice target={VERSION_NOTICE_TARGET} focusSelector='[data-testid="version-list"] > [data-testid="version-row"]:last-child' />
      {older.length > 0 ? (
        <details data-testid="version-list-older">
          <summary className="flex min-h-12 cursor-pointer select-none items-center text-sm font-bold text-sb-ink">古い版 {older.length} 件を見る（最新 {shown.length} 件は下に出ています）</summary>
          <ol data-note="" className="flex flex-col border-t border-sb-rule lg:grid lg:grid-cols-2 lg:gap-x-8">{older.map(row)}</ol>
        </details>
      ) : null}
      <ol data-note="" className={`flex flex-col border-t border-sb-rule${recent !== undefined ? " lg:grid lg:grid-cols-2 lg:gap-x-8" : ""}`} data-testid="version-list">
        {shown.map(row)}
      </ol>
    </Section>
  );
}

export function Forbidden({ message = "この操作は運航管理者だけが行えます。" }: { readonly message?: string }) {
  return (
    <main className="flex max-w-xl flex-col gap-4">
      <h1 className="text-2xl font-light leading-tight text-sb-ink sm:text-3xl">権限がありません</h1>
      <p className="opx-note">{message}</p>
    </main>
  );
}
