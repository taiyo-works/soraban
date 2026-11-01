// Sprint 12b 契約 15（単体）：reportDeadlineState と planNextActions。
// 目安の時刻（飛行開始の 24 時間前。report-policy.json）の前後・飛行開始の前後、要・要確認・推奨、通報の状況、
// 許可・警察の手続きと記録の有無の組合せで、期待どおりの一覧になる。
import { describe, expect, it } from "vitest";
import {
  NEXT_ACTION_LABEL,
  REPORT_POLICY,
  reportStatus,
  type ReportRowLite,
  type ReportStatusResult,
  type RequirementKind,
} from "@soraban/dips";
import {
  compareNextActions,
  planHref,
  planNextActions,
  reportDeadlineState,
  type DeadlineState,
  type NextActionPlanState,
  type NextActionsInput,
  type SnapshotProcedureLite,
} from "./report-logic";

const START = new Date("2027-01-14T00:00:00Z"); // JST 2027-01-14 09:00
const GUIDE = new Date(START.getTime() - 24 * 3600 * 1000);
const at = (ms: number) => new Date(ms);
const PLAN_ID = "11111111-1111-4111-8111-111111111111";
const SNAP = "22222222-2222-4222-8222-222222222222";
const KINDS: RequirementKind[] = ["confirm", "required", "recommended", "not_applicable_model"];

describe("reportDeadlineState", () => {
  const st = (over: Partial<Parameters<typeof reportDeadlineState>[0]> & { nowMs: number }) =>
    reportDeadlineState({
      requirementKind: "required",
      hasEffective: false,
      planVoided: false,
      plannedStartAt: START,
      now: at(over.nowMs),
      ...over,
    });

  it("目安の時刻は飛行開始の 24 時間前（データ）。法定の期限ではないと併記する", () => {
    expect(REPORT_POLICY.guideLeadHours).toBe(24);
    const s = st({ nowMs: GUIDE.getTime() - 5 * 3600 * 1000 });
    expect(s.guideAt).toBe(GUIDE.toISOString());
    expect(s.guideAtJst).toBe("2027-01-13 09:00");
    expect(s.guideNote).toBe("社内の目安であり、法定の期限ではありません。");
  });

  it("目安の前：upcoming（情報。目安まであと N 時間）", () => {
    const s = st({ nowMs: GUIDE.getTime() - 5 * 3600 * 1000 });
    expect(s).toMatchObject({ state: "upcoming", tier: 3, hoursToGuide: 5, message: "目安まであと 5 時間", penaltyNote: null });
    // 切り上げ（1 時間未満でも 1 時間）
    expect(st({ nowMs: GUIDE.getTime() - 1 }).hoursToGuide).toBe(1);
    expect(st({ nowMs: GUIDE.getTime() - 5 * 3600 * 1000 - 1 }).hoursToGuide).toBe(6);
  });

  it("目安の時刻ちょうどから飛行開始の前：past_guide（警告）", () => {
    for (const ms of [GUIDE.getTime(), GUIDE.getTime() + 1, START.getTime() - 1]) {
      expect(st({ nowMs: ms }), String(ms)).toMatchObject({
        state: "past_guide",
        tier: 2,
        message: "社内の目安（飛行開始の 24 時間前）を過ぎています",
        penaltyNote: null,
      });
    }
  });

  it("飛行開始の時刻から後：overdue_started（最上位の警告 tier 1）。罰則の文言は「※要確認」つきで、金額が無い", () => {
    for (const ms of [START.getTime(), START.getTime() + 1, START.getTime() + 7 * 24 * 3600 * 1000]) {
      const s = st({ nowMs: ms });
      expect(s).toMatchObject({ state: "overdue_started", tier: 1 });
      expect(s.message).toBe("飛行開始の時刻を過ぎていますが、通報の記録がありません");
      expect(s.penaltyNote).toBe("通報せずに特定飛行を行うと罰則の対象になりえます（航空法第157条の10。※要確認：条文は一次資料で未照合。U5）");
      expect(s.penaltyNote).toContain("※要確認");
      expect(s.penaltyNote).not.toMatch(/円|罰金|懲役|過料/);
    }
  });

  it("要確認は要と同じに扱う", () => {
    for (const ms of [GUIDE.getTime() - 1000, GUIDE.getTime() + 1000, START.getTime() + 1000]) {
      expect(st({ nowMs: ms, requirementKind: "confirm" })).toEqual(st({ nowMs: ms, requirementKind: "required" }));
    }
  });

  it("推奨は警告にしない（recommended_open・tier 5。目安も罰則も出さない）", () => {
    for (const ms of [GUIDE.getTime() - 1000, GUIDE.getTime() + 1000, START.getTime() + 1000]) {
      const s = st({ nowMs: ms, requirementKind: "recommended" });
      expect(s).toMatchObject({ state: "recommended_open", tier: 5, message: "通報を行うことを推奨します", guideAt: null, guideNote: null, penaltyNote: null });
    }
  });

  it("有効な通報がある・計画が中止された・模型航空機は期限の対象でない（none）", () => {
    for (const ms of [GUIDE.getTime() - 1000, START.getTime() + 1000]) {
      for (const k of KINDS) {
        expect(st({ nowMs: ms, requirementKind: k, hasEffective: true }).state).toBe("none");
        expect(st({ nowMs: ms, requirementKind: k, planVoided: true }).state).toBe("none");
      }
      expect(st({ nowMs: ms, requirementKind: "not_applicable_model" }).state).toBe("none");
    }
    const none = st({ nowMs: START.getTime() + 1, hasEffective: true });
    expect(none).toMatchObject({ tier: null, message: null, guideAt: null, penaltyNote: null });
  });

  it("注記：障害時の例外（※要確認）と、飛行禁止法の通報は別の手続きであること", () => {
    const s = st({ nowMs: START.getTime() + 1 });
    expect(s.outageNote).toContain("飛行開始後の通報ができる例外");
    expect(s.outageNote).toContain("※要確認");
    expect(s.smallDroneLawNote).toContain("別の手続き");
  });

  it("目安の時間はデータで変えられる（policy を差し替える）。法定の期限の日付を作らない", () => {
    const policy = { ...REPORT_POLICY, guideLeadHours: 48 };
    const s = reportDeadlineState({ requirementKind: "required", hasEffective: false, planVoided: false, plannedStartAt: START, now: at(START.getTime() - 40 * 3600 * 1000), policy });
    expect(s.state).toBe("past_guide");
    expect(s.guideAt).toBe(new Date(START.getTime() - 48 * 3600 * 1000).toISOString());
    // 「期限」という語を日付に結び付けて出さない：guideAtJst は目安の時刻
    expect(JSON.stringify(s)).not.toContain("法定の期限は");
  });
});

