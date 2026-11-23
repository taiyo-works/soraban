import Link from "next/link";
import { HOME_BAND_NEXT_ACTION_LIMIT, getToday } from "@/server/ops/today";
import { getSignedInMember } from "@/server/ops/member-gate";
import { OpsBottomNavLazy } from "./ops-bottom-nav-lazy";
import { TodayBadge, TodayNextActions } from "./ops/today-ui";
import { OpsEntryFlag } from "./ops-entry-flag";

// `/` の「ホーム」（運航管理）への入口と「ホーム」の帯（Sprint 12a 設計 J・Sprint 12c 設計 C）。Suspense の内側で描く動的な部分で、`/` の静的なシェルは変えない。
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
        <section aria-label="ホーム" className="sb-block-soft flex flex-col gap-2 !p-3 text-sm" data-testid="home-today-band">
          <h2 className="sb-eyebrow">ホーム</h2>
          {band.card ? (
            <a href={band.card.primary.href} className="flex min-h-12 flex-wrap items-center gap-x-3 gap-y-1 border-b border-sb-rule pb-2 text-sb-ink hover:bg-sb-hover" data-testid="home-today-flight">
              <span className="sb-num tnum">{band.card.timeLabel}</span>
              <span className="min-w-0 flex-1 break-words">{band.card.title}</span>
              <TodayBadge badge={band.card.badge} />
            </a>
          ) : (
            <p className="text-sb-ink-2" data-testid="home-today-empty">
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
          className="sb-pill sb-pill-secondary sb-pill-sm"
        >
          <span className="sb-pill-label">ホームへ</span>
        </Link>
      </p>
      <OpsBottomNavLazy />
    </>
  );
}
