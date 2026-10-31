// Sprint 12c 契約 13（単体）：端末の保存（送信待ち）の規則。順序・二重防止・4xx を黙って捨てない・ログアウトの警告・個人情報を残さない。
import { describe, expect, it } from "vitest";
import {
  applyOutcome,
  classifyResponse,
  clearOtherUsersOutbox,
  countUnsentForMember,
  discardRejected,
  drainOutbox,
  emptyOutbox,
  enqueue,
  isOutboxKey,
  loadOutbox,
  logoutGuard,
  nextToSend,
  outboxKey,
  parseOutbox,
  recoverFlightFromOutbox,
  rejectedCount,
  saveOutbox,
  serializeOutbox,
  toRequestBody,
  unsentCount,
  type OutboxEntry,
  type OutboxState,
  type StorageLike,
} from "./ops-outbox";
import { clearOtherUsersDrafts } from "@/components/ops/drafts";

const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const base = (n: number, kind: OutboxEntry["kind"] = "takeoff", extra: Partial<OutboxEntry> = {}) =>
  ({ clientEventId: id(n), kind, occurredAt: "2027-01-05T13:00", ...extra }) as Omit<OutboxEntry, "status" | "attempts">;

class MemStorage implements StorageLike {
  private m = new Map<string, string>();
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
    this.m.set(k, v);
  }
  removeItem(k: string): void {
    this.m.delete(k);
  }
}

describe("キーと保存", () => {
  it("キーは計画ごと・利用者ごと（drafts.ts の流儀）。末尾が利用者の ID", () => {
    expect(outboxKey("plan1", "mem1")).toBe("soraban:ops-draft:field-plan1:mem1");
    expect(isOutboxKey(outboxKey("a", "b"))).toBe(true);
    expect(isOutboxKey("soraban:ops-draft:flight:mem1")).toBe(false);
  });

  it("保存→読み込みで同じ。空にすると項目が消える。壊れた保存は空として読む", () => {
    const st = new MemStorage();
    const key = outboxKey("p", "m");
    let box = enqueue(emptyOutbox(), base(1));
    box = enqueue(box, base(2, "landing", { targetClientEventId: id(1) }));
    expect(saveOutbox(st, key, box)).toBe(true);
    expect(loadOutbox(st, key).entries.map((e) => e.clientEventId)).toEqual([id(1), id(2)]);
    expect(saveOutbox(st, key, emptyOutbox())).toBe(true);
    expect(st.getItem(key)).toBeNull();
    st.setItem(key, "{broken");
    expect(loadOutbox(st, key)).toEqual(emptyOutbox());
    st.setItem(key, JSON.stringify({ entries: "x" }));
    expect(loadOutbox(st, key)).toEqual(emptyOutbox());
  });

  it("保存できない環境（容量超過）では false を返し、例外にしない", () => {
    const st = new MemStorage();
    st.setItem = () => {
      throw new Error("QuotaExceededError");
    };
    expect(saveOutbox(st, "k", enqueue(emptyOutbox(), base(1)))).toBe(false);
  });

  it("端末に残る内容に、氏名・技能証明書番号・座標・自由記述が紛れ込んでも保存しない（許す項目だけ）", () => {
    const dirty = {
      ...base(1, "check", { item: "emergency_airspace", result: "not_designated", source: "mlit-emergency-airspace-qa" }),
      pilotName: "操縦 一郎",
      licenseNumber: "TEST-11112222",
      latitude: 35.434238,
      longitude: 133.380508,
      note: "自由記述",
      memberName: "運航 管理子",
    };
    const box = enqueue(emptyOutbox(), dirty as never);
    const text = serializeOutbox(box);
    for (const w of ["操縦 一郎", "TEST-11112222", "35.434238", "133.380508", "自由記述", "運航 管理子", "latitude", "licenseNumber", "pilotName"]) {
      expect(text, w).not.toContain(w);
    }
    expect(JSON.parse(text).entries[0]).toEqual({
      clientEventId: id(1),
      kind: "check",
      occurredAt: "2027-01-05T13:00",
      item: "emergency_airspace",
      result: "not_designated",
      source: "mlit-emergency-airspace-qa",
      status: "pending",
      attempts: 0,
    });
    // 読み込み時にも絞る（古い版・手で書き換えた保存）
    const loaded = parseOutbox(JSON.stringify({ v: 1, entries: [{ ...JSON.parse(text).entries[0], pilotName: "x", licenseNumber: "y" }] }));
    expect(JSON.stringify(loaded)).not.toContain("licenseNumber");
    // inspection の確認は端末に残さない（確認の行を持たない項目）
    expect(parseOutbox(JSON.stringify({ entries: [{ ...base(3, "check"), item: "inspection" }] })).entries[0]).not.toHaveProperty("item");
  });

  it("識別子・種別・時刻の形が違う行は捨てる。同じ識別子は 1 件だけ", () => {
    const text = JSON.stringify({
      entries: [{ ...base(1) }, { ...base(1) }, { ...base(2), clientEventId: "x" }, { ...base(3), kind: "journal_linked" }, { ...base(4), occurredAt: "2027-01-05 13:00" }],
    });
    expect(parseOutbox(text).entries.map((e) => e.clientEventId)).toEqual([id(1)]);
  });
});

