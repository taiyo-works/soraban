// Sprint 14 契約 B-1〜B-6：書類・手続きの自動判定（単体）。判定できないものは必ず「要確認」。
import { describe, expect, it } from "vitest";
import { FIELD_DOC_KEYS } from "@/lib/ops-field";
import { docGapsOf, judgeFieldDocs, type DocsJudgeInput, type DocsPermitNumber } from "./docs-judge";

const permit = (over: Partial<DocsPermitNumber> = {}): DocsPermitNumber => ({
  numberText: "P-001",
  status: "applied",
  registrationId: "r1",
  permitNumber: "P-001",
  versionNo: 2,
  validFrom: "2027-01-01",
  validTo: "2027-12-31",
  kinds: ["did"],
  reasonLabels: [],
  ...over,
});

const base = (over: Partial<DocsJudgeInput> = {}): DocsJudgeInput => ({
  plannedStartAtJst: "2027-01-05T13:00",
  plannedEndAtJst: "2027-01-05T14:00",
  wantedKinds: ["did"],
  atJst: "2027-01-05T12:00",
  permits: [permit()],
  aircraft: { id: "a1", registrationMark: "JU1234AB5678", status: "active", voided: false },
  pilot: { id: "p1", fullName: "山田 太郎", hasLicense: true, licenseExpiresOn: "2027-06-30", hasLimitation: false },
  report: {
    requirementKind: "required",
    statusCode: "reported",
    effective: { id: "rep1", dipsNumber: "D-0001", numberUnavailable: false, reportedAtJst: "2027-01-04T10:00" },
  },
  humanConfirms: {},
  ...over,
});

const by = (i: DocsJudgeInput) => Object.fromEntries(judgeFieldDocs(i).map((d) => [d.key, d]));

describe("judgeFieldDocs：項目は 6 つで固定", () => {
  it("項目の順は FIELD_DOC_KEYS", () => {
    expect(judgeFieldDocs(base()).map((d) => d.key)).toEqual([...FIELD_DOC_KEYS]);
    expect(FIELD_DOC_KEYS).toHaveLength(6);
  });
});

describe("B-1 判定できない入力はすべて要確認（確認済み・該当なしにならない）", () => {
  const empty = base({ permits: [], aircraft: null, pilot: null, report: { requirementKind: "unknown", statusCode: "no_record", effective: null } });
  it("登録が無い入力では、全項目が要確認", () => {
    for (const d of judgeFieldDocs(empty)) {
      expect(d.status, d.key).toBe("needs_check");
      expect(d.effective, d.key).toBe("needs_check");
    }
  });
  it("リモートID・飛行マニュアルは、どんな入力でも常に要確認", () => {
    const d = by(base());
    expect(d["remote_id"]!.status).toBe("needs_check");
    expect(d["manual"]!.status).toBe("needs_check");
    expect(d["remote_id"]!.notes.join("")).toContain("※要再確認");
  });
});

describe("B-2 許可・承認", () => {
  it("期間内・範囲内（permit-match が適用）で確認済み。根拠に番号・期間・版が出る", () => {
    const d = by(base())["permit"]!;
    expect(d.status).toBe("confirmed");
    expect(d.basis[0]).toContain("P-001");
    expect(d.basis[0]).toContain("2027-01-01〜2027-12-31");
    expect(d.basis[0]).toContain("登録の版 2");
  });
  it("期間外・失効・範囲外（適用しない）で満たさない", () => {
    const d = by(base({ permits: [permit({ status: "not_applied", reasonLabels: ["許可期間が飛行の最終日より前に終わっています"] })] }))["permit"]!;
    expect(d.status).toBe("unmet");
    expect(d.notes[0]).toContain("許可期間");
    expect(d.canConfirm).toBe(false);
  });
  it("登録なし・未登録は要確認", () => {
    expect(by(base({ permits: [] }))["permit"]!.status).toBe("needs_check");
    expect(by(base({ permits: [permit({ status: "unregistered", registrationId: null })] }))["permit"]!.status).toBe("needs_check");
  });
  it("一部だけ適用のときは要確認（確認済みにしない）", () => {
    const d = by(base({ permits: [permit(), permit({ numberText: "P-002", status: "not_applied" })] }))["permit"]!;
    expect(d.status).toBe("needs_check");
  });
});

