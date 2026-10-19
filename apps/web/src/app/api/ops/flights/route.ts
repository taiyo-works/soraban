import { connection } from "next/server";
import * as h from "@/server/ops/handlers";
import { availabilityResponse, methodNotAllowed } from "@/server/ops/http";

// 運航管理（Sprint 11）：飛行記録の一覧（aircraftId・pilotId・from・to・includeVoided=1 で絞り込み）と作成。
export async function GET(req: Request) {
  await connection();
  return h.flightList(req);
}

export async function POST(req: Request) {
  await connection();
  return h.flightCreate(req);
}

export async function DELETE() {
  await connection();
  return availabilityResponse(process.env) ?? methodNotAllowed("GET, POST");
}
