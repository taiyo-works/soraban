// Sprint 12c 契約 2：fieldState・decideTransition・takeoffGaps・checkJournalLink の全組合せ（単体）。
import { describe, expect, it } from "vitest";
import {
  checkJournalLink,
  decideTransition,
  fieldState,
  outboxAsEvents,
  takeoffGaps,
  undoneIds,
  type FieldEventLite,
  type FieldRequest,
  type FieldState,
  type FieldStateInput,
  type InspectionLite,
} from "./field-logic";
import { enqueue, emptyOutbox } from "@/lib/ops-outbox";
import { FIELD_GAP_ITEMS } from "@/lib/ops-field";

let seq = 0;
const uid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const DAY = "2027-01-05";
const T = (hm: string): string => new Date(`${DAY}T${hm}:00+09:00`).toISOString();

const ev = (e: Partial<FieldEventLite> & Pick<FieldEventLite, "kind">): FieldEventLite => {
  seq += 1;
  return {
    id: uid(seq),
    clientEventId: uid(1000 + seq),
    item: null,
    result: null,
    source: null,
    targetEventId: null,
    flightRecordId: null,
    inspectionId: null,
    reportId: null,
    occurredAt: T("13:00"),
    recordedKey: `2027-01-05T04:00:00.${String(seq).padStart(6, "0")}Z`,
    queued: false,
    gaps: null,
    ...e,
  };
};
const check = (item: NonNullable<FieldEventLite["item"]>, result: FieldEventLite["result"] = "done", hm = "13:00", extra: Partial<FieldEventLite> = {}) =>
  ev({ kind: "check", item, result, source: item === "emergency_airspace" ? "mlit-emergency-airspace-qa" : null, occurredAt: T(hm), ...extra });
const takeoff = (hm = "13:10", extra: Partial<FieldEventLite> = {}) => ev({ kind: "takeoff", occurredAt: T(hm), gaps: [], ...extra });
const landing = (to: FieldEventLite, hm = "13:30", extra: Partial<FieldEventLite> = {}) =>
  ev({ kind: "landing", occurredAt: T(hm), targetEventId: to.id, ...extra });
const undo = (target: FieldEventLite) => ev({ kind: "undo", targetEventId: target.id });
const journal = (to: FieldEventLite, recordId: string) => ev({ kind: "journal_linked", targetEventId: to.id, flightRecordId: recordId });

const state = (events: FieldEventLite[], over: Partial<FieldStateInput> = {}): FieldState =>
  fieldState({ events, inspections: [], flightRecords: [], day: DAY, ...over });

const insp = (id: string, hm: string, over: Partial<InspectionLite> = {}): InspectionLite => ({
  id,
  inspectedAt: T(hm),
  date: DAY,
  timing: "pre_flight",
  hasAbnormal: false,
  ...over,
});

describe("fieldState：確認項目", () => {
  it("何もなければすべて未", () => {
    const s = state([]);
    for (const item of ["inspection", "emergency_airspace", "report_recheck", "carry"] as const) expect(s.checks[item].done).toBe(false);
    expect(s.flights).toEqual([]);
    expect(s.openFlight).toBeNull();
    expect(s.pendingJournal).toEqual([]);
  });

  it("確認の行があれば済（時刻・結果・情報源・行の ID）", () => {
    const e = check("emergency_airspace", "not_designated", "12:50");
    const s = state([e, check("carry"), check("report_recheck")]);
    expect(s.checks.emergency_airspace).toMatchObject({ done: true, result: "not_designated", source: "mlit-emergency-airspace-qa", eventId: e.id, designated: false, at: T("12:50") });
    expect(s.checks.carry.done).toBe(true);
    expect(s.checks.report_recheck.done).toBe(true);
  });

  it("「指定されている」でも済（記録は残る）だが designated になる", () => {
    const s = state([check("emergency_airspace", "designated")]);
    expect(s.checks.emergency_airspace).toMatchObject({ done: true, designated: true, result: "designated" });
  });

  it("同じ項目は最新の行が有効。取り消すと未に戻り、前の行が有効になることはない（取り消されたのは最新の行だけ）", () => {
    const a = check("carry", "done", "12:00");
    const b = check("carry", "done", "12:10");
    expect(state([a, b]).checks.carry.eventId).toBe(b.id);
    expect(state([a, b, undo(b)]).checks.carry.eventId).toBe(a.id);
    expect(state([a, undo(a)]).checks.carry.done).toBe(false);
  });

  it("緊急用務空域は指定されている → 取り消す → 指定されていない、で上書きされる", () => {
    const a = check("emergency_airspace", "designated", "12:00");
    const b = check("emergency_airspace", "not_designated", "12:20");
    expect(state([a, b]).checks.emergency_airspace).toMatchObject({ designated: false, result: "not_designated" });
    expect(state([a, undo(a)]).checks.emergency_airspace.done).toBe(false);
  });

  it("日常点検は確認の行を見ず、実際の点検の記録から導出する（行があっても点検がなければ未）", () => {
    expect(state([check("inspection")]).checks.inspection.done).toBe(false);
    const s = state([], { inspections: [insp("i1", "11:00")] });
    expect(s.checks.inspection).toMatchObject({ done: true, abnormal: false, inspectionId: "i1", at: T("11:00"), eventId: null });
  });

  it("日常点検：飛行後の点検・別の日の点検は数えない。複数なら最新。異常ありは abnormal", () => {
    expect(state([], { inspections: [insp("i1", "11:00", { timing: "post_flight" })] }).checks.inspection.done).toBe(false);
    expect(state([], { inspections: [insp("i1", "11:00", { date: "2027-01-04" })] }).checks.inspection.done).toBe(false);
    const ab = state([], { inspections: [insp("i1", "09:00"), insp("i2", "11:00", { hasAbnormal: true })] });
    expect(ab.checks.inspection).toMatchObject({ inspectionId: "i2", abnormal: true });
    // 異常あり → あとで正常に点検し直した
    const fixed = state([], { inspections: [insp("i2", "09:00", { hasAbnormal: true }), insp("i3", "11:30")] });
    expect(fixed.checks.inspection).toMatchObject({ inspectionId: "i3", abnormal: false });
  });

  it("取消した点検は呼び出し側が渡さない（渡された点検の一覧だけを見る）", () => {
    expect(state([], { inspections: [] }).checks.inspection.done).toBe(false);
  });

  it("保存された「状態」の列を読まない（行を足すだけで状態が変わる）", () => {
    const rows: FieldEventLite[] = [];
    expect(state(rows).checks.carry.done).toBe(false);
    rows.push(check("carry"));
    expect(state(rows).checks.carry.done).toBe(true);
    rows.push(undo(rows[0]!));
    expect(state(rows).checks.carry.done).toBe(false);
  });
});

