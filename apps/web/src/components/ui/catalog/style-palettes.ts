// Style trial palettes (`/ops/design?view=style`). Five palettes, each with a light and a dark base set; the field
// (outdoor) sets are derived from the base sets by `fieldOf`, which pushes every text and line colour until it clears 7:1.
// The numbers are checked in style-palettes.test.ts and reported in docs/design/palettes.md (same functions).
//
// Rules the sets follow (docs/design/ui-direction.md, "style trial"):
//   - one accent per palette; its hue stays away from the verdict hues (red, orange, green); "procedure done" is achromatic,
//     so no blue is left over to collide with an indigo accent;
//   - ground, panel and sunk are close in tone: the soft relief (neumorphism) lives only there. Text, borders, buttons and
//     the focus ring never depend on it.

export type Mode = "light" | "dark";
export type PaletteNo = 1 | 2 | 3 | 4 | 5 | 6;
export type SetKey = `${PaletteNo}-${Mode}${"" | "-field"}`;

export type Base = {
  readonly app: string; // page ground
  readonly panel: string; // panel surface (close to the ground)
  readonly sunk: string; // inputs and switch tracks
  readonly fg: string; // main text
  readonly fg2: string; // secondary text
  readonly fg3: string; // notes
  readonly line: string; // hairline
  readonly lineStrong: string; // control borders
  readonly accent: string; // accent as text / ring / marker
  readonly accentFill: string; // primary button fill
  readonly onAccent: string; // text on the fill
};

export type Palette = {
  readonly id: PaletteNo;
  readonly name: string;
  readonly aim: string;
  readonly light: Base;
  readonly dark: Base;
};

