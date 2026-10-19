import { describe, expect, it } from "vitest";
import { describeConnection, isDbConfigured, isEvidenceLogEnabled } from "./config";
import { resolveTestDatabaseUrl } from "./test-db-env";

describe("config", () => {
  it("DATABASE_URL が空・未設定なら未設定扱い", () => {
    expect(isDbConfigured({})).toBe(false);
    expect(isDbConfigured({ DATABASE_URL: "  " })).toBe(false);
    expect(isDbConfigured({ DATABASE_URL: "postgresql://u:p@h/db" })).toBe(true);
  });

  it("EVIDENCE_LOG=off（大文字小文字を問わない）で無効", () => {
    expect(isEvidenceLogEnabled({})).toBe(true);
    expect(isEvidenceLogEnabled({ EVIDENCE_LOG: "off" })).toBe(false);
    expect(isEvidenceLogEnabled({ EVIDENCE_LOG: "OFF" })).toBe(false);
    expect(isEvidenceLogEnabled({ EVIDENCE_LOG: "on" })).toBe(true);
  });

  it("describeConnection はパスワードを返さない", () => {
    const d = describeConnection("postgresql://user:secret@ep-x.ap-southeast-1.aws.neon.tech/neondb?sslmode=require");
    expect(d).toEqual({ host: "ep-x.ap-southeast-1.aws.neon.tech", port: "5432", database: "neondb" });
    expect(JSON.stringify(d)).not.toContain("secret");
    expect(describeConnection("not a url")).toBeNull();
  });
});

describe("resolveTestDatabaseUrl（REQUIRE_DB_TESTS）", () => {
  it("未設定ならスキップ（undefined）", () => {
    expect(resolveTestDatabaseUrl({})).toBeUndefined();
  });
  it("REQUIRE_DB_TESTS=1 で未設定なら失敗する", () => {
    expect(() => resolveTestDatabaseUrl({ REQUIRE_DB_TESTS: "1" })).toThrow(/TEST_DATABASE_URL/);
  });
  it("設定されていればその値", () => {
    expect(resolveTestDatabaseUrl({ TEST_DATABASE_URL: "postgresql://x/y", REQUIRE_DB_TESTS: "1" })).toBe("postgresql://x/y");
  });
});
