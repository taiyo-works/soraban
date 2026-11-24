import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BASELINE, collect, missing, readBaseline } from "../../../../../scripts/testids.mjs";

// Sprint 17 T-1：着手時の data-testid の一覧（docs/evaluations/sprint-17-testids-baseline.txt）から消えたものが 0。
// 一覧そのものは、件数の下限とハッシュで固定する（黙って書き直して「消えていない」ことにできない）。
// 書き直すときは `node scripts/testids.mjs --write --reason "理由"` で記録を残し、ここの値を意図して更新する。
const BASELINE_MIN_COUNT = 2209; // Sprint 16-H2: 判定の画面の 3 層・段 2 のクイック選択・訂正の節の識別子（judgement-*・plan-quick*・plan-edit-*）を足して書き直した。 Sprint 16-H1: 計画作成の 6 段の識別子（plan-wizard-*・plan-step-heading・plan-review-*・plan-when-section）を足して書き直した。Sprint 16-E: 見本の節 cat-orange を cat-primary-use に置き換え、並べ見本・準備カード・下部ナビの見本の識別子を足して書き直した。Sprint 16-D: 見本の入力欄・チェック行・シート・スケルトン・空の状態・通信エラーと ops-loading を足して書き直した。Sprint 16-C: 見本の cat-* を足して書き直した（ログ参照）。Sprint 16-1: 旧い見本の 265 件を除き、その後に増えた識別子を含めて書き直した（理由は sprint-17-testids-baseline-log.txt）
const BASELINE_SHA256 = "372945dcb0a8f5994ba9100a163a72c57f4891f6553c547f5cd0c72310d8c822";

describe("data-testid の基準の一覧", () => {
  it("基準の一覧は固定されている（件数の下限とハッシュ）", () => {
    expect(readBaseline().length).toBeGreaterThanOrEqual(BASELINE_MIN_COUNT);
    expect(createHash("sha256").update(readFileSync(BASELINE)).digest("hex")).toBe(BASELINE_SHA256);
  });
  it("消えた識別子が 0", () => {
    expect(missing(collect() as string[])).toEqual([]);
  });
});
