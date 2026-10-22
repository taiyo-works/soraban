import { connection } from "next/server";
import * as h from "@/server/ops/handlers";

type Ctx = { params: Promise<{ id: string }> };

// この日誌（飛行記録）に結び付いた事故・ヒヤリハットの要約と、「安全に影響のあった事項」から記録を始める経路（自動では作らない）。
export async function GET(req: Request, { params }: Ctx) {
  await connection();
  return h.flightIncidents(req, await params);
}