describe("fieldState：飛行の組・日誌", () => {
  it("離陸だけなら飛行中。着陸すれば日誌待ち。日誌の結び付きがあれば日誌済み", () => {
    const t = takeoff();
    expect(state([t]).openFlight?.takeoffEventId).toBe(t.id);
    expect(state([t]).flights[0]?.phase).toBe("in_flight");
    const l = landing(t);
    const s = state([t, l]);
    expect(s.openFlight).toBeNull();
    expect(s.flights[0]).toMatchObject({ phase: "journal_pending", landingEventId: l.id, landingAt: l.occurredAt });
    expect(s.pendingJournal.map((f) => f.takeoffEventId)).toEqual([t.id]);
    const j = journal(t, "r1");
    const done = state([t, l, j], { flightRecords: [{ id: "r1", voided: false }] });
    expect(done.flights[0]).toMatchObject({ phase: "journaled", flightRecordId: "r1", journalEventId: j.id });
    expect(done.pendingJournal).toEqual([]);
  });

  it("結び付いた飛行記録が取消されたら日誌待ちに戻る（導出なので自動）", () => {
    const t = takeoff();
    const l = landing(t);
    const j = journal(t, "r1");
    const s = state([t, l, j], { flightRecords: [{ id: "r1", voided: true }] });
    expect(s.flights[0]?.phase).toBe("journal_pending");
    expect(s.pendingJournal).toHaveLength(1);
    // 取消した後に別の飛行記録で日誌を付け直した
    const j2 = journal(t, "r2");
    const s2 = state([t, l, j, j2], { flightRecords: [{ id: "r1", voided: true }, { id: "r2", voided: false }] });
    expect(s2.flights[0]).toMatchObject({ phase: "journaled", flightRecordId: "r2" });
  });

  it("取り消された離陸は無いものとして扱う。取り消された着陸は飛行中に戻る", () => {
    const t = takeoff();
    expect(state([t, undo(t)]).flights).toEqual([]);
    const l = landing(t);
    const s = state([t, l, undo(l)]);
    expect(s.flights[0]?.phase).toBe("in_flight");
    expect(s.openFlight?.takeoffEventId).toBe(t.id);
    // 取り消した着陸のあとに、もう一度着陸した
    const l2 = landing(t, "13:40");
    expect(state([t, l, undo(l), l2]).flights[0]).toMatchObject({ phase: "journal_pending", landingEventId: l2.id });
  });

  it("複数回の離着陸（バッテリー交換）：離陸の古い順の組になる", () => {
    const t1 = takeoff("13:00");
    const l1 = landing(t1, "13:20");
    const t2 = takeoff("13:30");
    const s = state([t1, l1, t2]);
    expect(s.flights.map((f) => f.phase)).toEqual(["journal_pending", "in_flight"]);
    expect(s.openFlight?.takeoffEventId).toBe(t2.id);
    expect(s.pendingJournal.map((f) => f.takeoffEventId)).toEqual([t1.id]);
    const l2 = landing(t2, "13:50");
    const j1 = journal(t1, "r1");
    const s2 = state([t1, l1, t2, l2, j1], { flightRecords: [{ id: "r1", voided: false }] });
    expect(s2.flights.map((f) => f.phase)).toEqual(["journaled", "journal_pending"]);
  });

  it("着陸が離陸を端末の識別子で指していても組になる（送信待ちの行）", () => {
    const t = takeoff();
    const l = ev({ kind: "landing", targetEventId: t.clientEventId });
    expect(state([t, l]).flights[0]?.phase).toBe("journal_pending");
    const u = ev({ kind: "undo", targetEventId: l.clientEventId });
    expect(state([t, l, u]).flights[0]?.phase).toBe("in_flight");
  });

  it("undo と journal_linked は取り消せない（undo の undo・journal_linked の undo は無視される）", () => {
    const t = takeoff();
    const l = landing(t);
    const j = journal(t, "r1");
    const uu = undo(t);
    const bad1 = ev({ kind: "undo", targetEventId: uu.id });
    const bad2 = ev({ kind: "undo", targetEventId: j.id });
    expect([...undoneIds([t, l, j, uu, bad1, bad2])]).toEqual([t.id]);
    const s = state([t, l, j, bad2], { flightRecords: [{ id: "r1", voided: false }] });
    expect(s.flights[0]?.phase).toBe("journaled");
  });

  it("記録の順（recordedKey）で並べる。入力の順に依らない", () => {
    const a = check("carry", "done", "12:00");
    const b = check("carry", "done", "12:10");
    expect(state([b, a]).checks.carry.eventId).toBe(b.id);
  });
});

