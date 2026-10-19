// pnpm test:db の globalSetup。REQUIRE_DB_TESTS=1 で TEST_DATABASE_URL が無ければ失敗させる。
import { resolveTestDatabaseUrl } from "./test-db-env";

export default function setup(): void {
  const url = resolveTestDatabaseUrl();
  if (!url) console.warn("[test:db] TEST_DATABASE_URL が未設定のため、DB テストをスキップします。");
}
