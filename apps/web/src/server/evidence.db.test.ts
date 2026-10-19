// Sprint 8 契約 E・F の DB テスト（pnpm test:db）。
// - /api/health/db が適用済みの DB で reachable: true・最新版・未適用なしを返す。
// - 証跡の書き込み関数が evidence_log に 1 行書く（重複は無視）。
// - next start（ビルド済み）に DATABASE_URL を渡し、/api/check の応答後に evidence_log に行ができる。
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closePool, LATEST_MIGRATION_VERSION } from "@soraban/db";
import { YONAGO_CITY_HALL } from "@soraban/geo";
import type { RegulationCheckResult } from "@soraban/regulations";
import { createTempDatabase, REPO_ROOT, runCli, withClient, type TempDatabase } from "../../../../packages/db/src/test-db-helpers";
import { resolveTestDatabaseUrl } from "../../../../packages/db/src/test-db-env";
import { collectDatasets } from "./check-core";
import { dbEvidenceWriter } from "./evidence-log";
import { handleHealthDbGet } from "./health";

const ADMIN_URL = resolveTestDatabaseUrl();
const WEB_DIR = path.join(REPO_ROOT, "apps", "web");
const NEXT_PORT = Number(process.env["DB_TEST_NEXT_PORT"] ?? 3200);

