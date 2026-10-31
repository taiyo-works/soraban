import { connection } from "next/server";
import { pwaManifest } from "@/lib/pwa";

// 運航管理の Web アプリマニフェスト（Sprint 15 契約 A-1）。/ops の画面の <link rel="manifest"> から読む（app/ops/layout.tsx の metadata）。
// app/manifest.ts（ルートの規約）は公開の判定画面 / にも付くため使わず、/ops の下のルートハンドラにした。OPS_ENABLED が無効なら proxy.ts が 404。
// 利用者のデータを含まないので、ログインしていなくても返す（ブラウザはマニフェストを Cookie なしで取得する）。
export async function GET() {
  await connection();
  return new Response(JSON.stringify(pwaManifest()), {
    status: 200,
    headers: { "content-type": "application/manifest+json; charset=utf-8", "cache-control": "no-cache" },
  });
}
