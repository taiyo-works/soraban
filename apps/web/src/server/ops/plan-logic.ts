// 飛行計画の純粋な判断（Sprint 12a 設計 A2・C）。DB・時計・ネットワークに触れない。
//   buildJudgementInput   計画と機体から「判定の入力」を 1 か所で作る（保存時の判定・鮮度の判定の両方が同じものを使う）
//   snapshotFreshness     スナップショットが今も新しいか（入力・エンジンの版・データの確認日・手続きデータの版）
//   confirmationState     確認の記録と計画の版から、計画の状態を読み出しのたびに求める（保存しない）
//   staleSources          出典・確認日が古い項目（90 日超）
import type { DiagnosisRunInput } from "@/server/diagnose-core";
import {
  ENGINE_VERSION,
  getDataset,
  PROCEDURES_REVISION,
  PROCEDURES_VERIFIED_AT,
  type SpecificFlightFlag,
} from "@soraban/regulations";
import { jstDate, parseJstMinute } from "@/lib/ops-time";
import { SPECIFIC_FLIGHT_TYPES, type SpecificFlightType } from "@/lib/ops-records";
import { EMPTY_PERMIT_APPLICATION, isDipsPermitValue, type PermitApplication, type PermitBasisEntry } from "./permit-logic";
import { PLAN_FLAG_ORDER, PLAN_JUDGEMENT_COLUMNS } from "./validate-plan";

type Json = null | boolean | number | string | readonly Json[] | { readonly [k: string]: Json };

// ---- 判定の入力 ----------------------------------------------

/** 判定の入力（正規化済み。judgement_snapshots.input に保存する形）。 */
export type JudgementInput = {
  /** 小数 6 桁。 */
  readonly lat: number;
  readonly lng: number;
  /** 機体の最大離陸重量（kg）× 1000 の整数。未登録は null（その場合は判定に重量を渡さない）。 */
  readonly droneWeightG: number | null;
  /** 利用者が選んだフラグに、最大高度 150m 以上なら airspace_150m を足し、重複を除き、固定の順に並べたもの。DID・空港は含めない。 */
  readonly flags: readonly SpecificFlightFlag[];
  /** 予定開始の JST の日付（YYYY-MM-DD）。 */
  readonly plannedDate: string;
  /** 並べ替え済み。 */
  readonly pilotPermits: readonly string[];
  readonly purpose?: string;
  readonly accessControl?: boolean;
  readonly thirdPartyOverflight?: boolean;
  readonly bvlosWithObserver?: boolean;
  /**
   * 根拠にした許可・承認の登録の版（Sprint 12d 設計 D）。照合で何も適用しなかった計画はキーごと持たない
   * （許可番号のない計画の入力は 12c までと一致する）。判定の結果・証跡 ID には入らない。
   */
  readonly permitBasis?: readonly PermitBasisEntry[];
};

/** 判定の入力に関わる計画の項目。 */
export type PlanJudgementFields = {
  readonly latitude: number;
  readonly longitude: number;
  /** 予定開始の JST の日付。 */
  readonly plannedDate: string;
  readonly maxAltitudeM: number | null;
  readonly flags: readonly string[];
  readonly pilotPermits: readonly string[];
  readonly judgementPurpose: string | null;
  readonly accessControl: boolean | null;
  readonly thirdPartyOverflight: boolean | null;
  readonly bvlosWithObserver: boolean | null;
};

export type AircraftWeight = {
  /** 機体の最大離陸重量（kg）。未登録は null。 */
  readonly maxTakeoffWeightKg: number | null;
};

/** 判定が導出する空域のフラグ。利用者が選んでも判定の入力には入れない。 */
export const DERIVED_AIRSPACE_FLAGS: readonly string[] = ["airspace_did", "airspace_airport"];

/** 最大高度がこの値（m）以上なら airspace_150m を足す。 */
export const ALTITUDE_150M_THRESHOLD = 150;

const round6 = (n: number): number => Number(n.toFixed(6));

/** 最大離陸重量（kg）→ 機体重量（g）。整数に丸める。 */
export const weightGramsFromKg = (kg: number | null): number | null =>
  kg === null || !Number.isFinite(kg) || kg < 0 ? null : Math.round(kg * 1000);

