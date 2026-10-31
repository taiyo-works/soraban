// Sprint 15 契約 B-1・B-5・F-2：先読みの束の許可リストと、束から組み立てた画面の判定がサーバーと同じになること（単体）。
import { describe, expect, it } from "vitest";
import { judgeFieldDocs, type DocsJudgeInput } from "./docs-judge";
import {
  FIELD_BUNDLE_STALE_HOURS,
  composeFieldView,
  docsInputOf,
  fieldBundleIsStale,
  gapsFromInput,
  sanitizeFieldBundle,
  type FieldBundlePlan,
} from "./field-compose";
import { fieldState, type FieldEventLite } from "./field-logic";

const M = "11111111-1111-4111-8111-111111111111";
const P = "22222222-2222-4222-8222-222222222222";
const A = "33333333-3333-4333-8333-333333333333";
const PL = "44444444-4444-4444-8444-444444444444";
const uid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const T = (hm: string): string => new Date(`2027-01-05T${hm}:00+09:00`).toISOString();

const ev = (n: number, e: Partial<FieldEventLite> & Pick<FieldEventLite, "kind">): FieldEventLite => ({
  id: uid(n),
  clientEventId: uid(1000 + n),
  item: null,
  result: null,
  source: null,
  targetEventId: null,
  flightRecordId: null,
  inspectionId: null,
  reportId: null,
  occurredAt: T("11:00"),
  recordedKey: `2027-01-05T02:00:00.${String(n).padStart(6, "0")}Z`,
  queued: false,
  gaps: null,
  planVersion: 1,
  docKey: null,
  site: null,
  ...e,
});

const bundle = (over: Partial<FieldBundlePlan> = {}): FieldBundlePlan => ({
  v: 1,
  memberId: M,
  planId: P,
  fetchedAt: T("08:00"),
  plan: {
    id: P,
    title: "米子 空撮",
    plannedDate: "2027-01-05",
    plannedStartAtJst: "2027-01-05 13:00",
    plannedEndAtJst: "2027-01-05 14:00",
    timeLabel: "13:00〜14:00",
    durationMinutes: 60,
    registrationMark: "JU1234AB5678",
    modelName: "試験機",
    pilotName: "山田 太郎",
    placeName: "本社",
    permitNumbers: "P-001",
    permitStates: [{ numberText: "P-001", status: "applied", statusLabel: "適用" }],
    voided: false,
    state: "approved",
    stateLabel: "確認済み",
    verdictLevel: "needs_permit",
    verdictLabel: "許可が必要",
    judgementStale: false,
    isSelf: true,
    startIso: T("13:00"),
  },
  perms: { canRecord: true, canJournal: true, canInspect: true },
  report: {
    requirementKind: "required",
    requirementLabel: "通報が必要",
    statusCode: "reported",
    statusLabel: "DIPS で通報済み",
    statusMark: "✓",
    detail: "2027-01-05 11:00 受付番号 D-0001",
    effectiveReportId: "rep1",
    channelLabel: "手動（利用者の申告）",
    notRequiredNote: null,
    warning: null,
    reportHref: `/ops/plans/${P}/report`,
    canRecheck: true,
  },
  docs: {
    plannedStartAtJst: "2027-01-05T13:00",
    plannedEndAtJst: "2027-01-05T14:00",
    wantedKinds: ["night"],
    permits: [
      { numberText: "P-001", kinds: ["night"], status: "applied", registrationId: "r1", permitNumber: "P-001", versionNo: 2, validFrom: "2027-01-01", validTo: "2027-12-31", reasonLabels: [] },
    ],
    aircraft: { id: A, registrationMark: "JU1234AB5678", status: "active", voided: false },
    pilot: { id: PL, fullName: "山田 太郎", hasLicense: true, licenseExpiresOn: "2027-06-30", hasLimitation: false, voided: false },
    report: { requirementKind: "required", statusCode: "reported", effective: { id: "rep1", dipsNumber: "D-0001", numberUnavailable: false, reportedAtJst: "2027-01-05T11:00", recordedAtJst: "2027-01-05T11:05" } },
  },
  gap: { requirementKind: "required", reportStatusCode: "reported", effectiveReportedAt: "2027-01-05T11:05", planState: "approved", judgementStale: false },
  state: { events: [], inspections: [], flightRecords: [], planVersion: 1 },
  form: { aircraftId: A, pilotId: PL, specificFlightTypes: ["night"], lastInspection: null },
  ...over,
});

