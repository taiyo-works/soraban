// Sprint 37 K-8：用語集の使わない語が、/ops の画面のソースの文字列に 0 件であること（許可リストは理由つき）。
// 走査の流儀は wording-policy.test.ts に合わせる（コメントは対象外）。文字列リテラル・テンプレートの文字・JSX の文字を、TypeScript の構文木から取り出す。
// 限界：1 つの語がテンプレートの式や JSX の式をまたいで分かれている場合は見つけられない（表示の文字は E2E の scanGlossary で調べる）。
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import {
  FORBIDDEN_ALL_WORDS,
  GLOSSARY,
  GLOSSARY_ALLOWED,
  GLOSSARY_AVOID_WORDS,
  LIMITED_WORDS,
  findGlossaryAvoided,
  findGlossaryAvoidedInPage,
  glossaryAllowedFor,
} from "./wording-policy";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** /ops の画面の文字列が置かれる場所（apps/web/src からのパス）。画面の部品・定数・画面に出るサーバーの文。 */
const SCAN_DIRS = ["app/ops", "components/ops", "lib", "server/ops"] as const;
/** 走査から外すファイル。語の一覧そのものを持つため。 */
const EXCLUDED = new Set(["lib/wording-policy.ts"]);

const rel = (f: string): string => path.relative(SRC, f).split(path.sep).join("/");
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) return n === "node_modules" || n === ".next" ? [] : walk(p);
    return [p];
  });
const isTest = (f: string): boolean => /(\.test\.tsx?|test-helpers\.ts|\.spec\.ts)$/.test(f);

type Literal = { readonly source: string; readonly line: number; readonly text: string };

/** ファイルの文字列リテラル・テンプレートの文字・JSX の文字（コメントを除く）。 */
const literalsOf = (file: string): Literal[] => {
  const code = readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: Literal[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n) || ts.isJsxText(n)) {
      out.push({ source: rel(file), line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1, text: n.text });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
};

const files = SCAN_DIRS.flatMap((d) => walk(path.join(SRC, d))).filter((f) => /\.tsx?$/.test(f) && !isTest(f) && !EXCLUDED.has(rel(f)));
const literals = files.flatMap(literalsOf);

/** 使わない語の出現（リテラルごと・語ごと）と、許可リストの当たり。 */
const occurrences = literals.flatMap((l) =>
  GLOSSARY_AVOID_WORDS.filter((w) => l.text.includes(w)).map((w) => ({ ...l, word: w, allowed: glossaryAllowedFor(l.source, l.text, w) })),
);

describe("用語集（lib/wording-policy.ts GLOSSARY）", () => {
  it("契約 §6 の 5 行がある。各行に統一する語・場面・理由がある", () => {
    expect(GLOSSARY.map((g) => g.id)).toEqual(["unsent", "action-needed", "inspection", "expiry", "unconfirmed"]);
    for (const g of GLOSSARY) {
      expect(g.preferred.length, g.id).toBeGreaterThan(0);
      expect(g.when.length, g.id).toBeGreaterThan(0);
      expect(g.reason.length, g.id).toBeGreaterThan(0);
    }
  });
  it("使わない語：送信待ち・飛行前確認・飛行後確認・更新を申請・更新の申請・申請期限・該当なし", () => {
    expect([...GLOSSARY_AVOID_WORDS]).toEqual(["送信待ち", "飛行前確認", "飛行後確認", "更新を申請", "更新の申請", "申請期限", "該当なし"]);
  });
  it("統一する語に、使わない語が含まれない（統一する語そのものが検査に当たらない）", () => {
    for (const g of GLOSSARY) for (const p of g.preferred) expect(findGlossaryAvoided(p, { useAllowList: false }), `${g.id}: ${p}`).toEqual([]);
  });
  it("「飛行前の確認」（点検・空域・通報の再確認などの束）は当たらない。「飛行前確認」は当たる", () => {
    expect(findGlossaryAvoided("① 飛行前の確認", { useAllowList: false })).toEqual([]);
    expect(findGlossaryAvoided("飛行前確認を記録", { useAllowList: false }).map((h) => h.word)).toEqual(["飛行前確認"]);
  });
  it("「問題なし」は全面禁止語、「申請」は限定語として従来どおり別に検査する（用語集で二重に数えない）", () => {
    expect(FORBIDDEN_ALL_WORDS).toContain("問題なし");
    expect(GLOSSARY_AVOID_WORDS).not.toContain("問題なし");
    expect(LIMITED_WORDS).toContain("申請");
  });
});

