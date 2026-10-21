import { connection } from "next/server";
import * as h from "@/server/ops/handlers";
import { availabilityResponse, methodNotAllowed } from "@/server/ops/http";

type Ctx = { params: Promise<{ id: string }> };

// 現場の事実の行（Sprint 12c）。追記専用：一覧（GET）、1 行の追記（POST：kind・clientEventId・occurredAt・item・result・source・
// targetEventId・queued・note）。更新・削除はない（誤りは kind=undo の行で戻す）。
export async function GET(req: Request, { params }: Ctx) {
  await connection();
  return h.planFieldEventsList(req, await params);
}

export async function POST(req: Request, { params }: Ctx) {
  await connection();
  return h.planFieldEventCreate(req, await params);
}

export async function DELETE() {
  await connection();
  return availabilityResponse(process.env) ?? methodNotAllowed("GET, POST");
}
