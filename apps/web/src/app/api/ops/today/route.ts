import { connection } from "next/server";
import * as h from "@/server/ops/handlers";
import { availabilityResponse, methodNotAllowed } from "@/server/ops/http";

// 「今日」（Sprint 12c）：今日（なければ次）の飛行のカード、今日の残りの計画、動詞で始まる「次にやること」（上位 8 件）。
// 閲覧は全役割。OPS_ENABLED が無効なら 404。
export async function GET(req: Request) {
  await connection();
  return h.todayGet(req);
}

export async function POST() {
  await connection();
  return availabilityResponse(process.env) ?? methodNotAllowed("GET");
}
