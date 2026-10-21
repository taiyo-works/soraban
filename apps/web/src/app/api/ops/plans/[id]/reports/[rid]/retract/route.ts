import { connection } from "next/server";
import * as h from "@/server/ops/handlers";
import { availabilityResponse, methodNotAllowed } from "@/server/ops/http";

type Ctx = { params: Promise<{ id: string; rid: string }> };

// 記録の誤りの取り下げ（POST：expectedVersion・reason 必須）。取消（種別 cancel）とは別。
export async function POST(req: Request, { params }: Ctx) {
  await connection();
  return h.reportRetract(req, await params);
}

export async function GET() {
  await connection();
  return availabilityResponse(process.env) ?? methodNotAllowed("POST");
}

export async function DELETE() {
  await connection();
  return availabilityResponse(process.env) ?? methodNotAllowed("POST");
}
