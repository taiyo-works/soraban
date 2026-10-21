// CI の db ジョブの権限の確認（.github/workflows/ci.yml）に、追記専用の表の確認が入っていること（Sprint 12c 契約 1）。
// CI の確認そのものは実際の DB で行われる。ここでは、確認の行が消えたり弱まったりしていないことを文面で確かめる。
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const CI = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", ".github", "workflows", "ci.yml"), "utf8");

const expectOf = (table: string, privilege: string): string | null => {
  const re = new RegExp(`has_table_privilege\\('soraban_app', '${table}', '${privilege}'\\)"\\)" = "([tf])"`);
  return re.exec(CI)?.[1] ?? null;
};

describe("CI の権限の確認", () => {
  it("flight_field_events は参照と追加だけ（SELECT・INSERT = t、UPDATE・DELETE・TRUNCATE = f）", () => {
    expect(expectOf("flight_field_events", "SELECT")).toBe("t");
    expect(expectOf("flight_field_events", "INSERT")).toBe("t");
    for (const p of ["UPDATE", "DELETE", "TRUNCATE"]) expect(expectOf("flight_field_events", p), p).toBe("f");
  });

  it("Sprint 12d：permit_registrations は参照だけ（SELECT = t、INSERT・UPDATE・DELETE・TRUNCATE = f）。根拠の検査のトリガーの確認もある", () => {
    expect(expectOf("permit_registrations", "SELECT")).toBe("t");
    for (const p of ["INSERT", "UPDATE", "DELETE", "TRUNCATE"]) expect(expectOf("permit_registrations", p), p).toBe("f");
    expect(CI).toContain("judgement_snapshots_permit_basis");
  });

  it("12a・12b の追記専用の表の確認も残っている", () => {
    for (const t of ["judgement_snapshots", "plan_confirmations", "flight_report_attempts", "plan_procedure_records"]) {
      expect(CI, t).toContain(t);
    }
    expect(expectOf("record_versions", "UPDATE")).toBe("f");
  });
});
