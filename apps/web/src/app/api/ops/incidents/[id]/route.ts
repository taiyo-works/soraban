import { connection } from "next/server";
import * as h from "@/server/ops/handlers";
import { availabilityResponse, methodNotAllowed } from "@/server/ops/http";

type Ctx = { params: Promise<{ id: string }> };

// 事故・ヒヤリハットの詳細（事実・目安と類型のデータの版・出典・報告の記録・報告の状態）と訂正（PATCH：expectedVersion・reason 必須）。
// 物理削除（DELETE）は 405。
export async function GET(req: Request, { params }: Ctx) {
  await connection();
  return h.incidentGet(req, await params);
}

export async function PATCH(req: Request, { params }: Ctx) {
  await connection();
  return h.incidentUpdate(req, await params);
}

export async function DELETE() {
  await connection();
  return availabilityResponse(process.env) ?? methodNotAllowed("GET, PATCH");
}