export const PALETTES: readonly Palette[] = [
  {
    id: 1,
    name: "藍と紙",
    aim: "和紙の地に藍染めの一色。日誌らしい落ち着きで、事務所の画面に長く向かえる。",
    light: { app: "#f1ede2", panel: "#f6f3ea", sunk: "#e8e3d5", fg: "#161d2b", fg2: "#383f4d", fg3: "#555c68", line: "#d8d1bd", lineStrong: "#7b7666", accent: "#1c4276", accentFill: "#1c4276", onAccent: "#ffffff" },
    dark: { app: "#0e131b", panel: "#141a24", sunk: "#090d13", fg: "#e9e6dc", fg2: "#c8c6bc", fg3: "#9ba0aa", line: "#252d3b", lineStrong: "#76839a", accent: "#8fb0e6", accentFill: "#8fb0e6", onAccent: "#0a1424" },
  },
  {
    id: 2,
    name: "青磁",
    aim: "青緑のやわらかい地に深い青磁。目に静かで、緑の判定と並べても形と言葉で見分けられる。",
    light: { app: "#e8eeea", panel: "#eff4f1", sunk: "#dde6e1", fg: "#13211d", fg2: "#33443e", fg3: "#4d5f58", line: "#c9d5ce", lineStrong: "#6b8077", accent: "#0f6064", accentFill: "#0f6064", onAccent: "#ffffff" },
    dark: { app: "#0c1513", panel: "#121d1a", sunk: "#080e0d", fg: "#e2ebe7", fg2: "#c0cdc7", fg3: "#92a39c", line: "#22322e", lineStrong: "#6f8a81", accent: "#6fc9c4", accentFill: "#6fc9c4", onAccent: "#06191a" },
  },
  {
    id: 3,
    name: "夜間飛行",
    aim: "暗い地にシアン一色。夕暮れ以降と暗い格納庫での確認が主。明るい側も持つ。",
    light: { app: "#e5edf0", panel: "#edf3f5", sunk: "#d9e3e7", fg: "#0f1a20", fg2: "#2f3f47", fg3: "#4a5c65", line: "#c3d2d8", lineStrong: "#667f8b", accent: "#0b5d77", accentFill: "#0b5d77", onAccent: "#ffffff" },
    dark: { app: "#080f14", panel: "#0e1820", sunk: "#05090c", fg: "#e1ecf0", fg2: "#b8c9cf", fg3: "#8aa0a9", line: "#1a2a33", lineStrong: "#5f8190", accent: "#4ec6dd", accentFill: "#4ec6dd", onAccent: "#04141a" },
  },
  {
    id: 4,
    name: "白磁と鉄紺",
    aim: "ほぼモノクロ。白い地に鉄紺の文字と線だけ。装飾を引いて、判定の色を最も目立たせる。",
    light: { app: "#f3f4f5", panel: "#f9fafa", sunk: "#eaecee", fg: "#111826", fg2: "#323947", fg3: "#535b6a", line: "#d3d7dc", lineStrong: "#6e7787", accent: "#1a2a4a", accentFill: "#1a2a4a", onAccent: "#ffffff" },
    dark: { app: "#0f1217", panel: "#161a21", sunk: "#0a0c10", fg: "#eceef2", fg2: "#c9cdd5", fg3: "#9aa1ae", line: "#262b35", lineStrong: "#7a8497", accent: "#b9c7e2", accentFill: "#b9c7e2", onAccent: "#0d1626" },
  },
  {
    id: 5,
    name: "洋紅の航空図",
    aim: "航空図が飛行場に使う洋紅を、墨のように沈めて一点の印にする。生成りの地に意外性が出る。",
    light: { app: "#f3eee5", panel: "#f8f4ec", sunk: "#eae3d6", fg: "#201a1d", fg2: "#41383d", fg3: "#5f5459", line: "#dbd1c3", lineStrong: "#82766f", accent: "#74285f", accentFill: "#74285f", onAccent: "#ffffff" },
    dark: { app: "#141015", panel: "#1b161c", sunk: "#0e0b0f", fg: "#eee8e4", fg2: "#cfc7c4", fg3: "#a39a9d", line: "#2c242d", lineStrong: "#8b7a89", accent: "#e39ac6", accentFill: "#e39ac6", onAccent: "#240d1b" },
  },
  {
    id: 6,
    name: "生成りと銅",
    aim: "生成りの地に炭色の文字、銅の短い線を印にする。余白を広くとった、落ち着いた事務所向け。",
    light: { app: "#f7f7f2", panel: "#fbfbf8", sunk: "#ebebe3", fg: "#22211e", fg2: "#42403b", fg3: "#5f5d56", line: "#dcdbd1", lineStrong: "#827f77", accent: "#9b541c", accentFill: "#9b541c", onAccent: "#ffffff" },
    dark: { app: "#151412", panel: "#1c1b18", sunk: "#0f0e0d", fg: "#ece9e2", fg2: "#cac6bd", fg3: "#9d998f", line: "#2b2a26", lineStrong: "#86827a", accent: "#eaa06a", accentFill: "#eaa06a", onAccent: "#2a1204" },
  },
];

/** Verdict ink colours, shared by the five palettes. "Procedure done" is achromatic on purpose (see above). */
export const VERDICT_KEYS = ["noFly", "needs", "done", "clear", "unknown"] as const;
export type VerdictKey = (typeof VERDICT_KEYS)[number];
export const VERDICT_BASE: Readonly<Record<Mode, Readonly<Record<VerdictKey, string>>>> = {
  light: { noFly: "#a8222c", needs: "#756200", done: "#3b4350", clear: "#2a6a2f", unknown: "#575f6c" },
  dark: { noFly: "#f28a90", needs: "#e6c64a", done: "#cdd4df", clear: "#86c88a", unknown: "#adb3bd" },
};

/** OKLCH hue (degrees) and chroma of a colour, to keep the accent away from the verdict inks. */
export function oklch(hex: string): { readonly h: number; readonly c: number } {
  const [r, g, b] = toRgb(hex).map((v) => lin(v)) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { h: ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360, c: Math.hypot(a, bb) };
}

