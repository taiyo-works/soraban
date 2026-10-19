// proxy.ts から呼ぶ Neon Auth のミドルウェア処理（AUTH_PROVIDER=neon かつ有効なときの /ops 以下だけ。Sprint 10 差し戻し A）。
//
// なぜ proxy で行うか：
// 1. Google から戻ると /ops?neon_auth_session_verifier=… と challenge Cookie が届く。verifier をセッション
//    （session_token）に交換するのは SDK のミドルウェア処理（processAuthMiddleware → exchangeOAuthToken）だけで、
//    ページの getSession() では交換されない。
// 2. セッションの Cookie（session_data 等）の更新は Set-Cookie を伴う。サーバーコンポーネントの中では
//    cookies().set が例外になるため、ページの描画より前（ここ）で更新し、同じ要求の Cookie ヘッダーにも反映して
//    ページの getSession() が Cookie の写しだけで済む（上流への問い合わせ・Cookie の書き込みが起きない）ようにする。
//
// SDK の Next.js 用ミドルウェア（auth.middleware）は「ログイン画面では何もしない」ため、/ops/sign-in・/ops/no-access で
// verifier の交換と Cookie の更新が行われない。そこで同じ SDK の processAuthMiddleware を直接使い、
// 保護しない画面（PUBLIC_OPS_PATHS）でも交換・更新だけは行う。
import { NextResponse, type NextRequest } from "next/server";
import type { OpsEnv } from "./availability";

/** 保護しない（未ログインでも開ける）運航管理の画面。verifier の交換と Cookie の更新は行う。 */
export const PUBLIC_OPS_PATHS = ["/ops/sign-in", "/ops/no-access"] as const;
export const OPS_LOGIN_URL = "/ops/sign-in";

const isUnder = (pathname: string, base: string): boolean => pathname === base || pathname.startsWith(`${base}/`);

/** Set-Cookie の「名前=値」と、削除（Max-Age=0・過去の Expires）かどうか。 */
const parseSetCookie = (header: string): { name: string; value: string; deleted: boolean } | null => {
  const [pair, ...attrs] = header.split(";");
  const eq = pair?.indexOf("=") ?? -1;
  if (!pair || eq <= 0) return null;
  const name = pair.slice(0, eq).trim();
  const value = pair.slice(eq + 1).trim();
  let deleted = value === "";
  for (const a of attrs) {
    const [k, v] = a.split("=").map((x) => x.trim());
    if (k?.toLowerCase() === "max-age" && Number(v) <= 0) deleted = true;
    if (k?.toLowerCase() === "expires" && v && Date.parse(v) <= Date.now()) deleted = true;
  }
  return { name, value, deleted };
};

/** 要求の Cookie ヘッダーに Set-Cookie を反映する（同じ要求のページ・ルートハンドラが更新後の Cookie を読む）。 */
export const mergeCookieHeader = (cookieHeader: string | null, setCookies: readonly string[]): string => {
  const jar = new Map<string, string>();
  for (const part of (cookieHeader ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0) jar.set(part.slice(0, eq).trim(), part.slice(eq + 1).trim());
  }
  for (const sc of setCookies) {
    const c = parseSetCookie(sc);
    if (!c) continue;
    if (c.deleted) jar.delete(c.name);
    else jar.set(c.name, c.value);
  }
  return [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
};

export const runNeonAuthProxy = async (request: NextRequest, env: OpsEnv): Promise<NextResponse> => {
  const pathname = request.nextUrl.pathname;
  // /api 以下（API・Neon Auth の中継）はここでは扱わない（ルートハンドラの getSession は Cookie を書ける）。
  if (!isUnder(pathname, "/ops")) return NextResponse.next();
  const { processAuthMiddleware, DEFAULT_AUTH_SKIP_ROUTES } = await import("@neondatabase/auth/server");
  const isPublic = PUBLIC_OPS_PATHS.some((p) => isUnder(pathname, p));
  const result = await processAuthMiddleware({
    request,
    pathname,
    skipRoutes: [...DEFAULT_AUTH_SKIP_ROUTES, ...PUBLIC_OPS_PATHS],
    // SDK は「ログイン画面の URL と同じパス」では交換・更新をせずに素通りさせる。保護しない画面では、
    // ログイン画面の URL を別オリジンの番兵にしてその早期判定を避ける（保護しない画面なので転送先には使われない）。
    loginUrl: isPublic ? "https://login.invalid/" : OPS_LOGIN_URL,
    baseUrl: env["NEON_AUTH_BASE_URL"]!.trim(),
    cookieSecret: env["NEON_AUTH_COOKIE_SECRET"]!.trim(),
  } as Parameters<typeof processAuthMiddleware>[0]);

  switch (result.action) {
    case "allow": {
      const headers = new Headers(request.headers);
      for (const [k, v] of Object.entries(result.headers ?? {})) headers.set(k, v);
      const cookies = result.cookies ?? [];
      if (cookies.length > 0) headers.set("cookie", mergeCookieHeader(request.headers.get("cookie"), cookies));
      const res = NextResponse.next({ request: { headers } });
      for (const c of cookies) res.headers.append("set-cookie", c);
      return res;
    }
    case "redirect_oauth":
    case "redirect_login": {
      const res = NextResponse.redirect(result.redirectUrl);
      for (const c of result.cookies ?? []) res.headers.append("set-cookie", c);
      return res;
    }
  }
  return NextResponse.next();
};
