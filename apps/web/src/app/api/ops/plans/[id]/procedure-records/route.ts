import { connection } from "next/server";
import * as h from "@/server/ops/handlers";
import { availabilityResponse, methodNotAllowed } from "@/server/ops/http";

type Ctx = { params: Promise<{ id: string }> };

// 手続きの「済み」の記録の一覧と、種別ごとの要約（GET）。追加（POST：kind・action・doneAt・checks・reference・reason）。
// 許可・承認の申請（dips_permit）と飛行禁止法の同意・通報（small_drone_law）。追記専用で、取り下げ（retract）も行として残る。
export async function GET(req: Request, { params }: Ctx) {
  await connection();
  return h.procedureRecordList(req, await params);
}

export async function POST(req: Request, { params }: Ctx) {
  await connection();
  return h.procedureRecordCreate(req, await params);
}

export async function DELETE() {
  await connection();
  return availabilityResponse(process.env) ?? methodNotAllowed("GET, POST");
}
