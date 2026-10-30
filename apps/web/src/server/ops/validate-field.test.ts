// Sprint 12c 契約 3：現場の記録の入力検査（単体）。サーバーが決める値は読まない。日常点検は確認の行を持たない。
import { describe, expect, it } from "vitest";
import { validateFieldEvent } from "./validate-field";

const CID = "11111111-1111-4111-8111-111111111111";
const TID = "22222222-2222-4222-8222-222222222222";
const ok = (input: Record<string, unknown>) => {
  const r = validateFieldEvent(input);
  if (!r.ok) throw new Error(JSON.stringify(r.codes));
  return r.data;
};
const bad = (input: Record<string, unknown>) => {
  const r = validateFieldEvent(input);
  if (r.ok) throw new Error("通った");
  return r.codes;
};
const base = { clientEventId: CID, occurredAt: "2027-01-05T12:00" };

describe("validateFieldEvent", () => {
  it("離陸・着陸・取り消す・確認", () => {
    expect(ok({ ...base, kind: "takeoff" })).toMatchObject({ kind: "takeoff", clientEventId: CID, occurredAt: "2027-01-05T12:00", queued: false, note: null, targetRef: null });
    expect(ok({ ...base, kind: "landing" })).toMatchObject({ kind: "landing", targetRef: null });
    expect(ok({ ...base, kind: "landing", targetEventId: TID.toUpperCase() })).toMatchObject({ targetRef: TID });
    expect(ok({ ...base, kind: "undo", targetClientEventId: TID })).toMatchObject({ kind: "undo", targetRef: TID });
    expect(ok({ ...base, kind: "check", item: "carry" })).toMatchObject({ kind: "check", item: "carry", result: "done", source: null });
    expect(ok({ ...base, kind: "check", item: "report_recheck", result: "done" })).toMatchObject({ item: "report_recheck" });
    expect(ok({ ...base, kind: "takeoff", queued: true, note: "  メモ  " })).toMatchObject({ queued: true, note: "メモ" });
  });

  it("緊急用務空域：情報源と結果が必須。選択肢の外の情報源は拒否", () => {
    const src = "mlit-emergency-airspace-qa";
    expect(ok({ ...base, kind: "check", item: "emergency_airspace", result: "designated", source: src })).toMatchObject({ result: "designated", source: src });
    expect(ok({ ...base, kind: "check", item: "emergency_airspace", result: "not_designated", source: src })).toMatchObject({ result: "not_designated" });
    expect(bad({ ...base, kind: "check", item: "emergency_airspace", result: "not_designated" })).toEqual({ source: "required" });
    expect(bad({ ...base, kind: "check", item: "emergency_airspace", source: src })).toEqual({ result: "required" });
    expect(bad({ ...base, kind: "check", item: "emergency_airspace", result: "done", source: src })).toEqual({ result: "invalid" });
    expect(bad({ ...base, kind: "check", item: "emergency_airspace", result: "designated", source: "自由入力" })).toEqual({ source: "unknown_source" });
  });

  it("日常点検は確認の行を持たない（実際の点検の記録から導出）。項目なし・不明な項目は拒否", () => {
    expect(bad({ ...base, kind: "check", item: "inspection" })).toEqual({ item: "derived" });
    expect(bad({ ...base, kind: "check" })).toEqual({ item: "required" });
    expect(bad({ ...base, kind: "check", item: "unknown" })).toEqual({ item: "invalid" });
    expect(bad({ ...base, kind: "check", item: "carry", result: "designated" })).toEqual({ result: "invalid" });
  });

  it("識別子・種別・時刻・対象・メモの検査", () => {
    expect(bad({ occurredAt: base.occurredAt, kind: "takeoff" })).toEqual({ clientEventId: "required" });
    expect(bad({ ...base, clientEventId: "abc", kind: "takeoff" })).toEqual({ clientEventId: "invalid" });
    expect(bad({ ...base, kind: "journal_linked" })).toEqual({ kind: "not_recordable" });
    expect(bad({ ...base, kind: "dance" })).toEqual({ kind: "invalid" });
    expect(bad({ clientEventId: CID, kind: "takeoff" })).toEqual({ occurredAt: "required" });
    expect(bad({ ...base, occurredAt: "2027-01-05 12:00", kind: "takeoff" })).toEqual({ occurredAt: "time_format" });
    expect(bad({ ...base, occurredAt: "2027-01-05T12:00:30", kind: "takeoff" })).toEqual({ occurredAt: "time_format" });
    expect(bad({ ...base, occurredAt: "2027-02-30T12:00", kind: "takeoff" })).toEqual({ occurredAt: "time_format" });
    expect(bad({ ...base, kind: "undo" })).toEqual({ targetEventId: "required" });
    expect(bad({ ...base, kind: "undo", targetEventId: "x" })).toEqual({ targetEventId: "invalid" });
    expect(bad({ ...base, kind: "landing", targetEventId: TID, targetClientEventId: CID })).toEqual({ targetClientEventId: "target_conflict" });
    expect(bad({ ...base, kind: "takeoff", queued: "yes" })).toEqual({ queued: "invalid" });
    expect(bad({ ...base, kind: "takeoff", note: "あ".repeat(301) })).toEqual({ note: "too_long" });
    expect(ok({ ...base, kind: "takeoff", note: "あ".repeat(300) }).note).toHaveLength(300);
  });

  it("サーバー（DB）が決める値は読まない（snapshotId・planVersion・gaps・recordedAt・contentHash・recordedBy）", () => {
    const d = ok({
      ...base,
      kind: "takeoff",
      snapshotId: TID,
      planVersion: 99,
      gaps: [{ item: "inspection", state: "none" }],
      recordedAt: "2020-01-01T00:00:00Z",
      contentHash: "x",
      recordedByName: "偽",
      flightRecordId: TID,
    });
    expect(Object.keys(d).sort()).toEqual(["clientEventId", "kind", "note", "occurredAt", "occurredAtDate", "queued", "targetRef"]);
  });
});

