import type { Metadata } from "next";
import { Suspense } from "react";
import { OpsHeader } from "@/components/ops/ops-nav";
import { OPS_FRAME_CLASS, OpsFrame } from "@/components/ops/ops-frame";
import { OpsNavGate } from "@/components/ops/ops-nav-gate";

// 運航管理（Sprint 10）の画面の共通の枠。各ページは Cookie（本人確認）を読むため、Suspense の内側で描く。
// 判定画面と同じ紙面調の意匠で、事務所の PC と現場のスマートフォンの両方で使う（375px で横スクロールなし）。
// Sprint 12c：下メニュー（今日／判定／計画／日誌／その他）を足した。出す条件（運航管理が有効でログイン済み）はサーバーが決める。
// 現場モード・サインイン・アクセス権なしの画面では、ヘッダーも下メニューも出さない（OpsHeader・OpsBottomNav が経路で判断する）。
// Sprint 12g：/ops/design（デザイン見本。本番で 404）は枠もヘッダーも出さない（OpsFrame が経路で判断する）。
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
        <div className={OPS_FRAME_CLASS}>
          <p className="text-sm text-ink-mute">読み込み中…</p>
        </div>
      }
    >
      <OpsFrame
        chrome={
          <>
            <Suspense fallback={null}>
              <OpsHeader />
            </Suspense>
            <Suspense fallback={null}>
              <OpsNavGate />
            </Suspense>
          </>
        }
      >
        <Suspense fallback={<p className="text-sm text-ink-mute">読み込み中…</p>}>{children}</Suspense>
      </OpsFrame>
    </Suspense>
  );
}