describe("B-3 技能証明（日付またぎ）", () => {
  const pilot = (exp: string | null, over = {}) => ({ id: "p1", fullName: "山田 太郎", hasLicense: true, licenseExpiresOn: exp, hasLimitation: false, ...over });
  it("有効期限が飛行日以降で確認済み／過去で満たさない／未入力で要確認", () => {
    expect(by(base({ pilot: pilot("2027-01-05") }))["license"]!.status).toBe("confirmed");
    expect(by(base({ pilot: pilot("2027-01-04") }))["license"]!.status).toBe("unmet");
    expect(by(base({ pilot: pilot(null) }))["license"]!.status).toBe("needs_check");
  });
  it("JST 0 時付近の飛行でも、飛行日（JST）で比べる", () => {
    const at = { plannedStartAtJst: "2027-01-06T00:05", plannedEndAtJst: "2027-01-06T01:05", atJst: "2027-01-06T00:00" };
    expect(by(base({ ...at, pilot: pilot("2027-01-05") }))["license"]!.status).toBe("unmet");
    expect(by(base({ ...at, pilot: pilot("2027-01-06") }))["license"]!.status).toBe("confirmed");
    const late = { plannedStartAtJst: "2027-01-05T23:55", plannedEndAtJst: "2027-01-06T00:55", atJst: "2027-01-05T23:50" };
    // 意図の変更：予定終了日（翌日 00:55）と離陸日の遅い方で照合するため、日付をまたぐ飛行は終了日で比べる
    expect(by(base({ ...late, pilot: pilot("2027-01-05") }))["license"]!.status).toBe("unmet");
    expect(by(base({ ...late, pilot: pilot("2027-01-06") }))["license"]!.status).toBe("confirmed");
  });
  it("限定の登録がある・技能証明なしは、自動で確認済みにしない", () => {
    expect(by(base({ pilot: pilot("2027-06-30", { hasLimitation: true }) }))["license"]!.status).toBe("needs_check");
    expect(by(base({ pilot: pilot(null, { hasLicense: false }) }))["license"]!.status).toBe("needs_check");
  });
  it("B-6 根拠は名前と期限まで。技能証明書の番号を含めない", () => {
    const d = by(base({ pilot: { ...pilot("2027-06-30"), licenseNumber: "SECRET-9999" } as never }))["license"]!;
    expect(d.basis.join("")).toContain("山田 太郎");
    expect(d.basis.join("")).toContain("2027-06-30");
    expect(JSON.stringify(d)).not.toContain("SECRET-9999");
  });
});

