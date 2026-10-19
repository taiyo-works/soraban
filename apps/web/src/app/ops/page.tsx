import Link from "next/link";
import { SignOutButton } from "@/components/ops/ops-client";
import { requireOpsMember, ROLE_LABELS } from "@/server/ops/page";

// 運航管理のトップ：ログイン中の利用者の表示名と役割、機体・操縦者・利用者（運航管理者のみ）への入口、ログアウト。
export default async function OpsHome() {
  const { me, provider } = await requireOpsMember();
  return (
    <main className="flex flex-col gap-6">
      <section className="flex flex-col gap-1" aria-label="ログイン中の利用者">
        <p className="text-xs text-ink-mute">{me.org.name}</p>
        <p className="text-lg text-ink" data-testid="ops-me-name">
          {me.member.displayName}
        </p>
        <p className="text-sm text-ink-soft" data-testid="ops-me-role">
          役割：{ROLE_LABELS[me.member.role]}
        </p>
      </section>
      <nav className="flex flex-col gap-2" aria-label="運航管理のメニュー">
        <Link className="border border-rule px-4 py-3 text-ink" href="/ops/aircraft">
          機体
        </Link>
        <Link className="border border-rule px-4 py-3 text-ink" href="/ops/pilots">
          操縦者
        </Link>
        {me.member.role === "manager" ? (
          <Link className="border border-rule px-4 py-3 text-ink" href="/ops/members">
            利用者
          </Link>
        ) : null}
      </nav>
      <div>
        <SignOutButton provider={provider} />
      </div>
    </main>
  );
}
