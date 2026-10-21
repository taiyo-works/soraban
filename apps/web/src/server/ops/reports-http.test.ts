// Sprint 12b 契約 14・20（単体）：通報の API の入口。OPS_ENABLED が無効なら 404、設定の誤りは 503 adapter_unavailable、
// 変更を伴う要求は Origin を確かめる。DB は使わない。
import { describe, expect, it } from "vitest";
import type { MemberRow } from "@soraban/db";
import * as h from "./handlers";
import type { OpsDeps } from "./http";
import type { OpsDb } from "./store";
import { handleHealthDbGet } from "../health";

const MANAGER: MemberRow = {
  id: "00000000-0000-4000-8000-000000000001",
  org_id: "00000000-0000-4000-8000-0000000000aa",
  email: "boss@example.com",
  display_name: "ボス",
  role: "manager",
  status: "active",
  auth_provider: "test",
  auth_user_id: "boss",
  current_version: 2,
  created_at: "2026-12-07T00:00:00Z",
  updated_at: "2026-12-07T00:00:00Z",
  voided_at: null,
};
const fakeDb = (): OpsDb => ({
  query: (async (sql: string) =>
    sql.includes("from members where auth_provider") ? { rows: [MANAGER], rowCount: 1 } : { rows: [], rowCount: 0 }) as OpsDb["query"],
  connect: async () => {
    throw new Error("not used");
  },
});
const ENABLED = { OPS_ENABLED: "1", DATABASE_URL: "postgresql://x", AUTH_PROVIDER: "test", AUTH_TEST_SECRET: "s" };
const deps = (env: Record<string, string | undefined>): OpsDeps => ({
  env,
  getIdentity: async () => ({ provider: "test", authUserId: "boss", email: "boss@example.com", emailVerified: true, name: "ボス" }),
  getDb: fakeDb,
});
const PID = "11111111-1111-4111-8111-111111111111";
const req = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://127.0.0.1${path}`, {
    method,
    headers: { host: "127.0.0.1", origin: "http://127.0.0.1", "content-type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

type Handler = (r: Request, p: Record<string, string>, d?: OpsDeps) => Promise<Response>;
const ROUTES: [string, Handler, string, string][] = [
  ["GET report", h.planReportGet as Handler, "GET", `/api/ops/plans/${PID}/report`],
  ["POST report", h.planReportPreview as Handler, "POST", `/api/ops/plans/${PID}/report`],
  ["POST reports", h.reportCreate as Handler, "POST", `/api/ops/plans/${PID}/reports`],
  ["PATCH reports/[rid]", h.reportCorrect as Handler, "PATCH", `/api/ops/plans/${PID}/reports/${PID}`],
  ["POST retract", h.reportRetract as Handler, "POST", `/api/ops/plans/${PID}/reports/${PID}/retract`],
  ["POST resolve", h.reportResolve as Handler, "POST", `/api/ops/plans/${PID}/reports/${PID}/resolve`],
  ["POST retry", h.reportRetry as Handler, "POST", `/api/ops/plans/${PID}/reports/${PID}/retry`],
  ["GET versions", h.reportVersions as Handler, "GET", `/api/ops/plans/${PID}/reports/${PID}/versions`],
  ["POST audit", h.reportCopyAudit as Handler, "POST", `/api/ops/plans/${PID}/reports/audit`],
  ["GET procedure-records", h.procedureRecordList as Handler, "GET", `/api/ops/plans/${PID}/procedure-records`],
  ["POST procedure-records", h.procedureRecordCreate as Handler, "POST", `/api/ops/plans/${PID}/procedure-records`],
];

describe("通報の API の入口", () => {
  for (const [name, handler, method, path] of ROUTES) {
    it(`${name}：OPS_ENABLED が無効なら 404（通常の判定の画面は変わらない）。設定不足なら 503`, async () => {
      const off = await handler(req(method, path, method === "GET" ? undefined : {}), { id: PID, rid: PID }, deps({}));
      expect(off.status).toBe(404);
      expect(await off.json()).toEqual({ error: "not_found" });
      const bad = await handler(req(method, path, method === "GET" ? undefined : {}), { id: PID, rid: PID }, deps({ OPS_ENABLED: "1" }));
      expect(bad.status).toBe(503);
      expect((await bad.json()).error).toBe("ops_unavailable");
    });
  }

  it("変更を伴う要求は、他サイトの Origin なら 403（コピーの監査・記録・手続きの記録など）", async () => {
    for (const [name, handler, method, path] of ROUTES.filter((r) => r[2] !== "GET")) {
      const res = await handler(req(method, path, {}, { origin: "http://evil.example" }), { id: PID, rid: PID }, deps(ENABLED));
      if (name === "POST report") expect(res.status, name).not.toBe(403); // プレビューは保存しない
      else expect(res.status, name).toBe(403);
    }
  });

  it("DIPS_REPORT_ADAPTER が api・未知の値・本番/プレビューの mock なら、通報の API は 503 adapter_unavailable（理由コードだけ）", async () => {
    const cases: [Record<string, string>, string][] = [
      [{ DIPS_REPORT_ADAPTER: "api" }, "api_not_implemented"],
      [{ DIPS_REPORT_ADAPTER: "relay" }, "unknown_adapter"],
      [{ DIPS_REPORT_ADAPTER: "mock", VERCEL_ENV: "production" }, "mock_forbidden_on_vercel"],
      [{ DIPS_REPORT_ADAPTER: "mock", VERCEL_ENV: "preview" }, "mock_forbidden_on_vercel"],
    ];
    for (const [extra, reason] of cases) {
      // VERCEL_ENV があると test 方式の本人確認は使えないため、neon の設定で可否を通す
      const env = { OPS_ENABLED: "1", DATABASE_URL: "postgresql://x", AUTH_PROVIDER: "neon", NEON_AUTH_BASE_URL: "https://auth.example", NEON_AUTH_COOKIE_SECRET: "x".repeat(40), ...extra };
      for (const [name, handler, method, path] of ROUTES.filter((r) => ["GET report", "POST report", "POST reports"].includes(r[0]))) {
        const res = await handler(req(method, path, method === "GET" ? undefined : { kind: "new", expectedPlanVersion: 1 }), { id: PID }, deps(env));
        expect(res.status, `${name} ${reason}`).toBe(503);
        const body = await res.json();
        expect(body.error).toBe("adapter_unavailable");
        expect(body.codes).toEqual({ adapter: reason });
        expect(JSON.stringify(body)).not.toContain("postgresql://");
      }
    }
  });
});

describe("GET /api/health/db：通報ゲートウェイの設定", () => {
  it("設定が誤りなら 503 と理由コードを返す（値は返さない）。正しい・未設定なら 200", async () => {
    for (const [env, reason] of [
      [{ DIPS_REPORT_ADAPTER: "api" }, "api_not_implemented"],
      [{ DIPS_REPORT_ADAPTER: "zzz" }, "unknown_adapter"],
      [{ DIPS_REPORT_ADAPTER: "mock", VERCEL_ENV: "production" }, "mock_forbidden_on_vercel"],
      [{ DIPS_REPORT_ADAPTER: "mock", VERCEL_ENV: "preview" }, "mock_forbidden_on_vercel"],
    ] as const) {
      const res = await handleHealthDbGet(env);
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.dips).toEqual({ ok: false, error: "adapter_unavailable", reason });
      expect(JSON.stringify(body)).not.toContain("zzz");
    }
    for (const env of [{}, { DIPS_REPORT_ADAPTER: "manual" }, { DIPS_REPORT_ADAPTER: "mock" }, { DIPS_REPORT_ADAPTER: "mock", VERCEL_ENV: "development" }]) {
      const res = await handleHealthDbGet(env);
      expect(res.status).toBe(200);
      expect((await res.json()).dips).toBeUndefined();
    }
  });
});
