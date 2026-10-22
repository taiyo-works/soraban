// Sprint 12e 契約 5・8・16（単体）：入力検査・報告の状態・次にやること・認可・文言と範囲。
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { NEXT_ACTION_LABEL } from "@soraban/dips";
import {
  EVENT_TYPE_NONE,
  EVENT_TYPE_UNKNOWN,
  INCIDENT_CHANGED_SINCE_REPORT,
  INCIDENT_GUIDANCE_REVISION_1,
  INCIDENT_GUIDANCE_REVISIONS,
  incidentGuidance,
  type IncidentGuidanceRevisionData,
} from "@/lib/ops-incident";
import { INCIDENT_FORBIDDEN, NUMERIC_DEADLINE } from "@/lib/incident-words.test-helpers";
import { can, OPS_ACTIONS } from "./authz";
import {
  checkEventTypes,
  correctionRevision,
  INCIDENT_FIELD_LABELS,
  INCIDENT_VALIDATION_MESSAGE,
  incidentFactsSource,
  incidentNextActions,
  incidentReportState,
  validateIncident,
  validateIncidentCorrection,
  validateIncidentReport,
  type IncidentActionInput,
  type IncidentReportRecordLite,
} from "./incident-logic";

const FULL = {
  kind: "accident",
  occurredAt: "2027-01-05T11:30",
  summary: "着陸のときにプロペラが手に当たった",
  eventTypes: ["minor_injury"],
  peopleInjury: "yes",
  aircraftDamage: "no",
};

const codesOf = (r: ReturnType<typeof validateIncident>): Record<string, string> => (r.ok ? {} : r.codes);

