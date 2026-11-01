import { describe, expect, it } from "vitest";
import type { ReportStatusCode } from "@soraban/dips";
import { cardHeading, judgeLineModel, JUDGE_UNREADABLE, primaryActionOf, REPORT_NOTE_SHORT, splitNextActions, VOIDED_NO_RECORD_LABEL, VOIDED_NO_RECORD_NOTE, voidedCancelNotice } from "./plan-main";

const FORBIDDEN = ["通報不要", "通報は不要", "通報の必要はありません", "通報しなくて", "問題なし", "OK", "大丈夫", "完璧", "保証", "必ず", "代行", "代理"];

describe("判定の 1 行（J-1・J-5）", () => {
  it("結論の段があれば、その言葉と判定不能の件数", () => {
    const m = judgeLineModel({ level: "needs_procedure", unknownCount: 2, stale: true, sourcesStale: true });
    expect(m).toMatchObject({ kind: "ok", levelLabel: "要手続き", unknownCount: 2, stale: true, sourcesStale: true });
  });
  it("段が無い・未知の値・空は、確認できない（要として扱う）", () => {
    for (const level of [undefined, null, "", "weird"]) {
      expect(judgeLineModel({ level, unknownCount: 0, stale: false, sourcesStale: false }).kind).toBe("unreadable");
    }
    expect(JUDGE_UNREADABLE).toBe("判定を確認できません。要として扱います");
  });
  it("判定不能の件数が壊れていても 0 件として扱う", () => {
    expect(judgeLineModel({ level: "no_fly", unknownCount: Number.NaN, stale: false, sourcesStale: false })).toMatchObject({ unknownCount: 0 });
  });
});

describe("主操作（1 つ。状態で決まる）", () => {
  const base = { planId: "P", voided: false, state: "pending", hasEffective: false, canAct: {} } as const;
  const act = (statusCode: ReportStatusCode, extra: Partial<Parameters<typeof primaryActionOf>[0]> = {}) => primaryActionOf({ ...base, statusCode, ...extra });
  it("下書き → 確認を依頼する（操作できなければ内容を見る）", () => {
    expect(act("no_record", { state: "draft" })).toMatchObject({ label: "確認を依頼する", href: "/ops/plans/P/overview#request-confirmation" });
    expect(act("no_record", { state: "draft", canAct: { request_confirmation: false } }).id).toBe("view_report");
  });
  it("確認依頼済み・未通報 → 通報の内容を見る・通報する", () => {
    expect(act("no_record")).toMatchObject({ label: "通報の内容を見る・通報する", href: "/ops/plans/P/report" });
  });
  it("通報済み → 結果を見る、変更が必要 → 変更の通報、結果不明・失敗 → 結果を記録する", () => {
    expect(act("reported").label).toBe("通報の結果を見る");
    expect(act("change_review")).toMatchObject({ label: "変更の通報を準備する", href: "/ops/plans/P/report?kind=change" });
    expect(act("unknown")).toMatchObject({ label: "結果を記録する", href: "/ops/plans/P/report#record" });
    expect(act("failed").href).toBe("/ops/plans/P/report#record");
  });
  it("押せない人（閲覧者など）には、記録の操作ではなく内容を見るを主操作にする", () => {
    expect(act("unknown", { canAct: { record_result: false } }).id).toBe("view_report");
    expect(act("change_review", { canAct: { change_report: false } }).id).toBe("view_report");
    expect(act("no_record", { canAct: { report: false } }).id).toBe("view_report");
  });
  it("差し戻しより、結果不明・失敗・変更が必要を優先する（二重通報を避ける）", () => {
    const ret = { state: "returned", canAct: { fix_returned: true } } as const;
    for (const c of ["unknown", "failed", "change_review"] as const) expect(act(c, ret).id).not.toBe("fix_returned");
    expect(act("no_record", ret).id).toBe("fix_returned");
    expect(act("reported", ret).id).toBe("fix_returned");
    expect(act("no_record", { state: "returned", canAct: { fix_returned: false } }).id).toBe("view_report");
  });
  // 中止 × 通報の状態。有効な通報が DIPS に残るのに気づけない状態を作らない（高-1）
  const V = { voided: true } as const;
  it("中止 × 取消が必要 / 有効な通報あり → 取消の結果を記録する", () => {
    expect(act("cancel_needed", V)).toMatchObject({ label: "取消の結果を記録する", href: "/ops/plans/P/report?kind=cancel#record" });
    for (const c of ["failed", "unknown", "sending"] as const) {
      expect(act(c, { ...V, hasEffective: true }), c).toMatchObject({ id: "record_cancel", href: "/ops/plans/P/report?kind=cancel#record" });
      expect(voidedCancelNotice({ voided: true, statusCode: c, hasEffective: true }), c).toContain("取消が必要です");
    }
    expect(voidedCancelNotice({ voided: true, statusCode: "cancel_needed", hasEffective: true })).toContain("取消が必要です");
  });
  it("中止 × 有効な通報なしの失敗・結果不明・送信中 → 結果を記録する（確かめる案内）", () => {
    for (const c of ["failed", "unknown", "sending"] as const) {
      expect(act(c, V), c).toMatchObject({ id: "record_result", href: "/ops/plans/P/report#record" });
      expect(voidedCancelNotice({ voided: true, statusCode: c, hasEffective: false }), c).toContain("通報の結果が分かりません");
    }
  });
  it("中止 × 記録なしは計画を見る、取消済みは履歴。案内は出さない", () => {
    expect(act("no_record", V)).toMatchObject({ id: "view_plan", href: "/ops/plans/P/overview" });
    expect(act("cancelled", V).id).toBe("view_history");
    expect(voidedCancelNotice({ voided: true, statusCode: "no_record", hasEffective: false })).toBeNull();
    expect(voidedCancelNotice({ voided: true, statusCode: "cancelled", hasEffective: false })).toBeNull();
    expect(voidedCancelNotice({ voided: false, statusCode: "failed", hasEffective: true })).toBeNull();
  });
  it("中止 × 取消を記録できない人には履歴を主操作にする", () => {
    expect(act("cancel_needed", { ...V, canAct: { cancel_report: false } }).id).toBe("view_history");
  });
  it("差し戻し → 計画を訂正する（操作できるときだけ）", () => {
    expect(act("no_record", { state: "returned", canAct: { fix_returned: true } }).id).toBe("fix_returned");
  });
});

