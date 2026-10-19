import { describe, expect, it } from "vitest";
import { ALL_PROCEDURES } from "@soraban/regulations";
import { PROCEDURE_BADGE_LABEL, procedureBadge } from "./procedure-display";

// Sprint 11a 仕上げ：緊急用務空域の診断では、横断手続きに「IIA 相当・不要化不可」を出さない。
const p = (id: string) => ALL_PROCEDURES.find((x) => x.id === id)!;

describe("procedureBadge", () => {
  it("emergency_no_fly では横断手続き・他の許可が「指定の解除後に飛行する場合」になる", () => {
    for (const id of ["flight-plan-report", "flight-logbook", "drone-registration", "flight-permission-did"]) {
      expect(PROCEDURE_BADGE_LABEL[procedureBadge(p(id), "emergency_no_fly")]).toBe("指定の解除後に飛行する場合");
    }
    expect(procedureBadge(p("flight-permission-emergency-airspace"), "emergency_no_fly")).toBe("no_fly");
  });
  it("ほかのカテゴリーでは従来どおり", () => {
    expect(procedureBadge(p("flight-plan-report"), "II_A")).toBe("iia");
    expect(procedureBadge(p("flight-permission-did"), "II_B_eligible")).toBe("iib");
    expect(procedureBadge(p("small-drone-law-consent-notice"), "emergency_no_fly")).toBe("separate_law");
  });
});