describe("validateIncident（full）", () => {
  it("正しい入力から版の data を作る（source は office、detail_pending は偽、対応の状況は open）", () => {
    const r = validateIncident(FULL, "full");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toMatchObject({
      kind: "accident",
      occurred_at: "2027-01-05T11:30",
      event_types: ["minor_injury"],
      people_injury: "yes",
      aircraft_damage: "no",
      source: "office",
      detail_pending: false,
      follow_up_status: "open",
      follow_up_on: null,
      contacts_made: [],
    });
    expect(r.occurredAtDate.toISOString()).toBe("2027-01-05T02:30:00.000Z");
  });

  it("必須：区分・起きた日時・何が起きたか・事象の類型・けがの有無・機体の損傷。類型・けが・損傷に既定値を置かない（未選択は 400）", () => {
    for (const key of ["kind", "occurredAt", "summary", "peopleInjury", "aircraftDamage"] as const) {
      const { [key]: _omit, ...rest } = FULL;
      void _omit;
      expect(codesOf(validateIncident(rest, "full"))[key], key).toBe("required");
    }
    const { eventTypes: _e, ...noTypes } = FULL;
    void _e;
    expect(codesOf(validateIncident(noTypes, "full"))["eventTypes"]).toBe("event_types_required");
    expect(codesOf(validateIncident({ ...FULL, eventTypes: [] }, "full"))["eventTypes"]).toBe("event_types_required");
    expect(codesOf(validateIncident({ ...FULL, occurredAt: "2027/01/05 11:30" }, "full"))["occurredAt"]).toBe("time_format");
    expect(codesOf(validateIncident({ ...FULL, kind: "serious" }, "full"))["kind"]).toBe("unknown_value");
    expect(codesOf(validateIncident({ ...FULL, aircraftDamage: "maybe" }, "full"))["aircraftDamage"]).toBe("unknown_value");
  });

  it("none・unknown は単独（400 event_types_exclusive）。版にない類型（400 unknown_event_type）。重複（400 duplicate）", () => {
    const base = { ...FULL, peopleInjury: "no" };
    expect(codesOf(validateIncident({ ...base, eventTypes: [EVENT_TYPE_NONE, "property_damage"] }, "full"))["eventTypes"]).toBe("event_types_exclusive");
    expect(codesOf(validateIncident({ ...base, eventTypes: [EVENT_TYPE_UNKNOWN, "property_damage"] }, "full"))["eventTypes"]).toBe("event_types_exclusive");
    expect(codesOf(validateIncident({ ...base, eventTypes: [EVENT_TYPE_NONE, EVENT_TYPE_UNKNOWN] }, "full"))["eventTypes"]).toBe("event_types_exclusive");
    expect(codesOf(validateIncident({ ...base, eventTypes: ["aircraft_lost"] }, "full"))["eventTypes"]).toBe("unknown_event_type");
    expect(codesOf(validateIncident({ ...base, eventTypes: ["property_damage", "property_damage"] }, "full"))["eventTypes"]).toBe("duplicate");
    expect(codesOf(validateIncident({ ...base, eventTypes: "property_damage" }, "full"))["eventTypes"]).toBe("invalid");
    expect(validateIncident({ ...base, eventTypes: [EVENT_TYPE_NONE] }, "full").ok).toBe(true);
    expect(validateIncident({ ...base, eventTypes: ["loss_by_operation", "property_damage"] }, "full").ok).toBe(true);
    expect(checkEventTypes([EVENT_TYPE_UNKNOWN])).toEqual({ ok: true, value: [EVENT_TYPE_UNKNOWN] });
  });

  it("けががあるのに、けがの類型（重傷以上・軽傷）も「まだ分からない」もない → 400 injury_type_missing。重さはアプリが判定しない", () => {
    expect(codesOf(validateIncident({ ...FULL, eventTypes: ["property_damage"] }, "full"))["eventTypes"]).toBe("injury_type_missing");
    expect(codesOf(validateIncident({ ...FULL, eventTypes: [EVENT_TYPE_NONE] }, "full"))["eventTypes"]).toBe("injury_type_missing");
    for (const t of [["minor_injury"], ["death_or_serious_injury"], [EVENT_TYPE_UNKNOWN], ["minor_injury", "fire_in_flight"]]) {
      expect(validateIncident({ ...FULL, eventTypes: t }, "full").ok, t.join()).toBe(true);
    }
    // けがの有無が「わからない」「ない」なら、けがの類型は要らない
    expect(validateIncident({ ...FULL, peopleInjury: "unknown", eventTypes: ["property_damage"] }, "full").ok).toBe(true);
  });

  it("長さ・値域・人数・座標・連絡先・対応状況の整合を項目ごとの理由コードで返す", () => {
    const c = (over: Record<string, unknown>) => codesOf(validateIncident({ ...FULL, ...over }, "full"));
    expect(c({ summary: "あ".repeat(201) })["summary"]).toBe("too_long");
    expect(validateIncident({ ...FULL, summary: "あ".repeat(200) }, "full").ok).toBe(true);
    expect(c({ details: "あ".repeat(1001) })["details"]).toBe("too_long");
    expect(c({ factorsNote: "あ".repeat(501) })["factorsNote"]).toBe("too_long");
    expect(c({ actionsTaken: "あ".repeat(501) })["actionsTaken"]).toBe("too_long");
    expect(c({ preventionNote: "あ".repeat(501) })["preventionNote"]).toBe("too_long");
    expect(c({ placeName: "あ".repeat(101) })["placeName"]).toBe("too_long");
    expect(c({ phase: "hover" })["phase"]).toBe("unknown_value");
    expect(c({ injuredCount: 1000 })["injuredCount"]).toBe("out_of_range");
    expect(c({ injuredCount: -1 })["injuredCount"]).toBe("out_of_range");
    expect(c({ injuredCount: 2.5 })["injuredCount"]).toBe("invalid");
    expect(validateIncident({ ...FULL, injuredCount: 999 }, "full").ok).toBe(true);
    expect(validateIncident({ ...FULL, injuredCount: 0 }, "full").ok).toBe(true);
    expect(c({ peopleInjury: "no", eventTypes: [EVENT_TYPE_NONE], injuredCount: 1 })["injuredCount"]).toBe("injured_count_requires_injury");
    expect(c({ latitude: 35.4 })["longitude"]).toBe("coordinate_pair");
    expect(c({ longitude: 133.3 })["latitude"]).toBe("coordinate_pair");
    expect(c({ latitude: 91, longitude: 133 })["latitude"]).toBe("coordinate_range");
    expect(c({ latitude: 35.1234567, longitude: 133 })["latitude"]).toBe("coordinate_precision");
    expect(c({ contactsMade: ["emergency_119", "friend"] })["contactsMade"]).toBe("unknown_value");
    expect(c({ contactsMade: ["police_110", "police_110"] })["contactsMade"]).toBe("duplicate");
    expect(c({ followUpStatus: "done" })["followUpOn"]).toBe("follow_up_date_required");
    expect(c({ followUpOn: "2027-01-05" })["followUpOn"]).toBe("follow_up_date_not_allowed");
    expect(c({ followUpStatus: "done", followUpOn: "2027-02-30" })["followUpOn"]).toBe("invalid");
    expect(c({ planId: "not-a-uuid" })["planId"]).toBe("invalid");
    const ok = validateIncident(
      { ...FULL, latitude: 35.434238, longitude: 133.380508, contactsMade: ["emergency_119", "client"], followUpStatus: "done", followUpOn: "2027-01-06", injuredCount: 1 },
      "full",
    );
    expect(ok.ok && ok.data).toMatchObject({ latitude: 35.434238, longitude: 133.380508, contacts_made: ["emergency_119", "client"], follow_up_on: "2027-01-06", injured_count: 1 });
    for (const code of Object.keys(INCIDENT_VALIDATION_MESSAGE)) expect(INCIDENT_VALIDATION_MESSAGE[code]).toBeTruthy();
  });

  it("detailPending=true（簡易記録の詳細をまだ補わない訂正）のときだけ、何が起きたかを省略できる", () => {
    const { summary: _s, ...rest } = FULL;
    void _s;
    const r = validateIncident({ ...rest, detailPending: true }, "full");
    expect(r.ok && r.data).toMatchObject({ summary: null, detail_pending: true });
    expect(codesOf(validateIncident({ ...rest, detailPending: false }, "full"))["summary"]).toBe("required");
  });
});

