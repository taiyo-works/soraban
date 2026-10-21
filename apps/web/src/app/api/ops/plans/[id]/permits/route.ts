import { connection } from "next/server";
import * as h from "@/server/ops/handlers";

type Ctx = { params: Promise<{ id: string }> };

// 計画の許可・承認の照合の結果（番号ごとの状態・理由・登録の版、範囲に収まる候補）。照合は自分の DB だけで行う（外部通信なし）。
export async function GET(req: Request, { params }: Ctx) {
  await connection();
  return h.planPermits(req, await params);
}