// ---- colour maths (WCAG 2.x relative luminance) ----
type RGB = readonly [number, number, number];
export const toRgb = (hex: string): RGB => {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
};
export const toHex = ([r, g, b]: RGB): string =>
  "#" + [r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("");
const lin = (v: number): number => {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
export const luminance = (hex: string): number => {
  const [r, g, b] = toRgb(hex);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};
export const contrast = (a: string, b: string): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};
/** p = share of `b` in the mix (0..1). */
export const mix = (a: string, b: string, p: number): string => {
  const x = toRgb(a);
  const y = toRgb(b);
  return toHex([x[0] + (y[0] - x[0]) * p, x[1] + (y[1] - x[1]) * p, x[2] + (y[2] - x[2]) * p]);
};
const minContrast = (c: string, bgs: readonly string[]): number => Math.min(...bgs.map((b) => contrast(c, b)));

/** Move `c` towards `to` (black or white) in small steps until it clears `target` against every background. */
export function ensure(c: string, bgs: readonly string[], target: number, to: "#000000" | "#ffffff"): string {
  let p = 0;
  let out = c;
  while (minContrast(out, bgs) < target && p < 1) {
    p += 0.01;
    out = mix(c, to, p);
  }
  return out;
}

/** Share of `toward` mixed into `bg` so that the result has about `ratio` contrast against `bg` (bisection). */
function tintFor(bg: string, toward: string, ratio: number): string {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (contrast(mix(bg, toward, mid), bg) < ratio) lo = mid;
    else hi = mid;
  }
  return mix(bg, toward, hi);
}

export type Resolved = {
  readonly key: SetKey;
  readonly mode: Mode;
  readonly field: boolean;
  readonly base: Base;
  readonly tokens: Readonly<Record<string, string>>;
  /** verdict ink and its tint, for each step */
  readonly verdict: Readonly<Record<VerdictKey, { readonly fg: string; readonly tint: string }>>;
  /** contour line colours */
  readonly art: { readonly line: string; readonly index: string };
  readonly accentFillHover: string;
  readonly accentFillActive: string;
};

/** Field (outdoor) variant of a base set: stronger ground, text and lines, no relief. */
function fieldOf(b: Base, mode: Mode): Base {
  const dark = mode === "dark";
  const to = dark ? "#ffffff" : "#000000";
  const app = dark ? mix(b.app, "#000000", 0.55) : mix(b.app, "#ffffff", 0.6);
  const panel = dark ? mix(b.panel, "#000000", 0.25) : mix(b.panel, "#ffffff", 0.85);
  const sunk = dark ? mix(b.sunk, "#ffffff", 0.07) : mix(b.sunk, "#000000", 0.0);
  const bgs = [app, panel, sunk];
  // text: 7:1 or better on every ground; the main text is pushed further (about 12:1)
  const fg = ensure(b.fg, bgs, 12, to);
  const fg2 = ensure(b.fg2, bgs, 8.5, to);
  const fg3 = ensure(b.fg3, bgs, 7.2, to);
  const accent = ensure(b.accent, bgs, 7.2, to);
  const lineStrong = ensure(b.lineStrong, bgs, 4.6, to);
  const line = ensure(b.line, bgs, 1.6, to);
  // a fill of the accent whose text clears 7:1 (the fill moves away from its text colour)
  const onAccent = b.onAccent;
  const accentFill = ensure(b.accentFill, [onAccent], 7.2, to);
  return { app, panel, sunk, fg, fg2, fg3, line, lineStrong, accent, accentFill, onAccent };
}

