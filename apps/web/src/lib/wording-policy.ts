// 禁止語・限定語の方針（Sprint 18-3 §6）。語の一覧は**ここ 1 か所**。E2E（走査）と単体（wording-policy.test.ts）の両方が読む。
// 注意：E2E から相対 import されるため、ここでは "@/" の別名や packages を import しない（依存は ./boundary だけ）。
//
// 【全面禁止語】どこでも 0 件。判定の領域の印（data-wording-scope="judgement"）の中も同じ。
//   「代行」「代理」は境界の文に使わない（boundary.ts）ため、例外を作らない。専門家が「申請の代行はしません」という書き方を求めた場合は、
//   その全文だけを ALLOWED_SENTENCES に足す（語の全面禁止は外さない）。
// 【限定語】許可リスト（ALLOWED_SENTENCES）の文の中だけ許す。判定の領域の印の中は検査しない（判定エンジン由来の文言は変えない：sprint-18.md §4.6）。
// 【判定の領域の印】印を付けてよい要素は、下の SCOPE_ALLOWED_TESTIDS の 6 か所に固定する（契約 §6.1）。走査のたびに、印の付いた要素の data-testid が
//   この一覧に入っているかを検査する（大きな要素に印を付けて検査を止めることを防ぐ）。増やすときは、理由をここと docs/evaluations/sprint-18-test-changes.md に書く。
//   - 公開の `/`：result-section、result-details、did-status（VerdictSummary と規制カード）
//   - /ops/plans/[id]/judgement の VerdictSummary を包む要素（judgement-scope-plan）
//   - /ops/plans/[id]/snapshots/[sid] の判定の本文を包む要素（judgement-scope-snapshot）
//   - 計画の主画面の判定の 1 行（plan-judge-line）
import { BOUNDARY_FULL, BOUNDARY_SHORT } from "./boundary";

export const JUDGEMENT_SCOPE_ATTR = "data-wording-scope";
export const JUDGEMENT_SCOPE_VALUE = "judgement";
export const JUDGEMENT_SCOPE_SELECTOR = `[${JUDGEMENT_SCOPE_ATTR}="${JUDGEMENT_SCOPE_VALUE}"]`;

/** 判定の領域の印を付けてよい要素の data-testid（契約 §6.1 の 6 か所）。 */
export const SCOPE_ALLOWED_TESTIDS: readonly string[] = [
  "result-section",
  "result-details",
  "did-status",
  "judgement-scope-plan",
  "judgement-scope-snapshot",
  "plan-judge-line",
];

/** 全面禁止語（印の中も含め、どこでも 0 件）。 */
export const FORBIDDEN_ALL_WORDS: readonly string[] = [
  "通報不要",
  "通報は不要",
  "通報の必要はありません",
  "通報しなくて",
  "問題なし",
  "問題ありません",
  "大丈夫",
  "完璧",
  "完全に対応",
  "確実に適法",
  "法に抵触しません",
  "違法になりません",
  "安心して飛べます",
  "保証します",
  "代行",
  "代理",
];

/** 限定語（許可リストの文の中だけ許す。判定の領域の印の中は検査しない）。 */
export const LIMITED_WORDS: readonly string[] = ["申請", "保証", "必ず"];

/** 旧名称（apps/web/src のテストを除くコードと apps/web/public に 0 件）。 */
export const OLD_NAMES: readonly string[] = ["AIさんいん", "タイヨー通信群", "メルドカルタ"];

/** 載せない語（未確認の項目の見出し・仮の値。公開の `/`・/ops/about・マニフェストに 0 件）。 */
export const PLACEHOLDER_WORDS: readonly string[] = ["未定", "準備中", "TBD", "要記入", "xxx", "ダミー", "example", "法人番号", "適格請求書", "インボイス"];

// 公式の手続きの文（packages/dips の OFFICIAL_PROCEDURE_NOTE と同じ。wording-policy.test.ts が一致を確かめる）。
export const OFFICIAL_PROCEDURE_NOTE_TEXT = "許可・承認の申請と飛行計画の通報は、利用者本人が DIPS 2.0 などの公式の手続きで行います。";

export type AllowedSentence = { readonly word: (typeof LIMITED_WORDS)[number]; readonly sentence: string; readonly source: string };

/** 許可リスト（完全一致の部分文字列）。 */
export const ALLOWED_SENTENCES: readonly AllowedSentence[] = [
  { word: "申請", sentence: BOUNDARY_SHORT, source: "lib/boundary.ts BOUNDARY_SHORT（判定の結論の直下）" },
  { word: "申請", sentence: BOUNDARY_FULL, source: "lib/boundary.ts BOUNDARY_FULL（このアプリについて）" },
  { word: "申請", sentence: OFFICIAL_PROCEDURE_NOTE_TEXT, source: "packages/dips OFFICIAL_PROCEDURE_NOTE（公式の手続きの文）" },
  { word: "保証", sentence: "制度の最新性・正確性は保証しません", source: "lib/disclaimers.ts DISCLAIMER_JUDGEMENT" },
  { word: "保証", sentence: "報告が必要かどうかを判断するものでも、保証するものでもありません", source: "lib/ops-incident.ts（事故・ヒヤリハットの目安）" },
  { word: "必ず", sentence: "飛行の前に必ず DIPS でご確認ください", source: "components/regulation-map-layers.ts（地図の凡例の注記）" },
];

