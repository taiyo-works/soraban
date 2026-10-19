import { after } from "next/server";
import { dbEvidenceWriter } from "@/server/evidence-log";
import { handleCheckPost } from "@/server/handlers";
import { runRegulationCheck } from "@/server/regulation-check";

export async function POST(req: Request) {
  // 証跡は応答を返した後に evidence_log へ書く（DATABASE_URL 未設定なら書かない）。
  return handleCheckPost(req, runRegulationCheck, {
    writeEvidence: dbEvidenceWriter(),
    schedule: (task) => after(task),
  });
}
