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
// Sprint 9：国土地理院の逆ジオコーダの模擬サーバー（e2e/mock-gsi-server.mjs）。外部サービスの応答で E2E が揺れないよう、
// 両方のアプリサーバーの逆ジオコーダの呼び出し先をここに向ける。外部との疎通は scripts/smoke-external.mjs（CI では失敗しても止めない）。
const MOCK_GSI_PORT = Number(process.env.E2E_MOCK_GSI_PORT ?? 3199);
const MOCK_REVERSE_GEOCODER = `http://127.0.0.1:${MOCK_GSI_PORT}/reverse-geocoder/LonLatToAddress`;

export default defineConfig({
  testDir: "./e2e",
  // Sprint 10：DB と利用者機能を有効にしたサーバーで動かす E2E（e2e/ops-db）は playwright.ops.config.ts で実行する。
  testIgnore: ["**/ops-db/**"],
  timeout: 120_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  // CI の github レポーターは失敗を check-run の annotations に出す（ログ本文を読めない環境でも原因が分かる）
  reporter: process.env.CI ? [["list"], ["github"], ["html", { open: "never" }]] : "list",
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
      command: `node e2e/mock-gsi-server.mjs ${MOCK_GSI_PORT}`,
      url: `http://127.0.0.1:${MOCK_GSI_PORT}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command:
        process.env.E2E_SERVER_CMD ?? `pnpm --filter @soraban/web exec next dev -p ${PORT}`,
      url: `http://127.0.0.1:${PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      // 本番相当：DID_DATA_DIR・INDUSTRIAL_DATA_DIR を渡さない（同梱データだけで判定する）。
      // Sprint 8: DATABASE_URL を空にして DB なし（縮退動作）で起動する。
      env: {
        DID_DATA_DIR: "",
        INDUSTRIAL_DATA_DIR: "",
        DATABASE_URL: "",
        GSI_REVERSE_GEOCODER_ENDPOINT: MOCK_REVERSE_GEOCODER,
        // Sprint 18-1：申請支援は無効（既定・本番と同じ）。環境の持ち越しで揺れないよう明記する。
        // 公開の `/` の値はビルドのときに固まる（lib/boundary.ts）ので、ここは /api/diagnose など実行時に読む側のため。
        APPLICATION_SUPPORT_ENABLED: "",
      },
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
        // Sprint 9：住所検索の索引を架空のフィクスチャに差し替え、国土地理院の住所検索は接続できない宛先にする
        // （同梱索引の結果だけで画面の表示を確かめる）。
        ADDRESS_DATA_DIR: path.join(FIXTURES, "address"),
        GSI_ADDRESS_SEARCH_ENDPOINT: "http://127.0.0.1:9/address-search",
        GSI_REVERSE_GEOCODER_ENDPOINT: MOCK_REVERSE_GEOCODER,
        NEXT_DIST_DIR: ".next-e2e-fixture",
        DATABASE_URL: "",
        // Sprint 12g：デザイン見本（/ops/design）を表示するのはこの 2 台目だけ（1 台目は無効＝404 の確認用）。静的なページで、他の設定に依らない。
        DESIGN_CATALOG: "1",
        // Sprint 18-1：申請支援は無効（上と同じ）。
        APPLICATION_SUPPORT_ENABLED: "",
      },
    },
  ],
});

