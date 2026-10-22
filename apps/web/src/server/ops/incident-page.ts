// 事故・ヒヤリハットの画面（サーバーコンポーネント）で共通に使う処理（Sprint 12e 設計 E）。
import type { IncidentFormInitial, IncidentOption } from "@/components/ops/incident-client";
import { jstDate, toJstInput } from "@/lib/ops-time";
import type { IncidentDto } from "./incidents";
import { getPlan, listPlans } from "./plans";
import { nowOf } from "./records";
import type { OpsContext } from "./service";
import { listAircraft, listPilots } from "./service";

const DAY_MS = 86_400_000;

/**
 * 入力画面の選択肢。計画は今日の 90 日前〜30 日後（新しい順）。指定の計画（?planId・訂正中の記録の計画）が範囲の外でも含める。
 * 機体は抹消を除く。操縦者は全員（操縦者は誰の飛行でも事実を記録できる）。
 */
export const incidentFormOptions = async (
  ctx: OpsContext,
  keepPlanId: string | null = null,
): Promise<{ plans: IncidentOption[]; aircraft: IncidentOption[]; pilots: IncidentOption[] }> => {
  const now = nowOf(ctx);
  const plans = await listPlans(ctx, { from: jstDate(new Date(now.getTime() - 90 * DAY_MS)), to: jstDate(new Date(now.getTime() + 30 * DAY_MS)) });
  const planOptions = plans.map((p) => ({ id: p.id, label: `${p.plannedStartAtJst}　${p.title}（${p.registrationMark}／${p.pilotName}）` }));
  if (keepPlanId && !planOptions.some((p) => p.id === keepPlanId)) {
    try {
      const p = await getPlan(ctx, keepPlanId);
      planOptions.unshift({ id: p.id, label: `${p.plannedStartAtJst}　${p.title}（${p.registrationMark}／${p.pilotName}）` });
    } catch {
      // 見つからない計画（他の組織・不正な ID）は選択肢に足さない
    }
  }
  const aircraft = (await listAircraft(ctx)).filter((a) => a.status !== "deregistered").map((a) => ({ id: a.id, label: `${a.registrationMark}（${a.modelName}）` }));
  const pilots = (await listPilots(ctx)).map((p) => ({ id: p.id, label: p.fullName }));
  return { plans: planOptions, aircraft, pilots };
};

/** 新しい記録の初期値（区分・類型・けがの有無・機体の損傷は空。起きた日時はサーバーの現在）。 */
export const newIncidentInitial = (
  ctx: OpsContext,
  q: { readonly planId?: string | null; readonly flightRecordId?: string | null; readonly summary?: string | null },
): IncidentFormInitial => ({
  kind: null,
  occurredAt: toJstInput(nowOf(ctx)),
  planId: q.planId ?? null,
  flightRecordId: q.flightRecordId ?? null,
  aircraftId: null,
  pilotId: null,
  phase: null,
  placeName: "",
  eventTypes: [],
  peopleInjury: null,
  aircraftDamage: null,
  injuredCount: null,
  contactsMade: [],
  summary: (q.summary ?? "").slice(0, 200),
  details: "",
  factorsNote: "",
  actionsTaken: "",
  preventionNote: "",
  followUpStatus: "open",
  followUpOn: null,
});

/** 訂正の初期値（保存済みの値）。 */
export const incidentInitialOf = (d: IncidentDto): IncidentFormInitial => ({
  kind: d.kind,
  occurredAt: d.occurredAt,
  planId: d.planId,
  flightRecordId: d.flightRecordId,
  aircraftId: d.aircraftId,
  pilotId: d.pilotId,
  phase: d.phase,
  placeName: d.placeName ?? "",
  eventTypes: d.eventTypes.map((t) => t.key),
  peopleInjury: d.peopleInjury,
  aircraftDamage: d.aircraftDamage,
  injuredCount: d.injuredCount,
  contactsMade: d.contactsMade.map((c) => c.key),
  summary: d.summary ?? "",
  details: d.details ?? "",
  factorsNote: d.factorsNote ?? "",
  actionsTaken: d.actionsTaken ?? "",
  preventionNote: d.preventionNote ?? "",
  followUpStatus: d.followUpStatus,
  followUpOn: d.followUpOn,
});