describe("次にやることの表示（期限超過は畳まない）", () => {
  const mk = (tiers: number[]) => tiers.map((tier, i) => ({ id: String(i), tier }));
  it("先頭 limit 件に加え、tier 2 以下はすべて表示する", () => {
    const { shown, rest } = splitNextActions(mk([4, 4, 2, 1, 3, 5]), 2);
    expect(shown.map((a) => a.id)).toEqual(["0", "1", "2", "3"]);
    expect(rest.map((a) => a.id)).toEqual(["4", "5"]);
  });
  it("期限超過が無ければ limit のとおり", () => {
    const { shown, rest } = splitNextActions(mk([3, 4, 5]), 2);
    expect(shown).toHaveLength(2);
    expect(rest).toHaveLength(1);
  });
});

describe("新しい文言に禁止語が無い", () => {
  it("短い固定の文言・中止の表示", () => {
    for (const t of [REPORT_NOTE_SHORT, VOIDED_NO_RECORD_LABEL, VOIDED_NO_RECORD_NOTE, JUDGE_UNREADABLE, voidedCancelNotice({ voided: true, statusCode: "failed", hasEffective: true }) ?? "", voidedCancelNotice({ voided: true, statusCode: "failed", hasEffective: false }) ?? ""]) for (const w of FORBIDDEN) expect(t).not.toContain(w);
  });
});

describe("状況カードの見出し（R-2）", () => {
  const req = "通報：要";
  const h = (statusCode: ReportStatusCode, voided = false, hasEffective = false) => cardHeading({ voided, statusCode, hasEffective, requirementLabel: req });
  it("記録が無いうちは通報の要否、通報済み・取消済みは状況の言葉", () => {
    expect(h("no_record")).toBe(req);
    expect(h("change_review")).toBe(req);
    expect(h("reported")).toContain("通報済み");
    expect(h("cancelled")).toContain("取消済み");
  });
  it("中止：記録なしは事実、取消待ちは取消の記録を促す", () => {
    expect(h("no_record", true)).toBe("中止（通報の記録はありません）");
    expect(h("cancel_needed", true, true)).toBe("取消の結果を記録してください");
    expect(h("failed", true, true)).toBe("取消の結果を記録してください");
    expect(h("failed", true, false)).toContain("確かめてください");
    expect(h("cancelled", true)).toContain("取消済み");
  });
  it("禁止語を含まない", () => {
    for (const c of ["no_record", "reported", "cancelled", "failed", "cancel_needed"] as const)
      for (const v of [true, false]) for (const w of ["通報不要", "問題なし", "OK", "必ず", "保証"]) expect(h(c, v, true)).not.toContain(w);
  });
});
