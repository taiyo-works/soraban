// Contrast audit of the style trial palettes. Used by style-palettes.test.ts (pass/fail) and by
// scripts/style-palette-report.ts (the tables in docs/design/palettes.md). Same numbers in both.
import { ALL_KEYS, PALETTES, VERDICT_BASE, VERDICT_KEYS, contrast, oklch, resolveSet, type Mode, type PaletteNo, type Resolved, type SetKey } from "./style-palettes";

export type Row = { readonly group: string; readonly label: string; readonly fg: string; readonly bg: string; readonly ratio: number; readonly need: number; readonly pass: boolean };

const VERDICT_LABEL: Record<(typeof VERDICT_KEYS)[number], string> = { noFly: "飛行不可", needs: "要手続き", done: "手続き済み", clear: "手続き不要", unknown: "判定不能" };

export function auditSet(r: Resolved): Row[] {
  const b = r.base;
  const text = r.field ? 7 : 4.5;
  const nontext = r.field ? 4.5 : 3;
  const rows: Row[] = [];
  const add = (group: string, label: string, fg: string, bg: string, need: number): void => {
    const ratio = contrast(fg, bg);
    rows.push({ group, label, fg, bg, ratio, need, pass: ratio >= need - 1e-9 });
  };
  // text on grounds
  add("文字", "本文 / 地", b.fg, b.app, text);
  add("文字", "本文 / パネル", b.fg, b.panel, text);
  add("文字", "本文 / くぼみ（入力欄）", b.fg, b.sunk, text);
  add("文字", "第二の文字 / パネル", b.fg2, b.panel, text);
  add("文字", "注釈 / パネル", b.fg3, b.panel, text);
  add("文字", "注釈 / くぼみ", b.fg3, b.sunk, text);
  add("文字", "注釈 / 地", b.fg3, b.app, text);
  // accent
  add("アクセント", "アクセント文字 / 地", b.accent, b.app, text);
  add("アクセント", "アクセント文字 / パネル", b.accent, b.panel, text);
  add("アクセント", "アクセント文字 / くぼみ", b.accent, b.sunk, text);
  add("アクセント", "主ボタンの文字 / 塗り", b.onAccent, b.accentFill, text);
  add("アクセント", "主ボタンの文字 / 押下", b.onAccent, r.accentFillActive, text);
  add("アクセント", "主ボタンの文字 / ホバー", b.onAccent, r.accentFillHover, text);
  add("アクセント", "主ボタンの塗り / パネル", b.accentFill, b.panel, nontext);
  add("アクセント", "フォーカスの輪 / 地", b.accent, b.app, nontext);
  add("アクセント", "フォーカスの輪 / くぼみ", b.accent, b.sunk, nontext);
  // component borders
  add("押せる部品の境界", "枠線 / パネル", b.lineStrong, b.panel, nontext);
  add("押せる部品の境界", "枠線 / 地", b.lineStrong, b.app, nontext);
  add("押せる部品の境界", "枠線 / くぼみ", b.lineStrong, b.sunk, nontext);
  // verdicts
  for (const k of VERDICT_KEYS) {
    const v = r.verdict[k];
    add("判定色", `${VERDICT_LABEL[k]}の文字 / パネル`, v.fg, b.panel, text);
    add("判定色", `${VERDICT_LABEL[k]}の文字 / 判定の面`, v.fg, v.tint, text);
    add("判定色", `${VERDICT_LABEL[k]}の文字 / くぼみ`, v.fg, b.sunk, text);
  }
  // art: the contours are decoration; only the main text may cross them
  add("アート", "本文 / 等高線（文字が線をまたぐ最悪値）", b.fg, r.art.index, 7);
  rows.push({ group: "アート", label: "等高線 / 地（目に見える下限と上限の確認）", fg: r.art.line, bg: b.app, ratio: contrast(r.art.line, b.app), need: 1.15, pass: contrast(r.art.line, b.app) >= 1.15 && contrast(r.art.index, b.app) <= 2.2 });
  return rows;
}

export function auditAll(): { readonly key: SetKey; readonly rows: Row[] }[] {
  return ALL_KEYS.map((key) => {
    const [id, mode, f] = key.split("-") as [string, Mode, string | undefined];
    return { key, rows: auditSet(resolveSet(Number(id) as PaletteNo, mode, f === "field")) };
  });
}

export { PALETTES };

/** Distance in OKLCH hue (degrees, 0..180) between a palette's accent and each verdict ink, for light and dark base sets. */
export function hueGaps(id: PaletteNo): Record<Mode, { readonly accent: { readonly h: number; readonly c: number }; readonly gap: Readonly<Record<"noFly" | "needs" | "clear", number>> }> {
  const pal = PALETTES.find((p) => p.id === id)!;
  const out = {} as Record<Mode, { accent: { h: number; c: number }; gap: Record<"noFly" | "needs" | "clear", number> }>;
  for (const mode of ["light", "dark"] as const) {
    const a = oklch(pal[mode].accentFill);
    const d = (hex: string): number => {
      const x = Math.abs(a.h - oklch(hex).h) % 360;
      return Math.round(x > 180 ? 360 - x : x);
    };
    out[mode] = { accent: { h: Math.round(a.h), c: Math.round(a.c * 1000) / 1000 }, gap: { noFly: d(VERDICT_BASE[mode].noFly), needs: d(VERDICT_BASE[mode].needs), clear: d(VERDICT_BASE[mode].clear) } };
  }
  return out;
}
