// 通報の要否の表示（Sprint 12a 設計 H）。純粋関数。判定のスナップショットの入力と結果から、
// 飛行計画の通報（DIPS 2.0。飛行の前に行う）が要るかを、根拠つきで 4 種のどれかに分けて返す。
// そらばんは DIPS に送信しない。通報の記録・期限・漏れの警告は Sprint 12b で扱う。
//
// 守ること（不可侵）：
//   - 「通報が要らない」と読める言葉は、どの入力でも、どの文言にも出さない（禁止語の一覧と検査は report-requirement.test.ts）。
//   - 通報の要を打ち消す上書きを設けない。迷えば「要」「要確認」に倒す。
//   - 目的の例外（緊急・公務）のときも表示は変えず、要として扱う（例外に当たる可能性は※要確認で添えるだけ）。
//   - 100g 未満は 12a では計画を作れない（機体を登録できない）が、分岐は持ち単体テストで網羅する。

import { DRONE_THRESHOLD_G, SPECIFIC_FLIGHT_FLAG_LABEL, type DiagnosisCategory, type SpecificFlightFlag } from "./diagnosis";
import { MODEL_AIRCRAFT_LAW } from "./model-aircraft";

/** 通報の要否の種類（上から順に判定する）。 */
export type ReportRequirementKind =
  /** 重量が不明、または結果が成立していない。要として扱う。 */
  | "confirm"
  /** 100g 未満（模型航空機）。DIPS の飛行計画の通報は対象外。 */
  | "not_applicable_model"
  /** 100g 以上で、特定飛行に当たる（category が I 以外）。 */
  | "required"
  /** 100g 以上で、特定飛行に当たる項目がない（category が I）。 */
  | "recommended";

export const REPORT_REQUIREMENT_KINDS: readonly ReportRequirementKind[] = [
  "confirm",
  "not_applicable_model",
  "required",
  "recommended",
];

/** 表示の見出し（画面は定数だけを使う）。 */
export const REPORT_REQUIREMENT_LABEL: Readonly<Record<ReportRequirementKind, string>> = {
  confirm: "通報：要確認（要として扱います）",
  not_applicable_model: "通報：DIPS の飛行計画の通報は対象外（模型航空機）",
  required: "通報：要",
  recommended: "通報：義務ではないが推奨",
};

/** 根拠の文言。 */
export const REPORT_REASON = {
  weightUnknown: "機体の重量が分からないため",
  resultMissing: "判定の結果が成立していないため",
  modelAircraft: "100g 未満の機体は、航空法の無人航空機の規制の対象外のため",
  modelAircraftOtherProcedures: `${MODEL_AIRCRAFT_LAW}の許可・通報は別の手続きです。判定の段取りに並ぶ内容を確認してください。`,
  needsVerification: "DID の該当を確認できない（判定不能）ため、要として扱う",
  emergencyNoFly: "緊急用務空域のため飛行できない判定です（通報は要として扱います）",
  specificFlightFallback: "特定飛行に当たる区分のため",
  noSpecificFlight: "特定飛行に当たる項目がないため",
} as const;

/** 当たった特定飛行 1 件の根拠（例：「夜間飛行に当たるため」）。 */
export const reportFlightReason = (flag: SpecificFlightFlag): string =>
  `${SPECIFIC_FLIGHT_FLAG_LABEL[flag]}に当たるため`;

/** 目的の例外（緊急・公務）のときだけ添える。表示は変えず、要として扱う。 */
export const REPORT_PURPOSE_EXCEPTION_NOTE =
  "国・地方公共団体などの捜索・救助等の飛行は、通報の対象から外れる例外に当たる可能性があります（※要確認）。この表示は変えず、要として扱います。";

/** 表示を変えない例外の目的。 */
export const REPORT_EXCEPTION_PURPOSES: readonly string[] = ["emergency", "public_duty"];

/** どの通報の要否の表示にも添える固定の文言。 */
export const REPORT_FIXED_NOTE =
  "そらばんは DIPS に送信しません。通報は DIPS 2.0 で行ってください。申請・通報は DIPS 2.0 などの公式の手続きで行ってください。通報の記録の機能は次の版で追加します。";