/** 判定の入力のフラグ：利用者が選んだフラグに、最大高度 150m 以上なら airspace_150m を足し、DID・空港を除き、固定の順に並べる。 */
export const judgementFlagsOf = (plan: Pick<PlanJudgementFields, "flags" | "maxAltitudeM">): SpecificFlightFlag[] => {
  const chosen = new Set<string>(plan.flags.filter((f) => !DERIVED_AIRSPACE_FLAGS.includes(f)));
  if (plan.maxAltitudeM !== null && plan.maxAltitudeM >= ALTITUDE_150M_THRESHOLD) chosen.add("airspace_150m");
  return PLAN_FLAG_ORDER.filter((f) => chosen.has(f));
};

/**
 * 判定の入力を作る。pilotPermits は、計画の手入力の値から DIPS の値（mlit・mlit:*）を除いたものに、登録の照合で適用した
 * DIPS の値（permitApplication.grantedValues）を足したもの（Sprint 12d 設計 D）。適用した登録があるときだけ permitBasis を足す。
 * permitApplication を渡さない・適用がない入力は、12c までと同じ（キーを足さない）。
 */
export const buildJudgementInput = (
  plan: PlanJudgementFields,
  aircraft: AircraftWeight,
  permitApplication: PermitApplication = EMPTY_PERMIT_APPLICATION,
): JudgementInput => {
  const flags = judgementFlagsOf(plan);
  return {
    lat: round6(plan.latitude),
    lng: round6(plan.longitude),
    droneWeightG: weightGramsFromKg(aircraft.maxTakeoffWeightKg),
    flags,
    plannedDate: plan.plannedDate,
    pilotPermits: [...new Set([...plan.pilotPermits.filter((p) => !isDipsPermitValue(p)), ...permitApplication.grantedValues])].sort(),
    ...(plan.judgementPurpose !== null ? { purpose: plan.judgementPurpose } : {}),
    ...(plan.accessControl !== null ? { accessControl: plan.accessControl } : {}),
    ...(plan.thirdPartyOverflight !== null ? { thirdPartyOverflight: plan.thirdPartyOverflight } : {}),
    ...(plan.bvlosWithObserver !== null ? { bvlosWithObserver: plan.bvlosWithObserver } : {}),
    ...(permitApplication.basis.length > 0 ? { permitBasis: permitApplication.basis } : {}),
  };
};

/** 判定の入力を runDiagnosis の入力にする。重量が null なら渡さない。許可が空なら渡さない。 */
export const toDiagnosisRunInput = (input: JudgementInput): DiagnosisRunInput => ({
  lat: input.lat,
  lng: input.lng,
  ...(input.droneWeightG !== null ? { droneWeightG: input.droneWeightG } : {}),
  flags: input.flags,
  plannedDate: input.plannedDate,
  ...(input.accessControl !== undefined ? { accessControl: input.accessControl } : {}),
  ...(input.thirdPartyOverflight !== undefined ? { thirdPartyOverflight: input.thirdPartyOverflight } : {}),
  ...(input.bvlosWithObserver !== undefined ? { bvlosWithObserver: input.bvlosWithObserver } : {}),
  // 計画では「DID 非該当を確認済み」の自己申告を扱わない（判定不能は要手続きのまま）
  didConfirmedNotApplicable: false,
  ...(input.pilotPermits.length > 0 ? { pilotPermits: input.pilotPermits } : {}),
  ...(input.purpose !== undefined ? { purpose: input.purpose } : {}),
});

/** キーの順に依らない JSON 文字列（入力の比較に使う）。 */
export const canonicalJson = (v: unknown): string => {
  const norm = (x: unknown): Json => {
    if (x === undefined) return null;
    if (x === null || typeof x === "boolean" || typeof x === "string") return x;
    if (typeof x === "number") return x;
    if (Array.isArray(x)) return x.map(norm);
    if (typeof x === "object") {
      const o = x as Record<string, unknown>;
      return Object.fromEntries(
        Object.keys(o)
          .filter((k) => o[k] !== undefined)
          .sort()
          .map((k) => [k, norm(o[k])]),
      );
    }
    return String(x);
  };
  return JSON.stringify(norm(v));
};

export const judgementInputEquals = (a: unknown, b: unknown): boolean => canonicalJson(a) === canonicalJson(b);

