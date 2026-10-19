import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

// 運航管理（Sprint 10）の画面の共通の枠。各ページは Cookie（本人確認）を読むため、Suspense の内側で描く。
// 判定画面と同じ紙面調の意匠で、事務所の PC と現場のスマートフォンの両方で使う（375px で横スクロールなし）。
export const metadata: Metadata = {
  title: "運航管理 — そらばん",
  robots: { index: false, follow: false },
};

export default function OpsLayout({ children }: { readonly children: React.ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-4 py-6 sm:gap-10 sm:px-6 sm:py-10">
      <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 border-b border-rule pb-3">
        <Link href="/ops" className="flex flex-col gap-0.5 text-ink">
          <span className="eyebrow !text-[9px]">Soraban — Flight operations</span>
          <span className="font-display text-xl font-light leading-none">そらばん 運航管理</span>
        </Link>
        <Link href="/" className="text-xs text-ink-mute underline-offset-2 hover:text-brand-700 hover:underline">
          地点判定へ
        </Link>
      </header>
      <Suspense fallback={<p className="text-sm text-ink-mute">読み込み中…</p>}>{children}</Suspense>
    </div>
  );
}
