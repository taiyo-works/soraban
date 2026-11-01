// Sprint 18-2 B5：公開の手続きの案内の文（「許可・承認の申請と飛行計画の通報は、利用者本人が DIPS 2.0 などの公式の手続きで行います。」）は、
// 4 つの定数に重複していたものを 1 つに揃えた。packages/dips と packages/regulations は互いに依存しないため、同じ文を両方に置き、ここで一致を確かめる。
import { describe, expect, it } from "vitest";
import { OFFICIAL_PROCEDURE_NOTE, PROCEDURE_RECORD_NOTE, REPORT_NOTICE_MANUAL } from "@soraban/dips";
import { PLAN_JUDGEMENT_DISCLAIMER, REPORT_FIXED_NOTE } from "@soraban/regulations";

const OLD = "申請・通報は DIPS 2.0 などの公式の手続きで行ってください";

describe("公式の手続きの案内の文（B5）", () => {
  it("OFFICIAL_PROCEDURE_NOTE が新しい 1 文で、4 つの定数の末尾がこの文と一致する", () => {
    expect(OFFICIAL_PROCEDURE_NOTE).toBe("許可・承認の申請と飛行計画の通報は、利用者本人が DIPS 2.0 などの公式の手続きで行います。");
    for (const [name, text] of Object.entries({ REPORT_NOTICE_MANUAL, REPORT_FIXED_NOTE, PLAN_JUDGEMENT_DISCLAIMER, PROCEDURE_RECORD_NOTE })) {
      expect(text.endsWith(OFFICIAL_PROCEDURE_NOTE), name).toBe(true);
    }
  });

  it("旧い文はどこにも残らない。「代行」「代理」の語を含まない", () => {
    for (const text of [OFFICIAL_PROCEDURE_NOTE, REPORT_NOTICE_MANUAL, REPORT_FIXED_NOTE, PLAN_JUDGEMENT_DISCLAIMER, PROCEDURE_RECORD_NOTE]) {
      expect(text).not.toContain(OLD);
      expect(text).not.toContain("代行");
      expect(text).not.toContain("代理");
    }
  });
});
