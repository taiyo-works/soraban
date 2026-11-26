// Sprint 37 K-3：タスクの台本の計数の補助（e2e/usability-measure.ts）の単体テスト。
// e2e/ の *.test.ts は Playwright（testDir: ./e2e）に拾われるため、単体テストはここ（vitest の web の対象）に置く。
import { describe, expect, it } from "vitest";
import {
  PRESS_WEIGHT,
  countSteps,
  countTransitions,
  createUsabilityRecorder,
  exceedsLimit,
  formatUsabilityResult,
  isInFirstScreen,
  type UsabilityStep,
} from "../../../../e2e/usability-measure";

describe("countSteps（数え方：押下 1、セレクト 2、入力欄は別）", () => {
  it("契約 K-3 の既知の手順：ボタン 2 回・セレクト 1 回・入力 1 欄 → 押下 4・入力欄 1", () => {
    const steps: UsabilityStep[] = [
      { kind: "tap", target: "plan-new" },
      { kind: "select", target: "plan-aircraft" },
      { kind: "type", field: "plan-name" },
      { kind: "tap", target: "plan-save" },
    ];
    expect(countSteps(steps)).toEqual({ presses: 4, fields: 1, transitions: 0, steps: 4 });
  });

  it("空の手順は 0", () => {
    expect(countSteps([])).toEqual({ presses: 0, fields: 0, transitions: 0, steps: 0 });
  });

  it("同じ欄に 2 回入力しても 1 欄。違う欄は別に数える（前後の空白は同じ欄とみなす）", () => {
    const r = countSteps([
      { kind: "type", field: "name" },
      { kind: "type", field: "name " },
      { kind: "type", field: "purpose" },
    ]);
    expect(r.fields).toBe(2);
    expect(r.presses).toBe(0);
  });

  it("スクロールと既定値で埋まる欄は数えない。遷移は押下とは別に数える", () => {
    const r = countSteps([
      { kind: "scroll" },
      { kind: "default", field: "duration" },
      { kind: "tap", target: "open-field" },
      { kind: "navigate", to: "/ops/plans/1/field" },
    ]);
    expect(r).toEqual({ presses: 1, fields: 0, transitions: 1, steps: 4 });
  });

  it("セレクトだけ 3 回 → 押下 6", () => {
    expect(countSteps([0, 1, 2].map((i) => ({ kind: "select", target: `s${i}` }) as const)).presses).toBe(6);
  });

  it("重みの表：tap 1・select 2、ほかは 0", () => {
    expect(PRESS_WEIGHT).toEqual({ tap: 1, select: 2, type: 0, navigate: 0, scroll: 0, default: 0 });
  });

  it("名前が空の手・不明な種類は例外（記録の取り違えを黙って数えない）", () => {
    expect(() => countSteps([{ kind: "tap", target: "  " }])).toThrow(/名前が空/);
    expect(() => countSteps([{ kind: "type", field: "" }])).toThrow(/名前が空/);
    expect(() => countSteps([{ kind: "swipe" } as unknown as UsabilityStep])).toThrow(/種類が不正/);
  });
});

describe("countTransitions（パスか検索部分が変わった回数）", () => {
  it("パスが変わるたびに 1。ハッシュだけ・同じ URL・末尾の / の違いは数えない", () => {
    expect(
      countTransitions([
        "http://localhost:3000/ops",
        "http://localhost:3000/ops/",
        "http://localhost:3000/ops#today",
        "http://localhost:3000/ops/plans/1",
        "http://localhost:3000/ops/plans/1/field",
        "http://localhost:3000/ops/plans/1/field",
      ]),
    ).toBe(2);
  });
  it("検索部分の変化は遷移に数える。相対のパスも扱える", () => {
    expect(countTransitions(["/ops/plans", "/ops/plans?status=draft", "/ops/plans?status=draft#x"])).toBe(1);
  });
  it("0 件・1 件は 0", () => {
    expect(countTransitions([])).toBe(0);
    expect(countTransitions(["/ops"])).toBe(0);
  });
});

describe("exceedsLimit（回帰の上限。1 回でも増えると落とす）", () => {
  const count = { presses: 4, fields: 1, transitions: 2, steps: 6 };
  it("上限と同じなら合格、1 回でも超えたら項目ごとに文を返す", () => {
    expect(exceedsLimit(count, { presses: 4, fields: 1, transitions: 2 })).toEqual([]);
    expect(exceedsLimit(count, { presses: 3 })).toEqual(["押下 4 回（上限 3）"]);
    expect(exceedsLimit(count, { presses: 3, fields: 0, transitions: 1 })).toEqual(["押下 4 回（上限 3）", "入力欄 1 欄（上限 0）", "遷移 2 回（上限 1）"]);
  });
  it("省いた項目は検査しない", () => {
    expect(exceedsLimit(count, {})).toEqual([]);
  });
  it("上限が負・小数・NaN なら例外", () => {
    expect(() => exceedsLimit(count, { presses: -1 })).toThrow(/上限が不正/);
    expect(() => exceedsLimit(count, { fields: 1.5 })).toThrow(/上限が不正/);
    expect(() => exceedsLimit(count, { transitions: Number.NaN })).toThrow(/上限が不正/);
  });
});

describe("createUsabilityRecorder（台本の E2E が使う記録器）", () => {
  it("記録した手から結果を作り、1 行の文にできる", () => {
    const rec = createUsabilityRecorder("T5", { width: 375, height: 812 });
    rec.tap("inspection-all-ok");
    rec.keepDefault("inspection-place");
    rec.tap("inspection-save");
    rec.navigate("/ops/plans/1/field");
    const r = rec.result();
    expect(r.count).toEqual({ presses: 2, fields: 0, transitions: 1, steps: 4 });
    expect(formatUsabilityResult(r)).toBe("[usability] T5 375×812: 押下 2・入力欄 0・遷移 1（記録 4 手）");
  });
  it("返した手の一覧を書き換えても記録器の中身は変わらない", () => {
    const rec = createUsabilityRecorder("T7", { width: 1280, height: 800 });
    rec.tap("takeoff");
    (rec.steps() as UsabilityStep[]).push({ kind: "tap", target: "x" });
    expect(rec.result().count.presses).toBe(1);
  });
  it("台本の名前が空・画面の寸法が不正・名前の空の手は例外", () => {
    expect(() => createUsabilityRecorder(" ", { width: 375, height: 812 })).toThrow(/台本の名前/);
    expect(() => createUsabilityRecorder("T1", { width: 0, height: 812 })).toThrow(/画面の幅/);
    const rec = createUsabilityRecorder("T1", { width: 375, height: 812 });
    expect(() => rec.select("")).toThrow(/名前が空/);
    expect(rec.steps()).toEqual([]);
  });
});

describe("isInFirstScreen（最初の画面に入るか）", () => {
  it("全体が画面の高さの中なら真。下端がちょうど画面の下端でも真", () => {
    expect(isInFirstScreen({ top: 0, height: 100 }, 812)).toBe(true);
    expect(isInFirstScreen({ top: 712, height: 100 }, 812)).toBe(true);
  });
  it("一部でもはみ出す・上にはみ出す・高さ 0 は偽", () => {
    expect(isInFirstScreen({ top: 713, height: 100 }, 812)).toBe(false);
    expect(isInFirstScreen({ top: -1, height: 10 }, 812)).toBe(false);
    expect(isInFirstScreen({ top: 10, height: 0 }, 812)).toBe(false);
  });
  it("画面の高さが不正なら例外", () => {
    expect(() => isInFirstScreen({ top: 0, height: 10 }, 0)).toThrow(/画面の高さ/);
  });
});
