import { describe, expect, it } from "vitest";
import { legacyAnchorTarget } from "./plan-anchor-compat";

// Sprint 17 S-6：旧い計画の詳細の 8 つのアンカーを新しい場所へ移す（#sec-report は通報の主画面そのもの）。
describe("旧いアンカーの互換", () => {
  const cases: readonly [string, string | null][] = [
    ["#sec-verdict", "/judgement#sec-verdict"],
    ["#permits", "/judgement#permits"],
    ["#rejudge", "/judgement#rejudge"],
    ["#sec-confirm", "/overview#sec-confirm"],
    ["#request-confirmation", "/overview#request-confirmation"],
    ["#confirm", "/overview#confirm"],
    ["#procedures", "/overview#procedures"],
    ["#sec-report", null],
    ["", null],
    ["#unknown", null],
  ];
  for (const [hash, to] of cases) {
    it(`${hash || "(なし)"}`, () => {
      expect(legacyAnchorTarget("P1", hash)).toBe(to === null ? null : `/ops/plans/P1${to}`);
    });
  }
});
