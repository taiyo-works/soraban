import { connection } from "next/server";
import * as h from "@/server/ops/handlers";

type Ctx = { params: Promise<{ id: string }> };

// 飛行記録の版の一覧。
export async function GET(req: Request, { params }: Ctx) {
  await connection();
  return h.flightVersions(req, await params);
}
