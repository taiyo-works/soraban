// Sprint 10 契約 1：getOpsAvailability が設計 A の表のすべての行で所定の結果と理由コードを返す。
import { describe, expect, it } from "vitest";
import { getOpsAvailability } from "./availability";

const SECRET32 = "x".repeat(32);
const NEON = {
  OPS_ENABLED: "1",
  DATABASE_URL: "postgresql://u:p@localhost/db",
  AUTH_PROVIDER: "neon",
  NEON_AUTH_BASE_URL: "https://example.neonauth.test/neondb/auth",
  NEON_AUTH_COOKIE_SECRET: SECRET32,
};
const TEST = { OPS_ENABLED: "1", DATABASE_URL: "postgresql://u:p@localhost/db", AUTH_PROVIDER: "test", AUTH_TEST_SECRET: "s" };

describe("getOpsAvailability", () => {
  it.each([
    ["OPS_ENABLED なし", {}],
    ["OPS_ENABLED=0", { ...NEON, OPS_ENABLED: "0" }],
    ["OPS_ENABLED=true（1 以外）", { ...NEON, OPS_ENABLED: "true" }],
    ["OPS_ENABLED が空", { ...NEON, OPS_ENABLED: "" }],
  ])("%s → disabled", (_l, env) => {
    expect(getOpsAvailability(env)).toEqual({ state: "disabled" });
  });

  it.each([
    ["DATABASE_URL なし", { ...NEON, DATABASE_URL: undefined }, "database_url_missing"],
    ["AUTH_PROVIDER なし", { ...NEON, AUTH_PROVIDER: undefined }, "auth_provider_missing"],
    ["AUTH_PROVIDER 不正", { ...NEON, AUTH_PROVIDER: "google" }, "auth_provider_invalid"],
    ["neon で NEON_AUTH_BASE_URL なし", { ...NEON, NEON_AUTH_BASE_URL: undefined }, "neon_auth_base_url_missing"],
    ["neon で NEON_AUTH_COOKIE_SECRET なし", { ...NEON, NEON_AUTH_COOKIE_SECRET: " " }, "neon_auth_cookie_secret_missing"],
    ["neon で NEON_AUTH_COOKIE_SECRET が 32 文字未満", { ...NEON, NEON_AUTH_COOKIE_SECRET: "short" }, "neon_auth_cookie_secret_too_short"],
    ["test で AUTH_TEST_SECRET なし", { ...TEST, AUTH_TEST_SECRET: undefined }, "auth_test_secret_missing"],
    ["test かつ VERCEL_ENV=production", { ...TEST, VERCEL_ENV: "production" }, "test_auth_in_production"],
  ])("%s → misconfigured（%s）", (_l, env, reason) => {
    expect(getOpsAvailability(env)).toEqual({ state: "misconfigured", reason });
  });

  it("neon の環境変数がすべて揃う → enabled（neon）", () => {
    expect(getOpsAvailability(NEON)).toEqual({ state: "enabled", provider: "neon" });
    expect(getOpsAvailability({ ...NEON, VERCEL_ENV: "production" })).toEqual({ state: "enabled", provider: "neon" });
  });

  it("test の環境変数がすべて揃う（本番以外） → enabled（test）", () => {
    expect(getOpsAvailability(TEST)).toEqual({ state: "enabled", provider: "test" });
    expect(getOpsAvailability({ ...TEST, VERCEL_ENV: "preview" })).toEqual({ state: "enabled", provider: "test" });
  });
});
