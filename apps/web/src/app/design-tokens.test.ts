// globals.css と soraban-tokens.css の構造の検査。
// 16-N2（N-1）：Sprint 12g の色の層（紙・墨・藍の --bg-*・--fg-*・--accent*、意味の 5 色、判定の色、暗、現場の .field）を globals.css から撤去したので、
// その層の構造・コントラストだけを確かめていた検査（1a-1・1a-2）を、撤去の確認と残した組版の確認に置き換えた。
// トークン（--sb-*）の全組のコントラストは、下の 12h P1-6 の check-contrast-v2.mjs が引き続き確かめる（組 101・402 件）。
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const CSS = readFileSync(new URL("./globals.css", import.meta.url), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  // statements without a block (they would otherwise be read as the head of the next rule)
  .replace(/@(import|custom-variant)[^;{]*;/g, "");

type Rule = { readonly selector: string; readonly inDarkMedia: boolean; readonly vars: Readonly<Record<string, string>> };

/**
 * A small brace parser: top-level rules and the rules directly inside `@media (prefers-color-scheme: dark)`.
 * Rules inside any other at-rule (min-width media, @supports, reduced-transparency fallbacks) are not part of the
 * theme cascade this test resolves, so they are skipped (the fallbacks are checked separately as text).
 */
function parseRules(css: string): Rule[] {
  const rules: Rule[] = [];
  let i = 0;
  const readBlock = (inDark: boolean, skip = false): void => {
    while (i < css.length) {
      const open = css.indexOf("{", i);
      const close = css.indexOf("}", i);
      if (close !== -1 && (open === -1 || close < open)) {
        i = close + 1;
        return;
      }
      if (open === -1) return;
      const head = css.slice(i, open).trim();
      i = open + 1;
      if (head.startsWith("@")) {
        // at-rule with nested rules (media, supports, theme, keyframes) or a declaration block (font-face etc.)
        const isDark = /^@media\s*\(prefers-color-scheme:\s*dark\)\s*$/.test(head);
        readBlock(isDark, skip || !isDark);
        continue;
      }
      const end = css.indexOf("}", i);
      const body = css.slice(i, end);
      i = end + 1;
      const vars: Record<string, string> = {};
      for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) vars[m[1]!] = m[2]!.trim();
      if (!skip) rules.push({ selector: head.replace(/\s+/g, " "), inDarkMedia: inDark, vars });
    }
  };
  readBlock(false);
  return rules;
}

const RULES = parseRules(CSS);

describe("globals.css の構造（16-N2 の撤去後）", () => {
  it("旧い色の層がない：初期の --color-*（paper・ink・indigo・signal・verdict）、12g の --bg-*・--fg-*・--accent*・意味の 5 色・--verdict-*・--scrim、.field、暗の強制、色の Tailwind 名", () => {
    for (const re of [
      /--color-(paper|ink|rule|indigo|brand|signal|verdict)/,
      /(?<![\w-])--(bg-(app|surface|sunken)|fg(-soft|-mute)?|line(-strong)?|accent(-soft|-solid|-fg)?|ok-|warn-|danger-|info-|neutral-|verdict-|scrim|r-journal|r-pill|appicon)(?![\w-]*-height)/,
      /(^|[\s,>])\.field\b|:root \.field|data-theme|data-palette/,
      /@custom-variant|--color-(app|surface|sunken|fg|line|accent|ok|warn|danger|info|neutral)\b/,
      /\.(eyebrow|bearing-mark|contour-rule)\b/,
    ]) {
      expect(CSS, String(re)).not.toMatch(re);
    }
    expect(RULES.filter((r) => r.selector.startsWith(":root"))).toEqual([]);
  });

  it("OS の暗い設定（prefers-color-scheme）に従う宣言が、globals.css・soraban-tokens.css・soraban-ui.css・proxy.ts にない（常に明るい表示）", () => {
    const strip = (t: string): string => t.replace(/\/\*[\s\S]*?\*\//g, "");
    for (const f of ["./globals.css", "./soraban-tokens.css", "./soraban-ui.css", "../proxy.ts"]) {
      expect(strip(readFileSync(new URL(f, import.meta.url), "utf8")), f).not.toMatch(/@media\s*\(\s*prefers-color-scheme\s*:\s*dark/);
    }
  });

  it("半透明（ガラス）・影のトークンを持たない", () => {
    expect(CSS).not.toMatch(/--glass|backdrop-filter|--sh-|--shadow-|\.glass/);
  });

  it("`.ds` は color-scheme: light と、システムフォントのスタック・本文の行間 1.7・日本語の組版（行頭禁則）を持つ。Web フォントの名前を持ち込まない。色は --sb-* を直接引く", () => {
    const ds = RULES.find((r) => r.selector === ".ds")!;
    expect(ds.vars["--ds-font-sans"]).toMatch(/-apple-system[\s\S]*Hiragino Sans[\s\S]*Yu Gothic UI[\s\S]*Noto Sans JP/);
    expect(ds.vars["--ds-font-sans"]).not.toMatch(/Plex|Fraunces/);
    expect(CSS).toMatch(/--text-body--line-height:\s*1\.7;/);
    expect(CSS).toMatch(/\.ds\s*\{[^}]*color-scheme:\s*light;/);
    expect(CSS).not.toMatch(/color-scheme:\s*light dark/);
    expect(CSS).toMatch(/\.ds\s*\{[^}]*line-height:\s*1\.7;/);
    expect(CSS).toMatch(/\.ds\s*\{[^}]*line-break:\s*strict;/);
    expect(CSS).toMatch(/\.ds\s*\{[^}]*background:\s*var\(--sb-base\);[^}]*color:\s*var\(--sb-ink\);/);
  });
});

// Sprint 12h PR ① stage B: soraban-tokens.css (--sb-*) is imported by globals.css. Nothing references it yet, so the
// look does not change; these checks keep the file, design-system.md 3.4 and the contrast script in step.
const TOKENS_URL = new URL("./soraban-tokens.css", import.meta.url);
const SB_RULES = parseRules(readFileSync(TOKENS_URL, "utf8").replace(/\/\*[\s\S]*?\*\//g, ""));
const sbVars = (selector: string, inDark: boolean): Record<string, string> => {
  const r = SB_RULES.find((x) => x.selector === selector && x.inDarkMedia === inDark);
  if (!r) throw new Error(`rule not found: ${selector}`);
  return r.vars;
};
const SB_DARK = ':root[data-theme="dark"]';
const SB_MODES: readonly (readonly [string, Record<string, string>[]])[] = [
  ["明", [sbVars(":root", false)]],
  ["暗", [sbVars(":root", false), sbVars(SB_DARK, false)]],
  ["現場・明", [sbVars(":root", false), sbVars(':root[data-mode="field"]', false)]],
  [
    "現場・暗",
    [sbVars(":root", false), sbVars(':root[data-mode="field"]', false), sbVars(SB_DARK, false), sbVars(`${SB_DARK}[data-mode="field"]`, false)],
  ],
];
const sbResolve = (layers: Record<string, string>[]): Record<string, string> => Object.assign({}, ...layers);

describe("12h P1-5 トークンの取り込み", () => {
  it("globals.css が soraban-tokens.css（値）・soraban-theme.css（Tailwind の名前）・soraban-ui.css（部品）を読み込む。--sb-* の宣言（値）を globals.css に足さない（参照はよい）", () => {
    const raw = readFileSync(new URL("./globals.css", import.meta.url), "utf8");
    expect(raw).toMatch(/@import "\.\/soraban-tokens\.css";/);
    expect(raw).toMatch(/@import "\.\/soraban-theme\.css";/);
    expect(raw).toMatch(/@import "\.\/soraban-ui\.css";/);
    expect(CSS).not.toMatch(/--sb-[\w-]+\s*:/);
    // 値は soraban-tokens.css だけ。theme は var() で結ぶだけで、16 進の色を持たない
    const theme = readFileSync(new URL("./soraban-theme.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(theme).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});

// Sprint 12h PR ②（デザインシステム v2）：トークンの値は soraban-tokens.css（アプリの実ファイル）が正。
// 検査 check-contrast-v2.mjs はこの実ファイルを読む。設計の見本 docs/design/tokens-v2/soraban-tokens-v2.css と宣言が同じであることも確かめる。
const DOCS_TOKENS = parseRules(
  readFileSync(new URL("../../../../docs/design/tokens-v2/soraban-tokens-v2.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, ""),
);

describe("12h P1-6 新トークンのコントラストと暗の一致（v2）", () => {
  it("check-contrast-v2.mjs（アプリの実ファイルを読む）が 4 通り・402 件と、日差しの模擬 194 件をすべて満たす（終了コード 0）", () => {
    const out = execFileSync(process.execPath, [new URL("../../../../docs/design/tokens-v2/check-contrast-v2.mjs", import.meta.url).pathname], { encoding: "utf8" });
    expect(out).toContain("組 101（通常 101／現場 101／暗 100／現場・暗 100）= 計 402 件と、寸法・動き・暗の構造を検査。日差しの模擬 194 件。満たさない: 0");
    expect(out).toContain("日差しの模擬（通常。g=0.1 が合否");
    expect(out).toContain("日差しの模擬（現場。g=0.1 が合否");
  });

  it("暗は強制（data-theme=dark）の 2 つの規則だけ（OS 設定の版は持たない）。暗は明のトークンを引きずらない（検査スクリプトが確かめる）", () => {
    const sels = SB_RULES.map((r) => `${r.inDarkMedia ? "@dark " : ""}${r.selector}`);
    expect(sels.filter((x) => x.includes("data-theme"))).toEqual([':root[data-theme="dark"]', ':root[data-theme="dark"][data-mode="field"]']);
    expect(sels.filter((x) => x.startsWith("@dark"))).toEqual([]);
  });
});

describe("12h P1-7 soraban-tokens.css と v2 の見本（docs/design/tokens-v2）", () => {
  const docs = (selector: string, inDark: boolean): Record<string, string> => {
    const r = DOCS_TOKENS.find((x) => x.selector === selector && x.inDarkMedia === inDark);
    if (!r) throw new Error(`rule not found in docs: ${selector}`);
    return r.vars;
  };
  const SELECTORS: ReadonlyArray<readonly [string, boolean]> = [
    [":root", false],
    [':root[data-mode="field"]', false],
    [':root[data-theme="dark"]', false],
    [':root[data-theme="dark"][data-mode="field"]', false],
  ];

  it("4 つの規則（明・現場・暗 強制・現場の暗 強制）の宣言が、見本と 1 つ残らず一致する", () => {
    const bad: string[] = [];
    for (const [sel, dark] of SELECTORS) {
      const app = sbVars(sel, dark);
      const doc = docs(sel, dark);
      for (const k of new Set([...Object.keys(app), ...Object.keys(doc)])) {
        if (app[k] !== doc[k]) bad.push(`${dark ? "@dark " : ""}${sel} ${k}: アプリ ${app[k]} / 見本 ${doc[k]}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("値の要点：主色は空色の 1 色（橙は無い）、角丸 16/8/4（16-C まで）と新しい名前 16/12/20、ピル、影なし（明も。浮くものだけ別）、押す部品 44/48/56（現場 56/56/64。16-B で 48 へ）、暗は青みのある黒、v1 の角丸の名前は残っていない", () => {
    for (const [mode, layers] of SB_MODES) {
      const t = sbResolve(layers);
      // 主色：明は #1F5FE0、現場（明）は #1848B0（白の文字 7:1）、暗は #6B9BFF（面の上の文字は墨）、現場の暗は #8AB0FF。橙のトークンは無い
      expect(t["--sb-primary"], mode).toBe({ 明: "#1F5FE0", 暗: "#6B9BFF", "現場・明": "#1848B0", "現場・暗": "#8AB0FF" }[mode]);
      expect(t["--sb-on-primary"], mode).toBe(mode.includes("暗") ? "#0E1116" : "#FFFFFF");
      expect(Object.keys(t).filter((k) => /orange/i.test(k)), mode).toEqual([]);
      expect([t["--sb-r-card"], t["--sb-r-control"], t["--sb-r-sheet"]], mode).toEqual(["16px", "12px", "20px"]);
      expect(t["--sb-r-l"], mode).toBe("16px");
      expect(t["--sb-r-m"], mode).toBe("8px");
      expect(t["--sb-r-s"], mode).toBe("4px");
      expect(t["--sb-pill"], mode).toBe("9999px");
      for (const gone of ["--sb-r-block", "--sb-r-ctl", "--sb-r-round", "--sb-soft-out", "--sb-soft-in", "--sb-copper"]) expect(t[gone], `${mode} ${gone}`).toBeUndefined();
    }
    const light = sbResolve(SB_MODES[0]![1]);
    const dark = sbResolve(SB_MODES[1]![1]);
    const field = sbResolve(SB_MODES[2]![1]);
    const fieldDark = sbResolve(SB_MODES[3]![1]);
    // Sprint 16-A（sprint-16.md §3.1）：ページの地は #F6F7F9、面は白、くぼみは一段濃いグレー（暗は地 < 面 < 面の一段上）
    expect([light["--sb-base"], light["--sb-surface"], light["--sb-sunken"]]).toEqual(["#F6F7F9", "#FFFFFF", "#EEF1F5"]);
    expect([dark["--sb-base"], dark["--sb-surface"], dark["--sb-sunken"]]).toEqual(["#0E1116", "#161B22", "#1E2530"]);
    expect([light["--sb-ink"], light["--sb-ink-2"], light["--sb-ink-3"], light["--sb-ink-disabled"]]).toEqual(["#14181F", "#3F4B5E", "#5B6573", "#8A93A1"]);
    expect([light["--sb-edge"], light["--sb-rule"], field["--sb-edge"], field["--sb-rule"]]).toEqual(["#6B7586", "#E1E5EB", "#4A5466", "#8A93A1"]);
    expect([light["--sb-primary-press"], light["--sb-primary-soft"], light["--sb-focus"], field["--sb-focus"]]).toEqual(["#1C56CF", "#E8F0FD", "#1F5FE0", "#1848B0"]);
    expect(fieldDark["--sb-ink"]).toBe("#F5F7FA");
    // 状態色：印・面・文字（明）。判定の 5 段は状態色から引く
    expect([light["--sb-st-safe-mark"], light["--sb-st-safe-face"], light["--sb-st-safe-text"]]).toEqual(["#17794A", "#E6F4EC", "#0E5A35"]);
    expect([light["--sb-st-warn-mark"], light["--sb-st-warn-face"], light["--sb-st-warn-text"]]).toEqual(["#9A5B00", "#FDF1DC", "#6B3F00"]);
    expect([light["--sb-st-danger-mark"], light["--sb-st-danger-face"], light["--sb-st-danger-text"]]).toEqual(["#B42318", "#FDE8E6", "#8A1A12"]);
    expect([light["--sb-st-info-mark"], light["--sb-st-info-face"], light["--sb-st-info-text"]]).toEqual(["#3F4B5E", "#EAEEF3", "#3F4B5E"]);
    expect([light["--sb-st-flying-mark"], light["--sb-st-flying-face"], light["--sb-st-flying-text"]]).toEqual(["#0E6B8C", "#E1F2F8", "#08506A"]);
    expect(sbResolve(SB_MODES[0]![1])["--sb-v-no-fg"]).toBe("var(--sb-st-danger-text)");
    expect(light["--sb-shadow"]).toBe("none"); // H-2：基本は影なし。面は罫で分ける
    expect(light["--sb-shadow-float"]).toBe("0 -4px 24px rgba(20, 24, 31, 0.08)"); // 浮くものだけ
    expect(dark["--sb-shadow"]).toBe("0 0 0 1px #2A3240");
    expect(field["--sb-shadow"]).toBe("none");
    expect(field["--sb-shadow-float"]).toBe("none");
    expect([light["--sb-dur"], light["--sb-dur-press"], light["--sb-dur-sheet"], light["--sb-dur-state"]]).toEqual(["180ms", "120ms", "280ms", "300ms"]);
    expect(light["--sb-ease"]).toBe("cubic-bezier(0.2, 0, 0, 1)");
    expect([1, 2, 3, 4, 5, 6, 8, 10, 12].map((n) => light[`--sb-sp-${n}`])).toEqual(["4px", "8px", "12px", "16px", "20px", "24px", "32px", "40px", "48px"]);
    expect([light["--sb-hit-min"], light["--sb-hit"], light["--sb-hit-primary"]]).toEqual(["48px", "48px", "56px"]); // 16-B：44→48
    expect([field["--sb-hit-min"], field["--sb-hit"], field["--sb-hit-primary"], field["--sb-hit-row"]]).toEqual(["56px", "56px", "64px", "64px"]);
    // 16-B：文字の大きさは rem（1rem = 16px）。本文 16（現場 18）、補足 14（現場も 14）
    expect([light["--sb-fs-body"], light["--sb-fs-note"]]).toEqual(["1rem", "0.875rem"]);
    expect([field["--sb-fs-body"], field["--sb-fs-note"]]).toEqual(["1.125rem", "0.875rem"]);
    // 暗の地は純黒でなく青みのある黒（青 ≥ 赤）
    for (const k of ["--sb-base", "--sb-surface", "--sb-sunken"]) {
      const h = dark[k]!;
      expect(parseInt(h.slice(5, 7), 16)).toBeGreaterThanOrEqual(parseInt(h.slice(1, 3), 16));
    }
  });

  it("橙のトークン・クラスの参照が apps/web/src にない（--sb-orange*・--sb-on-orange*・--color-sb-orange*・*-sb-orange*。橙はロゴだけ）", () => {
    const hits: string[] = [];
    const walk = (dir: string): void => {
      for (const n of readdirSync(dir)) {
        const p = join(dir, n);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(css|tsx?|mjs)$/.test(n) && !/\.test\.tsx?$/.test(n)) {
          const text = readFileSync(p, "utf8");
          if (/(?:--sb-|--color-sb-|(?<![\w-])(?:bg|text|border|ring|fill|stroke|decoration|accent|outline)-sb-)(?:on-)?orange/.test(text)) hits.push(p);
        }
      }
    };
    walk(fileURLToPath(new URL("..", import.meta.url)));
    expect(hits).toEqual([]);
  });

  it("CSS の色（#rrggbb）のトークンは、見本にもある（見本にない色を足さない）。動きは現場と減らす指定で 0", () => {
    const inCss = Object.keys(sbResolve(SB_MODES[3]![1])).sort();
    const inDocs = Object.keys(Object.assign({}, ...SELECTORS.map(([sel, dark]) => docs(sel, dark)))).sort();
    expect(inCss).toEqual(inDocs);
    for (const d of ["--sb-dur", "--sb-dur-press", "--sb-dur-sheet", "--sb-dur-state", "--sb-dur-rise"]) expect(sbResolve(SB_MODES[2]![1])[d], d).toBe("0ms");
    const raw = readFileSync(TOKENS_URL, "utf8");
    expect(raw).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*:root \{ --sb-dur: 0ms; --sb-dur-press: 0ms; --sb-dur-sheet: 0ms; --sb-dur-state: 0ms; --sb-dur-rise: 0ms; \}/);
  });
});
