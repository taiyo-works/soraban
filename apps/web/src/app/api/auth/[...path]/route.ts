import { connection } from "next/server";
import { handleNeonAuth } from "@/server/ops/neon-route";

type Ctx = { params: Promise<{ path: string[] }> };

// Neon Auth の中継（AUTH_PROVIDER=neon かつ OPS_ENABLED=1 のときだけ）。それ以外は 404。
// SDK は使うときに遅延生成する（無効のときは読み込まない）。
export async function GET(req: Request, ctx: Ctx) {
  await connection();
  return handleNeonAuth("GET", req, ctx);
}

export async function POST(req: Request, ctx: Ctx) {
  await connection();
  return handleNeonAuth("POST", req, ctx);
}
