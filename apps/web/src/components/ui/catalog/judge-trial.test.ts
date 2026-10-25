// UX stage 3: the judgement screen trial. Unit part: the query string and the sample data. The behaviour is covered by
// e2e/sprint12g-judge.spec.ts.
import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, parseConfig } from "./config";
import { ADDRESS_POINT, DEFAULT_POINT, GEO_POINT, JUDGE_LAYERS, LAYER_GROUPS, judgeAt } from "./judge-trial-data";

describe("判定画面の見本（URL）", () => {
  it("view=judge は sp で スマホの案を選ぶ。知らない値は シート。他の見本の sp には影響しない", () => {
    expect(parseConfig({ view: "judge" })).toMatchObject({ view: "judge", jsp: "sheet" });
    expect(parseConfig({ view: "judge", sp: "tabs" }).jsp).toBe("tabs");
    expect(parseConfig({ view: "judge", sp: "fold" }).jsp).toBe("fold");
    expect(parseConfig({ view: "judge", sp: "x" }).jsp).toBe("sheet");
    expect(parseConfig({ view: "menu", sp: "tabs4band" })).toMatchObject({ sp: "tabs4band", jsp: "sheet" });
    expect(parseConfig({})).toEqual(DEFAULT_CONFIG);
  });
});

describe("判定画面の見本のデータ", () => {
  it("層は 航空法・小型無人機等飛行禁止法・その他・そらばん追加 の順の群に入り、id は重ならない", () => {
    expect(LAYER_GROUPS.map((g) => g.id)).toEqual(["aviation", "drone-law", "other", "soraban"]);
    const ids = JUDGE_LAYERS.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const l of JUDGE_LAYERS) expect(LAYER_GROUPS.some((g) => g.id === l.group)).toBe(true);
  });
  it("既定の地点と住所の地点は DID の中で要手続き、現在地は DID の外で手続き不要", () => {
    expect(judgeAt(DEFAULT_POINT).level).toBe("needs_procedure");
    expect(judgeAt(ADDRESS_POINT).level).toBe("needs_procedure");
    expect(judgeAt(GEO_POINT).level).toBe("no_procedure");
    expect(judgeAt(GEO_POINT).procedures).toEqual([]);
  });
  it("結果の行は、層の群に属する", () => {
    for (const r of judgeAt(DEFAULT_POINT).rows) expect(LAYER_GROUPS.some((g) => g.id === r.group)).toBe(true);
  });
});
