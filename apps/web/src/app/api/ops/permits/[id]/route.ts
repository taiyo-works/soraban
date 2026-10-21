import { connection } from "next/server";
import * as h from "@/server/ops/handlers";
import { availabilityResponse, methodNotAllowed } from "@/server/ops/http";

type Ctx = { params: Promise<{ id: string }> };

// 許可・承認の登録の詳細（この登録を根拠にしている計画を含む）と訂正（PATCH：expectedVersion・reason 必須。運航管理者のみ）。
// 物理削除（DELETE）は 405。
export async function GET(req: Request, { params }: Ctx) {
  await connection();
  return h.permitGet(req, await params);
}

export async function PATCH(req: Request, { params }: Ctx) {
  await connection();
  return h.permitUpdate(req, await params);
}

export async function DELETE() {
  await connection();
  return availabilityResponse(process.env) ?? methodNotAllowed("GET, PATCH");
}
