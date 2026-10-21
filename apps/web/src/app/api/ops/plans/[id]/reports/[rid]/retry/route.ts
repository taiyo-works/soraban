import { connection } from "next/server";
import * as h from "@/server/ops/handlers";
import { availabilityResponse, methodNotAllowed } from "@/server/ops/http";

type Ctx = { params: Promise<{ id: string; rid: string }> };

// 失敗（failed）の再送（POST：模擬のみ。同じ行・同じ冪等性キー。confirmSend が必要）。
export async function POST(req: Request, { params }: Ctx) {
  await connection();
  return h.reportRetry(req, await params);
}

export async function GET() {
  await connection();
  return availabilityResponse(process.env) ?? methodNotAllowed("POST");
}

export async function DELETE() {
  await connection();
  return availabilityResponse(process.env) ?? methodNotAllowed("POST");
}
