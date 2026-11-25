// 判定（4 段＋判定不能）の表し方の共通定義（Sprint 11d D1）。画面（verdict-summary.tsx）と
// 地点判定の PDF（regulation-pdf.tsx）・申請支援の PDF（application-pdf.tsx）で同じ言葉・同じ記号・同じ並びにする。
//
// 記号の形（色に頼らない。WCAG 2.2 AA 1.4.1）：
//   飛行不可 = 斜線の丸 / 要手続き = 三角 / 手続き済み（条件付き）= 中抜きの丸にチェック /
//   手続き不要 = 塗りの丸（外周の輪と中心の塗り） / 判定不能 = 破線の四角と「？」
// 線・寸法・配色（Sprint 11d D2）：計器の表示に倣い、線は細く端を切り落とし、色は補助に留める。
import {
  DRONE_THRESHOLD_G,
  BASE_STATUS_LABEL,
  MODEL_AIRCRAFT_EXEMPT_LABEL,
  MODEL_AIRCRAFT_DID_DETAIL_LABEL,
  MODEL_AIRCRAFT_DID_NOTE,
  DID_NOTE_PERMIT_SENTENCE,
  type DidDetail,
  baseStatusDisplay,
  LEGAL_TIER_LABEL,
  VERDICT_LABEL,
  type FlightVerdict,
  type ItemVerdict,
  type LegalTier,
  type VerdictDoneItem,
  type RegulationStatus,
} from "@soraban/regulations";

export { BASE_STATUS_LABEL, LEGAL_TIER_LABEL, VERDICT_LABEL, baseStatusDisplay };

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

// ── 色（補助。意味は言葉と形が担う。WCAG 2.2 AA 1.4.1）──
// 文字に使うため、ライト（紙 #F5F2EA）・ダーク（#0C1320）の両方で 4.5:1 以上になる専用の色を
// globals.css の --color-verdict-* に置く（信号の amber は紙の上で 3.1:1 のため、判定の文字には使わない）。

/** 段階の色（画面の Tailwind クラス。文字・記号の色）。 */
export const VERDICT_TONE: Readonly<Record<ItemVerdict, string>> = {
  no_fly: "text-sb-v-no-fg",
  needs_procedure: "text-sb-v-needs-fg",
  procedure_done: "text-sb-v-done-fg",
  no_procedure: "text-sb-v-none-fg",
  unknown: "text-sb-v-unknown-fg",
};

/** 段階の縁（運航票の左端の帯。画面の Tailwind クラス）。 */
export const VERDICT_EDGE: Readonly<Record<ItemVerdict, string>> = {
  no_fly: "border-l-sb-v-no-fg",
  needs_procedure: "border-l-sb-v-needs-fg",
  procedure_done: "border-l-sb-v-done-fg",
  no_procedure: "border-l-sb-v-none-fg",
  unknown: "border-l-sb-v-unknown-fg",
};

/** 段階の色（PDF の 16 進。globals.css のライトの値と同じ）。 */
export const VERDICT_PDF_COLOR: Readonly<Record<ItemVerdict, string>> = {
  no_fly: "#A33232",
  needs_procedure: "#8A5A0E",
  procedure_done: "#1D3557",
  no_procedure: "#2E6A42",
  unknown: "#4F5564",
};

/** 結論の目盛り（重い順。現在の段階の位置を示す。判定不能は件数で別に出す）。 */
export const VERDICT_SCALE: readonly ItemVerdict[] = [
  "no_fly",
  "needs_procedure",
  "procedure_done",
  "no_procedure",
];

/**
 * 記号の幾何（画面の SVG と PDF の Svg で共通。viewBox 0 0 24 24）。
 * 形の区別：飛行不可 = 斜線の丸 / 要手続き = 三角 / 手続き済み（条件付き）= 中抜きの丸にチェック /
 * 手続き不要 = 塗りの丸 / 判定不能 = 破線の四角と「？」。線の端は切り落とし、角は留める（製図の線）。
 */