describe.skipIf(!ADMIN_URL)("DB 接続確認と証跡の記録（DB）", () => {
  let db: TempDatabase;

  beforeAll(async () => {
    db = await createTempDatabase(ADMIN_URL!);
    const r = await runCli(["migrate"], { DATABASE_URL_UNPOOLED: db.url });
    expect(r.code, r.stderr).toBe(0);
  });

  afterAll(async () => {
    await closePool();
    await db?.drop();
  });

  it("GET /api/health/db: reachable: true、PostgreSQL のメジャー版、PostGIS の版、最新版、未適用なし", async () => {
    const res = await handleHealthDbGet({ DATABASE_URL: db.url });
    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json).toMatchObject({
      configured: true,
      reachable: true,
      latestAppliedMigration: LATEST_MIGRATION_VERSION,
      hasPendingMigrations: false,
    });
    expect(json["postgresMajorVersion"]).toEqual(expect.any(Number));
    expect(json["postgresMajorVersion"] as number).toBeGreaterThanOrEqual(16);
    expect(json["postgisVersion"]).toMatch(/^3\./);
    expect(json["latencyMs"]).toEqual(expect.any(Number));
    if (process.env["EXPECT_PG_MAJOR"]) {
      expect(json["postgresMajorVersion"]).toBe(Number(process.env["EXPECT_PG_MAJOR"]));
    }
  });

  it("証跡の書き込み関数が 1 行書き、同じ evidence_id は無視する。client_user_agent は NULL", async () => {
    const write = dbEvidenceWriter({ DATABASE_URL: db.url })!;
    const result = {
      overall: "red",
      overallConfidence: "medium",
      regulations: [
        { id: "aviation-law-did", status: "red", datasets: [{ id: "did-r2", name: "DID", baseYear: 2020, verifiedAt: "2026-10-19" }] },
      ],
      checkedAt: "2026-10-19T01:02:03.000Z",
      muniCode: "31202",
      resolvedAddress: "加茂町",
      evidenceId: "ev_writer_test_0001",
      engineVersion: "test-engine",
      disclaimer: "",
    } as unknown as RegulationCheckResult;
    await write(result, YONAGO_CITY_HALL);
    await write(result, YONAGO_CITY_HALL);
    const rows = await withClient(db.url, async (c) =>
      (
        await c.query(
          `select evidence_id, engine_version, regulation_ids, per_regulation_status, datasets, client_user_agent,
                  ST_Y(loc::geometry) as lat, ST_X(loc::geometry) as lng
             from evidence_log where evidence_id = 'ev_writer_test_0001'`,
        )
      ).rows,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      engine_version: "test-engine",
      regulation_ids: ["aviation-law-did"],
      per_regulation_status: { "aviation-law-did": "red" },
      datasets: [{ id: "did-r2", name: "DID", baseYear: 2020, verifiedAt: "2026-10-19" }],
      client_user_agent: null,
    });
    expect(rows[0].lat).toBeCloseTo(YONAGO_CITY_HALL.lat, 6);
    expect(rows[0].lng).toBeCloseTo(YONAGO_CITY_HALL.lng, 6);
  });

  describe("next start に DATABASE_URL を渡した /api/check", () => {
    const buildId = path.join(WEB_DIR, ".next", "BUILD_ID");
    let server: ChildProcess | undefined;

    beforeAll(async () => {
      if (!existsSync(buildId)) {
        throw new Error("apps/web のビルドがありません。先に pnpm build を実行してください。");
      }
      server = spawn(
        path.join(REPO_ROOT, "node_modules", ".bin", "next"),
        ["start", "-p", String(NEXT_PORT), "-H", "127.0.0.1"],
        {
          cwd: WEB_DIR,
          env: { ...process.env, DATABASE_URL: db.url, EVIDENCE_LOG: "", NEXT_DIST_DIR: "" },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      server.stdout?.resume();
      server.stderr?.on("data", (d: Buffer) => process.stderr.write(`[next] ${d.toString()}`));
      const deadline = Date.now() + 90_000;
      for (;;) {
        try {
          const r = await fetch(`http://127.0.0.1:${NEXT_PORT}/api/health/db`);
          if (r.ok) break;
        } catch {
          // 起動待ち
        }
        if (Date.now() > deadline) throw new Error("next start が起動しません");
        await new Promise((r) => setTimeout(r, 500));
      }
    });

    afterAll(async () => {
      if (server && server.exitCode === null) {
        const exited = new Promise((r) => server!.once("exit", r));
        server.kill("SIGTERM");
        await exited;
      }
    });

    it("/api/health/db は reachable: true、最新版", async () => {
      const r = await fetch(`http://127.0.0.1:${NEXT_PORT}/api/health/db`);
      expect(r.status).toBe(200);
      const text = await r.text();
      expect(JSON.parse(text)).toMatchObject({ configured: true, reachable: true, latestAppliedMigration: LATEST_MIGRATION_VERSION });
      expect(text).not.toContain(db.name);
    });

    it("米子市役所の座標を送ると、応答の evidenceId の行が 5 秒以内に evidence_log にでき、値が応答と一致する", async () => {
      const res = await fetch(`http://127.0.0.1:${NEXT_PORT}/api/check`, {
        method: "POST",
        headers: { "content-type": "application/json", "user-agent": "soraban-db-test/1.0" },
        body: JSON.stringify(YONAGO_CITY_HALL),
      });
      expect(res.status).toBe(200);
      const json = (await res.json()) as RegulationCheckResult;
      const sent = Date.now();
      let row: Record<string, unknown> | undefined;
      while (Date.now() - sent < 5_000) {
        row = await withClient(db.url, async (c) =>
          (
            await c.query(
              "select engine_version, regulation_ids, datasets, client_user_agent, muni_code from evidence_log where evidence_id = $1",
              [json.evidenceId],
            )
          ).rows[0],
        );
        if (row) break;
        await new Promise((r) => setTimeout(r, 200));
      }
      expect(row, "5 秒以内に evidence_log の行ができない").toBeDefined();
      expect(row!["engine_version"]).toBe(json.engineVersion);
      expect(row!["regulation_ids"]).toEqual(json.regulations.map((r) => r.id));
      const expectedDatasets = collectDatasets(json.regulations).map(({ id, name, baseYear, verifiedAt }) => ({
        id,
        name,
        baseYear,
        verifiedAt,
      }));
      expect(expectedDatasets.length).toBeGreaterThanOrEqual(1);
      expect(row!["datasets"]).toEqual(expectedDatasets);
      expect(row!["client_user_agent"]).toBeNull();
      expect(row!["muni_code"] ?? null).toBe(json.muniCode ?? null);
    });
  });
});
