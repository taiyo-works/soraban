import type { Metadata } from "next";
import Link from "next/link";
import { DraftOwnerGuard } from "@/components/ops/ops-client";
import { Icon, type IconName } from "@/components/ui/icons";
import { PageHeader } from "@/components/ops/ui";
import { can } from "@/server/ops/authz";
import { requireOpsMember } from "@/server/ops/page";
import { getRegisterCounts } from "@/server/ops/register-counts";

// 登録（Sprint 12c 設計 G の「その他」を、Sprint 12g-1b で改名）：機体・操縦者・許可・承認・よく使う地点の入口（件数つき）と、
// 管理（利用者。運航管理者のみ）。ログイン中の利用者の名前・役割・ログアウトは、右上の利用者メニューにある。
// 事故・ヒヤリハットは日誌の中へ移した（/ops/journal の「事故・ヒヤリハット」）。期限一覧（12f）の枠は作らない。
// DIPS との接続は未実装（保留）。「未接続」を静かに 1 行で示すだけで、操作も約束もしない。
export const metadata: Metadata = { title: "登録" };

export default async function OpsMorePage() {
  const { ctx, me } = await requireOpsMember();
  const counts = await getRegisterCounts(ctx);
  const items: readonly { readonly href: string; readonly title: string; readonly body: string; readonly id: string; readonly icon: IconName; readonly count: number; readonly unit: string }[] = [
    { href: "/ops/aircraft", title: "機体", body: "登録記号・型式・認証・総飛行時間", id: "aircraft", icon: "aircraft", count: counts.aircraft, unit: "機" },
    { href: "/ops/pilots", title: "操縦者", body: "氏名・技能証明・限定事項", id: "pilots", icon: "pilot", count: counts.pilots, unit: "名" },
    { href: "/ops/permits", title: "許可・承認", body: "許可・承認の登録（利用者の申告）と、計画への照合", id: "permits", icon: "permit", count: counts.permits, unit: "件" },
    { href: "/ops/places", title: "よく使う地点", body: "社内拠点などの名称と座標", id: "places", icon: "place", count: counts.places, unit: "件" },
  ];
  const canManageMembers = can(me.member.role, "member.read");
  return (
    <main className="flex flex-col gap-6" data-testid="ops-more">
      <DraftOwnerGuard memberId={me.member.id} />
      <PageHeader title="登録" meta={me.org.name} />
      <nav aria-label="登録のメニュー">
        <ul className="sb-block sb-rows !py-1" data-testid="more-menu">
          {items.map((m) => (
            <li key={m.href}>
              <Link href={m.href} prefetch={false} data-testid={`more-link-${m.id}`} className="sb-row min-h-16 w-full">
                <Icon name={m.icon} size={22} className="shrink-0 text-sb-ink-2" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-[1rem] font-bold text-sb-ink">{m.title}</span>
                  <span className="text-[0.875rem] text-sb-ink-2">{m.body}</span>
                </span>
                <span className="shrink-0 sb-num text-[0.875rem] tnum text-sb-ink-2" data-testid={`more-count-${m.id}`}>
                  {m.count} {m.unit}
                </span>
                <span aria-hidden className="sb-go-dot">
                  <Icon name="chevron-right" size={18} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {canManageMembers ? (
        <section aria-label="管理" className="flex flex-col gap-2" data-testid="more-admin">
          <div className="sb-sec-head">
            <h2>管理</h2>
          </div>
          <ul className="sb-block sb-rows !py-1">
            <li>
              <Link href="/ops/members" prefetch={false} data-testid="more-link-members" className="sb-row min-h-16 w-full">
                <Icon name="account" size={22} className="shrink-0 text-sb-ink-2" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-[1rem] font-bold text-sb-ink">利用者</span>
                  <span className="text-[0.875rem] text-sb-ink-2">招待・役割の変更・利用の停止</span>
                </span>
                <span aria-hidden className="sb-go-dot">
                  <Icon name="chevron-right" size={18} />
                </span>
              </Link>
            </li>
          </ul>
        </section>
      ) : null}
      <section aria-label="DIPS との接続" className="flex items-center gap-2 rounded-sb-m bg-sb-sunken px-4 py-3 text-[0.875rem] text-sb-ink-2" data-testid="dips-note">
        <Icon name="unlinked" size={16} className="shrink-0 text-sb-ink-3" />
        <p>DIPS との接続：未接続。機体・操縦者はアプリの中で登録し、通報は DIPS で行った結果を手で記録します。</p>
      </section>
      {/* このアプリについて（Sprint 18-3）。提供元・境界・免責。右上の利用者メニューからも入れる（どちらも 2 回の操作）。 */}
      <ul className="sb-block sb-rows !py-1" data-testid="more-about">
        <li>
          <Link href="/ops/about" prefetch={false} data-testid="more-link-about" className="sb-row min-h-16 w-full">
            <Icon name="info" size={22} className="shrink-0 text-sb-ink-2" />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-[1rem] font-bold text-sb-ink">このアプリについて</span>
              <span className="text-[0.875rem] text-sb-ink-2">提供元・このアプリの範囲・免責</span>
            </span>
            <span aria-hidden className="sb-go-dot">
              <Icon name="chevron-right" size={18} />
            </span>
          </Link>
        </li>
      </ul>
    </main>
  );
}
