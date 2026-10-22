import { connection } from "next/server";
import * as h from "@/server/ops/handlers";

type Ctx = { params: Promise<{ id: string }> };

// 国への報告の記録（action = reported／consulted／retract）。利用者の申告で、そらばんが報告の完了を確認したものではない。
// そらばんは国・DIPS へ何も送信しない。
export async function POST(req: Request, { params }: Ctx) {
  await connection();
  return h.incidentReportCreate(req, await params);
}
