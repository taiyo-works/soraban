// Sprint 37 K-12：入力欄の文字サイズの判定（e2e/control-font-size.ts）の単体テスト。
// e2e/ の *.test.ts は Playwright（testDir: ./e2e）に拾われるため、単体テストはここ（vitest の web の対象）に置く。
import { describe, expect, it } from "vitest";
import { CONTROL_FONT_MIN, describeControl, findControlsBelowMin, isTextControl, type ControlSample } from "../../../../e2e/control-font-size";

const c = (over: Partial<ControlSample>): ControlSample => ({
  tag: "input",
  type: "text",
  testId: "x",
  name: null,
  fontSize: 18,
  disabled: false,
  hidden: false,
  ...over,
});

describe("CONTROL_FONT_MIN（デザインシステムの下限を下回らない）", () => {
  it("本文 16px、現場 18px", () => {
    expect(CONTROL_FONT_MIN).toEqual({ body: 16, field: 18 });
  });
});

describe("findControlsBelowMin", () => {
  it("2026-11-16 の不具合の再現：16px の入力欄を現場の基準（18px）で調べると不合格になる", () => {
    const bad = findControlsBelowMin([c({ testId: "field-place", fontSize: 16 })], CONTROL_FONT_MIN.field);
    expect(bad.map(describeControl)).toEqual(["field-place input[type=text] 16px"]);
  });
  it("同じ 16px の入力欄は、本文の基準（16px）なら合格", () => {
    expect(findControlsBelowMin([c({ fontSize: 16 })], CONTROL_FONT_MIN.body)).toEqual([]);
  });
  it("textarea・select も対象（従来の expectFontSize が見ていなかった要素）", () => {
    const bad = findControlsBelowMin(
      [c({ tag: "textarea", type: null, testId: "note", fontSize: 16 }), c({ tag: "select", type: null, testId: "aircraft", fontSize: 14 }), c({ tag: "select", type: null, testId: "ok", fontSize: 18 })],
      18,
    );
    expect(bad.map((s) => s.testId)).toEqual(["note", "aircraft"]);
  });
  it("境界：ちょうど下限は合格、下限より少しでも小さければ不合格（17.6px は 18px の基準で不合格）", () => {
    expect(findControlsBelowMin([c({ fontSize: 18 })], 18)).toEqual([]);
    expect(findControlsBelowMin([c({ fontSize: 17.6 })], 18)).toHaveLength(1);
    expect(findControlsBelowMin([c({ fontSize: 17.999 })], 18)).toEqual([]);
  });
  it("非表示の欄・文字を表示しない input（checkbox・radio・range・color・file・hidden・image）は除く", () => {
    const samples = [
      c({ hidden: true, fontSize: 10 }),
      ...["checkbox", "radio", "range", "color", "file", "hidden", "image"].map((type) => c({ type, fontSize: 10 })),
    ];
    expect(findControlsBelowMin(samples, 18)).toEqual([]);
  });
  it("文字を表示する input（number・date・time・tel・search・email・submit、type 未指定）は対象。無効の欄も対象", () => {
    const types = ["number", "date", "time", "tel", "search", "email", "submit", null];
    const samples = types.map((type, i) => c({ type, testId: `t${i}`, fontSize: 16 }));
    expect(findControlsBelowMin([...samples, c({ testId: "dis", disabled: true, fontSize: 16 })], 18)).toHaveLength(types.length + 1);
  });
  it("type は大文字でも同じに扱う", () => {
    expect(isTextControl(c({ type: "CHECKBOX" }))).toBe(false);
    expect(isTextControl(c({ type: "Text" }))).toBe(true);
  });
  it("文字サイズが測れなかった欄（NaN）は、黙って通さず不合格にする", () => {
    const bad = findControlsBelowMin([c({ testId: "nan", fontSize: Number.NaN })], 16);
    expect(bad.map(describeControl)).toEqual(["nan input[type=text] 測れない"]);
  });
  it("下限が 0 以下・NaN・無限なら例外", () => {
    for (const min of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) expect(() => findControlsBelowMin([], min)).toThrow(/下限が不正/);
  });
  it("空の一覧は空を返す（入力欄の無い画面の扱いは expectControlFontSize の allowEmpty で決める）", () => {
    expect(findControlsBelowMin([], 18)).toEqual([]);
  });
});

describe("describeControl", () => {
  it("data-testid が無ければ name、どちらも無ければ識別子なしと書く", () => {
    expect(describeControl(c({ testId: null, name: "place", fontSize: 16 }))).toBe("name=place input[type=text] 16px");
    expect(describeControl(c({ tag: "select", type: null, testId: null, fontSize: 16 }))).toBe("(識別子なし) select 16px");
  });
});
