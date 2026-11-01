// Sprint 18-2 低-2：以前の dips_permit の記録（legacy）は読み取り専用。フォーム・取り下げが無く、緑の ✓ や「申請済み」を出さない。
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PROCEDURE_RECORD_LEGACY_DONE_LABEL, PROCEDURE_RECORD_LEGACY_KIND_LABEL } from "@soraban/dips";
import type { ProcedureRecordDto, ProcedureRecordSummaryDto } from "@/server/ops/report-dto";
import { ProcedureRecordsPanel } from "./procedure-client";

const record = (over: Partial<ProcedureRecordDto> = {}): ProcedureRecordDto => ({
  id: "r1",
  kind: "dips_permit",
  kindLabel: PROCEDURE_RECORD_LEGACY_KIND_LABEL,
  action: "done",
  label: PROCEDURE_RECORD_LEGACY_DONE_LABEL,
  doneAt: "2027-01-05T11:00",
  doneAtJst: "2027-01-05 11:00",
  reference: null,
  checks: { applicationCompleted: true },
  snapshotId: "s1",
  planVersion: 1,
  recordedByName: "x",
  reason: null,
  createdAt: "2027-01-05T02:00:00.000Z",
  createdAtJst: "2027-01-05 11:00",
  forCurrentSnapshot: true,
  ...over,
});
const summary = (status: "done" | "stale", latest: ProcedureRecordDto): ProcedureRecordSummaryDto => ({
  kind: "dips_permit",
  kindLabel: PROCEDURE_RECORD_LEGACY_KIND_LABEL,
  applicable: false,
  legacy: true,
  status,
  statusLabel: PROCEDURE_RECORD_LEGACY_DONE_LABEL,
  latest,
  deadlineLabel: null,
});

const render = (status: "done" | "stale", forCurrentSnapshot: boolean): string => {
  const r = record({ forCurrentSnapshot });
  return renderToStaticMarkup(
    createElement(ProcedureRecordsPanel, { planId: "p1", planVersion: 1, summary: [summary(status, r)], records: [r], canRecord: true, voided: false }),
  );
};

describe("ProcedureRecordsPanel：以前の記録（legacy）", () => {
  for (const [status, current] of [["done", true], ["stale", false]] as const) {
    it(`${status}：フォーム・取り下げが 0。札は中立で、「申請済み」「✓」「もう一度確認」を出さない`, () => {
      const html = render(status, current);
      expect(html).toContain('data-legacy="true"');
      expect(html).toContain(PROCEDURE_RECORD_LEGACY_DONE_LABEL);
      expect(html).toContain(PROCEDURE_RECORD_LEGACY_KIND_LABEL);
      for (const id of ["procedure-form-dips_permit", "procedure-retract-open-dips_permit", "procedure-submit-dips_permit", "procedure-retract-dips_permit", "procedure-stale-dips_permit"]) {
        expect(html, id).not.toContain(`data-testid="${id}"`);
      }
      expect(html).toContain('data-testid="procedure-history-dips_permit"');
      expect(html).not.toContain("申請済み");
      expect(html).not.toContain("✓");
      expect(html).not.toContain("もう一度確認");
      expect(html).not.toContain("前の判定に対する記録です");
    });
  }
});
