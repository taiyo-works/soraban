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
