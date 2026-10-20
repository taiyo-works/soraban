// 規制条文の有向グラフ表現。
//
// 主節（main）に対して例外節（exceptions）と条件節（conditions）を
// 機械可読な形で保持することで、自治体例規に頻出する「ただし書き」と
// 「〜のときに限り」を、地理空間判定エンジンが優先順位付きで解決できる。
//
// 単純な (regulation -> status) の二値判定ではなく、
// (regulation x context) -> (effect, applied_exceptions[]) の解決を可能にする
// 最小スキーマ。

export type ClauseEffect =
  | "deny"
  | "permit"
  | "requires_application"
  | "conditional";

export type MachineConditionType =
  | "permit_holder"
  /** 複数の値を全て要求する（例：飛行禁止法の同意と通報。Sprint 11d）。values に値を並べる。 */
  | "permit_holder_all"
  | "weight_below_g"
  | "weight_above_g"
  | "time_window"
  | "purpose"
  | "drone_class"
  | "in_zone"
  | "other";

export type MachineCondition = {
  readonly type: MachineConditionType;
  readonly value?: string | number;
  /** permit_holder_all のみ：全てそろって満たす値。 */
  readonly values?: readonly string[];
};

export type ClauseException = {
  readonly id: string;
  readonly condition: string;
  readonly effect: ClauseEffect;
  readonly machine?: MachineCondition;
};

export type ClauseCondition = {
  readonly id: string;
  readonly description: string;
  readonly machine?: MachineCondition;
};

export type ClauseGraph = {
  readonly main: {
    readonly text: string;
    readonly effect: ClauseEffect;
  };
  readonly exceptions: readonly ClauseException[];
  readonly conditions: readonly ClauseCondition[];
};

export const CLAUSE_EFFECT_LABEL: Readonly<Record<ClauseEffect, string>> = {
  deny: "禁止",
  permit: "許容",
  requires_application: "許可・承認要",
  conditional: "条件付き",
};

// 適用された例外節を自然言語と機械可読条件で併記するため、
// UI / PDF に機械可読条件を一行で表すフォーマッタ。
// 例:
//   { type: "weight_below_g", value: 100 }  → "weight_below_g < 100g"
//   { type: "permit_holder",  value: "mlit" } → "permit_holder == mlit"
//   { type: "purpose",        value: "emergency" } → "purpose == emergency"
//   { type: "time_window",    value: "22:00-04:00" } → "time_window: 22:00-04:00"
export const formatMachineCondition = (m: MachineCondition): string => {
  switch (m.type) {
    case "weight_below_g":
      return typeof m.value === "number"
        ? `weight_below_g < ${m.value}g`
        : "weight_below_g";
    case "weight_above_g":
      return typeof m.value === "number"
        ? `weight_above_g ≥ ${m.value}g`
        : "weight_above_g";
    case "permit_holder":
    case "purpose":
    case "drone_class":
    case "in_zone":
      return m.value !== undefined ? `${m.type} == ${m.value}` : m.type;
    case "permit_holder_all":
      return m.values !== undefined && m.values.length > 0
        ? `permit_holder_all == ${m.values.join(" + ")}`
        : "permit_holder_all";
    case "time_window":
      return m.value !== undefined ? `time_window: ${m.value}` : "time_window";
    case "other":
      return m.value !== undefined ? `other: ${m.value}` : "other";
  }
};

// ============================================================
// FlightContext: 飛行計画ごとの可変条件（機体・操縦者・運航種別・時刻）。
// 評価エンジンは ClauseGraph の例外節 machine condition と FlightContext を
// 突き合わせ、マッチした exception を applied として記録する。
// すべて optional。未指定の場合は "対応する例外節は適用されない"（最も厳しい解釈）。
// ============================================================

export type FlightContext = {
  /** 機体重量 (g)。100g 未満なら航空法上の無人航空機に該当しない例外がマッチ。 */
  readonly droneWeightG?: number;
  /**
   * 保有する許可・承認の種類。permit_holder 例外の value と照合する。
   * 例: ["mlit", "park_manager"] = 国交省許可 + 公園管理者の許可
   */
  readonly pilotPermits?: readonly string[];
  /**
   * 運航の目的。purpose 例外の value と照合する。
   * "emergency" | "public_duty" | "city_event" | "general" 等
   */
  readonly purpose?: string;
  /**
   * 機体クラス（一等・二等資格対応）。drone_class 例外の value と照合する。
   * 現在は未使用（後続で使う拡張枠）
   */
  readonly droneClass?: string;
};

