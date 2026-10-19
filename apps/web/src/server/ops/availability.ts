// 運航管理（利用者機能）の可否を決める 1 か所の関数（Sprint 10 設計 A）。
// - OPS_ENABLED が "1" でなければ disabled（既定）。/ops・/api/ops・/api/auth・/api/test-auth はすべて 404。
// - 必要な環境変数が欠けていれば misconfigured（理由コードだけを示す。値は示さない）。
// - AUTH_PROVIDER=test は本番（VERCEL_ENV=production）では使わせない。
// 環境変数はモジュールの読み込み時ではなく、呼ばれたときに読む。

export type OpsEnv = Readonly<Record<string, string | undefined>>;

export type AuthProviderName = "neon" | "test";

export type OpsMisconfigReason =
  | "database_url_missing"
  | "auth_provider_missing"
  | "auth_provider_invalid"
  | "neon_auth_base_url_missing"
  | "neon_auth_cookie_secret_missing"
  | "neon_auth_cookie_secret_too_short"
  | "auth_test_secret_missing"
  | "test_auth_in_production";

export type OpsAvailability =
  | { readonly state: "disabled" }
  | { readonly state: "misconfigured"; readonly reason: OpsMisconfigReason }
  | { readonly state: "enabled"; readonly provider: AuthProviderName };

const nonEmpty = (v: string | undefined): string | undefined =>
  typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;

/** NEON_AUTH_COOKIE_SECRET の最小文字数（SDK の要件：32 文字以上）。 */
export const NEON_AUTH_COOKIE_SECRET_MIN = 32;

export const getOpsAvailability = (env: OpsEnv = process.env): OpsAvailability => {
  if (nonEmpty(env["OPS_ENABLED"]) !== "1") return { state: "disabled" };
  const bad = (reason: OpsMisconfigReason): OpsAvailability => ({ state: "misconfigured", reason });

  if (!nonEmpty(env["DATABASE_URL"])) return bad("database_url_missing");
  const provider = nonEmpty(env["AUTH_PROVIDER"]);
  if (!provider) return bad("auth_provider_missing");
  if (provider === "neon") {
    if (!nonEmpty(env["NEON_AUTH_BASE_URL"])) return bad("neon_auth_base_url_missing");
    const secret = nonEmpty(env["NEON_AUTH_COOKIE_SECRET"]);
    if (!secret) return bad("neon_auth_cookie_secret_missing");
    if (secret.length < NEON_AUTH_COOKIE_SECRET_MIN) return bad("neon_auth_cookie_secret_too_short");
    return { state: "enabled", provider: "neon" };
  }
  if (provider === "test") {
    if (nonEmpty(env["VERCEL_ENV"]) === "production") return bad("test_auth_in_production");
    if (!nonEmpty(env["AUTH_TEST_SECRET"])) return bad("auth_test_secret_missing");
    return { state: "enabled", provider: "test" };
  }
  return bad("auth_provider_invalid");
};
