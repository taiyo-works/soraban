import { connection } from "next/server";
import * as h from "@/server/ops/handlers";

type Ctx = { params: Promise<{ id: string }> };

// 許可・承認の失効（revokedOn・expectedVersion・reason 必須。運航管理者のみ）。失効日以降は使えない。版として残す。
export async function POST(req: Request, { params }: Ctx) {
  await connection();
  return h.permitRevoke(req, await params);
}
