// Sprint 37 K-12：入力欄（input・textarea・select）の計算後の文字サイズの判定。Playwright に依存しない純粋な関数だけを置く。
// 背景：e2e/field-checks.ts の collectTextSamples・expectFontSize は、文字の子ノードを持つ要素だけを調べ、入力欄を調べない。
// そのため 2026-11-16、現場の入力欄が 18px のはずが 16px だった不具合（soraban-ui.css の .sb-input の指定がレイヤーの外にあり text-lg に勝っていた。
// 修正は main に入っている）を CI が検出できなかった。ブラウザでの収集は field-checks.ts の collectControlSamples、検査は expectControlFontSize。
// 単体テストは apps/web/src/lib/control-font-size.test.ts。

/** 入力欄の文字サイズの下限（px）。本文 16px、現場 18px（docs/design/usability-standard.md U-6）。 */
export const CONTROL_FONT_MIN = { body: 16, field: 18 } as const;

export type ControlTag = "input" | "textarea" | "select";

export type ControlSample = {
  readonly tag: ControlTag;
  /** input の type（小文字。未指定は "text"）。textarea・select は null。 */
  readonly type: string | null;
  readonly testId: string | null;
  readonly name: string | null;
  /** 計算後の font-size（px）。 */
  readonly fontSize: number;
  readonly disabled: boolean;
  /** 幅・高さが 0、display:none、visibility:hidden のいずれか。 */
  readonly hidden: boolean;
};

/**
 * 文字を表示しない input の type。文字サイズの検査から外す。
 * ボタンの形の input（submit・button・reset）は押す部品として表示の文字を持つので、外さない。
 */
export const NON_TEXT_INPUT_TYPES: readonly string[] = ["checkbox", "radio", "range", "color", "file", "hidden", "image"];

/** 文字を表示する入力欄か（textarea・select は常に真。input は type で決める）。 */
export const isTextControl = (s: ControlSample): boolean => {
  if (s.tag !== "input") return true;
  return !NON_TEXT_INPUT_TYPES.includes((s.type ?? "text").toLowerCase());
};

/**
 * 下限 min（px）を下回る入力欄を返す。非表示の欄・文字を表示しない input は除く。無効（disabled）の欄も文字は読むので対象に含める。
 * min は正の有限の数でなければならない。fontSize が数でない（NaN）欄は、測れなかったものとして下回る側に入れる（黙って通さない）。
 */
export const findControlsBelowMin = (samples: readonly ControlSample[], min: number): ControlSample[] => {
  if (!Number.isFinite(min) || min <= 0) throw new Error(`文字サイズの下限が不正です: ${min}`);
  return samples.filter((s) => !s.hidden && isTextControl(s) && !(s.fontSize >= min - 0.01));
};

/** 入力欄を、検査の失敗の文で読める形にする。 */
export const describeControl = (s: ControlSample): string => {
  const kind = s.tag === "input" ? `input[type=${s.type ?? "text"}]` : s.tag;
  const id = s.testId ?? (s.name ? `name=${s.name}` : "(識別子なし)");
  return `${id} ${kind} ${Number.isFinite(s.fontSize) ? `${s.fontSize}px` : "測れない"}`;
};
