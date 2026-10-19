// DB 接続確認（/api/health/db 用、Sprint 8）。
// 返す値は接続可否・遅延・版の情報に限る。接続文字列・ホスト名・ロール名・エラーの生メッセージは返さない。
import { HEALTH_CHECK_BUDGET_MS, type DbEnv } from "./config";
import { MIGRATION_VERSIONS } from "./migrations-manifest";
import { describeDbError, getPool, type DbPool } from "./pool";

export type DbHealth = {
  readonly configured: boolean;
  readonly reachable: boolean;
  readonly latencyMs: number | null;
  readonly postgresMajorVersion: number | null;
  readonly postgisVersion: string | null;
  readonly latestAppliedMigration: string | null;
  readonly hasPendingMigrations: boolean | null;
};

const EMPTY = {
  latencyMs: null,
  postgresMajorVersion: null,
  postgisVersion: null,
  latestAppliedMigration: null,
  hasPendingMigrations: null,
} as const;

class HealthTimeoutError extends Error {
  override readonly name = "HealthTimeoutError";
}

const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new HealthTimeoutError()), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(t);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });

const probe = async (pool: DbPool): Promise<Omit<DbHealth, "configured" | "reachable" | "latencyMs">> => {
  const client = await pool.connect();
  try {
    const r = await client.query<{ major: number; postgis: string | null; has_migrations: boolean }>(
      `select current_setting('server_version_num')::int / 10000 as major,
              (select extversion from pg_extension where extname = 'postgis') as postgis,
              to_regclass('public.schema_migrations') is not null as has_migrations`,
    );
    const row = r.rows[0];
    let applied: string[] = [];
    if (row?.has_migrations) {
      const m = await client.query<{ version: string }>("select version from schema_migrations order by version");
      applied = m.rows.map((x) => x.version);
    }
    const appliedSet = new Set(applied);
    return {
      postgresMajorVersion: row ? Number(row.major) : null,
      postgisVersion: row?.postgis ?? null,
      latestAppliedMigration: applied.length > 0 ? applied[applied.length - 1]! : null,
      hasPendingMigrations: MIGRATION_VERSIONS.some((v) => !appliedSet.has(v)),
    };
  } finally {
    client.release();
  }
};

export const checkDbHealth = async (
  env: DbEnv = process.env,
  budgetMs: number = HEALTH_CHECK_BUDGET_MS,
): Promise<DbHealth> => {
  const pool = getPool(env);
  if (!pool) return { configured: false, reachable: false, ...EMPTY };
  const started = performance.now();
  try {
    const info = await withTimeout(probe(pool), budgetMs);
    return {
      configured: true,
      reachable: true,
      ...info,
      latencyMs: Math.round(performance.now() - started),
    };
  } catch (e) {
    console.error(`[db] health check failed: ${describeDbError(e)}`);
    return { configured: true, reachable: false, ...EMPTY };
  }
};