describe("送信の本文", () => {
  it("queued: true を付け、種別・時刻・識別子・確認の項目・対象だけを送る", () => {
    const e = enqueue(emptyOutbox(), base(2, "landing", { targetClientEventId: id(1) })).entries[0]!;
    expect(toRequestBody(e)).toEqual({ kind: "landing", clientEventId: id(2), occurredAt: "2027-01-05T13:00", queued: true, targetClientEventId: id(1) });
    const c = enqueue(emptyOutbox(), base(3, "check", { item: "carry", result: "done" })).entries[0]!;
    expect(toRequestBody(c)).toEqual({ kind: "check", clientEventId: id(3), occurredAt: "2027-01-05T13:00", queued: true, item: "carry", result: "done" });
  });
});

describe("classifyResponse・applyOutcome", () => {
  it("201・200 は送れた。通信できない・5xx・時間切れ・401・429 は再試行。4xx は拒否", () => {
    expect(classifyResponse({ status: 201 })).toEqual({ kind: "sent" });
    expect(classifyResponse({ status: 200 })).toEqual({ kind: "sent" });
    for (const s of [null, 500, 502, 503, 504, 408, 429, 401]) expect(classifyResponse({ status: s }), String(s)).toEqual({ kind: "retry" });
    expect(classifyResponse({ status: 400, code: "clock_skew" })).toEqual({ kind: "reject", status: 400, code: "clock_skew" });
    expect(classifyResponse({ status: 409, code: "landing_exists" })).toEqual({ kind: "reject", status: 409, code: "landing_exists" });
    expect(classifyResponse({ status: 403 })).toEqual({ kind: "reject", status: 403, code: "rejected" });
    expect(classifyResponse({ status: 302 })).toEqual({ kind: "retry" });
  });

  it("送れた行は消え、再試行の行は残って回数が増え、拒否の行は理由つきで残る（黙って捨てない）", () => {
    let box = enqueue(enqueue(enqueue(emptyOutbox(), base(1)), base(2)), base(3));
    box = applyOutcome(box, id(1), { kind: "sent" });
    expect(box.entries.map((e) => e.clientEventId)).toEqual([id(2), id(3)]);
    box = applyOutcome(box, id(2), { kind: "retry" });
    expect(box.entries[0]).toMatchObject({ clientEventId: id(2), status: "pending", attempts: 1 });
    box = applyOutcome(box, id(3), { kind: "reject", status: 400, code: "too_old" });
    expect(box.entries[1]).toMatchObject({ status: "rejected", rejection: { status: 400, code: "too_old" } });
    expect(box.entries[1]!.rejection!.message).toContain("あとから入力");
    expect(unsentCount(box)).toBe(1);
    expect(rejectedCount(box)).toBe(1);
  });

  it("拒否された行だけを破棄できる。未送信の行は破棄できない", () => {
    let box = enqueue(enqueue(emptyOutbox(), base(1)), base(2));
    box = applyOutcome(box, id(2), { kind: "reject", status: 409, code: "plan_cancelled" });
    expect(discardRejected(box, id(1)).entries).toHaveLength(2);
    expect(discardRejected(box, id(2)).entries.map((e) => e.clientEventId)).toEqual([id(1)]);
  });
});

