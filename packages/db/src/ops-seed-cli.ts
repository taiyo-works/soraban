// `pnpm db:seed:ops-test`：運航管理のテスト用の初期データを投入する（localhost・127.0.0.1 だけ）。
// 接続先は DATABASE_URL_UNPOOLED（オーナーロール）。src/ops-seed.ts を参照。
import pg from "pg";
import { assertLocalTarget, seedOpsTestData } from "./ops-seed";

const main = async () => {
  let url: string;
  try {
    url = assertLocalTarget(process.env["DATABASE_URL_UNPOOLED"]);
  } catch (e) {
    console.error(`[db:seed:ops-test] ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
    return;
  }
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    await c.query("begin");
    const r = await seedOpsTestData(c);
    await c.query("commit");
    console.log(r.created ? "[db:seed:ops-test] テスト用の初期データを投入しました" : "[db:seed:ops-test] 既に投入済みのため何もしません");
  } catch (e) {
    await c.query("rollback").catch(() => undefined);
    const o = (e ?? {}) as { name?: string; code?: string };
    console.error(`[db:seed:ops-test] 失敗: ${o.name ?? "Error"} code=${o.code ?? "-"}`);
    process.exitCode = 1;
  } finally {
    await c.end();
  }
};

void main();
