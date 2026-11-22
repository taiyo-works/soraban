// 提供元の表示（Sprint 18-3）。公開の `/` のフッター（site-provider）と運航管理の「このアプリについて」（about-provider）が共有する。
// 値は lib/provider-info.ts の定数だけ（直書きしない）。電話・メールは文字のまま出す（リンクにすると、押す部品の寸法の検査（43.5px）に当たるため）。
// compact：公開の `/` のフッター用（画面の長さの上限を守るため、14px・詰めた行間。16px にしない理由は sprint-18.md §12.3）。
// links：運航管理の「このアプリについて」だけ、電話・メールを 48px 以上の tel:・mailto: の行にする（公開の `/` は文字のまま）。
import { PROVIDER, PROVIDER_ROWS } from "@/lib/provider-info";

export function ProviderInfo({ testId, className = "", compact = false, links = false }: { readonly testId: string; readonly className?: string; readonly compact?: boolean; readonly links?: boolean }) {
  return (
    <dl
      data-testid={testId}
      className={`grid grid-cols-[auto_1fr] gap-x-4 ${compact ? "gap-y-0 text-sm leading-[1.6]" : "items-center gap-y-1 text-base leading-relaxed"} ${className}`}
    >
      {PROVIDER_ROWS.map((r) => (
        <div key={r.key} className="contents" data-testid={r.testId}>
          <dt className="whitespace-nowrap text-sb-ink-3">{r.label}</dt>
          <dd className="min-w-0 break-words text-sb-ink">
            {links && (r.key === "phone" || r.key === "email") ? (
              <a
                href={r.key === "phone" ? `tel:${PROVIDER.phone}` : `mailto:${PROVIDER.email}`}
                className="inline-flex min-h-12 items-center underline decoration-sb-primary decoration-2 underline-offset-4"
              >
                {r.value}
              </a>
            ) : (
              r.value
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