describe("drainOutbox（順序を守る・二重にならない）", () => {
  const sendOf = (script: Record<string, { status: number | null; code?: string } | "throw">, log: string[]) =>
    async (body: Record<string, unknown>) => {
      const cid = body["clientEventId"] as string;
      log.push(cid);
      const r = script[cid] ?? { status: 201 };
      if (r === "throw") throw new Error("network");
      return r;
    };

  it("先頭から順に送り、送れた行を消す", async () => {
    const log: string[] = [];
    let box: OutboxState = emptyOutbox();
    for (const n of [1, 2, 3]) box = enqueue(box, base(n));
    const r = await drainOutbox(box, sendOf({}, log));
    expect(log).toEqual([id(1), id(2), id(3)]);
    expect(r).toMatchObject({ sent: 3, rejected: 0, blocked: false });
    expect(r.state.entries).toEqual([]);
  });

  it("古い行が送れない（通信できない・5xx・例外）うちは、後の行を送らない", async () => {
    for (const first of [{ status: null }, { status: 503 }, "throw" as const]) {
      const log: string[] = [];
      let box: OutboxState = emptyOutbox();
      for (const n of [1, 2, 3]) box = enqueue(box, base(n));
      const r = await drainOutbox(box, sendOf({ [id(1)]: first }, log));
      expect(log, JSON.stringify(first)).toEqual([id(1)]);
      expect(r).toMatchObject({ sent: 0, blocked: true });
      expect(r.state.entries.map((e) => e.clientEventId)).toEqual([id(1), id(2), id(3)]);
      expect(r.state.entries[0]!.attempts).toBe(1);
      expect(r.state.entries[1]!.attempts).toBe(0);
    }
  });

  it("接続が戻ると、残っていた行が順番どおりに送られる（二重にならない）", async () => {
    let box: OutboxState = emptyOutbox();
    for (const n of [1, 2, 3]) box = enqueue(box, base(n));
    const log: string[] = [];
    const offline = await drainOutbox(box, sendOf({ [id(1)]: { status: null } }, log));
    expect(log).toEqual([id(1)]);
    const online = await drainOutbox(offline.state, sendOf({}, log));
    expect(log).toEqual([id(1), id(1), id(2), id(3)]);
    expect(online.state.entries).toEqual([]);
    // 送り終わった後にもう一度呼んでも何も送らない
    const again = await drainOutbox(online.state, sendOf({}, log));
    expect(log).toHaveLength(4);
    expect(again).toMatchObject({ sent: 0, blocked: false });
  });

  it("応答を落とした再送でも、同じ識別子で送る（サーバーが既存の行を返す）", async () => {
    const box = enqueue(emptyOutbox(), base(1));
    const bodies: Record<string, unknown>[] = [];
    const first = await drainOutbox(box, async (b) => {
      bodies.push(b);
      return { status: null };
    });
    await drainOutbox(first.state, async (b) => {
      bodies.push(b);
      return { status: 200 };
    });
    expect(bodies.map((b) => b["clientEventId"])).toEqual([id(1), id(1)]);
  });

  it("4xx の行は黙って捨てず理由を残し、後ろの行は止めない（理由の行だけ飛ばす）", async () => {
    const log: string[] = [];
    let box: OutboxState = emptyOutbox();
    for (const n of [1, 2, 3]) box = enqueue(box, base(n));
    const r = await drainOutbox(box, sendOf({ [id(2)]: { status: 400, code: "clock_skew" } }, log));
    expect(log).toEqual([id(1), id(2), id(3)]);
    expect(r).toMatchObject({ sent: 2, rejected: 1, blocked: false });
    expect(r.state.entries).toHaveLength(1);
    expect(r.state.entries[0]).toMatchObject({ clientEventId: id(2), status: "rejected", rejection: { code: "clock_skew" } });
    expect(r.state.entries[0]!.rejection!.message).toBe("端末の時刻がずれています。時刻の設定（自動）を確かめてください。");
    // 拒否の行は次の送信で再送しない
    const again = await drainOutbox(r.state, sendOf({}, log));
    expect(log).toHaveLength(3);
    expect(again.state.entries).toHaveLength(1);
    expect(nextToSend(again.state)).toBeNull();
  });
});

