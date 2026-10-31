import { connection } from "next/server";
import * as h from "@/server/ops/handlers";
import { availabilityResponse, methodNotAllowed } from "@/server/ops/http";

// 先読みの束（Sprint 15 設計 3）：今日と明日の、ログイン中の利用者が操縦者の計画（?planId= ならその計画だけ。運航管理者・計画の操縦者本人）。
// 端末の IndexedDB に利用者ごとに保存し、圏外で現場の画面を開くときに使う。許可リストの項目だけを返す（技能証明書の番号・座標・自由記述なし）。
// 他の組織の計画は 404、未ログインは 401。OPS_ENABLED が無効なら 404。
export async function GET(req: Request) {
  await connection();
  return h.fieldBundleGet(req);
}

export async function POST() {
  await connection();
  return availabilityResponse(process.env) ?? methodNotAllowed("GET");
}
