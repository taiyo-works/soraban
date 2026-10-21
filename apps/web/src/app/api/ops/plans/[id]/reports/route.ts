import { connection } from "next/server";
import * as h from "@/server/ops/handlers";
import { availabilityResponse, methodNotAllowed } from "@/server/ops/http";

type Ctx = { params: Promise<{ id: string }> };

// 通報の記録を作る（POST：kind・baseReportId・expectedPlanVersion・manual／confirmSend・inputs）。201。
// 同じ冪等性キーなら新しい行を作らず既存の行を 200 で返す。一覧は GET …/report の reports。
export async function POST(req: Request, { params }: Ctx) {
  await connection();
  return h.reportCreate(req, await params);
}

export async function GET() {
  await connection();
  return availabilityResponse(process.env) ?? methodNotAllowed("POST");
}

export async function DELETE() {
  await connection();
  return availabilityResponse(process.env) ?? methodNotAllowed("POST");
}
