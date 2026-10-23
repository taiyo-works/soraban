// Sprint 12g stage 1a contract 1a-7: the design catalog is a 404 unless DESIGN_CATALOG is "1" and the deployment is not
// production. Four env combinations, the proxy's answer, and "no auth / no DB / no network" for the page.
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DESIGN_CATALOG_HEADER, DESIGN_CATALOG_PATH, isDesignCatalogEnabled } from "./design-catalog";
import { proxy } from "../proxy";

afterEach(() => vi.unstubAllEnvs());

describe("isDesignCatalogEnabled（環境の組み合わせ）", () => {
  it("DESIGN_CATALOG=1 かつ本番でない：表示する（VERCEL_ENV が空・preview・development）", () => {
    expect(isDesignCatalogEnabled({ DESIGN_CATALOG: "1" })).toBe(true);
    expect(isDesignCatalogEnabled({ DESIGN_CATALOG: "1", VERCEL_ENV: "" })).toBe(true);
    expect(isDesignCatalogEnabled({ DESIGN_CATALOG: "1", VERCEL_ENV: "preview" })).toBe(true);
    expect(isDesignCatalogEnabled({ DESIGN_CATALOG: "1", VERCEL_ENV: "development" })).toBe(true);
  });
  it("DESIGN_CATALOG が 1 でない：404（未設定・0・true・空）", () => {
    expect(isDesignCatalogEnabled({})).toBe(false);
    for (const v of ["", "0", "true", "yes", "11", " 1"]) expect(isDesignCatalogEnabled({ DESIGN_CATALOG: v }), JSON.stringify(v)).toBe(false);
  });
  it("本番のデプロイ（VERCEL_ENV=production）：DESIGN_CATALOG=1 でも 404", () => {
    expect(isDesignCatalogEnabled({ DESIGN_CATALOG: "1", VERCEL_ENV: "production" })).toBe(false);
  });
  it("4 通り：フラグ有・無 × 本番・本番でない", () => {
    const table: [Record<string, string>, boolean][] = [
      [{ DESIGN_CATALOG: "1", VERCEL_ENV: "preview" }, true],
      [{ DESIGN_CATALOG: "1", VERCEL_ENV: "production" }, false],
      [{ VERCEL_ENV: "preview" }, false],
      [{ VERCEL_ENV: "production" }, false],
    ];
    for (const [env, expected] of table) expect(isDesignCatalogEnabled(env), JSON.stringify(env)).toBe(expected);
  });
});

const req = (path: string, headers?: Record<string, string>) => new NextRequest(new URL(path, "http://127.0.0.1:3000"), { headers });

describe("proxy.ts：/ops/design", () => {
  it("無効：運航管理の設定に関わらず 404（運航管理が有効でも、無効でも）", async () => {
    for (const ops of ["", "1"]) {
      vi.stubEnv("OPS_ENABLED", ops);
      vi.stubEnv("DESIGN_CATALOG", "");
      const r = await proxy(req(DESIGN_CATALOG_PATH));
      expect(r.status, `OPS_ENABLED=${ops}`).toBe(404);
    }
  });
  it("本番のデプロイでは DESIGN_CATALOG=1 でも 404", async () => {
    vi.stubEnv("DESIGN_CATALOG", "1");
    vi.stubEnv("VERCEL_ENV", "production");
    expect((await proxy(req(DESIGN_CATALOG_PATH))).status).toBe(404);
  });
  it("有効：運航管理が無効（設定不足でも）でも通し、認証の処理（neon）へ渡さず、見本の印のヘッダーを付ける", async () => {
    vi.stubEnv("DESIGN_CATALOG", "1");
    vi.stubEnv("VERCEL_ENV", "");
    for (const env of [
      { OPS_ENABLED: "" },
      { OPS_ENABLED: "1", AUTH_PROVIDER: "neon", NEON_AUTH_BASE_URL: "" },
    ]) {
      for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
      const r = await proxy(req(DESIGN_CATALOG_PATH));
      expect(r.status).toBe(200);
      expect(r.headers.get("x-middleware-next")).toBe("1");
      expect(r.headers.get("x-middleware-request-" + DESIGN_CATALOG_HEADER)).toBe("1");
    }
  });
  it("/ops/design 以外の /ops は、これまでどおり（無効なら 404）", async () => {
    vi.stubEnv("DESIGN_CATALOG", "1");
    vi.stubEnv("OPS_ENABLED", "");
    expect((await proxy(req("/ops"))).status).toBe(404);
    expect((await proxy(req("/ops/design/x"))).status).toBe(404);
    expect((await proxy(req("/ops/designs"))).status).toBe(404);
  });
});

describe("見本のページ", () => {
  const page = readFileSync(new URL("../app/ops/design/page.tsx", import.meta.url), "utf8");
  it("ページ自身も環境変数で notFound() にする（proxy が先に 404 を返す二重の守り）。noindex。リクエストごとに評価する", () => {
    expect(page).toContain("isDesignCatalogEnabled(process.env)");
    expect(page).toContain("notFound()");
    expect(page).toContain("await connection()");
    expect(page).toMatch(/robots:\s*\{\s*index:\s*false,\s*follow:\s*false/);
  });
  it("認証・DB・外部通信を使わない", () => {
    expect(page).not.toMatch(/@soraban\/db|getPool|getCurrentIdentity|requireOps|fetch\(/);
  });
});

describe("見本の設定（クエリ文字列）", () => {
  it("既知の値だけを読み、不明な値は既定に戻す", async () => {
    const { parseConfig, DEFAULT_CONFIG } = await import("../components/ui/catalog/config");
    expect(parseConfig({})).toEqual(DEFAULT_CONFIG);
    expect(parseConfig({ theme: "dark", palette: "3", field: "1", density: "compact", screen: "workspace" })).toEqual({
      theme: "dark", palette: "3", field: true, density: "compact", screen: "workspace",
    });
    expect(parseConfig({ theme: "neon", palette: "9", field: "yes", density: "x", screen: "none" })).toEqual(DEFAULT_CONFIG);
    expect(parseConfig({ theme: ["light", "dark"] }).theme).toBe("light");
  });
});