// ---- 次にやること ----------------------------------------------------

const row = (i: number, kind: ReportRowLite["kind"], status: ReportRowLite["status"], over: Partial<ReportRowLite> = {}): ReportRowLite => ({
  id: `r${String(i).padStart(3, "0")}`,
  kind,
  status,
  channel: status === "reported_manual" ? "manual" : "mock",
  createdAt: new Date(Date.parse("2027-01-05T01:00:00Z") + i * 1000),
  updatedAt: new Date(Date.parse("2027-01-05T01:00:00Z") + i * 1000),
  fingerprint: "fp-1",
  reportedAt: "2027-01-05T10:00",
  dipsNumber: `N${i}`,
  ...over,
});

type Build = {
  nowMs?: number;
  kind?: RequirementKind;
  planState?: NextActionPlanState;
  stale?: boolean;
  rows?: ReportRowLite[];
  fp?: string;
  voided?: boolean;
  copied?: boolean;
  procedures?: SnapshotProcedureLite[];
  records?: NextActionsInput["procedureRecords"];
  can?: Partial<NextActionsInput["can"]>;
  /** 申請支援のフラグ。既定 true（Sprint 18 より前の振る舞いを守る既存のテストのため）。無効側は専用の describe で検査する。 */
  applicationSupport?: boolean;
};

