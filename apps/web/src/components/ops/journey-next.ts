// ホームの「次の飛行」のカードで、行程の「次」の段に結び付く作業を選ぶ（表示側の対応づけだけ。行程の導出は server/ops/journey-logic.ts のまま）。
// 作業の文言・行き先はサーバーが作ったもの（次にやること）をそのまま使う。対応する作業がなければ、段の名前だけを出す。
import type { JourneyStageDto, JourneyStageId } from "@/server/ops/journey-logic";
import type { TodayNextAction } from "@/server/ops/today-logic";

/** 次にやること（作業 id）が、行程のどの段の作業か。段に当たらない作業（許可・承認、警察への通報、技能証明など）は載せない。 */
export const STAGE_OF_ACTION: Readonly<Record<string, JourneyStageId>> = {
  rejudge: "judge",
  request_confirmation: "plan",
  fix_returned: "plan",
  confirm: "confirm",
  report: "report",
  record_result: "report",
  change_report: "report",
  cancel_report: "report",
  consider_report: "report",
  do_inspection: "inspection",
  record_landing: "flight",
  write_journal: "journal",
  review_journal_mismatch: "journal",
};

export type JourneyNext = {
  /** 「次」の段。すべて済（または対象外）なら null。 */
  readonly stage: JourneyStageDto | null;
  /** その段の作業（この計画の、いちばん急ぐもの）。なければ null。 */
  readonly action: TodayNextAction | null;
};

/** 行程の「次」の段と、その段の作業（actions は急ぐ順）。 */
export const journeyNext = (stages: readonly JourneyStageDto[], actions: readonly TodayNextAction[], planId: string): JourneyNext => {
  const stage = stages.find((s) => s.state === "next") ?? null;
  if (!stage) return { stage: null, action: null };
  const action = actions.find((a) => a.planId === planId && STAGE_OF_ACTION[a.id] === stage.id) ?? null;
  return { stage, action };
};
