// Sprint 10 契約 5：test の実装。
import { describe, expect, it } from "vitest";
import { handleTestSignIn } from "../handlers";
import { meGet, aircraftCreate } from "../handlers";
import type { OpsDeps } from "../http";
import { signTestAuthCookie, verifyTestAuthCookie } from "./test-auth";

const TEST_ENV = { OPS_ENABLED: "1", DATABASE_URL: "postgresql://u:p@localhost/db", AUTH_PROVIDER: "test", AUTH_TEST_SECRET: "secret-1" };
const signIn = (env: Record<string, string | undefined>) =>
  handleTestSignIn(
    new Request("http://127.0.0.1:3300/api/test-auth/sign-in", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ authUserId: "u1", email: "a@example.com", emailVerified: true, name: "A" }),
    }),
    env,
  );

describe("テスト用の本人確認", () => {
  it("AUTH_PROVIDER=test でないとき /api/test-auth/sign-in は 404", async () => {
    expect((await signIn({})).status).toBe(404);
    expect((await signIn({ ...TEST_ENV, OPS_ENABLED: undefined })).status).toBe(404);
    expect(
      (await signIn({ ...TEST_ENV, AUTH_PROVIDER: "neon", NEON_AUTH_BASE_URL: "https://x", NEON_AUTH_COOKIE_SECRET: "y".repeat(32) }))
        .status,
    ).toBe(404);
  });

  it("VERCEL_ENV=production のとき /api/test-auth/sign-in は 404", async () => {
    const r = await signIn({ ...TEST_ENV, VERCEL_ENV: "production" });
    expect(r.status).toBe(404);
    expect(r.headers.get("set-cookie")).toBeNull();
  });

  it("AUTH_PROVIDER=test なら HttpOnly・SameSite=Lax の署名付き Cookie を発行する", async () => {
    const r = await signIn(TEST_ENV);
    expect(r.status).toBe(200);
    const c = r.headers.get("set-cookie") ?? "";
    expect(c).toMatch(/^soraban_test_auth=[^;]+\.[^;]+;/);
    expect(c).toContain("HttpOnly");
    expect(c).toContain("SameSite=Lax");
    const value = /^soraban_test_auth=([^;]+);/.exec(c)![1]!;
    expect(verifyTestAuthCookie(value, "secret-1")).toMatchObject({ provider: "test", authUserId: "u1", emailVerified: true });
  });

  it("VERCEL_ENV=preview でも 404。他サイトの Origin からのログインは 403（Cookie を発行しない）", async () => {
    expect((await signIn({ ...TEST_ENV, VERCEL_ENV: "preview" })).status).toBe(404);
    const r = await handleTestSignIn(
      new Request("http://127.0.0.1:3300/api/test-auth/sign-in", {
        method: "POST",
        headers: { host: "127.0.0.1:3300", origin: "https://evil.example", "content-type": "application/json" },
        body: JSON.stringify({ authUserId: "u1", email: "a@example.com", emailVerified: true }),
      }),
      TEST_ENV,
    );
    expect(r.status).toBe(403);
    expect(r.headers.get("set-cookie")).toBeNull();
  });

  it("署名を 1 文字変えた Cookie は未ログイン扱い（null）", () => {
    const v = signTestAuthCookie({ authUserId: "u1", email: "a@example.com", emailVerified: true, name: null }, "secret-1");
    expect(verifyTestAuthCookie(v, "secret-1")).not.toBeNull();
    const last = v.at(-1)!;
    const tampered = v.slice(0, -1) + (last === "A" ? "B" : "A");
    expect(verifyTestAuthCookie(tampered, "secret-1")).toBeNull();
    // 本文を 1 文字変えても null
    const dot = v.indexOf(".");
    const body = v.slice(0, dot);
    const b2 = body.slice(0, 5) + (body[5] === "A" ? "B" : "A") + body.slice(6);
    expect(verifyTestAuthCookie(`${b2}${v.slice(dot)}`, "secret-1")).toBeNull();
    // 別の秘密で署名したものも null
    expect(verifyTestAuthCookie(v, "secret-2")).toBeNull();
    expect(verifyTestAuthCookie(undefined, "secret-1")).toBeNull();
    expect(verifyTestAuthCookie("garbage", "secret-1")).toBeNull();
  });

  it("期限切れの Cookie は null", () => {
    const v = signTestAuthCookie({ authUserId: "u1", email: "a@example.com", emailVerified: true, name: null }, "s", 1_000);
    expect(verifyTestAuthCookie(v, "s", 1_000 + 60)).not.toBeNull();
    expect(verifyTestAuthCookie(v, "s", 1_000 + 9 * 3600)).toBeNull();
  });

  it("変更を伴う /api/ops/* に他サイトの Origin を付けると 403（本人確認より前に拒否）", async () => {
    let identityAsked = false;
    const deps: OpsDeps = {
      env: TEST_ENV,
      getIdentity: async () => {
        identityAsked = true;
        return null;
      },
      getDb: () => null,
    };
    const req = (origin: string | null) =>
      new Request("http://127.0.0.1:3300/api/ops/aircraft", {
        method: "POST",
        headers: { host: "127.0.0.1:3300", "content-type": "application/json", ...(origin ? { origin } : {}) },
        body: "{}",
      });
    const r = await aircraftCreate(req("https://evil.example"), {}, deps);
    expect(r.status).toBe(403);
    expect(identityAsked).toBe(false);
    // 自サイトの Origin は通る（未ログインなので 401）
    expect((await aircraftCreate(req("http://127.0.0.1:3300"), {}, deps)).status).toBe(401);
    // Origin なし・Sec-Fetch-Site が cross-site なら 403
    const cross = new Request("http://127.0.0.1:3300/api/ops/aircraft", {
      method: "POST",
      headers: { host: "127.0.0.1:3300", "sec-fetch-site": "cross-site" },
      body: "{}",
    });
    expect((await aircraftCreate(cross, {}, deps)).status).toBe(403);
    // GET は Origin を確かめない
    expect((await meGet(new Request("http://127.0.0.1:3300/api/ops/me", { headers: { origin: "https://evil.example" } }), {}, deps)).status).toBe(401);
  });
});
