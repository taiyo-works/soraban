import { connection } from "next/server";
import * as h from "@/server/ops/handlers";
import { availabilityResponse, methodNotAllowed } from "@/server/ops/http";

// 運航管理（Sprint 10）：一覧（?includeVoided=1 で取消済みを含める）と登録。
export async function GET(req: Request) {
  await connection();
  return h.pilotList(req);
}

export async function POST(req: Request) {
  await connection();
  return h.pilotCreate(req);
}

export async function DELETE() {
  await connection();
  return availabilityResponse(process.env) ?? methodNotAllowed("GET, POST");
}
