import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

// E2E（Sprint 6）: 地点切替 → 条件変更 → 履歴復元 → PDF 出力 の主要導線を検証する。
// ローカルは next dev、CI は build 済みの next start を E2E_SERVER_CMD で指定する。
// ブラウザは同梱 chromium。E2E_CHROME_CHANNEL=chrome でシステムの Chrome を使える。
// E2E_CHROMIUM_PATH で任意の chromium 実行ファイルを指定できる（引数は E2E_CHROMIUM_ARGS に空白区切り）。
//
// Sprint 7: 本番相当（データ差し替えなし）のサーバー（E2E_PORT, 既定 3100）に加えて、DID・工業専用地域を
// テスト用フィクスチャ（e2e/fixtures、実在の区域ではない）に差し替えたサーバー（E2E_FIXTURE_PORT, 既定 3101）を
// 起動する。フィクスチャ用サーバーのコマンドは E2E_FIXTURE_SERVER_CMD（CI は next start）。
// ローカルの next dev は .next のロックが衝突しないよう NEXT_DIST_DIR を分ける。
const PORT = Number(process.env.E2E_PORT ?? 3100);
const FIXTURE_PORT = Number(process.env.E2E_FIXTURE_PORT ?? 3101);
const FIXTURES = path.join(__dirname, "e2e", "fixtures");

export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
    acceptDownloads: true,
    ...devices["Desktop Chrome"],
    ...(process.env.E2E_CHROME_CHANNEL ? { channel: process.env.E2E_CHROME_CHANNEL } : {}),
    ...(process.env.E2E_CHROMIUM_PATH
      ? {
          launchOptions: {
            executablePath: process.env.E2E_CHROMIUM_PATH,
            args: (process.env.E2E_CHROMIUM_ARGS ?? "").split(" ").filter(Boolean),
          },
        }
      : {}),
  },
  webServer: [
    {
      command:
        process.env.E2E_SERVER_CMD ?? `pnpm --filter @soraban/web exec next dev -p ${PORT}`,
      url: `http://127.0.0.1:${PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      // 本番相当：DID_DATA_DIR・INDUSTRIAL_DATA_DIR を渡さない（同梱データだけで判定する）。
      // Sprint 8: DATABASE_URL を空にして DB なし（縮退動作）で起動する。
      env: { DID_DATA_DIR: "", INDUSTRIAL_DATA_DIR: "", DATABASE_URL: "" },
    },
    {
      command:
        process.env.E2E_FIXTURE_SERVER_CMD ??
        `pnpm --filter @soraban/web exec next dev -p ${FIXTURE_PORT}`,
      url: `http://127.0.0.1:${FIXTURE_PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      env: {
        DID_DATA_DIR: path.join(FIXTURES, "did"),
        INDUSTRIAL_DATA_DIR: path.join(FIXTURES, "industrial"),
        NEXT_DIST_DIR: ".next-e2e-fixture",
        DATABASE_URL: "",
      },
    },
  ],
});

