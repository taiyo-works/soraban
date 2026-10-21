import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// 適用済みのマイグレーション 0001〜0013 は書き換えない（Sprint 12b の契約 20。12c の契約 17 で 0012・0013 も固定）。
// 変更が必要なら新しい番号のマイグレーションで行う。
const FROZEN: Record<string, string> = {
  "0001_initial_schema.sql":
    "dd45e5ac0f15d49e9a3bd36d6629756838e7a5c13e03bd63cdefc8ccc7823fdc",
  "0002_evidence_log.sql":
    "1c96221653a943ec785f0bd01f2e55ef100aa55d0afd08511ed3930a4c67f645",
  "0003_evidence_log_datasets.sql":
    "eefee60ba9a1def89321be297258df6587b26c4ec8af309ea66983fb6777223c",
  "0004_ops_org_members.sql":
    "c528f31936673ff5e4582f13aaf0b216179575073f1f68a70fd51e80fa35a308",
  "0005_ops_aircraft_pilots.sql":
    "b25e0aa6a45123c188ae7afb30825bd602a30201bc67dac71283d6b45b3b07b0",
  "0006_record_versions.sql":
    "04ad81243a47e815867ddebdd65650a707b34001ae3c0f3cfa20c4fda7395768",
  "0007_ops_daily_inspections_flights.sql":
    "05e5d406e6ec0f48f8f7f6964953dbdeb2f98f605445a907cac9c5366b194ee3",
  "0008_record_versions_flight_entities.sql":
    "6fcf25f0632d09bd916dd77db3f9d5cadf01471c9c1447774dff525d01816168",
  "0009_evidence_log_verdict.sql":
    "beebc8b5a7ab694b2741a6283aee55d33eafd670584cb83203457c5c7160eae5",
  "0010_flight_plans_snapshots.sql":
    "feb342c630cde6aca17cdf2ed0d7c9bd8e8d663cb36aa5f4a2cf4dae34a45965",
  "0011_plan_versions_confirmations.sql":
    "b931328364e191c52d49b261bf2275806ea6bcb7640ddbab64c8ccd94ac500dd",
  "0012_flight_reports.sql":
    "fced8fde9eac1e8dfa998748a855bcf12f99e57d7ce350c2e2f4fe46b8c27ff7",
  "0013_report_attempts_procedure_records.sql":
    "c96ec464cd1ec1763c1496f702f69d012079e18e516be8fd96a4f23a9f70500c",
};

describe("適用済みマイグレーションの凍結", () => {
  for (const [file, hash] of Object.entries(FROZEN)) {
    it(`${file} は変更されていない`, () => {
      const body = readFileSync(join(__dirname, "..", "migrations", file));
      expect(createHash("sha256").update(body).digest("hex")).toBe(hash);
    });
  }
});
