import { connection } from "next/server";
import * as h from "@/server/ops/handlers";
import { availabilityResponse, methodNotAllowed } from "@/server/ops/http";

// 運航管理（Sprint 12d）：許可・承認の登録の一覧（?validity=・?q=・includeVoided=1 で絞り込み。全役割）と登録（運航管理者のみ）。
// 登録は利用者の申告。そらばんは許可書そのものを確認できず、DIPS にも接続しない。
export async function GET(req: Request) {
  await connection();
  return h.permitList(req);
}

export async function POST(req: Request) {
  await connection();
  return h.permitCreate(req);
}

export async function DELETE() {
  await connection();
  return availabilityResponse(process.env) ?? methodNotAllowed("GET, POST");
}