const build = (b: Build = {}): { input: NextActionsInput; status: ReportStatusResult; deadline: DeadlineState } => {
  const now = at(b.nowMs ?? Date.parse("2027-01-05T03:00:00Z"));
  const kind = b.kind ?? "required";
  const voided = b.voided ?? b.planState === "voided";
  const status = reportStatus({ requirementKind: kind, rows: b.rows ?? [], currentFingerprint: b.fp ?? "fp-1", planVoided: voided, now });
  const deadline = reportDeadlineState({ requirementKind: kind, hasEffective: status.effectiveId !== null, planVoided: voided, plannedStartAt: START, now });
  return {
    status,
    deadline,
    input: {
      planId: PLAN_ID,
      plannedStartAt: START,
      now,
      planState: b.planState ?? "approved",
      judgementStale: b.stale ?? false,
      currentSnapshotId: SNAP,
      requirementKind: kind,
      requirementLabel: kind === "required" ? "通報：要" : kind === "confirm" ? "通報：要確認（要として扱います）" : kind === "recommended" ? "通報：義務ではないが推奨" : "通報：DIPS の飛行計画の通報は対象外（模型航空機）",
      status,
      deadline,
      copiedWithoutRecord: b.copied ?? false,
      procedures: b.procedures ?? [],
      procedureRecords: b.records ?? {},
      can: { update: true, confirm: true, record: true, ...(b.can ?? {}) },
      applicationSupport: b.applicationSupport ?? true,
    },
  };
};
const ids = (b: Build) => planNextActions(build(b).input).map((a) => a.id);