describe("validateIncidentCorrection（訂正。類型のデータの版）", () => {
  // テスト用の版 2：版 1 の loss_by_operation を廃止し、property_damage を damage_to_property に改名した（いまの版を 2 とする）
  const rev2: IncidentGuidanceRevisionData = {
    ...INCIDENT_GUIDANCE_REVISION_1,
    revision: 2,
    status: "unconfirmed",
    source: "テスト用の出典（原本照合前）",
    confirmedOn: null,
    confirmedBy: null,
    eventTypes: INCIDENT_GUIDANCE_REVISION_1.eventTypes
      .filter((t) => t.key !== "loss_by_operation")
      .map((t) => (t.key === "property_damage" ? { ...t, key: "damage_to_property" } : t)),
  };
  const table = [...INCIDENT_GUIDANCE_REVISIONS, rev2];
  /** 版 1 で保存した記録（版 1 にしかないキーを持つ）。 */
  const stored = { eventTypes: ["loss_by_operation", "property_damage"], revision: 1 };
  const base = { ...FULL, kind: "near_miss", peopleInjury: "no", aircraftDamage: "yes", eventTypes: stored.eventTypes, followUpStatus: "open", followUpOn: null };
  const correct = (input: Record<string, unknown>) => validateIncidentCorrection({ ...base, ...input }, input, stored, 2, table);

  it("前提：版 1 にしかないキーは、いまの版 2 で検査すると unknown_event_type になる", () => {
    expect(codesOf(validateIncident(base, "full", 2, table))["eventTypes"]).toBe("unknown_event_type");
  });

  it("類型を変えない訂正（対応状況だけ・概要の訂正・同じ組を並べ替えて送る）は保存済みの版 1 で検査して通り、目安も版 1 で計算する", () => {
    const status = correct({ followUpStatus: "done", followUpOn: "2027-01-05" });
    expect(status.revision).toBe(1);
    expect(status.v.ok && status.v.data).toMatchObject({ follow_up_status: "done", follow_up_on: "2027-01-05", event_types: stored.eventTypes });
    const summary = correct({ summary: "倉庫の壁に機体が接触した（訂正）", eventTypes: ["property_damage", "loss_by_operation"] });
    expect(summary.revision).toBe(1);
    expect(summary.v.ok && summary.v.data).toMatchObject({ summary: "倉庫の壁に機体が接触した（訂正）" });
    if (!summary.v.ok) return;
    expect(incidentGuidance(summary.v.data.event_types, summary.revision, table)).toMatchObject({ level: "possible", revision: 1, reasons: ["property_damage"] });
  });

  it("類型を変える訂正は、いまの版 2 で検査し（版 1 にしかないキーは 400）、版 2 で目安を再計算する", () => {
    const old = correct({ eventTypes: ["loss_by_operation"] });
    expect(old.revision).toBe(2);
    expect(codesOf(old.v)["eventTypes"]).toBe("unknown_event_type");
    const renamed = correct({ eventTypes: ["damage_to_property"] });
    expect(renamed.revision).toBe(2);
    expect(renamed.v.ok).toBe(true);
    if (!renamed.v.ok) return;
    expect(incidentGuidance(renamed.v.data.event_types, renamed.revision, table)).toMatchObject({ level: "possible", revision: 2, reasons: ["damage_to_property"] });
    // 重複・配列でない値は「変える」として、いまの版の検査が理由を返す
    expect(codesOf(correct({ eventTypes: ["property_damage", "property_damage", "loss_by_operation"] }).v)["eventTypes"]).toBe("duplicate");
    expect(codesOf(correct({ eventTypes: null }).v)["eventTypes"]).toBe("event_types_required");
  });

  it("correctionRevision：入力に無い・同じ組なら保存済みの版、違う組・配列でなければいまの版", () => {
    expect(correctionRevision(undefined, stored, 2)).toBe(1);
    expect(correctionRevision(["property_damage", "loss_by_operation"], stored, 2)).toBe(1);
    expect(correctionRevision(["property_damage"], stored, 2)).toBe(2);
    expect(correctionRevision("property_damage", stored, 2)).toBe(2);
    // 版 1 しかない現在は、どちらでも版 1（いまの挙動のまま）
    expect(correctionRevision(["none"], { eventTypes: ["minor_injury"], revision: 1 })).toBe(1);
  });
});

