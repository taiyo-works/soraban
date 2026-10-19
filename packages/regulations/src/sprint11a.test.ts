// 証跡 ID のハッシュを使う契約 20 の残りは apps/web/src/server/sprint11a.test.ts（node:crypto を使うため）。
import { describe, expect, it } from "vitest";
// Sprint 11a（制度の最新化）の契約 10・11・13〜16・19・20 の単体テスト。
import {
  ALL_MANUAL_METHOD_SECTIONS,
  ALL_PROCEDURES,
  buildPrefillFields,
  deriveDiagnosis,
  EMERGENCY_NO_FLY_NOTE,
  verificationNoteLabel,
  getCategoryDefinition,
  PROCEDURES_VERIFIED_AT,
  type SpecificFlightFlag,
} from "./index";
import proceduresData from "../data/procedures/procedures.json";

const proc = (id: string) => {
  const p = ALL_PROCEDURES.find((x) => x.id === id);
  if (!p) throw new Error(id);
  return p;
};
const hasNote = (notes: readonly string[], ...words: string[]) =>
  notes.filter((n) => words.every((w) => n.includes(w)));

describe("C1 農薬等の空中散布（通達 国空無機第338898号）", () => {
  it("10. 物件投下・危険物の note に施行規則と通達の番号がある", () => {
    for (const id of ["flight-approval-drop", "flight-approval-dangerous"]) {
      expect(proc(id).note).toContain("施行規則第236条の82第1項第2号");
      expect(proc(id).note).toContain("国空無機第338898号");
    }
    expect(proc("flight-approval-drop").note).not.toContain(["農薬散布等を含む", "物件の投下は"].join(""));
    for (const id of ["flight-approval-night", "flight-approval-bvlos", "flight-approval-30m"]) {
      expect(proc(id).note).toContain("国空無機第338898号");
    }
  });

  it("11. method_drop を含むとカテゴリーは II_A のままで、通達の注記が 1 件ある", () => {
    const d = deriveDiagnosis({ flags: ["method_drop"], droneWeightG: 900 });
    expect(d.category).toBe("II_A");
    expect(hasNote(d.verificationNotes, "国空無機第338898号", "4m", "人口集中地区")).toHaveLength(1);
    expect(hasNote(d.verificationNotes, "https://www.mlit.go.jp/common/001990796.pdf")).toHaveLength(1);
    // 人口集中地区の上空は法第132条の85 の規定に従う（通達 4.）。「許可は別に必要」と断定しない
    expect(hasNote(d.verificationNotes, "第132条の85 の規定に従う")).toHaveLength(1);
    expect(hasNote(d.verificationNotes, "許可は別に必要")).toHaveLength(0);
    const dd = deriveDiagnosis({ flags: ["method_dangerous", "method_drop"], droneWeightG: 900 });
    expect(hasNote(dd.verificationNotes, "国空無機第338898号")).toHaveLength(1);
  });

  it("11. method_drop・method_dangerous のどちらも含まないときは通達の注記がない", () => {
    for (const flags of [[], ["method_night"], ["method_bvlos", "airspace_did"]] as SpecificFlightFlag[][]) {
      const d = deriveDiagnosis({ flags, droneWeightG: 900 });
      expect(hasNote(d.verificationNotes, "国空無機第338898号")).toHaveLength(0);
    }
  });

  it("13. マニュアル骨子の method_drop に航空局の飛行マニュアル（令和8年5月29日版）の観点がある", () => {
    const drop = ALL_MANUAL_METHOD_SECTIONS.find((m) => m.flag === "method_drop");
    expect(
      drop?.points.some((p) => p.includes("航空局") && p.includes("飛行マニュアル") && p.includes("令和8年5月29日版")),
    ).toBe(true);
  });
});

describe("C2 第三者賠償責任保険", () => {
  it("14. 出典が制度改正の資料で、note にレベル3.5", () => {
    const ins = proc("insurance-third-party-25kg");
    expect(ins.sourceUrl).toBe("https://www.mlit.go.jp/common/001909323.pdf");
    expect(ins.note).toContain("レベル3.5");
  });

  it("14. 25,000g・空港等周辺で保険が付き、24,999g では付かない（既存の振る舞い）", () => {
    const ids = (w: number) =>
      deriveDiagnosis({ flags: ["airspace_airport"], droneWeightG: w }).procedures.map((p) => p.id);
    expect(ids(25_000)).toContain("insurance-third-party-25kg");
    expect(ids(24_999)).not.toContain("insurance-third-party-25kg");
  });

  it("14. 補助者なしの目視外は重量にかかわらずレベル3.5の保険の注記がある", () => {
    for (const w of [900, 24_999, 30_000]) {
      const d = deriveDiagnosis({ flags: ["method_bvlos"], droneWeightG: w, bvlosWithObserver: false });
      expect(hasNote(d.verificationNotes, "レベル3.5", "第三者賠償責任保険")).toHaveLength(1);
    }
    const withObserver = deriveDiagnosis({ flags: ["method_bvlos"], droneWeightG: 900, bvlosWithObserver: true });
    expect(hasNote(withObserver.verificationNotes, "レベル3.5")).toHaveLength(0);
  });
});

