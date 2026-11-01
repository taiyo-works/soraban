import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BASELINE, collect, missing, readBaseline } from "../../../../../scripts/testids.mjs";

// Sprint 17 T-1：着手時の data-testid の一覧（docs/evaluations/sprint-17-testids-baseline.txt）から消えたものが 0。
// 一覧そのものは、件数の下限とハッシュで固定する（黙って書き直して「消えていない」ことにできない）。
// 書き直すときは `node scripts/testids.mjs --write --reason "理由"` で記録を残し、ここの値を意図して更新する。
const BASELINE_MIN_COUNT = 1996;
const BASELINE_SHA256 = "84d11a87f10d8b45b80fa95798d31f293e51aaac6ed262c0c557c2c7f3a83916";

describe("data-testid の基準の一覧", () => {
  it("基準の一覧は固定されている（件数の下限とハッシュ）", () => {
    expect(readBaseline().length).toBeGreaterThanOrEqual(BASELINE_MIN_COUNT);
    expect(createHash("sha256").update(readFileSync(BASELINE)).digest("hex")).toBe(BASELINE_SHA256);
  });
  it("消えた識別子が 0", () => {
    expect(missing(collect() as string[])).toEqual([]);
  });
});