/** 計画の詳細・フォームの目立つ位置に出す固定の文言。 */
export const PLAN_JUDGEMENT_DISCLAIMER =
  "判定は入力された情報の範囲での目安です。申請・通報は DIPS 2.0 などの公式の手続きで行ってください。";

/** 入力：スナップショットの input と result のうち、要否の判定に使う部分。一覧では result の一部だけを渡してよい。 */
export type ReportRequirementSnapshot = {
  readonly input?: {
    readonly droneWeightG?: number | null;
    readonly purpose?: string | null;
  } | null;
  readonly result?: {
    readonly droneWeightG?: number | null;
    readonly category?: DiagnosisCategory | string | null;
    readonly flags?: readonly SpecificFlightFlag[] | null;
    readonly verdict?: { readonly purpose?: string | null } | null;
  } | null;
};

export type ReportRequirement = {
  readonly kind: ReportRequirementKind;
  /** 見出し（REPORT_REQUIREMENT_LABEL）。 */
  readonly label: string;
  /** 根拠（当たった特定飛行をすべて並べる）。 */
  readonly reasons: readonly string[];
  /** 目的の例外のときだけ（要として扱う種類に限る）。 */
  readonly exceptionNote: string | null;
  /** 固定の文言（REPORT_FIXED_NOTE）。 */
  readonly note: string;
};

const FLAG_ORDER = Object.keys(SPECIFIC_FLIGHT_FLAG_LABEL) as SpecificFlightFlag[];

const weightOf = (s: ReportRequirementSnapshot): number | null => {
  const w = s.result?.droneWeightG ?? s.input?.droneWeightG;
  return typeof w === "number" && Number.isFinite(w) && w >= 0 ? w : null;
};

/** 結果が成立しているか（区分と、当たった飛行の一覧がある）。 */
const resultEstablished = (s: ReportRequirementSnapshot): boolean => {
  const r = s.result;
  return !!r && typeof r.category === "string" && r.category.length > 0 && Array.isArray(r.flags);
};

/** 通報の要否を求める。上から順に判定する（重量不明・結果なし → 100g 未満 → category が I 以外 → I）。 */
export const reportRequirement = (snapshot: ReportRequirementSnapshot): ReportRequirement => {
  const make = (kind: ReportRequirementKind, reasons: readonly string[], purposeNote: boolean): ReportRequirement => ({
    kind,
    label: REPORT_REQUIREMENT_LABEL[kind],
    reasons,
    exceptionNote: purposeNote ? REPORT_PURPOSE_EXCEPTION_NOTE : null,
    note: REPORT_FIXED_NOTE,
  });
  const purpose = snapshot.input?.purpose ?? snapshot.result?.verdict?.purpose ?? null;
  const exception = typeof purpose === "string" && REPORT_EXCEPTION_PURPOSES.includes(purpose);

  const weight = weightOf(snapshot);
  if (weight === null) return make("confirm", [REPORT_REASON.weightUnknown], exception);
  if (!resultEstablished(snapshot)) return make("confirm", [REPORT_REASON.resultMissing], exception);

  if (weight < DRONE_THRESHOLD_G) {
    return make("not_applicable_model", [REPORT_REASON.modelAircraft, REPORT_REASON.modelAircraftOtherProcedures], false);
  }

  const result = snapshot.result!;
  const category = result.category as string;
  if (category !== "I") {
    const have = new Set(result.flags ?? []);
    const reasons: string[] = [];
    if (category === "needs_verification") reasons.push(REPORT_REASON.needsVerification);
    for (const f of FLAG_ORDER) if (have.has(f)) reasons.push(reportFlightReason(f));
    if (category === "emergency_no_fly") reasons.push(REPORT_REASON.emergencyNoFly);
    if (reasons.length === 0) reasons.push(REPORT_REASON.specificFlightFallback);
    return make("required", reasons, exception);
  }
  return make("recommended", [REPORT_REASON.noSpecificFlight], false);
};

/** 出力に含まれる全文（見出し・根拠・添え書き・固定の文言）。禁止語の検査に使う。 */
export const reportRequirementText = (r: ReportRequirement): string =>
  [r.label, ...r.reasons, r.exceptionNote ?? "", r.note].join("\n");
