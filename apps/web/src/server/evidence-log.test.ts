// Sprint 8: 証跡の書き込みと /api/health/db の単体テスト（DB を使わない）。
import { createServer, type AddressInfo } from "node:net";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { closePool } from "@soraban/db";
import type { RegulationCheckResult } from "@soraban/regulations";
import { toEvidenceLogInsert, type WriteEvidence } from "./evidence-log";
import { handleCheckPost, type RunCheck } from "./handlers";
import { handleHealthDbGet } from "./health";

const RESULT: RegulationCheckResult = {
  overall: "yellow",
  overallConfidence: "medium",
  regulations: [
    {
      id: "aviation-law-did",
      status: "red",
      datasets: [{ id: "did-r2", name: "人口集中地区", baseYear: 2020, verifiedAt: "2026-10-19" }],
    },
    { id: "small-drone-law", status: "green", datasets: [] },
  ] as unknown as RegulationCheckResult["regulations"],
  checkedAt: "2026-10-19T00:00:00.000Z",
  resolvedAddress: "鳥取県米子市加茂町",
  muniCode: "31202",
  evidenceId: "ev_0123456789abcdef",
  engineVersion: "test-engine",
  disclaimer: "x",
};

const runCheck: RunCheck = async () => RESULT;

const post = () =>
  new Request("http://localhost/api/check", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ lat: 35.428, lng: 133.331 }),
  });

const snapshot = async (res: Response) => ({ status: res.status, body: await res.text() });

describe("/api/check の証跡書き込み（handleCheckPost）", () => {
  afterEach(() => vi.restoreAllMocks());

  it("書き込み関数が例外を投げても、応答の本文と状態コードは書き込みなしと同じ", async () => {
    const baseline = await snapshot(await handleCheckPost(post(), runCheck));
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const write = vi.fn<WriteEvidence>(async () => {
      throw Object.assign(new Error("connect ECONNREFUSED 10.0.0.1:5432 user=secret"), { code: "ECONNREFUSED" });
    });
    const tasks: Promise<void>[] = [];
    const res = await handleCheckPost(post(), runCheck, {
      writeEvidence: write,
      schedule: (t) => void tasks.push(t()),
      env: {},
    });
    expect(await snapshot(res)).toEqual(baseline);
    await Promise.all(tasks);
    expect(write).toHaveBeenCalledTimes(1);
    // 失敗はエラー種別とコードだけを 1 行出す（接続先・生メッセージを含めない）。
    expect(err).toHaveBeenCalledTimes(1);
    const line = String(err.mock.calls[0]![0]);
    expect(line).toBe("[evidence_log] write failed: Error code=ECONNREFUSED");
  });

  it("書き込み関数が同期的に例外を投げても応答は変わらない", async () => {
    const baseline = await snapshot(await handleCheckPost(post(), runCheck));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const write: WriteEvidence = () => {
      throw new Error("sync");
    };
    const res = await handleCheckPost(post(), runCheck, { writeEvidence: write, env: {} });
    expect(await snapshot(res)).toEqual(baseline);
  });

  it("書き込みが解決しなくても、応答は書き込みの完了を待たない", async () => {
    const baseline = await snapshot(await handleCheckPost(post(), runCheck));
    const write = vi.fn<WriteEvidence>(() => new Promise<void>(() => undefined));
    const res = await Promise.race([
      handleCheckPost(post(), runCheck, { writeEvidence: write, env: {} }),
      new Promise<"timeout">((r) => setTimeout(() => r("timeout"), 1_000)),
    ]);
    expect(res).not.toBe("timeout");
    expect(await snapshot(res as Response)).toEqual(baseline);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("書き込みは schedule（Next.js の after）経由で、応答後に実行される", async () => {
    const write = vi.fn<WriteEvidence>(async () => undefined);
    let scheduled: (() => Promise<void>) | undefined;
    await handleCheckPost(post(), runCheck, { writeEvidence: write, schedule: (t) => (scheduled = t), env: {} });
    expect(write).not.toHaveBeenCalled();
    await scheduled!();
    expect(write).toHaveBeenCalledWith(RESULT, { lat: 35.428, lng: 133.331 });
  });

  it("EVIDENCE_LOG=off のとき書き込み関数が呼ばれない", async () => {
    const write = vi.fn<WriteEvidence>(async () => undefined);
    const schedule = vi.fn();
    await handleCheckPost(post(), runCheck, { writeEvidence: write, schedule, env: { EVIDENCE_LOG: "off" } });
    await new Promise((r) => setTimeout(r, 10));
    expect(schedule).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it("不正な入力（400）では書き込まない", async () => {
    const write = vi.fn<WriteEvidence>(async () => undefined);
    const res = await handleCheckPost(
      new Request("http://localhost/api/check", { method: "POST", body: JSON.stringify({ lat: 999, lng: 0 }) }),
      runCheck,
      { writeEvidence: write, env: {} },
    );
    expect(res.status).toBe(400);
    expect(write).not.toHaveBeenCalled();
  });
});

describe("toEvidenceLogInsert", () => {
  it("判定結果から記録する値を組み立てる（UA・IP は持たない）", () => {
    const row = toEvidenceLogInsert(RESULT, { lat: 35.428, lng: 133.331 });
    expect(row).toEqual({
      evidenceId: "ev_0123456789abcdef",
      engineVersion: "test-engine",
      checkedAt: "2026-10-19T00:00:00.000Z",
      lat: 35.428,
      lng: 133.331,
      muniCode: "31202",
      resolvedAddress: "鳥取県米子市加茂町",
      overall: "yellow",
      overallConfidence: "medium",
      regulationIds: ["aviation-law-did", "small-drone-law"],
      perRegulationStatus: { "aviation-law-did": "red", "small-drone-law": "green" },
      datasets: [{ id: "did-r2", name: "人口集中地区", baseYear: 2020, verifiedAt: "2026-10-19" }],
    });
  });
});

describe("GET /api/health/db（handleHealthDbGet）", () => {
  afterAll(async () => {
    await closePool();
  });

  it("未設定なら DB に接続せず 200・configured: false", async () => {
    const res = await handleHealthDbGet({});
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ configured: false, reachable: false });
  });

  it("閉じたポートでも 6 秒以内に 200・reachable: false。接続情報を含めない", async () => {
    // 空いているポートを確保してすぐ閉じる（そのポートには誰も待ち受けていない）。
    const port = await new Promise<number>((resolve) => {
      const s = createServer();
      s.listen(0, "127.0.0.1", () => {
        const p = (s.address() as AddressInfo).port;
        s.close(() => resolve(p));
      });
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const url = `postgresql://soraban_role_x:pw_secret@127.0.0.1:${port}/soraban_db_x`;
    const started = Date.now();
    const res = await handleHealthDbGet({ DATABASE_URL: url });
    expect(Date.now() - started).toBeLessThan(6_000);
    expect(res.status).toBe(200);
    const text = await res.text();
    const json = JSON.parse(text) as Record<string, unknown>;
    expect(json).toMatchObject({ configured: true, reachable: false });
    for (const secret of [url, "127.0.0.1", String(port), "soraban_role_x", "pw_secret", "soraban_db_x", "ECONNREFUSED"]) {
      expect(text).not.toContain(secret);
    }
    expect(Object.keys(json).sort()).toEqual(
      [
        "configured",
        "hasPendingMigrations",
        "latencyMs",
        "latestAppliedMigration",
        "postgisVersion",
        "postgresMajorVersion",
        "reachable",
      ].sort(),
    );
  }, 10_000);
});
