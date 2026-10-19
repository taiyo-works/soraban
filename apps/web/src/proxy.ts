// 運航管理（Sprint 10）の機能フラグの関所。認可はここに置かない（各ページ・ルートハンドラの冒頭で行う）。
// - OPS_ENABLED が無効（既定）：/ops 以下、/api/ops、/api/auth（Neon Auth の中継）、/api/test-auth はすべて 404。
// - 設定不足（misconfigured）：画面は「運航管理は準備中です」と理由コードだけの 503、API は 503。
// - 有効（neon）：/ops 以下で Neon Auth の SDK のミドルウェア処理（verifier の交換・Cookie の更新・未ログインの転送）を通す
//   （server/ops/neon-proxy.ts）。有効（test）：そのまま通す。
// - /api/test-auth は test 方式で有効なとき以外は常に 404。
// matcher 以外のパス（地点判定・申請支援）には関与しない。
import { NextResponse, type NextRequest } from "next/server";
import { getOpsAvailability } from "@/server/ops/availability";
import { runNeonAuthProxy } from "@/server/ops/neon-proxy";

// 503 の画面はアプリの描画を通らないため、判定画面の配色（紙・インク・藍）を最小限のインラインの CSS で写す。
const PAGE_503_STYLE =
  ":root{color-scheme:light dark;--paper:#f5f2ea;--ink:#0e1421;--mute:#5b6170;--rule:#c9c2ad;--brand:#1d3557}" +
  "@media (prefers-color-scheme:dark){:root{--paper:#0c1320;--ink:#e7e2d2;--mute:#8a8a85;--rule:#2c3550;--brand:#c3cedc}}" +
  "body{margin:0;background:var(--paper);color:var(--ink);font-family:'Hiragino Sans','Yu Gothic','Meiryo',sans-serif;line-height:1.8}" +
  "main{max-width:36rem;margin:0 auto;padding:2.5rem 1rem}" +
  ".eyebrow{margin:0;font-size:.7rem;letter-spacing:.18em;text-transform:uppercase;font-style:italic;color:var(--mute)}" +
  "h1{margin:.25rem 0 1rem;padding-bottom:.75rem;border-bottom:1px solid var(--rule);font-family:serif;font-weight:300;font-size:1.6rem;line-height:1.3}" +
  "p{margin:0 0 .9rem;font-size:.9rem}code{font-family:Menlo,Monaco,monospace;font-size:.85rem;padding:0 .3rem;border:1px solid var(--rule);border-radius:2px;overflow-wrap:anywhere}" +
  ".note{padding-left:.75rem;border-left:2px solid var(--brand)}a{color:var(--brand);text-underline-offset:.2em}";

const page503 = (reason: string): string =>
  `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>運航管理は準備中です — そらばん</title><style>${PAGE_503_STYLE}</style></head>` +
  `<body><main><p class="eyebrow">Soraban — Flight operations</p><h1>運航管理は準備中です</h1>` +
  `<p class="note">設定が完了していないため、運航管理の機能を使えません。管理者にお問い合わせください。</p>` +
  `<p>理由コード：<code>${reason}</code></p><p><a href="/">地点判定に戻る</a></p></main></body></html>`;

export async function proxy(request: NextRequest) {
  const a = getOpsAvailability(process.env);
  const pathname = request.nextUrl.pathname;
  const isApi = pathname.startsWith("/api/");
  // テスト用の本人確認は、test 方式で有効なとき以外は常に 404（設定不足・本番でも 503 ではなく 404）。
  if (pathname.startsWith("/api/test-auth/") && !(a.state === "enabled" && a.provider === "test")) {
    return NextResponse.json({ error: "not_found" }, { status: 404, headers: { "cache-control": "no-store" } });
  }
  if (a.state === "enabled") {
    // neon：/ops 以下で SDK のミドルウェア処理（Google から戻ったときの verifier の交換、セッションの Cookie の更新、
    // 未ログインのサインイン画面への転送）を行う。/ops/sign-in・/ops/no-access は保護しないが、交換と更新は行う。
    if (a.provider === "neon") return runNeonAuthProxy(request, process.env);
    return NextResponse.next();
  }
  if (a.state === "disabled") {
    return isApi
      ? NextResponse.json({ error: "not_found" }, { status: 404, headers: { "cache-control": "no-store" } })
      : new NextResponse("Not Found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
  }
  return isApi
    ? NextResponse.json({ error: "ops_unavailable", reason: a.reason }, { status: 503, headers: { "cache-control": "no-store" } })
    : new NextResponse(page503(a.reason), {
        status: 503,
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
      });
}

export const config = {
  matcher: ["/ops", "/ops/:path*", "/api/ops/:path*", "/api/auth/:path*", "/api/test-auth/:path*"],
};
