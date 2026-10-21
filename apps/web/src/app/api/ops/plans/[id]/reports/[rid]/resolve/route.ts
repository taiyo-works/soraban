import { connection } from "next/server";
import * as h from "@/server/ops/handlers";
import { availabilityResponse, methodNotAllowed } from "@/server/ops/http";

type Ctx = { params: Promise<{ id: string; rid: string }> };

// 結果不明の確定（POST：expectedVersion・reason・outcome=reported|not_reported。reported は manual も）。
export async function POST(req: Request, { params }: Ctx) {
  await connection();
  return h.reportResolve(req, await params);
}

export async function GET() {
  await connection();
  return availabilityResponse(process.env) ?? methodNotAllowed("POST");
}

export async function DELETE() {
  await connection();
  return availabilityResponse(process.env) ?? methodNotAllowed("POST");
}
