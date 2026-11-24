// 判定の総合の語（Sprint 16-H2。契約 §8.2）。計画の段 ⑥（/ops/plans/[id]/judgement）の第 1 層。
// 判定エンジンが返す項目の区分（FlightVerdict.items の verdict）を数えるだけで、判定の結果は変えない。
// 順序は「飛行不可 → 要手続き → 判定不能（未確認）→ 手続き済み → 手続き不要」。判定不能が 1 件でもあれば、総合を「手続き済み」「手続き不要」の語にしない。
// 「飛行可」「安全」「OK」「問題なし」「通報不要」は、どの状態にも使わない。
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

const count = (v: FlightVerdict, k: ItemVerdict): number => v.items.filter((i) => i.verdict === k).length;

export const judgementTotal = (verdict: FlightVerdict | undefined, stale: boolean): JudgementTotal => {
  const pre = stale ? STALE_TOTAL_PREFIX : "";
  if (verdict === undefined) {
    return { key: "missing", sign: "unknown", text: `${pre}未確認（判定の記録がありません）`, stale, count: 0 };
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

/** タイルを重い順に並べるための順位（飛行不可 → 要手続き → 判定不能 → 手続き済み → 手続き不要）。 */
export const TILE_RANK: Readonly<Record<ItemVerdict, number>> = {
  no_fly: 0,
  needs_procedure: 1,
  unknown: 2,
  procedure_done: 3,
  no_procedure: 4,
};
