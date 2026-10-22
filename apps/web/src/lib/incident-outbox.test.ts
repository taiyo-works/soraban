// Sprint 12e 契約 12（単体）：現場の簡易記録の端末の保存（送信待ち）。順序・二重防止・4xx を黙って捨てない・
// 個人情報を残さない・キーが soraban:ops-draft: の配下で他の利用者の分が消える・ログアウトの数え上げ。12c のモジュールは変えない。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyIncidentOutcome,
  countIncidentUnsentForMember,
  discardRejectedIncident,
  emptyIncidentOutbox,
  enqueueIncident,
  INCIDENT_OUTBOX_ALLOWED_KEYS,
  incidentOutboxKey,
  incidentRequestBody,
  incidentUnsentCount,
  isIncidentOutboxKey,
  loadIncidentOutbox,
  nextIncidentToSend,
  parseIncidentOutbox,
  planIdOfIncidentKey,
  rejectedIncidentEntries,
  saveIncidentOutbox,
  serializeIncidentOutbox,
  type IncidentOutboxEntry,
} from "./incident-outbox";
import { classifyResponse, isOutboxKey, type StorageLike } from "./ops-outbox";
import { clearOtherUsersDrafts } from "@/components/ops/drafts";
import {
  flushIncidentOutbox,
  incidentUnsentTotalForMember,
  loadPlanIncidentOutbox,
  planIdsWithIncidentOutbox,
  resetUnsavedIncidentOutboxForTest,
  updatePlanIncidentOutbox,
} from "@/components/ops/incident-outbox";

const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const PLAN = "11111111-1111-4111-8111-111111111111";
const PLAN2 = "22222222-2222-4222-8222-222222222222";
const base = (n: number, extra: Partial<IncidentOutboxEntry> = {}) =>
  ({ clientRequestId: id(n), kind: "accident", peopleInjury: "yes", occurredAt: "2027-01-05T12:00", ...extra }) as Pick<
    IncidentOutboxEntry,
    "clientRequestId" | "kind" | "peopleInjury" | "occurredAt"
  >;

class MemStorage implements StorageLike {
  private m = new Map<string, string>();
  failWrites = false;
  get length(): number {
    return this.m.size;
  }
  key(i: number): string | null {
    return [...this.m.keys()][i] ?? null;
  }
  getItem(k: string): string | null {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    if (this.failWrites) throw new Error("QuotaExceededError");
    this.m.set(k, v);
  }
  removeItem(k: string): void {
    this.m.delete(k);
  }
}