export const VERDICT_GEOMETRY = {
  ring: { cx: 12, cy: 12, r: 8.75 },
  slash: { x1: 5.8, y1: 18.2, x2: 18.2, y2: 5.8 },
  triangle: "12,3.25 21.25,19.75 2.75,19.75",
  triangleBar: { x1: 12, y1: 9.75, x2: 12, y2: 15.25 },
  check: "7.75,12.25 10.75,15.25 16.5,9",
  disc: { cx: 12, cy: 12, r: 5.75 },
  square: { x: 3.25, y: 3.25, size: 17.5, dash: "2.75 2.25" },
  question: "M9.35 9.6 C9.35 8.05 10.5 7 12 7 C13.5 7 14.65 8.05 14.65 9.45 C14.65 11.35 12 11.5 12 13.6",
  questionDot: { cx: 12, cy: 16.6, r: 1.05 },
} as const;

/** 判定不能の該当を確かめる手続き（verdict.ts の confirmProcedureForUnknown の id）。段取り表で縁と記号を判定不能にする。 */
export const isConfirmProcedure = (id: string): boolean => id.startsWith("verdict-confirm-");

/** 法的な重さの目盛り（国の法律 = 3 本、条例 = 2 本、施設管理者の取り決め = 1 本）。 */
export const legalTierWeight = (t: LegalTier): number => 4 - t;

const isoToday = (now: Date): string =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

const isoToUtcDay = (iso: string): number | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000 : null;
};

/**
 * 期限の日付までの残り（暦日。今日を 0 とする）。画面と PDF の段取り表で同じ言葉を出す。
 * 日付がない期限（飛行予定日の未入力・管理者の定めによる等）は出さない。
 */
export const deadlineCountdown = (date: string | undefined, now: Date = new Date()): string | undefined => {
  if (date === undefined) return undefined;
  const a = isoToUtcDay(isoToday(now));
  const b = isoToUtcDay(date);
  if (a === null || b === null) return undefined;
  const n = Math.round(b - a);
  if (n > 0) return `残り ${n} 日`;
  if (n === 0) return "期限は本日";
  return `${-n} 日超過`;
};

/** 見出し（画面・PDF 共通。この順に並べる）。 */
export const VERDICT_SECTION_TITLE = {
  conclusion: "結論",
  noFly: "飛行できない理由",
  procedures: "要手続きの手続き（期限順）",
  done: "手続き済み（条件付き）",
  duties: "飛行の前後に行うこと",
  items: "規制ごとの判定（元の判定 → 適用した許可 → 判定）",
} as const;

/** 画面の見出し（飛行ごとの義務の節）。画面・PDF 共通（16-M の M-5：「必ず」は不変条件 3 の禁止語なので言い換えた）。 */
export const DUTIES_HEADING_SCREEN = VERDICT_SECTION_TITLE.duties;

/** 段取り表の列（画面・PDF 共通）。 */
export const PROCEDURE_COLUMNS = ["手続き", "出す先", "期限", "法的な重さ"] as const;

/** 結論の横に出す判定不能の件数の言葉。 */
export const unknownCountLabel = (n: number): string => `判定不能 ${n} 件（データ未整備）`;

/** 「条件付き」の念押し（結論の位置に出す）。 */
export const CONDITIONAL_NOTE = "条件付き：許可の条件を守ることが前提です。";

export const legalTierLabel = (t: LegalTier): string => LEGAL_TIER_LABEL[t];

export const baseStatusLabel = (s: RegulationStatus): string => BASE_STATUS_LABEL[s];

/**
 * 規制（地点判定）の「元の判定」の表示（Sprint 11f A4）。機体重量の例外（100g 未満）で対象外にした規制は
 * 「対象外（模型航空機）」、それ以外は BASE_STATUS_LABEL。status の値は変えない。
 */
export const regulationBaseLabel = (r: {
  readonly status: RegulationStatus;
  readonly statusBeforeExclusion?: "red" | "yellow";
}): string =>
  r.status === "green" && r.statusBeforeExclusion !== undefined ? MODEL_AIRCRAFT_EXEMPT_LABEL : BASE_STATUS_LABEL[r.status];

