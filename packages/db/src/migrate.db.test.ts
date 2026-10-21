// マイグレーションランナーの DB テスト（pnpm test:db、Sprint 8 契約 A・B）。
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_MIGRATIONS_DIR } from "./migrate";
import { LATEST_MIGRATION_VERSION as LATEST, MIGRATION_VERSIONS } from "./migrations-manifest";
import { createTempDatabase, runCli, withClient, type TempDatabase } from "./test-db-helpers";
import { resolveTestDatabaseUrl } from "./test-db-env";

const ADMIN_URL = resolveTestDatabaseUrl();
const N = MIGRATION_VERSIONS.length;
/** 既存の最新の次の版（テスト用に一時的に置くファイルの番号）。 */
const NEXT = String(N + 1).padStart(4, "0");

const countMigrations = (url: string) =>
  withClient(url, async (c) => Number((await c.query("select count(*)::int as n from schema_migrations")).rows[0].n));

describe.skipIf(!ADMIN_URL)("pnpm db:migrate（DB）", () => {
  let db: TempDatabase;
  const tmpDirs: string[] = [];
  const copyMigrations = () => {
    const d = mkdtempSync(path.join(tmpdir(), "soraban-mig-"));
    tmpDirs.push(d);
    cpSync(DEFAULT_MIGRATIONS_DIR, d, { recursive: true });
    return d;
  };
  const migrate = (extra: string[] = []) => runCli(["migrate", ...extra], { DATABASE_URL_UNPOOLED: db.url });

  beforeEach(async () => {
    db = await createTempDatabase(ADMIN_URL!);
  });
  afterEach(async () => {
    await db?.drop();
    for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it(`空の DB に 0001〜${LATEST} を適用し、適用記録に ${N} 行。2 回目は何もしない`, async () => {
    const first = await migrate();
    expect(first.code, first.stderr).toBe(0);
    expect(first.stdout).toContain(`適用予定: ${MIGRATION_VERSIONS.join(", ")}`);
    expect(first.stdout).not.toMatch(/:[^@\s]*@/); // パスワードを表示しない
    const rows = await withClient(db.url, async (c) =>
      (await c.query("select version, name, checksum, applied_at, duration_ms from schema_migrations order by version")).rows,
    );
    expect(rows.map((r) => [r.version, r.name])).toEqual([
      ["0001", "initial_schema"],
      ["0002", "evidence_log"],
      ["0003", "evidence_log_datasets"],
      ["0004", "ops_org_members"],
      ["0005", "ops_aircraft_pilots"],
      ["0006", "record_versions"],
      ["0007", "ops_daily_inspections_flights"],
      ["0008", "record_versions_flight_entities"],
      ["0009", "evidence_log_verdict"],
      ["0010", "flight_plans_snapshots"],
      ["0011", "plan_versions_confirmations"],
      ["0012", "flight_reports"],
      ["0013", "report_attempts_procedure_records"],
      ["0014", "flight_field_events"],
    ]);
    for (const r of rows) {
      expect(r.checksum).toMatch(/^[0-9a-f]{64}$/);
      expect(r.applied_at).toBeInstanceOf(Date);
    }

    const second = await migrate();
    expect(second.code, second.stderr).toBe(0);
    expect(second.stdout).toContain("未適用のマイグレーションはありません");
    expect(await countMigrations(db.url)).toBe(N);

    const status = await runCli(["status"], { DATABASE_URL_UNPOOLED: db.url });
    expect(status.code).toBe(0);
    expect(status.stdout).toContain(`適用済み ${N} 件、未適用 0 件`);
  });

  it("適用済みの 0002 を 1 文字変えるとチェックサム不一致で何も適用せず非 0", async () => {
    expect((await migrate()).code).toBe(0);
    const dir = copyMigrations();
    const p = path.join(dir, "0002_evidence_log.sql");
    writeFileSync(p, readFileSync(p, "utf8").replace("監査トレイル", "監査トレイA"));
    // 何も適用しないことを確かめるため、正しい次の版も置く。
    writeFileSync(path.join(dir, `${NEXT}_should_not_apply.sql`), "create table should_not_apply (id int);");
    const r = await migrate(["--dir", dir]);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toMatch(/チェックサム/);
    expect(await countMigrations(db.url)).toBe(N);
    const exists = await withClient(db.url, async (c) =>
      (await c.query("select to_regclass('public.should_not_apply') as t")).rows[0].t,
    );
    expect(exists).toBeNull();
  });

  it("構文誤りの次の版は記録されず、その中で作ろうとした表も残らない。非 0", async () => {
    expect((await migrate()).code).toBe(0);
    const dir = copyMigrations();
    writeFileSync(
      path.join(dir, `${NEXT}_broken.sql`),
      "create table broken_should_rollback (id int primary key);\nselec 1;\n",
    );
    const r = await migrate(["--dir", dir]);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain(`${NEXT}_broken.sql`);
    expect(await countMigrations(db.url)).toBe(N);
    const exists = await withClient(db.url, async (c) =>
      (await c.query("select to_regclass('public.broken_should_rollback') as t")).rows[0].t,
    );
    expect(exists).toBeNull();
  });

  // Sprint 11d 契約 16：0009 は 0008 まで適用済みの DB にも適用でき、既存の行は書き換えない（null のまま）。
  it("0008 まで適用済みで行がある DB に 0009 を適用でき、既存の行の判定の列は null のまま", async () => {
    const dir = copyMigrations();
    // 0009 以降（0010〜0014 は 0009 の後の追記）を外して 0008 まで適用する
    for (const f of [
      "0009_evidence_log_verdict.sql",
      "0010_flight_plans_snapshots.sql",
      "0011_plan_versions_confirmations.sql",
      "0012_flight_reports.sql",
      "0013_report_attempts_procedure_records.sql",
      "0014_flight_field_events.sql",
    ]) {
      rmSync(path.join(dir, f));
    }
    expect((await migrate(["--dir", dir])).code).toBe(0);
    expect(await countMigrations(db.url)).toBe(8);
    await withClient(db.url, (c) =>
      c.query(
        `insert into evidence_log (evidence_id, engine_version, checked_at, loc, overall, overall_confidence,
           regulation_ids, per_regulation_status)
         values ('ev_before_0009', 'soraban-0.3.0-regulations-2026-07', now(),
           ST_GeogFromText('SRID=4326;POINT(133.33 35.43)'), 'green', 'high', '{}', '{}')`,
      ),
    );
    const r = await migrate();
    expect(r.code, r.stderr).toBe(0);
    expect(await countMigrations(db.url)).toBe(N);
    const row = await withClient(db.url, async (c) =>
      (
        await c.query(
          `select overall, verdict, verdict_unknown_count, per_regulation_verdict, applied_permits
             from evidence_log where evidence_id = 'ev_before_0009'`,
        )
      ).rows[0],
    );
    expect(row).toEqual({
      overall: "green",
      verdict: null,
      verdict_unknown_count: null,
      per_regulation_verdict: null,
      applied_permits: null,
    });
  });

  it("2 つのランナーを同時に起動しても各ファイルは 1 回だけ適用される", async () => {
    const [a, b] = await Promise.all([migrate(), migrate()]);
    expect(a.code, a.stderr).toBe(0);
    expect(b.code, b.stderr).toBe(0);
    const appliedLines = (a.stdout + b.stdout).split("\n").filter((l) => l.startsWith("[db:migrate] 適用 "));
    expect(appliedLines).toHaveLength(N);
    expect(await countMigrations(db.url)).toBe(N);
  });

  it("適用後、postgis_full_version() と regulation_zones への ST_DWithin（geography）検索が成功する", async () => {
    expect((await migrate()).code).toBe(0);
    await withClient(db.url, async (c) => {
      const v = await c.query("select postgis_full_version() as v");
      expect(String(v.rows[0].v)).toMatch(/POSTGIS="3\./);
      await c.query(
        `insert into regulations (id, source, category, jurisdiction_code, authority, title, summary, clause_graph,
           confidence_geometric, confidence_extraction, verified_at)
         values ('31202-park-ordinance', '市町村', 'municipal_park', '31202', '米子市', '米子市都市公園条例', 'test',
           '{}'::jsonb, 'medium', 'medium', now())`,
      );
      await c.query(
        `insert into regulation_zones (id, regulation_id, kind, name, geom, buffer_m) values
          ('pt', '31202-park-ordinance', 'sensitive_buffer', '点', ST_GeogFromText('SRID=4326;POINT(133.3310 35.4280)'), 100),
          ('poly', '31202-park-ordinance', 'park_polygon', '多角形',
            ST_GeogFromText('SRID=4326;POLYGON((133.3320 35.4290, 133.3330 35.4290, 133.3330 35.4300, 133.3320 35.4300, 133.3320 35.4290))'), null)`,
      );
      const near = await c.query(
        `select id from regulation_zones
          where ST_DWithin(geom, ST_GeogFromText('SRID=4326;POINT(133.3312 35.4281)'), 250)
          order by id`,
      );
      expect(near.rows.map((r) => r.id)).toEqual(["poly", "pt"]);
      const far = await c.query(
        `select id from regulation_zones where ST_DWithin(geom, ST_GeogFromText('SRID=4326;POINT(133.40 35.50)'), 250)`,
      );
      expect(far.rows).toEqual([]);
    });
  });

  it("アプリ用ロール soraban_app は evidence_log に追加できるが、更新・削除はできない", async () => {
    // ロールはクラスター全体のもの。既にあれば作らず・消さず（使うのは使い捨て DB の中だけ）、
    // 無ければこのテストで作り、使い捨て DB を消した後に消す（共有の DB サーバーに痕跡を残さない）。
    const created = await withClient(ADMIN_URL!, async (c) => {
      const exists = (await c.query("select 1 from pg_roles where rolname = 'soraban_app'")).rowCount === 1;
      if (!exists) await c.query("create role soraban_app nologin");
      return !exists;
    });
    try {
      expect((await migrate()).code).toBe(0);
      await withClient(db.url, async (c) => {
        await c.query("set role soraban_app");
        await c.query(
          `insert into evidence_log (evidence_id, engine_version, checked_at, loc, overall, overall_confidence,
             regulation_ids, per_regulation_status)
           values ('ev_role_test', 'e', now(), ST_GeogFromText('SRID=4326;POINT(133.33 35.43)'), 'green', 'high', '{}', '{}')`,
        );
        // Sprint 11d（0009）：新しい列を含む insert ができる。verdict は 4 段の値だけ。
        await c.query(
          `insert into evidence_log (evidence_id, engine_version, checked_at, loc, overall, overall_confidence,
             regulation_ids, per_regulation_status, verdict, verdict_unknown_count, per_regulation_verdict, applied_permits)
           values ('ev_role_test_v', 'soraban-0.4.0-verdict-2026-10', now(), ST_GeogFromText('SRID=4326;POINT(133.33 35.43)'),
             'red', 'high', '{aviation-law-did}', '{"aviation-law-did":"red"}', 'procedure_done', 0,
             '{"aviation-law-did":"procedure_done"}', '{mlit:did}')`,
        );
        await expect(
          c.query(
            `insert into evidence_log (evidence_id, engine_version, checked_at, loc, overall, overall_confidence,
               regulation_ids, per_regulation_status, verdict)
             values ('ev_role_test_bad', 'e', now(), ST_GeogFromText('SRID=4326;POINT(133.33 35.43)'), 'green', 'high', '{}', '{}', 'flyable')`,
          ),
        ).rejects.toMatchObject({ code: "23514" });
        expect((await c.query("select count(*)::int as n from evidence_log")).rows[0].n).toBe(2);
        const old = (await c.query("select verdict, applied_permits from evidence_log where evidence_id = 'ev_role_test'")).rows[0];
        expect(old).toEqual({ verdict: null, applied_permits: null });
        expect((await c.query("select count(*)::int as n from schema_migrations")).rows[0].n).toBe(N);
        await expect(c.query("update evidence_log set verdict = 'no_fly'")).rejects.toMatchObject({ code: "42501" });
        await expect(c.query("update evidence_log set overall = 'red'")).rejects.toMatchObject({ code: "42501" });
        await expect(c.query("delete from evidence_log")).rejects.toMatchObject({ code: "42501" });
        await expect(c.query("insert into regulations (id) values ('x')")).rejects.toMatchObject({ code: "42501" });
      });
    } finally {
      if (created) {
        // 権限は使い捨て DB の中にしかないため、DB を消せばロールを消せる。
        await db.drop();
        await withClient(ADMIN_URL!, (c) => c.query("drop role if exists soraban_app"));
      }
    }
  });
});

