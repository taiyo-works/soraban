"use client";

// 運航管理のメニュー（Sprint 12g-1b 段階 A）。名称は ホーム／判定／計画／日誌／登録 の 5 つだけ。ハンバーガーは使わない。
//   - PC（幅 1024px 以上）：左メニュー。上から ホーム／「調べる」＝判定／「飛ばす」＝計画・日誌／登録（機体・操縦者・許可・承認・地点）。
//   - スマホ（幅 1024px 未満）：画面下に固定の 5 タブ（高さ 56px 以上）。上に薄いトップバー（画面名・利用者メニュー）。
//   - 右上の利用者メニュー（PC・スマホ共通）：名前・役割・ログアウト。ログアウトの挙動（未送信の警告・下書きの消去）は SignOutButton のまま。
//   - 現在地は文字の太さ・面の塗り・アイコン・aria-current で示す（色だけに頼らない）。
//   - 現場モード・サインイン・アクセス権なしでは出さない（現場モードは親指の届く下半分を離着陸のボタンに使う）。
//   - 出す条件（運航管理が有効でログイン済み）は、サーバーの OpsNavGate が決めてからこの部品を描く。
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { cx } from "@/components/ui/cx";
import { useDismiss } from "@/components/ui/hooks";
import { Icon, type IconName } from "@/components/ui/icons";
import { InfoPopover } from "@/components/ui/overlays";
import type { MemberRoleDb } from "@soraban/db";
import { SignOutButton } from "./ops-client";
import { currentChildKey, currentNavKey, NAV_GROUPS, NAV_ITEM, NAV_ITEMS, navHiddenOn, visibleNavChildren } from "./ops-nav-model";

export type OpsNavUser = {
  readonly memberId: string;
  readonly name: string;
  readonly email: string;
  readonly role: MemberRoleDb;
  readonly roleLabel: string;
  readonly roleDescription: string;
  readonly provider: "neon" | "test";
};

const LINK_BASE = "flex min-h-11 w-full items-center rounded-ctl text-table touch-manipulation transition-colors duration-[var(--dur)]";

function SideLink({
  href,
  label,
  icon,
  testId,
  active,
  ancestor = false,
  sub = false,
}: {
  readonly href: string;
  readonly label: string;
  readonly icon: IconName;
  readonly testId: string;
  readonly active: boolean;
  readonly ancestor?: boolean;
  readonly sub?: boolean;
}) {
  return (
    <Link
      href={href}
      prefetch={false}
      aria-current={active ? "page" : undefined}
      data-testid={testId}
      data-active={active ? "true" : "false"}
      {...(ancestor ? { "data-ancestor": "true" } : {})}
      className={cx(LINK_BASE, sub ? "gap-2.5 px-2.5" : "gap-3 px-3", active ? "bg-accent-soft font-semibold text-accent" : ancestor ? "font-semibold text-fg hov:bg-sunken" : "text-fg-soft hov:bg-sunken hov:text-fg")}
    >
      <Icon name={icon} size={sub ? 16 : 18} className={cx("shrink-0", !active && "text-fg-mute")} />
      <span className="min-w-0">{label}</span>
    </Link>
  );
}