describe("C3 補助者なし目視外 × 人口集中地区（審査要領 5-4(3)c)ア）", () => {
  it("15. 補助者なし・DID 該当で注記があり、カテゴリーは II_B_eligible のまま", () => {
    const d = deriveDiagnosis({
      flags: ["method_bvlos", "airspace_did"],
      droneWeightG: 900,
      bvlosWithObserver: false,
      didStatus: "applicable",
    });
    expect(d.category).toBe("II_B_eligible");
    expect(hasNote(d.verificationNotes, "5-4(3)c)ア", "令和8年9月29日")).toHaveLength(1);
  });

  it("15. 補助者あり、または DID 非該当では注記がない", () => {
    const withObserver = deriveDiagnosis({
      flags: ["method_bvlos", "airspace_did"],
      droneWeightG: 900,
      bvlosWithObserver: true,
    });
    expect(hasNote(withObserver.verificationNotes, "5-4(3)c)ア")).toHaveLength(0);
    const outsideDid = deriveDiagnosis({
      flags: ["method_bvlos"],
      droneWeightG: 900,
      bvlosWithObserver: false,
      didStatus: "not_applicable",
    });
    expect(hasNote(outsideDid.verificationNotes, "5-4(3)c)ア")).toHaveLength(0);
  });
});

describe("C4 緊急用務空域（原則飛行禁止）", () => {
  const cases = [
    { name: "900g", input: { droneWeightG: 900 } },
    { name: "50g", input: { droneWeightG: 50 } },
    { name: "30,000g", input: { droneWeightG: 30_000 } },
    { name: "第三者上空あり", input: { droneWeightG: 900, thirdPartyOverflight: true } },
    { name: "重量未指定", input: {} },
  ] as const;
  for (const c of cases) {
    it(`16. ${c.name} でもカテゴリー emergency_no_fly・期限なし・保険なし`, () => {
      const d = deriveDiagnosis({ flags: ["airspace_emergency", "airspace_airport"], ...c.input });
      expect(d.category).toBe("emergency_no_fly");
      expect(d.deadlines.map((x) => x.procedureId)).not.toContain("flight-permission-emergency-airspace");
      expect(d.procedures.map((p) => p.id)).not.toContain("insurance-third-party-25kg");
      // 指定の確認（申請する手続きではない）は重量にかかわらず案内する
      expect(d.procedures.map((p) => p.id)).toContain("flight-permission-emergency-airspace");
    });
  }

  it("16. 原則飛行禁止はカテゴリーの説明で言い切り、注記では繰り返さない。注記に「要確認」の見出しを付けない", () => {
    const d = deriveDiagnosis({ flags: ["airspace_emergency"], droneWeightG: 900 });
    expect(d.categoryNote.startsWith("緊急用務空域に指定されている間は、原則として飛行できません")).toBe(true);
    expect(d.categoryNote).toContain("飛行の直前に指定の有無を確認");
    const n = d.verificationNotes.find((x) => x.includes("緊急用務空域"));
    expect(n).toBe(EMERGENCY_NO_FLY_NOTE);
    expect(n).not.toContain("原則として飛行");
    expect(n).not.toContain("許可があっても");
    expect(verificationNoteLabel(n!)).toBe("※ ");
    // ほかの注記は従来どおり「要確認」
    const drop = deriveDiagnosis({ flags: ["method_drop"], droneWeightG: 900 });
    expect(verificationNoteLabel(drop.verificationNotes[0]!)).toBe("※ 要確認: ");
  });

  it("16. 例外の許可（審査要領 5-1(2)c)）を示し、「申請する手続きではありません」と言い切らない", () => {
    const p = proc("flight-permission-emergency-airspace");
    expect(p.note).not.toContain("申請する手続きではありません");
    expect(p.note).toContain("真に必要と認められる");
    expect(p.note).toContain("5-1(2)c)");
    expect(p.legalBasis).toContain("5-1(2)c)");
    expect(getCategoryDefinition("emergency_no_fly").description).toContain("5-1(2)c)");
  });

  it("16. プリフィルの飛行の種類で緊急用務空域に「（指定中は飛行不可）」を添える", () => {
    const f = buildPrefillFields({ lat: 35.4278, lng: 133.3314, flags: ["airspace_emergency", "airspace_did"], droneWeightG: 900 });
    const row = f.find((x) => x.dipsFieldLabel.startsWith("飛行の種類"));
    expect(row?.value).toContain("緊急用務空域（指定中は飛行不可）");
    const g = buildPrefillFields({ lat: 35.4278, lng: 133.3314, flags: ["airspace_did"], droneWeightG: 900 });
    expect(g.find((x) => x.dipsFieldLabel.startsWith("飛行の種類"))?.value).not.toContain("指定中は飛行不可");
  });

  it("16. カテゴリー定義の説明に「許可があっても」、手続きは期限 0", () => {
    expect(getCategoryDefinition("emergency_no_fly").description).toContain("許可があっても");
    expect(getCategoryDefinition("emergency_no_fly").label).toContain("飛行できません");
    const p = proc("flight-permission-emergency-airspace");
    expect(p.leadTimeBusinessDays).toBe(0);
    expect(p.waivableByIIB).toBe(false);
  });
});

describe("C6・D 出典の記録と版", () => {
  it("19. _legalBasisSources に S1・S2・S6・S7・S8 があり、確認日が 2026-10-19 以降で PROCEDURES_VERIFIED_AT と一致", () => {
    const sources = (proceduresData as { _legalBasisSources: { url: string; checkedAt: string }[] })
      ._legalBasisSources;
    const urls = [
      "https://www.mlit.go.jp/common/002010810.pdf",
      "https://www.mlit.go.jp/common/001990796.pdf",
      "https://www.mlit.go.jp/common/001909323.pdf",
      "https://www.mlit.go.jp/koku/content/001866503.pdf",
      "https://www.mlit.go.jp/koku/level4/license/",
    ];
    for (const u of urls) {
      const s = sources.find((x) => x.url === u);
      expect(s, u).toBeDefined();
      expect(s!.checkedAt >= "2026-10-19").toBe(true);
      expect(PROCEDURES_VERIFIED_AT.slice(0, 10)).toBe(s!.checkedAt);
    }
  });

});