/** 機体重量の例外で対象外にした DID 内の地点か（100g 未満。DID の行・本文を模型航空機の言葉にする）。 */
export const isModelAircraftDidExcluded = (r: {
  readonly status: RegulationStatus;
  readonly statusBeforeExclusion?: "red" | "yellow";
  readonly didDetail?: DidDetail;
}): boolean =>
  r.status === "green" &&
  r.statusBeforeExclusion !== undefined &&
  (r.didDetail === "in_did" ||
    r.didDetail === "in_did_near_industrial_boundary" ||
    r.didDetail === "in_did_exclusion_unverified");

/** カード・PDF の「この地点」の本文。DID 内で 100g 未満のときだけ「許可・承認なく飛行できません」を置き換える。 */
export const regulationNoteDisplay = (r: {
  readonly status: RegulationStatus;
  readonly statusBeforeExclusion?: "red" | "yellow";
  readonly didDetail?: DidDetail;
  readonly note: string;
}): string =>
  isModelAircraftDidExcluded(r) && r.note.includes(DID_NOTE_PERMIT_SENTENCE)
    ? r.note.replace(DID_NOTE_PERMIT_SENTENCE, MODEL_AIRCRAFT_DID_NOTE)
    : r.note;

export { MODEL_AIRCRAFT_DID_DETAIL_LABEL };

/** 例外の欄の見出し（機体重量の例外のときは模型航空機の趣旨）。 */
export const EXCLUDED_BY_WEIGHT_HEADING = "対象外にした例外（模型航空機）";
export const EXCLUDED_HEADING = "対象外にした例外（元の判定を非該当にしました）";

/** 機体重量の例外で対象外にした規制の、例外前の判定の一行。 */
export const statusBeforeExclusionLine = (before: "red" | "yellow"): string =>
  `例外前の判定：${BASE_STATUS_LABEL[before]}`;

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

/**
 * 申請支援の診断（/api/diagnose）が失敗したときの結論の表示（差し戻し 2 回目）。段階の言葉は出さない。
 * 古い診断の判定も、飛行の方法を含まない地点だけの判定も使わない（見落としゼロ。spec §13.9）。
 */
export const VERDICT_FAILED_LABEL = "判定できません";
export const VERDICT_FAILED_NOTE =
  "飛行の方法を含む判定に失敗したため、この入力（飛行の方法・空域・飛行予定日・許可）での判定が出ていません。再試行してください。判定が出るまで PDF は出力できません。";
export const VERDICT_RETRY_LABEL = "再試行";
/** 地点判定（/api/check）が失敗したときの説明（差し戻し 3 回目 F3）。前の地点の結果は出さない。 */
export const VERDICT_CHECK_FAILED_NOTE =
  "地点判定に失敗したため、この地点の規制と証跡 ID が出ていません。再試行してください。判定が出るまで PDF は出力できません。";
/** 結論が確定していない間（判定中・判定できません）の、規制ごとのカードの注記。 */
export const PROVISIONAL_ITEM_NOTE = "地点だけの判定（結論は未確定）";
/** 申請支援の診断の時間の上限（ミリ秒）。超えたら失敗として扱う（差し戻し 3 回目）。 */
export const DIAGNOSE_TIMEOUT_MS = 20_000;

/** 履歴で、飛行の方法を含む判定が確定していない項目の表示。 */
export const HISTORY_UNDETERMINED_LABEL = "判定未確定（飛行の方法を含む判定が未完了）";

/** 判定中（/api/diagnose の応答待ち）の表示。 */
export const VERDICT_PENDING_LABEL = "判定中";

/**
 * 100g 未満の機体（模型航空機）としてカテゴリーを表示するか（Sprint 11e B3）。
 * category の値（I）は証跡に入るため変えず、表示だけを変える。重量未指定・100g ちょうどは無人航空機。
 */
export const isModelAircraftDiagnosis = (d: {
  readonly category: string;
  readonly droneWeightG?: number;
}): boolean =>
  d.category === "I" && typeof d.droneWeightG === "number" && d.droneWeightG < DRONE_THRESHOLD_G;
