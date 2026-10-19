import { connection } from "next/server";
import * as h from "@/server/ops/handlers";

type Ctx = { params: Promise<{ id: string }> };

// 日常点検記録の版の一覧。
export async function GET(req: Request, { params }: Ctx) {
  await connection();
  return h.inspectionVersions(req, await params);
}
