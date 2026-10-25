// Prints the contrast tables of the style trial palettes as Markdown (docs/design/palettes.md, section "実測表").
// Run: pnpm exec tsx scripts/style-palette-report.ts > /tmp/tables.md
import { auditSet, hueGaps } from "../apps/web/src/components/ui/catalog/style-audit";
import { PALETTES, VERDICT_BASE, resolveSet } from "../apps/web/src/components/ui/catalog/style-palettes";

const MODES = [
  ["明", "light", false],
  ["暗", "dark", false],
  ["現場・明", "light", true],
  ["現場・暗", "dark", true],
] as const;

const out: string[] = [];
out.push("## 実測表（WCAG 2.x 相対輝度。目標は各行の「要」）\n");
out.push("数字は実測のコントラスト比。目標を下回った所には「×」を付ける（本表では 0 件）。通常の目標は、文字 4.5、非文字 3。現場の目標は、文字 7、非文字 4.5。\n");
for (const p of PALETTES) {
  out.push(`### ${p.id}. ${p.name}\n`);
  out.push(`${p.aim}\n`);
  const sets = MODES.map(([, m, f]) => resolveSet(p.id, m, f));
  out.push("| 色 | 明 | 暗 | 現場・明 | 現場・暗 |\n|---|---|---|---|---|");
  const row = (n: string, f: (s: (typeof sets)[number]) => string): void => void out.push(`| ${n} | ${sets.map(f).join(" | ")} |`);
  row("地", (s) => s.base.app);
  row("面", (s) => s.base.panel);
  row("くぼみ", (s) => s.base.sunk);
  row("文字", (s) => s.base.fg);
  row("アクセント", (s) => s.base.accentFill);
  row("飛行不可", (s) => s.verdict.noFly.fg);
  row("要手続き", (s) => s.verdict.needs.fg);
  row("手続き済み", (s) => s.verdict.done.fg);
  row("手続き不要", (s) => s.verdict.clear.fg);
  out.push("");
  const rows = sets.map((s) => auditSet(s));
  out.push("| 項目 | 要（通常／現場） | 明 | 暗 | 現場・明 | 現場・暗 |\n|---|---|---|---|---|---|");
  rows[0]!.forEach((r0, i) => {
    const cells = rows.map((rs) => `${rs[i]!.ratio.toFixed(2)}${rs[i]!.pass ? "" : " ×"}`);
    const need = i === 0 ? "" : "";
    void need;
    out.push(`| ${r0.group}：${r0.label} | ${r0.need >= 7 ? "7" : r0.need}／${rows[2]![i]!.need} | ${cells.join(" | ")} |`);
  });
  const g = hueGaps(p.id);
  out.push(`\nアクセントの色相（OKLCH）：明 ${g.light.accent.h}°・暗 ${g.dark.accent.h}°。判定色との差：飛行不可 ${g.light.gap.noFly}°／${g.dark.gap.noFly}°、要手続き ${g.light.gap.needs}°／${g.dark.gap.needs}°、手続き不要 ${g.light.gap.clear}°／${g.dark.gap.clear}°（明／暗）。\n`);
}
out.push("## 判定色（5 パレット共通の基準色）\n");
out.push("| 段 | 明 | 暗 |\n|---|---|---|");
for (const [k, n] of [["noFly", "飛行不可"], ["needs", "要手続き"], ["done", "手続き済み"], ["clear", "手続き不要"], ["unknown", "判定不能"]] as const) out.push(`| ${n} | ${VERDICT_BASE.light[k]} | ${VERDICT_BASE.dark[k]} |`);
console.log(out.join("\n"));
