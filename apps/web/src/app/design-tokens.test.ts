// Sprint 12g stage 1a (contract 1a-1, 1a-2): the new design tokens in globals.css.
// Reads the CSS, resolves the tokens for every context (light / dark, normal / field mode) the way the cascade does,
// and checks the contrast ratios listed in docs/design/ui-direction.md 3.1:
//   normal text 4.5:1, non-text meaning (input/button borders, icons) 3:1, field-mode body text and primary buttons 7:1.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
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

type Ctx = { readonly theme: "light" | "dark"; readonly field: boolean };
/**
 * Resolve token values for a context by applying matching rules in source order.
 * Sprint 16: dark exists only as the forced theme (:root[data-theme="dark"]); there is no OS-dark rule to follow.
 */
function resolve(ctx: Ctx): Record<string, string> {
  const out: Record<string, string> = {};
  const darkRoot = ':root[data-theme="dark"]';
  for (const r of RULES) {
    const sel = r.selector;
    let applies = false;
    if (!r.inDarkMedia && sel === ":root") applies = true;
    else if (!r.inDarkMedia && sel === ":root .field") applies = ctx.field;
    else if (ctx.theme === "dark" && !r.inDarkMedia) {
      if (sel === darkRoot) applies = true;
      else if (sel === `${darkRoot} .field`) applies = ctx.field;
    }
    if (applies) Object.assign(out, r.vars);
  }
  return out;
}

