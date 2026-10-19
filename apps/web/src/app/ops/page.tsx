import Link from "next/link";
import { DraftOwnerGuard, SignOutButton } from "@/components/ops/ops-client";
import { buttonFieldClass, buttonOutlineBrandClass, ROLE_DESCRIPTIONS } from "@/components/ops/ui";
import { recordCreateDenied } from "@/server/ops/record-page";
import { requireOpsMember, ROLE_LABELS } from "@/server/ops/page";

// 運航管理のトップ：ログイン中の利用者の表示名と役割、機体・操縦者・利用者（運航管理者のみ）への入口、ログアウト。
export default async function OpsHome() {
  const { me, provider } = await requireOpsMember();
  const role = me.member.role;
  const canEnter = recordCreateDenied(me) === null;
  const menu = [
    { href: "/ops/flights", title: "飛行記録", body: "飛行ごとの記録・飛行時間・総飛行時間" },
    { href: "/ops/inspections", title: "日常点検", body: "飛行前後の 9 項目の点検" },
    { href: "/ops/aircraft", title: "機体", body: "登録記号・型式・認証・総飛行時間" },
    { href: "/ops/pilots", title: "操縦者", body: "氏名・技能証明・限定事項" },
    ...(role === "manager" ? [{ href: "/ops/members", title: "利用者", body: "招待・役割の変更・利用の停止" }] : []),
  ];
  return (
    <main className="flex flex-col gap-8">
      <DraftOwnerGuard memberId={me.member.id} />
      <section className="flex flex-col gap-3" aria-label="ログイン中の利用者">
        <p className="eyebrow">{me.org.name}</p>
        <p className="font-display text-2xl font-light leading-tight text-ink sm:text-3xl" data-testid="ops-me-name">
          {me.member.displayName}
        </p>
        <p className="text-sm font-medium text-brand-700" data-testid="ops-me-role">
          <span className="font-normal text-ink-mute">役割：</span>
          {ROLE_LABELS[role]}
        </p>
        <p className="max-w-xl border-l-2 border-brand-700 pl-3 text-xs leading-relaxed text-ink-soft">
          {ROLE_DESCRIPTIONS[role]}
        </p>
      </section>
      {canEnter ? (
        <nav aria-label="記録の入力" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Link href="/ops/flights/new" className={buttonFieldClass} data-testid="ops-enter-flight">
            飛行記録を入力
          </Link>
          <Link href="/ops/inspections/new" className={buttonOutlineBrandClass.replace("min-h-11", "min-h-14").replace("text-sm", "text-base")} data-testid="ops-enter-inspection">
            日常点検を入力
          </Link>
        </nav>
      ) : null}
      <nav aria-label="運航管理のメニュー">
        <ul className={`grid grid-cols-1 gap-px overflow-hidden rounded-sharp border border-rule bg-rule sm:grid-cols-3`}>
          {menu.map((m, i) => (
            <li key={m.href} className="flex">
              <Link
                href={m.href}
                className="flex w-full flex-col gap-1.5 bg-paper px-4 py-4 transition-colors hover:bg-paper-soft focus-visible:bg-paper-soft"
              >
                <span className="font-mono text-[10px] tnum text-ink-mute">{String(i + 1).padStart(2, "0")}</span>
                <span className="font-display text-lg text-ink">{m.title}</span>
                <span className="text-xs leading-relaxed text-ink-mute">{m.body}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <div className="flex flex-wrap items-center gap-3 border-t border-rule-soft pt-4">
        <SignOutButton provider={provider} />
        <span className="break-all text-xs text-ink-mute">{me.member.email}</span>
      </div>
    </main>
  );
}