describe("planNextActions：通報", () => {
  it("要・要確認で有効な通報が無ければ「飛行計画を DIPS で通報する」。記録後は消える", () => {
    for (const kind of ["required", "confirm"] as const) {
      expect(ids({ kind })).toEqual(["report"]);
      expect(ids({ kind, rows: [row(1, "new", "reported_manual")] })).toEqual([]);
    }
    const a = planNextActions(build({}).input)[0]!;
    expect(a).toMatchObject({ id: "report", label: "飛行計画を DIPS で通報する", href: `/ops/plans/${PLAN_ID}/report`, tier: 3, canAct: true });
    expect(a.reason).toContain("通報：要");
    expect(a.dueLabel).toContain("目安まであと");
    expect(a.dueLabel).toContain("社内の目安であり、法定の期限ではありません");
  });

  it("目安の前後・飛行開始の後で tier が 3・2・1（飛行開始後の未記録が最上位）", () => {
    const tier = (ms: number) => planNextActions(build({ nowMs: ms }).input)[0]!.tier;
    expect(tier(GUIDE.getTime() - 1)).toBe(3);
    expect(tier(GUIDE.getTime())).toBe(2);
    expect(tier(START.getTime() - 1)).toBe(2);
    expect(tier(START.getTime())).toBe(1);
    expect(planNextActions(build({ nowMs: START.getTime() + 1 }).input)[0]!.dueLabel).toContain("通報の記録がありません");
  });

  it("中止した計画に有効な通報が残るとき、後の行が失敗でも「通報を取り消す」が出る", () => {
    const rows = [row(1, "new", "reported_manual"), row(2, "change", "failed")];
    expect(ids({ rows, planState: "voided" })).toContain("cancel_report");
    // 有効な通報が無ければ足さない
    expect(ids({ rows: [row(1, "new", "failed")], planState: "voided" })).not.toContain("cancel_report");
  });

  it("推奨は tier 5 の「通報を検討する（推奨）」だけで、警告にならない（飛行開始後でも tier 5）", () => {
    for (const ms of [GUIDE.getTime() - 1, GUIDE.getTime() + 1, START.getTime() + 1]) {
      const list = planNextActions(build({ kind: "recommended", nowMs: ms }).input);
      expect(list.map((a) => [a.id, a.tier]), String(ms)).toEqual([["consider_report", 5]]);
    }
    expect(ids({ kind: "recommended", rows: [row(1, "new", "reported_manual")] })).toEqual([]);
  });

  it("模型航空機は通報の項目が出ない", () => {
    expect(ids({ kind: "not_applicable_model" })).toEqual([]);
    expect(ids({ kind: "not_applicable_model", nowMs: START.getTime() + 1 })).toEqual([]);
  });

  it("指紋が変わると「通報を変更する」（tier 4）、中止で「通報を取り消す」、記録後は「飛行計画を DIPS で通報する」が消える", () => {
    const rows = [row(1, "new", "reported_manual")];
    expect(ids({ rows, fp: "fp-2" })).toEqual(["change_report"]);
    expect(planNextActions(build({ rows, fp: "fp-2" }).input)[0]).toMatchObject({ tier: 4, href: `/ops/plans/${PLAN_ID}/report?kind=change#record` });
    expect(ids({ rows, fp: "fp-2", planState: "voided" })).toEqual(["cancel_report"]);
    expect(planNextActions(build({ rows, planState: "voided" }).input)[0]).toMatchObject({ id: "cancel_report", tier: 3, href: `/ops/plans/${PLAN_ID}/report?kind=cancel#record` });
    expect(ids({ rows, planState: "voided" })).toEqual(["cancel_report"]);
    // 変更を記録すると消える
    expect(ids({ rows: [...rows, row(2, "change", "reported_manual", { fingerprint: "fp-2" })], fp: "fp-2" })).toEqual([]);
    // 取消を記録すると、中止した計画の項目は残らない
    expect(ids({ rows: [...rows, row(2, "cancel", "reported_manual")], planState: "voided" })).toEqual([]);
    // 取消のあとに計画が中止されていない（DIPS で取り消しただけ）なら、改めて通報
    expect(ids({ rows: [...rows, row(2, "cancel", "reported_manual")] })).toEqual(["report"]);
  });

  it("結果不明は「通報の結果を記録する」。失敗は再送を促す「飛行計画を DIPS で通報する」。送信中は項目なし", () => {
    expect(ids({ rows: [row(1, "new", "unknown")] })).toEqual(["record_result"]);
    expect(planNextActions(build({ rows: [row(1, "new", "unknown")] }).input)[0]).toMatchObject({ href: `/ops/plans/${PLAN_ID}/report#record`, tier: 3 });
    expect(ids({ rows: [row(1, "new", "failed")] })).toEqual(["report"]);
    expect(planNextActions(build({ rows: [row(1, "new", "failed")] }).input)[0]!.reason).toContain("失敗しました。再送できます");
    expect(ids({ rows: [row(1, "new", "prepared", { updatedAt: new Date("2027-01-05T02:59:00Z") })] })).toEqual([]);
    // prepared のまま 5 分を超えたら結果不明
    expect(ids({ rows: [row(1, "new", "prepared", { updatedAt: new Date("2027-01-05T02:50:00Z") })] })).toEqual(["record_result"]);
    // 登録された可能性がある通報は、飛行開始後は tier 1
    expect(planNextActions(build({ nowMs: START.getTime() + 1, rows: [row(1, "new", "unknown")] }).input)[0]).toMatchObject({ id: "record_result", tier: 1 });
    // 推奨でも、結果不明は確かめる
    expect(ids({ kind: "recommended", rows: [row(1, "new", "unknown")] })).toEqual(["record_result"]);
  });

  it("通報内容を開いて（コピーして）記録が無い計画は「通報の結果を記録する」（入口）", () => {
    expect(ids({ copied: true })).toEqual(["record_result"]);
    expect(ids({ copied: true, kind: "recommended" })).toEqual(["consider_report"]);
    expect(ids({ copied: true, rows: [row(1, "new", "reported_manual")] })).toEqual([]);
  });

  it("保存された「状態」を読まない：同じ記録なら、何度呼んでも同じ。記録を足すだけで変わる", () => {
    const a = ids({});
    expect(ids({})).toEqual(a);
    expect(ids({ rows: [row(1, "new", "reported_manual")] })).not.toEqual(a);
  });
});

