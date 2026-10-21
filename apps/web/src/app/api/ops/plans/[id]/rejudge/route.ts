import { connection } from "next/server";
import * as h from "@/server/ops/handlers";

type Ctx = { params: Promise<{ id: string }> };

// 判定をやり直す。新しい判定スナップショットと、現在のスナップショットを替えた計画の版ができる。
export async function POST(req: Request, { params }: Ctx) {
  await connection();
  return h.planRejudge(req, await params);
}