export type WordingHit = { readonly word: string; readonly index: number; readonly context: string };

const hits = (text: string, words: readonly string[]): WordingHit[] => {
  const out: WordingHit[] = [];
  for (const word of words) {
    let from = 0;
    for (;;) {
      const i = text.indexOf(word, from);
      if (i < 0) break;
      out.push({ word, index: i, context: text.slice(Math.max(0, i - 20), i + word.length + 20).replace(/\s+/g, " ") });
      from = i + word.length;
    }
  }
  return out;
};

/** 全面禁止語を探す。 */
export const findForbidden = (text: string): WordingHit[] => hits(text, FORBIDDEN_ALL_WORDS);

/**
 * 限定語を探す。許可リストの文を取り除いた残りに限定語があれば違反。
 * 長い文から順に取り除く（短い文が長い文の一部のとき、長い方を先に取り除く）。
 */
export const findLimited = (text: string, extraAllowed: readonly string[] = []): WordingHit[] => {
  const sentences = [...ALLOWED_SENTENCES.map((a) => a.sentence), ...extraAllowed].sort((a, b) => b.length - a.length);
  let rest = text;
  for (const s of sentences) rest = rest.split(s).join("\u0000");
  return hits(rest, LIMITED_WORDS);
};

export const findPlaceholders = (text: string): WordingHit[] => hits(text, PLACEHOLDER_WORDS);

/** index を含む 1 文（「。」と改行で区切る）。走査の記録用。 */
export const sentenceAround = (text: string, index: number): string => {
  const cut = (c: string, from: number): number => text.lastIndexOf(c, from);
  const start = Math.max(cut("。", index - 1) + 1, cut("\n", index - 1) + 1);
  const ends = [text.indexOf("。", index), text.indexOf("\n", index)].filter((n) => n >= 0);
  const end = ends.length === 0 ? text.length : Math.min(...ends) + 1;
  return text.slice(start, end).replace(/\s+/g, " ").trim();
};

export type LimitedHit = {
  readonly word: string;
  readonly index: number;
  /** allowed＝許可リストの文の中、other＝その外。 */
  readonly kind: "allowed" | "other";
  /** allowed のとき許可リストの文、other のとき出現を含む 1 文（joined から取る）。 */
  readonly sentence: string;
  readonly source?: string;
};

/**
 * 限定語の出現を、許可リストの文の中か外かに分ける（走査の記録用）。
 * text は textContent、joined は同じ文字列にブロックの境目の改行を足したもの（文の取り出し用。省略すると text）。
 * 同じ語の n 番目の出現は、joined でも n 番目になる（足すのは改行だけ）。
 */
export const classifyLimited = (
  text: string,
  joined: string = text,
  opts: { readonly extraAllowed?: readonly string[]; readonly squash?: boolean } = {},
): LimitedHit[] => {
  // squash：空白を除いた文字列どうしで照合する（PDF の文字列は空白が揃わない）。extraAllowed：同じ走査で画面の印の中に出た判定の文
  const norm = (x: string): string => (opts.squash ? x.replace(/\s+/g, "") : x);
  const allowed = [
    ...ALLOWED_SENTENCES.map((a) => ({ sentence: norm(a.sentence), shown: a.sentence, source: a.source })),
    ...(opts.extraAllowed ?? []).filter((x) => x.length >= 8).map((x) => ({ sentence: norm(x), shown: x, source: "画面の印の中で記録した判定の文" })),
  ];
  const ranges: { from: number; to: number; sentence: string; source: string }[] = [];
  for (const a of allowed) {
    let from = 0;
    for (;;) {
      const i = text.indexOf(a.sentence, from);
      if (i < 0) break;
      ranges.push({ from: i, to: i + a.sentence.length, sentence: a.shown, source: a.source });
      from = i + a.sentence.length;
    }
  }
  const out: LimitedHit[] = [];
  for (const word of LIMITED_WORDS) {
    let from = 0;
    let n = 0;
    for (;;) {
      const i = text.indexOf(word, from);
      if (i < 0) break;
      const r = ranges.find((x) => i >= x.from && i < x.to);
      if (r) out.push({ word, index: i, kind: "allowed", sentence: r.sentence, source: r.source });
      else {
        // joined の中の n 番目の出現
        let j = -1;
        let at = 0;
        for (let k = 0; k <= n; k++) {
          j = joined.indexOf(word, at);
          at = j + word.length;
        }
        out.push({ word, index: i, kind: "other", sentence: j < 0 ? text.slice(Math.max(0, i - 20), i + 20) : sentenceAround(joined, j) });
      }
      n++;
      from = i + word.length;
    }
  }
  return out;
};

/**
 * 判定の表示の自前の見出し（lib/verdict-display.ts の VERDICT_SECTION_TITLE.duties）。判定エンジンの文言ではなく、アプリ側の見出し。
 * 棚卸し（docs/legal/screen-wording-inventory.md）で「判定エンジン由来」と分けて載せる。
 */
export const JUDGEMENT_OWN_HEADINGS: readonly string[] = ["飛行の前後に必ず行うこと"];
