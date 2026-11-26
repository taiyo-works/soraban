"use client";

// 運航管理のメニュー（Sprint 12g-1b 段階 A、Sprint 12h PR ③a で 5 タブ、Sprint 16-F で 4 項目に）。ハンバーガーは使わない。
//   - PC（幅 1024px 以上）：左メニュー。上から ホーム／計画／日誌（子：飛行記録・点検・事故・ヒヤリハット）／機体と書類（子：機体・操縦者・許可・承認・地点）、罫のあとに「調べる」＝判定。
//   - スマホ（幅 1024px 未満）：画面下に固定の 4 タブ（ホーム／計画／日誌／機体と書類。高さ 64px 以上。判定は置かない）。上に薄いトップバー（画面名・利用者メニュー）。
//   - 右上の利用者メニュー（PC・スマホ共通）：名前・役割・ログアウト。ログアウトの挙動（未送信の警告・下書きの消去）は SignOutButton のまま。
//   - 現在地は薄い主色の面・文字の太さ・アイコン・aria-current で示す（色だけに頼らない）。見た目は soraban-ui.css の .sb-tab／.sb-side-link（v2 のトークンだけ）。
//   - 現場モード・サインイン・アクセス権なしでは出さない（現場モードは親指の届く下半分を離着陸のボタンに使う）。
//   - 出す条件（運航管理が有効でログイン済み）は、サーバーの OpsNavGate が決めてからこの部品を描く。
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { cx } from "@/components/ui/cx";
import { Icon, type IconName } from "@/components/ui/icons";
import { InfoPopover } from "@/components/ui/info-popover";
import type { MemberRoleDb } from "@soraban/db";
import { SignOutButton } from "./ops-client";
import { BOTTOM_TABS, currentChildKey, currentNavKey, hasVisibleCurrentChild, NAV_GROUPS, NAV_ITEM, navHiddenOn, OPS_MAIN_ID, type NavParentKey, visibleChildrenOf } from "./ops-nav-model";

export type OpsNavUser = {
  readonly memberId: string;
  readonly name: string;
  readonly email: string;
  readonly role: MemberRoleDb;
  readonly roleLabel: string;
  readonly roleDescription: string;
  readonly provider: "neon" | "test";
};

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
      className={cx("sb-side-link", sub && "sb-side-sub")}
    >
      <Icon name={icon} size={sub ? 16 : 18} className="shrink-0" />
      <span className="min-w-0">{label}</span>
    </Link>
  );
}