/**
 * 旧版の許可の値の読み替え（Sprint 11d）。0.3.0 までの「国交省 DIPS」（mlit）は、
 * 入力の説明（航空法 DID）と動きに合わせて DID 上空の許可（mlit:did）として読む。
 * 夜間・目視外などの承認には当てない（docs/sprints/sprint-11d.md 未決 2）。
 */
export const LEGACY_PERMIT_ALIASES: Readonly<Record<string, string>> = {
  mlit: "mlit:did",
};

/** pilotPermits を旧値の読み替え込みで正規化する（重複除去・入力順を保つ）。 */
export const normalizePilotPermits = (permits: readonly string[] | undefined): readonly string[] => {
  if (!Array.isArray(permits)) return [];
  const out: string[] = [];
  for (const p of permits) {
    if (typeof p !== "string") continue;
    const v = LEGACY_PERMIT_ALIASES[p] ?? p;
    if (!out.includes(v)) out.push(v);
  }
  return out;
};

/**
 * machine condition と FlightContext を突き合わせ、その例外節が適用可能かを返す。
 * machine が無い例外（ヒトが読むためのテキストのみ）は自動適用しない。
 */
export const matchesException = (
  exception: ClauseException,
  ctx: FlightContext | undefined,
): boolean => {
  if (!ctx) return false;
  const m = exception.machine;
  if (!m) return false;
  switch (m.type) {
    case "weight_below_g":
      return (
        typeof ctx.droneWeightG === "number" &&
        typeof m.value === "number" &&
        ctx.droneWeightG < m.value
      );
    case "weight_above_g":
      return (
        typeof ctx.droneWeightG === "number" &&
        typeof m.value === "number" &&
        ctx.droneWeightG >= m.value
      );
    case "permit_holder":
      return (
        Array.isArray(ctx.pilotPermits) &&
        typeof m.value === "string" &&
        normalizePilotPermits(ctx.pilotPermits).includes(m.value)
      );
    case "permit_holder_all": {
      // 全ての値がそろったときだけ当たる。値の指定がない節は当てない（安全側）。
      if (!Array.isArray(ctx.pilotPermits) || !Array.isArray(m.values) || m.values.length === 0) {
        return false;
      }
      const have = normalizePilotPermits(ctx.pilotPermits);
      return m.values.every((v) => have.includes(v));
    }
    case "purpose":
      return typeof ctx.purpose === "string" && ctx.purpose === m.value;
    case "drone_class":
      return typeof ctx.droneClass === "string" && ctx.droneClass === m.value;
    case "time_window":
    case "in_zone":
    case "other":
      // time_window は将来実装、in_zone は別途空間判定で処理、other はヒト判定
      return false;
  }
};

/**
 * 例外節の種類（Sprint 11d、spec §13.9.3）。
 *   - exclude（対象外にする例外）：機体重量（weight_below_g）・区域（in_zone）。当たると元の判定を green にする。
 *   - satisfy（満たす例外）：許可・同意（permit_holder・permit_holder_all）・目的（purpose）など。
 *     元の判定は変えず、判定を手続き済み（条件付き）にする。
 * 迷う種類（drone_class 等）は満たす例外として扱う（元の判定を変えない＝安全側）。
 */
export type ExceptionKind = "exclude" | "satisfy";

export const exceptionKind = (exception: ClauseException): ExceptionKind => {
  const t = exception.machine?.type;
  return t === "weight_below_g" || t === "in_zone" ? "exclude" : "satisfy";
};

/** ctx で当たる、対象外にする例外節（元の判定を green にする）。 */
export const findExcludingExceptions = (
  graph: ClauseGraph,
  ctx: FlightContext | undefined,
): readonly ClauseException[] =>
  graph.exceptions.filter(
    (ex) => ex.effect === "permit" && exceptionKind(ex) === "exclude" && matchesException(ex, ctx),
  );

/** ctx で当たる、満たす例外節（許可・同意・目的。元の判定は変えない）。 */
export const findSatisfyingExceptions = (
  graph: ClauseGraph,
  ctx: FlightContext | undefined,
): readonly ClauseException[] =>
  graph.exceptions.filter(
    (ex) => ex.effect === "permit" && exceptionKind(ex) === "satisfy" && matchesException(ex, ctx),
  );

/**
 * ClauseGraph 全体に対し、ctx で適用可能な permit 効果の例外節を返す（種類を問わない。後方互換）。
 */
export const findPermittingExceptions = (
  graph: ClauseGraph,
  ctx: FlightContext | undefined,
): readonly ClauseException[] =>
  graph.exceptions.filter(
    (ex) => ex.effect === "permit" && matchesException(ex, ctx),
  );
