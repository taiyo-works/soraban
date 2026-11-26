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
  // 16-N2（N2-1）：「飛行の前に必ず DIPS でご確認ください」（地図の凡例の注記）の行を外した。16-M から、画面は `tidyEngineText` で「必ず」を外して描くので、
  // この文は公開の `/`・ops・PDF のどこにも描かれない（走査の記録 0 件。docs/legal/screen-wording-inventory.md §2）。もとの定数（regulation-map-layers.ts の NO_LAYER_ROWS）は
  // 表示の前に整える元の文のまま。許可リストに戻すと、描かれない文を許すことになるので戻さない。
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

// ---------------------------------------------------------------------------------------------
// 用語集（Sprint 37 機能D・K-8。docs/design/usability-standard.md §6 と同じ内容。語を変えるときは両方を直す）
// 【使わない語】/ops の画面の文字列に 0 件。例外は GLOSSARY_ALLOWED に、出どころ（apps/web/src からのパス）と理由を書いて足す。
//   単体（wording-glossary.test.ts）は、/ops の画面のソースの文字列リテラルと JSX の文字を走査する（コメント・識別子は対象外）。
//   E2E は wording-scan.ts の scanGlossary で、表示された文字を走査する。
// 【全面禁止語・限定語との関係】「問題なし」は全面禁止語（FORBIDDEN_ALL_WORDS）、「申請」は限定語（LIMITED_WORDS）として、従来どおり別に検査する。

export type GlossaryEntry = {
  readonly id: string;
  /** 統一する語。 */
  readonly preferred: readonly string[];
  /** 使わない語（画面の文字列に 0 件。許可リストを除く）。空なら語の置き換えはまだ決めていない。 */
  readonly avoid: readonly string[];
  /** どの場面の語か。 */
  readonly when: string;
  readonly reason: string;
};

export const GLOSSARY: readonly GlossaryEntry[] = [
  {
    id: "unsent",
    preferred: ["未送信"],
    avoid: ["送信待ち"],
    when: "端末にあってまだ送れていない記録の、画面の表示（件数・状態・説明）。コードの識別子・コメントは対象外",
    reason: "現場の画面に「送信待ち N 件」と「未送信 N 件」の 2 つの言い方がある。利用者から見た状態の「未送信」に統一する（sprint-37.md §6）",
  },
  {
    id: "action-needed",
    preferred: ["対応が必要な事項"],
    avoid: [],
    when: "ホームの見出し",
    reason: "既存の「次にやること」と並べるか置き換えるかは 38-1 で決める（識別子は維持）。それまで使わない語は決めない",
  },
  {
    id: "inspection",
    preferred: ["飛行前点検", "飛行後点検"],
    avoid: ["飛行前確認", "飛行後確認"],
    when: "点検の意味で使うとき",
    reason: "現場の「飛行前の確認」（点検・空域・通報の再確認などの束）と区別する。「飛行前の確認」は使い続ける（使わない語は「の」の無い形だけ）",
  },
  {
    id: "expiry",
    preferred: ["有効期限を確認する"],
    avoid: ["更新を申請", "更新の申請", "申請期限"],
    when: "許可・承認・技能証明などの期限の表示",
    reason: "境界（不変条件 2：許可・承認などの申請の代行・支援はしない）。期限は利用者が確かめるものとして書く",
  },
  {
    id: "unconfirmed",
    preferred: ["確かめられない", "未確認"],
    avoid: ["該当なし"],
    when: "確認できていない状態（「問題なし」は全面禁止語として別に検査する）",
    reason: "不変条件 3（確認していないことを「問題なし」「該当なし」と読ませない）。「該当なし」は記録した事実（選ばなかった等）にだけ使い、出現ごとに許可リストに理由を書く",
  },
];

/** 用語集の使わない語（重複なし）。 */
export const GLOSSARY_AVOID_WORDS: readonly string[] = [...new Set(GLOSSARY.flatMap((g) => g.avoid))];

export type GlossaryAllowed = {
  readonly word: string;
  /** 許す文字列。match=exact はリテラルの全体（前後の空白を除く）と一致、contains はリテラルの部分文字列。 */
  readonly sentence: string;
  readonly match: "exact" | "contains";
  /** 出どころ（apps/web/src からのパス。区切りは /）。 */
  readonly source: string;
  readonly reason: string;
};

const UNSENT_UNTIL_38 = "画面のコードは Sprint 37 では変えない（K-11）。38-1 の共通の未送信の表示と同時に「未送信」へ直す（E2E の期待値も移す）";

/**
 * 用語集の使わない語の許可リスト（理由つき）。単体の走査では、source のファイルの中のリテラルにだけ効く。
 * 古い項目が残らないよう、単体テストが各項目の出現を確かめる（直したら項目も消す）。
 */
