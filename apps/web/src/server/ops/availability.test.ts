// Sprint 10 契約 1：getOpsAvailability が設計 A の表のすべての行で所定の結果と理由コードを返す。
import { describe, expect, it } from "vitest";
import { getOpsAvailability, opsNow } from "./availability";

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
    ["test かつ VERCEL_ENV=production", { ...TEST, VERCEL_ENV: "production" }, "test_auth_on_vercel"],
    ["test かつ VERCEL_ENV=preview", { ...TEST, VERCEL_ENV: "preview" }, "test_auth_on_vercel"],
    ["test かつ VERCEL_ENV=development", { ...TEST, VERCEL_ENV: "development" }, "test_auth_on_vercel"],
  ])("%s → misconfigured（%s）", (_l, env, reason) => {
    expect(getOpsAvailability(env)).toEqual({ state: "misconfigured", reason });
  });

  it("neon の環境変数がすべて揃う → enabled（neon）", () => {
    expect(getOpsAvailability(NEON)).toEqual({ state: "enabled", provider: "neon" });
    expect(getOpsAvailability({ ...NEON, VERCEL_ENV: "production" })).toEqual({ state: "enabled", provider: "neon" });
  });

  it("test の環境変数がすべて揃う（Vercel の外：CI・ローカル） → enabled（test）", () => {
    expect(getOpsAvailability(TEST)).toEqual({ state: "enabled", provider: "test" });
    expect(getOpsAvailability({ ...TEST, VERCEL_ENV: " " })).toEqual({ state: "enabled", provider: "test" });
  });
});

describe("opsNow（Sprint 11：テスト用の時計）", () => {
  const FIXED = "2027-01-05T09:31:00+09:00";
  it("test 方式で有効なときだけ OPS_TEST_NOW に固定する", () => {
    expect(opsNow({ ...TEST, OPS_TEST_NOW: FIXED }).toISOString()).toBe("2027-01-05T00:31:00.000Z");
  });
  it("neon 方式・無効・Vercel 上・解釈できない値では実時刻", () => {
    const before = Date.now();
    for (const env of [
      { ...NEON, OPS_TEST_NOW: FIXED },
      { OPS_TEST_NOW: FIXED },
      { ...TEST, VERCEL_ENV: "preview", OPS_TEST_NOW: FIXED },
      { ...TEST, OPS_TEST_NOW: "あした" },
    ]) {
      const t = opsNow(env).getTime();
      expect(t).toBeGreaterThanOrEqual(before);
      expect(t).toBeLessThan(before + 60_000);
    }
  });
});
