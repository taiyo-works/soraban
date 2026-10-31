import { connection } from "next/server";
import { OFFLINE_SHELLS, SW_CACHE_PREFIX, SW_SCOPE, serviceWorkerSource } from "@/lib/pwa";

// 運航管理の Service Worker（Sprint 15 設計 5）。/ops 以下だけに効く（scope は /ops。公開の判定画面 / には適用しない）。
// OPS_ENABLED が無効なら proxy.ts が 404 を返す（Service Worker は登録されない）。
// キャッシュは許可リスト方式：圏外用の画面の枠（利用者のデータを含まない。Cookie なしで取得）と、それに要る静的ファイルだけ。
// /api/**・/ops/sign-in・利用者のデータを含む画面の応答はキャッシュしない。新しい版は、入力中の画面を勝手に再読み込みしない
// （skipWaiting は利用者の操作のときだけ）。?v= は版（ビルドの識別子）。
export async function GET(req: Request) {
  await connection();
  const v = new URL(req.url).searchParams.get("v");
  const build = process.env.SORABAN_BUILD_ID ?? "dev";
  const version = v && /^[A-Za-z0-9._-]{1,64}$/.test(v) ? v : build;
  return new Response(serviceWorkerSource({ version, shells: OFFLINE_SHELLS, cachePrefix: SW_CACHE_PREFIX }), {
    status: 200,
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      "cache-control": "no-cache, no-store, must-revalidate",
      "service-worker-allowed": SW_SCOPE,
      "content-security-policy": "default-src 'self'; script-src 'self'",
    },
  });
}