export const GLOSSARY_ALLOWED: readonly GlossaryAllowed[] = [
  { word: "送信待ち", sentence: "送信待ち", match: "exact", source: "components/ops/field-client.tsx", reason: `現場の状況の帯「送信待ち N 件」（field-status-unsent）。${UNSENT_UNTIL_38}` },
  { word: "送信待ち", sentence: "送信待ちの記録が残っています。", match: "contains", source: "components/ops/field-client.tsx", reason: `計画の取消・やり直しを止めるときの説明。${UNSENT_UNTIL_38}` },
  { word: "送信待ち", sentence: "送信待ちの記録は端末に残っています。", match: "contains", source: "components/ops/field-client.tsx", reason: `ログインの期限切れの説明。${UNSENT_UNTIL_38}` },
  { word: "送信待ち", sentence: "記録は送信待ちに入り、", match: "contains", source: "components/ops/offline-shells.tsx", reason: `圏外の画面の説明。${UNSENT_UNTIL_38}` },
  { word: "送信待ち", sentence: "この端末では送信待ちを保存できません。", match: "contains", source: "components/ops/offline-shells.tsx", reason: `端末に保存できないときの注記。${UNSENT_UNTIL_38}` },
  { word: "送信待ち", sentence: "この端末の送信待ちに保存します", match: "contains", source: "components/ops/offline-shells.tsx", reason: `圏外の点検の説明。${UNSENT_UNTIL_38}` },
  { word: "送信待ち", sentence: "（送信待ち）", match: "exact", source: "components/ops/offline-shells.tsx", reason: `圏外の日誌の、点検の有無の補足。${UNSENT_UNTIL_38}` },
  { word: "送信待ち", sentence: "送信待ちを残してログアウト", match: "exact", source: "components/ops/ops-client.tsx", reason: `ログアウトの警告のボタン。${UNSENT_UNTIL_38}` },
  { word: "送信待ち", sentence: "この端末では送信待ちを保存できません。", match: "contains", source: "lib/ops-field.ts", reason: `端末に保存できないときの注記（定数）。${UNSENT_UNTIL_38}` },
  { word: "送信待ち", sentence: "送信待ち（この端末のブラウザの保存領域）", match: "contains", source: "lib/pwa.ts", reason: `端末に残るものの説明（保存領域の名前として使っている）。${UNSENT_UNTIL_38}` },
  { word: "送信待ち", sentence: "送信待ちが 0 件になってから帰ってください。", match: "contains", source: "lib/pwa.ts", reason: `端末に残るものの説明の注意。${UNSENT_UNTIL_38}` },
  { word: "送信待ち", sentence: "送信待ち", match: "exact", source: "app/ops/design/catalog.tsx", reason: `部品の見本（/ops/design）の、現場の帯の見本。現場の帯と同じ表示に合わせているため、${UNSENT_UNTIL_38}` },
  {
    word: "該当なし",
    sentence: "該当なし",
    match: "exact",
    source: "app/ops/flights/[id]/page.tsx",
    reason: "飛行記録の「特定飛行の形態」で、記録に 1 つも選ばれていないことの表示。記録した事実で、未確認の状態ではない",
  },
];

/** 用語集の使わない語を探す。extraAllowed の文と GLOSSARY_ALLOWED の文を取り除いた残りを調べる（E2E の表示の走査用）。 */
export const findGlossaryAvoided = (text: string, opts: { readonly useAllowList?: boolean; readonly extraAllowed?: readonly string[] } = {}): WordingHit[] => {
  const allowed = [...(opts.useAllowList === false ? [] : GLOSSARY_ALLOWED.map((a) => a.sentence)), ...(opts.extraAllowed ?? [])].sort((a, b) => b.length - a.length);
  let rest = text;
  for (const s of allowed) rest = rest.split(s).join("\u0000");
  return hits(rest, GLOSSARY_AVOID_WORDS);
};

/** 単体の走査用：source のファイルの 1 つのリテラル literal に出た word が、許可リストで許されているか。 */
export const glossaryAllowedFor = (source: string, literal: string, word: string): GlossaryAllowed | undefined => {
  const t = literal.trim();
  return GLOSSARY_ALLOWED.find((a) => a.word === word && a.source === source && (a.match === "exact" ? t === a.sentence : t.includes(a.sentence)));
};

/**
 * 判定の表示の自前の見出し（lib/verdict-display.ts の VERDICT_SECTION_TITLE.duties）。判定エンジンの文言ではなく、アプリ側の見出し。
 * 棚卸し（docs/legal/screen-wording-inventory.md）で「判定エンジン由来」と分けて載せる。
 */
export const JUDGEMENT_OWN_HEADINGS: readonly string[] = ["飛行の前後に行うこと"];
