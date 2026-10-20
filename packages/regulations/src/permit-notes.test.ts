// Sprint 11c 契約 8・9（単体）：空港等周辺の補足を出す条件。
import { describe, expect, it } from "vitest";
import {
  AIRPORT_MLIT_PERMIT_NOT_APPLIED_NOTE,
  shouldShowAirportMlitNote,
} from "./permit-notes";

describe("shouldShowAirportMlitNote", () => {
  const airport = (status: "red" | "yellow" | "green" | "unknown") => ({
    id: "aviation-law-airport",
    status,
  });

  it("DIPS を入力し、空港等周辺が red／yellow のときだけ出す", () => {
    expect(shouldShowAirportMlitNote(airport("red"), ["mlit"])).toBe(true);
    expect(shouldShowAirportMlitNote(airport("yellow"), ["mlit", "park_manager"])).toBe(true);
    expect(shouldShowAirportMlitNote(airport("green"), ["mlit"])).toBe(false);
    expect(shouldShowAirportMlitNote(airport("unknown"), ["mlit"])).toBe(false);
  });

  it("DIPS を入力していなければ出さない", () => {
    expect(shouldShowAirportMlitNote(airport("red"), undefined)).toBe(false);
    expect(shouldShowAirportMlitNote(airport("red"), ["facility_manager"])).toBe(false);
  });

  it("空港等周辺以外の規制には出さない", () => {
    expect(shouldShowAirportMlitNote({ id: "aviation-law-did", status: "red" }, ["mlit"])).toBe(false);
  });

  it("文言は空港ごとの個別の許可と設置管理者等との調整に触れる", () => {
    expect(AIRPORT_MLIT_PERMIT_NOT_APPLIED_NOTE).toContain(
      "空港ごとの個別の許可と、空港の設置管理者等との調整が必要",
    );
  });
});
