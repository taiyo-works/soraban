"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { DESIGN_CATALOG_PATH } from "@/lib/design-catalog";
import { OpsBrandHeader } from "./ops-nav";

// 運航管理の画面の共通の枠（Sprint 12g-1b 段階 A）。`/ops` の根に `.ds`（紙面のトークン）を付ける。`/`（公開ページ）には付けない。
//   PC：左にメニュー、右に上のバー（利用者メニュー）と本文（最大幅 1024px の 1 本の列）。スマホ：上のバー、本文、下の 5 タブ。
// デザイン見本（/ops/design）は全幅で自前のレイアウト（と `.ds`）を持つため、この枠を付けない。
// pathname は動的なルートでは要求時にしか分からないため、呼び出し側（ops/layout.tsx）が Suspense の内側に置く。
export const OPS_CONTENT_CLASS = "mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-4 py-6 sm:px-6 sm:py-8 sm:gap-10 lg:px-8";

export function OpsFrame({ nav, topBar, children }: { readonly nav: ReactNode; readonly topBar: ReactNode; readonly children: ReactNode }) {
  const pathname = usePathname() ?? "";
  if (pathname === DESIGN_CATALOG_PATH) return <>{children}</>;
  return (
    <div className="ds ds-page flex flex-1 flex-col lg:flex-row" data-testid="ops-root">
      {nav}
      <div className="flex min-w-0 flex-1 flex-col">
        {topBar}
        <div className={OPS_CONTENT_CLASS}>
          <OpsBrandHeader />
          {children}
        </div>
      </div>
    </div>
  );
}
