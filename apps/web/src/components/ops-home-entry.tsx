import Link from "next/link";
import { HOME_BAND_NEXT_ACTION_LIMIT, getToday } from "@/server/ops/today";
import { getSignedInMember } from "@/server/ops/member-gate";
import { OpsBottomNav } from "./ops/ops-nav";
import { TodayBadge, TodayNextActions } from "./ops/today-ui";
import { OpsEntryFlag } from "./ops-entry-flag";

// `/` の「運航管理」への入口と「今日」の帯（Sprint 12a 設計 J・Sprint 12c 設計 C）。Suspense の内側で描く動的な部分で、`/` の静的なシェルは変えない。
// 運航管理が無効（OPS_ENABLED でない）・設定不足・未ログイン・利用者でないときは何も描かない（追加の通信もない）。
// 有効でログイン済みの利用者にだけ、今日の飛行 1 行と次にやること上位 3 件、リンク、下メニュー、
// 判定結果のボタンを出してよいという印（OpsEntryFlag）を描く。`/` は自動で転送しない。
export async function OpsHomeEntry() {
  const ctx = await getSignedInMember();
  if (!ctx) return null;
  // 「今日」の帯は付け足し。取得に失敗しても、12a の入口（リンクとボタンの印）は変えない。
  let band: Awaited<ReturnType<typeof getToday>> | null = null;
  try {
    band = await getToday(ctx, { limit: HOME_BAND_NEXT_ACTION_LIMIT });
  } catch {
    band = null;
  }
  return (
    <>
      <OpsEntryFlag />
      {band ? (
        <section aria-label="今日" className="flex flex-col gap-2 border-l-2 border-brand-700 pl-3 text-sm" data-testid="home-today-band">
          <h2 className="eyebrow !text-[10px]">今日</h2>
          {band.card ? (
            <a href={band.card.primary.href} className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 border-b border-rule-soft pb-2 text-ink hover:bg-paper-soft" data-testid="home-today-flight">
              <span className="font-mono tnum">{band.card.timeLabel}</span>
              <span className="min-w-0 flex-1 break-words">{band.card.title}</span>
              <TodayBadge badge={band.card.badge} />
            </a>
          ) : (
            <p className="text-ink-soft" data-testid="home-today-empty">
              {band.empty?.message}
            </p>
          )}
          <TodayNextActions actions={band.nextActions} heading={false} />
        </section>
      ) : null}
      <p className="text-sm">
        <Link
          href="/ops"
          prefetch={false}
          data-testid="home-ops-link"
          className="inline-flex min-h-11 items-center gap-2 rounded-sharp border border-brand-700 bg-paper px-4 font-medium text-brand-700 transition-colors hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
        >
          運航管理へ
          <span aria-hidden>→</span>
        </Link>
      </p>
      <OpsBottomNav />
    </>
  );
}