describe("validateIncident（quick）", () => {
  it("区分・起きた日時・けがの有無だけが必須。類型は unknown、機体の損傷は unknown、detail_pending は真、source は field_quick", () => {
    const r = validateIncident({ kind: "near_miss", occurredAt: "2027-01-05T11:58", peopleInjury: "no", planId: "11111111-1111-4111-8111-111111111111", queued: true }, "quick");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.queued).toBe(true);
    expect(r.data).toMatchObject({
      event_types: [EVENT_TYPE_UNKNOWN],
      aircraft_damage: "unknown",
      detail_pending: true,
      source: "field_quick",
      summary: null,
      plan_id: "11111111-1111-4111-8111-111111111111",
    });
    for (const key of ["kind", "occurredAt", "peopleInjury"] as const) {
      const full = { kind: "near_miss", occurredAt: "2027-01-05T11:58", peopleInjury: "no" };
      const { [key]: _o, ...rest } = full;
      void _o;
      expect(codesOf(validateIncident(rest, "quick"))[key], key).toBe("required");
    }
  });

  it("自由記述・座標・類型・機体の損傷は読まない（端末に個人データを残さない形と同じ）", () => {
    const r = validateIncident(
      { kind: "accident", occurredAt: "2027-01-05T11:58", peopleInjury: "yes", summary: "x", details: "y", latitude: 35, longitude: 133, eventTypes: ["minor_injury"], aircraftDamage: "yes" },
      "quick",
    );
    expect(r.ok && r.data).toMatchObject({ summary: null, details: null, latitude: null, longitude: null, event_types: [EVENT_TYPE_UNKNOWN], aircraft_damage: "unknown" });
  });
});

