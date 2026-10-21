import { connection } from "next/server";
import * as h from "@/server/ops/handlers";
import { availabilityResponse, methodNotAllowed } from "@/server/ops/http";

type Ctx = { params: Promise<{ id: string; rid: string }> };

// 手動記録の訂正（PATCH：expectedVersion・reason 必須。reportedAt・dipsNumber・numberUnavailable・memo）。物理削除（DELETE）は 405。
export async function PATCH(req: Request, { params }: Ctx) {
  await connection();
  return h.reportCorrect(req, await params);
}

export async function GET() {
  await connection();
  return availabilityResponse(process.env) ?? methodNotAllowed("PATCH");
}

export async function DELETE() {
  await connection();
  return availabilityResponse(process.env) ?? methodNotAllowed("PATCH");
}
