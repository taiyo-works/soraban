// 規制条文の有向グラフ表現（特許①コア）。
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

// 特許①従属項10「適用された例外節について、自然言語テキストと機械可読条件とを併せて含む」
// の根拠として、UI / PDF に機械可読条件を一行で併記するためのフォーマッタ。
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
   * Phase 1 では未使用 (将来の拡張枠)
   */
  readonly droneClass?: string;
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
        ctx.pilotPermits.includes(m.value)
      );
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
 * ClauseGraph 全体に対し、ctx で適用可能な permit 効果の例外節を返す。
 * マッチした例外節がひとつでもあれば、評価器側で status を 1 段降格する。
 */
export const findPermittingExceptions = (
  graph: ClauseGraph,
  ctx: FlightContext | undefined,
): readonly ClauseException[] =>
  graph.exceptions.filter(
    (ex) => ex.effect === "permit" && matchesException(ex, ctx),
  );
