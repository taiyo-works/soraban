import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { type Page } from "@playwright/test";
import { JUDGEMENT_OWN_HEADINGS, JUDGEMENT_SCOPE_SELECTOR, SCOPE_ALLOWED_TESTIDS, classifyLimited, findForbidden, findGlossaryAvoidedInPage, findPlaceholders } from "../apps/web/src/lib/wording-policy";

// Sprint 18-3 契約 §6.2：禁止語・限定語の走査。E2E（公開・運航管理）が共有する。語の一覧は apps/web/src/lib/wording-policy.ts。
// - 対象：document.documentElement.textContent（畳み・display:none の中も含む。script/style/template は除く）と、全要素の aria-label・title・alt・placeholder、
//   <title>、<meta name="description">、OG。
// - 全面禁止語：印（data-wording-scope="judgement"）の中も含めて 0 件。
// - 限定語：印の外では許可リストの文の外に 0 件。印の中は検査しない（判定エンジン由来。記録だけ残す）。
// - 結果は WORDING_SCAN_OUT（既定 test-results/wording）に JSON で残す。docs/legal/screen-wording-inventory.md は scripts/wording-inventory.mjs がこれから作る（手で書き足さない）。

export type ScanRecord = {
  readonly kind: "judgement" | "allowed" | "violation" | "forbidden" | "placeholder" | "glossary";
  readonly route: string;
  readonly state: string;
  readonly word: string;
  readonly sentence: string;
  readonly source?: string;
  readonly count?: number;
};

type Collected = { readonly outside: string; readonly outsideJoined: string; readonly scoped: { readonly text: string; readonly joined: string }[]; readonly scopeIds: string[]; readonly attrs: string[] };

export const collectPageText = (page: Page): Promise<Collected> =>
  page.evaluate((scopeSel) => {
    const strip = (root: Element): void => {
      for (const el of Array.from(root.querySelectorAll("script, style, template"))) el.remove();
    };
    const clone = document.documentElement.cloneNode(true) as HTMLElement;
    strip(clone);
    // 印の中の文字列を別に集め、外側の文字列からは除く
    const scoped: { text: string; joined: string }[] = [];
    // 印の付いた要素の data-testid（すべて。入れ子も）。許可された要素の一覧と突き合わせる
    const scopeIds = Array.from(document.querySelectorAll(scopeSel)).map((el) => el.getAttribute("data-testid") ?? "(testid なし)");
    for (const el of Array.from(clone.querySelectorAll(scopeSel))) {
      // 入れ子の印は外側のものだけを数える
      if (el.parentElement?.closest(scopeSel)) continue;
      // joined：文字ノードを改行でつなぐ（文の取り出し用。要素の境目で文が切れる）
      const parts: string[] = [];
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) if ((n.nodeValue ?? "").trim()) parts.push(n.nodeValue ?? "");
      scoped.push({ text: el.textContent ?? "", joined: parts.join("\n") });
    }
    for (const el of Array.from(clone.querySelectorAll(scopeSel))) {
      if (el.parentElement?.closest(scopeSel)) continue;
      el.replaceWith(document.createTextNode(" "));
    }
    const attrs: string[] = [];
    for (const el of Array.from(document.querySelectorAll("[aria-label], [title], img[alt], [placeholder]"))) {
      for (const a of ["aria-label", "title", "alt", "placeholder"]) {
        const v = el.getAttribute(a);
        if (v) attrs.push(`${a}=${v}`);
      }
    }
    attrs.push(`<title>=${document.title}`);
    for (const m of Array.from(document.querySelectorAll('meta[name="description"], meta[property^="og:"]'))) {
      const c = m.getAttribute("content");
      if (c) attrs.push(`meta=${c}`);
    }
    const outsideParts: string[] = [];
    const w2 = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT);
    for (let n = w2.nextNode(); n; n = w2.nextNode()) if ((n.nodeValue ?? "").trim()) outsideParts.push(n.nodeValue ?? "");
    return { outside: clone.textContent ?? "", outsideJoined: outsideParts.join("\n"), scoped, scopeIds, attrs };
  }, JUDGEMENT_SCOPE_SELECTOR);

const OWN = "判定の表示（アプリ側の見出し）";
const ENGINE = "判定エンジン由来";
const ownSource = (sentence: string): string => (JUDGEMENT_OWN_HEADINGS.some((h) => sentence.includes(h)) ? OWN : ENGINE);

/** 文字列を検査して記録に足す。scoped=true（判定の領域の印の中）は、許可リストの外の限定語を「判定エンジン由来」として記録するだけで違反にしない。 */
const scanText = (
  route: string,
  state: string,
  text: string,
  scoped: boolean,
  out: ScanRecord[],
  joined: string = text,
  opts: { readonly extraAllowed?: readonly string[]; readonly squash?: boolean } = {},
): void => {
  for (const h of findForbidden(text)) out.push({ kind: "forbidden", route, state, word: h.word, sentence: h.context });
  for (const h of classifyLimited(text, joined, opts)) {
    if (h.kind === "allowed" && h.source?.startsWith("画面の印の中")) out.push({ kind: "judgement", route, state, word: h.word, sentence: h.sentence, source: ownSource(h.sentence) });
    else if (h.kind === "allowed") out.push({ kind: "allowed", route, state: scoped ? `${state}（印の中）` : state, word: h.word, sentence: h.sentence, ...(h.source ? { source: h.source } : {}), count: 1 });
    else out.push({ kind: scoped ? "judgement" : "violation", route, state, word: h.word, sentence: h.sentence, ...(scoped ? { source: ownSource(h.sentence) } : {}) });
  }
};

