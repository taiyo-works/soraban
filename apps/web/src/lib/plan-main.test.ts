import { describe, expect, it } from "vitest";
import type { ReportStatusCode } from "@soraban/dips";
import { judgeLineModel, JUDGE_UNREADABLE, primaryActionOf, REPORT_NOTE_SHORT, VOIDED_NO_RECORD_LABEL } from "./plan-main";

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
  const base = { planId: "P", voided: false, state: "pending", canAct: {} } as const;
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
  it("中止：記録なしは計画を見る、記録ありは取消の記録", () => {
    expect(act("no_record", { voided: true })).toMatchObject({ id: "view_plan", href: "/ops/plans/P/overview" });
    expect(act("cancel_needed", { voided: true })).toMatchObject({ label: "取消の結果を記録する", href: "/ops/plans/P/report?kind=cancel#record" });
    expect(act("cancelled", { voided: true }).id).toBe("view_history");
  });
  it("差し戻し → 計画を訂正する（操作できるときだけ）", () => {
    expect(act("no_record", { state: "returned", canAct: { fix_returned: true } }).id).toBe("fix_returned");
    expect(act("no_record", { state: "returned", canAct: { fix_returned: false } }).id).toBe("view_report");
  });
});

describe("新しい文言に禁止語が無い", () => {
  it("短い固定の文言・中止の表示", () => {
    for (const t of [REPORT_NOTE_SHORT, VOIDED_NO_RECORD_LABEL, JUDGE_UNREADABLE]) for (const w of FORBIDDEN) expect(t).not.toContain(w);
  });
});
