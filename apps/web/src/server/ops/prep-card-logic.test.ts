import { describe, expect, it } from "vitest";
import {
  heaviestTone,
  PREP_INSPECTION,
  PREP_REPORT,
  prepInspectionKey,
  prepJudgementRow,
  prepModel,
  prepReportKey,
  type PrepJudgementCounts,
  type PrepJudgementInput,
} from "./prep-card-logic";

const C = (o: Partial<PrepJudgementCounts> = {}): PrepJudgementCounts => ({ noFly: 0, needs: 0, unknown: 0, done: 0, none: 0, ...o });
const counts = (o: Partial<PrepJudgementCounts>, stale = false): PrepJudgementInput => ({ kind: "counts", counts: C(o), stale });

// 良い状態と読ませてはいけない語（不変条件 3）
const BANNED = ["飛行可", "安全", "OK", "問題なし", "通報不要", "完璧", "保証", "必ず", "代行", "代理", "申請"];

describe("準備カード：通報の行（§8.1）", () => {
  it("通報の状況の導出を 3 つの語に寄せる。記録が無い・変更の確認・失敗・不明・送信中は「内容を確認する」", () => {
    expect(PREP_REPORT[prepReportKey("reported")].text).toBe("受付番号を記録済み");
    expect(PREP_REPORT[prepReportKey("cancelled")].text).toBe("取り消し済み");
    for (const c of ["no_record", "change_review", "cancel_needed", "unknown", "failed", "sending"] as const) {
      expect(prepReportKey(c)).toBe("confirm");
      expect(PREP_REPORT.confirm.text).toBe("DIPS に出す内容を確認する");
    }
    expect(prepReportKey("not_applicable_model")).toBe("not_applicable");
  });
  it("記録済みだけが安全。取り消し済みは危険、確認は注意", () => {
    expect(PREP_REPORT.recorded.tone).toBe("safe");
    expect(PREP_REPORT.cancelled.tone).toBe("danger");
    expect(PREP_REPORT.confirm.tone).toBe("warn");
  });
});

describe("準備カード：飛行前点検の行", () => {
  it("当日の記録があるときだけ「記録済み」。先の日の計画・記録なしは「未記録」。異常は危険", () => {
    expect(prepInspectionKey({ isFlightDay: true, done: true, abnormal: false })).toBe("recorded");
    expect(prepInspectionKey({ isFlightDay: true, done: true, abnormal: true })).toBe("abnormal");
    expect(prepInspectionKey({ isFlightDay: true, done: false, abnormal: false })).toBe("missing");
    expect(prepInspectionKey({ isFlightDay: false, done: true, abnormal: false })).toBe("missing");
    expect(PREP_INSPECTION.abnormal.tone).toBe("danger");
    expect(PREP_INSPECTION.missing.tone).toBe("warn");
  });
});

