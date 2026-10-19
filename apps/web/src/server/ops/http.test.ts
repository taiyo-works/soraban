// Sprint 10 契約 19（単体）：運航管理の API がエラーを記録する際のログに、要求本文のメールアドレス・氏名・技能証明書番号が含まれない。
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MemberRow } from "@soraban/db";
import { opsHandler, type OpsDeps } from "./http";
import type { OpsDb } from "./store";

afterEach(() => vi.restoreAllMocks());

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

describe("運航管理の API のエラーログ", () => {
  it("処理中の例外（本文の値をメッセージ・detail に含む）を記録しても、本文の個人情報はログに出ない", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const body = { fullName: "山田 太郎", email: "taro.yamada@example.com", licenseNumber: "AB-98765432" };
    const handler = opsHandler(
      "POST /api/ops/pilots",
      async ({ body: read }) => {
        const b = (await read()) as typeof body;
        // pg の一意制約違反のように、値を含むメッセージ・detail を持つ例外
        throw Object.assign(new Error(`duplicate ${b.fullName} ${b.email} ${b.licenseNumber}`), {
          code: "XX000",
          detail: `Key (email)=(${b.email}) ${b.licenseNumber}`,
        });
      },
      { mutating: true },
    );
    const deps: OpsDeps = {
      env: { OPS_ENABLED: "1", DATABASE_URL: "postgresql://x", AUTH_PROVIDER: "test", AUTH_TEST_SECRET: "s" },
      getIdentity: async () => ({ provider: "test", authUserId: "boss", email: "boss@example.com", emailVerified: true, name: "ボス" }),
      getDb: fakeDb,
    };
    const res = await handler(
      new Request("http://127.0.0.1/api/ops/pilots", {
        method: "POST",
        headers: { host: "127.0.0.1", origin: "http://127.0.0.1", "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      {},
      deps,
    );
    expect(res.status).toBe(500);
    const text = await res.text();
    const logged = spy.mock.calls.flat().map(String).join("\n");
    expect(logged).toContain("POST /api/ops/pilots");
    expect(logged).toContain("XX000");
    for (const v of [body.fullName, "山田", body.email, body.licenseNumber, "98765432"]) {
      expect(logged).not.toContain(v);
      expect(text).not.toContain(v);
    }
  });

  // Sprint 11 契約 20：飛行記録の要求本文の氏名・技能証明書番号・緯度経度・場所名もログに出ない。
  it("飛行記録の作成で例外が起きても、本文の氏名・技能証明書番号・緯度経度・場所名はログと応答に出ない", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const body = {
      pilotName: "鳥取 花子",
      pilotLicenseNumber: "XY-24681357",
      takeoffPlace: "日吉津村役場前広場",
      takeoffLat: 35.443211,
      takeoffLng: 133.381234,
    };
    const handler = opsHandler(
      "POST /api/ops/flights",
      async ({ body: read }) => {
        const b = (await read()) as typeof body;
        throw Object.assign(new Error(`overlap ${b.pilotName} ${b.takeoffPlace} ${b.takeoffLat},${b.takeoffLng}`), {
          code: "XX000",
          detail: `Failing row contains (${b.pilotName}, ${b.pilotLicenseNumber}, ${b.takeoffPlace}, ${b.takeoffLat}, ${b.takeoffLng})`,
        });
      },
      { mutating: true },
    );
    const deps: OpsDeps = {
      env: { OPS_ENABLED: "1", DATABASE_URL: "postgresql://x", AUTH_PROVIDER: "test", AUTH_TEST_SECRET: "s" },
      getIdentity: async () => ({ provider: "test", authUserId: "boss", email: "boss@example.com", emailVerified: true, name: "ボス" }),
      getDb: fakeDb,
    };
    const res = await handler(
      new Request("http://127.0.0.1/api/ops/flights", {
        method: "POST",
        headers: { host: "127.0.0.1", origin: "http://127.0.0.1", "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      {},
      deps,
    );
    expect(res.status).toBe(500);
    const text = await res.text();
    const logged = spy.mock.calls.flat().map(String).join("\n");
    expect(logged).toContain("POST /api/ops/flights");
    for (const v of [body.pilotName, "鳥取", body.pilotLicenseNumber, "24681357", body.takeoffPlace, "日吉津", "35.443211", "133.381234"]) {
      expect(logged).not.toContain(v);
      expect(text).not.toContain(v);
    }
  });
});