/** PC の左メニュー。1024px 未満では出さない（下の 5 タブが代わりになる）。 */
export function OpsSidebar({ role }: { readonly role: MemberRoleDb }) {
  const pathname = usePathname() ?? "";
  if (navHiddenOn(pathname)) return null;
  const current = currentNavKey(pathname);
  const child = currentChildKey(pathname);
  return (
    <nav
      aria-label="運航管理のメニュー（左）"
      data-testid="ops-sidebar"
      className="hidden lg:sticky lg:top-0 lg:flex lg:h-dvh lg:w-[13.5rem] lg:shrink-0 lg:flex-col lg:gap-0.5 lg:self-start lg:overflow-y-auto lg:border-r lg:border-line lg:bg-surface lg:p-3"
    >
      <Link href="/ops" prefetch={false} aria-label="そらばん 運航管理" className="mb-2 flex min-h-11 flex-col justify-center rounded-ctl px-3 hov:bg-sunken" data-testid="ops-logo">
        <span className="text-h2 font-semibold leading-tight text-fg">そらばん</span>
        <span className="text-aux text-fg-mute">運航管理</span>
      </Link>
      {/* 見出し（調べる・飛ばす）は項目の左端（アイコンの左）にそろえ、グループの間は余白で切る。登録（と子項目）の前だけ罫を 1 本引く */}
      {NAV_GROUPS.map((g) => (
        <div key={g.keys.join("-")} className={cx("flex flex-col gap-0.5", g.keys[0] === "more" ? "mt-3 border-t border-line pt-3" : g.heading ? "mt-3" : "")}>
          {g.heading ? <p className="px-3 pb-1 text-aux font-medium text-fg-mute">{g.heading}</p> : null}
          {g.keys.map((k) => {
            const item = NAV_ITEM[k];
            const hasChild = k === "more" && child !== null;
            return (
              <div key={k} className="flex flex-col gap-0.5">
                <SideLink href={item.href} label={item.label} icon={item.icon} testId={`nav-${k}`} active={current === k && !hasChild} ancestor={hasChild} />
                {k === "more" ? (
                  <div className="ml-[1.3125rem] flex flex-col gap-0.5 border-l border-line pl-1.5">
                    {visibleNavChildren(role).map((c) => (
                      <SideLink key={c.key} sub href={c.href} label={c.label} icon={c.icon} testId={`nav-${c.key}`} active={child === c.key} />
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

/**
 * スマホの下メニュー（5 タブ）。1024px 以上では出さない。`/`（判定画面）にも置く（ログイン済みのとき）。
 * `.ds` の外（`/`）でも新しいトークンで描けるよう、外側に `ds` を付け、地は内側の面が塗る。
 */
export function OpsBottomNav() {
  const pathname = usePathname() ?? "";
  const hidden = navHiddenOn(pathname);
  // 本文の末尾が下メニューに隠れないよう、スマホでは body に余白を取る（globals.css の .has-bottom-nav）
  useEffect(() => {
    if (hidden) return;
    document.body.classList.add("has-bottom-nav");
    return () => document.body.classList.remove("has-bottom-nav");
  }, [hidden]);
  if (hidden) return null;
  const current = currentNavKey(pathname);
  return (
    <nav aria-label="運航管理のメニュー（下）" data-testid="ops-bottom-nav" className="ds fixed inset-x-0 bottom-0 z-40 lg:hidden">
      <ul className="mx-auto grid grid-cols-5 border-t border-line-strong bg-surface pb-[env(safe-area-inset-bottom)]">
        {NAV_ITEMS.map((it) => {
          const active = current === it.key;
          return (
            <li key={it.key} className="min-w-0">
              <Link
                href={it.href}
                prefetch={false}
                aria-current={active ? "page" : undefined}
                data-testid={`nav-${it.key}`}
                data-active={active ? "true" : "false"}
                className={cx(
                  "flex min-h-14 flex-col items-center justify-center gap-0.5 whitespace-nowrap border-t-2 px-1 text-aux touch-manipulation",
                  active ? "border-accent bg-accent-soft font-bold text-accent" : "border-transparent text-fg-soft hov:bg-sunken",
                )}
              >
                <Icon name={it.icon} size={22} />
                <span>{it.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** 右上の利用者メニュー。名前・役割（ⓘに説明）・メールアドレス・ログアウト。 */
function UserMenu({ user }: { readonly user: OpsNavUser }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  useDismiss(root, open, () => setOpen(false));
  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        aria-label="利用者のメニュー"
        onClick={() => setOpen((o) => !o)}
        data-testid="user-menu-button"
        className="inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-ctl border border-line-strong bg-surface px-2.5 text-table text-fg hov:bg-sunken"
      >
        <Icon name="pilot" size={18} />
        <span className="hidden max-w-[12rem] truncate lg:inline">{user.name}</span>
        <Icon name="chevron-down" size={14} className="text-fg-mute" />
      </button>
      {open ? (
        <div
          id={id}
          role="group"
          aria-label="利用者"
          data-testid="user-menu"
          className="ds-pop absolute right-0 top-full z-50 mt-1 flex w-72 max-w-[calc(100vw-2rem)] flex-col gap-3 rounded-ctl border border-line-strong bg-surface p-4 text-table"
        >
          <div className="flex flex-col gap-1">
            <p className="break-words font-semibold text-fg" data-testid="ops-me-name">
              {user.name}
            </p>
            <div className="flex items-center gap-1">
              <p className="text-fg-soft" data-testid="ops-me-role">
                <span>役割：</span>
                {user.roleLabel}
              </p>
              <InfoPopover label="役割でできること">{user.roleDescription}</InfoPopover>
            </div>
            <p className="break-all text-aux text-fg-mute" data-testid="ops-me-email">
              {user.email}
            </p>
          </div>
          <SignOutButton provider={user.provider} memberId={user.memberId} />
        </div>
      ) : null}
    </div>
  );
}

/**
 * 上の薄いバー。右に利用者メニュー。スマホでは左に画面名（いまの項目）。PC では左メニューと本文の上に、利用者メニューだけが右に出る。
 * 現場モード・サインイン・アクセス権なしでは出さない。
 */
export function OpsTopBar({ user }: { readonly user: OpsNavUser }) {
  const pathname = usePathname() ?? "";
  if (navHiddenOn(pathname)) return null;
  const key = currentNavKey(pathname);
  return (
    <header data-testid="ops-header" className="sticky top-0 z-30 flex h-14 shrink-0 items-center justify-between gap-3 border-b border-line bg-surface px-4 lg:px-8">
      <p className="min-w-0 truncate text-h2 font-semibold text-fg lg:invisible" data-testid="ops-screen-name">
        {key ? NAV_ITEM[key].label : "運航管理"}
      </p>
      <UserMenu user={user} />
    </header>
  );
}

/** サインイン・アクセス権なしの画面の上に出す、名前だけのヘッダー（メニューも利用者メニューも出さない）。 */
export function OpsBrandHeader() {
  const pathname = usePathname() ?? "";
  if (pathname !== "/ops/sign-in" && pathname !== "/ops/no-access") return null;
  return (
    <header className="flex items-center border-b border-line pb-3" data-testid="ops-brand">
      <Link href="/" prefetch={false} aria-label="そらばん 運航管理" className="flex min-h-11 flex-col justify-center text-fg">
        <span className="text-h2 font-semibold leading-tight">そらばん</span>
        <span className="text-aux text-fg-mute">運航管理</span>
      </Link>
    </header>
  );
}
