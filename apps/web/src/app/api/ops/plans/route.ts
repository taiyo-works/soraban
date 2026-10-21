import { connection } from "next/server";
import * as h from "@/server/ops/handlers";
import { availabilityResponse, methodNotAllowed } from "@/server/ops/http";

// 運航管理（Sprint 12a）：飛行計画の一覧（aircraftId・pilotId・from・to・status（導出の状態）・includeVoided=1 で絞り込み）と作成。
// 作成・判定に関わる項目の訂正では、サーバーが判定を実行して保存する（本文の判定の値は読まない）。
export async function GET(req: Request) {
  await connection();
  return h.planList(req);
}

export async function POST(req: Request) {
  await connection();
  return h.planCreate(req);
}

export async function DELETE() {
  await connection();
  return availabilityResponse(process.env) ?? methodNotAllowed("GET, POST");
}