describe("findGlossaryAvoided（E2E の表示の走査に使う）", () => {
  it("許可リストを使わなければ、すべての出現を返す", () => {
    expect(findGlossaryAvoided("送信待ち 2 件。特定飛行の形態：該当なし", { useAllowList: false }).map((h) => h.word)).toEqual(["送信待ち", "該当なし"]);
  });
  it("許可リストの文・追加で渡した文は取り除いてから調べる", () => {
    expect(findGlossaryAvoided("送信待ちを残してログアウト")).toEqual([]);
    expect(findGlossaryAvoided("申請期限は 3 日後です", { useAllowList: false, extraAllowed: ["申請期限は 3 日後です"] })).toEqual([]);
    expect(findGlossaryAvoided("申請期限は 3 日後です").map((h) => h.word)).toEqual(["申請期限"]);
  });
});

describe("findGlossaryAvoidedInPage（E2E の scanGlossary が使う。連続した文字列で検出）", () => {
  it("隣り合うテキストノードにまたがる語も見つける（`飛行前<span>確認</span>` の textContent は「飛行前確認」）", () => {
    // 改行でつないだ文字列だと「飛行前\n確認」になり、見逃していた
    expect(findGlossaryAvoided("飛行前\n確認")).toEqual([]);
    expect(findGlossaryAvoidedInPage({ outside: "飛行前確認", scoped: [], attrs: [] }).map((h) => h.word)).toEqual(["飛行前確認"]);
    expect(findGlossaryAvoidedInPage({ outside: "", scoped: ["飛行後確認"], attrs: [] }).map((h) => h.word)).toEqual(["飛行後確認"]);
    expect(findGlossaryAvoidedInPage({ outside: "", scoped: [], attrs: ["aria-label=送信待ち"] }).map((h) => h.word)).toEqual([]);
    expect(findGlossaryAvoidedInPage({ outside: "", scoped: [], attrs: ["aria-label=更新の申請"] }).map((h) => h.word)).toEqual(["更新の申請"]);
  });
  it("領域の間は改行で区切り、領域をまたぐ語は作らない", () => {
    expect(findGlossaryAvoidedInPage({ outside: "飛行前", scoped: ["確認"], attrs: [] })).toEqual([]);
  });
  it("許可リストの文は取り除く", () => {
    expect(findGlossaryAvoidedInPage({ outside: "送信待ちを残してログアウト", scoped: [], attrs: [] })).toEqual([]);
  });
});

describe("許可リスト（GLOSSARY_ALLOWED）", () => {
  it("各項目：語は使わない語の一つ、文に語を含む、理由がある、出どころのファイルが実在する", () => {
    for (const a of GLOSSARY_ALLOWED) {
      const label = `${a.source}「${a.sentence}」`;
      expect(GLOSSARY_AVOID_WORDS, label).toContain(a.word);
      expect(a.sentence, label).toContain(a.word);
      expect(a.reason.length, label).toBeGreaterThan(10);
      expect(existsSync(path.join(SRC, a.source)), label).toBe(true);
      expect(SCAN_DIRS.some((d) => a.source.startsWith(`${d}/`)), `${label}: 走査の対象の外`).toBe(true);
    }
  });
  it("古い項目が残らない：各項目が、走査したリテラルに 1 回以上当たる（画面を直したら項目も消す）", () => {
    const used = new Set(occurrences.flatMap((o) => (o.allowed ? [o.allowed] : [])));
    const stale = GLOSSARY_ALLOWED.filter((a) => !used.has(a)).map((a) => `${a.source}「${a.sentence}」`);
    expect(stale).toEqual([]);
  });
});

describe("/ops の画面のソースの走査（K-8）", () => {
  it("走査の対象が空でない（取りこぼしを防ぐ）", () => {
    expect(files.length).toBeGreaterThan(50);
    expect(literals.length).toBeGreaterThan(2000);
    for (const f of ["components/ops/field-client.tsx", "components/ops/offline-shells.tsx", "app/ops/page.tsx", "lib/ops-field.ts"]) {
      expect(files.map(rel), f).toContain(f);
    }
  });
  it("走査の仕組みが語を見つけられる（現状の「送信待ち」の出現を拾えている）", () => {
    expect(occurrences.filter((o) => o.word === "送信待ち").length).toBeGreaterThan(0);
  });
  it("用語集の使わない語が、許可リストの外に 0 件", () => {
    const bad = occurrences.filter((o) => !o.allowed).map((o) => `${o.source}:${o.line} 「${o.word}」…${o.text.replace(/\s+/g, " ").trim().slice(0, 60)}…`);
    expect(bad).toEqual([]);
  });
  it("検査が効くこと：許可リストに無い出どころの同じ文は違反になる", () => {
    expect(glossaryAllowedFor("components/ops/new-screen.tsx", "送信待ち", "送信待ち")).toBeUndefined();
    expect(glossaryAllowedFor("components/ops/field-client.tsx", "送信待ちが 3 件あります", "送信待ち")).toBeUndefined();
    expect(glossaryAllowedFor("components/ops/field-client.tsx", " 送信待ち ", "送信待ち")).toBeDefined();
  });
});
