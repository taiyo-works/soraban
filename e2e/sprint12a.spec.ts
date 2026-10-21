import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

// Sprint 12a 契約 18（OPS_ENABLED が無効の側）の E2E。DB なし・OPS_ENABLED なし（通常の E2E の設定）。
// - `/` に「運航管理」のリンクも「この判定で飛行計画を作る」ボタンもない。
// - `/ops/plans`・`/api/ops/plans` は 404。
// - 運航管理に関する追加の要求（/ops・/api/ops への通信）も、コンソールのエラーも出ない。
// - pnpm build の出力で `/` が静的シェル（部分的な事前描画）のまま。
// 運航管理が有効な側（リンクとボタンが出る、入力を引き継ぐ）は e2e/ops-db/sprint12a-db.spec.ts。

const waitCheck = (page: Page) => page.waitForResponse((r) => r.url().endsWith("/api/check") && r.ok());
const waitDiagnose = (page: Page) => page.waitForResponse((r) => r.url().endsWith("/api/diagnose") && r.ok());

test.describe("Sprint 12a 契約 18：運航管理が無効のとき", () => {
  test("`/` に運航管理のリンクも「この判定で飛行計画を作る」もなく、追加の要求もコンソールのエラーもない", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push(m.text());
    });
    page.on("pageerror", (e) => consoleErrors.push(String(e)));
    const requested: string[] = [];
    page.on("request", (r) => requested.push(new URL(r.url()).pathname));
    const failed: string[] = [];
    page.on("response", (r) => {
      if (r.status() >= 400) failed.push(`${r.status()} ${new URL(r.url()).pathname}`);
    });

    const check = waitCheck(page);
    const diag = waitDiagnose(page);
    await page.goto("/");
    await Promise.all([check, diag]);
    // 判定の結論が出た後も、ボタンは出ない（PDF 出力は出る）
    await expect(page.getByTestId("verdict-level")).toBeVisible();
    await expect(page.getByRole("button", { name: /PDF 出力/ })).toBeVisible();
    await expect(page.getByTestId("create-plan-from-verdict")).toHaveCount(0);
    await expect(page.getByTestId("home-ops-link")).toHaveCount(0);
    await expect(page.getByRole("link", { name: /運航管理へ/ })).toHaveCount(0);
    await expect(page.getByText("この判定で飛行計画を作る")).toHaveCount(0);
    // 見出し付近の既存の説明（試験運用の一文）は変わらない
    await expect(page.getByTestId("site-ops-note")).toBeVisible();

    expect(requested.filter((p) => p.startsWith("/ops") || p.startsWith("/api/ops") || p.startsWith("/api/auth"))).toEqual([]);
    expect(failed.filter((f) => !f.includes("favicon"))).toEqual([]);
    // 地図の背景（国土地理院のタイル）を外部から取れない環境のエラーは、運航管理の追加とは関係がないので除く
    expect(consoleErrors.filter((t) => !/cyberjapandata\.gsi\.go\.jp|ERR_TUNNEL_CONNECTION_FAILED|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED/.test(t))).toEqual([]);
  });

  test("`/ops/plans` と `/api/ops/plans` は 404（画面・API とも）", async ({ page, request }) => {
    const ui = await page.goto("/ops/plans");
    expect(ui?.status()).toBe(404);
    for (const p of ["/ops/plans/new", "/ops/places", "/ops/plans/00000000-0000-4000-8000-000000000000/snapshots"]) {
      expect((await request.get(p)).status(), p).toBe(404);
    }
    const api = await request.get("/api/ops/plans");
    expect(api.status()).toBe(404);
    expect((await request.post("/api/ops/plans", { data: {} })).status()).toBe(404);
    expect((await request.get("/api/ops/places")).status()).toBe(404);
  });

  test("pnpm build の出力で `/` は静的シェル（部分的な事前描画）のまま", async () => {
    const dist = process.env["NEXT_DIST_DIR"] || ".next";
    const file = path.join(__dirname, "..", "apps", "web", dist, "prerender-manifest.json");
    let manifest: { routes: Record<string, { renderingMode?: string }> };
    try {
      manifest = JSON.parse(await readFile(file, "utf8"));
    } catch {
      test.skip(true, "build 済みの出力がない（next dev で動かしているとき）");
      return;
    }
    expect(manifest.routes["/"]?.renderingMode).toBe("PARTIALLY_STATIC");
  });
});
