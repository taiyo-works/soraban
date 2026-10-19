import { connection } from "next/server";
import * as h from "@/server/ops/handlers";

type Ctx = { params: Promise<{ id: string }> };

// 取消（expectedVersion・reason 必須）。行は消さず、void の版として残す。
export async function POST(req: Request, { params }: Ctx) {
  await connection();
  return h.aircraftVoid(req, await params);
}