describe("ログアウトの警告・他の利用者の保存", () => {
  it("未送信が残っていれば警告し、黙って消さない。送れなかった行も数える", () => {
    const st = new MemStorage();
    expect(logoutGuard(st, "m1")).toEqual({ warn: false, count: 0, message: null });
    saveOutbox(st, outboxKey("p1", "m1"), enqueue(enqueue(emptyOutbox(), base(1)), base(2)));
    let box = enqueue(emptyOutbox(), base(3));
    box = applyOutcome(box, id(3), { kind: "reject", status: 400, code: "too_old" });
    saveOutbox(st, outboxKey("p2", "m1"), box);
    saveOutbox(st, outboxKey("p1", "m2"), enqueue(emptyOutbox(), base(9)));
    expect(countUnsentForMember(st, "m1")).toEqual({ pending: 2, rejected: 1 });
    expect(logoutGuard(st, "m1")).toEqual({ warn: true, count: 3, message: "未送信 3 件があります。送ってからログアウトしますか" });
    // 警告は読み取りだけ。保存は消えない
    expect(loadOutbox(st, outboxKey("p1", "m1")).entries).toHaveLength(2);
  });

  it("他の利用者の保存は消える（clearOtherUsersOutbox。drafts.ts の clearOtherUsersDrafts と同じ規則）", () => {
    const st = new MemStorage();
    saveOutbox(st, outboxKey("p1", "m1"), enqueue(emptyOutbox(), base(1)));
    saveOutbox(st, outboxKey("p1", "m2"), enqueue(emptyOutbox(), base(2)));
    st.setItem("other:key", "x");
    clearOtherUsersOutbox(st, "m1");
    expect(st.getItem(outboxKey("p1", "m1"))).not.toBeNull();
    expect(st.getItem(outboxKey("p1", "m2"))).toBeNull();
    expect(st.getItem("other:key")).toBe("x");
  });

  it("drafts.ts の clearOtherUsersDrafts も、他の利用者の送信待ちを消す（同じ接頭辞・末尾が利用者の ID）", () => {
    const st = new MemStorage();
    saveOutbox(st, outboxKey("p1", "m1"), enqueue(emptyOutbox(), base(1)));
    saveOutbox(st, outboxKey("p1", "m2"), enqueue(emptyOutbox(), base(2)));
    const g = globalThis as unknown as { window?: unknown };
    const prev = g.window;
    g.window = { localStorage: st };
    try {
      clearOtherUsersDrafts("m1");
    } finally {
      g.window = prev;
    }
    expect(st.getItem(outboxKey("p1", "m1"))).not.toBeNull();
    expect(st.getItem(outboxKey("p1", "m2"))).toBeNull();
  });
});

