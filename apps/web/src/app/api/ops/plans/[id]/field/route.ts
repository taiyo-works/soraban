import { connection } from "next/server";
import * as h from "@/server/ops/handlers";
import { availabilityResponse, methodNotAllowed } from "@/server/ops/http";

type Ctx = { params: Promise<{ id: string }> };

// 現場モードの状態（Sprint 12c）：確認項目・飛行の組（離陸・着陸・日誌）・離陸した場合の未了事項の予告・通報の状況。閲覧は全役割。
export async function GET(req: Request, { params }: Ctx) {
  await connection();
  return h.planFieldGet(req, await params);
}

export async function POST() {
  await connection();
  return availabilityResponse(process.env) ?? methodNotAllowed("GET");
}