describe("planNextActions：確認・再判定", () => {
  it("下書き：確認を依頼する／確認待ち・修正済み・前の版への確認：計画を確認する／差し戻し：差し戻しを直す／判定が古い：判定をやり直す", () => {
    expect(ids({ planState: "draft", kind: "not_applicable_model" })).toEqual(["request_confirmation"]);
    for (const s of ["pending", "returned_stale", "approved_stale"] as const) expect(ids({ planState: s, kind: "not_applicable_model" }), s).toEqual(["confirm"]);
    expect(ids({ planState: "returned", kind: "not_applicable_model" })).toEqual(["fix_returned"]);
    expect(ids({ planState: "approved", stale: true, kind: "not_applicable_model" })).toEqual(["rejudge"]);
    expect(ids({ planState: "approved", kind: "not_applicable_model" })).toEqual([]);
    // 中止した計画には出ない
    expect(ids({ planState: "voided", stale: true, kind: "not_applicable_model" })).toEqual([]);
  });

  it("権限：運航管理者でない人には「計画を確認する」が canAct = false。通報の記録の権限が無ければ canAct = false", () => {
    const list = planNextActions(build({ planState: "pending", can: { confirm: false, record: false } }).input);
    expect(list.find((a) => a.id === "confirm")!.canAct).toBe(false);
    expect(list.find((a) => a.id === "report")!.canAct).toBe(false);
    expect(planNextActions(build({ planState: "draft", can: { update: false } }).input).find((a) => a.id === "request_confirmation")!.canAct).toBe(false);
  });
});

describe("planNextActions：許可・承認の申請と警察への通報", () => {
  const permit: SnapshotProcedureLite = { procedureId: "flight-approval-night", deadlineLabel: "2027-01-27 まで（10 開庁日以上前）", deadlineDate: "2027-01-27" };
  const police: SnapshotProcedureLite = { procedureId: "small-drone-law-consent-notice", deadlineLabel: "飛行開始の 48 時間前まで", deadlineDate: "2027-01-12" };
  const base = { kind: "not_applicable_model" as const };

  it("手続きにあり、有効な記録が現在のスナップショットに対して無いとき出る。期限の文言と日付はスナップショットのまま", () => {
    const list = planNextActions(build({ ...base, procedures: [permit, police] }).input);
    expect(list.map((a) => a.id)).toEqual(["apply_permit", "notify_police"]);
    expect(list[0]).toMatchObject({ label: "許可・承認を申請する", dueLabel: permit.deadlineLabel, tier: 3, href: `/ops/plans/${PLAN_ID}/overview#procedures` });
    expect(list[1]).toMatchObject({ label: "警察へ通報する", dueLabel: police.deadlineLabel });
    // 手続きが無ければ出ない。緊急用務空域は申請する手続きでない
    expect(ids({ ...base, procedures: [] })).toEqual([]);
    expect(ids({ ...base, procedures: [{ procedureId: "flight-permission-emergency-airspace", deadlineLabel: null, deadlineDate: null }] })).toEqual([]);
    // 申請の対象の識別子
    for (const id of ["flight-permission-did", "flight-permission-airport", "flight-permission-150m", "flight-approval-bvlos", "flight-approval-30m", "flight-approval-event", "flight-approval-dangerous", "flight-approval-drop"]) {
      expect(ids({ ...base, procedures: [{ procedureId: id, deadlineLabel: null, deadlineDate: null }] }), id).toEqual(["apply_permit"]);
    }
    // 申請と無関係の手続き（登録・保険など）は出ない
    expect(ids({ ...base, procedures: [{ procedureId: "drone-registration", deadlineLabel: null, deadlineDate: null }] })).toEqual([]);
  });

  it("記録（done・現在のスナップショット）があれば消える。取り下げ（retract）なら戻る。前の判定に対する記録は理由を替えて戻る", () => {
    expect(ids({ ...base, procedures: [permit, police], records: { dips_permit: { action: "done", snapshotId: SNAP } } })).toEqual(["notify_police"]);
    expect(ids({ ...base, procedures: [permit, police], records: { dips_permit: { action: "done", snapshotId: SNAP }, small_drone_law: { action: "done", snapshotId: SNAP } } })).toEqual([]);
    expect(ids({ ...base, procedures: [permit], records: { dips_permit: { action: "retract", snapshotId: SNAP } } })).toEqual(["apply_permit"]);
    const stale = planNextActions(build({ ...base, procedures: [permit], records: { dips_permit: { action: "done", snapshotId: "other" } } }).input);
    expect(stale.map((a) => a.id)).toEqual(["apply_permit"]);
    expect(stale[0]!.reason).toBe("前の判定に対する記録です。もう一度確認してください");
    // 種別が違う記録は効かない
    expect(ids({ ...base, procedures: [permit], records: { small_drone_law: { action: "done", snapshotId: SNAP } } })).toEqual(["apply_permit"]);
  });

  it("期限の日付が過去で記録が無ければ tier 2、そうでなければ tier 3。中止した計画には出ない", () => {
    const todayMs = Date.parse("2027-01-27T03:00:00Z"); // JST 2027-01-27 は期限当日（過ぎていない）
    expect(planNextActions(build({ ...base, nowMs: todayMs, procedures: [permit] }).input)[0]!.tier).toBe(3);
    expect(planNextActions(build({ ...base, nowMs: Date.parse("2027-01-28T03:00:00Z"), procedures: [permit] }).input)[0]!.tier).toBe(2);
    // 日付が決まらない手続きは tier 3
    expect(planNextActions(build({ ...base, procedures: [{ procedureId: "flight-approval-night", deadlineLabel: "飛行の前に", deadlineDate: null }] }).input)[0]!.tier).toBe(3);
    expect(ids({ ...base, planState: "voided", procedures: [permit, police] })).toEqual([]);
  });

  it("日付が複数あるときは最も早い期限の文言を使う", () => {
    const early: SnapshotProcedureLite = { procedureId: "flight-permission-did", deadlineLabel: "2027-01-20 まで", deadlineDate: "2027-01-20" };
    const list = planNextActions(build({ ...base, procedures: [permit, early] }).input);
    expect(list[0]!.dueLabel).toBe("2027-01-20 まで");
  });
});

