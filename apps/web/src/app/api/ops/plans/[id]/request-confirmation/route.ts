import { connection } from "next/server";
import * as h from "@/server/ops/handlers";

type Ctx = { params: Promise<{ id: string }> };

// 確認を依頼する（下書き → 依頼済み）。計画の訂正の版として残る。
export async function POST(req: Request, { params }: Ctx) {
  await connection();
  return h.planRequestConfirmation(req, await params);
}