describe("validateIncidentReport", () => {
  const reported = { action: "reported", doneAt: "2027-01-05T15:00", channel: "dips", reference: "R-0001", checks: { reportCompleted: true } };
  const rc = (b: Record<string, unknown>) => {
    const r = validateIncidentReport(b);
    return r.ok ? {} : r.codes;
  };
  it("reported：DIPS 2.0／その他。番号か「表示されなかった」のどちらか一方。確認のチェックが欠けると保存できない", () => {
    const ok = validateIncidentReport(reported);
    expect(ok.ok && ok.data).toMatchObject({ action: "reported", done_at: "2027-01-05T15:00", channel: "dips", reference: "R-0001", reference_absent: false, checks: { reportCompleted: true } });
    expect(validateIncidentReport({ ...reported, reference: undefined, referenceAbsent: true }).ok).toBe(true);
    expect(rc({ ...reported, referenceAbsent: true })["reference"]).toBe("reference_or_absent");
    expect(rc({ ...reported, reference: undefined })["reference"]).toBe("reference_or_absent");
    expect(rc({ ...reported, checks: {} })["checks"]).toBe("checks_required");
    expect(rc({ ...reported, checks: { reportCompleted: false } })["checks"]).toBe("checks_required");
    expect(rc({ ...reported, checks: undefined })["checks"]).toBe("checks_required");
    expect(rc({ ...reported, channel: "other" })["channelNote"]).toBe("required");
    expect(validateIncidentReport({ ...reported, channel: "other", channelNote: "電子メール" }).ok).toBe(true);
    expect(rc({ ...reported, channelNote: "x" })["channelNote"]).toBe("not_allowed");
    expect(rc({ ...reported, doneAt: undefined })["doneAt"]).toBe("required");
    expect(rc({ ...reported, doneAt: "2027-01-05 15:00" })["doneAt"]).toBe("time_format");
    expect(rc({ ...reported, reference: "あ".repeat(51) })["reference"]).toBe("too_long");
    expect(rc({ ...reported, channel: "fax" })["channel"]).toBe("unknown_value");
  });
  it("consulted：note 必須・確認のチェック。retract：取り下げる行と理由が必須", () => {
    expect(validateIncidentReport({ action: "consulted", doneAt: "2027-01-05T16:00", note: "航空局の窓口に確かめた", checks: { consultationDone: true } }).ok).toBe(true);
    expect(rc({ action: "consulted", doneAt: "2027-01-05T16:00", checks: { consultationDone: true } })["note"]).toBe("required");
    expect(rc({ action: "consulted", doneAt: "2027-01-05T16:00", note: "x", checks: { reportCompleted: true } })["checks"]).toBe("checks_required");
    expect(validateIncidentReport({ action: "retract", targetRecordId: "11111111-1111-4111-8111-111111111111", reason: "誤って記録した" }).ok).toBe(true);
    expect(rc({ action: "retract", reason: "x" })["targetRecordId"]).toBe("required");
    expect(rc({ action: "retract", targetRecordId: "11111111-1111-4111-8111-111111111111" })["reason"]).toBe("required");
    expect(rc({ action: "submit" })["action"]).toBe("unknown_value");
    expect(rc({})["action"]).toBe("required");
  });
});

describe("incidentReportState（行から導出。保存しない）", () => {
  const rec = (id: string, action: IncidentReportRecordLite["action"], fp = "fp1", targetRecordId: string | null = null): IncidentReportRecordLite => ({
    id,
    action,
    targetRecordId,
    factsFingerprint: fp,
  });
  it("なし・報告・要否を確かめた・取り下げ・内容が変わった", () => {
    expect(incidentReportState([], "fp1")).toMatchObject({ code: "none", changedSinceReport: false });
    expect(incidentReportState([rec("a", "consulted")], "fp1")).toMatchObject({ code: "consulted", changedSinceReport: false });
    expect(incidentReportState([rec("a", "consulted"), rec("b", "reported")], "fp1")).toMatchObject({ code: "reported", activeIds: ["a", "b"] });
    // 取り下げた行は有効から外れ、元の行は残る（一覧に残る）
    const withRetract = [rec("b", "reported"), rec("c", "retract", "fp1", "b")];
    expect(incidentReportState(withRetract, "fp1")).toMatchObject({ code: "none", activeIds: [], retractedIds: ["b"] });
    // 記録のあとで事実が変わった
    expect(incidentReportState([rec("b", "reported", "fp1")], "fp2")).toMatchObject({ code: "reported", changedSinceReport: true });
    // 現在の事実で要否を確かめ直すと「変わった」は消える
    expect(incidentReportState([rec("b", "reported", "fp1"), rec("d", "consulted", "fp2")], "fp2").changedSinceReport).toBe(false);
  });
  it("指紋の元は、事象の類型（並べ替え）・区分・けがの有無・人数だけ", () => {
    const a = incidentFactsSource({ kind: "accident", event_types: ["minor_injury", "fire_in_flight"], people_injury: "yes", injured_count: 1 });
    const b = incidentFactsSource({ kind: "accident", event_types: ["fire_in_flight", "minor_injury"], people_injury: "yes", injured_count: 1 });
    expect(a).toBe(b);
    expect(incidentFactsSource({ kind: "near_miss", event_types: ["minor_injury", "fire_in_flight"], people_injury: "yes", injured_count: 1 })).not.toBe(a);
    expect(incidentFactsSource({ kind: "accident", event_types: ["minor_injury", "fire_in_flight"], people_injury: "yes", injured_count: 2 })).not.toBe(a);
  });
});