describe("簡易記録の送信待ち（純粋な規則）", () => {
  it("キーは soraban:ops-draft:incident-<計画>:<利用者>。12c の現場の記録のキーとは別（12c の isOutboxKey に当たらない）", () => {
    const k = incidentOutboxKey(PLAN, "m1");
    expect(k).toBe(`soraban:ops-draft:incident-${PLAN}:m1`);
    expect(k.startsWith("soraban:ops-draft:")).toBe(true);
    expect(isIncidentOutboxKey(k)).toBe(true);
    expect(isOutboxKey(k)).toBe(false);
    expect(planIdOfIncidentKey(k, "m1")).toBe(PLAN);
    expect(planIdOfIncidentKey(k, "m2")).toBeNull();
  });

  it("押した順に並び、同じ識別子は 1 件だけ。端末に残すのは区分・けがの有無・時刻・識別子だけ（氏名・座標・自由記述を落とす）", () => {
    let s = enqueueIncident(emptyIncidentOutbox(), base(1));
    s = enqueueIncident(s, base(2, { kind: "near_miss", peopleInjury: "no" }));
    s = enqueueIncident(s, base(1));
    expect(s.entries.map((e) => e.clientRequestId)).toEqual([id(1), id(2)]);
    const dirty = enqueueIncident(emptyIncidentOutbox(), {
      ...base(3),
      summary: "操縦 一郎が転倒",
      pilotName: "操縦 一郎",
      licenseNumber: "TEST-11112222",
      latitude: 35.4,
      longitude: 133.3,
    } as unknown as Parameters<typeof enqueueIncident>[1]);
    const text = serializeIncidentOutbox(dirty);
    expect(text).not.toMatch(/一郎|TEST-|35\.4|133\.3|summary|latitude|longitude|pilot/);
    for (const e of (JSON.parse(text) as { entries: Record<string, unknown>[] }).entries) {
      for (const k of Object.keys(e)) expect(INCIDENT_OUTBOX_ALLOWED_KEYS as readonly string[]).toContain(k);
    }
    // 壊れた行・知らない区分は読まない
    expect(parseIncidentOutbox('{"entries":[{"clientRequestId":"x","kind":"accident"}]}').entries).toEqual([]);
    expect(parseIncidentOutbox(JSON.stringify({ entries: [{ ...base(4), kind: "fatal" }] })).entries).toEqual([]);
    expect(parseIncidentOutbox("not json").entries).toEqual([]);
  });

  it("送信の本文は簡易記録の項目だけ。押した直後の最初の送信はその場（queued: false）、再試行・古い行は送信待ち（queued: true）", () => {
    const s = enqueueIncident(emptyIncidentOutbox(), base(1));
    const e = s.entries[0]!;
    const now = new Date("2027-01-05T12:00:30+09:00").getTime();
    expect(incidentRequestBody(PLAN, e, now)).toEqual({
      mode: "quick",
      kind: "accident",
      peopleInjury: "yes",
      occurredAt: "2027-01-05T12:00",
      planId: PLAN,
      clientRequestId: id(1),
      queued: false,
    });
    expect(incidentRequestBody(PLAN, e, now + 10 * 60_000)["queued"]).toBe(true);
    expect(incidentRequestBody(PLAN, { ...e, attempts: 1 }, now)["queued"]).toBe(true);
  });

  it("成功は消す・通信できない／5xx は残して止まる・4xx は理由つきで残し次へ進む。破棄は拒否の行だけ（未送信は黙って消さない）", () => {
    let s = enqueueIncident(enqueueIncident(emptyIncidentOutbox(), base(1)), base(2));
    s = applyIncidentOutcome(s, id(1), classifyResponse({ status: null }));
    expect(incidentUnsentCount(s)).toBe(2);
    expect(s.entries[0]!.attempts).toBe(1);
    s = applyIncidentOutcome(s, id(1), classifyResponse({ status: 503 }));
    expect(nextIncidentToSend(s)!.clientRequestId).toBe(id(1));
    s = applyIncidentOutcome(s, id(1), classifyResponse({ status: 400, code: "too_old" }));
    expect(rejectedIncidentEntries(s)).toHaveLength(1);
    expect(s.entries[0]!.rejection).toMatchObject({ code: "too_old" });
    expect(s.entries[0]!.rejection!.message).toContain("あとから入力");
    expect(nextIncidentToSend(s)!.clientRequestId).toBe(id(2));
    s = applyIncidentOutcome(s, id(2), classifyResponse({ status: 201 }));
    expect(incidentUnsentCount(s)).toBe(0);
    expect(discardRejectedIncident(enqueueIncident(s, base(3)), id(3)).entries).toHaveLength(2);
    expect(discardRejectedIncident(s, id(1)).entries).toHaveLength(0);
    // 再送で 200（既存を返した）も成功
    expect(classifyResponse({ status: 200 })).toEqual({ kind: "sent" });
    // 409 request_conflict は拒否（黙って捨てない）
    expect(classifyResponse({ status: 409, code: "request_conflict" })).toEqual({ kind: "reject", status: 409, code: "request_conflict" });
  });

  it("ログアウトの数え上げは、その利用者の分だけ（未送信と送れなかった行）。他の利用者の保存は clearOtherUsersDrafts が消す", () => {
    const st = new MemStorage();
    let s = enqueueIncident(enqueueIncident(emptyIncidentOutbox(), base(1)), base(2));
    s = applyIncidentOutcome(s, id(2), { kind: "reject", status: 400, code: "clock_skew" });
    saveIncidentOutbox(st, incidentOutboxKey(PLAN, "m1"), s);
    saveIncidentOutbox(st, incidentOutboxKey(PLAN, "m2"), enqueueIncident(emptyIncidentOutbox(), base(3)));
    expect(countIncidentUnsentForMember(st, "m1")).toEqual({ pending: 1, rejected: 1 });
    expect(countIncidentUnsentForMember(st, "m2")).toEqual({ pending: 1, rejected: 0 });
    const g = globalThis as unknown as { window?: unknown };
    const prev = g.window;
    g.window = { localStorage: st };
    try {
      clearOtherUsersDrafts("m1");
    } finally {
      g.window = prev;
    }
    expect(loadIncidentOutbox(st, incidentOutboxKey(PLAN, "m1")).entries).toHaveLength(2);
    expect(st.getItem(incidentOutboxKey(PLAN, "m2"))).toBeNull();
    // 空にしたら項目ごと消す
    saveIncidentOutbox(st, incidentOutboxKey(PLAN, "m1"), emptyIncidentOutbox());
    expect(st.getItem(incidentOutboxKey(PLAN, "m1"))).toBeNull();
  });
});

