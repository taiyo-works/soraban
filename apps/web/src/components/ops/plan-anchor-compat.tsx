"use client";

import { useEffect } from "react";

// 旧い計画の詳細（/ops/plans/[id]）のアンカーは、サーバーに届かない。ブックマークされた旧いアンカーを新しい場所へ移す（Sprint 17-1 §5.2）。
const MOVES: Readonly<Record<string, string>> = {
  "#sec-verdict": "/judgement",
  "#permits": "/judgement",
  "#rejudge": "/judgement",
  "#sec-confirm": "/overview",
  "#request-confirmation": "/overview",
  "#confirm": "/overview",
  "#procedures": "/overview",
};

/** 旧いアンカー → 新しい場所（#sec-report は通報の主画面そのものなので移さない）。hash は引き継ぐ。 */
export const legacyAnchorTarget = (planId: string, hash: string): string | null => {
  const to = MOVES[hash];
  return to ? `/ops/plans/${planId}${to}${hash}` : null;
};

export function PlanAnchorCompat({ planId }: { readonly planId: string }) {
  useEffect(() => {
    const to = legacyAnchorTarget(planId, window.location.hash);
    if (to) window.location.replace(to);
  }, [planId]);
  return null;
}