describe("recoverFlightFromOutbox：日誌の入力を送信待ちの離着陸から始める", () => {
  const T = "11111111-1111-4111-8111-111111111111";
  const SERVER_T = "99999999-9999-4999-8999-999999999999";
  const take = (over: Partial<OutboxEntry> = {}): OutboxEntry => ({ clientEventId: T, kind: "takeoff", occurredAt: "2027-01-05T12:00", status: "pending", attempts: 0, ...over });
  const land = (over: Partial<OutboxEntry> = {}): OutboxEntry => ({
    clientEventId: "22222222-2222-4222-8222-222222222222",
    kind: "landing",
    occurredAt: "2027-01-05T12:10",
    status: "pending",
    attempts: 0,
    ...over,
  });
  const st = (...entries: OutboxEntry[]): OutboxState => ({ v: 1, entries });

  it("離着陸とも送信待ち：端末の識別子で結び付く", () => {
    expect(recoverFlightFromOutbox(st(take(), land({ targetClientEventId: T })), [T], null)).toEqual({ takeoffAt: "2027-01-05T12:00", landingAt: "2027-01-05T12:10" });
  });
  it("離陸は届き着陸だけ送信待ち：サーバーの離陸の ID を指す着陸でも回復し、離陸の時刻はサーバーのもの", () => {
    const r = recoverFlightFromOutbox(st(land({ targetEventId: SERVER_T })), [SERVER_T, T], "2027-01-05T11:59");
    expect(r).toEqual({ takeoffAt: "2027-01-05T11:59", landingAt: "2027-01-05T12:10" });
  });
  it("端末の識別子を指す着陸も、離陸が届いていれば回復する（refs に両方を渡す）", () => {
    expect(recoverFlightFromOutbox(st(land({ targetClientEventId: T })), [SERVER_T, T], "2027-01-05T11:59")?.landingAt).toBe("2027-01-05T12:10");
  });
  it("別の離陸を指す着陸・送れなかった着陸・離陸の時刻がないときは回復しない", () => {
    expect(recoverFlightFromOutbox(st(land({ targetEventId: "33333333-3333-4333-8333-333333333333" })), [SERVER_T], "2027-01-05T11:59")).toBeNull();
    expect(recoverFlightFromOutbox(st(land({ targetEventId: SERVER_T, status: "rejected" })), [SERVER_T], "2027-01-05T11:59")).toBeNull();
    expect(recoverFlightFromOutbox(st(land({ targetEventId: SERVER_T })), [SERVER_T], null)).toBeNull();
  });
});

// ---- Sprint 14 E-3：新しい種別を通し、氏名・番号・座標・自由記述の混入を落とす -------------------------
describe("sanitizeEntry（Sprint 14）", () => {
  const ID = "11111111-1111-4111-8111-111111111111";
  const base = { clientEventId: ID, kind: "check", occurredAt: "2027-01-05T12:00", status: "pending", attempts: 0 };
  const SITE = { thirdParty: "none", otherAircraft: "none", rain: "none", visibility: "good", windMs: 3, tempC: 20 };

  it("書類・手続きの確認（項目キー）と飛行自粛要請の確認を通す", async () => {
    const { sanitizeEntry } = await import("./ops-outbox");
    expect(sanitizeEntry({ ...base, item: "docs_confirm", docKey: "remote_id" })).toMatchObject({ item: "docs_confirm", docKey: "remote_id" });
    expect(sanitizeEntry({ ...base, item: "flight_restriction" })).toMatchObject({ item: "flight_restriction" });
    expect(sanitizeEntry({ ...base, item: "docs_confirm", docKey: "bogus" })).toBeNull();
    expect(sanitizeEntry({ ...base, item: "docs_confirm" })).toBeNull();
  });

  it("現場状況：注意なしの選択と数値だけ通す。余計な項目（氏名・番号・座標・備考）は落とす", async () => {
    const { sanitizeEntry } = await import("./ops-outbox");
    const e = sanitizeEntry({
      ...base,
      item: "site_conditions",
      site: { ...SITE, note: "自由記述", name: "山田", licenseNumber: "X-1", lat: 35.1 },
      note: "自由記述",
      pilotName: "山田 太郎",
      latitude: 35.1,
      licenseNumber: "X-1",
    });
    expect(e).toMatchObject({ item: "site_conditions", site: SITE });
    const json = JSON.stringify(e);
    for (const leak of ["自由記述", "山田", "X-1", "35.1", "note", "latitude", "licenseNumber"]) expect(json).not.toContain(leak);
  });

  it("C-9 備考が必須の現場状況（いる／あり／制限あり）は送信待ちに入れない。範囲外の数値も入れない", async () => {
    const { sanitizeEntry, enqueue, emptyOutbox } = await import("./ops-outbox");
    for (const patch of [{ thirdParty: "present" }, { otherAircraft: "present" }, { rain: "present" }, { visibility: "limited" }]) {
      expect(sanitizeEntry({ ...base, item: "site_conditions", site: { ...SITE, ...patch } })).toBeNull();
      expect(enqueue(emptyOutbox(), { clientEventId: ID, kind: "check", occurredAt: "2027-01-05T12:00", item: "site_conditions", site: { ...SITE, ...patch } as never }).entries).toHaveLength(0);
    }
    expect(sanitizeEntry({ ...base, item: "site_conditions", site: { ...SITE, windMs: 999 } })).toBeNull();
    expect(sanitizeEntry({ ...base, item: "site_conditions" })).toBeNull();
  });

  it("送信の本文に docKey・site を載せ、備考は載せない", async () => {
    const { sanitizeEntry, toRequestBody } = await import("./ops-outbox");
    const e = sanitizeEntry({ ...base, item: "site_conditions", site: SITE })!;
    expect(toRequestBody(e)).toMatchObject({ item: "site_conditions", site: SITE, queued: true });
    expect(toRequestBody(e)).not.toHaveProperty("note");
  });
});

