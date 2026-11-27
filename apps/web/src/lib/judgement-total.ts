// 判定の総合の語（Sprint 16-H2。契約 §8.2）。計画の段 ⑥（/ops/plans/[id]/judgement）の第 1 層。
// 判定エンジンが返す項目の区分（FlightVerdict.items の verdict）を数えるだけで、判定の結果は変えない。
// 順序は「飛行不可 → 要手続き → 判定不能（未確認）→ 手続き済み → 手続き不要」。判定不能が 1 件でもあれば、総合を「手続き済み」「手続き不要」の語にしない。
// 飛行できる・安全・問題がない・通報が要らない、と読める語は、どの状態にも使わない（単体テストが語の一覧で確かめる）。
import type { FlightVerdict, ItemVerdict } from "@soraban/regulations";

export type TotalKey = "no_fly" | "needs_procedure" | "unknown" | "done" | "none" | "missing";

export type JudgementTotal = {
  readonly key: TotalKey;
  /** 形の印（VerdictSign に渡す区分）。 */
  readonly sign: ItemVerdict;
  /** 総合の語（古い判定のときは先頭に「古い判定：」）。 */
  readonly text: string;
  /** 語の下に添える既存の注記（調べていない項目の注記など）。 */
  readonly note?: string;
  readonly stale: boolean;
  /** 件数（判定の記録が無いときは 0）。 */
  readonly count: number;
};

export const STALE_TOTAL_PREFIX = "古い判定：";
export const TOTAL_NONE_NOTE = "調べていない項目があります";
/** 総合を、エンジンの段（verdict.level）の側に倒したときの注記（項目の数え方だけでは軽くなる場合）。 */
export const TOTAL_LEVEL_ADJUSTED_NOTE = "判定の段に合わせています";

const count = (v: FlightVerdict, k: ItemVerdict): number => v.items.filter((i) => i.verdict === k).length;

/** 総合の重さ（判定不能は要手続きと同じ重さに数える）。エンジンの段と比べるための順位。 */
const TOTAL_WEIGHT: Readonly<Record<TotalKey, number>> = { no_fly: 3, needs_procedure: 2, unknown: 2, missing: 2, done: 1, none: 0 };
const LEVEL_WEIGHT: Readonly<Record<ItemVerdict, number>> = { no_fly: 3, needs_procedure: 2, unknown: 2, procedure_done: 1, no_procedure: 0 };

const withCount = (n: number, base: string, pre: string): string => `${pre}${base}${n > 0 ? `（${n} 件）` : ""}`;

const fromItems = (verdict: FlightVerdict, stale: boolean): JudgementTotal => {
  const pre = stale ? STALE_TOTAL_PREFIX : "";
  // 項目が 0 件のとき、エンジンは要手続きに倒す。ここでは「手続き不要」の語にせず、未確認にする。
  if (verdict.items.length === 0) {
    return { key: "unknown", sign: "unknown", text: `${pre}未確認（判定の項目がありません）`, stale, count: 0 };
  }
  const noFly = count(verdict, "no_fly");
  if (noFly > 0) return { key: "no_fly", sign: "no_fly", text: `${pre}飛行不可の項目があります（${noFly} 件）`, stale, count: noFly };
  const needs = count(verdict, "needs_procedure");
  if (needs > 0) return { key: "needs_procedure", sign: "needs_procedure", text: `${pre}手続きが要る項目があります（${needs} 件）`, stale, count: needs };
  const unknown = Math.max(verdict.unknownCount, count(verdict, "unknown"));
  if (unknown > 0) return { key: "unknown", sign: "unknown", text: `${pre}未確認の項目があります（${unknown} 件）`, stale, count: unknown };
  const done = count(verdict, "procedure_done");
  if (done > 0) return { key: "done", sign: "procedure_done", text: `${pre}調べた項目は手続き済みです。条件を確認してください`, stale, count: done };
  return {
    key: "none",
    sign: "no_procedure",
    text: `${pre}調べた項目では、手続きが要るものは見つかりませんでした`,
    note: TOTAL_NONE_NOTE,
    stale,
    count: count(verdict, "no_procedure"),
  };
};

/** 古い判定のときは、総合の印を注意側にする（軽い印「手続き済み」「手続き不要」のままにしない。重い印はそのまま）。 */
const forStale = (t: JudgementTotal): JudgementTotal =>
  t.stale && (t.sign === "procedure_done" || t.sign === "no_procedure") ? { ...t, sign: "unknown" } : t;

export const judgementTotal = (verdict: FlightVerdict | undefined, stale: boolean): JudgementTotal => forStale(judgementTotalRaw(verdict, stale));

const judgementTotalRaw = (verdict: FlightVerdict | undefined, stale: boolean): JudgementTotal => {
  const pre = stale ? STALE_TOTAL_PREFIX : "";
  if (verdict === undefined) {
    return { key: "missing", sign: "unknown", text: `${pre}未確認（判定の記録がありません）`, stale, count: 0 };
  }
  const t = fromItems(verdict, stale);
  // 守り：総合の重さが、エンジンの段（verdict.level）より軽くならない。軽くなるときは段の側に倒す。
  const level = verdict.level as ItemVerdict | undefined;
  if (level !== undefined && level in LEVEL_WEIGHT && TOTAL_WEIGHT[t.key] < LEVEL_WEIGHT[level]) {
    const note = TOTAL_LEVEL_ADJUSTED_NOTE;
    if (level === "no_fly") return { key: "no_fly", sign: "no_fly", text: withCount(count(verdict, "no_fly"), "飛行不可の項目があります", pre), note, stale, count: count(verdict, "no_fly") };
    if (level === "needs_procedure" || level === "unknown") {
      const n = count(verdict, "needs_procedure");
      return { key: "needs_procedure", sign: "needs_procedure", text: withCount(n, "手続きが要る項目があります", pre), note, stale, count: n };
    }
    const n = count(verdict, "procedure_done");
    return { key: "done", sign: "procedure_done", text: `${pre}調べた項目は手続き済みです。条件を確認してください`, note, stale, count: n };
  }
  return t;
};

/** タイルを重い順に並べるための順位（飛行不可 → 要手続き → 判定不能 → 手続き済み → 手続き不要）。 */
export const TILE_RANK: Readonly<Record<ItemVerdict, number>> = {
  no_fly: 0,
  needs_procedure: 1,
  unknown: 2,
  procedure_done: 3,
  no_procedure: 4,
};
