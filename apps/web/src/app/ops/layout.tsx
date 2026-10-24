import type { Metadata } from "next";
import { Suspense } from "react";
import { OPS_CONTENT_CLASS, OpsFrame } from "@/components/ops/ops-frame";
import { OpsNavGate, OpsTopBarGate } from "@/components/ops/ops-nav-gate";

// 運航管理（Sprint 10）の画面の共通の枠。各ページは Cookie（本人確認）を読むため、Suspense の内側で描く。
// 事務所の PC と現場のスマートフォンの両方で使う（375px で横スクロールなし）。
// Sprint 12g-1b：根に `.ds`（紙面のトークン）を付け、PC は左メニュー、スマホは下の 5 タブ（ホーム／判定／計画／日誌／登録）と上のバーにした。
// 右上の利用者メニュー（名前・役割・ログアウト）も同じ枠にある。出す条件（運航管理が有効でログイン済み）はサーバーが決める。
// 現場モード・サインイン・アクセス権なしの画面では、メニューも利用者メニューも出さない（OpsSidebar・OpsBottomNav・OpsTopBar が経路で判断する）。
// Sprint 12g：/ops/design（デザイン見本。本番で 404）は枠を出さない（OpsFrame が経路で判断する）。
export const metadata: Metadata = {
  title: "運航管理 — そらばん",
  robots: { index: false, follow: false },
};

export default function OpsLayout({ children }: { readonly children: React.ReactNode }) {
  // OpsFrame reads the pathname (a client hook), which on dynamic routes is only known at request time, so it sits inside a
  // Suspense whose fallback is the same frame as before (the static shell is unchanged).
  return (
    <Suspense
      fallback={
        <div className="ds ds-page flex flex-1 flex-col">
          <div className={OPS_CONTENT_CLASS}>
            <p className="text-table text-fg-mute">読み込み中…</p>
          </div>
        </div>
      }
    >
      <OpsFrame
        nav={
          <Suspense fallback={null}>
            <OpsNavGate />
          </Suspense>
        }
        topBar={
          <Suspense fallback={null}>
            <OpsTopBarGate />
          </Suspense>
        }
      >
        <Suspense fallback={<p className="text-table text-fg-mute">読み込み中…</p>}>{children}</Suspense>
      </OpsFrame>
    </Suspense>
  );
}
