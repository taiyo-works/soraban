import { connection } from "next/server";
import * as h from "@/server/ops/handlers";

type Ctx = { params: Promise<{ id: string }> };

// 誤登録の取消（運航管理者のみ。expectedVersion・reason 必須）。行は消さず、void の版として残す。
export async function POST(req: Request, { params }: Ctx) {
  await connection();
  return h.incidentVoid(req, await params);
}
