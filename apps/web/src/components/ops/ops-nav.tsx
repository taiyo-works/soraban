"use client";

// 下メニュー・共通のヘッダー（Sprint 12c 設計 I・H）。
//   - 5 項目：今日（/ops）／判定（/）／計画（/ops/plans）／日誌（/ops/journal）／その他（/ops/more）。現在地は文字・形（上の太い線と ●）・aria-current で示す。
//   - スマホ（幅 768px 未満）は画面下に固定。高さ 56px 以上、1 項目は幅の 1/5。768px 以上は同じ 5 つを横に並べる（配置は designer）。
//   - 現場モード・サインイン・アクセス権なしでは出さない（現場モードは親指の届く下半分を離着陸のボタンに使う）。
//   - 出す条件（運航管理が有効でログイン済み）は、サーバーの OpsNavGate が決めてからこの部品を描く。
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";

type Item = { readonly key: string; readonly label: string; readonly href: string; readonly mark: string };

export const NAV_ITEMS: readonly Item[] = [
  { key: "today", label: "今日", href: "/ops", mark: "◆" },
  { key: "verdict", label: "判定", href: "/", mark: "◎" },
  { key: "plans", label: "計画", href: "/ops/plans", mark: "▤" },
  { key: "journal", label: "日誌", href: "/ops/journal", mark: "✎" },
  { key: "more", label: "その他", href: "/ops/more", mark: "…" },
];

/** 下メニューを出さない画面：現場モード・サインイン・アクセス権なし。 */
export const navHiddenOn = (pathname: string): boolean =>
  /^\/ops\/plans\/[^/]+\/field\/?$/.test(pathname) || pathname === "/ops/sign-in" || pathname === "/ops/no-access";

/** どの項目が現在地か。日誌は /ops/flights*・/ops/inspections*・/ops/journal。計画は /ops/plans*（現場モードを除く）。 */
export const currentNavKey = (pathname: string): string | null => {
  if (pathname === "/") return "verdict";
  if (pathname === "/ops") return "today";
  if (pathname.startsWith("/ops/plans")) return "plans";
  if (pathname.startsWith("/ops/flights") || pathname.startsWith("/ops/inspections") || pathname.startsWith("/ops/journal")) return "journal";
  if (pathname.startsWith("/ops/more") || /^\/ops\/(aircraft|pilots|places|members)/.test(pathname)) return "more";
  return null;
};

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
    <nav
      aria-label="運航管理のメニュー"
      data-testid="ops-bottom-nav"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-rule bg-paper pb-[env(safe-area-inset-bottom)] md:static md:z-auto md:border-t-0 md:pb-0"
    >
      <ul className="mx-auto grid max-w-4xl grid-cols-5 md:flex md:gap-2">
        {NAV_ITEMS.map((it) => {
          const active = current === it.key;
          return (
            <li key={it.key} className="min-w-0 md:flex-none">
              <Link
                href={it.href}
                prefetch={false}
                aria-current={active ? "page" : undefined}
                data-testid={`nav-${it.key}`}
                data-active={active ? "true" : "false"}
                className={`flex min-h-14 flex-col items-center justify-center gap-0.5 whitespace-nowrap border-t-4 px-1 text-xs touch-manipulation md:min-h-11 md:flex-row md:gap-2 md:border-t-0 md:border-b-4 md:px-3 md:text-sm ${
                  active ? "border-brand-700 font-bold text-brand-700" : "border-transparent text-ink-soft hover:bg-paper-soft"
                }`}
              >
                <span aria-hidden className="text-base leading-none">
                  {active ? "●" : it.mark}
                </span>
                <span className={active ? "underline underline-offset-4" : ""}>{it.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** 共通のヘッダー。現場モードでは出さない（上部は現場モード自身の「今日へ戻る」だけ）。 */
export function OpsHeader() {
  const pathname = usePathname() ?? "";
  if (/^\/ops\/plans\/[^/]+\/field\/?$/.test(pathname)) return null;
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 border-b border-rule pb-3" data-testid="ops-header">
      <Link href="/ops" prefetch={false} className="flex min-h-11 flex-col justify-center gap-0.5 text-ink">
        <span className="eyebrow !text-[9px]">Soraban — Flight operations</span>
        <span className="font-display text-xl font-light leading-none">そらばん 運航管理</span>
      </Link>
      <Link href="/" prefetch={false} className="-my-3 inline-flex min-h-11 items-center text-xs text-ink-mute underline-offset-2 hover:text-brand-700 hover:underline">
        地点判定へ
      </Link>
    </header>
  );
}
