import { handleDiagnosePost } from "@/server/handlers";
import { applyApplicationSupportFlag } from "@/server/diagnose-response";
import { runRegulationCheck } from "@/server/regulation-check";

// 処理本体は server/handlers.ts（統合テストでデータの読み込み口を差し替えるため分離）。
// 応答の prefill（許可・承認の申請フォームの値）は、申請支援のフラグが無効（既定・本番）なら取り除く（Sprint 18-1）。
export async function POST(req: Request) {
  return applyApplicationSupportFlag(await handleDiagnosePost(req, runRegulationCheck));
}
