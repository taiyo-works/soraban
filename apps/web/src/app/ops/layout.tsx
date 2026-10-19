import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

// 運航管理（Sprint 10）の画面の共通の枠。各ページは Cookie（本人確認）を読むため、Suspense の内側で描く。
// 見た目は最低限（designer が後で整える）。スマートフォン幅 375px で横スクロールが出ないようにする。
export const metadata: Metadata = {
  title: "運航管理 — そらばん",
  robots: { index: false, follow: false },
};

export default function OpsLayout({ children }: { readonly children: React.ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-6">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-rule pb-3">
        <Link href="/ops" className="font-display text-xl text-ink">
          そらばん 運航管理
        </Link>
        <Link href="/" className="text-xs text-ink-mute underline-offset-2 hover:underline">
          地点判定へ
        </Link>
      </header>
      <Suspense fallback={<p className="text-sm text-ink-mute">読み込み中…</p>}>{children}</Suspense>
    </div>
  );
}