describe("B-4 通報", () => {
  const rep = (over: Partial<DocsJudgeInput["report"]>) => ({ requirementKind: "required", statusCode: "reported", effective: base().report.effective, ...over });
  it("離陸前に完了した通報（受付番号つき）で確認済み", () => {
    expect(by(base())["report"]!.status).toBe("confirmed");
    expect(by(base({ report: rep({ requirementKind: "confirm" }) }))["report"]!.status).toBe("confirmed");
  });
  it("離陸より後に記録された通報は確認済みにしない", () => {
    const d = by(base({ atJst: "2027-01-04T09:00" }))["report"]!;
    expect(d.status).toBe("needs_check");
    expect(d.notes[0]).toContain("離陸より後");
  });
  it("受付番号が無い・通報の記録が無い・計画が通報時から変わっている・要否が判定不能は要確認", () => {
    const noNum = { id: "x", dipsNumber: null, numberUnavailable: true, reportedAtJst: "2027-01-04T10:00" };
    expect(by(base({ report: rep({ effective: noNum }) }))["report"]!.status).toBe("needs_check");
    expect(by(base({ report: rep({ statusCode: "no_record", effective: null }) }))["report"]!.status).toBe("needs_check");
    expect(by(base({ report: rep({ statusCode: "change_review" }) }))["report"]!.status).toBe("needs_check");
    expect(by(base({ report: rep({ requirementKind: "unknown" }) }))["report"]!.status).toBe("needs_check");
  });
  it("推奨・対象外は、免除と読める語を使わず要確認のまま。未了には数えない", () => {
    for (const kind of ["recommended", "not_applicable_model"]) {
      const d = by(base({ report: rep({ requirementKind: kind }) }))["report"]!;
      expect(d.status).toBe("needs_check");
      expect(d.countsAsGap).toBe(false);
      expect(JSON.stringify(d)).not.toMatch(/通報不要|手続き不要|該当なし/);
    }
  });
  it("Sprint 15 U-2：根拠に通報日時とそらばんへの記録の時刻の両方が出る。記録が離陸後なら要確認のまま、理由を説明する", () => {
    const eff = { id: "rep1", dipsNumber: "D-0001", numberUnavailable: false, reportedAtJst: "2027-01-05T11:00", recordedAtJst: "2027-01-05T12:30" };
    // 判定時刻（離陸）12:00。通報日時 11:00 は前だが、記録 12:30 は後
    const late = by(base({ atJst: "2027-01-05T12:00", report: rep({ effective: eff }) }))["report"]!;
    expect(late.status).toBe("needs_check");
    expect(late.basis.join("\n")).toContain("通報日時 2027-01-05 11:00");
    expect(late.basis.join("\n")).toContain("そらばんへの記録 2027-01-05 12:30");
    expect(late.notes.join("")).toContain("そらばんへの記録が離陸より後");
    // 記録が離陸より前なら確認済み。根拠には同じく両方の時刻
    const ok = by(base({ atJst: "2027-01-05T13:00", report: rep({ effective: eff }) }))["report"]!;
    expect(ok.status).toBe("confirmed");
    expect(ok.basis.join("\n")).toMatch(/通報日時 2027-01-05 11:00[\s\S]*そらばんへの記録 2027-01-05 12:30/);
    // 通報日時そのものが離陸より後のときは、記録の遅れの説明は出さない
    const after = by(base({ atJst: "2027-01-05T10:00", report: rep({ effective: eff }) }))["report"]!;
    expect(after.notes.join("")).not.toContain("そらばんへの記録が離陸より後");
  });
  it("通報は人の「確認した」で済ませない（通報の画面で記録する）", () => {
    expect(by(base({ report: rep({ statusCode: "no_record", effective: null }) }))["report"]!.canConfirm).toBe(false);
  });
});

describe("B-5 登録記号", () => {
  it("機体が取消・休止なら満たさない。確認済みには「有効期限は人が確認」が付く", () => {
    const air = (status: "active" | "suspended" | "deregistered", voided = false) => ({ id: "a1", registrationMark: "JU1", status, voided });
    expect(by(base({ aircraft: air("suspended") }))["registration"]!.status).toBe("unmet");
    expect(by(base({ aircraft: air("deregistered") }))["registration"]!.status).toBe("unmet");
    const ok = by(base({ aircraft: air("active") }))["registration"]!;
    expect(ok.status).toBe("confirmed");
    expect(ok.notes).toContain("登録の有効期限は人が確認");
    expect(ok.basis[0]).toContain("JU1");
    // 取消済みの機体は満たさない
    expect(by(base({ aircraft: air("active", true) }))["registration"]!.status).toBe("unmet");
  });
});

describe("人の確認と未了事項", () => {
  it("要確認の項目だけ確認できる。確認すると確認済み（人が確認）になり、取り消す対象の行を持つ", () => {
    const d = by(base({ humanConfirms: { remote_id: { at: "2027-01-05T02:00:00.000Z", eventId: "e1" } } }));
    expect(d["remote_id"]!.effective).toBe("confirmed_human");
    expect(d["remote_id"]!.humanConfirmEventId).toBe("e1");
    expect(d["remote_id"]!.canConfirm).toBe(false);
    expect(d["manual"]!.canConfirm).toBe(true);
    expect(d["permit"]!.canConfirm).toBe(false);
  });
  it("満たさない項目は人の確認で変えない", () => {
    const i = base({ permits: [permit({ status: "not_applied" })], humanConfirms: { permit: { at: "x", eventId: "e2" } } });
    const d = by(i)["permit"]!;
    expect(d.effective).toBe("unmet");
    expect(d.humanConfirmed).toBe(false);
  });
  it("docGapsOf：要確認・満たさないだけ（人が確認したもの・確認済み・通報は含めない）", () => {
    const i = base({ permits: [permit({ status: "not_applied" })], humanConfirms: { remote_id: { at: "x", eventId: "e1" } } });
    expect(docGapsOf(judgeFieldDocs(i))).toEqual([
      { key: "permit", state: "unmet" },
      { key: "manual", state: "needs_check" },
    ]);
  });
});