describe("Sprint 15：点検・日誌の送信待ち（D-2・D-3・D-5・E-1・E-3・E-6・E-8・F-2）", () => {
  const PLAN = "22222222-2222-4222-8222-222222222222";
  const AIR = "33333333-3333-4333-8333-333333333333";
  const PIL = "44444444-4444-4444-8444-444444444444";
  const KEYS = ["general", "propeller", "frame", "communication", "propulsion", "power", "autopilot", "controller", "battery"];
  const items = (abnormal: Record<string, string> = {}) =>
    Object.fromEntries(KEYS.map((k) => [k, abnormal[k] ? { result: "abnormal", note: abnormal[k] } : { result: "normal", note: "正常の備考" }]));
  const insp = (n: number, extra: Record<string, unknown> = {}) => ({
    clientEventId: id(n),
    kind: "inspection" as const,
    occurredAt: "2027-01-05T11:00",
    inspection: { timing: "pre_flight", aircraftId: AIR, pilotId: PIL, items: items(), ...extra },
  });
  const journal = (n: number, j: Record<string, unknown> = {}) => ({
    clientEventId: id(n),
    kind: "journal" as const,
    occurredAt: "2027-01-05T12:00",
    journal: { aircraftId: AIR, pilotId: PIL, takeoffAt: "2027-01-05T11:10", landingAt: "2027-01-05T11:40", takeoffRef: id(2), safetyIssue: false, ...j },
  });

  it("D-2・D-5：9 項目が項目別に入る。異常の項目は備考が必須（無ければ入れない）。正常の項目の備考・余計な項目（氏名・座標・場所）は残らない", async () => {
    const { sanitizeEntry } = await import("./ops-outbox");
    const e = sanitizeEntry({
      ...insp(1, { items: items({ battery: "膨らみ" }), pilotName: "山田 太郎", latitude: 35.43, placeName: "本社", specialNotes: "特記" }),
      status: "pending",
      attempts: 0,
      licenseNumber: "LIC-1",
    })!;
    expect(Object.keys(e.inspection!.items)).toHaveLength(9);
    expect(e.inspection!.items.battery).toEqual({ result: "abnormal", note: "膨らみ" });
    expect(e.inspection!.items.general).toEqual({ result: "normal" });
    const json = JSON.stringify(e);
    for (const leak of ["山田", "35.43", "本社", "特記", "LIC-1", "正常の備考"]) expect(json).not.toContain(leak);
    // 異常で備考なし、8 項目しかない、は入れない
    expect(sanitizeEntry({ ...insp(1, { items: { ...items(), battery: { result: "abnormal" } } }), status: "pending", attempts: 0 })).toBeNull();
    const eight = items();
    delete (eight as Record<string, unknown>)["battery"];
    expect(sanitizeEntry({ ...insp(1, { items: eight }), status: "pending", attempts: 0 })).toBeNull();
    // 備考は 500 文字まで
    expect(sanitizeEntry({ ...insp(1, { items: items({ frame: "あ".repeat(501) }) }), status: "pending", attempts: 0 })).toBeNull();
  });

  it("D-3・D-5：日誌は「あり」のときだけ内容（自由記述）を残す。目的・場所・座標・操縦者の氏名は残らない", async () => {
    const { sanitizeEntry } = await import("./ops-outbox");
    const e = sanitizeEntry({ ...journal(5, { safetyIssue: false, safetyIssueDetail: "なしの内容", purpose: "空撮", takeoffPlace: "本社", takeoffLat: 35.43, pilotName: "山田" }), status: "pending", attempts: 0 })!;
    const json = JSON.stringify(e);
    for (const leak of ["なしの内容", "空撮", "本社", "35.43", "山田"]) expect(json).not.toContain(leak);
    expect(sanitizeEntry({ ...journal(5, { safetyIssue: true }), status: "pending", attempts: 0 })).toBeNull();
    expect(sanitizeEntry({ ...journal(5, { safetyIssue: true, safetyIssueDetail: "鳥が接近" }), status: "pending", attempts: 0 })!.journal!.safetyIssueDetail).toBe("鳥が接近");
  });

  it("D-5：送れた行・破棄した行は自由記述ごと端末から消える", async () => {
    const { enqueue, emptyOutbox, applyOutcome, discardRejected, saveOutbox, loadOutbox } = await import("./ops-outbox");
    const st = new MemStorage();
    const key = outboxKey(PLAN, PIL);
    let s = enqueue(emptyOutbox(), { ...insp(1, { items: items({ battery: "膨らみ" }) }) } as never);
    s = enqueue(s, journal(5, { safetyIssue: true, safetyIssueDetail: "鳥が接近" }) as never);
    saveOutbox(st, key, s);
    expect(st.getItem(key)).toContain("膨らみ");
    s = applyOutcome(s, id(1), { kind: "sent" });
    s = applyOutcome(s, id(5), { kind: "reject", status: 400, code: "invalid_input" });
    saveOutbox(st, key, s);
    expect(st.getItem(key)).not.toContain("膨らみ");
    s = discardRejected(loadOutbox(st, key), id(5));
    saveOutbox(st, key, s);
    expect(st.getItem(key)).toBeNull();
  });

  it("E-1・E-3：作った順に送る。点検が先、それを指す日誌が後。送れた点検のサーバーの ID に読み替える", async () => {
    const { enqueue, emptyOutbox, requestFor, rememberId, applyOutcome, nextToSend } = await import("./ops-outbox");
    let s = enqueue(emptyOutbox(), insp(1) as never);
    s = enqueue(s, { clientEventId: id(2), kind: "takeoff", occurredAt: "2027-01-05T11:10" });
    s = enqueue(s, { clientEventId: id(3), kind: "landing", occurredAt: "2027-01-05T11:40", targetClientEventId: id(2) });
    s = enqueue(s, journal(5, { inspectionClientRef: id(1) }) as never);
    const sentUrls: string[] = [];
    const SERVER_INSPECTION = "99999999-9999-4999-8999-999999999999";
    for (let e = nextToSend(s); e; e = nextToSend(s)) {
      const r = requestFor(s, PLAN, e);
      sentUrls.push(r.url);
      if (e.kind === "journal") {
        expect(r.body["dailyInspectionId"]).toBe(SERVER_INSPECTION);
        expect(r.body["takeoffEventId"]).toBe(id(2));
        expect(r.body["fillFromPlan"]).toBe(true);
        expect(r.body).not.toHaveProperty("purpose");
        expect(r.body).not.toHaveProperty("takeoffLat");
      }
      if (e.kind === "inspection") {
        expect(r.body).toMatchObject({ clientRequestId: id(1), planId: PLAN, fillFromPlan: true, queued: true, inspectedAt: "2027-01-05T11:00" });
        expect(r.body).not.toHaveProperty("placeName");
      }
      s = applyOutcome(s, e.clientEventId, { kind: "sent" });
      if (e.kind === "inspection") s = rememberId(s, e.clientEventId, SERVER_INSPECTION);
    }
    expect(sentUrls).toEqual(["/api/ops/inspections", `/api/ops/plans/${PLAN}/field-events`, `/api/ops/plans/${PLAN}/field-events`, "/api/ops/flights"]);
  });

  it("E-3：対応はサーバーの ID の読み替えに使い、保存・読み込みで保たれる（送信待ちが空になると項目ごと消える）", async () => {
    const { enqueue, emptyOutbox, rememberId, parseOutbox, serializeOutbox, saveOutbox } = await import("./ops-outbox");
    let s = enqueue(emptyOutbox(), journal(5, { inspectionClientRef: id(1) }) as never);
    s = rememberId(s, id(1), "99999999-9999-4999-8999-999999999999");
    expect(parseOutbox(serializeOutbox(s)).ids).toEqual({ [id(1)]: "99999999-9999-4999-8999-999999999999" });
    const st = new MemStorage();
    saveOutbox(st, outboxKey(PLAN, PIL), { v: 1, entries: [], ids: s.ids! });
    expect(st.getItem(outboxKey(PLAN, PIL))).toBeNull();
  });

  it("E-8：12c の形式（ids なし・現場の事実だけ）の送信待ちが、そのまま読めて同じ本文で送れる", async () => {
    const { parseOutbox, requestFor } = await import("./ops-outbox");
    const legacy = JSON.stringify({
      v: 1,
      entries: [
        { clientEventId: id(2), kind: "takeoff", occurredAt: "2027-01-05T11:10", status: "pending", attempts: 1 },
        { clientEventId: id(3), kind: "check", item: "carry", result: "done", occurredAt: "2027-01-05T11:12", status: "pending", attempts: 0 },
        { clientEventId: id(4), kind: "landing", occurredAt: "2027-01-05T11:40", targetClientEventId: id(2), status: "rejected", attempts: 2, rejection: { status: 400, code: "too_old", message: "x" } },
      ],
    });
    const s = parseOutbox(legacy);
    expect(s.entries.map((e) => [e.kind, e.status])).toEqual([["takeoff", "pending"], ["check", "pending"], ["landing", "rejected"]]);
    for (const e of s.entries) expect(requestFor(s, PLAN, e)).toEqual({ url: `/api/ops/plans/${PLAN}/field-events`, body: toRequestBody(e) });
  });

  it("E-6：72 時間を超えた行は期限切れ。12 時間以内に超える行があれば残り時間を返す", async () => {
    const { enqueue, emptyOutbox, isExpired, expiringSoon, OUTBOX_EXPIRY_WARNING } = await import("./ops-outbox");
    const at = Date.parse("2027-01-05T11:00:00+09:00");
    const s = enqueue(emptyOutbox(), insp(1) as never);
    const e = s.entries[0]!;
    expect(isExpired(e, at + 71 * 3600_000)).toBe(false);
    expect(isExpired(e, at + 72 * 3600_000 + 60_000)).toBe(true);
    expect(expiringSoon(s, at + 10 * 3600_000)).toBeNull();
    expect(expiringSoon(s, at + 61 * 3600_000)).toBe(11);
    expect(expiringSoon(s, at + 73 * 3600_000)).toBeNull();
    expect(OUTBOX_EXPIRY_WARNING(11)).toContain("あと 11 時間");
  });

  it("F-2：キーに利用者の ID が入り、他の利用者の送信待ちは数えない・消える", () => {
    const st = new MemStorage();
    const other = "55555555-5555-4555-8555-555555555555";
    saveOutbox(st, outboxKey(PLAN, PIL), enqueue(emptyOutbox(), insp(1) as never));
    saveOutbox(st, outboxKey(PLAN, other), enqueue(emptyOutbox(), insp(2) as never));
    expect(outboxKey(PLAN, PIL).endsWith(`:${PIL}`)).toBe(true);
    expect(countUnsentForMember(st, PIL).pending).toBe(1);
    clearOtherUsersOutbox(st, PIL);
    expect(st.getItem(outboxKey(PLAN, other))).toBeNull();
    expect(loadOutbox(st, outboxKey(PLAN, PIL)).entries).toHaveLength(1);
  });
});
