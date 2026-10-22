// Sprint 12g stage 1a (contract 1a-1, 1a-2): the new design tokens in globals.css.
// Reads the CSS, resolves the tokens for every context (light/dark x palette 1-3, plus field mode) the way the cascade
// does, and checks the contrast ratios listed in docs/design/ui-direction.md 3.1:
//   normal text 4.5:1, non-text meaning (input/button borders, icons) 3:1, field-mode body text and primary buttons 7:1.
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

type Ctx = { readonly theme: "light" | "dark"; readonly palette: 1 | 2 | 3; readonly field: boolean };
type DarkVariant = "media" | "attr";

/** Resolve token values for a context by applying matching rules in source order. */
function resolve(ctx: Ctx, variant: DarkVariant = "media"): Record<string, string> {
  const out: Record<string, string> = {};
  const darkRoot = variant === "media" ? ':root:not([data-theme="light"])' : ':root[data-theme="dark"]';
  for (const r of RULES) {
    const sel = r.selector;
    let applies = false;
    if (!r.inDarkMedia && sel === ":root") applies = true;
    else if (!r.inDarkMedia && sel === ':root [data-palette="2"]') applies = ctx.palette === 2;
    else if (!r.inDarkMedia && sel === ':root [data-palette="3"]') applies = ctx.palette === 3;
    else if (!r.inDarkMedia && sel === ":root .field") applies = ctx.field;
    else if (ctx.theme === "dark") {
      const fromMedia = r.inDarkMedia && variant === "media";
      const fromAttr = !r.inDarkMedia && variant === "attr";
      if (fromMedia || fromAttr) {
        if (sel === darkRoot) applies = true;
        else if (sel === `${darkRoot} [data-palette="2"]`) applies = ctx.palette === 2;
        else if (sel === `${darkRoot} [data-palette="3"]`) applies = ctx.palette === 3;
        else if (sel === `${darkRoot} .field`) applies = ctx.field;
      }
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

const CONTEXTS: readonly [string, Ctx][] = (["light", "dark"] as const).flatMap((theme) =>
  ([1, 2, 3] as const).map((palette): [string, Ctx] => [`${theme} / palette ${palette}`, { theme, palette, field: false }]),
);
const FIELD_CONTEXTS: readonly [string, Ctx][] = (["light", "dark"] as const).flatMap((theme) =>
  ([1, 2, 3] as const).map((palette): [string, Ctx] => [`field ${theme} / palette ${palette}`, { theme, palette, field: true }]),
);

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
  add("accent-fg on accent (primary button)", "accent-fg", "accent", body);
  add("accent-fg on accent-hover", "accent-fg", "accent-hover", body);
  add("line-strong on bg-surface (input/button border)", "line-strong", "bg-surface", 3);
  add("accent on bg-surface (focus ring, non-text)", "accent", "bg-surface", 3);
  for (const m of MEANINGS) {
    add(`${m}-fg on ${m}-bg (pill text)`, `${m}-fg`, `${m}-bg`, body);
    add(`${m}-fg on bg-surface`, `${m}-fg`, "bg-surface", body);
    add(`${m}-line on ${m}-bg (icon)`, `${m}-line`, `${m}-bg`, 3);
    add(`${m}-line on bg-surface (icon)`, `${m}-line`, "bg-surface", 3);
  }
  for (const v of VERDICTS) for (const s of SURFACES) add(`verdict-${v} on ${s}`, `verdict-${v}`, s, 4.5);
  return out;
}

describe("1a-1 トークンの構造", () => {
  it("明・暗・現場の 3 組と、配色案 2・3 の規則がある。暗は OS 設定の版と data-theme の版の両方", () => {
    const sels = RULES.map((r) => `${r.inDarkMedia ? "@dark " : ""}${r.selector}`);
    for (const s of [
      ":root",
      ':root [data-palette="2"]',
      ':root [data-palette="3"]',
      ":root .field",
      '@dark :root:not([data-theme="light"])',
      '@dark :root:not([data-theme="light"]) [data-palette="2"]',
      '@dark :root:not([data-theme="light"]) [data-palette="3"]',
      '@dark :root:not([data-theme="light"]) .field',
      ':root[data-theme="dark"]',
      ':root[data-theme="dark"] [data-palette="2"]',
      ':root[data-theme="dark"] [data-palette="3"]',
      ':root[data-theme="dark"] .field',
    ]) {
      expect(sels, s).toContain(s);
    }
  });

  it("暗の 2 つの版（prefers-color-scheme と data-theme=dark）は、同じ宣言を持つ", () => {
    for (const ctx of CONTEXTS.concat(FIELD_CONTEXTS).map(([, c]) => c).filter((c) => c.theme === "dark")) {
      expect(resolve(ctx, "media"), JSON.stringify(ctx)).toEqual(resolve(ctx, "attr"));
    }
  });

  it("配色案と現場モードの規則は、基本の規則と同じトークンの組をすべて上書きする（下の層の値が漏れない）", () => {
    const keysOf = (sel: string, dark: boolean): string[] =>
      Object.keys(RULES.find((r) => r.selector === sel && r.inDarkMedia === dark)!.vars).sort();
    const paletteKeys = ["--accent", "--accent-fg", "--accent-hover", "--accent-soft"];
    for (const dark of [false, true]) {
      const root = dark ? ':root:not([data-theme="light"])' : ":root";
      const pal = (n: number): string => (dark ? `${root} [data-palette="${n}"]` : `:root [data-palette="${n}"]`);
      const field = dark ? `${root} .field` : ":root .field";
      expect(keysOf(pal(2), dark)).toEqual(paletteKeys);
      // palette 3 changes neutrals as well; it must define every neutral and accent token
      const k3 = keysOf(pal(3), dark);
      for (const k of ["--bg-app", "--bg-surface", "--bg-sunken", "--fg", "--fg-soft", "--fg-mute", "--line", "--line-strong", ...paletteKeys]) {
        expect(k3, `${dark ? "dark" : "light"} palette 3 ${k}`).toContain(k);
      }
      // field mode redefines neutrals, accent and all semantic colours itself
      const kf = keysOf(field, dark);
      for (const k of [...k3, ...MEANINGS.flatMap((m) => [`--${m}-fg`, `--${m}-bg`, `--${m}-line`]), "--glass-alpha", "--glass-filter"]) {
        expect(kf, `${dark ? "dark" : "light"} field ${k}`).toContain(k);
      }
    }
  });

  it("現場モードは半透明を使わない（地の不透明度 100%＝surface のまま、ぼかしなし）。通常は 80% 以上", () => {
    for (const [name, ctx] of FIELD_CONTEXTS) {
      const t = resolve(ctx);
      expect(t["--glass-alpha"], name).toBe("100%");
      expect(t["--glass-filter"], name).toBe("none");
    }
    for (const [name, ctx] of CONTEXTS) {
      const alpha = parseInt(resolve(ctx)["--glass-alpha"]!, 10);
      expect(alpha, name).toBeGreaterThanOrEqual(80);
      expect(resolve(ctx)["--glass-filter"], name).toMatch(/blur/);
    }
    // opaque fallbacks: no backdrop-filter support, reduced transparency, more contrast
    expect(CSS).toMatch(/@supports not \(backdrop-filter: blur\(1px\)\)[\s\S]*?--glass-alpha: 100%/);
    expect(CSS).toMatch(/@media \(prefers-reduced-transparency: reduce\), \(prefers-contrast: more\)[\s\S]*?--glass-alpha: 100%/);
  });

  it("派生のトークン（影・半透明）は要素側で解決される：var() を持つ値を :root に置かない", () => {
    const rootRules = RULES.filter((r) => r.selector === ":root" || r.selector.startsWith(":root:not") || r.selector.startsWith(":root[data-theme"));
    for (const r of rootRules) {
      for (const [k, v] of Object.entries(r.vars)) {
        if (/^--(bg|fg|line|accent|ok|warn|danger|info|neutral|verdict|sh|glass|scrim|r|dur|ease)/.test(k)) {
          expect(v, `${r.selector} ${k}`).not.toMatch(/var\(/);
        }
      }
    }
  });

  it("現場モードのアクセントは、3 案とも同じ（明は濃い藍 #1f4a99 に固定）", () => {
    for (const theme of ["light", "dark"] as const) {
      const accents = ([1, 2, 3] as const).map((palette) => resolve({ theme, palette, field: true })["--accent"]);
      expect(new Set(accents).size, theme).toBe(1);
    }
    expect(resolve({ theme: "light", palette: 1, field: true })["--accent"]).toBe("#1f4a99");
  });

  it("`.ds` は color-scheme: light dark を宣言し、旧名のトークンは `.ds` の下でだけ新しい値へ写像される", () => {
    expect(CSS).toMatch(/\.ds\s*\{[^}]*color-scheme:\s*light dark/);
    const ds = RULES.find((r) => r.selector === ".ds, .ds .field, .ds [data-palette]")!;
    expect(ds.vars["--color-paper"]).toBe("var(--bg-surface)");
    expect(ds.vars["--color-ink"]).toBe("var(--fg)");
    expect(ds.vars["--color-verdict-no-fly"]).toBe("var(--verdict-no-fly)");
    // The global scope keeps the old values: the first top-level :root still defines the paper colour as before.
    const root = RULES.find((r) => r.selector === ":root" && "--color-paper" in r.vars)!;
    expect(root.vars["--color-paper"]).toBe("#f5f2ea");
    // And no rule other than the `.ds` family remaps them.
    const remap = RULES.filter((r) => r.vars["--color-paper"]?.startsWith("var(--bg-")).map((r) => r.selector);
    expect(remap).toEqual([".ds, .ds .field, .ds [data-palette]"]);
  });

  it("システムフォントのスタックと、等幅のスタックを `.ds` に置く。Web フォントの名前を持ち込まない", () => {
    const ds = RULES.find((r) => r.selector === ".ds")!;
    expect(ds.vars["--ds-font-sans"]).toMatch(/-apple-system[\s\S]*Hiragino Sans[\s\S]*Yu Gothic UI[\s\S]*Noto Sans JP/);
    expect(ds.vars["--ds-font-mono"]).toMatch(/ui-monospace/);
    expect(ds.vars["--ds-font-sans"]).not.toMatch(/Plex|Fraunces/);
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

  it("実測の記録：ui-direction.md に書かれた主な値と一致する（白文字 / アクセント / 暗の surface）", () => {
    const r = (a: string, b: string): number => Math.round(contrast(a, b) * 100) / 100;
    expect(r("#1d1d1f", "#ffffff")).toBe(16.83);
    expect(r("#636366", "#ffffff")).toBe(5.99);
    expect(r("#0a5fd0", "#ffffff")).toBe(5.9);
    expect(r("#6aa8ff", "#1c1c1e")).toBe(7.01);
    expect(r("#5fc7ba", "#14171c")).toBe(8.87);
  });
});
