import { connection } from "next/server";
import * as h from "@/server/ops/handlers";
import { availabilityResponse, methodNotAllowed } from "@/server/ops/http";

type Ctx = { params: Promise<{ id: string }> };

// 運航管理者の確認の履歴と、確認・差し戻し（POST：decision・expectedVersion（確認する計画の版）。差し戻しは reason 必須）。
export async function GET(req: Request, { params }: Ctx) {
  await connection();
  return h.planConfirmations(req, await params);
}

export async function POST(req: Request, { params }: Ctx) {
  await connection();
  return h.planConfirm(req, await params);
}

export async function DELETE() {
  await connection();
  return availabilityResponse(process.env) ?? methodNotAllowed("GET, POST");
}