/** PC の左メニュー。1024px 未満では出さない（下の 4 タブが代わりになる）。 */
export function OpsSidebar({ role }: { readonly role: MemberRoleDb }) {
  const pathname = usePathname() ?? "";
  if (navHiddenOn(pathname)) return null;
  const current = currentNavKey(pathname);
  const child = currentChildKey(pathname);
  return (
    <nav
      aria-label="運航管理のメニュー（左）"
      data-testid="ops-sidebar"
      className="hidden lg:sticky lg:top-0 lg:flex lg:h-dvh lg:w-60 lg:shrink-0 lg:flex-col lg:gap-0.5 lg:self-start lg:overflow-y-auto lg:border-r lg:border-sb-rule lg:bg-sb-base lg:p-3"
    >
      <Link href="/ops" prefetch={false} aria-label="そらばん 運航管理" className="mb-2 flex min-h-12 flex-col justify-center rounded-sb-m px-3 hover:bg-sb-sunken" data-testid="ops-logo">
        <span className="text-h2 font-semibold leading-tight text-sb-ink">そらばん</span>
        <span className="text-aux text-sb-ink-3">運航管理</span>
      </Link>
      {/* 上の 4 項目（見出しなし）。日誌と機体と書類は子項目を持つ（現在地が子のとき、親は data-ancestor）。罫のあとに「調べる」（判定） */}
      {NAV_GROUPS.map((g) => (
        <div key={g.keys.join("-")} className={cx("flex flex-col gap-0.5", g.heading ? "mt-3 border-t border-sb-rule pt-3" : "")}>
          {g.heading ? <p className="px-3 pb-1 text-aux font-bold text-sb-ink-2">{g.heading}</p> : null}
          {g.keys.map((k) => {
            const item = NAV_ITEM[k];
            const parent: NavParentKey | null = k === "journal" || k === "more" ? k : null;
            const hasChild = parent !== null && hasVisibleCurrentChild(pathname, parent, visibleChildrenOf(parent, role));
            return (
              <div key={k} className="flex flex-col gap-0.5">
                <SideLink href={item.href} label={item.label} icon={item.icon} testId={`nav-${k}`} active={current === k && !hasChild} ancestor={hasChild} />
                {parent ? (
                  <div className="ml-[1.3125rem] flex flex-col gap-0.5 border-l border-sb-rule pl-1">
                    {visibleChildrenOf(parent, role).map((c) => (
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
 * 下タブの項目名。「機体と書類」だけ、文字を拡大して 1 列に収まらないときの折れ目（「機体と｜書類」）を <wbr> で示す。
 * ふだんは 1 行（`.sb-tab` が語の途中で折らない）。項目名は省かず、アイコンだけにもしない（16-F の判断。理由は test-changes の 16-F 節）。
 */
const tabLabel = (key: string, label: string): ReactNode =>
  key === "more" ? (
    <>
      機体と<wbr />書類
    </>
  ) : (
    label
  );

/**
 * スマホの下メニュー（4 タブ。判定はない）。1024px 以上では出さない。`/`（判定画面）にも置く（ログイン済みのとき）。
 * `/` は判定（左メニューの現在地）なので、下タブのどれも現在地にならない（aria-current なし）。
 * `.ds` の外（`/`）でも新しいトークンで描けるよう、外側に `ds` を付け、地は内側の面が塗る。
 */
export function OpsBottomNav({ variant = "ds" }: { readonly variant?: "ds" | "sb" } = {}) {
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
    <nav aria-label="運航管理のメニュー（下）" data-testid="ops-bottom-nav" className={`ds ${variant === "sb" ? "ds-sb " : ""}fixed inset-x-0 bottom-0 z-40 lg:hidden`}>
      <ul className="sb-tabs">
        {BOTTOM_TABS.map((it) => {
          const active = current === it.key;
          return (
            <li key={it.key} className="min-w-0">
              <Link href={it.href} prefetch={false} aria-current={active ? "page" : undefined} data-testid={`nav-${it.key}`} data-active={active ? "true" : "false"} className="sb-tab">
                <Icon name={it.icon} size={24} />
                <span>{tabLabel(it.key, it.label)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** 公開の判定画面 `/` の下メニュー。下タブ（4 つ）と同じ部品。 */
export function OpsBottomNavSb() {
  return <OpsBottomNav variant="sb" />;
}

/** 右上の利用者メニュー。名前・役割（ⓘに説明）・メールアドレス・ログアウト。 */
function UserMenu({ user }: { readonly user: OpsNavUser }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  // 閉じ方で、フォーカスの行き先が変わる。Escape（キーボード）はボタンへ戻す（戻さないと BODY に落ちて、次の Tab が頭からになる）。
  // 外を押して閉じたときは、押した先に任せる（戻すと、押した入力欄からフォーカスを奪う）。
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent): void => {
      if (root.current && e.target instanceof Node && !root.current.contains(e.target)) setOpen(false);
    };
    const key = (e: KeyboardEvent): void => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const active = document.activeElement;
      // 開いている「ⓘ」の説明が先に閉じる（その Escape ではメニューを閉じない）。もう一度押すとメニューが閉じる
      if (active instanceof HTMLElement && active !== trigger.current && active.getAttribute("aria-expanded") === "true" && root.current?.contains(active)) return;
      setOpen(false);
      if (!active || active === document.body || root.current?.contains(active)) trigger.current?.focus();
    };
    document.addEventListener("pointerdown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", down);
      document.removeEventListener("keydown", key);
    };
  }, [open]);
  return (
    <div ref={root} className="relative">
      <button
        ref={trigger}
        type="button"
        aria-expanded={open}
        aria-controls={id}
        // 画面に見える名前（PC では利用者名）を含める（WCAG 2.5.3）。スマホはアイコンだけなので、名前を読み上げで補う
        aria-label={`${user.name}（利用者のメニュー）`}
        onClick={() => setOpen((o) => !o)}
        data-testid="user-menu-button"
        className="inline-flex min-h-12 min-w-12 items-center justify-center gap-2 rounded-sb-m border border-sb-edge bg-sb-base px-2.5 text-table text-sb-ink hover:bg-sb-sunken"
      >
        <Icon name="account" size={18} />
        <span className="hidden max-w-[12rem] truncate lg:inline">{user.name}</span>
        <Icon name="chevron-down" size={14} className="text-sb-ink-3" />
      </button>
      {open ? (
        <div
          id={id}
          role="group"
          aria-label="利用者"
          data-testid="user-menu"
          className="ds-pop absolute right-0 top-full z-50 mt-1 flex w-72 max-w-[calc(100vw-2rem)] flex-col gap-3 rounded-sb-m border border-sb-edge bg-sb-base p-4 text-table"
        >
          <div className="flex flex-col gap-1">
            <p className="break-words font-semibold text-sb-ink" data-testid="ops-me-name">
              {user.name}
            </p>
            <div className="flex items-center gap-1">
              <p className="text-sb-ink-2" data-testid="ops-me-role">
                <span>役割：</span>
                {user.roleLabel}
              </p>
              <InfoPopover label="役割でできること">{user.roleDescription}</InfoPopover>
            </div>
            <p className="break-all text-aux text-sb-ink-3" data-testid="ops-me-email">
              {user.email}
            </p>
          </div>
          {/* このアプリについて（Sprint 18-3）。押す部品は 48px 以上。移動したらメニューを閉じる */}
          <Link
            href="/ops/about"
            prefetch={false}
            onClick={() => setOpen(false)}
            data-testid="user-menu-about"
            className="inline-flex min-h-12 w-full items-center gap-2 rounded-sb-m border border-sb-edge bg-sb-base px-3 text-table font-semibold text-sb-ink hover:bg-sb-sunken"
          >
            <Icon name="info" size={18} className="shrink-0 text-sb-ink-2" />
            このアプリについて
          </Link>
          <SignOutButton provider={user.provider} memberId={user.memberId} />
        </div>
      ) : null}
    </div>
  );
}

/**
 * 上の薄いバー。右に利用者メニュー。スマホでは左に製品名（画面名は本文の見出しが担うので、ここには置かない）。PC では左メニューに製品名があるので、
 * 利用者メニューだけが右に出る。現場モード・サインイン・アクセス権なしでは出さない。
 */
export function OpsTopBar({ user }: { readonly user: OpsNavUser }) {
  const pathname = usePathname() ?? "";
  if (navHiddenOn(pathname)) return null;
  return (
    <header data-testid="ops-header" className="flex h-14 shrink-0 items-center justify-end gap-3 border-b border-sb-rule bg-sb-base px-4 max-lg:h-12 lg:sticky lg:top-0 lg:z-30 lg:px-8">
      <Link href="/ops" prefetch={false} aria-label="そらばん 運航管理 ホームへ" className="mr-auto flex min-h-12 items-center gap-2 lg:hidden" data-testid="ops-brand-mark">
        <span className="text-h2 font-semibold leading-none text-sb-ink">そらばん</span>
        <span className="text-aux text-sb-ink-3">運航管理</span>
      </Link>
      <UserMenu user={user} />
    </header>
  );
}

/**
 * 本文へ移動（スキップリンク）。キーボードの最初の Tab で出て、メニューと上のバーを飛ばして本文へ移る。PC・スマホ共通。
 * 移動先は ops-frame.tsx の本文の枠（id=OPS_MAIN_ID）。メニューの出ない画面（現場モード・サインイン・アクセス権なし）には出さない。
 */
export function OpsSkipLink() {
  const pathname = usePathname() ?? "";
  if (navHiddenOn(pathname)) return null;
  return (
    <a
      href={`#${OPS_MAIN_ID}`}
      data-testid="skip-to-main"
      className="sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:left-3 focus-visible:top-3 focus-visible:z-[60] focus-visible:inline-flex focus-visible:min-h-12 focus-visible:items-center focus-visible:rounded-sb-m focus-visible:border focus-visible:border-sb-edge focus-visible:bg-sb-base focus-visible:px-4 focus-visible:text-table focus-visible:font-semibold focus-visible:text-sb-ink"
    >
      本文へ移動
    </a>
  );
}

/** サインイン・アクセス権なしの画面の上に出す、名前だけのヘッダー（メニューも利用者メニューも出さない）。 */
export function OpsBrandHeader() {
  const pathname = usePathname() ?? "";
  if (pathname !== "/ops/sign-in" && pathname !== "/ops/no-access") return null;
  return (
    <header className="flex items-center border-b border-sb-rule pb-3" data-testid="ops-brand">
      <Link href="/" prefetch={false} aria-label="そらばん 運航管理" className="flex min-h-12 flex-col justify-center text-sb-ink">
        <span className="text-h2 font-semibold leading-tight">そらばん</span>
        <span className="text-aux text-sb-ink-3">運航管理</span>
      </Link>
    </header>
  );
}
