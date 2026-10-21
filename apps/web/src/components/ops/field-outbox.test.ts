import { afterEach, describe, expect, it, vi } from "vitest";
import type { OutboxEntry } from "@/lib/ops-outbox";
import { requestBodyFor } from "./field-outbox";

const entry = (over: Partial<OutboxEntry> = {}): OutboxEntry => ({
  clientEventId: "11111111-1111-4111-8111-111111111111",
  kind: "takeoff",
  occurredAt: "2027-01-05T12:00",
  status: "pending",
  attempts: 0,
  ...over,
});
const at = (hm: string) => new Date(`2027-01-05T${hm}:00+09:00`).getTime();

describe("requestBodyFor：その場の送信か、送信待ちを経由したものか", () => {
  it("押してすぐの最初の送信は queued: false（端末の時計のずれをサーバーが検査する）", () => {
    expect(requestBodyFor(entry(), at("12:00"))["queued"]).toBe(false);
    expect(requestBodyFor(entry(), at("12:01"))["queued"]).toBe(false);
    expect(requestBodyFor(entry(), at("12:02"))["queued"]).toBe(false);
  });
  it("再試行の行・押してから 2 分を超えた行は queued: true（72 時間まで受ける）", () => {
    expect(requestBodyFor(entry({ attempts: 1 }), at("12:00"))["queued"]).toBe(true);
    expect(requestBodyFor(entry(), at("12:03"))["queued"]).toBe(true);
    expect(requestBodyFor(entry(), at("20:00"))["queued"]).toBe(true);
  });
  it("本文は種別・識別子・時刻・対象だけ（氏名・座標・自由記述を含まない）", () => {
    const body = requestBodyFor(
      entry({ kind: "landing", targetClientEventId: "22222222-2222-4222-8222-222222222222" }),
      at("12:00"),
    );
    expect(Object.keys(body).sort()).toEqual(["clientEventId", "kind", "occurredAt", "queued", "targetClientEventId"]);
  });
});

describe("端末に保存できないとき：送信待ちをメモリに残し、黙って失わない", () => {
  const PLAN = "33333333-3333-4333-8333-333333333333";
  const MEMBER = "m1";
  const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;

  const setup = async (kind: "throws" | "none") => {
    vi.resetModules();
    const store = new Map<string, string>();
    const ls = {
      get length() {
        return store.size;
      },
      key: (i: number) => [...store.keys()][i] ?? null,
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        if (kind === "throws") throw new Error("QuotaExceededError");
        store.set(k, v);
      },
      removeItem: (k: string) => void store.delete(k),
    };
    vi.stubGlobal("window", kind === "none" ? { get localStorage(): never { throw new Error("denied"); } } : { localStorage: ls });
    const mod = await import("./field-outbox");
    const ob = await import("@/lib/ops-outbox");
    return { mod, ob, store };
  };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  for (const kind of ["throws", "none"] as const) {
    describe(kind === "throws" ? "setItem が例外を投げる" : "localStorage が使えない", () => {
      it("(a)(b) 押した行がメモリに残り、読め、保存できていない印が立つ", async () => {
        const { mod, ob, store } = await setup(kind);
        mod.updatePlanOutbox(PLAN, MEMBER, (s) => ob.enqueue(s, { clientEventId: id(1), kind: "takeoff", occurredAt: "2027-01-05T12:00" }));
        expect(mod.planOutboxUnsaved(PLAN, MEMBER)).toBe(true);
        expect(mod.loadPlanOutbox(PLAN, MEMBER).entries.map((e) => e.clientEventId)).toEqual([id(1)]);
        expect(mod.planIdsWithOutbox(MEMBER)).toEqual([PLAN]);
        expect(mod.unsavedUnsentCountForMember(MEMBER)).toBe(1);
        expect(mod.unsavedUnsentCountForMember("other")).toBe(0);
        expect(store.size).toBe(0);
      });

      it("(c) 送信が成功すると行が消え、印も戻る", async () => {
        const { mod, ob } = await setup(kind);
        mod.updatePlanOutbox(PLAN, MEMBER, (s) => ob.enqueue(s, { clientEventId: id(1), kind: "takeoff", occurredAt: "2027-01-05T12:00" }));
        const fetchMock = vi.fn(async () => new Response(JSON.stringify({}), { status: 201 }));
        vi.stubGlobal("fetch", fetchMock);
        const r = await mod.flushOutbox(PLAN, MEMBER);
        expect(r.sent).toBe(1);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(mod.planOutboxUnsaved(PLAN, MEMBER)).toBe(false);
        expect(mod.loadPlanOutbox(PLAN, MEMBER).entries).toEqual([]);
        expect(mod.unsavedUnsentCountForMember(MEMBER)).toBe(0);
      });

      it("(d) 通信できないあいだは行が残り、順序を守る。戻ると押した順に送る", async () => {
        const { mod, ob } = await setup(kind);
        for (const n of [1, 2]) {
          mod.updatePlanOutbox(PLAN, MEMBER, (s) =>
            ob.enqueue(s, { clientEventId: id(n), kind: "check", occurredAt: `2027-01-05T12:0${n}`, checkItem: "carry", checkResult: "ok" } as never),
          );
        }
        vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("offline"))));
        const r1 = await mod.flushOutbox(PLAN, MEMBER);
        expect(r1).toMatchObject({ sent: 0, blocked: true });
        expect(mod.planOutboxUnsaved(PLAN, MEMBER)).toBe(true);
        expect(mod.loadPlanOutbox(PLAN, MEMBER).entries.map((e) => e.clientEventId)).toEqual([id(1), id(2)]);

        const sentIds: string[] = [];
        vi.stubGlobal(
          "fetch",
          vi.fn(async (_u: string, init: { body: string }) => {
            sentIds.push((JSON.parse(init.body) as { clientEventId: string }).clientEventId);
            return new Response("{}", { status: 201 });
          }),
        );
        const r2 = await mod.flushOutbox(PLAN, MEMBER);
        expect(r2.sent).toBe(2);
        expect(sentIds).toEqual([id(1), id(2)]);
        expect(mod.planOutboxUnsaved(PLAN, MEMBER)).toBe(false);
      });
    });
  }

  it("保存できるときはメモリを使わない（印は立たない）", async () => {
    const { mod, ob, store } = await setup("throws");
    vi.unstubAllGlobals();
    const mem = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        get length() {
          return mem.size;
        },
        key: (i: number) => [...mem.keys()][i] ?? null,
        getItem: (k: string) => mem.get(k) ?? null,
        setItem: (k: string, v: string) => void mem.set(k, v),
        removeItem: (k: string) => void mem.delete(k),
      },
    });
    mod.updatePlanOutbox(PLAN, MEMBER, (s) => ob.enqueue(s, { clientEventId: id(1), kind: "takeoff", occurredAt: "2027-01-05T12:00" }));
    expect(mod.planOutboxUnsaved(PLAN, MEMBER)).toBe(false);
    expect(mem.size).toBe(1);
    expect(store.size).toBe(0);
  });
});