describe("planNextActions：許可・承認の結果の登録（Sprint 12d 契約 15）", () => {
  const permit: SnapshotProcedureLite = { procedureId: "flight-approval-night", deadlineLabel: "2027-01-27 まで（10 開庁日以上前）", deadlineDate: "2027-01-27" };
  const done = { dips_permit: { action: "done" as const, snapshotId: SNAP } };
  const base = { kind: "not_applicable_model" as const };
  const withPermits = (applied: boolean, canRegister: boolean, b: Build = {}) => {
    const built = build({ ...base, ...b });
    return planNextActions({ ...built.input, permits: { applied, canRegister } });
  };

  it("申請済みの記録があり、判定に許可の手続きが残り、適用された登録がないとき出る（運航管理者だけ canAct）。申請の次にやることは出ない", () => {
    const list = withPermits(false, true, { procedures: [permit], records: done });
    expect(list.map((a) => a.id)).toEqual(["register_permit"]);
    expect(list[0]).toMatchObject({ label: "取得した許可・承認を登録する", tier: 3, canAct: true, href: "/ops/permits/new", dueLabel: permit.deadlineLabel });
    expect(list[0]!.reason).toContain("申請は済み");
    // 運航管理者以外は依頼（canAct false）
    expect(withPermits(false, false, { procedures: [permit], records: done })[0]).toMatchObject({ id: "register_permit", canAct: false });
  });

  it("適用された登録があれば出ない（判定の手続きが消えるため申請も出ない）。手続きがなければ出ない。申請の記録がなければ申請が出る", () => {
    expect(withPermits(true, true, { procedures: [permit], records: done }).map((a) => a.id)).toEqual([]);
    expect(withPermits(false, true, { procedures: [], records: done }).map((a) => a.id)).toEqual([]);
    expect(withPermits(false, true, { procedures: [permit] }).map((a) => a.id)).toEqual(["apply_permit"]);
    // 取り下げ・前の判定に対する記録のときは、登録ではなく申請に戻る
    expect(withPermits(false, true, { procedures: [permit], records: { dips_permit: { action: "retract", snapshotId: SNAP } } }).map((a) => a.id)).toEqual(["apply_permit"]);
    expect(withPermits(false, true, { procedures: [permit], records: { dips_permit: { action: "done", snapshotId: "other" } } }).map((a) => a.id)).toEqual(["apply_permit"]);
  });

  it("permits を渡さない導出（12b のまま）では出ない。期限が過ぎていれば tier 2", () => {
    expect(ids({ ...base, procedures: [permit], records: done })).toEqual([]);
    const late = build({ ...base, procedures: [permit], records: done, nowMs: Date.parse("2027-01-28T03:00:00Z") });
    expect(planNextActions({ ...late.input, permits: { applied: false, canRegister: true } })[0]).toMatchObject({ id: "register_permit", tier: 2 });
  });
});

