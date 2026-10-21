import { connection } from "next/server";
import * as h from "@/server/ops/handlers";

type Ctx = { params: Promise<{ id: string }> };

// 飛行計画の中止（expectedVersion・reason 必須）。行は消さず、void の版として残す。
export async function POST(req: Request, { params }: Ctx) {
  await connection();
  return h.planVoid(req, await params);
}