// ---- 判定に関わる項目の訂正の検出（設計 A4） ------------------

const plannedDateOfData = (d: Readonly<Record<string, unknown>>): string | null => {
  const t = parseJstMinute(d["planned_start_at"]);
  return t ? jstDate(t) : null;
};

/**
 * 計画の 2 つの版の data を比べ、判定に関わる項目（場所、予定日、飛行の方法・空域のフラグ、最大高度、許可、目的の例外、
 * 立入管理措置・第三者上空・補助者の有無）が変わったか。計画名、予定の時刻、所要時間、目的の自由記述、場所の名称、
 * 許可番号の文字、メモ、操縦者の変更は含めない。機体は訂正で変えられない（重量の変更は鮮度で見る）。
 */
export const planJudgementChanged = (
  prev: Readonly<Record<string, unknown>>,
  next: Readonly<Record<string, unknown>>,
): boolean => {
  if (plannedDateOfData(prev) !== plannedDateOfData(next)) return true;
  return PLAN_JUDGEMENT_COLUMNS.some((k) => canonicalJson(prev[k] ?? null) !== canonicalJson(next[k] ?? null));
};

// ---- 鮮度 ----------------------------------------------------

export type FreshnessReason = "input_changed" | "engine_changed" | "data_changed" | "procedures_changed" | "permits_changed";

export const FRESHNESS_REASON_LABEL: Readonly<Record<FreshnessReason, string>> = {
  input_changed: "計画の入力（機体の重量を含む）が、判定した時点から変わっています",
  engine_changed: "判定エンジンの版が変わっています",
  data_changed: "判定に使った根拠のデータの確認日が変わっています",
  procedures_changed: "手続きのデータの版が変わっています",
  permits_changed: "許可・承認の登録が、判定した時点から変わっています",
};

/** 「判定が古い」の表示。 */
export const STALE_JUDGEMENT_LABEL = "判定が古い";

export type SnapshotFreshnessInput = {
  readonly snapshot: {
    readonly input: unknown;
    readonly engineVersion: string;
    readonly datasets: readonly { readonly id: string; readonly verifiedAt: string }[];
    readonly proceduresRevision: number;
    readonly proceduresVerifiedAt?: string;
  };
  readonly plan: PlanJudgementFields;
  readonly aircraft: AircraftWeight;
  /** 現在の登録で照合し直した、判定に足すもの（Sprint 12d）。省略は適用なし。 */
  readonly permits?: PermitApplication;
  /** 現在の値（注入できる）。 */
  readonly now: {
    readonly engineVersion: string;
    /** データセットの現在の確認日。台帳にないときは null。 */
    readonly datasetVerifiedAt: (id: string) => string | null | undefined;
    readonly proceduresRevision: number;
    /** 指定したときだけ、手続きデータの確認日も比べる。 */
    readonly proceduresVerifiedAt?: string;
  };
};

export type SnapshotFreshness = {
  readonly stale: boolean;
  readonly reasons: readonly FreshnessReason[];
};

/** 現在のエンジンの版・データ台帳・手続きデータの版（本番の既定値）。 */
export const currentFreshnessContext = (): SnapshotFreshnessInput["now"] => ({
  engineVersion: ENGINE_VERSION,
  datasetVerifiedAt: (id) => {
    try {
      return getDataset(id).verifiedAt;
    } catch {
      return null;
    }
  },
  proceduresRevision: PROCEDURES_REVISION,
  proceduresVerifiedAt: PROCEDURES_VERIFIED_AT,
});

/** 判定の入力のうち、登録の照合に由来する部分（pilotPermits・permitBasis）が同じか。保存時に、新しいスナップショットが要るかの判断に使う。 */
export const permitPartEquals = (a: unknown, b: unknown): boolean => {
  const part = (v: unknown) => {
    const o = (v !== null && typeof v === "object" ? v : {}) as Record<string, unknown>;
    return { pilotPermits: o["pilotPermits"] ?? [], permitBasis: o["permitBasis"] ?? null };
  };
  return judgementInputEquals(part(a), part(b));
};