describe("incidentNextActions（記録の有無から毎回導出）", () => {
  const NOW = new Date("2027-01-05T03:00:00Z");
  const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
  const input = (over: Partial<IncidentActionInput> = {}): IncidentActionInput => ({
    id: "inc-1",
    label: "プロペラが手に当たった",
    occurredAt: new Date("2027-01-05T02:30:00Z"),
    occurredDate: "2027-01-05",
    now: NOW,
    today: "2027-01-05",
    voided: false,
    guidanceLevel: "possible",
    reportState: { code: "none", changedSinceReport: false },
    detailPending: false,
    planId: null,
    planTitle: null,
    can: { report: true, update: true },
    ...over,
  });
  const ids = (list: ReturnType<typeof incidentNextActions>) => list.map((a) => a.id);

  it("報告の要否を確認する（tier 1）：目安が possible で報告・確認の記録がない。日数が経っても消えない（1・30・365 日）", () => {
    const a = incidentNextActions([input()]);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ id: "confirm_incident_report", tier: 1, label: NEXT_ACTION_LABEL.confirm_incident_report, href: "/ops/incidents/inc-1#report", canAct: true, planId: null });
    for (const days of [1, 30, 365]) {
      const today = addDays("2027-01-05", days);
      const now = new Date(NOW.getTime() + days * 86_400_000);
      expect(ids(incidentNextActions([input({ today, now })])), `${days} 日`).toEqual(["confirm_incident_report"]);
    }
  });

  it("消えるのは、報告の記録・要否を確かめた記録が付いたとき、目安が none_selected のとき、取消のときだけ。内容が変わると再び出る", () => {
    expect(ids(incidentNextActions([input({ reportState: { code: "reported", changedSinceReport: false } })]))).toEqual([]);
    expect(ids(incidentNextActions([input({ reportState: { code: "consulted", changedSinceReport: false } })]))).toEqual([]);
    expect(ids(incidentNextActions([input({ guidanceLevel: "none_selected" })]))).toEqual([]);
    expect(ids(incidentNextActions([input({ voided: true, detailPending: true })]))).toEqual([]);
    const changed = incidentNextActions([input({ reportState: { code: "reported", changedSinceReport: true } })]);
    expect(ids(changed)).toEqual(["confirm_incident_report"]);
    expect(changed[0]!.reason).toContain(INCIDENT_CHANGED_SINCE_REPORT);
    // 目安が none_selected なら、事実が変わっても出さない
    expect(ids(incidentNextActions([input({ guidanceLevel: "none_selected", reportState: { code: "reported", changedSinceReport: true } })]))).toEqual([]);
  });

  it("詳細を記入する（tier 3）：簡易記録で起きた日から 14 日以内（14 日目は出る、15 日目は出ない）", () => {
    const pend = (days: number) =>
      incidentNextActions([input({ detailPending: true, guidanceLevel: "possible", reportState: { code: "consulted", changedSinceReport: false }, today: addDays("2027-01-05", days) })]);
    expect(pend(0)[0]).toMatchObject({ id: "complete_incident_detail", tier: 3, label: NEXT_ACTION_LABEL.complete_incident_detail, href: "/ops/incidents/inc-1#correct" });
    expect(ids(pend(14))).toEqual(["complete_incident_detail"]);
    expect(ids(pend(15))).toEqual([]);
  });

  it("canAct は報告（要否の確認）と訂正（詳細の記入）の権限を写す。記録を足すだけで一覧が変わる（保存した状態を読まない）", () => {
    const a = incidentNextActions([input({ detailPending: true, can: { report: false, update: false } })]);
    expect(a.map((x) => [x.id, x.canAct])).toEqual([
      ["confirm_incident_report", false],
      ["complete_incident_detail", false],
    ]);
    const two = incidentNextActions([input(), input({ id: "inc-2", planId: "p", planTitle: "計画" })]);
    expect(two.map((x) => x.href)).toEqual(["/ops/incidents/inc-1#report", "/ops/incidents/inc-2#report"]);
    expect(two[1]).toMatchObject({ planId: "p", planTitle: "計画" });
    // 期限の日付を作らない
    expect(JSON.stringify(two.map((x) => [x.reason, x.dueLabel]))).not.toMatch(NUMERIC_DEADLINE);
    expect(two.every((x) => x.dueLabel === null)).toBe(true);
  });

  it("表示名は動詞で終わる 1 行", () => {
    expect(NEXT_ACTION_LABEL.confirm_incident_report).toBe("事故・ヒヤリハットの報告の要否を確認する");
    expect(NEXT_ACTION_LABEL.complete_incident_detail).toBe("事故・ヒヤリハットの詳細を記入する");
  });
});

