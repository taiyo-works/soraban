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
// Sprint 12a：国土地理院の逆ジオコーダの模擬サーバー（e2e/mock-gsi-server.mjs。通常の E2E と同じもの）。計画の保存時にサーバーが
// 地点判定（市町村の特定）を実行するため、結果が外部サービスに左右されないよう、両方のアプリサーバーの呼び出し先をここに向ける。
// Sprint 12b：通報ゲートウェイの模擬アダプター用の 2 台目（DIPS_REPORT_ADAPTER=mock。別ポート、同じ DB）。1 台目は未設定（= 手動）。
// 模擬は同じプロセスの中の結果を返すだけで、DIPS へは何も送らない（ネットワーク呼び出しを持たない）。本番・プレビューでは設定が拒否する。
const MOCK_ADAPTER_PORT = Number(process.env.E2E_OPS_MOCK_ADAPTER_PORT ?? 3302);
const MOCK_GSI_PORT = Number(process.env.E2E_OPS_MOCK_GSI_PORT ?? 3198);
const MOCK_REVERSE_GEOCODER = `http://127.0.0.1:${MOCK_GSI_PORT}/reverse-geocoder/LonLatToAddress`;
// 既定の 5 秒だと、画面の操作の間に空いていた API 用の接続をサーバーが閉じ、次の GET が ECONNRESET（socket hang up）で落ちることがある。
const KEEP_ALIVE_MS = 120_000;
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
    // Sprint 15：運航管理の画面は Service Worker を登録する。既存の E2E は Service Worker が無い前提（page.route で応答を作る、
    // 圏外で画面の読み込みが失敗する、など）で書かれているため、既定では止める（Sprint 14 までと同じ条件）。
    // Sprint 15 の E2E（sprint15-db.spec.ts）だけが test.use({ serviceWorkers: "allow" }) で許可する。
    serviceWorkers: "block",
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
      command: `node e2e/mock-gsi-server.mjs ${MOCK_GSI_PORT}`,
      url: `http://127.0.0.1:${MOCK_GSI_PORT}/health`,
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: process.env.E2E_OPS_SERVER_CMD ?? `pnpm --filter @soraban/web exec next start -p ${PORT} -H 127.0.0.1 --keepAliveTimeout ${KEEP_ALIVE_MS}`,
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
        GSI_REVERSE_GEOCODER_ENDPOINT: MOCK_REVERSE_GEOCODER,
        NEON_AUTH_BASE_URL: "",
        NEON_AUTH_COOKIE_SECRET: "",
        DIPS_REPORT_ADAPTER: "",
        VERCEL_ENV: "",
        NEXT_DIST_DIR: "",
        // Sprint 12g：デザイン見本（/ops/design）を表示する（認証・DB を使わないことの確認用）。模擬アダプターの 2 台目は未設定（404 の確認用）。
        DESIGN_CATALOG: "1",
      },
    },
    {
      command: process.env.E2E_OPS_MOCK_ADAPTER_SERVER_CMD ?? `pnpm --filter @soraban/web exec next start -p ${MOCK_ADAPTER_PORT} -H 127.0.0.1 --keepAliveTimeout ${KEEP_ALIVE_MS}`,
      url: `http://127.0.0.1:${MOCK_ADAPTER_PORT}/api/health/db`,
      reuseExistingServer: false,
      timeout: 180_000,
      env: {
        TZ: "UTC",
        OPS_TEST_NOW: "2027-01-05T12:00:00+09:00",
        OPS_ENABLED: "1",
        AUTH_PROVIDER: "test",
        AUTH_TEST_SECRET: "e2e-only-not-a-secret",
        DATABASE_URL,
        EVIDENCE_LOG: "off",
        GSI_REVERSE_GEOCODER_ENDPOINT: MOCK_REVERSE_GEOCODER,
        NEON_AUTH_BASE_URL: "",
        NEON_AUTH_COOKIE_SECRET: "",
        DIPS_REPORT_ADAPTER: "mock",
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
      command: process.env.E2E_OPS_NEON_SERVER_CMD ?? `pnpm --filter @soraban/web exec next start -p ${NEON_PORT} --keepAliveTimeout ${KEEP_ALIVE_MS}`,
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
        GSI_REVERSE_GEOCODER_ENDPOINT: MOCK_REVERSE_GEOCODER,
        VERCEL_ENV: "",
        NEXT_DIST_DIR: "",
        DESIGN_CATALOG: "1",
      },
    },
  ],
});
