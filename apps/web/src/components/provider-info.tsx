// 提供元の表示（Sprint 18-3）。公開の `/` のフッター（site-provider）と運航管理の「このアプリについて」（about-provider）が共有する。
// 値は lib/provider-info.ts の定数だけ（直書きしない）。電話・メールは文字のまま出す（リンクにすると、押す部品の寸法の検査（43.5px）に当たるため）。
// compact：公開の `/` のフッター用。連絡先（所在地・電話・メール）は本文 16px・1.7（16-C の振り分け。迷うものは本文）。提供元の名称・代表者・受付時間は注記として 14px・1.6（data-note）。
// links：運航管理の「このアプリについて」だけ、電話・メールを 48px 以上の tel:・mailto: の行にする（公開の `/` は文字のまま）。
import { PROVIDER, PROVIDER_ROWS } from "@/lib/provider-info";

export function ProviderInfo({ testId, className = "", compact = false, links = false }: { readonly testId: string; readonly className?: string; readonly compact?: boolean; readonly links?: boolean }) {
  return (
    <dl
      data-testid={testId}
      className={`grid grid-cols-[auto_1fr] gap-x-4 ${compact ? "gap-y-0 text-sm leading-[1.6]" : "items-center gap-y-1 text-base leading-relaxed"} ${className}`}
    >
      {PROVIDER_ROWS.map((r) => {
        const contact = r.key === "location" || r.key === "phone" || r.key === "email";
        const note = compact && !contact;
        return (
        <div key={r.key} className="contents" data-testid={r.testId}>
          <dt className="whitespace-nowrap text-sb-ink-3">{r.label}</dt>
          <dd {...(note ? { "data-note": "" } : {})} className={`min-w-0 break-words text-sb-ink ${compact ? (contact ? "text-base leading-[1.7]" : "text-sm leading-[1.6]") : ""}`}>
            {links && (r.key === "phone" || r.key === "email") ? (
              <a
                href={r.key === "phone" ? `tel:${PROVIDER.phone}` : `mailto:${PROVIDER.email}`}
                className="inline-flex min-h-12 max-w-full items-center [overflow-wrap:anywhere] underline decoration-sb-primary decoration-2 underline-offset-4"
              >
                {r.value}
              </a>
            ) : (
              r.value
            )}
          </dd>
        </div>
        );
      })}
    </dl>
  );
}
