import { connection } from "next/server";
import * as h from "@/server/ops/handlers";

type Ctx = { params: Promise<{ id: string }> };

// よく使う地点の取消（expectedVersion・reason 必須。運航管理者のみ）。行は消さず、void の版として残す。
export async function POST(req: Request, { params }: Ctx) {
  await connection();
  return h.placeVoid(req, await params);
}
