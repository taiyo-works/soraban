import { headers } from "next/headers";
import { DESIGN_CATALOG_HEADER } from "@/lib/design-catalog";
import { getSignedInMember } from "@/server/ops/member-gate";
import { OpsBottomNav } from "./ops-nav";

// 下メニューを出してよいか（運航管理が有効でログイン済みの利用者）をサーバーで決めてから、下メニューを描く。
// 無効・未ログインでは何も描かず、追加の通信もしない。Suspense の内側で使う（静的なシェルを変えない）。
export async function OpsNavGate() {
  // Sprint 12g：デザイン見本は認証・DB を使わない。proxy.ts が付けた印があれば、利用者の確認（認証・DB）をしない。
  if ((await headers()).get(DESIGN_CATALOG_HEADER) === "1") return null;
  const ctx = await getSignedInMember();
  return ctx ? <OpsBottomNav /> : null;
}