describe("planNextActions：申請支援のフラグが無効（既定・本番。Sprint 18-2 契約 2-4）", () => {
  const permit: SnapshotProcedureLite = { procedureId: "flight-approval-night", deadlineLabel: "2027-01-27 まで（10 開庁日以上前）", deadlineDate: "2027-01-27" };
  const police: SnapshotProcedureLite = { procedureId: "small-drone-law-consent-notice", deadlineLabel: "飛行開始の 48 時間前まで", deadlineDate: "2027-01-12" };
  const base = { kind: "not_applicable_model" as const, applicationSupport: false };
  const off = (b: Build, permits?: { applied: boolean; canRegister: boolean }) => {
    const built = build({ ...base, ...b });
    return planNextActions(permits ? { ...built.input, permits } : built.input);
  };

  it("apply_permit は出ない（許可・承認の手続きがあっても。申請の記録があっても無くても）", () => {
    const records = { dips_permit: { action: "done" as const, snapshotId: SNAP } };
    for (const b of [{ procedures: [permit] }, { procedures: [permit], records }, { procedures: [permit, police] }]) {
      expect(off(b).map((a) => a.id), JSON.stringify(b)).not.toContain("apply_permit");
      expect(off(b, { applied: false, canRegister: true }).map((a) => a.id)).not.toContain("apply_permit");
    }
  });

  it("許可・承認の手続きが残り、適用された登録が無いとき register_permit が出る（申請の記録に依存しない。tier 3 固定・期限の文言なし）", () => {
    for (const records of [undefined, { dips_permit: { action: "done" as const, snapshotId: SNAP } }, { dips_permit: { action: "retract" as const, snapshotId: SNAP } }]) {
      const list = off({ procedures: [permit], ...(records ? { records } : {}) }, { applied: false, canRegister: true });
      expect(list.map((a) => a.id)).toEqual(["register_permit"]);
      expect(list[0]).toMatchObject({
        label: "取得した許可・承認を登録する",
        tier: 3,
        canAct: true,
        href: "/ops/permits/new",
        dueLabel: null,
      });
      expect(list[0]!.reason).toContain("利用者本人が DIPS 2.0 で取得します");
      expect(list[0]!.reason).not.toContain("申請");
    }
    // 期限が過ぎていても tier 3 のまま（期限の逆算を案内しない）
    const late = off({ procedures: [permit], nowMs: Date.parse("2027-01-28T03:00:00Z") }, { applied: false, canRegister: true });
    expect(late[0]).toMatchObject({ id: "register_permit", tier: 3, dueLabel: null });
  });

  it("操縦者（登録できない役割）は canAct false。適用された登録があれば消える。手続きが無い・緊急用務空域・permits を渡さないときは出ない", () => {
    expect(off({ procedures: [permit] }, { applied: false, canRegister: false })[0]).toMatchObject({ id: "register_permit", canAct: false });
    expect(off({ procedures: [permit] }, { applied: true, canRegister: true })).toEqual([]);
    expect(off({ procedures: [] }, { applied: false, canRegister: true })).toEqual([]);
    expect(off({ procedures: [{ procedureId: "flight-permission-emergency-airspace", deadlineLabel: null, deadlineDate: null }] }, { applied: false, canRegister: true })).toEqual([]);
    expect(off({ procedures: [permit] })).toEqual([]);
    // 中止した計画には出ない
    expect(off({ planState: "voided", procedures: [permit] }, { applied: false, canRegister: true })).toEqual([]);
  });

  it("notify_police は今までどおり（記録で消え、取り下げで戻る）", () => {
    expect(off({ procedures: [police] }).map((a) => a.id)).toEqual(["notify_police"]);
    expect(off({ procedures: [police], records: { small_drone_law: { action: "done", snapshotId: SNAP } } })).toEqual([]);
    expect(off({ procedures: [permit, police] }, { applied: false, canRegister: true }).map((a) => a.id).sort()).toEqual(["notify_police", "register_permit"]);
  });
});

