import { connection } from "next/server";
import * as h from "@/server/ops/handlers";

type Ctx = { params: Promise<{ id: string }> };

// よく使う地点の版の履歴。
export async function GET(req: Request, { params }: Ctx) {
  await connection();
  return h.placeVersions(req, await params);
}
