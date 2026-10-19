import { connection } from "next/server";
import * as h from "@/server/ops/handlers";

type Ctx = { params: Promise<{ id: string }> };

// 版の一覧（版番号・操作・訂正者・日時・理由・変わった項目名）。
export async function GET(req: Request, { params }: Ctx) {
  await connection();
  return h.aircraftVersions(req, await params);
}
