// 飛行計画・よく使う地点の画面（サーバーコンポーネント）で共通に使う処理（Sprint 12a 設計 F）。
import type { PilotOption } from "@/components/ops/records-client";
import type { PlanAircraftOption, PlacePick } from "@/components/ops/plans-client";
import { EMPTY_PLAN_VALUES, type PlanFormValues, type PlanHandoff } from "@/lib/plan-options";
import { can } from "./authz";
import { listPlaces } from "./places";
import type { PlanDto } from "./plans";
import { listAircraft, listPilots, type MeDto, type OpsContext } from "./service";

/** 計画を作れない理由（作れるなら null）。閲覧者、操縦者の行に結び付いていない操縦者役割は作れない。 */
export const planCreateDenied = (me: MeDto): string | null => {
  if (me.member.role === "viewer") return "閲覧者は飛行計画を作れません。";
  if (me.member.role === "pilot" && !me.pilotId) {
    return "あなたの利用者に操縦者の情報が結び付いていないため、飛行計画を作れません。運航管理者に結び付けを依頼してください。";
  }
  return null;
};

/** 計画を訂正・確認依頼・再判定・中止できるか（運航管理者は全員分、操縦者は自分が操縦者の計画だけ）。 */
export const canUpdatePlan = (me: MeDto, isSelf: boolean): boolean => can(me.member.role, "plan.update", { isSelf });

/** フォームの選択肢。抹消の機体は出さない。操縦者役割は自分に結び付いた操縦者に固定する。 */
export const planFormOptions = async (
  ctx: OpsContext,
  me: MeDto,
): Promise<{
  aircraft: PlanAircraftOption[];
  pilots: PilotOption[];
  fixedPilotId: string | null;
  places: PlacePick[];
}> => {
  const aircraft = (await listAircraft(ctx))
    .filter((a) => a.status !== "deregistered")
    .map((a) => ({
      id: a.id,
      registrationMark: a.registrationMark,
      modelName: a.modelName,
      status: a.status,
      maxTakeoffWeightKg: a.maxTakeoffWeightKg,
    }));
  const fixedPilotId = me.member.role === "pilot" ? me.pilotId : null;
  const pilots = (await listPilots(ctx))
    .filter((p) => fixedPilotId === null || p.id === fixedPilotId)
    .map((p) => ({ id: p.id, fullName: p.fullName, licenseExpiresOn: p.licenseExpiresOn }));
  const places = (await listPlaces(ctx)).map((p) => ({ id: p.id, name: p.name, latitude: p.latitude, longitude: p.longitude }));
  return { aircraft, pilots, fixedPilotId, places };
};

/** 判定画面からの引き継ぎで、新規フォームの初期値を作る（機体は引き継がない）。 */
export const initialFromHandoff = (h: PlanHandoff): PlanFormValues => ({
  ...EMPTY_PLAN_VALUES,
  ...(h.lat ? { lat: h.lat } : {}),
  ...(h.lng ? { lng: h.lng } : {}),
  ...(h.plannedDate ? { startDate: h.plannedDate } : {}),
  flags: h.flags,
  permits: h.permits,
  judgementPurpose: h.purpose,
  access: h.access,
  observer: h.observer,
});

/** 既存の計画から、訂正フォームの初期値を作る。 */
export const initialFromPlan = (p: PlanDto): PlanFormValues => ({
  title: p.title,
  aircraftId: p.aircraftId,
  pilotId: p.pilotId,
  startDate: p.plannedStartAt.slice(0, 10),
  startTime: p.plannedStartAt.slice(11, 16),
  duration: String(p.durationMinutes),
  purpose: p.purpose,
  savedPlaceId: p.savedPlaceId ?? "",
  placeName: p.placeName,
  lat: String(p.latitude),
  lng: String(p.longitude),
  radius: p.radiusM === null ? "" : String(p.radiusM),
  altitude: p.maxAltitudeM === null ? "" : String(p.maxAltitudeM),
  flags: p.flags,
  permits: p.pilotPermits,
  judgementPurpose: p.judgementPurpose ?? "",
  access: p.thirdPartyOverflight === true ? "no_third_party" : p.accessControl === true ? "yes" : "",
  observer: p.bvlosWithObserver === null ? "" : p.bvlosWithObserver ? "with" : "without",
  permitNumbers: p.permitNumbers ?? "",
  notes: p.notes ?? "",
});
