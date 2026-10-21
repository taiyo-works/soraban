import { connection } from "next/server";
import * as h from "@/server/ops/handlers";
import { availabilityResponse, methodNotAllowed } from "@/server/ops/http";

// 運航管理（Sprint 12a）：よく使う地点の一覧（includeVoided=1 で取消済みも）と登録（運航管理者のみ）。
export async function GET(req: Request) {
  await connection();
  return h.placeList(req);
}

export async function POST(req: Request) {
  await connection();
  return h.placeCreate(req);
}

export async function DELETE() {
  await connection();
  return availabilityResponse(process.env) ?? methodNotAllowed("GET, POST");
}