describe("decideTransition：取り消しの規則・計画の状態", () => {
  const live = { planCancelled: false };
  const cancelled = { planCancelled: true };
  const run = (events: FieldEventLite[], req: FieldRequest, ctx = live) => decideTransition(events, state(events), req, ctx);
  const code = (r: ReturnType<typeof run>) => (r.ok ? "ok" : r.code);

  it("離陸：飛行中の離陸があれば already_in_flight。なければ可。何度でも繰り返せる", () => {
    expect(code(run([], { kind: "takeoff" }))).toBe("ok");
    const t = takeoff();
    expect(code(run([t], { kind: "takeoff" }))).toBe("already_in_flight");
    expect(code(run([t, landing(t)], { kind: "takeoff" }))).toBe("ok");
    expect(code(run([t, undo(t)], { kind: "takeoff" }))).toBe("ok");
  });

  it("着陸：開いた離陸がなければ no_open_flight。target を省くと飛行中の離陸になる", () => {
    expect(code(run([], { kind: "landing", targetEventId: null }))).toBe("no_open_flight");
    const t = takeoff();
    const r = run([t], { kind: "landing", targetEventId: null });
    expect(r).toEqual({ ok: true, targetEventId: t.id });
    expect(run([t], { kind: "landing", targetEventId: t.clientEventId })).toEqual({ ok: true, targetEventId: t.id });
    // 着陸済みの離陸への着陸
    expect(code(run([t, landing(t)], { kind: "landing", targetEventId: t.id }))).toBe("no_open_flight");
    // 離陸でない行を指す
    const c = check("carry");
    expect(code(run([t, c], { kind: "landing", targetEventId: c.id }))).toBe("invalid_target");
    expect(code(run([t], { kind: "landing", targetEventId: uid(99999) }))).toBe("invalid_target");
    // 二つ目の離陸が開いている間に、一つ目を指す
    const l = landing(t);
    const t2 = takeoff("13:40");
    expect(code(run([t, l, t2], { kind: "landing", targetEventId: t.id }))).toBe("no_open_flight");
  });

  it("中止した計画：新しい確認・離陸は plan_cancelled。開いている離陸の着陸と取り消すは記録できる", () => {
    expect(code(run([], { kind: "check", item: "carry" }, cancelled))).toBe("plan_cancelled");
    expect(code(run([], { kind: "takeoff" }, cancelled))).toBe("plan_cancelled");
    const t = takeoff();
    expect(code(run([t], { kind: "landing", targetEventId: null }, cancelled))).toBe("ok");
    expect(code(run([t], { kind: "undo", targetEventId: t.id }, cancelled))).toBe("ok");
    const c = check("carry");
    expect(code(run([c], { kind: "undo", targetEventId: c.id }, cancelled))).toBe("ok");
    expect(code(run([], { kind: "landing", targetEventId: null }, cancelled))).toBe("no_open_flight");
  });

  it("取り消す：check・takeoff・landing は取り消せる", () => {
    const c = check("carry");
    expect(run([c], { kind: "undo", targetEventId: c.id })).toEqual({ ok: true, targetEventId: c.id });
    const t = takeoff();
    expect(run([t], { kind: "undo", targetEventId: t.id })).toEqual({ ok: true, targetEventId: t.id });
    const l = landing(t);
    expect(run([t, l], { kind: "undo", targetEventId: l.id })).toEqual({ ok: true, targetEventId: l.id });
    expect(run([t, l], { kind: "undo", targetEventId: l.clientEventId })).toEqual({ ok: true, targetEventId: l.id });
  });

  it("取り消す：着陸がある離陸は landing_exists（先に着陸を取り消す）", () => {
    const t = takeoff();
    const l = landing(t);
    expect(code(run([t, l], { kind: "undo", targetEventId: t.id }))).toBe("landing_exists");
    // 着陸を取り消せば、離陸も取り消せる
    expect(code(run([t, l, undo(l)], { kind: "undo", targetEventId: t.id }))).toBe("ok");
  });

  it("取り消す：日誌済みの着陸は journal_exists。その飛行記録が取消されたら取り消せる", () => {
    const t = takeoff();
    const l = landing(t);
    const j = journal(t, "r1");
    const live1 = [t, l, j];
    const ok = decideTransition(live1, state(live1, { flightRecords: [{ id: "r1", voided: false }] }), { kind: "undo", targetEventId: l.id }, live);
    expect(ok).toEqual({ ok: false, status: 409, code: "journal_exists" });
    const voided = decideTransition(live1, state(live1, { flightRecords: [{ id: "r1", voided: true }] }), { kind: "undo", targetEventId: l.id }, live);
    expect(voided.ok).toBe(true);
  });

  it("取り消す：journal_linked・undo は not_undoable。取り消し済みは already_undone。存在しない行は invalid_target", () => {
    const t = takeoff();
    const l = landing(t);
    const j = journal(t, "r1");
    const u = undo(l);
    expect(code(run([t, l, j], { kind: "undo", targetEventId: j.id }))).toBe("not_undoable");
    expect(code(run([t, l, u], { kind: "undo", targetEventId: u.id }))).toBe("not_undoable");
    expect(code(run([t, l, u], { kind: "undo", targetEventId: l.id }))).toBe("already_undone");
    expect(code(run([], { kind: "undo", targetEventId: uid(424242) }))).toBe("invalid_target");
  });

  it("確認の追加は何度でもできる（最新が有効）", () => {
    const c = check("carry");
    expect(code(run([c], { kind: "check", item: "carry" }))).toBe("ok");
  });
});

