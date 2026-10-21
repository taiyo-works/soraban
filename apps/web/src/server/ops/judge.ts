// 計画の保存時に、サーバーが判定を実行する口（Sprint 12a 設計 A3）。
// 判定は runDiagnosis（/api/diagnose と同じ）。リクエストの値（verdict・result・snapshot・evidenceId など）は読まない。
// 実行の上限は 20 秒。時間切れ・失敗は 503（judgement_failed）で、何も保存しない。
import { runDiagnosis, type DiagnosisRun } from "@/server/diagnose-core";
import { describeError } from "./auth/identity";
import { OpsError } from "./store";
import { toDiagnosisRunInput, type JudgementInput } from "./plan-logic";

/** 判定の実行口。now は判定時刻（サーバーの時計）。 */
export type Judge = (input: JudgementInput, now: () => Date) => Promise<DiagnosisRun>;

/** 判定の実行の上限（ミリ秒）。 */
export const JUDGE_TIMEOUT_MS = 20_000;

/**
 * 本番の判定。regulation-check（"server-only"・"use cache"）は、使うときに読み込む
 * （単体テストが import できるようにするため。テストは ctx.judge を差し替える）。
 */
export const defaultJudge: Judge = async (input, now) => {
  const { runRegulationCheck } = await import("@/server/regulation-check");
  return runDiagnosis(toDiagnosisRunInput(input), runRegulationCheck, now);
};

/** 判定を上限つきで実行する。失敗・時間切れは 503 judgement_failed。 */
export const runJudge = async (
  judge: Judge | undefined,
  input: JudgementInput,
  now: () => Date,
  timeoutMs: number = JUDGE_TIMEOUT_MS,
): Promise<DiagnosisRun> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const run = (judge ?? defaultJudge)(input, now);
    // 先に失敗・時間切れになっても、後から届く結果の未処理の拒否を出さない
    run.catch(() => undefined);
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("judge timeout")), timeoutMs);
    });
    return await Promise.race([run, timeout]);
  } catch (e) {
    console.error(`[ops] judgement failed: ${describeError(e)}`);
    throw new OpsError(503, "judgement_failed");
  } finally {
    if (timer) clearTimeout(timer);
  }
};
