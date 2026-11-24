// ホームの準備カード（Sprint 16-G。契約 HM-1 ②・§8.1・§8.2）。純粋関数。DB・時計・ネットワークに触れない。
//   次の飛行の準備を「通報」「飛行前点検」「判定（参考）」の 3 行で見せる。語は G-1（2026-11-24）で承認された案のまま。
//   専門家（弁護士・行政書士）の確認が出るまで、この文言は社内の試験運用だけで使う（外部提供しない。Q-L16〜Q-L18）。
//
// 守ること：
//   - 判定は補助。不変条件 3 の禁止語（飛行できる・問題がないと読める語）を、どの状態にも使わない（単体テストで全状態を走査）。
//   - 判定不能が 1 つでもあれば、総合を「手続き済み」「手続き不要」の語にしない（判定不能の分岐を、その 2 つより先に置く）。
//   - 判定の取得に失敗した・記録が無いときは「未確認」。良い状態と読ませない。
//   - 帯の色（重い状態）は、3 行のうちいちばん重い状態：危険＞注意＞未確認＞情報＞安全。
//   - エンジン（ENGINE_VERSION・VERDICT_LABEL）は変えない。ここは判定の結果の件数を読んで言葉を選ぶだけ。
import type { ItemVerdict } from "@soraban/regulations";
import type { ReportStatusCode } from "@soraban/dips";

export type PrepTone = "safe" | "warn" | "danger" | "info" | "unknown";

/** 1 行（記号は判定の 5 段の形。levelで選ぶ）。 */
export type PrepRow = {
  readonly tone: PrepTone;
  readonly level: ItemVerdict;
  readonly text: string;
  /** 行の下に小さく添える 1 行。 */
  readonly note?: string;
  /** 行の脇に出すボタン（判定の行が取れないとき）。 */
  readonly action?: "reload";
};

export const PREP_TITLE = "次の飛行の準備";
export const PREP_JUDGEMENT_LABEL = "判定（参考）";
/** 判定の行の末尾に添える短い免責。 */
export const PREP_JUDGEMENT_NOTE = "判定は参考情報です";
export const PREP_REPORT_LABEL = "通報";
export const PREP_INSPECTION_LABEL = "飛行前点検";

// ---- 通報 ----------------------------------------------------------------

export type PrepReportKey = "recorded" | "confirm" | "cancelled" | "not_applicable";

export const prepReportKey = (code: ReportStatusCode): PrepReportKey =>
  code === "reported" ? "recorded" : code === "cancelled" ? "cancelled" : code === "not_applicable_model" ? "not_applicable" : "confirm";

export const PREP_REPORT: Readonly<Record<PrepReportKey, PrepRow>> = {
  recorded: { tone: "safe", level: "procedure_done", text: "受付番号を記録済み" },
  confirm: { tone: "warn", level: "needs_procedure", text: "DIPS に出す内容を確認する" },
  cancelled: { tone: "danger", level: "no_fly", text: "取り消し済み" },
  // 100g 未満（模型航空機）。既存の通報の状況の語（REPORT_STATUS_LABEL）の短い形
  not_applicable: { tone: "info", level: "procedure_done", text: "対象外（模型航空機）" },
};

// ---- 飛行前点検 ------------------------------------------------------------

export type PrepInspectionKey = "recorded" | "missing" | "abnormal";

export const PREP_INSPECTION: Readonly<Record<PrepInspectionKey, PrepRow>> = {
  recorded: { tone: "safe", level: "procedure_done", text: "記録済み" },
  missing: { tone: "warn", level: "needs_procedure", text: "未記録" },
  abnormal: { tone: "danger", level: "no_fly", text: "異常あり" },
};

/** 飛行当日の点検の記録から行の状態を決める。先の日の計画は、まだ記録できないので「未記録」。 */
export const prepInspectionKey = (i: { readonly isFlightDay: boolean; readonly done: boolean; readonly abnormal: boolean }): PrepInspectionKey =>
  !i.isFlightDay || !i.done ? "missing" : i.abnormal ? "abnormal" : "recorded";

// ---- 判定（参考） -----------------------------------------------------------

export type PrepJudgementCounts = {
  readonly noFly: number;
  readonly needs: number;
  readonly unknown: number;
  readonly done: number;
  readonly none: number;
};

