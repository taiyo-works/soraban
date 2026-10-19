// マイグレーションランナーの純粋な部分（DB に接続しない）。Sprint 8。
// ファイル名の検証・順序・チェックサム・接続先の検証・適用計画を持つ。
import { createHash } from "node:crypto";
import { describeConnection } from "./config";

/** NNNN_名前.sql（4 桁の連番、名前は英小文字・数字・_）。 */
export const MIGRATION_FILE_RE = /^(\d{4})_([a-z0-9][a-z0-9_]*)\.sql$/;

export type MigrationFile = {
  readonly version: string;
  readonly name: string;
  readonly filename: string;
  readonly sql: string;
  readonly checksum: string;
};

export type AppliedMigration = {
  readonly version: string;
  readonly name: string;
  readonly checksum: string;
};

export class MigrationError extends Error {
  override readonly name = "MigrationError";
}

/** ファイル内容の SHA-256（16 進）。改行コードも含めてそのまま計算する。 */
export const migrationChecksum = (sql: string): string =>
  createHash("sha256").update(sql, "utf8").digest("hex");

/**
 * ディレクトリ内のファイル（名前と内容）から適用対象を組み立てる。
 * - `.sql` 以外（README 等）は無視する。
 * - `.sql` で命名規則に合わないもの、番号の重複、欠番（0001 から連続していない）は MigrationError。
 */
export const parseMigrationFiles = (
  files: readonly { readonly filename: string; readonly sql: string }[],
): readonly MigrationFile[] => {
  const out: MigrationFile[] = [];
  const problems: string[] = [];
  for (const f of files) {
    if (!f.filename.endsWith(".sql")) continue;
    const m = MIGRATION_FILE_RE.exec(f.filename);
    if (!m) {
      problems.push(`命名規則（NNNN_名前.sql）に合わないファイル: ${f.filename}`);
      continue;
    }
    out.push({
      version: m[1]!,
      name: m[2]!,
      filename: f.filename,
      sql: f.sql,
      checksum: migrationChecksum(f.sql),
    });
  }
  out.sort((a, b) => a.version.localeCompare(b.version) || a.filename.localeCompare(b.filename));
  const seen = new Map<string, string>();
  for (const f of out) {
    const prev = seen.get(f.version);
    if (prev) problems.push(`番号の重複: ${prev} と ${f.filename}`);
    else seen.set(f.version, f.filename);
  }
  const versions = Array.from(seen.keys());
  versions.forEach((v, i) => {
    const expected = String(i + 1).padStart(4, "0");
    if (v !== expected && !problems.some((p) => p.startsWith("欠番"))) {
      problems.push(`欠番: ${expected} がありません（次のファイルは ${seen.get(v)}）`);
    }
  });
  if (problems.length > 0) throw new MigrationError(problems.join("\n"));
  return out;
};

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export type ConnectionTarget = {
  readonly host: string;
  readonly port: string;
  readonly database: string;
};

/**
 * 接続先を検証する（DB に接続する前に呼ぶ）。
 * - 接続文字列が無い・解釈できない → MigrationError
 * - ホスト名に `-pooler` を含む → MigrationError（プール経由ではセッション単位のロックが効かない）
 * - localhost・127.0.0.1 以外で `--target` が無い、または一致しない → MigrationError
 */
export const validateConnectionTarget = (input: {
  readonly connectionString: string | undefined;
  readonly target: string | undefined;
  /** status は DB を変更しないため `--target` を必須にしない。 */
  readonly requireTarget: boolean;
}): ConnectionTarget => {
  if (!input.connectionString) {
    throw new MigrationError(
      "DATABASE_URL_UNPOOLED が設定されていません（マイグレーションは直結の接続文字列で実行します）。",
    );
  }
  const c = describeConnection(input.connectionString);
  if (!c) throw new MigrationError("DATABASE_URL_UNPOOLED を接続文字列として解釈できません。");
  const host = c.host.toLowerCase();
  if (host.includes("-pooler")) {
    throw new MigrationError(
      `ホスト名に -pooler を含む接続文字列は使えません（${host}）。Neon の Direct connection を使ってください。`,
    );
  }
  const target = input.target?.trim().toLowerCase();
  if (target !== undefined && target.length > 0) {
    if (target !== host) {
      throw new MigrationError(`--target（${target}）と接続先のホスト名（${host}）が一致しません。中止します。`);
    }
  } else if (input.requireTarget && !LOCAL_HOSTS.has(host)) {
    throw new MigrationError(
      `localhost 以外（${host}）へ適用するときは --target <ホスト名> の指定が必要です。`,
    );
  }
  return { host, port: c.port, database: c.database };
};

export type MigrationPlan = {
  readonly pending: readonly MigrationFile[];
  readonly applied: readonly AppliedMigration[];
  readonly problems: readonly string[];
};

/** 適用記録とファイルを突き合わせる。problems が 1 件でもあれば何も適用しない。 */
export const planMigrations = (
  files: readonly MigrationFile[],
  applied: readonly AppliedMigration[],
): MigrationPlan => {
  const problems: string[] = [];
  const byVersion = new Map(files.map((f) => [f.version, f]));
  const appliedSet = new Set<string>();
  for (const a of applied) {
    appliedSet.add(a.version);
    const f = byVersion.get(a.version);
    if (!f) {
      problems.push(`適用記録にある版 ${a.version}（${a.name}）のファイルがありません。`);
      continue;
    }
    if (f.name !== a.name) {
      problems.push(`版 ${a.version} の名前が適用記録（${a.name}）とファイル（${f.name}）で異なります。`);
    }
    if (f.checksum !== a.checksum) {
      problems.push(`版 ${a.version}（${f.filename}）のチェックサムが適用時と一致しません（適用済みファイルの改変）。`);
    }
  }
  const pending = files.filter((f) => !appliedSet.has(f.version));
  const maxApplied = applied.reduce((m, a) => (a.version > m ? a.version : m), "");
  for (const p of pending) {
    if (p.version < maxApplied) {
      problems.push(`版 ${p.version} が未適用のまま、より新しい版 ${maxApplied} が適用済みです。`);
    }
  }
  return { pending, applied, problems };
};
