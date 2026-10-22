import { connection } from "next/server";
import * as h from "@/server/ops/handlers";

type Ctx = { params: Promise<{ id: string }> };

// 版の履歴（ハッシュの連鎖と、各版の内容）。
export async function GET(req: Request, { params }: Ctx) {
  await connection();
  return h.incidentVersions(req, await params);
}
