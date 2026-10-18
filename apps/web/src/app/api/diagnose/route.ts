import { handleDiagnosePost } from "@/server/handlers";
import { runRegulationCheck } from "@/server/regulation-check";

// 処理本体は server/handlers.ts（統合テストでデータの読み込み口を差し替えるため分離）。
export async function POST(req: Request) {
  return handleDiagnosePost(req, runRegulationCheck);
}
