// 行程の 1 行（判定→計画→確認→通報→点検→飛行→日誌）の導出（Sprint 12g-1b 設計 A8）。純粋関数。DB・時計・ネットワークに触れない。
//   保存しない。計画・確認・通報・現場の記録の有無から毎回導出する（記録を足すだけで行程が進む）。
//   段の状態：済（その段が終わっている）／次（終わっていない最初の段）／未（それより先）／対象外（通報の対象外のとき）。
//
// 守ること：
//   - 通報を免除するように読める言葉は作らない（C8）。通報の対象外は、既存の状況の語（模型航空機は「対象外」）だけを使う。
//   - 通報が済になるのは、通報の記録があるとき（status.code === "reported"）だけ。記録が無ければ、要でも推奨でも済にしない。
//   - 点検は当日の計画だけ数える（日常点検は飛行当日の記録。先の日の計画では、まだ「未」）。
import type { ReportStatusCode } from "@soraban/dips";
import type { PlanState } from "./plan-logic";

export const JOURNEY_STAGES = ["judge", "plan", "confirm", "report", "inspection", "flight", "journal"] as const;
export type JourneyStageId = (typeof JOURNEY_STAGES)[number];

export const JOURNEY_STAGE_LABEL: Readonly<Record<JourneyStageId, string>> = {
  judge: "判定",
  plan: "計画",
  confirm: "確認",
  report: "通報",
  inspection: "点検",
  flight: "飛行",
  journal: "日誌",
};

export type JourneyState = "done" | "next" | "todo" | "skip";

export const JOURNEY_STATE_LABEL: Readonly<Record<JourneyState, string>> = { done: "済", next: "次", todo: "未", skip: "対象外" };

export type JourneyStageDto = {
  readonly id: JourneyStageId;
  readonly label: string;
  readonly state: JourneyState;
  readonly stateLabel: string;
};

export type JourneyInput = {
  /** 現在の判定スナップショットがある。 */
  readonly hasSnapshot: boolean;
  /** 判定が古い（機体の重量の変更・エンジンの版・データの確認日・手続きデータの版）。 */
  readonly judgementStale: boolean;
  /** 計画の状態（導出）。 */
  readonly planState: PlanState;
  /** 通報の状況の符号（導出）。 */
  readonly reportStatus: ReportStatusCode;
  /** 計画の機体の、飛行当日の飛行前の日常点検がある（当日の計画だけ真になりうる）。 */
  readonly inspectionDone: boolean;
  /** 着陸まで記録した飛行がある。 */
  readonly hasLandedFlight: boolean;
  /** 飛行中の離陸がある（着陸の記録がまだ）。 */
  readonly inFlight: boolean;
  /** 着陸済みで日誌待ちの飛行がある。 */
  readonly journalPending: boolean;
  /** 計画に結び付いた、取消していない飛行記録がある（手で入力した日誌を含む）。 */
  readonly hasFlightRecord: boolean;
};

/** 各段が終わっているか。 */
export const journeyDone = (i: JourneyInput): Readonly<Record<JourneyStageId, boolean>> => {
  const flown = (i.hasLandedFlight && !i.inFlight) || i.hasFlightRecord;
  return {
    judge: i.hasSnapshot && !i.judgementStale,
    plan: i.planState !== "draft",
    confirm: i.planState === "approved",
    report: i.reportStatus === "reported",
    inspection: i.inspectionDone,
    flight: flown,
    journal: flown && !i.journalPending,
  };
};

/** 行程の 7 段。終わっていない最初の段が「次」。通報の対象外（模型航空機）は「対象外」で、「次」にならない。 */
export const journeyStages = (i: JourneyInput): JourneyStageDto[] => {
  const done = journeyDone(i);
  let nextTaken = false;
  return JOURNEY_STAGES.map((id): JourneyStageDto => {
    let state: JourneyState;
    if (done[id]) state = "done";
    else if (id === "report" && i.reportStatus === "not_applicable_model") state = "skip";
    else if (!nextTaken) {
      nextTaken = true;
      state = "next";
    } else state = "todo";
    return { id, label: JOURNEY_STAGE_LABEL[id], state, stateLabel: JOURNEY_STATE_LABEL[state] };
  });
};