/**
 * スナップショットの許可の入力（DIPS の値と根拠の版）が、現在の登録の照合と同じか（違えば「判定が古い」）。
 * 手入力の同意・通報などの値は pilotPermits に混ざるため、DIPS の値だけを比べる。旧版の総称の mlit も DIPS の値として数える
 * （現在の照合は mlit:<種類> だけを足すので、旧形式のスナップショットは必ず「古い」になる）。
 */
export const snapshotPermitInputUpToDate = (
  snapshotInput: { readonly permitBasis?: readonly unknown[]; readonly pilotPermits?: readonly unknown[] },
  match: { readonly grantedValues: readonly string[]; readonly basis: readonly unknown[] },
): boolean => {
  const basis = snapshotInput.permitBasis ?? [];
  const snapshotDips = (snapshotInput.pilotPermits ?? []).filter((x): x is string => typeof x === "string" && isDipsPermitValue(x)).sort();
  return (
    judgementInputEquals(snapshotDips, [...match.grantedValues]) &&
    judgementInputEquals(basis.length > 0 ? basis : null, match.basis.length > 0 ? match.basis : null)
  );
};

const withoutPermitKeys = (v: unknown): unknown => {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return v;
  const { pilotPermits: _p, permitBasis: _b, ...rest } = v as Record<string, unknown>;
  void _p;
  void _b;
  return rest;
};

/** スナップショットが今も新しいか。1 つでも違えば「判定が古い」と理由を返す。一覧では result を読まずに計算できる。 */
export const snapshotFreshness = (i: SnapshotFreshnessInput): SnapshotFreshness => {
  const reasons: FreshnessReason[] = [];
  const current = buildJudgementInput(i.plan, i.aircraft, i.permits);
  if (!judgementInputEquals(current, i.snapshot.input)) {
    // pilotPermits・permitBasis だけが違うときは permits_changed、それ以外は従来どおり input_changed
    reasons.push(judgementInputEquals(withoutPermitKeys(current), withoutPermitKeys(i.snapshot.input)) ? "permits_changed" : "input_changed");
  }
  if (i.snapshot.engineVersion !== i.now.engineVersion) reasons.push("engine_changed");
  if (i.snapshot.datasets.some((d) => i.now.datasetVerifiedAt(d.id) !== d.verifiedAt)) reasons.push("data_changed");
  const procChanged =
    i.snapshot.proceduresRevision !== i.now.proceduresRevision ||
    (i.now.proceduresVerifiedAt !== undefined &&
      i.snapshot.proceduresVerifiedAt !== undefined &&
      i.snapshot.proceduresVerifiedAt !== i.now.proceduresVerifiedAt);
  if (procChanged) reasons.push("procedures_changed");
  return { stale: reasons.length > 0, reasons };
};

// ---- 確認の状態（導出） --------------------------------------

export type PlanState =
  | "draft"
  | "pending"
  | "approved"
  | "approved_stale"
  | "returned"
  | "returned_stale"
  | "voided";

export const PLAN_STATES: readonly PlanState[] = [
  "draft",
  "pending",
  "approved",
  "approved_stale",
  "returned",
  "returned_stale",
  "voided",
];

/** 導出の状態の表示（画面は定数だけを使う）。 */
export const PLAN_STATE_LABEL: Readonly<Record<PlanState, string>> = {
  draft: "下書き",
  pending: "確認待ち",
  approved: "確認済み",
  approved_stale: "前の版への確認（再確認が必要）",
  returned: "差し戻し",
  returned_stale: "修正済み（再確認待ち）",
  voided: "中止",
};

/** 自己確認の併記。 */
export const SELF_CONFIRMATION_LABEL = "自己確認";

export type ConfirmationLite = {
  readonly decision: "approved" | "returned";
  readonly planVersion: number;
  readonly selfConfirmation: boolean;
  readonly createdAt: string | Date;
};

export type PlanStateInput = {
  readonly status: "draft" | "active";
  readonly voided: boolean;
  /** 計画の最新の版。 */
  readonly version: number;
};

export type ConfirmationStateResult = {
  readonly state: PlanState;
  /** 最新の確認が自己確認か（確認済みのときの併記に使う）。 */
  readonly selfConfirmation: boolean;
  /** 表示（確認済みで自己確認なら「確認済み（自己確認）」）。 */
  readonly label: string;
  readonly latest: ConfirmationLite | null;
};

