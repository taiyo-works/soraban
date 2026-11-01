import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { type Page } from "@playwright/test";
import { JUDGEMENT_SCOPE_SELECTOR, classifyLimited, findForbidden, findPlaceholders } from "../apps/web/src/lib/wording-policy";

// Sprint 18-3 契約 §6.2：禁止語・限定語の走査。E2E（公開・運航管理）が共有する。語の一覧は apps/web/src/lib/wording-policy.ts。
// - 対象：document.documentElement.textContent（畳み・display:none の中も含む。script/style/template は除く）と、全要素の aria-label・title・alt・placeholder、
//   <title>、<meta name="description">、OG。
// - 全面禁止語：印（data-wording-scope="judgement"）の中も含めて 0 件。
// - 限定語：印の外では許可リストの文の外に 0 件。印の中は検査しない（判定エンジン由来。記録だけ残す）。
// - 結果は WORDING_SCAN_OUT（既定 test-results/wording）に JSON で残す。docs/legal/screen-wording-inventory.md は scripts/wording-inventory.mjs がこれから作る（手で書き足さない）。

export type ScanRecord = {
  readonly kind: "judgement" | "allowed" | "violation" | "forbidden" | "placeholder";
  readonly route: string;
  readonly state: string;
  readonly word: string;
  readonly sentence: string;
  readonly source?: string;
  readonly count?: number;
};

type Collected = { readonly outside: string; readonly scoped: { readonly text: string; readonly joined: string }[]; readonly attrs: string[] };

export const collectPageText = (page: Page): Promise<Collected> =>
  page.evaluate((scopeSel) => {
    const strip = (root: Element): void => {
      for (const el of Array.from(root.querySelectorAll("script, style, template"))) el.remove();
    };
    const clone = document.documentElement.cloneNode(true) as HTMLElement;
    strip(clone);
    // 印の中の文字列を別に集め、外側の文字列からは除く
    const scoped: { text: string; joined: string }[] = [];
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
    return { outside: clone.textContent ?? "", scoped, attrs };
  }, JUDGEMENT_SCOPE_SELECTOR);

/** 文字列を検査して記録に足す。scoped=true（判定の領域の印の中）は、許可リストの外の限定語を「判定エンジン由来」として記録するだけで違反にしない。 */
const scanText = (route: string, state: string, text: string, scoped: boolean, out: ScanRecord[], joined: string = text): void => {
  for (const h of findForbidden(text)) out.push({ kind: "forbidden", route, state, word: h.word, sentence: h.context });
  for (const h of classifyLimited(text, joined)) {
    if (h.kind === "allowed") out.push({ kind: "allowed", route, state: scoped ? `${state}（印の中）` : state, word: h.word, sentence: h.sentence, ...(h.source ? { source: h.source } : {}), count: 1 });
    else out.push({ kind: scoped ? "judgement" : "violation", route, state, word: h.word, sentence: h.sentence });
  }
};

/** 現在のページを走査して記録を返す。 */
export const scanPage = async (page: Page, route: string, state = "初期"): Promise<ScanRecord[]> => {
  const c = await collectPageText(page);
  const out: ScanRecord[] = [];
  scanText(route, state, c.outside, false, out);
  for (const s of c.scoped) scanText(route, state, s.text, true, out, s.joined);
  // 属性・title・meta は印の外として扱う（属性に判定の文言は出さない）
  scanText(route, `${state}（属性・題名・meta）`, c.attrs.join("\n"), false, out);
  return out;
};

/** 文字列だけ（PDF・マニフェストの JSON）を走査する。judgement=true は、判定の結果の再掲（PDF）として限定語を記録だけにする。 */
export const scanString = (route: string, state: string, text: string, judgement: boolean): ScanRecord[] => {
  const out: ScanRecord[] = [];
  scanText(route, state, text, judgement, out);
  return out;
};

/** 載せない語（未定・準備中・TBD ほか）の走査（契約 3-3）。 */
export const scanPlaceholders = async (page: Page, route: string): Promise<ScanRecord[]> => {
  const c = await collectPageText(page);
  const text = [c.outside, ...c.scoped.map((x) => x.text), ...c.attrs].join("\n");
  return findPlaceholders(text).map((h) => ({ kind: "placeholder" as const, route, state: "初期", word: h.word, sentence: h.context }));
};

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