/** 走査が空振りしていないことの下限（印の外の文字数）。大きな要素に印を付けて外側が空になる・集める処理が壊れる、のどちらも落とす。 */
export const MIN_OUTSIDE_CHARS = 150;

/** 現在のページを走査して記録を返す。 */
export const scanPage = async (page: Page, route: string, state = "初期", minChars = MIN_OUTSIDE_CHARS): Promise<ScanRecord[]> => {
  const c = await collectPageText(page);
  const out: ScanRecord[] = [];
  // 印を付けてよい要素の一覧（契約 §6.1）の外に印があれば違反（検査を止める使い方を防ぐ）
  for (const id of c.scopeIds) {
    if (!SCOPE_ALLOWED_TESTIDS.includes(id)) out.push({ kind: "violation", route, state, word: "data-wording-scope", sentence: `印を付けてよい要素の一覧にない要素：${id}` });
  }
  if (c.outside.replace(/\s+/g, "").length < minChars) out.push({ kind: "violation", route, state, word: "走査の空振り", sentence: `印の外の文字が ${c.outside.replace(/\s+/g, "").length} 文字しかない（${minChars} 文字未満）` });
  scanText(route, state, c.outside, false, out, c.outsideJoined);
  for (const s of c.scoped) scanText(route, state, s.text, true, out, s.joined);
  // 属性・title・meta は印の外として扱う（属性に判定の文言は出さない）
  scanText(route, `${state}（属性・題名・meta）`, c.attrs.join("\n"), false, out);
  return out;
};

/**
 * 文字列だけ（PDF・マニフェストの JSON）を走査する。
 * - PDF：squash=true（空白を除いて照合）。extraAllowed に、同じ走査で画面の印の中に出た判定の文を渡す。許可リストにも渡した文にも入らない限定語は違反
 *   （PDF の自前の文：免責・見出し・フッターに限定語が入ったら落ちる）。
 */
export const scanString = (route: string, state: string, text: string, opts: { readonly extraAllowed?: readonly string[]; readonly squash?: boolean } = {}): ScanRecord[] => {
  const out: ScanRecord[] = [];
  scanText(route, state, text, false, out, text, opts);
  return out;
};

/** 載せない語（未定・準備中・TBD ほか）の走査（契約 3-3）。 */
export const scanPlaceholders = async (page: Page, route: string): Promise<ScanRecord[]> => {
  const c = await collectPageText(page);
  const text = [c.outside, ...c.scoped.map((x) => x.text), ...c.attrs].join("\n");
  return findPlaceholders(text).map((h) => ({ kind: "placeholder" as const, route, state: "初期", word: h.word, sentence: h.context }));
};

/**
 * 用語集の使わない語の走査（Sprint 37 K-8。/ops の画面に当てる）。語と許可リストは lib/wording-policy.ts の GLOSSARY・GLOSSARY_ALLOWED。
 * 判定の領域の印の中も含めて、表示の文字・属性を調べる。scanPage・violationsOf の結果は変えない（別の種類 "glossary" で返す）。
 * 語の検出は連続した文字列（outside・scoped[].text）で行う。
 * 注意：許可リストの文（例「送信待ち」）は表示の文字から部分文字列として取り除くため、短い文の項目があるあいだは、その語は E2E では実質的に許される。
 * 出どころごとの厳密な検査は単体（apps/web/src/lib/wording-glossary.test.ts）が受け持つ。
 */
export const scanGlossary = async (page: Page, route: string, state = "初期"): Promise<ScanRecord[]> => {
  const c = await collectPageText(page);
  // 語の検出は連続した文字列で行う（joined だと、隣り合うテキストノードにまたがる語を見逃す。lib/wording-policy.ts の findGlossaryAvoidedInPage）
  return findGlossaryAvoidedInPage({ outside: c.outside, scoped: c.scoped.map((x) => x.text), attrs: c.attrs }).map((h) => ({ kind: "glossary" as const, route, state, word: h.word, sentence: h.context }));
};

/** 用語集の使わない語の記録を、読める文にする（violationsOf とは別に使う）。 */
export const glossaryViolationsOf = (records: readonly ScanRecord[]): string[] =>
  records.filter((r) => r.kind === "glossary").map((r) => `${r.route}［${r.state}］「${r.word}」…${r.sentence}…（用語集の使わない語）`);

/** 違反（全面禁止語・許可リスト外の限定語）だけを、読める文にする。 */
export const violationsOf = (records: readonly ScanRecord[]): string[] =>
  records
    .filter((r) => r.kind === "violation" || r.kind === "forbidden" || r.kind === "placeholder")
    .map((r) => `${r.route}［${r.state}］「${r.word}」…${r.sentence}…（${r.kind === "violation" ? "限定語が許可リストの外" : r.kind === "forbidden" ? "全面禁止語" : "載せない語"}）`);

/** 走査の記録を JSON で残す（inventory の元）。 */
export const saveScan = (name: string, records: readonly ScanRecord[]): void => {
  const dir = process.env.WORDING_SCAN_OUT ?? path.resolve("test-results", "wording");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(records, null, 1));
};
