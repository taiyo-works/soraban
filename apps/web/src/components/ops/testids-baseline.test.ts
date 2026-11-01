import { describe, expect, it } from "vitest";
import { collect, missing } from "../../../../../scripts/testids.mjs";

// Sprint 17 T-1：着手時の data-testid の一覧（docs/evaluations/sprint-17-testids-baseline.txt）から消えたものが 0。
describe("data-testid の基準の一覧", () => {
  it("消えた識別子が 0", () => {
    expect(missing(collect() as string[])).toEqual([]);
  });
});
