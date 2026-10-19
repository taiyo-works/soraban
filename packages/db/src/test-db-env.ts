// DB を使うテスト（pnpm test:db）の接続先の解決。
// TEST_DATABASE_URL が未設定ならスキップするが、REQUIRE_DB_TESTS=1 のときは失敗させる
// （CI で黙ってスキップされて緑になるのを防ぐ）。
export const resolveTestDatabaseUrl = (
  env: Readonly<Record<string, string | undefined>> = process.env,
): string | undefined => {
  const url = env["TEST_DATABASE_URL"]?.trim();
  if (url) return url;
  if (env["REQUIRE_DB_TESTS"] === "1") {
    throw new Error("REQUIRE_DB_TESTS=1 ですが TEST_DATABASE_URL が設定されていません（DB テストをスキップできません）。");
  }
  return undefined;
};
