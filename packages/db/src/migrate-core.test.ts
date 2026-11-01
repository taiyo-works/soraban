// マイグレーションランナーの単体テスト（DB を使わない）。
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_MIGRATIONS_DIR, runMigrationCommand, type ConnectFn } from "./migrate";
import {
  MigrationError,
  migrationChecksum,
  parseMigrationFiles,
  planMigrations,
  validateConnectionTarget,
} from "./migrate-core";

const f = (filename: string, sql = "select 1;") => ({ filename, sql });

describe("parseMigrationFiles", () => {
  it("番号順に並べ、.sql 以外は無視する", () => {
    const files = parseMigrationFiles([f("0002_b.sql"), f("README.md"), f("0001_a.sql"), f("0003_c.sql")]);
    expect(files.map((x) => x.version)).toEqual(["0001", "0002", "0003"]);
    expect(files.map((x) => x.name)).toEqual(["a", "b", "c"]);
  });

  it("命名規則に合わない .sql は中止", () => {
    expect(() => parseMigrationFiles([f("0001_a.sql"), f("2_b.sql")])).toThrow(MigrationError);
    expect(() => parseMigrationFiles([f("0001_A-b.sql")])).toThrow(/命名規則/);
  });

  it("番号の重複は中止", () => {
    expect(() => parseMigrationFiles([f("0001_a.sql"), f("0001_b.sql")])).toThrow(/重複/);
  });

  it("欠番は中止（0001 から連続していない）", () => {
    expect(() => parseMigrationFiles([f("0001_a.sql"), f("0003_c.sql")])).toThrow(/欠番: 0002/);
    expect(() => parseMigrationFiles([f("0002_b.sql")])).toThrow(/欠番: 0001/);
  });

  it("チェックサムは内容の SHA-256（1 文字の違いで変わる）", () => {
    expect(migrationChecksum("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    const [a] = parseMigrationFiles([f("0001_a.sql", "select 1;")]);
    const [b] = parseMigrationFiles([f("0001_a.sql", "select 2;")]);
    expect(a!.checksum).not.toBe(b!.checksum);
  });

  it("リポジトリのマイグレーションは 0001〜0018 で検証を通る", async () => {
    const { readMigrationDir } = await import("./migrate");
    expect(readMigrationDir(DEFAULT_MIGRATIONS_DIR).map((x) => x.filename)).toEqual([
      "0001_initial_schema.sql",
      "0002_evidence_log.sql",
      "0003_evidence_log_datasets.sql",
      "0004_ops_org_members.sql",
      "0005_ops_aircraft_pilots.sql",
      "0006_record_versions.sql",
      "0007_ops_daily_inspections_flights.sql",
      "0008_record_versions_flight_entities.sql",
      "0009_evidence_log_verdict.sql",
      "0010_flight_plans_snapshots.sql",
      "0011_plan_versions_confirmations.sql",
      "0012_flight_reports.sql",
      "0013_report_attempts_procedure_records.sql",
      "0014_flight_field_events.sql",
      "0015_permit_registrations.sql",
      "0016_incident_records.sql",
      "0017_field_round_records.sql",
      "0018_flight_areas.sql",
    ]);
  });
});

describe("validateConnectionTarget", () => {
  const neon = "postgresql://owner:pw@ep-cool-1234.ap-southeast-1.aws.neon.tech/neondb?sslmode=require";
  const pooler = "postgresql://owner:pw@ep-cool-1234-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require";

  it("未設定は中止", () => {
    expect(() => validateConnectionTarget({ connectionString: undefined, target: undefined, requireTarget: true })).toThrow(
      /DATABASE_URL_UNPOOLED/,
    );
  });

  it("-pooler を含むホスト名は拒否（status でも）", () => {
    for (const requireTarget of [true, false]) {
      expect(() =>
        validateConnectionTarget({
          connectionString: pooler,
          target: "ep-cool-1234-pooler.ap-southeast-1.aws.neon.tech",
          requireTarget,
        }),
      ).toThrow(/-pooler/);
    }
  });

  it("localhost 以外で --target なしは中止（migrate）。status は不要", () => {
    expect(() => validateConnectionTarget({ connectionString: neon, target: undefined, requireTarget: true })).toThrow(
      /--target/,
    );
    expect(validateConnectionTarget({ connectionString: neon, target: undefined, requireTarget: false }).host).toBe(
      "ep-cool-1234.ap-southeast-1.aws.neon.tech",
    );
  });

  it("--target とホスト名の不一致は中止", () => {
    expect(() =>
      validateConnectionTarget({ connectionString: neon, target: "ep-other.ap-southeast-1.aws.neon.tech", requireTarget: true }),
    ).toThrow(/一致しません/);
  });

  it("一致すれば通り、パスワードは返さない", () => {
    const t = validateConnectionTarget({
      connectionString: neon,
      target: "EP-COOL-1234.ap-southeast-1.aws.neon.tech",
      requireTarget: true,
    });
    expect(t).toEqual({ host: "ep-cool-1234.ap-southeast-1.aws.neon.tech", port: "5432", database: "neondb" });
  });

  it("?host= / hostaddr で接続先を上書きする接続文字列は拒否（--target・-pooler の確認を回避させない）", () => {
    const cases = [
      // URL は localhost だが pg は ?host= の本番へ接続する
      { cs: "postgresql://u:pw@localhost/db?host=ep-cool-1234.ap-southeast-1.aws.neon.tech", target: undefined },
      // URL は直結だが実際の接続先はプール経由
      {
        cs: "postgresql://u:pw@ep-cool-1234.ap-southeast-1.aws.neon.tech/db?sslmode=require&host=ep-cool-1234-pooler.ap-southeast-1.aws.neon.tech",
        target: "ep-cool-1234.ap-southeast-1.aws.neon.tech",
      },
      { cs: "postgresql://u:pw@localhost/db?hostaddr=203.0.113.10", target: undefined },
      { cs: "postgresql://u:pw@localhost/db?HOST=example.com", target: undefined },
    ];
    for (const c of cases) {
      for (const requireTarget of [true, false]) {
        expect(() => validateConnectionTarget({ connectionString: c.cs, target: c.target, requireTarget })).toThrow(
          /パラメータは使えません/,
        );
      }
    }
  });

  it("ホスト名なし・Unix ソケット・複数ホストは拒否", () => {
    for (const cs of ["postgresql:///db", "postgresql://u@%2Fvar%2Frun%2Fpostgresql/db", "postgresql://u:pw@h1,h2/db"]) {
      expect(() => validateConnectionTarget({ connectionString: cs, target: undefined, requireTarget: false })).toThrow(
        /特定できません/,
      );
    }
  });

  it("表示・照合するホストは pg が実際に接続するホスト（pg-connection-string と同じ解析）", () => {
    const t = validateConnectionTarget({
      connectionString: "postgresql://u:p%40ss@ep-cool-1234.ap-southeast-1.aws.neon.tech:6543/neondb?sslmode=verify-full",
      target: "ep-cool-1234.ap-southeast-1.aws.neon.tech",
      requireTarget: true,
    });
    expect(t).toEqual({ host: "ep-cool-1234.ap-southeast-1.aws.neon.tech", port: "6543", database: "neondb" });
  });

  it("localhost・127.0.0.1 は --target 不要", () => {
    expect(
      validateConnectionTarget({ connectionString: "postgresql://p:p@localhost:5432/t", target: undefined, requireTarget: true })
        .host,
    ).toBe("localhost");
    expect(
      validateConnectionTarget({ connectionString: "postgresql://p:p@127.0.0.1/t", target: undefined, requireTarget: true }).host,
    ).toBe("127.0.0.1");
  });
});

describe("planMigrations", () => {
  const files = parseMigrationFiles([f("0001_a.sql", "a"), f("0002_b.sql", "b"), f("0003_c.sql", "c")]);
  const rec = (i: number) => ({ version: files[i]!.version, name: files[i]!.name, checksum: files[i]!.checksum });

  it("未適用だけを番号順に返す", () => {
    const p = planMigrations(files, [rec(0)]);
    expect(p.problems).toEqual([]);
    expect(p.pending.map((x) => x.version)).toEqual(["0002", "0003"]);
  });

  it("チェックサム不一致を検出", () => {
    const p = planMigrations(files, [{ ...rec(0), checksum: "0".repeat(64) }]);
    expect(p.problems.join()).toMatch(/チェックサム/);
  });

  it("ファイルにない版が適用記録にある", () => {
    const p = planMigrations(files, [rec(0), { version: "0009", name: "zzz", checksum: "0".repeat(64) }]);
    expect(p.problems.join()).toMatch(/0009/);
  });
});

describe("runMigrationCommand は検証に失敗したら DB に接続しない", () => {
  const dirs: string[] = [];
  const mkdir = (names: string[]) => {
    const d = mkdtempSync(path.join(tmpdir(), "soraban-mig-"));
    dirs.push(d);
    for (const n of names) writeFileSync(path.join(d, n), "select 1;");
    return d;
  };
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  const local = "postgresql://p:p@127.0.0.1:5432/t";
  const remote = "postgresql://owner:pw@ep-cool-1234.ap-southeast-1.aws.neon.tech/neondb";
  const cases: { label: string; dir: () => string; cs: string; target?: string }[] = [
    { label: "番号の重複", dir: () => mkdir(["0001_a.sql", "0001_b.sql"]), cs: local },
    { label: "欠番", dir: () => mkdir(["0001_a.sql", "0003_c.sql"]), cs: local },
    {
      label: "-pooler",
      dir: () => DEFAULT_MIGRATIONS_DIR,
      cs: "postgresql://o:p@ep-cool-1234-pooler.ap-southeast-1.aws.neon.tech/neondb",
      target: "ep-cool-1234-pooler.ap-southeast-1.aws.neon.tech",
    },
    { label: "--target 不一致", dir: () => DEFAULT_MIGRATIONS_DIR, cs: remote, target: "ep-other.neon.tech" },
    { label: "localhost 以外で --target なし", dir: () => DEFAULT_MIGRATIONS_DIR, cs: remote },
    {
      label: "?host= で localhost を装った本番",
      dir: () => DEFAULT_MIGRATIONS_DIR,
      cs: "postgresql://owner:pw@localhost/neondb?host=ep-cool-1234.ap-southeast-1.aws.neon.tech",
    },
    {
      label: "?host= で -pooler を隠した接続文字列",
      dir: () => DEFAULT_MIGRATIONS_DIR,
      cs: "postgresql://owner:pw@ep-cool-1234.ap-southeast-1.aws.neon.tech/neondb?host=ep-cool-1234-pooler.ap-southeast-1.aws.neon.tech",
      target: "ep-cool-1234.ap-southeast-1.aws.neon.tech",
    },
  ];

  for (const c of cases) {
    it(c.label, async () => {
      const connect = vi.fn<ConnectFn>();
      const errors: string[] = [];
      const code = await runMigrationCommand({
        command: "migrate",
        connectionString: c.cs,
        dir: c.dir(),
        ...(c.target !== undefined ? { target: c.target } : {}),
        connect,
        log: () => undefined,
        error: (l) => errors.push(l),
      });
      expect(code).toBe(1);
      expect(connect).not.toHaveBeenCalled();
      expect(errors.join("\n")).toMatch(/中止/);
      expect(errors.join("\n")).not.toContain(":pw@");
    });
  }
});