describe("checkJournalLink", () => {
  it("着陸済みで日誌待ちだけが結び付けられる。着陸していない・存在しない・日誌済み", () => {
    const t = takeoff();
    const l = landing(t);
    expect(checkJournalLink(state([t]), t.id)).toMatchObject({ ok: false, status: 400, code: "no_landing" });
    expect(checkJournalLink(state([t, l]), uid(777777))).toMatchObject({ ok: false, status: 400, code: "invalid_target" });
    expect(checkJournalLink(state([t, l]), t.id)).toMatchObject({ ok: true });
    const done = state([t, l, journal(t, "r1")], { flightRecords: [{ id: "r1", voided: false }] });
    expect(checkJournalLink(done, t.id)).toMatchObject({ ok: false, status: 409, code: "already_journaled" });
    // 取り消された離陸
    expect(checkJournalLink(state([t, undo(t)]), t.id)).toMatchObject({ ok: false, status: 400, code: "invalid_target" });
    // 飛行記録が取消されたら再び結び付けられる
    const voided = state([t, l, journal(t, "r1")], { flightRecords: [{ id: "r1", voided: true }] });
    expect(checkJournalLink(voided, t.id).ok).toBe(true);
  });
});

describe("takeoffGaps（離陸の未了事項。離陸は止めない）", () => {
  const done = (over: Partial<FieldState["checks"]> = {}): FieldState["checks"] => ({
    ...state([
      check("emergency_airspace", "not_designated"),
      check("carry"),
      check("report_recheck"),
    ], { inspections: [insp("i1", "11:00")] }).checks,
    ...over,
  });
  const base = {
    requirementKind: "required",
    reportStatusCode: "reported",
    effectiveReportedAt: "2027-01-04T10:00",
    takeoffAtJst: "2027-01-05T13:10",
    planState: "approved" as const,
    judgementStale: false,
  };

  it("すべて済んでいれば未了事項なし", () => {
    expect(takeoffGaps({ ...base, checks: done() })).toEqual([]);
  });

  it("何も記録がなく、計画も確認済みでない：項目の順に並ぶ", () => {
    const g = takeoffGaps({ ...base, checks: state([]).checks, reportStatusCode: "no_record", effectiveReportedAt: null, planState: "pending", judgementStale: true });
    expect(g).toEqual([
      { item: "inspection", state: "none" },
      { item: "emergency_airspace", state: "none" },
      { item: "report", state: "none" },
      { item: "confirmation", state: "pending" },
      { item: "judgement", state: "stale" },
      { item: "carry", state: "none" },
    ]);
    // Sprint 14：round を渡さない呼び出し（12c と同じ）では、新しい未了の項目は数えない。意図の変更：FIELD_GAP_ITEMS に
    // Sprint 14 の項目が増えたため、12c の 6 項目に絞って順序を比べる。
    const legacy = ["inspection", "emergency_airspace", "report", "confirmation", "judgement", "carry"];
    expect(g.map((x) => x.item)).toEqual(FIELD_GAP_ITEMS.filter((x) => legacy.includes(x)));
  });

  it("日常点検：異常あり。緊急用務空域：指定されている", () => {
    const s = state([check("emergency_airspace", "designated"), check("carry")], { inspections: [insp("i1", "11:00", { hasAbnormal: true })] });
    expect(takeoffGaps({ ...base, checks: s.checks })).toEqual([
      { item: "inspection", state: "abnormal" },
      { item: "emergency_airspace", state: "designated" },
    ]);
  });

  it("通報：指紋が変わっている（changed）・記録が離陸より後（after_takeoff）・要確認も要と同じ", () => {
    expect(takeoffGaps({ ...base, checks: done(), reportStatusCode: "change_review" })).toEqual([{ item: "report", state: "changed" }]);
    expect(takeoffGaps({ ...base, checks: done(), effectiveReportedAt: "2027-01-05T13:11" })).toEqual([{ item: "report", state: "after_takeoff" }]);
    expect(takeoffGaps({ ...base, checks: done(), effectiveReportedAt: "2027-01-05T13:10" })).toEqual([]);
    expect(takeoffGaps({ ...base, checks: done(), requirementKind: "confirm", reportStatusCode: "no_record", effectiveReportedAt: null })).toEqual([{ item: "report", state: "none" }]);
    for (const code of ["failed", "unknown", "sending", "cancelled"]) {
      expect(takeoffGaps({ ...base, checks: done(), reportStatusCode: code, effectiveReportedAt: null })).toEqual([{ item: "report", state: "none" }]);
    }
  });

  it("通報：推奨・対象外（模型航空機）は数えない", () => {
    for (const kind of ["recommended", "not_applicable_model"]) {
      expect(takeoffGaps({ ...base, checks: done(), requirementKind: kind, reportStatusCode: "no_record", effectiveReportedAt: null })).toEqual([]);
    }
  });

  it("確認（運航管理者）：下書き・確認待ち・差し戻し・前の版への確認。確認済みは出ない", () => {
    const g = (planState: Parameters<typeof takeoffGaps>[0]["planState"]) => takeoffGaps({ ...base, checks: done(), planState });
    expect(g("draft")).toEqual([{ item: "confirmation", state: "draft" }]);
    expect(g("pending")).toEqual([{ item: "confirmation", state: "pending" }]);
    expect(g("returned")).toEqual([{ item: "confirmation", state: "returned" }]);
    expect(g("approved_stale")).toEqual([{ item: "confirmation", state: "stale" }]);
    expect(g("returned_stale")).toEqual([{ item: "confirmation", state: "stale" }]);
    expect(g("approved")).toEqual([]);
  });
});

