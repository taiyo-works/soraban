import { connection } from "next/server";
import * as h from "@/server/ops/handlers";

type Ctx = { params: Promise<{ id: string }> };

// 飛行計画の版の履歴。
export async function GET(req: Request, { params }: Ctx) {
  await connection();
  return h.planVersions(req, await params);
}
