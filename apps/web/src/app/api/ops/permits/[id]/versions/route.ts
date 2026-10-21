import { connection } from "next/server";
import * as h from "@/server/ops/handlers";

type Ctx = { params: Promise<{ id: string }> };

// 許可・承認の登録の版の履歴（ハッシュの連鎖と各版の内容。スナップショットの根拠から当時の内容を読める）。
export async function GET(req: Request, { params }: Ctx) {
  await connection();
  return h.permitVersions(req, await params);
}
