import { REQUIRED_PROCEDURE_KIND_LABEL, type RequiredProcedure } from "@soraban/regulations";

// 種別の札の表示（表示の対応付けだけ。手続きの種別のデータとロジックは変えない）。
// 緊急用務空域の手続きはデータ上 kind=flight_permission だが、申請して許可を得るものではなく
// 「指定中は飛行できない」ことの確認なので、「飛行許可」の札を出すと許可で飛べるように読めてしまう。
const NO_FLY_CONFIRMATION_IDS: ReadonlySet<string> = new Set(["flight-permission-emergency-airspace"]);
export const isNoFlyConfirmation = (p: Pick<RequiredProcedure, "id">): boolean =>
  NO_FLY_CONFIRMATION_IDS.has(p.id);
export const procedureKindDisplayLabel = (p: Pick<RequiredProcedure, "id" | "kind">): string =>
  isNoFlyConfirmation(p) ? "飛行不可の確認" : REQUIRED_PROCEDURE_KIND_LABEL[p.kind];
