import { connection } from "next/server";
import * as h from "@/server/ops/handlers";
import { availabilityResponse, methodNotAllowed } from "@/server/ops/http";

type Ctx = { params: Promise<{ id: string }> };

// コピーの監査（POST：key か keys。項目の key だけを記録し、値は記録しない）。
export async function POST(req: Request, { params }: Ctx) {
  await connection();
  return h.reportCopyAudit(req, await params);
}

export async function GET() {
  await connection();
  return availabilityResponse(process.env) ?? methodNotAllowed("POST");
}

export async function DELETE() {
  await connection();
  return availabilityResponse(process.env) ?? methodNotAllowed("POST");
}
