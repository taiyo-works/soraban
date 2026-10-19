import { REQUIRED_PROCEDURE_KIND_LABEL, type RequiredProcedure } from "@soraban/regulations";

// 種別の札の表示（表示の対応付けだけ。手続きの種別のデータとロジックは変えない）。
// 緊急用務空域の手続きはデータ上 kind=flight_permission だが、申請して許可を得るものではなく
// 「指定中は飛行できない」ことの確認なので、「飛行許可」の札を出すと許可で飛べるように読めてしまう。
const NO_FLY_CONFIRMATION_IDS: ReadonlySet<string> = new Set(["flight-permission-emergency-airspace"]);
export const isNoFlyConfirmation = (p: Pick<RequiredProcedure, "id">): boolean =>
  NO_FLY_CONFIRMATION_IDS.has(p.id);
export const procedureKindDisplayLabel = (p: Pick<RequiredProcedure, "id" | "kind">): string =>
  isNoFlyConfirmation(p) ? "飛行不可の確認" : REQUIRED_PROCEDURE_KIND_LABEL[p.kind];

/**
 * 手続きカードの右上の札の文言（表示の対応付けだけ）。
 * 緊急用務空域（emergency_no_fly）の診断では、横断手続き（機体登録・飛行計画の通報・飛行日誌）に
 * 「IIA 相当・不要化不可」を出すと、申請すれば飛べるように読めてしまうため、指定の解除後に飛行する場合の
 * 手続きであることを示す札にする。
 */
export type ProcedureBadge = "no_fly" | "separate_law" | "after_release" | "iib" | "iia";
export const procedureBadge = (
  p: Pick<RequiredProcedure, "id" | "kind" | "waivableByIIB">,
  category?: string,
): ProcedureBadge => {
  if (isNoFlyConfirmation(p)) return "no_fly";
  if (p.kind === "facility_consent_notice") return "separate_law";
  if (category === "emergency_no_fly") return "after_release";
  return p.waivableByIIB ? "iib" : "iia";
};
export const PROCEDURE_BADGE_LABEL: Readonly<Record<ProcedureBadge, string>> = {
  no_fly: "指定中は飛行不可",
  separate_law: "航空法とは別系統（飛行禁止法）",
  after_release: "指定の解除後に飛行する場合",
  iib: "IIB 相当で不要化可",
  iia: "IIA 相当・不要化不可",
};
