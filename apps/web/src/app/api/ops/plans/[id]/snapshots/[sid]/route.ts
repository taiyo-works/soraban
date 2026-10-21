import { connection } from "next/server";
import * as h from "@/server/ops/handlers";

type Ctx = { params: Promise<{ id: string; sid: string }> };

// 判定スナップショット 1 件（保存した result を含む）。
export async function GET(req: Request, { params }: Ctx) {
  await connection();
  return h.planSnapshotGet(req, await params);
}
