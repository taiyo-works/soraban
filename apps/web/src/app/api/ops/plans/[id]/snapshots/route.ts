import { connection } from "next/server";
import * as h from "@/server/ops/handlers";

type Ctx = { params: Promise<{ id: string }> };

// 判定スナップショットの一覧（result を除く）。追記専用のため、作成・訂正の API はない（計画の保存・再判定で作られる）。
export async function GET(req: Request, { params }: Ctx) {
  await connection();
  return h.planSnapshots(req, await params);
}
