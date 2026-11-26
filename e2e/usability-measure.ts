// Sprint 37 機能B（K-3）：タスクの台本（T1〜T12）の操作数を数える補助。Playwright に依存しない純粋な関数だけを置く。
// 数え方（docs/design/usability-standard.md §5.1、drone-ops-integration-roadmap.md §5.2）：
//   - リンク・ボタン・選択肢（ラジオ・チェックボックス・チップ）の押下を 1 とする。
//   - セレクト（<select>）は「開く＋選ぶ」で 2 とする。
//   - 文字の入力欄は、押下とは別に「欄」として数える（同じ欄に何度入力しても 1 欄）。
//   - スクロールと、既定値で埋まっていて触らなかった欄は数えない。
//   - 画面の遷移（URL のパスか検索部分が変わった回数）は、押下とは別に数える。
// 台本の E2E（e2e/ops-db/usability-*.spec.ts。37-1 の後半で書く）は、操作のたびに記録器へ 1 行足し、最後に結果を出力する。
// 単体テストは apps/web/src/lib/usability-measure.test.ts（e2e/ の *.test.ts は Playwright の testDir に拾われるため、そこには置かない）。

/** 台本の 1 手。 */
export type UsabilityStep =
  /** リンク・ボタン・選択肢の押下（1）。target は記録用の名前（data-testid や表示の文字）。 */
  | { readonly kind: "tap"; readonly target: string }
  /** ネイティブのセレクト（開く＋選ぶで 2）。 */
  | { readonly kind: "select"; readonly target: string }
  /** 文字の入力欄への入力（欄として別に数える。同じ field は 1 欄）。 */
  | { readonly kind: "type"; readonly field: string }
  /** 画面の遷移（押下とは別に数える）。to は遷移先の URL かパス。 */
  | { readonly kind: "navigate"; readonly to: string }
  /** スクロール（数えない。記録だけ残す）。 */
  | { readonly kind: "scroll" }
  /** 既定値で埋まっていて触らなかった欄（数えない。記録だけ残す）。 */
  | { readonly kind: "default"; readonly field: string };

export type UsabilityStepKind = UsabilityStep["kind"];

/** 押下の重み。ここに無い種類は押下に数えない。 */
export const PRESS_WEIGHT: Readonly<Record<UsabilityStepKind, number>> = {
  tap: 1,
  select: 2,
  type: 0,
  navigate: 0,
  scroll: 0,
  default: 0,
};

export type UsabilityCount = {
  /** 押下の回数（tap は 1、select は 2）。 */
  readonly presses: number;
  /** 文字の入力欄の数（異なる field の数）。 */
  readonly fields: number;
  /** 画面の遷移の回数。 */
  readonly transitions: number;
  /** 記録した手の総数（数えない手も含む）。 */
  readonly steps: number;
};

const KINDS: readonly UsabilityStepKind[] = ["tap", "select", "type", "navigate", "scroll", "default"];

/** 1 手が正しい形かを確かめる。名前の空の手は、記録の読み違いを招くので受け付けない。 */
export const assertValidStep = (step: UsabilityStep, index = 0): void => {
  if (!step || typeof step !== "object" || !KINDS.includes((step as { kind: UsabilityStepKind }).kind)) {
    throw new Error(`操作の記録 ${index + 1} 手目の種類が不正です: ${JSON.stringify(step)}`);
  }
  const name = step.kind === "tap" || step.kind === "select" ? step.target : step.kind === "type" || step.kind === "default" ? step.field : step.kind === "navigate" ? step.to : "-";
  if (typeof name !== "string" || name.trim().length === 0) {
    throw new Error(`操作の記録 ${index + 1} 手目（${step.kind}）の名前が空です`);
  }
};

/** 手の並びから、押下・入力欄・遷移を数える。 */
export const countSteps = (steps: readonly UsabilityStep[]): UsabilityCount => {
  let presses = 0;
  let transitions = 0;
  const fields = new Set<string>();
  steps.forEach((s, i) => {
    assertValidStep(s, i);
    presses += PRESS_WEIGHT[s.kind];
    if (s.kind === "type") fields.add(s.field.trim());
    if (s.kind === "navigate") transitions += 1;
  });
  return { presses, fields: fields.size, transitions, steps: steps.length };
};

/** URL の比較に使う部分（パス＋検索部分。ハッシュは除く）。相対のパスは仮の基点で解く。 */
const routeKey = (url: string): string => {
  const u = new URL(url, "http://soraban.invalid");
  return `${u.pathname.replace(/\/+$/, "") || "/"}${u.search}`;
};

