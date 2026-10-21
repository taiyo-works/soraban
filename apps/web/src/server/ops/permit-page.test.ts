import { describe, expect, it } from "vitest";
import { permitAirportReferenceNote, permitAppliedNote, summarizePermitMatch, type PermitMatchResult } from "./permit-logic";
import { verdictPermitNotes, verdictPermitNotesFromBasis } from "./permit-page";

// 判定の項目への「表示だけの置き換え」（Sprint 12d 設計 G）。判定の結論・段は変えず、文だけを差し替える。
const match = (numbers: PermitMatchResult["numbers"]): PermitMatchResult => ({ window: null, numbers, grantedValues: [], basis: [], candidates: [] });
const reg = (permitNumber: string) => ({ permitNumber, aircraftScope: { type: "listed", ids: [] }, pilotScope: { type: "listed", ids: [] } }) as never;

describe("verdictPermitNotes", () => {
  it("適用した登録の種類に対応する項目だけ、登録の文に置き換える（夜間→method_night、DID→aviation-law-did）", () => {
    const s = summarizePermitMatch(
      match([
        { numberText: "N-1", status: "applied", reasons: [], registration: reg("N-1"), relevantKinds: ["did", "night"], effectiveLastDate: "2027-09-30" },
      ] as never),
    );
    const n = verdictPermitNotes(s);
    expect(n.applied["method_night"]).toBe(permitAppliedNote("N-1"));
    expect(n.applied["aviation-law-did"]).toBe(permitAppliedNote("N-1"));
    expect(n.applied["method_bvlos"]).toBeUndefined();
    expect(n.item).toEqual({});
    expect(n.applied["method_night"]).toContain("許可書で確認してください");
    expect(n.applied["method_night"]).not.toContain("照合していません");
  });

  it("空港等周辺の参考（reference）は項目に添える文だけ。判定の段を変える置き換えは作らない", () => {
    const s = summarizePermitMatch(
      match([{ numberText: "A-1", status: "reference", reasons: [], registration: reg("A-1"), relevantKinds: ["airport"], effectiveLastDate: "2027-06-30" }] as never),
    );
    const n = verdictPermitNotes(s);
    expect(n.applied).toEqual({});
    expect(n.item["aviation-law-airport"]).toBe(permitAirportReferenceNote("A-1"));
    expect(n.item["aviation-law-airport"]).toContain("判定の段は変えていません");
  });

  it("適用しない・関係なし・未登録の番号は何も置き換えない（エンジンの注記のまま）", () => {
    const s = summarizePermitMatch(
      match([
        { numberText: "X-1", status: "not_applied", reasons: ["expired"], registration: reg("X-1"), relevantKinds: ["night"], effectiveLastDate: "2026-03-31" },
        { numberText: "X-2", status: "unregistered", reasons: [], registration: null, relevantKinds: [], effectiveLastDate: null },
        { numberText: "X-3", status: "not_relevant", reasons: [], registration: reg("X-3"), relevantKinds: [], effectiveLastDate: "2027-09-30" },
      ] as never),
    );
    expect(verdictPermitNotes(s)).toEqual({ applied: {}, item: {} });
  });

  it("スナップショットの根拠（permitBasis）からも同じ置き換えが作れる（applied=false は参考）", () => {
    const n = verdictPermitNotesFromBasis([
      { permitNumber: "B-1", kinds: ["night"], applied: true },
      { permitNumber: "B-2", kinds: ["airport"], applied: false },
    ]);
    expect(n.applied["method_night"]).toBe(permitAppliedNote("B-1"));
    expect(n.item["aviation-law-airport"]).toBe(permitAirportReferenceNote("B-2"));
    expect(verdictPermitNotesFromBasis([])).toEqual({ applied: {}, item: {} });
  });
});