// ---- Sprint 14：書類・手続きの確認、飛行自粛要請、現場状況 ----------------------------------------
describe("validateFieldEvent（Sprint 14）", () => {
  const SITE = { thirdParty: "none", otherAircraft: "none", rain: "none", visibility: "good", windMs: 4.5, tempC: -3 };
  it("書類・手続きの確認：docKey が必須（6 項目のどれか）", () => {
    expect(ok({ ...base, kind: "check", item: "docs_confirm", docKey: "remote_id" })).toMatchObject({ item: "docs_confirm", docKey: "remote_id", result: "done" });
    expect(bad({ ...base, kind: "check", item: "docs_confirm" })).toEqual({ docKey: "required" });
    expect(bad({ ...base, kind: "check", item: "docs_confirm", docKey: "other" })).toEqual({ docKey: "invalid" });
  });
  it("飛行自粛要請の確認", () => {
    expect(ok({ ...base, kind: "check", item: "flight_restriction" })).toMatchObject({ item: "flight_restriction", result: "done" });
  });
  it("C-6 現場状況：選択肢の外・風速と気温の範囲外は 400", () => {
    expect(ok({ ...base, kind: "check", item: "site_conditions", site: SITE })).toMatchObject({ site: SITE });
    expect(ok({ ...base, kind: "check", item: "site_conditions", site: { ...SITE, windMs: null, tempC: undefined } })).toMatchObject({
      site: { windMs: null, tempC: null },
    });
    expect(bad({ ...base, kind: "check", item: "site_conditions" })).toEqual({ site: "required" });
    expect(bad({ ...base, kind: "check", item: "site_conditions", site: { ...SITE, rain: "heavy" } })).toEqual({ "site.rain": "invalid" });
    expect(bad({ ...base, kind: "check", item: "site_conditions", site: { ...SITE, visibility: "none" } })).toEqual({ "site.visibility": "invalid" });
    expect(bad({ ...base, kind: "check", item: "site_conditions", site: { ...SITE, windMs: -1 } })).toEqual({ "site.windMs": "out_of_range" });
    expect(bad({ ...base, kind: "check", item: "site_conditions", site: { ...SITE, windMs: 1000 } })).toEqual({ "site.windMs": "out_of_range" });
    expect(bad({ ...base, kind: "check", item: "site_conditions", site: { ...SITE, tempC: 200 } })).toEqual({ "site.tempC": "out_of_range" });
    expect(bad({ ...base, kind: "check", item: "site_conditions", site: { ...SITE, windMs: "強い" } })).toEqual({ "site.windMs": "out_of_range" });
  });
  it("C-6 「いる／あり／制限あり」を選んで備考が空なら 400（note_required）。備考があれば通る", () => {
    for (const patch of [{ thirdParty: "present" }, { otherAircraft: "present" }, { rain: "present" }, { visibility: "limited" }]) {
      const site = { ...SITE, ...patch };
      expect(bad({ ...base, kind: "check", item: "site_conditions", site })).toEqual({ note: "note_required" });
      expect(bad({ ...base, kind: "check", item: "site_conditions", site, note: "  " })).toEqual({ note: "note_required" });
      expect(ok({ ...base, kind: "check", item: "site_conditions", site, note: "農道に歩行者" })).toMatchObject({ note: "農道に歩行者" });
    }
  });
});
