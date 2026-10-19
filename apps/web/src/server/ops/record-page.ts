// 飛行記録・日常点検記録の画面（サーバーコンポーネント）で共通に使う処理（Sprint 11）。
import type { AircraftOption, PilotOption } from "@/components/ops/records-client";
import type { MeDto, OpsContext } from "./service";
import { listAircraft, listPilots } from "./service";

/** 記録を入力できない理由（できるなら null）。閲覧者、操縦者の行に結び付いていない操縦者役割は入力できない。 */
export const recordCreateDenied = (me: MeDto): string | null => {
  if (me.member.role === "viewer") return "閲覧者は記録を入力できません。";
  if (me.member.role === "pilot" && !me.pilotId) {
    return "あなたの利用者に操縦者の情報が結び付いていないため、記録を入力できません。運航管理者に結び付けを依頼してください。";
  }
  return null;
};

/** 入力画面の選択肢。抹消の機体は出さない。操縦者役割は自分に結び付いた操縦者に固定する。 */
export const recordFormOptions = async (
  ctx: OpsContext,
  me: MeDto,
): Promise<{ aircraft: AircraftOption[]; pilots: PilotOption[]; fixedPilotId: string | null }> => {
  const aircraft = (await listAircraft(ctx))
    .filter((a) => a.status !== "deregistered")
    .map((a) => ({ id: a.id, registrationMark: a.registrationMark, modelName: a.modelName, status: a.status }));
  const fixedPilotId = me.member.role === "pilot" ? me.pilotId : null;
  const pilots = (await listPilots(ctx))
    .filter((p) => fixedPilotId === null || p.id === fixedPilotId)
    .map((p) => ({ id: p.id, fullName: p.fullName, licenseExpiresOn: p.licenseExpiresOn }));
  return { aircraft, pilots, fixedPilotId };
};

/** 記録を訂正できるか（運航管理者、または記録の操縦者・実施者が自分）。 */
export const canCorrectRecord = (me: MeDto, isSelf: boolean): boolean =>
  me.member.role === "manager" || (me.member.role === "pilot" && isSelf);
