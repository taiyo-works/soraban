// アプリ用のプール（Sprint 8）。DATABASE_URL（Neon のプール経由）から遅延生成する。
//
// - サーバー側の statement_timeout は起動パラメータで送らない。Neon のプール（PgBouncer）は
//   未対応の起動パラメータを拒否するため。代わりにクライアント側の query_timeout で打ち切る。
// - Vercel の関数（Fluid compute）では @vercel/functions の attachDatabasePool で、待機接続の
//   破棄まで関数を生かす（Vercel 以外では何もしない）。採否の理由は packages/db/README.md。
import { attachDatabasePool } from "@vercel/functions";
import pg from "pg";
import { appDatabaseUrl, DB_POOL_DEFAULTS, type DbEnv } from "./config";

export type DbPool = pg.Pool;

let cached: { readonly url: string; readonly pool: pg.Pool } | null = null;

/** 接続エラーをログ用の 1 行にする（接続文字列・ホスト名・生メッセージを含めない）。 */
export const describeDbError = (e: unknown): string => {
  if (e && typeof e === "object") {
    const o = e as { name?: unknown; code?: unknown };
    const name = typeof o.name === "string" ? o.name : "Error";
    const code = typeof o.code === "string" ? o.code : "-";
    return `${name} code=${code}`;
  }
  return "UnknownError code=-";
};

export const createPool = (connectionString: string): pg.Pool => {
  const pool = new pg.Pool({
    connectionString,
    max: DB_POOL_DEFAULTS.max,
    idleTimeoutMillis: DB_POOL_DEFAULTS.idleTimeoutMillis,
    connectionTimeoutMillis: DB_POOL_DEFAULTS.connectionTimeoutMillis,
    query_timeout: DB_POOL_DEFAULTS.statementTimeoutMillis,
    application_name: "soraban-web",
  });
  // 待機中の接続の切断（Neon の停止など）でプロセスを落とさない。
  pool.on("error", (e) => {
    console.error(`[db] idle client error: ${describeDbError(e)}`);
  });
  attachDatabasePool(pool);
  return pool;
};

/** DATABASE_URL からプールを返す。未設定なら null（接続を試みない）。 */
export const getPool = (env: DbEnv = process.env): pg.Pool | null => {
  const url = appDatabaseUrl(env);
  if (url === undefined) return null;
  if (cached && cached.url === url) return cached.pool;
  if (cached) void cached.pool.end().catch(() => undefined);
  cached = { url, pool: createPool(url) };
  return cached.pool;
};

/** テスト・終了処理用。キャッシュしたプールを閉じる。 */
export const closePool = async (): Promise<void> => {
  const c = cached;
  cached = null;
  if (c) await c.pool.end();
};
