// Sprint 12c：現場モードの共通の定数・時刻の規則・文言（契約 3 の時刻の検査、契約 5・15・18 の禁止語・条番号）。
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  EMERGENCY_DESIGNATED_WARNING,
  EMERGENCY_SOURCE_OPTIONS,
  FIELD_CHECK_ACTION_LABEL,
  FIELD_ERROR_MESSAGE,
  FIELD_GAP_ITEM_LABEL,
  FIELD_GAP_STATE_LABEL,
  FIELD_REPORT_NOT_REQUIRED_MODEL,
  FIELD_REPORT_NOT_REQUIRED_RECOMMENDED,
  checkFieldTime,
  fieldErrorMessage,
  fieldGapLabel,
  fieldHref,
  formatElapsed,
  inspectionNewHref,
  isEmergencySource,
  journalNewHref,
  landingRecordedMessage,
  outsidePlanWindowLabel,
  takeoffRecordedMessage,
} from "./ops-field";
import { MODEL_AIRCRAFT_REFERENCES } from "@soraban/regulations";

const FORBIDDEN = ["通報不要", "通報は不要", "通報の必要はありません", "通報しなくて", "特許", "出願"];
const jst = (s: string): Date => new Date(`${s}:00+09:00`);

describe("checkFieldTime（時刻の検査）", () => {
  const now = jst("2027-01-05T12:00");
  it("その場の送信：現在から ±5 分以内は可。それを超えると clock_skew", () => {
    expect(checkFieldTime(jst("2027-01-05T12:00"), now, false)).toEqual({ ok: true });
    expect(checkFieldTime(jst("2027-01-05T11:55"), now, false)).toEqual({ ok: true });
    expect(checkFieldTime(jst("2027-01-05T12:05"), now, false)).toEqual({ ok: true });
    expect(checkFieldTime(jst("2027-01-05T11:54"), now, false)).toEqual({ ok: false, code: "clock_skew" });
  });
  it("未来：5 分を超えると future_time（その場の送信でも送信待ちでも。未来の検査が先）", () => {
    expect(checkFieldTime(jst("2027-01-05T12:06"), now, false)).toEqual({ ok: false, code: "future_time" });
    expect(checkFieldTime(jst("2027-01-05T12:06"), now, true)).toEqual({ ok: false, code: "future_time" });
    expect(checkFieldTime(jst("2027-01-05T12:05"), now, true)).toEqual({ ok: true });
  });
  it("送信待ち：72 時間前まで可。それより古いと too_old", () => {
    expect(checkFieldTime(jst("2027-01-05T11:00"), now, true)).toEqual({ ok: true });
    expect(checkFieldTime(jst("2027-01-02T12:00"), now, true)).toEqual({ ok: true });
    expect(checkFieldTime(jst("2027-01-02T11:59"), now, true)).toEqual({ ok: false, code: "too_old" });
  });
  it("理由の文言：clock_skew は時刻の設定（自動）を案内する", () => {
    expect(fieldErrorMessage("clock_skew")).toBe("端末の時刻がずれています。時刻の設定（自動）を確かめてください。");
    expect(fieldErrorMessage("too_old")).toContain("あとから入力");
    expect(fieldErrorMessage("unknown_code_xyz")).toBe("送れませんでした。");
  });
});

describe("緊急用務空域の情報源", () => {
  it("@soraban/regulations の参照先の定数だけが選択肢（名称・URL を新しく作らない）", () => {
    expect(EMERGENCY_SOURCE_OPTIONS.length).toBeGreaterThan(0);
    for (const o of EMERGENCY_SOURCE_OPTIONS) {
      const ref = MODEL_AIRCRAFT_REFERENCES.find((r) => r.id === o.id);
      expect(ref, o.id).toBeDefined();
      expect(o.title).toBe(ref!.title);
      expect(o.url).toBe(ref!.url);
    }
    expect(isEmergencySource("mlit-emergency-airspace-qa")).toBe(true);
    expect(isEmergencySource("自由入力")).toBe(false);
    expect(isEmergencySource(undefined)).toBe(false);
  });
  it("「指定されている」の警告は飛行できない旨で、記録は残ることを示す", () => {
    expect(EMERGENCY_DESIGNATED_WARNING).toContain("飛行できません");
    expect(EMERGENCY_DESIGNATED_WARNING).toContain("記録は残ります");
  });
});

