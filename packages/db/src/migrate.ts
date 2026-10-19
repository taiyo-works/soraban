// マイグレーションランナー（Sprint 8）。`pnpm db:migrate`・`pnpm db:status` から呼ぶ。
// next build・Vercel のビルドからは呼ばない。
//
// - 接続先は DATABASE_URL_UNPOOLED（直結）。`-pooler` を含むホスト名は拒否する。
// - 同時実行は pg_advisory_lock で防ぐ（セッション単位のロックのため直結が必要）。
// - 未適用のファイルを番号順に、1 ファイル 1 トランザクションで適用する。
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import {
  MigrationError,
  parseMigrationFiles,
  planMigrations,
  validateConnectionTarget,
  type AppliedMigration,
  type MigrationFile,
} from "./migrate-core";

/** ランナーが使う接続の最小インターフェース（テストで差し替える）。 */
export type MigrationClient = {
  query: (sql: string, params?: readonly unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
  end: () => Promise<void>;
};

export type ConnectFn = (connectionString: string) => Promise<MigrationClient>;

/** pg_advisory_lock のキー（soraban のマイグレーション専用の固定値）。 */
export const MIGRATION_LOCK_KEY = 72_390_008;

/** マイグレーション用の接続タイムアウト。scale-to-zero からの起動待ちを見込んで長めにとる。 */
const MIGRATION_CONNECT_TIMEOUT_MS = 15_000;

export const DEFAULT_MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "migrations",
);

export const defaultConnect: ConnectFn = async (connectionString) => {
  const client = new pg.Client({
    connectionString,
    connectionTimeoutMillis: MIGRATION_CONNECT_TIMEOUT_MS,
    application_name: "soraban-migrate",
  });
  await client.connect();
  return {
    query: async (sql, params) => {
      const r = await client.query(sql, params ? [...params] : undefined);
      return { rows: r.rows as Record<string, unknown>[] };
    },
    end: () => client.end(),
  };
};

export const readMigrationDir = (dir: string): readonly MigrationFile[] =>
  parseMigrationFiles(
    readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .map((filename) => ({ filename, sql: readFileSync(path.join(dir, filename), "utf8") })),
  );

const CREATE_SCHEMA_MIGRATIONS = `
create table if not exists schema_migrations (
  version text primary key check (version ~ '^\\d{4}$'),
  name text not null,
  checksum text not null check (checksum ~ '^[0-9a-f]{64}$'),
  applied_at timestamptz not null default now(),
  duration_ms integer not null check (duration_ms >= 0)
)`;

const readApplied = async (client: MigrationClient): Promise<AppliedMigration[] | null> => {
  const exists = await client.query("select to_regclass('public.schema_migrations') is not null as ok");
  if (exists.rows[0]?.["ok"] !== true) return null;
  const r = await client.query("select version, name, checksum from schema_migrations order by version");
  return r.rows.map((row) => ({
    version: String(row["version"]),
    name: String(row["name"]),
    checksum: String(row["checksum"]),
  }));
};

export type RunOptions = {
  readonly command: "migrate" | "status";
  readonly connectionString: string | undefined;
  readonly target?: string;
  readonly dir?: string;
  readonly connect?: ConnectFn;
  readonly log?: (line: string) => void;
  readonly error?: (line: string) => void;
};

/** 終了コードを返す（0＝成功、1＝中止・失敗）。 */
export const runMigrationCommand = async (opts: RunOptions): Promise<number> => {
  const log = opts.log ?? ((l: string) => console.log(l));
  const error = opts.error ?? ((l: string) => console.error(l));
  const connect = opts.connect ?? defaultConnect;

  // ---- 接続前の検証（ここで止まれば DB に一切接続しない） ----
  let files: readonly MigrationFile[];
  let target;
  try {
    files = readMigrationDir(opts.dir ?? DEFAULT_MIGRATIONS_DIR);
    target = validateConnectionTarget({
      connectionString: opts.connectionString,
      target: opts.target,
      requireTarget: opts.command === "migrate",
    });
  } catch (e) {
    error(`[db:${opts.command}] 中止: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }

  log(`[db:${opts.command}] 接続先 host=${target.host} port=${target.port} database=${target.database}`);
  log(`[db:${opts.command}] マイグレーションファイル: ${files.map((f) => f.version).join(", ") || "（なし）"}`);

  let client: MigrationClient;
  try {
    client = await connect(opts.connectionString!);
  } catch (e) {
    error(`[db:${opts.command}] 接続できません: ${describeError(e)}`);
    return 1;
  }

  try {
    if (opts.command === "status") return await status(client, files, log, error);
    return await migrate(client, files, log, error);
  } finally {
    await client.end().catch(() => undefined);
  }
};

const describeError = (e: unknown): string => {
  if (e && typeof e === "object") {
    const o = e as { code?: unknown; message?: unknown };
    const code = typeof o.code === "string" ? ` (code=${o.code})` : "";
    const msg = typeof o.message === "string" ? o.message : String(e);
    return `${msg}${code}`;
  }
  return String(e);
};

const status = async (
  client: MigrationClient,
  files: readonly MigrationFile[],
  log: (l: string) => void,
  error: (l: string) => void,
): Promise<number> => {
  const applied = (await readApplied(client)) ?? [];
  const plan = planMigrations(files, applied);
  const appliedSet = new Set(applied.map((a) => a.version));
  for (const f of files) {
    log(`  ${f.version} ${f.name}  ${appliedSet.has(f.version) ? "適用済み" : "未適用"}`);
  }
  for (const a of applied) {
    if (!files.some((f) => f.version === a.version)) log(`  ${a.version} ${a.name}  適用記録のみ（ファイルなし）`);
  }
  log(`[db:status] 適用済み ${applied.length} 件、未適用 ${plan.pending.length} 件`);
  if (plan.problems.length > 0) {
    for (const p of plan.problems) error(`[db:status] 不一致: ${p}`);
    return 1;
  }
  return 0;
};

const migrate = async (
  client: MigrationClient,
  files: readonly MigrationFile[],
  log: (l: string) => void,
  error: (l: string) => void,
): Promise<number> => {
  await client.query("select pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
  try {
    await client.query(CREATE_SCHEMA_MIGRATIONS);
    const applied = (await readApplied(client)) ?? [];
    const plan = planMigrations(files, applied);
    if (plan.problems.length > 0) {
      for (const p of plan.problems) error(`[db:migrate] 中止: ${p}`);
      error("[db:migrate] 何も適用していません。");
      return 1;
    }
    if (plan.pending.length === 0) {
      log("[db:migrate] 未適用のマイグレーションはありません。");
      return 0;
    }
    log(`[db:migrate] 適用予定: ${plan.pending.map((f) => f.version).join(", ")}`);
    for (const f of plan.pending) {
      const started = Date.now();
      try {
        await client.query("begin");
        await client.query(f.sql);
        await client.query(
          "insert into schema_migrations (version, name, checksum, duration_ms) values ($1, $2, $3, $4)",
          [f.version, f.name, f.checksum, Date.now() - started],
        );
        await client.query("commit");
      } catch (e) {
        await client.query("rollback").catch(() => undefined);
        error(`[db:migrate] ${f.filename} の適用に失敗しました（記録せず、以降も適用しません）: ${describeError(e)}`);
        return 1;
      }
      log(`[db:migrate] 適用 ${f.filename}（${Date.now() - started} ms）`);
    }
    return 0;
  } finally {
    await client.query("select pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]).catch(() => undefined);
  }
};

export { MigrationError };