describe("outboxAsEvents（送信待ちの行を状態の導出に足す）", () => {
  it("未送信の行だけを、サーバーの行の後ろに並ぶ形にする。押した結果が送信の前に反映される", () => {
    const t = takeoff("13:00");
    let box = emptyOutbox();
    const cid = uid(5001);
    box = enqueue(box, { clientEventId: cid, kind: "takeoff", occurredAt: "2027-01-05T13:20" });
    const l = uid(5002);
    box = enqueue(box, { clientEventId: l, kind: "landing", occurredAt: "2027-01-05T13:30", targetClientEventId: cid });
    const s = fieldState({ events: [t, landing(t, "13:10"), ...outboxAsEvents(box.entries)], inspections: [], flightRecords: [], day: DAY });
    expect(s.flights.map((f) => f.phase)).toEqual(["journal_pending", "journal_pending"]);
    expect(s.flights[1]).toMatchObject({ takeoffQueued: true, landingQueued: true });
    // 着陸だけが未送信で、離陸はサーバーにある
    const only = enqueue(emptyOutbox(), { clientEventId: l, kind: "landing", occurredAt: "2027-01-05T13:30", targetEventId: t.id });
    const s2 = fieldState({ events: [t, ...outboxAsEvents(only.entries)], inspections: [], flightRecords: [], day: DAY });
    expect(s2.flights[0]).toMatchObject({ phase: "journal_pending", landingQueued: true });
  });
});

// ---- Sprint 14 契約 A：飛行ラウンド ------------------------------------------------------------

