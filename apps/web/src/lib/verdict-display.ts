// 判定（4 段＋判定不能）の表し方の共通定義（Sprint 11d D1）。画面（verdict-summary.tsx）と
// 地点判定の PDF（regulation-pdf.tsx）・申請支援の PDF（application-pdf.tsx）で同じ言葉・同じ記号・同じ並びにする。
//
// 記号の形（色に頼らない。WCAG 2.2 AA 1.4.1）：
//   飛行不可 = 斜線の丸 / 要手続き = 三角 / 手続き済み（条件付き）= 中抜きの丸にチェック /
//   手続き不要 = 塗りの丸 / 判定不能 = 破線の四角と「？」
// 具体の線の太さ・大きさ・配色は designer が磨く（構造と形の区別だけをここで決める）。
import {
  BASE_STATUS_LABEL,
  LEGAL_TIER_LABEL,
  VERDICT_LABEL,
  type FlightVerdict,
  type ItemVerdict,
  type LegalTier,
  type VerdictDoneItem,
  type RegulationStatus,
} from "@soraban/regulations";

export { BASE_STATUS_LABEL, LEGAL_TIER_LABEL, VERDICT_LABEL };

/** 記号の形（画面の SVG・PDF の Svg・履歴の文字記号で共通）。 */
export type VerdictShape = "slashed-circle" | "triangle" | "checked-ring" | "filled-circle" | "dashed-square";

export const VERDICT_SHAPE: Readonly<Record<ItemVerdict, VerdictShape>> = {
  no_fly: "slashed-circle",
  needs_procedure: "triangle",
  procedure_done: "checked-ring",
  no_procedure: "filled-circle",
  unknown: "dashed-square",
};

/** 文字だけの場面（履歴の一覧など）の記号。 */
export const VERDICT_GLYPH: Readonly<Record<ItemVerdict, string>> = {
  no_fly: "⊘",
  needs_procedure: "△",
  procedure_done: "◎",
  no_procedure: "●",
  unknown: "?",
};

/** 段階の色（画面の Tailwind クラス。補助。意味は言葉と形が担う）。 */
export const VERDICT_TONE: Readonly<Record<ItemVerdict, string>> = {
  no_fly: "text-signal-red",
  needs_procedure: "text-signal-amber",
  procedure_done: "text-brand-700",
  no_procedure: "text-signal-green",
  unknown: "text-ink-mute",
};

/** 段階の色（PDF の 16 進。トークンのライトの値と合わせる）。 */
export const VERDICT_PDF_COLOR: Readonly<Record<ItemVerdict, string>> = {
  no_fly: "#B53A3A",
  needs_procedure: "#B97E1E",
  procedure_done: "#1D3557",
  no_procedure: "#3A7A4F",
  unknown: "#5B6170",
};

/** 見出し（画面・PDF 共通。この順に並べる）。 */
export const VERDICT_SECTION_TITLE = {
  conclusion: "結論",
  noFly: "飛行できない理由",
  procedures: "要手続きの手続き（期限順）",
  done: "手続き済み（条件付き）",
  duties: "飛行の前後に必ず行うこと",
  items: "規制ごとの判定（元の判定 → 適用した許可 → 判定）",
} as const;

/** 段取り表の列（画面・PDF 共通）。 */
export const PROCEDURE_COLUMNS = ["手続き", "出す先", "期限", "法的な重さ"] as const;

/** 結論の横に出す判定不能の件数の言葉。 */
export const unknownCountLabel = (n: number): string => `判定不能 ${n} 件（データ未整備）`;

/** 「条件付き」の念押し（結論の位置に出す）。 */
export const CONDITIONAL_NOTE = "条件付き：許可の条件を守ることが前提です。";

export const legalTierLabel = (t: LegalTier): string => LEGAL_TIER_LABEL[t];

export const baseStatusLabel = (s: RegulationStatus): string => BASE_STATUS_LABEL[s];

/**
 * 申請支援の手続き（procedures.json の id）→ 手続き済み（条件付き）の項目。
 * 申請支援の手続きの一覧で、手続きを消さずに印と条件を出すために使う（Sprint 11d B2）。
 */
export const doneByProcedureId = (
  verdict: FlightVerdict | undefined,
): ReadonlyMap<string, VerdictDoneItem> => {
  const m = new Map<string, VerdictDoneItem>();
  for (const d of verdict?.done ?? []) for (const id of d.procedureIds) m.set(id, d);
  return m;
};

/** 判定中（/api/diagnose の応答待ち）の表示。 */
export const VERDICT_PENDING_LABEL = "判定中";
