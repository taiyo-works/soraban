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
