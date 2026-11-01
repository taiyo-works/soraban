// 提供元の表示（Sprint 18-3）。公開の `/` のフッター（site-provider）と運航管理の「このアプリについて」（about-provider）が共有する。
// 値は lib/provider-info.ts の定数だけ（直書きしない）。電話・メールは押せるリンクにする（押す部品の寸法の対象にしないため、行の中の文字リンク）。
import { PROVIDER, PROVIDER_ROWS } from "@/lib/provider-info";

export function ProviderInfo({ testId, className = "" }: { readonly testId: string; readonly className?: string }) {
  return (
    <dl data-testid={testId} className={`grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[14px] leading-relaxed ${className}`}>
      {PROVIDER_ROWS.map((r) => (
        <div key={r.key} className="contents" data-testid={r.testId}>
          <dt className="whitespace-nowrap text-sb-ink-3">{r.label}</dt>
          <dd className="min-w-0 break-words text-sb-ink">
            {r.key === "email" ? (
              <a href={`mailto:${PROVIDER.email}`} className="underline decoration-sb-orange decoration-2 underline-offset-4">
                {r.value}
              </a>
            ) : r.key === "phone" ? (
              <a href={`tel:${PROVIDER.phone}`} className="underline decoration-sb-orange decoration-2 underline-offset-4">
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
