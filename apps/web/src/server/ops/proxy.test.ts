// proxy.ts（機能フラグの関所）：無効なら 404、設定不足なら 503（画面は理由コードだけ）、有効なら通す。
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { config, proxy } from "../../proxy";

afterEach(() => vi.unstubAllEnvs());

const req = (path: string) => new NextRequest(new URL(path, "http://127.0.0.1:3000"));

describe("proxy", () => {
  it("OPS_ENABLED なしは画面・API とも 404", async () => {
    vi.stubEnv("OPS_ENABLED", "");
    expect(proxy(req("/ops")).status).toBe(404);
    const api = proxy(req("/api/ops/me"));
    expect(api.status).toBe(404);
    expect(await api.json()).toEqual({ error: "not_found" });
  });

  it("設定不足は 503。画面は理由コードだけを示し、環境変数の値は出さない", async () => {
    vi.stubEnv("OPS_ENABLED", "1");
    vi.stubEnv("DATABASE_URL", "postgresql://user:very-secret-pw@db.example.com/x");
    vi.stubEnv("AUTH_PROVIDER", "neon");
    vi.stubEnv("NEON_AUTH_BASE_URL", "");
    const page = proxy(req("/ops/aircraft"));
    expect(page.status).toBe(503);
    const html = await page.text();
    expect(html).toContain("運航管理は準備中です");
    expect(html).toContain("neon_auth_base_url_missing");
    expect(html).not.toContain("very-secret-pw");
    const api = proxy(req("/api/ops/aircraft"));
    expect(api.status).toBe(503);
    expect(await api.json()).toEqual({ error: "ops_unavailable", reason: "neon_auth_base_url_missing" });
  });

  it("有効なら通す（認可は各ページ・ルートハンドラで行う）", () => {
    vi.stubEnv("OPS_ENABLED", "1");
    vi.stubEnv("DATABASE_URL", "postgresql://u:p@localhost/x");
    vi.stubEnv("AUTH_PROVIDER", "test");
    vi.stubEnv("AUTH_TEST_SECRET", "s");
    vi.stubEnv("VERCEL_ENV", "");
    const r = proxy(req("/ops"));
    expect(r.status).toBe(200);
    expect(r.headers.get("x-middleware-next")).toBe("1");
  });

  it("matcher は運航管理・認証の経路だけ", () => {
    expect(config.matcher).toEqual(["/ops", "/ops/:path*", "/api/ops/:path*", "/api/auth/:path*", "/api/test-auth/:path*"]);
  });
});