describe("Sprint 14 A-1：飛行ラウンドの導出", () => {
  const SITE = { thirdParty: "none", otherAircraft: "none", rain: "none", visibility: "good", windMs: null, tempC: null } as const;
  const site = (hm = "13:00", extra: Partial<FieldEventLite> = {}) => check("site_conditions", "done", hm, { site: SITE, ...extra });
  const docs = (key: "permit" | "remote_id", hm = "13:00") => check("docs_confirm", "done", hm, { docKey: key });

  it("ラウンドの番号：離陸〜着陸で 1 ラウンドが閉じ、次の入力は次のラウンドに数える", () => {
    expect(state([]).round.index).toBe(0);
    const t1 = takeoff("13:10");
    expect(state([t1]).round.index).toBe(0); // 飛行中は同じラウンド
    const l1 = landing(t1, "13:30");
    expect(state([t1, l1]).round.index).toBe(1);
    const t2 = takeoff("14:10");
    expect(state([t1, l1, t2]).round.index).toBe(1);
    expect(state([t1, l1, t2]).flights.map((f) => f.roundIndex)).toEqual([0, 1]);
  });

  it("取り消し（undo）で閉じたラウンドが開き直る", () => {
    const t1 = takeoff("13:10");
    const l1 = landing(t1, "13:30");
    expect(state([t1, l1, undo(l1)]).round.index).toBe(0);
    expect(state([t1, l1, undo(l1)]).openFlight?.takeoffEventId).toBe(t1.id);
  });

  it("A-2 ラウンドごとの項目（空域・現場状況・緊急用務空域）は、前のラウンドの記録で満たされない", () => {
    const em = check("emergency_airspace", "not_designated", "13:00");
    const rs = check("flight_restriction", "done", "13:01");
    const st = site("13:02");
    const t1 = takeoff("13:10");
    const l1 = landing(t1, "13:30");
    const first = state([em, rs, st, t1]);
    expect(first.checks.emergency_airspace.done).toBe(true);
    expect(first.round.restriction.done).toBe(true);
    expect(first.round.site.done).toBe(true);
    const next = state([em, rs, st, t1, l1]);
    expect(next.checks.emergency_airspace.done).toBe(false);
    expect(next.round.restriction.done).toBe(false);
    expect(next.round.site.done).toBe(false);
    // 次のラウンドで確認し直すと満たされる
    const em2 = check("emergency_airspace", "not_designated", "14:00");
    expect(state([em, rs, st, t1, l1, em2]).checks.emergency_airspace.done).toBe(true);
  });

  it("A-2 計画ごとの項目（書類・手続きの人の確認・通報済みの再確認・携行品）は次のラウンドに持ち越される", () => {
    const d = docs("permit");
    const rc = check("report_recheck");
    const cr = check("carry");
    const t1 = takeoff("13:10");
    const l1 = landing(t1, "13:30");
    const s = state([d, rc, cr, t1, l1]);
    expect(s.docConfirms.permit?.eventId).toBe(d.id);
    expect(s.checks.report_recheck.done).toBe(true);
    expect(s.checks.carry.done).toBe(true);
    // 取り消すと戻る
    expect(state([d, rc, cr, t1, l1, undo(d)]).docConfirms.permit).toBeUndefined();
  });

  it("日常点検（飛行前）も前のラウンドの点検では満たされない（着陸より前の点検は数えない）", () => {
    const t1 = takeoff("13:10");
    const l1 = landing(t1, "13:30");
    const s0 = state([t1, l1], { inspections: [insp("i1", "12:50")] });
    expect(s0.checks.inspection.done).toBe(false);
    const s1 = state([t1, l1], { inspections: [insp("i1", "12:50"), insp("i2", "13:45")] });
    expect(s1.checks.inspection).toMatchObject({ done: true, inspectionId: "i2" });
    // 最初のラウンドは従来どおり（その日の飛行前の点検）
    expect(state([], { inspections: [insp("i1", "12:50")] }).checks.inspection.done).toBe(true);
  });

  it("飛行後点検：着陸のあとの飛行後の日常点検から導出する。次の離陸の前までを、その飛行のものとして数える", () => {
    const t1 = takeoff("13:10");
    const l1 = landing(t1, "13:30");
    const t2 = takeoff("14:10");
    const l2 = landing(t2, "14:30");
    const p1 = insp("p1", "13:40", { timing: "post_flight" });
    // Sprint 15（R-1）：この計画に結び付いた点検だけを数える（結び付きは点検の保存時にサーバーが追記する確認の行）
    const link1 = check("inspection", "done", "13:40", { inspectionId: "p1" });
    const s = state([t1, l1, t2, l2, link1], { inspections: [p1] });
    expect(s.flights[0]!.post).toMatchObject({ done: true, inspectionId: "p1" });
    expect(s.flights[1]!.post.done).toBe(false);
    expect(s.postPending.map((f) => f.takeoffEventId)).toEqual([t2.id]);
    // 飛行中は対象外
    expect(state([t1, link1], { inspections: [p1] }).postPending).toEqual([]);
  });

  it("Sprint 15 R-1：計画に結び付いていない飛行後点検（別の計画の点検・結び付きのない既存の点検）は、機体と時刻が合っても済にしない", () => {
    const t1 = takeoff("13:10");
    const l1 = landing(t1, "13:30");
    const p1 = insp("p1", "13:40", { timing: "post_flight" });
    // 結び付きなし（Sprint 14 以前の点検、または別の計画に結び付いた点検）
    expect(state([t1, l1], { inspections: [p1] }).flights[0]!.post.done).toBe(false);
    expect(state([t1, l1], { inspections: [p1] }).postPending.map((f) => f.takeoffEventId)).toEqual([t1.id]);
    // 結び付きを取り消すと、満たさない状態に戻る
    const link = check("inspection", "done", "13:40", { inspectionId: "p1" });
    expect(state([t1, l1, link], { inspections: [p1] }).flights[0]!.post.done).toBe(true);
    expect(state([t1, l1, link, undo(link)], { inspections: [p1] }).flights[0]!.post.done).toBe(false);
    // 結び付きは確認項目（checks）には影響しない（日常点検の確認は実際の点検の記録から導出する）
    expect(state([link], { inspections: [] }).checks.inspection.done).toBe(false);
  });

  it("日誌への引き継ぎ：各飛行は、そのラウンドの飛行前の点検を持つ（着陸でラウンドが閉じても失われない）", () => {
    const t1 = takeoff("13:10");
    const l1 = landing(t1, "13:30");
    const t2 = takeoff("14:10");
    const l2 = landing(t2, "14:30");
    const s = state([t1, l1, t2, l2], { inspections: [insp("i1", "12:50"), insp("i2", "13:45")] });
    expect(s.flights.map((f) => f.preInspectionId)).toEqual(["i1", "i2"]);
    // 現在のラウンド（次の飛行）の点検は無いが、閉じた飛行の点検は残る
    expect(s.checks.inspection.done).toBe(false);
    expect(state([t1, l1], { inspections: [insp("i1", "12:50")] }).flights[0]!.preInspectionId).toBe("i1");
    expect(state([t1], { inspections: [] }).flights[0]!.preInspectionId).toBeNull();
  });

  it("飛行後点検は、その飛行の着陸より前の点検では満たされない", () => {
    const t1 = takeoff("13:10");
    const l1 = landing(t1, "13:30");
    const early = insp("p0", "13:00", { timing: "post_flight" });
    expect(state([t1, l1, check("inspection", "done", "13:00", { inspectionId: "p0" })], { inspections: [early] }).flights[0]!.post.done).toBe(false);
  });
});

