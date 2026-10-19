import { connection } from "next/server";
import * as h from "@/server/ops/handlers";
import { availabilityResponse, methodNotAllowed } from "@/server/ops/http";

type Ctx = { params: Promise<{ id: string }> };

// 詳細と訂正（PATCH：expectedVersion・reason 必須）。物理削除（DELETE）は 405。
export async function GET(req: Request, { params }: Ctx) {
  await connection();
  return h.aircraftGet(req, await params);
}

export async function PATCH(req: Request, { params }: Ctx) {
  await connection();
  return h.aircraftUpdate(req, await params);
}

export async function DELETE() {
  await connection();
  return availabilityResponse(process.env) ?? methodNotAllowed("GET, PATCH");
}
