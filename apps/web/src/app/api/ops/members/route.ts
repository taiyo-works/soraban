import { connection } from "next/server";
import * as h from "@/server/ops/handlers";
import { availabilityResponse, methodNotAllowed } from "@/server/ops/http";

// 利用者の一覧と招待（運航管理者のみ）。
export async function GET(req: Request) {
  await connection();
  return h.memberList(req);
}

export async function POST(req: Request) {
  await connection();
  return h.memberInvite(req);
}

export async function DELETE() {
  await connection();
  return availabilityResponse(process.env) ?? methodNotAllowed("GET, POST");
}