describe("Sprint 14 A-3：takeoffGaps に書類・手続きと現場状況", () => {
  const baseIn = {
    requirementKind: "required",
    reportStatusCode: "reported",
    effectiveReportedAt: "2027-01-04T10:00",
    takeoffAtJst: "2027-01-05T13:10",
    planState: "approved" as const,
    judgementStale: false,
  };
  const done = (): FieldState["checks"] =>
    state([check("emergency_airspace", "not_designated"), check("carry"), check("report_recheck")], { inspections: [insp("i", "12:00")] }).checks;

  it("round を渡さなければ従来どおり（新しい項目は数えない）", () => {
    expect(takeoffGaps({ ...baseIn, checks: done() })).toEqual([]);
  });

  it("要確認・満たさない・飛行自粛要請と現場状況の未入力・注意ありが、項目の順に並ぶ", () => {
    const g = takeoffGaps({
      ...baseIn,
      checks: done(),
      round: {
        docs: [
          { key: "permit", state: "unmet" },
          { key: "manual", state: "needs_check" },
        ],
        restrictionDone: false,
        site: { done: true, attention: true },
      },
    });
    expect(g).toEqual([
      { item: "flight_restriction", state: "none" },
      { item: "site_conditions", state: "attention" },
      { item: "docs_permit", state: "unmet" },
      { item: "docs_manual", state: "needs_check" },
    ]);
    expect(takeoffGaps({ ...baseIn, checks: done(), round: { docs: [], restrictionDone: true, site: { done: false, attention: false } } })).toEqual([
      { item: "site_conditions", state: "none" },
    ]);
  });

  it("FIELD_GAP_ITEMS の表示名の表が揃っている（欠けると落ちる）", async () => {
    const { FIELD_GAP_ITEM_LABEL, FIELD_GAP_STATES, FIELD_GAP_STATE_LABEL } = await import("@/lib/ops-field");
    for (const k of FIELD_GAP_ITEMS) expect(FIELD_GAP_ITEM_LABEL[k], k).toBeTruthy();
    for (const k of FIELD_GAP_STATES) expect(FIELD_GAP_STATE_LABEL[k], k).toBeTruthy();
    expect(Object.keys(FIELD_GAP_ITEM_LABEL).sort()).toEqual([...FIELD_GAP_ITEMS].sort());
  });
});