const roundTrip = (b: unknown): FieldBundlePlan => {
  const x = sanitizeFieldBundle(JSON.parse(JSON.stringify(b)));
  expect(x).not.toBeNull();
  return x!;
};

describe("B-1 先読みの束は許可リストの項目だけ", () => {
  it("技能証明書の番号・座標・自由記述・他の人の計画・判定の全文が紛れ込んでも、束に残らない", () => {
    const b = bundle();
    const dirty = {
      ...b,
      otherPlans: [{ id: uid(9), title: "他の人の計画", pilotName: "別人 花子" }],
      snapshotResult: { flags: ["did"], full: "判定スナップショットの全文" },
      plan: { ...b.plan, purpose: "自由記述の目的", latitude: 35.4342, longitude: 133.3805, memo: "備考" },
      docs: { ...b.docs, pilot: { ...b.docs.pilot!, licenseNumber: "LIC-SECRET-1234", license_number: "LIC-SECRET-1234" }, latitude: 35.43 },
      state: {
        ...b.state,
        events: [{ ...ev(1, { kind: "check", item: "site_conditions", result: "done", site: { thirdParty: "present", otherAircraft: "none", rain: "none", visibility: "good", windMs: null, tempC: null } }), note: "第三者の自由記述", recordedByName: "山田 太郎" }],
      },
      form: { ...b.form, placeName: "本社", latitude: 35.43, specialNotes: "特記事項" },
    };
    const out = roundTrip(dirty);
    const text = JSON.stringify(out);
    for (const w of ["LIC-SECRET-1234", "licenseNumber", "license_number", "35.43", "133.38", "latitude", "longitude", "自由記述", "備考", "特記事項", "他の人の計画", "別人 花子", "スナップショットの全文", "purpose", "recordedByName", "note"]) {
      expect(text, w).not.toContain(w);
    }
    // 含めるもの（計画の要約・登録内容の要約）は残る
    expect(out.plan.title).toBe("米子 空撮");
    expect(out.plan.placeName).toBe("本社");
    expect(out.docs.permits[0]!.permitNumber).toBe("P-001");
    expect(out.docs.pilot?.licenseExpiresOn).toBe("2027-06-30");
    expect(out.state.events).toHaveLength(1);
  });

  it("形が違う束・版が違う束は読まない（null）。持ち主の利用者の ID と計画の ID を持つ", () => {
    expect(sanitizeFieldBundle(null)).toBeNull();
    expect(sanitizeFieldBundle({ ...bundle(), v: 2 })).toBeNull();
    expect(sanitizeFieldBundle({ ...bundle(), memberId: "x" })).toBeNull();
    expect(sanitizeFieldBundle({ ...bundle(), plan: { ...bundle().plan, id: uid(5) } })).toBeNull();
    const ok = roundTrip(bundle());
    expect(ok.memberId).toBe(M);
    expect(ok.planId).toBe(P);
  });
});

describe("B-3 先読みの古さ", () => {
  it(`${FIELD_BUNDLE_STALE_HOURS} 時間を超えると古い`, () => {
    const at = Date.parse(T("08:00"));
    expect(fieldBundleIsStale(T("08:00"), at + FIELD_BUNDLE_STALE_HOURS * 3600_000)).toBe(false);
    expect(fieldBundleIsStale(T("08:00"), at + FIELD_BUNDLE_STALE_HOURS * 3600_000 + 1)).toBe(true);
    expect(fieldBundleIsStale("壊れた値", at)).toBe(true);
  });
});