const lin = (c: number): number => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex: string): number => {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`not a #rrggbb colour: ${hex}`);
  const n = parseInt(m[1]!, 16);
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
};
export const contrast = (a: string, b: string): number => {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

const MEANINGS = ["ok", "warn", "danger", "info", "neutral"] as const;
const VERDICTS = ["no-fly", "needs", "done", "clear", "unknown"] as const;
const SURFACES = ["bg-surface", "bg-app", "bg-sunken"] as const;

const CONTEXTS: readonly [string, Ctx][] = (["light", "dark"] as const).map((theme): [string, Ctx] => [theme, { theme, field: false }]);
const FIELD_CONTEXTS: readonly [string, Ctx][] = (["light", "dark"] as const).map((theme): [string, Ctx] => [`field ${theme}`, { theme, field: true }]);

const get = (t: Record<string, string>, name: string): string => {
  const v = t[`--${name}`];
  if (!v) throw new Error(`token --${name} is not defined`);
  return v;
};

type Check = { readonly label: string; readonly fg: string; readonly bg: string; readonly min: number };

/** The pairs of ui-direction.md 3.1. `body` is the minimum for text: 4.5 normally, 7 in field mode. */
function pairs(t: Record<string, string>, field: boolean): Check[] {
  const body = field ? 7 : 4.5;
  const out: Check[] = [];
  const add = (label: string, fg: string, bg: string, min: number): void => {
    out.push({ label, fg: get(t, fg), bg: get(t, bg), min });
  };
  for (const s of SURFACES) {
    add(`fg on ${s}`, "fg", s, body);
    add(`fg-soft on ${s}`, "fg-soft", s, body);
    add(`fg-mute on ${s}`, "fg-mute", s, body);
    add(`accent (text/link) on ${s}`, "accent", s, body);
  }
  add("accent on accent-soft", "accent", "accent-soft", body);
  add("accent-fg on accent-solid (primary button)", "accent-fg", "accent-solid", body);
  add("accent-fg on accent-solid-hover", "accent-fg", "accent-solid-hover", body);
  add("line-strong on bg-surface (input/button border)", "line-strong", "bg-surface", 3);
  add("line-strong on bg-sunken (disabled field, segmented)", "line-strong", "bg-sunken", 3);
  add("accent on bg-surface (focus ring, non-text)", "accent", "bg-surface", 3);
  add("accent-solid on bg-surface (button edge)", "accent-solid", "bg-surface", 3);
  add("accent-solid-hover on bg-surface (button edge)", "accent-solid-hover", "bg-surface", 3);
  for (const m of MEANINGS) {
    add(`${m}-fg on ${m}-bg (mark text)`, `${m}-fg`, `${m}-bg`, body);
    add(`${m}-fg on bg-surface`, `${m}-fg`, "bg-surface", body);
    add(`${m}-line on ${m}-bg (icon)`, `${m}-line`, `${m}-bg`, 3);
    add(`${m}-line on bg-surface (icon)`, `${m}-line`, "bg-surface", 3);
  }
  for (const v of VERDICTS) for (const s of SURFACES) add(`verdict-${v} on ${s}`, `verdict-${v}`, s, 4.5);
  return out;
}

describe("1a-1 トークンの構造", () => {
  it("明・現場（明）・暗（強制のみ）・現場（暗）の規則がある。OS の暗い設定に従う規則はない（Sprint 16）。配色案の規則はない", () => {
    const sels = RULES.map((r) => `${r.inDarkMedia ? "@dark " : ""}${r.selector}`);
    for (const s of [":root", ":root .field", ':root[data-theme="dark"]', ':root[data-theme="dark"] .field']) {
      expect(sels, s).toContain(s);
    }
    expect(sels.filter((x) => x.startsWith("@dark"))).toEqual([]);
    expect(sels.filter((x) => x.includes("data-palette"))).toEqual([]);
    expect(CSS).not.toMatch(/data-palette/);
  });

  it("OS の暗い設定（prefers-color-scheme）に従う宣言が、globals.css・soraban-tokens.css・soraban-ui.css・proxy.ts にない（常に明るい表示）", () => {
    const strip = (t: string): string => t.replace(/\/\*[\s\S]*?\*\//g, "");
    for (const f of ["./globals.css", "./soraban-tokens.css", "./soraban-ui.css", "../proxy.ts"]) {
      expect(strip(readFileSync(new URL(f, import.meta.url), "utf8")), f).not.toMatch(/@media\s*\(\s*prefers-color-scheme\s*:\s*dark/);
    }
  });

  it("暗は明の反転ではない別の組：地は紙色の逆の暗い青黒、文字は紙の白を落とした色、アクセントの塗りは明と別の値", () => {
    const light = resolve({ theme: "light", field: false });
    const dark = resolve({ theme: "dark", field: false });
    for (const k of ["--bg-app", "--bg-surface", "--bg-sunken", "--fg", "--accent", "--accent-solid"]) expect(dark[k], k).not.toBe(light[k]);
    // not a mechanical inversion: the dark text is not the light ground and the dark ground is not the light text
    expect(dark["--fg"]).not.toBe(light["--bg-surface"]);
    expect(dark["--bg-surface"]).not.toBe(light["--fg"]);
    // the ground is a deep blue-black, the text a dimmed paper white (warm), both measured
    expect(luminance(dark["--bg-surface"]!)).toBeLessThan(0.02);
    expect(luminance(dark["--fg"]!)).toBeGreaterThan(0.6);
  });

  it("現場モードの規則は、基本の規則と同じトークンの組をすべて上書きする（下の層の値が漏れない）", () => {
    const keysOf = (sel: string): string[] => Object.keys(RULES.find((r) => r.selector === sel && !r.inDarkMedia)!.vars).sort();
    const need = ["--bg-app", "--bg-surface", "--bg-sunken", "--fg", "--fg-soft", "--fg-mute", "--line", "--line-strong", "--accent", "--accent-soft", "--accent-solid", "--accent-solid-hover", "--accent-fg", ...MEANINGS.flatMap((m) => [`--${m}-fg`, `--${m}-bg`, `--${m}-line`])];
    for (const dark of [false, true]) {
      const field = dark ? ':root[data-theme="dark"] .field' : ":root .field";
      const kf = keysOf(field);
      for (const k of need) expect(kf, `${dark ? "dark" : "light"} field ${k}`).toContain(k);
    }
  });

  it("半透明（ガラス）・影のトークンを持たない。角丸は 1 か所の値だけで、ピルは別に 1 つ", () => {
    expect(CSS).not.toMatch(/--glass|backdrop-filter|--sh-|--shadow-|\.glass/);
    const base = RULES.find((r) => r.selector === ":root" && "--r-journal" in r.vars)!;
    const px = parseFloat(base.vars["--r-journal"]!);
    expect(base.vars["--r-journal"]).toMatch(/^\d+px$/);
    expect(px).toBeGreaterThanOrEqual(4);
    expect(px).toBeLessThanOrEqual(6);
    expect(Object.keys(base.vars).filter((k) => k.startsWith("--r-")).sort()).toEqual(["--r-journal", "--r-pill"]);
    // every radius utility resolves to that one token
    expect(CSS).toMatch(/--radius-ctl:\s*var\(--r-journal\)/);
    expect(CSS).not.toMatch(/--radius-(card|sheet)\b/);
    // motion is 200-300ms
    const dur = (n: string): number => parseInt(base.vars[n]!, 10);
    expect(dur("--dur")).toBeGreaterThanOrEqual(200);
    expect(dur("--dur-sheet")).toBeLessThanOrEqual(300);
  });

  it("派生のトークン（影・半透明）は要素側で解決される：var() を持つ値を :root に置かない", () => {
    const rootRules = RULES.filter((r) => r.selector === ":root" || r.selector.startsWith(":root:not") || r.selector.startsWith(":root[data-theme"));
    for (const r of rootRules) {
      for (const [k, v] of Object.entries(r.vars)) {
        if (/^--(bg|fg|line|accent|ok|warn|danger|info|neutral|verdict|scrim|r|dur|ease)/.test(k)) {
          expect(v, `${r.selector} ${k}`).not.toMatch(/var\(/);
        }
      }
    }
  });

  it("現場モードのアクセント（塗り）は明では濃い藍 #1f4a99、暗では淡い藍（暗い文字を載せる）", () => {
    expect(resolve({ theme: "light", field: true })["--accent-solid"]).toBe("#1f4a99");
    expect(resolve({ theme: "light", field: true })["--accent"]).toBe("#1f4a99");
    expect(resolve({ theme: "dark", field: true })["--accent-solid"]).toBe("#a6c0f4");
  });

  it("color-scheme：常に `light`（OS が暗でも明るく描く）。強制したテーマ（明・暗）では単一の値（現場モードも同じ）", () => {
    const block = (selector: string): string => {
      const i = CSS.indexOf(`${selector} {`);
      expect(i, selector).toBeGreaterThanOrEqual(0);
      return CSS.slice(i, CSS.indexOf("}", i));
    };
    expect(block(".ds")).toMatch(/color-scheme:\s*light;/);
    expect(block(".ds")).not.toMatch(/color-scheme:\s*light dark/);
    for (const theme of ["light", "dark"] as const) {
      const sel = `:root[data-theme="${theme}"] .ds`;
      expect(block(sel), theme).toMatch(new RegExp(`color-scheme:\\s*${theme};`));
      // the html element follows too (root scrollbars / canvas)
      expect(CSS).toMatch(new RegExp(`:root\\[data-theme="${theme}"\\],\\s*:root\\[data-theme="${theme}"\\] \\.ds \\{`));
    }
    // field mode never sets its own color-scheme, so it inherits the single value above
    expect(CSS).not.toMatch(/\.field[^{}]*\{[^}]*color-scheme/);
    // nothing outside `.ds` / a forced theme declares one
    const all = [...CSS.matchAll(/([^{}]+)\{[^}]*color-scheme/g)].map((m) => m[1]!.trim().replace(/\s+/g, " "));
    expect(all.sort()).toEqual([
      ".ds",
      ':root[data-theme="dark"], :root[data-theme="dark"] .ds',
      ':root[data-theme="light"], :root[data-theme="light"] .ds',
    ]);
  });

  it("`.ds` は color-scheme: light を宣言し、旧名のトークンは `.ds` の下でだけ新しい値へ写像される", () => {
    expect(CSS).toMatch(/\.ds\s*\{[^}]*color-scheme:\s*light;/);
    const ds = RULES.find((r) => r.selector === ".ds, .ds .field")!;
    expect(ds.vars["--color-paper"]).toBe("var(--bg-surface)");
    expect(ds.vars["--color-ink"]).toBe("var(--fg)");
    expect(ds.vars["--color-verdict-no-fly"]).toBe("var(--verdict-no-fly)");
    // The global scope keeps the old values: the first top-level :root still defines the paper colour as before.
    const root = RULES.find((r) => r.selector === ":root" && "--color-paper" in r.vars)!;
    expect(root.vars["--color-paper"]).toBe("#f5f2ea");
    // And no rule other than the `.ds` family remaps them.
    const remap = RULES.filter((r) => r.vars["--color-paper"]?.startsWith("var(--bg-")).map((r) => r.selector);
    expect(remap).toEqual([".ds, .ds .field"]);
  });

  it("システムフォントのスタックと、等幅のスタックを `.ds` に置く。Web フォントの名前を持ち込まない。本文の行間は 1.7 以上", () => {
    const ds = RULES.find((r) => r.selector === ".ds")!;
    expect(ds.vars["--ds-font-sans"]).toMatch(/-apple-system[\s\S]*Hiragino Sans[\s\S]*Yu Gothic UI[\s\S]*Noto Sans JP/);
    expect(ds.vars["--ds-font-mono"]).toMatch(/ui-monospace/);
    expect(ds.vars["--ds-font-sans"]).not.toMatch(/Plex|Fraunces/);
    expect(CSS).toMatch(/--text-body--line-height:\s*1\.7;/);
    expect(CSS).toMatch(/\.ds\s*\{[^}]*line-height:\s*1\.7;/);
    expect(CSS).toMatch(/\.ds\s*\{[^}]*line-break:\s*strict;/);
  });
});

describe("1a-2 コントラスト（ui-direction.md 3.1 の組）", () => {
  for (const [name, ctx] of CONTEXTS) {
    it(`通常：${name} — 文字 4.5:1、境界・アイコン 3:1`, () => {
      const t = resolve(ctx);
      const bad = pairs(t, false)
        .map((p) => ({ ...p, ratio: contrast(p.fg, p.bg) }))
        .filter((p) => p.ratio < p.min)
        .map((p) => `${p.label}: ${p.fg} on ${p.bg} = ${p.ratio.toFixed(2)} (< ${p.min})`);
      expect(bad).toEqual([]);
    });
  }
  for (const [name, ctx] of FIELD_CONTEXTS) {
    it(`現場モード：${name} — 本文・主要ボタン 7:1、境界・アイコン 3:1`, () => {
      const t = resolve(ctx);
      const bad = pairs(t, true)
        .map((p) => ({ ...p, ratio: contrast(p.fg, p.bg) }))
        .filter((p) => p.ratio < p.min)
        .map((p) => `${p.label}: ${p.fg} on ${p.bg} = ${p.ratio.toFixed(2)} (< ${p.min})`);
      expect(bad).toEqual([]);
    });
  }

  it("実測の記録：紙・墨・藍の主な値（明・暗）", () => {
    const r = (a: string, b: string): number => Math.round(contrast(a, b) * 100) / 100;
    expect(r("#171b22", "#fbf9f3")).toBe(16.4);
    expect(r("#5c5f66", "#fbf9f3")).toBe(6.07);
    expect(r("#1f4a99", "#ffffff")).toBe(8.41);
    expect(r("#ebe7da", "#151b25")).toBe(13.97);
    expect(r("#8fb0f0", "#151b25")).toBe(7.93);
    expect(r("#ffffff", "#4a72c4")).toBe(4.67);
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
  it("check-contrast-v2.mjs（アプリの実ファイルを読む）が 4 通り・284 件と、日差しの模擬 136 件をすべて満たす（終了コード 0）", () => {
    const out = execFileSync(process.execPath, [new URL("../../../../docs/design/tokens-v2/check-contrast-v2.mjs", import.meta.url).pathname], { encoding: "utf8" });
    expect(out).toContain("組 75（通常 72／現場 72／暗 70／現場・暗 70）= 計 284 件と、寸法・動き・暗の構造を検査。日差しの模擬 136 件。満たさない: 0");
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

  it("値の要点：橙が主役、角丸 16/8/4/ピル、影なし（明も）、押す部品 44/48/56（現場 56/56/64）、暗は温かい黒、v1 の角丸の名前は残っていない", () => {
    for (const [mode, layers] of SB_MODES) {
      const t = sbResolve(layers);
      expect(t["--sb-orange"], mode).toBe("#F89B48");
      expect(t["--sb-on-orange"], mode).toBe("#262523");
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
    // Sprint 16-1（H-1）：ページの地は白、面はごく薄いグレー、くぼみは 1 段濃いグレー。ベージュ・温かいオフホワイトは使わない
    expect([light["--sb-base"], light["--sb-surface"], light["--sb-sunken"]]).toEqual(["#FFFFFF", "#F6F7F7", "#EEF0F0"]);
    expect([dark["--sb-base"], dark["--sb-surface"], dark["--sb-sunken"]]).toEqual(["#1B1A18", "#252421", "#121110"]);
    expect(fieldDark["--sb-ink"]).toBe("#F8F6F1");
    expect(light["--sb-shadow"]).toBe("none"); // H-2：影をやめ、面は罫で分ける
    expect(dark["--sb-shadow"]).toBe("0 0 0 1px #3A3834");
    expect(field["--sb-shadow"]).toBe("none");
    expect([light["--sb-hit-min"], light["--sb-hit"], light["--sb-hit-primary"]]).toEqual(["44px", "48px", "56px"]);
    expect([field["--sb-hit-min"], field["--sb-hit"], field["--sb-hit-primary"], field["--sb-hit-row"]]).toEqual(["56px", "56px", "64px", "64px"]);
    // 暗の地は純黒でなく温かい（赤 ≥ 青）
    for (const k of ["--sb-base", "--sb-surface", "--sb-sunken"]) {
      const h = dark[k]!;
      expect(parseInt(h.slice(1, 3), 16)).toBeGreaterThanOrEqual(parseInt(h.slice(5, 7), 16));
    }
  });

  it("CSS の色（#rrggbb）のトークンは、見本にもある（見本にない色を足さない）。動きは現場と減らす指定で 0", () => {
    const inCss = Object.keys(sbResolve(SB_MODES[3]![1])).sort();
    const inDocs = Object.keys(Object.assign({}, ...SELECTORS.map(([sel, dark]) => docs(sel, dark)))).sort();
    expect(inCss).toEqual(inDocs);
    expect(sbResolve(SB_MODES[2]![1])["--sb-dur"]).toBe("0ms");
    expect(sbResolve(SB_MODES[2]![1])["--sb-dur-rise"]).toBe("0ms");
    const raw = readFileSync(TOKENS_URL, "utf8");
    expect(raw).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*:root \{ --sb-dur: 0ms; --sb-dur-rise: 0ms; \}/);
  });
});