describe("レビュー指摘の修正", () => {
  it("許可：必要な種類の一部だけを覆う登録は確認済みにしない（夜間＋目視外に夜間だけの許可）", () => {
    const night = permit({ kinds: ["night"], numberText: "N-1", permitNumber: "N-1" });
    const i = base({ wantedKinds: ["night", "bvlos"], permits: [night] });
    const d = by(i)["permit"]!;
    expect(d.status).toBe("needs_check");
    expect(d.notes.join("")).toContain("登録で確認できない種類");
    // 種類の和集合が必要な種類を覆えば確認済み
    const bvlos = permit({ kinds: ["bvlos"], numberText: "B-1", permitNumber: "B-1" });
    expect(by(base({ wantedKinds: ["night", "bvlos"], permits: [night, bvlos] }))["permit"]!.status).toBe("confirmed");
    // 必要な種類が判定できない（空）ときは確認済みにしない
    expect(by(base({ wantedKinds: [], permits: [night] }))["permit"]!.status).toBe("needs_check");
  });
  it("許可・技能証明：実際の離陸日が有効期間の最終日より後なら満たさない（予定開始日だけで照合しない）", () => {
    const i = base({ atJst: "2028-01-02T09:00", permits: [permit({ validTo: "2027-12-31" })], pilot: { id: "p1", fullName: "山田", hasLicense: true, licenseExpiresOn: "2027-12-31", hasLimitation: false } });
    expect(by(i)["permit"]!.status).toBe("unmet");
    expect(by(i)["license"]!.status).toBe("unmet");
  });
  it("人の確認は、確認できない項目（通報・満たさない・確認済み）には効かない", () => {
    const hc = { at: "x", eventId: "e" };
    const noReport = base({ report: { requirementKind: "required", statusCode: "no_record", effective: null }, humanConfirms: { report: hc, registration: hc } });
    const d = by(noReport);
    expect(d["report"]!.humanConfirmed).toBe(false);
    expect(d["report"]!.effective).toBe("needs_check");
    expect(d["registration"]!.humanConfirmed).toBe(false);
    expect(d["registration"]!.effective).toBe("confirmed_auto");
  });
  it("取消済みの操縦者は満たさない", () => {
    const i = base({ pilot: { id: "p1", fullName: "山田", hasLicense: true, licenseExpiresOn: "2030-01-01", hasLimitation: false, voided: true } });
    expect(by(i)["license"]!.status).toBe("unmet");
  });
  it("通報が要確認（受付番号なし・通報日時なし・要否不明）なら、未了に数える（推奨・対象外は数えない）", () => {
    const e = { id: "x", dipsNumber: null, numberUnavailable: true, reportedAtJst: null };
    expect(by(base({ report: { requirementKind: "required", statusCode: "reported", effective: e } }))["report"]!.countsAsGap).toBe(true);
    expect(by(base({ report: { requirementKind: "unknown", statusCode: "no_record", effective: null } }))["report"]!.countsAsGap).toBe(true);
    expect(by(base({ report: { requirementKind: "recommended", statusCode: "no_record", effective: null } }))["report"]!.countsAsGap).toBe(false);
  });
});

describe("再評価後のユーザー決定（通報の前後は記録の時刻で判定）", () => {
  it("記録の時刻（created_at）が離陸より後なら、入力された通報日時が前でも要確認", () => {
    const eff = { id: "r", dipsNumber: "D-1", numberUnavailable: false, reportedAtJst: "2027-01-05T10:00", recordedAtJst: "2027-01-05T12:30" };
    const d = by(base({ atJst: "2027-01-05T12:00", report: { requirementKind: "required", statusCode: "reported", effective: eff } }))["report"]!;
    expect(d.status).toBe("needs_check");
    expect(d.countsAsGap).toBe(true);
    const ok = by(base({ atJst: "2027-01-05T12:00", report: { requirementKind: "required", statusCode: "reported", effective: { ...eff, recordedAtJst: "2027-01-05T11:00" } } }))["report"]!;
    expect(ok.status).toBe("confirmed");
  });
});
