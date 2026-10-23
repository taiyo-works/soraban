"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { DESIGN_CATALOG_PATH } from "@/lib/design-catalog";

// 運航管理の画面の共通の枠（幅 896px の 1 本の列とヘッダー・下メニュー）。
// Sprint 12g：デザイン見本（/ops/design）は全幅で自前のレイアウトを持つため、この枠とヘッダー・下メニューを付けない。
// それ以外の画面は従来と同じ DOM（変更なし）。pathname は動的なルートでは要求時にしか分からないため、呼び出し側（ops/layout.tsx）が Suspense の内側に置く。
export const OPS_FRAME_CLASS = "mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-4 py-6 sm:gap-10 sm:px-6 sm:py-10";

export function OpsFrame({ chrome, children }: { readonly chrome: ReactNode; readonly children: ReactNode }) {
  const pathname = usePathname() ?? "";
  if (pathname === DESIGN_CATALOG_PATH) return <>{children}</>;
  return (
    <div className={OPS_FRAME_CLASS}>
      {chrome}
      {children}
    </div>
  );
}
