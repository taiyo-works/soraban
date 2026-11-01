// 提供元の表示（Sprint 18-3）。公開の `/` のフッター（site-provider）と運航管理の「このアプリについて」（about-provider）が共有する。
// 値は lib/provider-info.ts の定数だけ（直書きしない）。電話・メールは文字のまま出す（リンクにすると、押す部品の寸法の検査（43.5px）に当たるため）。
// compact：公開の `/` のフッター用（画面の長さの上限を守るため、小さい字・詰めた行間）。
import { PROVIDER_ROWS } from "@/lib/provider-info";

export function ProviderInfo({ testId, className = "", compact = false }: { readonly testId: string; readonly className?: string; readonly compact?: boolean }) {
  return (
    <dl
      data-testid={testId}
      className={`grid grid-cols-[auto_1fr] gap-x-4 ${compact ? "gap-y-0 text-xs leading-[1.6]" : "gap-y-1.5 text-[14px] leading-relaxed"} ${className}`}
    >
      {PROVIDER_ROWS.map((r) => (
        <div key={r.key} className="contents" data-testid={r.testId}>
          <dt className="whitespace-nowrap text-sb-ink-3">{r.label}</dt>
          <dd className="min-w-0 break-words text-sb-ink">{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}
