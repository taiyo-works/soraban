import { defineConfig, devices } from "@playwright/test";

// Sprint 10・11 の E2E-DB：DB と AUTH_PROVIDER=test・OPS_ENABLED=1 を与えた next start に対する運航管理の E2E。
// - DB は PostGIS のコンテナ（CI は db ジョブのサービスコンテナ）。マイグレーションとテスト用の初期データ
//   （pnpm db:seed:ops-test）を投入しておく。アプリは soraban_app で接続する（E2E_OPS_DATABASE_URL）。
// - Neon Auth には接続しない。AUTH_TEST_SECRET は E2E 専用の使い捨ての値。
// - 既存の E2E（playwright.config.ts、DB なし・フラグなし）とは別に実行する：pnpm test:e2e:ops
const PORT = Number(process.env.E2E_OPS_PORT ?? 3300);
// Neon Auth 方式（AUTH_PROVIDER=neon）のサーバーと、Neon Auth の上流の模擬サーバー（e2e/mock-neon-auth-server.mjs）。
// __Secure- で始まる Cookie を http で扱えるよう、neon のサーバーは localhost（ブラウザが安全な接続とみなす）で開く。
const NEON_PORT = Number(process.env.E2E_OPS_NEON_PORT ?? 3301);
const MOCK_NEON_PORT = Number(process.env.E2E_MOCK_NEON_PORT ?? 3299);
const DATABASE_URL = process.env.E2E_OPS_DATABASE_URL ?? "";
if (!DATABASE_URL) {
  throw new Error("E2E_OPS_DATABASE_URL（soraban_app で接続する DB の接続文字列）を設定してください。");
}

export default defineConfig({
  testDir: "./e2e/ops-db",
  timeout: 120_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? [["list"], ["github"], ["html", { open: "never", outputFolder: "playwright-report-ops" }]] : "list",
  outputDir: "test-results/ops",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
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
      command: process.env.E2E_OPS_SERVER_CMD ?? `pnpm --filter @soraban/web exec next start -p ${PORT} -H 127.0.0.1`,
      url: `http://127.0.0.1:${PORT}/api/health/db`,
      reuseExistingServer: false,
      timeout: 180_000,
      env: {
        // Sprint 11：サーバーの TZ に依らないことを確かめるため UTC で起動する（Vercel も UTC）。
        TZ: "UTC",
        // Sprint 11：テスト用の時計（test 方式でだけ効く）。ブラウザの時計（page.clock）を 2027-01-05 に固定して保存まで通すため、
        // 離陸が未来でないかの判定に使うサーバーの現在時刻を JST 2027-01-05 12:00 に固定する。
        OPS_TEST_NOW: "2027-01-05T12:00:00+09:00",
        OPS_ENABLED: "1",
        AUTH_PROVIDER: "test",
        AUTH_TEST_SECRET: "e2e-only-not-a-secret",
        DATABASE_URL,
        EVIDENCE_LOG: "off",
        NEON_AUTH_BASE_URL: "",
        NEON_AUTH_COOKIE_SECRET: "",
        VERCEL_ENV: "",
        NEXT_DIST_DIR: "",
      },
    },
    {
      command: `node e2e/mock-neon-auth-server.mjs ${MOCK_NEON_PORT}`,
      url: `http://127.0.0.1:${MOCK_NEON_PORT}/health`,
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: process.env.E2E_OPS_NEON_SERVER_CMD ?? `pnpm --filter @soraban/web exec next start -p ${NEON_PORT}`,
      url: `http://localhost:${NEON_PORT}/api/health/db`,
      reuseExistingServer: false,
      timeout: 180_000,
      env: {
        OPS_ENABLED: "1",
        AUTH_PROVIDER: "neon",
        NEON_AUTH_BASE_URL: `http://127.0.0.1:${MOCK_NEON_PORT}/neondb/auth`,
        NEON_AUTH_COOKIE_SECRET: "e2e-only-cookie-secret-not-a-real-one-0123456789",
        AUTH_TEST_SECRET: "",
        DATABASE_URL,
        EVIDENCE_LOG: "off",
        VERCEL_ENV: "",
        NEXT_DIST_DIR: "",
      },
    },
  ],
});
