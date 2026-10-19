import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ADDRESS_BUNDLE } from "../../../../packages/regulations/src/data-bundle/address-bundle";

// 住所検索の同梱索引の状態（空か否か）が README（packages/regulations/data/address/README.md）の記載と一致する（Sprint 9）。
// 索引が空の間は、同梱索引の照合精度のテスト（bundled.test.ts）がスキップになるため、その状態を README で明示させる。
const README = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../packages/regulations/data/address/README.md",
);

describe("住所検索の同梱索引の状態", () => {
  it("索引が空なら README は「未取得」、空でなければ取得日を記載している", () => {
    const readme = readFileSync(README, "utf8");
    if (Object.keys(ADDRESS_BUNDLE).length === 0) expect(readme).toContain("状態：**未取得**");
    else expect(readme).toContain("取得日：");
  });
});
