// DB テスト（pnpm test:db）用の補助。使い捨てのデータベースの作成・削除と、CLI の実行。
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const withDatabase = (url: string, database: string): string => {
  const u = new URL(url);
  u.pathname = `/${database}`;
  return u.toString();
};

export type TempDatabase = { readonly url: string; readonly name: string; drop: () => Promise<void> };

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * pg-pool の `pool.end()` は、接続を `_clients` から外した時点で解決し、ソケットの切断完了は待たない。
 * その直後の `drop database ... with (force)` は、切断中のバックエンドを 57P01（admin_shutdown）で切る。
 * プール側に error の受け手がないため、Vitest が未処理エラーとしてテストを失敗させる。
 * クライアント接続が消えてから削除する（自動バキュームだけが残るときは force で落とす。node のクライアントはもういない）。
 */
const waitUntilNoClientBackends = async (c: pg.Client, database: string): Promise<void> => {
  const deadline = Date.now() + 5_000;
  for (;;) {
    const left = await c.query<{ n: number }>(
      `select count(*)::int as n from pg_stat_activity
        where datname = $1 and pid <> pg_backend_pid() and backend_type = 'client backend'`,
      [database],
    );
    const n = left.rows[0]?.n ?? 0;
    if (n === 0) return;
    if (Date.now() >= deadline) {
      throw new Error(`使い捨てのデータベース ${database} にクライアント接続が ${n} 本残っているため削除できない`);
    }
    await sleep(50);
  }
};

export const createTempDatabase = async (adminUrl: string): Promise<TempDatabase> => {
  const name = `soraban_t_${randomBytes(6).toString("hex")}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await admin.query(`create database ${name}`);
  } finally {
    await admin.end();
  }
  return {
    url: withDatabase(adminUrl, name),
    name,
    drop: async () => {
      const c = new pg.Client({ connectionString: adminUrl });
      await c.connect();
      try {
        await waitUntilNoClientBackends(c, name);
        await c.query(`drop database if exists ${name} with (force)`);
      } finally {
        await c.end();
      }
    },
  };
};

export const withClient = async <T,>(url: string, fn: (c: pg.Client) => Promise<T>): Promise<T> => {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
};

export type CliResult = { readonly code: number; readonly stdout: string; readonly stderr: string };

/** `pnpm db:migrate`・`pnpm db:status` と同じ CLI を子プロセスで実行する。 */
export const runCli = (args: readonly string[], env: Record<string, string | undefined>): Promise<CliResult> =>
  new Promise((resolve, reject) => {
    const child = spawn(
      path.join(REPO_ROOT, "node_modules", ".bin", "tsx"),
      [path.join(REPO_ROOT, "packages", "db", "src", "cli.ts"), ...args],
      { cwd: REPO_ROOT, env: { ...process.env, ...env } },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
