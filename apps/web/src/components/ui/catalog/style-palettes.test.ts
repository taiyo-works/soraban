// Style trial (`/ops/design?view=style`): the six palettes clear the contrast targets in every set (light, dark, and the
// field variants of each), the accent keeps its distance from the verdict inks, the contour generator is deterministic,
// and the stylesheet keeps to the rules of the direction (no rounded blocks, no gradients, no glass, everything under `.sty`).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { auditAll, hueGaps } from "./style-audit";
import { contours } from "./contour";
import { HERO_SPEC } from "./style-art";
import { ALL_KEYS, PALETTES, paletteCss, resolveSet } from "./style-palettes";
import { DEFAULT_STYLE_CONFIG, isStyleView, parseStyleConfig, styleHref } from "./style-config";

describe("コントラスト（6 パレット × 明・暗 × 通常・現場）", () => {
  it("24 の組がすべて、文字 4.5:1（現場 7:1）・非文字 3:1（現場 4.5:1）を満たす", () => {
    expect(ALL_KEYS).toHaveLength(24);
    const failures = auditAll().flatMap((s) => s.rows.filter((r) => !r.pass).map((r) => `${s.key} ${r.label} ${r.ratio.toFixed(2)} < ${r.need}`));
    expect(failures).toEqual([]);
  });
  it("アクセントの色相は、飛行不可・要手続き・手続き不要の文字色から 30 度以上離れている（OKLCH）", () => {
    for (const p of PALETTES) {
      const g = hueGaps(p.id);
      for (const mode of ["light", "dark"] as const) for (const [k, v] of Object.entries(g[mode].gap)) expect(v, `${p.id} ${mode} ${k}`).toBeGreaterThanOrEqual(30);
    }
  });
  it("パレットは 6 つで、名前と狙いがある。現場の色は通常より濃く（明）・明るく（暗）なる", () => {
    expect(PALETTES.map((p) => p.id)).toEqual([1, 2, 3, 4, 5, 6]);
    for (const p of PALETTES) {
      expect(p.name.length).toBeGreaterThan(0);
      expect(p.aim.length).toBeGreaterThan(10);
    }
  });
  it("パレットの CSS は固定の 16 進の色だけ（半透明・グラデーションなし）", () => {
    const css = paletteCss();
    expect(css).not.toMatch(/rgba?\(|gradient|hsla?\(|opacity/);
    expect(css.match(/\.sty\[data-set=/g)).toHaveLength(24);
    expect(resolveSet(6, "light", false).tokens["--s-accent"]).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe("等高線の生成", () => {
  it("同じ種からは同じ絵になり、索引線（5 本ごと）と標高の数字がある", () => {
    const a = contours(HERO_SPEC);
    const b = contours(HERO_SPEC);
    expect(a).toEqual(b);
    expect(a.lines.length).toBeGreaterThan(20);
    expect(a.lines.some((l) => l.index)).toBe(true);
    expect(a.labels.length).toBeGreaterThan(0);
    expect(contours({ ...HERO_SPEC, seed: 22 }).lines.map((l) => l.d)).not.toEqual(a.lines.map((l) => l.d));
  });
});

describe("見本の設定（クエリ）", () => {
  it("view=style だけが見本の対象。未知の値は既定に戻る", () => {
    expect(isStyleView({ view: "style" })).toBe(true);
    expect(isStyleView({ view: "menu" })).toBe(false);
    expect(isStyleView({})).toBe(false);
    expect(parseStyleConfig({ palette: "9", theme: "x", layout: "y", screen: "z" })).toEqual(DEFAULT_STYLE_CONFIG);
    expect(parseStyleConfig({ palette: "6", theme: "dark", field: "1", layout: "all", screen: "home" })).toEqual({ palette: 6, theme: "dark", field: true, layout: "all", screen: "home" });
  });
  it("リンクは既定の値を省く", () => {
    expect(styleHref(DEFAULT_STYLE_CONFIG, {})).toBe("/ops/design?view=style");
    expect(styleHref(DEFAULT_STYLE_CONFIG, { palette: 4, theme: "dark" })).toBe("/ops/design?view=style&palette=4&theme=dark");
    expect(styleHref(DEFAULT_STYLE_CONFIG, { layout: "all", screen: "parts", field: true })).toBe("/ops/design?view=style&field=1&layout=all&screen=parts");
  });
});

describe("style-trial.css の約束", () => {
  const css = readFileSync(new URL("./style-trial.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  it("角丸は 0。丸が許されるのは、ラジオ・件数・位置の点だけ", () => {
    const radii = [...css.matchAll(/border-radius:\s*([^;]+);/g)].map((m) => m[1]!.trim());
    expect(radii.filter((r) => r !== "0")).toEqual(["50%", "50%", "999px"]);
  });
  it("グラデーション・ぼかし（ガラス風）・半透明の背景を使わない", () => {
    expect(css).not.toMatch(/gradient\(|backdrop-filter|rgba\(|hsla\(/);
    expect(css.replace(/opacity:\s*1;/g, "")).not.toMatch(/opacity:/);
  });
  it("すべての規則が .sty の範囲の中（実画面・ほかの見本に効かない）", () => {
    const heads = [...css.replace(/@[^{;]*\{/g, "").matchAll(/(^|\})\s*([^{}]+)\{/g)].map((m) => m[2]!.trim());
    // split a selector list at the commas that are not inside parentheses
    const split = (h: string): string[] => {
      const out: string[] = [];
      let depth = 0;
      let cur = "";
      for (const ch of h) {
        if (ch === "(") depth++;
        if (ch === ")") depth--;
        if (ch === "," && depth === 0) {
          out.push(cur.trim());
          cur = "";
        } else cur += ch;
      }
      return [...out, cur.trim()];
    };
    const bad = heads.flatMap(split).filter((sel) => !sel.includes(".sty") && !/^\d+%$/.test(sel) && sel !== "from" && sel !== "to");
    expect(bad).toEqual([]);
  });
  it("prefers-contrast・forced-colors・reduced-motion に応える", () => {
    expect(css).toMatch(/prefers-contrast:\s*more/);
    expect(css).toMatch(/forced-colors:\s*active/);
    expect(css).toMatch(/prefers-reduced-motion:\s*reduce/);
  });
});
