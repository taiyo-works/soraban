import { describe, expect, it } from "vitest";
import { inspectionNewHref } from "./ops-field";
import { safeReturnTo } from "./ops-return";

describe("safeReturnTo：同じオリジンの /ops/ 配下のパスだけ許す", () => {
  it("現場モードの経路（アンカーつき）を許す", () => {
    expect(safeReturnTo("/ops/plans/abc/field")).toBe("/ops/plans/abc/field");
    expect(safeReturnTo("/ops/plans/abc/field#preflight")).toBe("/ops/plans/abc/field#preflight");
  });
  it("inspectionNewHref が作る returnTo を、復号したあとも許す", () => {
    const href = inspectionNewHref("00000000-0000-4000-8000-000000000001");
    const q = new URL(href, "http://x.test").searchParams.get("returnTo");
    expect(safeReturnTo(q)).toBe("/ops/plans/00000000-0000-4000-8000-000000000001/field#preflight");
  });
  it.each([
    undefined,
    null,
    "",
    "/",
    "/ops",
    "/api/ops/me",
    "//evil.example/ops/x",
    "https://evil.example/ops/x",
    "javascript:alert(1)",
    "/ops/../evil",
    "/ops/%2e%2e/evil",
    "/ops/\\evil",
    "/ops/x\n",
    `/ops/${"a".repeat(400)}`,
  ])("外・不正なものは使わない：%s", (v) => {
    expect(safeReturnTo(v as string | undefined)).toBeUndefined();
  });
});
