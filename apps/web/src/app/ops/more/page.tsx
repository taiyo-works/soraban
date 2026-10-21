import Link from "next/link";
import { DraftOwnerGuard, SignOutButton } from "@/components/ops/ops-client";
import { PageHeader, ROLE_DESCRIPTIONS } from "@/components/ops/ui";
import { requireOpsMember, ROLE_LABELS } from "@/server/ops/page";

// 「その他」（Sprint 12c 設計 G）：旧トップのメニュー（機体・操縦者・よく使う地点・利用者）とログアウトの移設先。
// 事故・ヒヤリハット（12e）と期限一覧（12f）の枠は作らない。
export default async function OpsMorePage() {
  const { me, provider } = await requireOpsMember();
  const role = me.member.role;
  const menu = [
    { href: "/ops/aircraft", title: "機体", body: "登録記号・型式・認証・総飛行時間", id: "aircraft" },
    { href: "/ops/pilots", title: "操縦者", body: "氏名・技能証明・限定事項", id: "pilots" },
    { href: "/ops/places", title: "よく使う地点", body: "社内拠点などの名称と座標", id: "places" },
    ...(role === "manager" ? [{ href: "/ops/members", title: "利用者", body: "招待・役割の変更・利用の停止", id: "members" }] : []),
  ];
  return (
    <main className="flex flex-col gap-8" data-testid="ops-more">
      <DraftOwnerGuard memberId={me.member.id} />
      <PageHeader title="その他" eyebrow={me.org.name} />
      <nav aria-label="その他のメニュー">
        <ul className="grid grid-cols-1 gap-px overflow-hidden rounded-sharp border border-rule bg-rule sm:grid-cols-2" data-testid="more-menu">
          {menu.map((m) => (
            <li key={m.href} className="flex">
              <Link
                href={m.href}
                prefetch={false}
                data-testid={`more-link-${m.id}`}
                className="flex min-h-14 w-full flex-col gap-1.5 bg-paper px-4 py-4 transition-colors hover:bg-paper-soft focus-visible:bg-paper-soft"
              >
                <span className="font-display text-lg text-ink">{m.title}</span>
                <span className="text-xs leading-relaxed text-ink-soft">{m.body}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <section className="flex flex-col gap-3 border-t border-rule-soft pt-4" aria-label="ログイン中の利用者">
        <p className="text-sm text-ink" data-testid="more-me">
          <span data-testid="more-me-name">{me.member.displayName}</span>
          <span className="text-ink-mute">（{ROLE_LABELS[role]}）</span>
        </p>
        <p className="max-w-xl border-l-2 border-brand-700 pl-3 text-xs leading-relaxed text-ink-soft">{ROLE_DESCRIPTIONS[role]}</p>
        <span className="break-all text-xs text-ink-mute">{me.member.email}</span>
        <SignOutButton provider={provider} memberId={me.member.id} />
      </section>
    </main>
  );
}
