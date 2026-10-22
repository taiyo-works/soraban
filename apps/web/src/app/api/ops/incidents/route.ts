import { connection } from "next/server";
import * as h from "@/server/ops/handlers";
import { availabilityResponse, methodNotAllowed } from "@/server/ops/http";

// 運航管理（Sprint 12e）：事故・ヒヤリハットの一覧（?kind=・?followUp=・?planId=・?reportState=・?detailPending=1・?includeVoided=1。全役割）と
// 作成（mode = full／quick。運航管理者と操縦者）。記録は事実の記録で、そらばんは国・DIPS へ何も送信しない。
export async function GET(req: Request) {
  await connection();
  return h.incidentList(req);
}

export async function POST(req: Request) {
  await connection();
  return h.incidentCreate(req);
}

export async function DELETE() {
  await connection();
  return availabilityResponse(process.env) ?? methodNotAllowed("GET, POST");
}
