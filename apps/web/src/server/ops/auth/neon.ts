// Neon Auth（@neondatabase/auth、ベータ版）の実装（Sprint 10 設計 A）。
// - SDK はこのファイルの中だけで使う（境界の外には Identity だけを出す）。
// - モジュールの読み込み時に SDK を読み込まず、環境変数も読まない。使うときに動的 import で遅延生成する。
// - セッションなし・SDK の例外は null。例外のログは種別とコードだけ（メールアドレス・氏名を含めない）。
import type { OpsEnv } from "../availability";
import { describeError, type Identity } from "./identity";

type NeonAuthInstance = {
  getSession: () => Promise<unknown>;
  handler: () => {
    GET: (req: Request, ctx: { params: Promise<{ path: string[] }> }) => Promise<Response>;
    POST: (req: Request, ctx: { params: Promise<{ path: string[] }> }) => Promise<Response>;
  };
};

/** auth.getSession() の結果（{ data: { user, session } | null }）を Identity に写す。 */
export const identityFromNeonSession = async (fetchSession: () => Promise<unknown>): Promise<Identity | null> => {
  try {
    const r = (await fetchSession()) as { data?: { user?: Record<string, unknown> | null } | null } | null;
    const u = r?.data?.user;
    if (!u) return null;
    const id = u["id"];
    const email = u["email"];
    if ((typeof id !== "string" && typeof id !== "number") || typeof email !== "string" || email.trim() === "") {
      return null;
    }
    const name = u["name"];
    return {
      provider: "neon",
      authUserId: String(id),
      email: email.trim().toLowerCase(),
      emailVerified: u["emailVerified"] === true,
      name: typeof name === "string" && name.trim() !== "" ? name.trim() : null,
    };
  } catch (e) {
    console.error(`[ops] neon auth getSession failed: ${describeError(e)}`);
    return null;
  }
};

let cached: { readonly key: string; readonly auth: NeonAuthInstance } | null = null;

/** Neon Auth の SDK を遅延生成する（同じ設定なら使い回す）。 */
export const getNeonAuth = async (env: OpsEnv): Promise<NeonAuthInstance> => {
  const baseUrl = env["NEON_AUTH_BASE_URL"]?.trim() ?? "";
  const secret = env["NEON_AUTH_COOKIE_SECRET"]?.trim() ?? "";
  const key = `${baseUrl}\n${secret}`;
  if (cached && cached.key === key) return cached.auth;
  const { createNeonAuth } = await import("@neondatabase/auth/next/server");
  const auth = createNeonAuth({ baseUrl, cookies: { secret } }) as unknown as NeonAuthInstance;
  cached = { key, auth };
  return auth;
};
