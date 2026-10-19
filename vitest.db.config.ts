import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// DB を使うテスト（Sprint 8）。`pnpm test:db` で実行する。
// - 接続先は TEST_DATABASE_URL（PostgreSQL 18 + PostGIS 3.6 のコンテナ。CI は db ジョブのサービスコンテナ）。
// - TEST_DATABASE_URL が未設定ならスキップする。REQUIRE_DB_TESTS=1 のときは globalSetup で失敗させる。
// - 各テストは使い捨てのデータベースを作って使い、終わったら消す。
const pkg = (name: string) =>
  fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@soraban/db": pkg("db"),
      "@soraban/geo": pkg("geo"),
      "@soraban/regulations": pkg("regulations"),
      "@": fileURLToPath(new URL("./apps/web/src", import.meta.url)),
    },
  },
  test: {
    include: ["packages/db/src/**/*.db.test.ts", "apps/web/src/**/*.db.test.ts"],
    globals: true,
    globalSetup: ["./packages/db/src/test-db-global-setup.ts"],
    // 使い捨てのデータベースを作るため直列に実行する。
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 180_000,
  },
});