describe("can（incident.* × 全役割 × isSelf。設計 D）", () => {
  const expected: Record<string, (role: string, isSelf: boolean | undefined) => boolean> = {
    "incident.read": () => true,
    "incident.create": (role) => role === "manager" || role === "pilot",
    "incident.update": (role, isSelf) => role === "manager" || (role === "pilot" && isSelf === true),
    "incident.report": (role, isSelf) => role === "manager" || (role === "pilot" && isSelf === true),
    "incident.void": (role) => role === "manager",
  };
  it("OPS_ACTIONS に入っていて、全組合せが表と一致する", () => {
    for (const [action, fn] of Object.entries(expected)) {
      expect(OPS_ACTIONS).toContain(action);
      for (const role of ["manager", "pilot", "viewer"] as const) {
        for (const isSelf of [undefined, true, false]) {
          expect(can(role, action as never, { isSelf }), `${role}/${action}/${isSelf}`).toBe(fn(role, isSelf));
        }
      }
    }
    expect(OPS_ACTIONS.filter((a) => a.startsWith("incident."))).toHaveLength(5);
  });
});

// ---- 文言と範囲（契約 16） ----
const WEB_SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
const INCIDENT_SOURCES = [
  path.join(WEB_SRC, "lib", "ops-incident.ts"),
  path.join(WEB_SRC, "server", "ops", "incident-logic.ts"),
  path.join(WEB_SRC, "server", "ops", "incidents.ts"),
  ...walk(path.join(WEB_SRC, "app", "api", "ops", "incidents")),
  path.join(WEB_SRC, "app", "api", "ops", "plans", "[id]", "incidents", "route.ts"),
  path.join(WEB_SRC, "app", "api", "ops", "flights", "[id]", "incidents", "route.ts"),
];

describe("文言と範囲（12e の新しいソース）", () => {
  it("禁止語・数値の期限の表現・条番号・URL・外部への通信がない。「責任」は N1 の定数の中だけ", () => {
    expect(INCIDENT_SOURCES.length).toBeGreaterThanOrEqual(9);
    for (const f of INCIDENT_SOURCES) {
      const text = readFileSync(f, "utf8");
      const rel = path.relative(WEB_SRC, f);
      for (const w of INCIDENT_FORBIDDEN) expect(text, `${rel}: ${w}`).not.toContain(w);
      expect(text, rel).not.toMatch(NUMERIC_DEADLINE);
      expect(text, rel).not.toMatch(/https?:\/\//);
      expect(text, rel).not.toMatch(/第[0-9０-９一二三四五六七八九十百]+条/);
      expect(text, rel).not.toMatch(/\bfetch\(|XMLHttpRequest|WebSocket|node:https?|from "undici"/);
      const lines = text.split("\n").filter((l) => l.includes("責任") && !/^(\/\/|\/\*|\*)/.test(l.trim()));
      if (rel !== path.join("lib", "ops-incident.ts")) expect(lines, rel).toEqual([]);
      else expect(lines.every((l) => l.includes("責任の所在を示すものではありません"))).toBe(true);
    }
  });

  it("版の履歴の項目名は、版の data のキーを網羅する", () => {
    for (const k of ["kind", "occurred_at", "event_types", "people_injury", "aircraft_damage", "summary", "guidance_level", "snapshot_id"]) {
      expect(INCIDENT_FIELD_LABELS[k], k).toBeTruthy();
    }
  });
});