describe("レビュー指摘の修正（field-logic）", () => {
  it("人の確認は、記録した版と計画の現在の版が同じときだけ有効（機体・操縦者の変更を引き継がない）", () => {
    const d1 = check("docs_confirm", "done", "13:00", { docKey: "remote_id", planVersion: 1 });
    const d2 = check("docs_confirm", "done", "13:01", { docKey: "manual", planVersion: 2 });
    const pending = check("docs_confirm", "done", "13:02", { docKey: "permit", planVersion: null });
    const s = state([d1, d2, pending], { planVersion: 2 });
    expect(s.docConfirms.remote_id).toBeUndefined();
    expect(s.docConfirms.manual?.eventId).toBe(d2.id);
    expect(s.docConfirms.permit?.eventId).toBe(pending.id);
    expect(state([d1], {}).docConfirms.remote_id?.eventId).toBe(d1.id);
  });
  it("次の飛行が始まっている着陸は取り消せない（later_flight_exists）。最後の着陸は取り消せる", () => {
    const t1 = takeoff("13:10");
    const l1 = landing(t1, "13:30");
    const t2 = takeoff("14:10");
    const events = [t1, l1, t2];
    const r1 = decideTransition(events, state(events), { kind: "undo", targetEventId: l1.id }, { planCancelled: false });
    expect(r1).toEqual({ ok: false, status: 409, code: "later_flight_exists" });
    const t2l = landing(t2, "14:30");
    const all = [t1, l1, t2, t2l];
    expect(decideTransition(all, state(all), { kind: "undo", targetEventId: t2l.id }, { planCancelled: false }).ok).toBe(true);
    expect(decideTransition(all, state(all), { kind: "undo", targetEventId: l1.id }, { planCancelled: false })).toMatchObject({ ok: false, code: "later_flight_exists" });
  });
  it("takeoffGaps：通報が要確認（reportUnverified）なら通報の未了を出す（二重には出さない）", () => {
    const base = { requirementKind: "required", reportStatusCode: "reported", effectiveReportedAt: "2027-01-04T10:00", takeoffAtJst: "2027-01-05T13:10", planState: "approved" as const, judgementStale: false };
    const checks = state([check("emergency_airspace", "not_designated"), check("carry"), check("report_recheck")], { inspections: [insp("i", "12:00")] }).checks;
    expect(takeoffGaps({ ...base, checks, reportUnverified: true })).toEqual([{ item: "report", state: "none" }]);
    expect(takeoffGaps({ ...base, checks, reportStatusCode: "no_record", reportUnverified: true }).filter((g) => g.item === "report")).toHaveLength(1);
    expect(takeoffGaps({ ...base, checks })).toEqual([]);
  });
});

describe("再評価後のユーザー決定（日誌済みのラウンドの確認）", () => {
  it("日誌済みの飛行のラウンドに属するラウンドごとの確認（空域・飛行自粛要請・現場状況）は取り消せない（round_journaled）。計画ごとの確認は取り消せる", () => {
    const em = check("emergency_airspace", "not_designated", "13:00");
    const rs = check("flight_restriction", "done", "13:01");
    const st = check("site_conditions", "done", "13:02", { site: { thirdParty: "none", otherAircraft: "none", rain: "none", visibility: "good", windMs: null, tempC: null } });
    const cr = check("carry", "done", "13:03");
    const dc = check("docs_confirm", "done", "13:04", { docKey: "manual" });
    const t1 = takeoff("13:10");
    const l1 = landing(t1, "13:30");
    const j1 = journal(t1, "r1");
    const events = [em, rs, st, cr, dc, t1, l1, j1];
    const s = state(events, { flightRecords: [{ id: "r1", voided: false }] });
    for (const target of [em, rs, st]) {
      expect(decideTransition(events, s, { kind: "undo", targetEventId: target.id }, { planCancelled: false })).toEqual({ ok: false, status: 409, code: "round_journaled" });
    }
    for (const target of [cr, dc]) expect(decideTransition(events, s, { kind: "undo", targetEventId: target.id }, { planCancelled: false }).ok).toBe(true);
    // 日誌に記録していない（日誌待ち）なら取り消せる
    const ev2 = [em, t1, l1];
    expect(decideTransition(ev2, state(ev2), { kind: "undo", targetEventId: em.id }, { planCancelled: false }).ok).toBe(true);
    // 次のラウンド（着陸の後）の確認は、前の飛行が日誌済みでも取り消せる
    const em2 = check("emergency_airspace", "not_designated", "14:00");
    const ev3 = [...events, em2];
    expect(decideTransition(ev3, state(ev3, { flightRecords: [{ id: "r1", voided: false }] }), { kind: "undo", targetEventId: em2.id }, { planCancelled: false }).ok).toBe(true);
  });
});

describe("Sprint 15：送信待ちの点検・日誌を導出に足す（圏外の画面）", () => {
  it("送信待ちの飛行後点検はその飛行の飛行後点検に、送信待ちの日誌は日誌済みに数える", async () => {
    const { outboxAsInspections } = await import("./field-logic");
    const t1 = takeoff("13:10");
    const l1 = landing(t1, "13:30");
    const KEYS = ["general", "propeller", "frame", "communication", "propulsion", "power", "autopilot", "controller", "battery"];
    let ob = enqueue(emptyOutbox(), {
      clientEventId: uid(9001),
      kind: "inspection",
      occurredAt: `${DAY}T13:40`,
      inspection: { timing: "post_flight", aircraftId: uid(1), pilotId: uid(2), items: Object.fromEntries(KEYS.map((k) => [k, { result: "normal" }])) as never },
    });
    ob = enqueue(ob, {
      clientEventId: uid(9002),
      kind: "journal",
      occurredAt: `${DAY}T13:45`,
      journal: { aircraftId: uid(1), pilotId: uid(2), takeoffAt: `${DAY}T13:10`, landingAt: `${DAY}T13:30`, takeoffRef: t1.clientEventId, safetyIssue: false },
    });
    const s = state([t1, l1, ...outboxAsEvents(ob.entries)], { inspections: outboxAsInspections(ob.entries) });
    expect(s.flights[0]!.post).toMatchObject({ done: true, inspectionId: uid(9001) });
    expect(s.flights[0]!.phase).toBe("journaled");
    expect(s.pendingJournal).toEqual([]);
  });
});
