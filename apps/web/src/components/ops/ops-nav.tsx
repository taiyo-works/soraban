"use client";

// 下メニュー・共通のヘッダー（Sprint 12c 設計 I・H）。
//   - 5 項目：今日（/ops）／判定（/）／計画（/ops/plans）／日誌（/ops/journal）／その他（/ops/more）。現在地は文字・形（上の太い線と ●）・aria-current で示す。
//   - スマホ（幅 768px 未満）は画面下に固定。高さ 56px 以上、1 項目は幅の 1/5。768px 以上は同じ 5 つを横に並べる（配置は designer）。
//   - 現場モード・サインイン・アクセス権なしでは出さない（現場モードは親指の届く下半分を離着陸のボタンに使う）。
//   - 出す条件（運航管理が有効でログイン済み）は、サーバーの OpsNavGate が決めてからこの部品を描く。
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, type ReactNode } from "react";

type Item = { readonly key: string; readonly label: string; readonly href: string };

export const NAV_ITEMS: readonly Item[] = [
  { key: "today", label: "今日", href: "/ops" },
  { key: "verdict", label: "判定", href: "/" },
  { key: "plans", label: "計画", href: "/ops/plans" },
  { key: "journal", label: "日誌", href: "/ops/journal" },
  { key: "more", label: "その他", href: "/ops/more" },
];

// 記号は意味の通る線画（currentColor。装飾なので読み上げない）。意味は常に隣の文字ラベルが担う。
//   今日＝日付の入った暦／判定＝地点のピン／計画＝チェック欄つきの書類／日誌＝開いた帳面／その他＝三つの点
const ICON_PATHS: Readonly<Record<string, ReactNode>> = {
  today: (
    <>
      <rect x="3.5" y="5" width="17" height="15" rx="1" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
      <rect x="8" y="13" width="3" height="3" fill="currentColor" stroke="none" />
    </>
  ),
  verdict: (
    <>
      <path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11z" />
      <circle cx="12" cy="10" r="2.2" />
    </>
  ),
  plans: (
    <>
      <path d="M6 3.5h12a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1z" />
      <path d="M8.5 9l1.5 1.5 2.5-3M8.5 15l1.5 1.5 2.5-3M14.5 9.5H16.5M14.5 15.5H16.5" />
    </>
  ),
  journal: (
    <>
      <path d="M12 6c-2-1.5-4.5-2-8-2v14c3.5 0 6 .5 8 2 2-1.5 4.5-2 8-2V4c-3.5 0-6 .5-8 2z" />
      <path d="M12 6v14" />
    </>
  ),
  more: (
    <>
      <circle cx="5.5" cy="12" r="1.6" fill="currentColor" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" />
      <circle cx="18.5" cy="12" r="1.6" fill="currentColor" />
    </>
  ),
};

function NavIcon({ id }: { readonly id: string }) {
  return (
    <svg aria-hidden focusable="false" viewBox="0 0 24 24" className="h-6 w-6 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {ICON_PATHS[id]}
    </svg>
  );
}

/** 下メニューを出さない画面：現場モード・サインイン・アクセス権なし。 */
export const navHiddenOn = (pathname: string): boolean =>
  /^\/ops\/plans\/[^/]+\/field\/?$/.test(pathname) || pathname === "/ops/sign-in" || pathname === "/ops/no-access";

/** どの項目が現在地か。日誌は /ops/flights*・/ops/inspections*・/ops/journal。計画は /ops/plans*（現場モードを除く）。 */
export const currentNavKey = (pathname: string): string | null => {
  if (pathname === "/") return "verdict";
  if (pathname === "/ops") return "today";
  if (pathname.startsWith("/ops/plans")) return "plans";
  if (pathname.startsWith("/ops/flights") || pathname.startsWith("/ops/inspections") || pathname.startsWith("/ops/journal")) return "journal";
  if (pathname.startsWith("/ops/more") || /^\/ops\/(aircraft|pilots|places|permits|members)/.test(pathname)) return "more";
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
      className="fixed inset-x-0 bottom-0 z-40 border-t-2 border-ink-mute bg-paper pb-[env(safe-area-inset-bottom)] md:static md:z-auto md:-mt-7 md:border-t-0 md:pb-0"
    >
      <ul className="mx-auto grid max-w-4xl grid-cols-5 md:flex md:gap-1 md:px-0">
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
                className={`flex min-h-14 flex-col items-center justify-center gap-0.5 whitespace-nowrap border-t-4 px-1 text-[13px] touch-manipulation focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-700 md:min-h-11 md:flex-row md:gap-2 md:border-t-0 md:border-b-4 md:px-4 md:text-sm ${
                  active ? "border-brand-700 bg-brand-50 font-bold text-brand-700" : "border-transparent text-ink-soft hover:bg-paper-soft"
                }`}
              >
                <NavIcon id={it.key} />
                <span className={active ? "underline underline-offset-4" : ""}>
                  {active ? (
                    <span aria-hidden className="mr-1 text-[0.7em] align-middle">
                      ●
                    </span>
                  ) : null}
                  {it.label}
                </span>
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
