// アプリ（/api/health/db）が「未適用の有無」を判断するための版の一覧。
// 実行時にマイグレーションの SQL ファイルを読まない（Vercel の関数に同梱しない）ために持つ。
// packages/db/migrations と一致することは src/migrations-manifest.test.ts が確かめる。
export const MIGRATION_VERSIONS = ["0001", "0002", "0003", "0004", "0005", "0006", "0007", "0008", "0009", "0010", "0011", "0012", "0013", "0014", "0015", "0016", "0017", "0018"] as const;

export const LATEST_MIGRATION_VERSION = MIGRATION_VERSIONS[MIGRATION_VERSIONS.length - 1]!;