describe("planNextActions：並びと形", () => {
  it("tier の順、同じなら飛行開始までの時間が短い順。動詞で始まる 1 行の表示名、押すと移る先", () => {
    const rows = [row(1, "new", "reported_manual")];
    const list = planNextActions(
      build({
        nowMs: START.getTime() + 60_000,
        planState: "pending",
        stale: true,
        rows,
        fp: "fp-2",
        procedures: [{ procedureId: "flight-approval-night", deadlineLabel: "x", deadlineDate: "2027-01-01" }],
      }).input,
    );
    const tiers = list.map((a) => a.tier);
    expect([...tiers].sort((x, y) => x - y)).toEqual(tiers);
    expect(list.map((a) => a.id)).toEqual(["apply_permit", "confirm", "rejudge", "change_report"].sort((a, b) => tiers[list.findIndex((x) => x.id === a)]! - tiers[list.findIndex((x) => x.id === b)]!));
    for (const a of list) {
      expect(a.label).toBe(NEXT_ACTION_LABEL[a.id]);
      expect(a.href).toBe(planHref(PLAN_ID, a.id));
      expect(a.href.startsWith(`/ops/plans/${PLAN_ID}`)).toBe(true);
      expect(a.startsInMinutes).toBe(-1);
    }
    // 計画をまたぐ並び：同じ tier なら飛行開始が近い方が先
    const soon = { ...list[0]!, tier: 3 as const, startsInMinutes: 60 };
    const later = { ...list[0]!, tier: 3 as const, startsInMinutes: 600 };
    const high = { ...list[0]!, tier: 1 as const, startsInMinutes: 9999 };
    expect([later, soon, high].sort(compareNextActions)).toEqual([high, soon, later]);
  });

  it("全組合せ（要否 × 状況 × 計画の状態 × 時刻 × 手続き × 記録）で、ID が重複せず、tier の順で、表示名は定義済み、保存した状態を読まない", () => {
    const rowsets: ReportRowLite[][] = [
      [],
      [row(1, "new", "reported_manual")],
      [row(1, "new", "unknown")],
      [row(1, "new", "failed")],
      [row(1, "new", "reported_manual"), row(2, "cancel", "reported_manual")],
    ];
    const times = [GUIDE.getTime() - 1, GUIDE.getTime(), START.getTime()];
    const states: NextActionPlanState[] = ["draft", "pending", "approved", "approved_stale", "returned", "returned_stale", "voided"];
    const procSets: SnapshotProcedureLite[][] = [[], [{ procedureId: "flight-approval-night", deadlineLabel: "L", deadlineDate: "2027-01-01" }], [{ procedureId: "small-drone-law-consent-notice", deadlineLabel: "L", deadlineDate: null }]];
    let n = 0;
    for (const kind of KINDS)
      for (const rows of rowsets)
        for (const fp of ["fp-1", "fp-2"])
          for (const ps of states)
            for (const ms of times)
              for (const procedures of procSets)
                for (const copied of [false, true]) {
                  const list = planNextActions(build({ kind, rows, fp, planState: ps, nowMs: ms, procedures, copied, stale: ps === "approved" }).input);
                  const idl = list.map((a) => a.id);
                  expect(new Set(idl).size, `${kind}/${ps}`).toBe(idl.length);
                  const tiers = list.map((a) => a.tier);
                  expect([...tiers].sort((x, y) => x - y)).toEqual(tiers);
                  for (const a of list) {
                    expect(NEXT_ACTION_LABEL[a.id]).toBe(a.label);
                    // 推奨は警告（tier 1〜2）にならない
                    if (a.id === "consider_report") expect(a.tier).toBe(5);
                  }
                  // 中止した計画で出うるのは、通報の取消・結果の記録だけ
                  if (ps === "voided") expect(idl.every((i) => i === "cancel_report" || i === "record_result")).toBe(true);
                  n++;
                }
    expect(n).toBe(4 * 5 * 2 * 7 * 3 * 3 * 2);
  });

  it("法定の期限として日付・時刻を作らない：出力の日付は、スナップショットの手続きのものと、社内の目安だけ", () => {
    const list = planNextActions(build({ nowMs: START.getTime() + 1 }).input);
    const text = JSON.stringify(list);
    // 目安の時刻（日付）は dueLabel に出ない（時間の文言だけ）
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(text).toContain("社内の目安");
  });
});