describe("文言", () => {
  it("離陸の記録の帯：未了事項があっても「記録しました」。止める文言にしない", () => {
    expect(takeoffRecordedMessage("14:03", [])).toBe("離陸 14:03 を記録しました。");
    const m = takeoffRecordedMessage("14:03", [
      { item: "inspection", state: "none" },
      { item: "report", state: "after_takeoff" },
    ]);
    expect(m).toBe("離陸 14:03 を記録しました。次の項目が未了です：日常点検（記録なし）、通報（記録が離陸より後）");
    expect(landingRecordedMessage("14:30")).toBe("着陸 14:30 を記録しました。");
    expect(m).not.toMatch(/できません|禁止|中止/);
  });
  it("未了事項の表示：運航管理者の確認の stale は「前の版への確認」", () => {
    expect(fieldGapLabel({ item: "confirmation", state: "stale" })).toBe("運航管理者の確認（前の版への確認）");
    expect(fieldGapLabel({ item: "judgement", state: "stale" })).toBe("判定（古い）");
  });
  it("時間帯の外の文言は分数つき", () => {
    expect(outsidePlanWindowLabel(12, 0)).toBe("計画の時間帯の外で飛行しています（離陸が 12 分早い）。");
    expect(outsidePlanWindowLabel(0, 8)).toBe("計画の時間帯の外で飛行しています（着陸が 8 分遅い）。");
  });
  it("経過時間の表示", () => {
    expect(formatElapsed(0)).toBe("0:00:00");
    expect(formatElapsed(65_000)).toBe("0:01:05");
    expect(formatElapsed(3_725_000)).toBe("1:02:05");
    expect(formatElapsed(-5)).toBe("0:00:00");
  });
  it("経路", () => {
    expect(fieldHref("p1")).toBe("/ops/plans/p1/field");
    expect(fieldHref("p1", "journal")).toBe("/ops/plans/p1/field#journal");
    expect(inspectionNewHref("p1")).toBe("/ops/inspections/new?planId=p1&returnTo=%2Fops%2Fplans%2Fp1%2Ffield%23preflight");
    expect(journalNewHref("p1")).toBe("/ops/flights/new?planId=p1");
    expect(journalNewHref("p1", "t1")).toBe("/ops/flights/new?planId=p1&takeoffEventId=t1");
  });
  it("禁止語（通報を免除する言い方・特許・出願）がどの文言にもない。推奨・対象外は「必須としません」と書く", () => {
    const all = JSON.stringify([
      FIELD_ERROR_MESSAGE,
      FIELD_GAP_ITEM_LABEL,
      FIELD_GAP_STATE_LABEL,
      FIELD_CHECK_ACTION_LABEL,
      FIELD_REPORT_NOT_REQUIRED_MODEL,
      FIELD_REPORT_NOT_REQUIRED_RECOMMENDED,
      EMERGENCY_DESIGNATED_WARNING,
    ]);
    for (const w of FORBIDDEN) expect(all, w).not.toContain(w);
    expect(FIELD_REPORT_NOT_REQUIRED_RECOMMENDED).toContain("必須としません");
    expect(FIELD_REPORT_NOT_REQUIRED_MODEL).toContain("必須としません");
  });
});

// 契約 18：新しいファイルに、禁止語・特許・出願の表示・法令の条番号の直書きがない（条番号は model-aircraft.ts の定数経由だけ）。
describe("Sprint 12c の新しいソースの grep", () => {
  const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const files = [
    "lib/ops-field.ts",
    "lib/ops-outbox.ts",
    "lib/wake-lock.ts",
    "server/ops/field.ts",
    "server/ops/field-logic.ts",
    "server/ops/field-rows.ts",
    "server/ops/flight-extras.ts",
    "server/ops/journal-logic.ts",
    "server/ops/today.ts",
    "server/ops/today-logic.ts",
    "server/ops/validate-field.ts",
  ];
  for (const f of files) {
    it(`${f}：禁止語・条番号の直書き・外部通信がない`, () => {
      const src = readFileSync(path.join(web, f), "utf8");
      for (const w of FORBIDDEN) expect(src, w).not.toContain(w);
      expect(src).not.toMatch(/第\s*\d+\s*条/);
      // DIPS・外部への送信を作らない（現場モードは自分のサーバーの API だけを呼ぶ）
      expect(src).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|sendBeacon|https?:\/\//);
    });
  }
});
