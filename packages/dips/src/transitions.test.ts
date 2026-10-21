// Sprint 12b 契約 11：遷移表（1 か所）と、結果不明の扱い。
import { describe, expect, it } from "vitest";
import {
  allowedNext,
  assertTransition,
  canTransition,
  effectiveState,
  isPreparedStale,
  PREPARED_STALE_MINUTES,
  REPORT_TRANSITIONS,
  TransitionError,
} from "./transitions";
import { REPORT_CHANNELS, REPORT_STATES, type ReportChannel, type ReportState } from "./types";

type Edge = readonly [ReportState | null, ReportState, ReportChannel];

const direct: ReportChannel[] = ["mock", "api"];

// 表（設計 E）をテストの側にもう一度書き下す。実装の表そのものを参照しない。
const EXPECTED: readonly Edge[] = [
  [null, "reported_manual", "manual"],
  ...direct.map((c): Edge => [null, "prepared", c]),
  ...direct.flatMap((c): Edge[] => [
    ["prepared", "submitted_api", c],
    ["prepared", "failed", c],
    ["prepared", "unknown", c],
    ["failed", "prepared", c],
    ["unknown", "submitted_api", c],
    ["unknown", "failed", c],
    ["unknown", "reported_manual", c],
  ]),
  ["reported_manual", "retracted", "manual"],
  ["reported_manual", "retracted", "mock"],
  ["reported_manual", "retracted", "api"],
];
const key = (e: Edge) => `${e[0] ?? "-"}>${e[1]}@${e[2]}`;

describe("遷移表", () => {
  const froms: (ReportState | null)[] = [null, ...REPORT_STATES];

  it("すべての（元の状態 × 先の状態 × 送信元）で、表にあるものだけが許可され、ないものは拒否される", () => {
    const allowed = new Set(EXPECTED.map(key));
    let checked = 0;
    for (const from of froms) {
      for (const to of REPORT_STATES) {
        for (const ch of REPORT_CHANNELS) {
          expect(canTransition(from, to, ch), key([from, to, ch])).toBe(allowed.has(key([from, to, ch])));
          checked++;
        }
      }
    }
    expect(checked).toBe(7 * 6 * 3);
  });

  it("表にない遷移は assertTransition が拒否する", () => {
    expect(() => assertTransition("reported_manual", "prepared", "manual")).toThrow(TransitionError);
    expect(() => assertTransition("submitted_api", "retracted", "mock")).toThrow(TransitionError);
    expect(() => assertTransition("retracted", "reported_manual", "manual")).toThrow(TransitionError);
    expect(() => assertTransition("unknown", "prepared", "mock")).toThrow(TransitionError);
    expect(assertTransition("failed", "prepared", "mock").via).toBe("retry");
  });

  it("手動の行は reported_manual を作り、retracted にだけ行ける。模擬の送信は prepared から始める", () => {
    expect(allowedNext(null, "manual")).toEqual(["reported_manual"]);
    expect(allowedNext(null, "mock")).toEqual(["prepared"]);
    expect(allowedNext("reported_manual", "manual")).toEqual(["retracted"]);
    expect(allowedNext("prepared", "mock").sort()).toEqual(["failed", "submitted_api", "unknown"]);
    expect(allowedNext("retracted", "manual")).toEqual([]);
  });

  it("failed は再送（prepared）だけ。unknown は確認の後に確定する（理由が必須）", () => {
    expect(allowedNext("failed", "mock")).toEqual(["prepared"]);
    for (const t of REPORT_TRANSITIONS.filter((x) => x.via === "resolve" || x.via === "retract")) expect(t.needsReason, `${t.from}>${t.to}`).toBe(true);
    for (const t of REPORT_TRANSITIONS.filter((x) => x.via === "retry")) expect(t.needsReason).toBe(false);
  });

  it("copied・cancelled は状態に無い", () => {
    expect(REPORT_STATES).not.toContain("copied" as never);
    expect(REPORT_STATES).not.toContain("cancelled" as never);
  });
});

describe("prepared のまま 5 分を超えた行は結果不明として扱い、自動で再送しない", () => {
  const T0 = new Date("2027-01-05T03:00:00Z");
  const row = (status: ReportState) => ({ status, updatedAt: T0 });
  const after = (min: number, sec = 0) => new Date(T0.getTime() + (min * 60 + sec) * 1000);

  it("5 分ちょうどまでは送信中、超えたら結果不明", () => {
    expect(PREPARED_STALE_MINUTES).toBe(5);
    expect(isPreparedStale(row("prepared"), after(4, 59))).toBe(false);
    expect(isPreparedStale(row("prepared"), after(5))).toBe(false);
    expect(isPreparedStale(row("prepared"), after(5, 1))).toBe(true);
    expect(effectiveState(row("prepared"), after(6))).toBe("unknown");
    expect(effectiveState(row("prepared"), after(1))).toBe("prepared");
  });

  it("prepared 以外は経過時間に依らず状態のまま", () => {
    for (const s of REPORT_STATES.filter((x) => x !== "prepared")) expect(effectiveState(row(s), after(600)), s).toBe(s);
  });

  it("超過した prepared は、unknown と同じ確定ができる（理由つき）。超過前は確定できず、再送の遷移も無い", () => {
    for (const to of ["submitted_api", "failed", "reported_manual"] as const) {
      expect(canTransition("prepared", to, "mock", { stale: true }), to).toBe(true);
    }
    expect(canTransition("prepared", "reported_manual", "mock", { stale: false })).toBe(false);
    // prepared → prepared（自動の再送）は表にない
    expect(canTransition("prepared", "prepared", "mock", { stale: true })).toBe(false);
    expect(allowedNext("prepared", "mock", { stale: true }).sort()).toEqual(["failed", "reported_manual", "submitted_api", "unknown"]);
  });
});
