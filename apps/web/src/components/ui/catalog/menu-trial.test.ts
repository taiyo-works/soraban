// UX stage 2: the menu and home trial. Unit part: the query string that makes a view shareable, and the sample data
// (the names agreed with the owner, the seven stages, one id per script). The behaviour is covered by e2e/sprint12g-ux2.spec.ts.
import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, parseConfig } from "./config";
import { DEADLINES, LAYERS, NAV_OF_PAGE, PAGE_TITLE, PC_SCRIPTS, PHONE_SCRIPTS, STAGES, UPCOMING } from "./trial-data";

describe("見本の切り替え（URL）", () => {
  it("何も付けなければ、これまでの表示（部品と画面）で、案の既定は 左メニュー・5 タブ・飛行がある日・判定・地図中心", () => {
    expect(parseConfig({})).toEqual(DEFAULT_CONFIG);
    expect(DEFAULT_CONFIG).toMatchObject({ view: "parts", pc: "rail", sp: "tabs5", day: "busy", pcname: "judge", judge: "workspace" });
  });
  it("pc・sp・day・pcname・judge・view を読む。知らない値は既定に戻す。配列は先頭", () => {
    expect(parseConfig({ view: "menu", pc: "tabs", sp: "tabs4band", day: "empty", pcname: "map", judge: "stack" })).toMatchObject({
      view: "menu",
      pc: "tabs",
      sp: "tabs4band",
      day: "empty",
      pcname: "map",
      judge: "stack",
    });
    expect(parseConfig({ view: "x", pc: "left", sp: "tabs3", day: "rain", pcname: "z", judge: "map" })).toEqual(DEFAULT_CONFIG);
    expect(parseConfig({ pc: ["tabs", "rail"] }).pc).toBe("tabs");
  });
});

describe("見本のデータ", () => {
  it("行程は 7 段で、判定→計画→確認→通報→点検→飛行→日誌の順", () => {
    expect([...STAGES]).toEqual(["判定", "計画", "確認", "通報", "点検", "飛行", "日誌"]);
    for (const f of UPCOMING) expect(f.done).toBeLessThan(STAGES.length);
  });
  it("決めた名前：ホーム・判定・計画・日誌・登録（「今日」「その他」は使わない）", () => {
    const titles = Object.values(PAGE_TITLE);
    for (const t of ["ホーム", "判定", "計画", "日誌", "登録", "機体", "操縦者", "許可・承認", "地点"]) expect(titles).toContain(t);
    for (const t of titles) expect(t).not.toMatch(/今日|その他/);
    expect(NAV_OF_PAGE["incident-new"]).toBe("journal");
  });
  it("台本の id は重ならず、PC は 4 つ・スマホは 5 つ。層は 5 つ", () => {
    const ids = [...PC_SCRIPTS, ...PHONE_SCRIPTS].map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(PC_SCRIPTS).toHaveLength(4);
    expect(PHONE_SCRIPTS).toHaveLength(5);
    expect(LAYERS.map((l) => l.id)).toEqual(["did", "urgent", "industrial", "airport", "park"]);
  });
  it("近づく期限は、記録する列がある技能証明と許可・承認だけ（機体の期限は載せない）", () => {
    for (const d of DEADLINES) expect(d.what).toMatch(/技能証明|許可・承認/);
  });
});
