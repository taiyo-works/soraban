import { describe, expect, it } from "vitest";
import { aggregateVerdictLevel, type FlightVerdict, type ItemVerdict } from "@soraban/regulations";
import { judgementTotal, STALE_TOTAL_PREFIX, TILE_RANK, TOTAL_NONE_NOTE } from "./judgement-total";

// level は、エンジンと同じ集約（aggregateVerdictLevel：判定不能と 0 件は要手続き）で求める。
const mk = (verdicts: readonly ItemVerdict[], unknownCount = 0): FlightVerdict =>
  ({
    level: aggregateVerdictLevel(verdicts.map((verdict) => ({ verdict }))),
    unknownCount,
    items: verdicts.map((verdict, i) => ({ id: `i${i}`, verdict })),
    noFly: [],
    procedures: [],
    done: [],
    perFlightDuties: [],
    permits: [],
  }) as unknown as FlightVerdict;

const FORBIDDEN = ["飛行可", "安全", "OK", "問題なし", "通報不要", "完璧", "保証", "必ず"];

describe("judgementTotal（契約 §8.2 の総合の語）", () => {
  it("飛行不可が 1 つ以上：件数つきの語（飛行不可が先）", () => {
    const t = judgementTotal(mk(["no_fly", "needs_procedure", "unknown", "no_procedure"]), false);
    expect(t).toMatchObject({ key: "no_fly", sign: "no_fly", text: "飛行不可の項目があります（1 件）", count: 1 });
  });
  it("要手続きが 1 つ以上（飛行不可なし）", () => {
    const t = judgementTotal(mk(["needs_procedure", "needs_procedure", "unknown", "procedure_done"]), false);
    expect(t).toMatchObject({ key: "needs_procedure", text: "手続きが要る項目があります（2 件）", count: 2 });
  });
  it("判定不能が 1 つ以上（上の 2 つなし）：「手続き済み」「手続き不要」の語にしない", () => {
    const t = judgementTotal(mk(["unknown", "procedure_done", "no_procedure", "unknown"], 2), false);
    expect(t).toMatchObject({ key: "unknown", sign: "unknown", text: "未確認の項目があります（2 件）" });
    expect(t.text).not.toContain("手続き済み");
    expect(t.text).not.toContain("見つかりませんでした");
  });
  it("判定不能の件数は、エンジンの判定不能の件数と項目の数の大きいほう", () => {
    expect(judgementTotal(mk(["unknown"], 3), false).text).toBe("未確認の項目があります（3 件）");
    expect(judgementTotal(mk(["unknown", "unknown"], 0), false).text).toBe("未確認の項目があります（2 件）");
  });
  it("手続き済みだけ、または手続き済みと手続き不要だけ", () => {
    for (const v of [["procedure_done"], ["procedure_done", "no_procedure", "no_procedure"]] as const) {
      const t = judgementTotal(mk(v), false);
      expect(t).toMatchObject({ key: "done", sign: "procedure_done", text: "調べた項目は手続き済みです。条件を確認してください" });
    }
  });
  it("すべて手続き不要：「調べていない項目があります」の注記つき", () => {
    const t = judgementTotal(mk(["no_procedure", "no_procedure"]), false);
    expect(t).toMatchObject({ key: "none", sign: "no_procedure", text: "調べた項目では、手続きが要るものは見つかりませんでした", note: TOTAL_NONE_NOTE });
    expect(TOTAL_NONE_NOTE).toBe("調べていない項目があります");
  });
  it("判定の記録が無い：未確認", () => {
    expect(judgementTotal(undefined, false)).toMatchObject({ key: "missing", sign: "unknown", text: "未確認（判定の記録がありません）" });
  });
  it("古い判定：どの状態でも先頭に「古い判定：」を付ける", () => {
    for (const v of [mk(["no_fly"]), mk(["needs_procedure"]), mk(["unknown"], 1), mk(["procedure_done"]), mk(["no_procedure"]), undefined]) {
      const t = judgementTotal(v, true);
      expect(t.text.startsWith(STALE_TOTAL_PREFIX)).toBe(true);
      expect(t.stale).toBe(true);
      expect(judgementTotal(v, false).text.startsWith(STALE_TOTAL_PREFIX)).toBe(false);
    }
  });
  it("古い判定：総合の印を注意側にする（軽い印のままにしない。重い印はそのまま）", () => {
    expect(judgementTotal(mk(["no_procedure"]), true)).toMatchObject({ key: "none", sign: "unknown" });
    expect(judgementTotal(mk(["procedure_done"]), true)).toMatchObject({ key: "done", sign: "unknown" });
    expect(judgementTotal(mk(["no_fly"]), true).sign).toBe("no_fly");
    expect(judgementTotal(mk(["needs_procedure"]), true).sign).toBe("needs_procedure");
    expect(judgementTotal(mk(["no_procedure"]), false).sign).toBe("no_procedure");
  });
  it("禁止語を含まない（どの状態でも）", () => {
    for (const v of [mk(["no_fly"]), mk(["needs_procedure"]), mk(["unknown"], 1), mk(["procedure_done"]), mk(["no_procedure"]), mk([]), undefined]) {
      for (const stale of [false, true]) {
        const t = judgementTotal(v, stale);
        for (const w of FORBIDDEN) {
          expect(t.text, `${t.key} ${stale}`).not.toContain(w);
          expect(t.note ?? "").not.toContain(w);
        }
      }
    }
  });
  it("項目が 0 件：未確認にする（手続き不要の語・印にしない。エンジンは 0 件を要手続きに倒す）", () => {
    const t = judgementTotal(mk([]), false);
    expect(t.key).not.toBe("none");
    expect(t.sign).not.toBe("no_procedure");
    expect(t).toMatchObject({ key: "unknown", sign: "unknown" });
    expect(t.text).not.toContain("見つかりませんでした");
    expect(judgementTotal(mk([]), true).text.startsWith(STALE_TOTAL_PREFIX)).toBe(true);
  });
  it("守り：総合の重さが、エンジンの段より軽くならない（段の側に倒す。判定不能は要手続きと同じ重さ）", () => {
    const lv = (level: string, verdicts: readonly ItemVerdict[]) => ({ ...mk(verdicts), level }) as unknown as FlightVerdict;
    // 段が飛行不可なのに、項目に飛行不可が無い
    expect(judgementTotal(lv("no_fly", ["no_procedure"]), false)).toMatchObject({ key: "no_fly", sign: "no_fly" });
    // 段が要手続きなのに、項目が手続き不要・手続き済みだけ
    expect(judgementTotal(lv("needs_procedure", ["no_procedure"]), false)).toMatchObject({ key: "needs_procedure" });
    expect(judgementTotal(lv("needs_procedure", ["procedure_done"]), false)).toMatchObject({ key: "needs_procedure" });
    // 段が手続き済みなのに、項目が手続き不要だけ
    expect(judgementTotal(lv("procedure_done", ["no_procedure"]), false)).toMatchObject({ key: "done" });
    // 判定不能は要手続きと同じ重さ：段が要手続きで総合が未確認なら、そのまま（倒さない）
    expect(judgementTotal(lv("needs_procedure", ["unknown"]), false)).toMatchObject({ key: "unknown" });
    // 軽くならない場合は変えない
    expect(judgementTotal(lv("no_procedure", ["no_procedure"]), false)).toMatchObject({ key: "none" });
    expect(judgementTotal(lv("no_fly", ["no_fly"]), false)).toMatchObject({ key: "no_fly", count: 1 });
  });
  it("タイルの順位は重い順", () => {
    expect(TILE_RANK.no_fly).toBeLessThan(TILE_RANK.needs_procedure);
    expect(TILE_RANK.needs_procedure).toBeLessThan(TILE_RANK.unknown);
    expect(TILE_RANK.unknown).toBeLessThan(TILE_RANK.procedure_done);
    expect(TILE_RANK.procedure_done).toBeLessThan(TILE_RANK.no_procedure);
  });
});