export type PrepJudgementInput =
  | { readonly kind: "counts"; readonly counts: PrepJudgementCounts; readonly stale: boolean }
  | { readonly kind: "no_record"; readonly stale: boolean }
  | { readonly kind: "load_failed" };

export const prepJudgementTotal = (c: PrepJudgementCounts): number => c.noFly + c.needs + c.unknown + c.done + c.none;

const RANK: Readonly<Record<PrepTone, number>> = { danger: 4, warn: 3, unknown: 2, info: 1, safe: 0 };
export const heavierTone = (a: PrepTone, b: PrepTone): PrepTone => (RANK[b] > RANK[a] ? b : a);
export const heaviestTone = (rows: readonly { readonly tone: PrepTone }[]): PrepTone => rows.reduce<PrepTone>((a, r) => heavierTone(a, r.tone), "safe");

/** 判定の総合の語（§8.2）。上から順に当てる。判定不能の分岐は、手続き済み・手続き不要より先。 */
export const prepJudgementRow = (j: PrepJudgementInput): PrepRow => {
  if (j.kind === "load_failed") return { tone: "unknown", level: "unknown", text: "未確認（読み込めませんでした）", action: "reload" };
  if (j.kind === "no_record") return { tone: "unknown", level: "unknown", text: "未確認（判定の記録がありません）", action: "reload" };
  const c = j.counts;
  // 件数が 1 件も無い（判定の項目が空）のは、調べた記録が無いのと同じ。良い状態に読ませない
  if (prepJudgementTotal(c) === 0) return { tone: "unknown", level: "unknown", text: "未確認（判定の記録がありません）", action: "reload" };
  let row: PrepRow;
  if (c.noFly > 0) row = { tone: "danger", level: "no_fly", text: `飛行不可の項目があります（${c.noFly} 件）` };
  else if (c.needs > 0) row = { tone: "warn", level: "needs_procedure", text: `手続きが要る項目があります（${c.needs} 件）` };
  else if (c.unknown > 0) row = { tone: "unknown", level: "unknown", text: `未確認の項目があります（${c.unknown} 件）` };
  else if (c.done > 0) row = { tone: "info", level: "procedure_done", text: "調べた項目は手続き済みです。条件を確認してください" };
  else row = { tone: "safe", level: "no_procedure", text: "調べた項目では、手続きが要るものは見つかりませんでした", note: "調べていない項目があります" };
  if (!j.stale) return row;
  // 判定の記録が古い：既存の再判定の案内は変えず、総合の語の前に「古い判定：」を付ける。色は注意以上（良い側に見せない）
  const tone = heavierTone("warn", row.tone);
  return { ...row, tone, text: `古い判定：${row.text}`, ...(row.note ? { note: row.note } : {}) };
};

// ---- 準備カード全体 ---------------------------------------------------------

export type PrepInput = {
  readonly report: PrepReportKey;
  readonly inspection: PrepInspectionKey;
  readonly judgement: PrepJudgementInput;
};

export type PrepModel = {
  readonly report: PrepRow;
  readonly inspection: PrepRow;
  readonly judgement: PrepRow;
  /** 帯の色（3 行のうちいちばん重い状態）。 */
  readonly tone: PrepTone;
  /** 読み上げの 1 文。 */
  readonly readout: string;
};

/** 読み上げ用の判定の文（「判定、未確認の項目が 2 件あります。」の形）。 */
export const prepJudgementReadout = (row: PrepRow): string => {
  const m = /^(古い判定：)?(.*項目)があります（(\d+) 件）$/.exec(row.text);
  if (m) return `${m[1] ?? ""}${m[2]}が ${m[3]} 件あります`;
  return row.text;
};

export const prepModel = (i: PrepInput): PrepModel => {
  const report = PREP_REPORT[i.report];
  const inspection = PREP_INSPECTION[i.inspection];
  const judgement = prepJudgementRow(i.judgement);
  const tone = heaviestTone([report, inspection, judgement]);
  const readout = `${PREP_TITLE}。${PREP_REPORT_LABEL}、${report.text}。${PREP_INSPECTION_LABEL}、${inspection.text}。判定、${prepJudgementReadout(judgement)}。${judgement.note ? `${judgement.note}。` : ""}`;
  return { report, inspection, judgement, tone, readout };
};
