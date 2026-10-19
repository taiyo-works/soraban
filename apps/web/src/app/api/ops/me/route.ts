import { connection } from "next/server";
import * as h from "@/server/ops/handlers";

// 運航管理（Sprint 10）。OPS_ENABLED が無効なら 404（proxy.ts と handlers の両方で確かめる）。
export async function GET(req: Request) {
  await connection();
  return h.meGet(req);
}