describe("準備カード：判定の総合の語（§8.2。全 8 状態）", () => {
  it("飛行不可が 1 つ以上 → 危険・斜線（×）の形", () => {
    const r = prepJudgementRow(counts({ noFly: 2, needs: 1, unknown: 1 }));
    expect(r).toMatchObject({ tone: "danger", level: "no_fly", text: "飛行不可の項目があります（2 件）" });
  });
  it("要手続きが 1 つ以上（飛行不可なし）→ 注意。判定不能が混じっていても、要手続きが先", () => {
    expect(prepJudgementRow(counts({ needs: 1, unknown: 3 }))).toMatchObject({ tone: "warn", level: "needs_procedure", text: "手続きが要る項目があります（1 件）" });
  });
  it("判定不能が 1 つ以上（上の 2 つなし）→ 未確認（灰）。手続き済み・手続き不要が一緒にあっても、その語にしない", () => {
    const r = prepJudgementRow(counts({ unknown: 1, done: 4, none: 9 }));
    expect(r).toMatchObject({ tone: "unknown", level: "unknown", text: "未確認の項目があります（1 件）" });
    expect(r.text).not.toContain("手続き済み");
    expect(r.text).not.toContain("手続きが要るものは見つかりませんでした");
  });
  it("手続き済みだけ、または手続き済みと手続き不要だけ → 情報", () => {
    expect(prepJudgementRow(counts({ done: 2 }))).toMatchObject({ tone: "info", text: "調べた項目は手続き済みです。条件を確認してください" });
    expect(prepJudgementRow(counts({ done: 1, none: 5 })).tone).toBe("info");
  });
  it("すべて手続き不要 → 安全の形。「調べていない項目があります」を添える", () => {
    expect(prepJudgementRow(counts({ none: 3 }))).toMatchObject({
      tone: "safe",
      level: "no_procedure",
      text: "調べた項目では、手続きが要るものは見つかりませんでした",
      note: "調べていない項目があります",
    });
  });
  it("判定の項目が 1 件も無い・記録が無い → 未確認（判定の記録がありません）＋再読み込み。良い状態に読ませない", () => {
    for (const j of [counts({}), { kind: "no_record", stale: false } as PrepJudgementInput]) {
      expect(prepJudgementRow(j)).toMatchObject({ tone: "unknown", text: "未確認（判定の記録がありません）", action: "reload" });
    }
  });
  it("読み込みの失敗 → 未確認（読み込めませんでした）＋再読み込み", () => {
    expect(prepJudgementRow({ kind: "load_failed" })).toMatchObject({ tone: "unknown", level: "unknown", text: "未確認（読み込めませんでした）", action: "reload" });
  });
  it("判定の記録が古い → 「古い判定：」を前に付け、色は注意以上（良い側に見せない）", () => {
    expect(prepJudgementRow(counts({ needs: 1 }, true))).toMatchObject({ tone: "warn", text: "古い判定：手続きが要る項目があります（1 件）" });
    expect(prepJudgementRow(counts({ none: 2 }, true))).toMatchObject({ tone: "warn", text: "古い判定：調べた項目では、手続きが要るものは見つかりませんでした" });
    expect(prepJudgementRow(counts({ noFly: 1 }, true)).tone).toBe("danger");
    expect(prepJudgementRow(counts({ done: 1 }, true)).tone).toBe("warn");
  });
  it("どの状態の語にも、禁止語を使わない", () => {
    const all: PrepJudgementInput[] = [
      counts({ noFly: 1 }), counts({ needs: 1 }), counts({ unknown: 1 }), counts({ done: 1 }), counts({ none: 1 }), counts({}),
      { kind: "no_record", stale: false }, { kind: "load_failed" }, counts({ none: 1 }, true),
    ];
    const words = [...all.map((j) => prepJudgementRow(j)), ...Object.values(PREP_REPORT), ...Object.values(PREP_INSPECTION)].flatMap((r) => [r.text, r.note ?? ""]);
    for (const w of words) for (const b of BANNED) expect(w, `${w} に ${b}`).not.toContain(b);
  });
});

describe("準備カード：帯の色と読み上げ", () => {
  it("帯の色は 3 行のうち、危険＞注意＞未確認＞情報＞安全", () => {
    expect(heaviestTone([{ tone: "safe" }, { tone: "info" }])).toBe("info");
    expect(heaviestTone([{ tone: "info" }, { tone: "unknown" }])).toBe("unknown");
    expect(heaviestTone([{ tone: "unknown" }, { tone: "warn" }])).toBe("warn");
    expect(heaviestTone([{ tone: "warn" }, { tone: "danger" }, { tone: "safe" }])).toBe("danger");
  });
  it("読み上げは 1 文（16-E の見本と同じ形）", () => {
    const m = prepModel({ report: "recorded", inspection: "missing", judgement: counts({ unknown: 2 }) });
    expect(m.tone).toBe("warn");
    expect(m.readout).toBe("次の飛行の準備。通報、受付番号を記録済み。飛行前点検、未記録。判定、未確認の項目が 2 件あります。");
    const d = prepModel({ report: "cancelled", inspection: "abnormal", judgement: counts({ noFly: 2 }) });
    expect(d.readout).toBe("次の飛行の準備。通報、取り消し済み。飛行前点検、異常あり。判定、飛行不可の項目が 2 件あります。");
    const s = prepModel({ report: "recorded", inspection: "recorded", judgement: counts({ none: 1 }) });
    expect(s.readout).toBe("次の飛行の準備。通報、受付番号を記録済み。飛行前点検、記録済み。判定、調べた項目では、手続きが要るものは見つかりませんでした。調べていない項目があります。");
    expect(s.tone).toBe("safe");
  });
  it("判定の行が取れなくても、他の 2 行は出る（帯の色は判定の行を含めて決まる）", () => {
    const m = prepModel({ report: "recorded", inspection: "recorded", judgement: { kind: "load_failed" } });
    expect(m.report.text).toBe("受付番号を記録済み");
    expect(m.inspection.text).toBe("記録済み");
    expect(m.tone).toBe("unknown");
  });
});
