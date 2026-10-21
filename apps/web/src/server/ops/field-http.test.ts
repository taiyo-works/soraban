// Sprint 12c 契約 17（単体）：今日・現場モードの API の入口。OPS_ENABLED が無効なら 404（通常の判定の画面は変わらない）、
// 設定不足は 503、未ログインは 401、変更を伴う要求は他サイトの Origin なら 403。DB は使わない。
import { describe, expect, it } from "vitest";
import type { MemberRow } from "@soraban/db";
import * as h from "./handlers";
import type { OpsDeps } from "./http";
import type { OpsDb } from "./store";

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
const deps = (env: Record<string, string | undefined>, signedIn = true): OpsDeps => ({
  env,
  getIdentity: async () => (signedIn ? { provider: "test", authUserId: "boss", email: "boss@example.com", emailVerified: true, name: "ボス" } : null),
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
  ["GET today", h.todayGet as Handler, "GET", "/api/ops/today"],
  ["GET field", h.planFieldGet as Handler, "GET", `/api/ops/plans/${PID}/field`],
  ["GET field-events", h.planFieldEventsList as Handler, "GET", `/api/ops/plans/${PID}/field-events`],
  ["POST field-events", h.planFieldEventCreate as Handler, "POST", `/api/ops/plans/${PID}/field-events`],
];

describe("今日・現場モードの API の入口", () => {
  for (const [name, handler, method, path] of ROUTES) {
    it(`${name}：OPS_ENABLED が無効なら 404。設定不足なら 503。未ログインは 401`, async () => {
      const body = method === "GET" ? undefined : {};
      const off = await handler(req(method, path, body), { id: PID }, deps({}));
      expect(off.status).toBe(404);
      expect(await off.json()).toEqual({ error: "not_found" });
      const bad = await handler(req(method, path, body), { id: PID }, deps({ OPS_ENABLED: "1" }));
      expect(bad.status).toBe(503);
      expect((await bad.json()).error).toBe("ops_unavailable");
      const anon = await handler(req(method, path, body), { id: PID }, deps(ENABLED, false));
      expect(anon.status).toBe(401);
    });
  }

  it("POST field-events：他サイトの Origin なら 403。応答は no-store", async () => {
    const res = await h.planFieldEventCreate(req("POST", `/api/ops/plans/${PID}/field-events`, {}, { origin: "http://evil.example" }), { id: PID }, deps(ENABLED));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden_origin" });
    const ok = await h.todayGet(req("GET", "/api/ops/today"), {}, deps(ENABLED, false));
    expect(ok.headers.get("cache-control")).toBe("no-store");
  });

  it("存在しない計画は 404、本文が壊れていれば 400（DB は空）", async () => {
    const notFound = await h.planFieldGet(req("GET", `/api/ops/plans/${PID}/field`), { id: PID }, deps(ENABLED));
    expect(notFound.status).toBe(404);
    const badJson = new Request(`http://127.0.0.1/api/ops/plans/${PID}/field-events`, {
      method: "POST",
      headers: { host: "127.0.0.1", origin: "http://127.0.0.1", "content-type": "application/json" },
      body: "{broken",
    });
    expect((await h.planFieldEventCreate(badJson, { id: PID }, deps(ENABLED))).status).toBe(400);
  });
});
