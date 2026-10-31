import type { Metadata } from "next";
import { OfflineTodayShell } from "@/components/ops/offline-shells";
import { requireOpsEnabled } from "@/server/ops/page";

// 圏外用の画面の枠（Sprint 15）。Service Worker が Cookie なしで取得してキャッシュし、通信できないときに返す。
// 利用者のデータを描かない（中身は端末の先読みの束と送信待ちから、ブラウザの中で組み立てる）。OPS_ENABLED が無効なら 404。
export const metadata: Metadata = { title: "ホーム（圏外）" };

export default async function OfflineTodayPage() {
  await requireOpsEnabled();
  return <OfflineTodayShell />;
}