describe("簡易記録の送信待ち（ブラウザ側：順番に送る・二重にしない・保存できなければメモリ）", () => {
  let st: MemStorage;
  const g = globalThis as unknown as { window?: unknown };
  let prevWindow: unknown;

  beforeEach(() => {
    st = new MemStorage();
    prevWindow = g.window;
    g.window = { localStorage: st };
    resetUnsavedIncidentOutboxForTest();
  });
  afterEach(() => {
    g.window = prevWindow;
    vi.unstubAllGlobals();
  });

  it("押した順に自分のサーバーの API だけへ送る。503 の間は止まり、戻ると順に送って消える。送れた応答（記録の ID）を受け取れる", async () => {
    updatePlanIncidentOutbox(PLAN, "m1", (s) => enqueueIncident(enqueueIncident(s, base(1)), base(2)));
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    let fail = true;
    vi.stubGlobal("fetch", async (url: string, init: { body: string }) => {
      calls.push({ url, body: JSON.parse(init.body) as Record<string, unknown> });
      if (fail) return new Response("{}", { status: 503 });
      return new Response(JSON.stringify({ id: `rec-${calls.length}` }), { status: 201 });
    });
    const r1 = await flushIncidentOutbox(PLAN, "m1");
    expect(r1).toEqual({ sent: 0, rejected: 0, blocked: true });
    expect(calls.map((c) => c.body["clientRequestId"])).toEqual([id(1)]);
    expect(incidentUnsentCount(loadPlanIncidentOutbox(PLAN, "m1"))).toBe(2);
    fail = false;
    const got: string[] = [];
    const r2 = await flushIncidentOutbox(PLAN, "m1", (info) => got.push(String(info.data["id"])));
    expect(r2).toEqual({ sent: 2, rejected: 0, blocked: false });
    expect(calls.every((c) => c.url === "/api/ops/incidents")).toBe(true);
    expect(calls.slice(1).map((c) => c.body["clientRequestId"])).toEqual([id(1), id(2)]);
    expect(calls[1]!.body["queued"]).toBe(true);
    expect(got).toHaveLength(2);
    expect(st.getItem(incidentOutboxKey(PLAN, "m1"))).toBeNull();
  });

  it("4xx の行は理由つきで残り、後ろの行は止めない。ログアウトの数え上げに入る。計画の一覧が取れる", async () => {
    updatePlanIncidentOutbox(PLAN, "m1", (s) => enqueueIncident(enqueueIncident(s, base(1)), base(2)));
    updatePlanIncidentOutbox(PLAN2, "m1", (s) => enqueueIncident(s, base(3)));
    vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
      const b = JSON.parse(init.body) as Record<string, unknown>;
      return b["clientRequestId"] === id(1)
        ? new Response(JSON.stringify({ error: "too_old" }), { status: 400 })
        : new Response("{}", { status: 201 });
    });
    expect(new Set(planIdsWithIncidentOutbox("m1"))).toEqual(new Set([PLAN, PLAN2]));
    expect(incidentUnsentTotalForMember("m1")).toBe(3);
    const r = await flushIncidentOutbox(PLAN, "m1");
    expect(r).toEqual({ sent: 1, rejected: 1, blocked: false });
    const left = loadPlanIncidentOutbox(PLAN, "m1");
    expect(left.entries).toHaveLength(1);
    expect(left.entries[0]!.rejection?.code).toBe("too_old");
    expect(incidentUnsentTotalForMember("m1")).toBe(2);
  });

  it("端末に保存できなくても、押した記録はメモリに残って送られる（黙って失わない）", async () => {
    st.failWrites = true;
    updatePlanIncidentOutbox(PLAN, "m1", (s) => enqueueIncident(s, base(1)));
    expect(incidentUnsentCount(loadPlanIncidentOutbox(PLAN, "m1"))).toBe(1);
    expect(incidentUnsentTotalForMember("m1")).toBe(1);
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 201 }));
    await flushIncidentOutbox(PLAN, "m1");
    expect(incidentUnsentCount(loadPlanIncidentOutbox(PLAN, "m1"))).toBe(0);
  });
});
