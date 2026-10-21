import { connection } from "next/server";
import * as h from "@/server/ops/handlers";
import { availabilityResponse, methodNotAllowed } from "@/server/ops/http";

type Ctx = { params: Promise<{ id: string }> };

// 通報内容（DIPS の入力順の項目の一覧・警告・指紋・対応表の版）、アダプターと能力、通報の状況（導出）、期限の状態、変更点、履歴、監査。
// GET の ?kind=new|change|cancel で整える種別を選ぶ。POST は通報の画面の入力（inputs）を重ねた整形のプレビュー（保存しない）。
export async function GET(req: Request, { params }: Ctx) {
  await connection();
  return h.planReportGet(req, await params);
}

export async function POST(req: Request, { params }: Ctx) {
  await connection();
  return h.planReportPreview(req, await params);
}

export async function DELETE() {
  await connection();
  return availabilityResponse(process.env) ?? methodNotAllowed("GET, POST");
}
