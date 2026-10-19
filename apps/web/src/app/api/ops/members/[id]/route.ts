import { connection } from "next/server";
import * as h from "@/server/ops/handlers";
import { availabilityResponse, methodNotAllowed } from "@/server/ops/http";

type Ctx = { params: Promise<{ id: string }> };

// 利用者の詳細と、役割の変更・停止・再開（PATCH：expectedVersion・reason 必須。運航管理者のみ）。
export async function GET(req: Request, { params }: Ctx) {
  await connection();
  return h.memberGet(req, await params);
}

export async function PATCH(req: Request, { params }: Ctx) {
  await connection();
  return h.memberUpdate(req, await params);
}

export async function DELETE() {
  await connection();
  return availabilityResponse(process.env) ?? methodNotAllowed("GET, PATCH");
}
