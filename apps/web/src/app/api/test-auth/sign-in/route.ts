import { connection } from "next/server";
import { handleTestSignIn } from "@/server/ops/handlers";

// テスト用の本人確認（AUTH_PROVIDER=test のときだけ。CI・E2E・ローカル専用）。それ以外と本番では 404。
export async function POST(req: Request) {
  await connection();
  return handleTestSignIn(req);
}
