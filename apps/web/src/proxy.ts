// 運航管理（Sprint 10）の機能フラグの関所。認可はここに置かない（各ページ・ルートハンドラの冒頭で行う）。
// - OPS_ENABLED が無効（既定）：/ops 以下、/api/ops、/api/auth（Neon Auth の中継）、/api/test-auth はすべて 404。
// - 設定不足（misconfigured）：画面は「運航管理は準備中です」と理由コードだけの 503、API は 503。
// - 有効：そのまま通す。Neon Auth のセッションの更新はページ・ルートハンドラの getSession() に任せ、ここでは行わない。
// matcher 以外のパス（地点判定・申請支援）には関与しない。
import { NextResponse, type NextRequest } from "next/server";
import { getOpsAvailability } from "@/server/ops/availability";

const page503 = (reason: string): string =>
  `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>運航管理は準備中です — そらばん</title></head>` +
  `<body style="font-family:sans-serif;margin:2rem;line-height:1.7"><h1 style="font-size:1.25rem">運航管理は準備中です</h1>` +
  `<p>設定が完了していないため、運航管理の機能を使えません。管理者にお問い合わせください。</p>` +
  `<p>理由コード：<code>${reason}</code></p><p><a href="/">地点判定に戻る</a></p></body></html>`;

export function proxy(request: NextRequest) {
  const a = getOpsAvailability(process.env);
  if (a.state === "enabled") return NextResponse.next();
  const isApi = request.nextUrl.pathname.startsWith("/api/");
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
