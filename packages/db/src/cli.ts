// `pnpm db:migrate [--target <ホスト名>] [--dir <ディレクトリ>]`
// `pnpm db:status [--dir <ディレクトリ>]`
// 接続先は環境変数 DATABASE_URL_UNPOOLED（直結）。パスワードは表示しない。
import { runMigrationCommand } from "./migrate";

const parseArgs = (argv: readonly string[]) => {
  const [command, ...rest] = argv;
  const opts: { target?: string; dir?: string } = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--") continue;
    if (a === "--target" || a === "--dir") {
      const v = rest[i + 1];
      if (v === undefined || v.startsWith("--")) throw new Error(`${a} に値がありません`);
      if (a === "--target") opts.target = v;
      else opts.dir = v;
      i++;
      continue;
    }
    throw new Error(`不明な引数: ${a}`);
  }
  if (command !== "migrate" && command !== "status") {
    throw new Error("使い方: cli.ts migrate|status [--target <ホスト名>] [--dir <ディレクトリ>]");
  }
  return { command, ...opts } as const;
};

const main = async () => {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
    return;
  }
  process.exitCode = await runMigrationCommand({
    command: args.command,
    connectionString: process.env["DATABASE_URL_UNPOOLED"],
    ...(args.target !== undefined ? { target: args.target } : {}),
    ...(args.dir !== undefined ? { dir: args.dir } : {}),
  });
};

void main();