const timeOf = (v: string | Date): number => (v instanceof Date ? v.getTime() : Date.parse(v));

/** 最新の確認（作成時刻の新しいもの。同時刻なら後ろのもの）。 */
export const latestConfirmation = <T extends ConfirmationLite>(list: readonly T[]): T | null => {
  let best: T | null = null;
  let bestTime = -Infinity;
  for (const c of list) {
    const t = timeOf(c.createdAt);
    if (best === null || t >= bestTime) {
      best = c;
      bestTime = t;
    }
  }
  return best;
};

export const confirmationState = (
  plan: PlanStateInput,
  confirmations: readonly ConfirmationLite[],
): ConfirmationStateResult => {
  const latest = latestConfirmation(confirmations);
  const result = (state: PlanState): ConfirmationStateResult => {
    const self = state === "approved" && latest !== null && latest.selfConfirmation;
    return {
      state,
      selfConfirmation: self,
      label: self ? `${PLAN_STATE_LABEL.approved}（${SELF_CONFIRMATION_LABEL}）` : PLAN_STATE_LABEL[state],
      latest,
    };
  };
  if (plan.voided) return result("voided");
  if (plan.status === "draft") return result("draft");
  if (latest === null) return result("pending");
  const current = latest.planVersion === plan.version;
  if (latest.decision === "approved") return result(current ? "approved" : "approved_stale");
  return result(current ? "returned" : "returned_stale");
};

// ---- 出典・確認日が古い項目 ------------------------------------

/** 出典・確認日が古いとみなす日数（これを超えたら古い）。 */
export const STALE_SOURCE_DAYS = 90;

export type StaleSource = {
  readonly id: string;
  readonly name: string;
  readonly verifiedAt: string;
  /** 確認日からの日数。確認日を読めないときは null（古いものとして扱う）。 */
  readonly ageDays: number | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export const staleSources = (
  snapshot: {
    readonly datasets: readonly { readonly id: string; readonly name: string; readonly verifiedAt: string }[];
    readonly proceduresVerifiedAt: string;
  },
  now: Date,
  days: number = STALE_SOURCE_DAYS,
): StaleSource[] => {
  const items = [
    ...snapshot.datasets.map((d) => ({ id: d.id, name: d.name, verifiedAt: d.verifiedAt })),
    { id: "procedures", name: "手続き・判定規則のデータ", verifiedAt: snapshot.proceduresVerifiedAt },
  ];
  const out: StaleSource[] = [];
  for (const it of items) {
    const t = Date.parse(it.verifiedAt);
    if (Number.isNaN(t)) {
      out.push({ ...it, ageDays: null });
      continue;
    }
    const age = Math.floor((now.getTime() - t) / DAY_MS);
    if (age > days) out.push({ ...it, ageDays: age });
  }
  return out;
};

// ---- 飛行記録への引き継ぎ（設計 G） ----------------------------

/** 判定のフラグ → 飛行記録の特定飛行の形態。 */
export const FLAG_TO_SPECIFIC_FLIGHT_TYPE: Readonly<Record<SpecificFlightFlag, SpecificFlightType>> = {
  airspace_airport: "airport_vicinity",
  airspace_150m: "above_150m",
  airspace_did: "did",
  airspace_emergency: "emergency_airspace",
  method_night: "night",
  method_bvlos: "bvlos",
  method_30m: "within_30m",
  method_event: "event",
  method_dangerous: "dangerous_goods",
  method_drop: "dropping",
};

/**
 * スナップショットの結果の flags（DID・空港の導出を含む最終のフラグ）を、既存の SPECIFIC_FLIGHT_TYPES の順に並べた
 * 特定飛行の形態にする。「飛行記録を作る」で引き継ぐ。離着陸の時刻は引き継がない。
 */
export const specificFlightTypesFromFlags = (flags: readonly string[]): SpecificFlightType[] => {
  const have = new Set<SpecificFlightType>();
  for (const f of flags) {
    const t = FLAG_TO_SPECIFIC_FLIGHT_TYPE[f as SpecificFlightFlag];
    if (t) have.add(t);
  }
  return SPECIFIC_FLIGHT_TYPES.map((t) => t.key).filter((k) => have.has(k));
};
