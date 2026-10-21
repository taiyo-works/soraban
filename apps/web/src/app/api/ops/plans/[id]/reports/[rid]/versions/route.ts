import { connection } from "next/server";
import * as h from "@/server/ops/handlers";
import { availabilityResponse, methodNotAllowed } from "@/server/ops/http";

type Ctx = { params: Promise<{ id: string; rid: string }> };

// 通報の記録の版の履歴（訂正・取り下げ・確定の理由と、変わった項目）。
export async function GET(req: Request, { params }: Ctx) {
  await connection();
  return h.reportVersions(req, await params);
}

export async function DELETE() {
  await connection();
  return availabilityResponse(process.env) ?? methodNotAllowed("GET");
}