describe("B-5 束から組み立てた判定は、サーバーの判定と同じ（同じ入力表）", () => {
  type Case = { readonly name: string; readonly docs?: Partial<FieldBundlePlan["docs"]>; readonly events?: FieldEventLite[]; readonly now: string };
  const takeoff = ev(10, { kind: "takeoff", occurredAt: T("12:30"), gaps: [] });
  const cases: Case[] = [
    { name: "すべて登録どおり", now: "12:00" },
    { name: "技能証明の期限切れ", docs: { pilot: { id: PL, fullName: "山田 太郎", hasLicense: true, licenseExpiresOn: "2027-01-04", hasLimitation: false, voided: false } }, now: "12:00" },
    { name: "技能証明の期限が未入力", docs: { pilot: { id: PL, fullName: "山田 太郎", hasLicense: true, licenseExpiresOn: null, hasLimitation: false, voided: false } }, now: "12:00" },
    { name: "機体が休止", docs: { aircraft: { id: A, registrationMark: "JU1", status: "suspended", voided: false } }, now: "12:00" },
    { name: "許可の登録なし", docs: { permits: [] }, now: "12:00" },
    { name: "許可の期間外", docs: { permits: [{ numberText: "P-001", kinds: ["night"], status: "not_applied", registrationId: "r1", permitNumber: "P-001", versionNo: 2, validFrom: "2026-01-01", validTo: "2026-12-31", reasonLabels: ["期間外"] }] }, now: "12:00" },
    { name: "通報の記録なし", docs: { report: { requirementKind: "required", statusCode: "no_record", effective: null } }, now: "12:00" },
    { name: "通報の記録が離陸より後（記録の時刻）", docs: { report: { requirementKind: "required", statusCode: "reported", effective: { id: "rep1", dipsNumber: "D-0001", numberUnavailable: false, reportedAtJst: "2027-01-05T11:00", recordedAtJst: "2027-01-05T12:45" } } }, events: [takeoff], now: "12:50" },
    { name: "要確認の項目を人が確認（リモートID）", events: [ev(11, { kind: "check", item: "docs_confirm", result: "done", docKey: "remote_id" })], now: "12:00" },
    { name: "飛行中（離陸の時刻で判定）", events: [takeoff], now: "13:20" },
  ];
  for (const c of cases) {
    it(c.name, () => {
      const b = bundle({ docs: { ...bundle().docs, ...c.docs }, state: { ...bundle().state, events: c.events ?? [] } });
      const now = new Date(T(c.now));
      // サーバーの経路：DB から読んだ入力と行で、判定の純粋関数を直接呼ぶ
      const state = fieldState({ events: c.events ?? [], inspections: [], flightRecords: [], day: "2027-01-05", planVersion: 1 });
      const at = state.openFlight ? "2027-01-05T12:30" : `2027-01-05T${c.now}`;
      const input: DocsJudgeInput = docsInputOf(b.docs, state, at);
      const server = judgeFieldDocs(input);
      const serverGaps = gapsFromInput(b.gap, state, `2027-01-05T${c.now}`, server);
      // 端末の経路：束を JSON にして IndexedDB に入れ、読み出して組み立てる
      const view = composeFieldView(roundTrip(b), { now });
      expect(view.docs.map((d) => [d.key, d.status, d.effective, d.basis, d.notes])).toEqual(server.map((d) => [d.key, d.status, d.effective, d.basis, d.notes]));
      expect(view.takeoffPreview.map((g) => [g.item, g.state])).toEqual(serverGaps.map((g) => [g.item, g.state]));
    });
  }

  it("端末の送信待ちの行（extraEvents）を足すと、人の確認・飛行中が反映される", () => {
    const b = roundTrip(bundle());
    const v0 = composeFieldView(b, { now: new Date(T("12:00")) });
    expect(v0.docs.find((d) => d.key === "manual")!.effective).toBe("needs_check");
    const v1 = composeFieldView(b, { now: new Date(T("12:00")), extraEvents: [ev(20, { kind: "check", item: "docs_confirm", result: "done", docKey: "manual", recordedKey: "~000000" })] });
    expect(v1.docs.find((d) => d.key === "manual")!.effective).toBe("confirmed_human");
    // 束には目的（自由記述）が無いので、組み立てた画面の目的は空
    expect(v1.plan.purpose).toBe("");
  });
});
