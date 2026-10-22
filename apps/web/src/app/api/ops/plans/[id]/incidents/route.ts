import { connection } from "next/server";
import * as h from "@/server/ops/handlers";

type Ctx = { params: Promise<{ id: string }> };

// この計画に結び付いた事故・ヒヤリハットの要約（件数・一覧・「記録する」の経路）。
export async function GET(req: Request, { params }: Ctx) {
  await connection();
  return h.planIncidents(req, await params);
}