/**
 * 訪れた URL の並びから、画面の遷移の回数を数える（隣どうしでパスか検索部分が変わった回数）。
 * ハッシュだけの変化・同じ URL の再読み込み・末尾の「/」の有無は遷移に数えない。
 */
export const countTransitions = (urls: readonly string[]): number => {
  let n = 0;
  for (let i = 1; i < urls.length; i++) if (routeKey(urls[i - 1]!) !== routeKey(urls[i]!)) n += 1;
  return n;
};

/** 台本の上限（担当のスプリントの契約、それまでは 37-2 の実測値）。省いた項目は検査しない。 */
export type UsabilityLimit = { readonly presses?: number; readonly fields?: number; readonly transitions?: number };

/** 上限を超えた項目を、読める文の一覧で返す（空なら合格）。上限は 0 以上の整数でなければならない。 */
export const exceedsLimit = (count: UsabilityCount, limit: UsabilityLimit): string[] => {
  const out: string[] = [];
  const label = { presses: "押下", fields: "入力欄", transitions: "遷移" } as const;
  const unit = { presses: "回", fields: "欄", transitions: "回" } as const;
  for (const key of ["presses", "fields", "transitions"] as const) {
    const max = limit[key];
    if (max === undefined) continue;
    if (!Number.isInteger(max) || max < 0) throw new Error(`${label[key]}の上限が不正です: ${max}`);
    if (count[key] > max) out.push(`${label[key]} ${count[key]} ${unit[key]}（上限 ${max}）`);
  }
  return out;
};

/** 台本の結果の 1 行（ログと結果のファイルに出す形）。 */
export type UsabilityResult = {
  readonly scenario: string;
  readonly viewport: { readonly width: number; readonly height: number };
  readonly count: UsabilityCount;
  readonly steps: readonly UsabilityStep[];
};

/** 記録器。台本の E2E は操作のたびに 1 手を足し、最後に result() で結果を得る。 */
export type UsabilityRecorder = {
  readonly tap: (target: string) => void;
  readonly select: (target: string) => void;
  readonly type: (field: string) => void;
  readonly navigate: (to: string) => void;
  readonly scroll: () => void;
  readonly keepDefault: (field: string) => void;
  readonly steps: () => readonly UsabilityStep[];
  readonly result: () => UsabilityResult;
};

export const createUsabilityRecorder = (scenario: string, viewport: { readonly width: number; readonly height: number }): UsabilityRecorder => {
  if (scenario.trim().length === 0) throw new Error("台本の名前が空です");
  if (!(viewport.width > 0) || !(viewport.height > 0)) throw new Error(`画面の幅・高さが不正です: ${viewport.width}×${viewport.height}`);
  const list: UsabilityStep[] = [];
  const push = (s: UsabilityStep): void => {
    assertValidStep(s, list.length);
    list.push(s);
  };
  return {
    tap: (target) => push({ kind: "tap", target }),
    select: (target) => push({ kind: "select", target }),
    type: (field) => push({ kind: "type", field }),
    navigate: (to) => push({ kind: "navigate", to }),
    scroll: () => push({ kind: "scroll" }),
    keepDefault: (field) => push({ kind: "default", field }),
    steps: () => [...list],
    result: () => ({ scenario, viewport: { width: viewport.width, height: viewport.height }, count: countSteps(list), steps: [...list] }),
  };
};

/** 結果を 1 行の文にする（E2E のログ用）。 */
export const formatUsabilityResult = (r: UsabilityResult): string =>
  `[usability] ${r.scenario} ${r.viewport.width}×${r.viewport.height}: 押下 ${r.count.presses}・入力欄 ${r.count.fields}・遷移 ${r.count.transitions}（記録 ${r.count.steps} 手）`;

/** 要素の矩形（文書の先頭からの位置。px）。 */
export type ElementBox = { readonly top: number; readonly height: number };

/**
 * 要素が「最初の画面」（文書の先頭で、スクロールせずに見える範囲）に入るか。
 * 要素の全体が [0, viewportHeight] に入るときだけ真。高さ 0 の要素（非表示）は偽。
 */
export const isInFirstScreen = (box: ElementBox, viewportHeight: number): boolean => {
  if (!(viewportHeight > 0)) throw new Error(`画面の高さが不正です: ${viewportHeight}`);
  if (!(box.height > 0)) return false;
  return box.top >= 0 && box.top + box.height <= viewportHeight + 0.5;
};
