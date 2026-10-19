import { parse as parseConnectionString } from "pg-connection-string";

// 接続設定（Sprint 8）。値はここ 1 か所にまとめる。
//
// Neon は scale-to-zero のため、停止中の計算資源への初回接続は起動待ち（数百 ms〜数秒）が入る。
// 接続タイムアウト・文のタイムアウトはその起動待ちを見込んだ 5 秒とし、それを超える場合は
// 「不達」として扱う（地点判定は DB なしで返す）。

export const DB_POOL_DEFAULTS = {
  /** 接続確立のタイムアウト（ミリ秒）。scale-to-zero からの起動待ちを見込む。 */
  connectionTimeoutMillis: 5_000,
  /** 1 文あたりのタイムアウト（ミリ秒）。サーバー側 statement_timeout とクライアント側 query_timeout の両方に使う。 */
  statementTimeoutMillis: 5_000,
  /** プールの最大接続数。Vercel の関数 1 インスタンスあたり。Neon のプール（PgBouncer）経由で使う。 */
  max: 3,
  /** 待機中の接続を破棄するまでの時間（ミリ秒）。短くして関数の延長稼働と計算資源の起動維持を抑える。 */
  idleTimeoutMillis: 5_000,
} as const;

/** /api/health/db の全体の上限（ミリ秒）。契約は 6 秒以内に応答。 */
export const HEALTH_CHECK_BUDGET_MS = 5_500;

export type DbEnv = Readonly<Record<string, string | undefined>>;

const nonEmpty = (v: string | undefined): string | undefined =>
  typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;

/** アプリ用（プール経由）の接続文字列。未設定なら undefined。 */
export const appDatabaseUrl = (env: DbEnv = process.env): string | undefined =>
  nonEmpty(env["DATABASE_URL"]);

/** DATABASE_URL が設定されているか。未設定なら DB に接続を試みない。 */
export const isDbConfigured = (env: DbEnv = process.env): boolean =>
  appDatabaseUrl(env) !== undefined;

/** EVIDENCE_LOG=off のとき証跡を書かない（従量課金・障害時の切り離し用）。 */
export const isEvidenceLogEnabled = (env: DbEnv = process.env): boolean =>
  (nonEmpty(env["EVIDENCE_LOG"]) ?? "").toLowerCase() !== "off";

/**
 * 接続文字列の実際の接続先（ホスト名・ポート・データベース名。パスワードは返さない）。
 * pg と同じ pg-connection-string で解析するため、`?host=` 等で上書きされた接続先も正しく返す。
 * 解釈できなければ null。
 */
export const describeConnection = (
  connectionString: string,
): { readonly host: string; readonly port: string; readonly database: string } | null => {
  if (!/^postgres(ql)?:\/\//i.test(connectionString.trim())) return null;
  try {
    const c = parseConnectionString(connectionString);
    return {
      host: c.host ?? "",
      port: c.port || "5432",
      database: c.database || "postgres",
    };
  } catch {
    return null;
  }
};