export function resolveSet(id: PaletteNo, mode: Mode, field: boolean): Resolved {
  const pal = PALETTES.find((p) => p.id === id)!;
  const base = field ? fieldOf(pal[mode], mode) : pal[mode];
  const dark = mode === "dark";
  const to = dark ? "#ffffff" : "#000000";
  const bgs = [base.app, base.panel, base.sunk];

  const verdict = {} as Record<VerdictKey, { fg: string; tint: string }>;
  for (const k of VERDICT_KEYS) {
    const raw = VERDICT_BASE[mode][k];
    // the tint is the verdict ink mixed into the panel; the ink must clear its target on the tint too
    const tint0 = mix(base.panel, raw, dark ? 0.14 : 0.1);
    const fg = ensure(raw, [...bgs, tint0], field ? 7.2 : 4.6, to);
    verdict[k] = { fg, tint: tint0 };
  }

  const artRatio = field ? 1.22 : 1.3;
  const art = { line: tintFor(base.app, base.accent, artRatio), index: tintFor(base.app, base.accent, field ? 1.45 : 1.62) };

  // soft relief: highlight and shade for panels and sunken inputs (opaque colours, no translucency)
  const hi = dark ? mix(base.panel, "#ffffff", 0.07) : mix(base.panel, "#ffffff", 0.9);
  const lo = dark ? mix(base.app, "#000000", 0.55) : mix(base.app, base.fg, 0.13);
  const hiSunk = dark ? mix(base.sunk, "#ffffff", 0.06) : mix(base.sunk, "#ffffff", 0.85);
  const loSunk = dark ? mix(base.sunk, "#000000", 0.6) : mix(base.sunk, base.fg, 0.2);

  const accentFillHover = mix(base.accentFill, base.fg, 0.16);
  const accentFillActive = mix(base.accentFill, base.fg, 0.3);
  // dark: the fill is light, so hover/pressed go towards the ground instead (keeps the dark text legible)
  const hoverDark = mix(base.accentFill, "#ffffff", 0.14);
  const activeDark = mix(base.accentFill, "#ffffff", 0.28);

  const key = `${id}-${mode}${field ? "-field" : ""}` as SetKey;
  return {
    key,
    mode,
    field,
    base,
    verdict,
    art,
    accentFillHover: dark ? hoverDark : accentFillHover,
    accentFillActive: dark ? activeDark : accentFillActive,
    tokens: {
      "--s-app": base.app,
      "--s-panel": base.panel,
      "--s-sunk": base.sunk,
      "--s-fg": base.fg,
      "--s-fg2": base.fg2,
      "--s-fg3": base.fg3,
      "--s-line": base.line,
      "--s-line-strong": base.lineStrong,
      "--s-accent": base.accent,
      "--s-accent-fill": base.accentFill,
      "--s-accent-hover": dark ? hoverDark : accentFillHover,
      "--s-accent-active": dark ? activeDark : accentFillActive,
      "--s-on-accent": base.onAccent,
      "--s-accent-soft": mix(base.panel, base.accent, dark ? 0.16 : 0.1),
      "--s-art": art.line,
      "--s-art-index": art.index,
      "--s-relief-hi": hi,
      "--s-relief-lo": lo,
      "--s-sunk-hi": hiSunk,
      "--s-sunk-lo": loSunk,
      "--s-v-nofly": verdict.noFly.fg,
      "--s-v-nofly-bg": verdict.noFly.tint,
      "--s-v-needs": verdict.needs.fg,
      "--s-v-needs-bg": verdict.needs.tint,
      "--s-v-done": verdict.done.fg,
      "--s-v-done-bg": verdict.done.tint,
      "--s-v-clear": verdict.clear.fg,
      "--s-v-clear-bg": verdict.clear.tint,
      "--s-v-unknown": verdict.unknown.fg,
      "--s-v-unknown-bg": verdict.unknown.tint,
    },
  };
}

export const ALL_KEYS: readonly SetKey[] = ([1, 2, 3, 4, 5, 6] as const).flatMap((id) =>
  (["light", "dark"] as const).flatMap((m) => [`${id}-${m}` as SetKey, `${id}-${m}-field` as SetKey]),
);

/** CSS text that defines every set: `.sty[data-set="2-dark"] { --s-app: ...; }`. All values are fixed hex strings. */
export function paletteCss(): string {
  return ALL_KEYS.map((k) => {
    const [id, mode, f] = k.split("-") as [string, Mode, string | undefined];
    const r = resolveSet(Number(id) as PaletteNo, mode, f === "field");
    const body = Object.entries(r.tokens)
      .map(([n, v]) => `${n}:${v}`)
      .join(";");
    return `.sty[data-set="${k}"]{${body}}`;
  }).join("\n");
}
