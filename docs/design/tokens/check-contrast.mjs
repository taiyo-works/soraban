// 実行: node docs/design/tokens/check-contrast.mjs [--md]
// soraban-tokens.css を読み、明・暗・現場（明/暗）の 4 通りでコントラストと寸法の下限を検査する。
// 外部通信・依存なし。満たさない組があれば終了コード 1。--md は design-system.md に貼る表を出す。
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const css = fs.readFileSync(path.join(here, "../../../apps/web/src/app/soraban-tokens.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

// --- 最小のパーサ：ルール { selector, media, decls } を平らに取り出す（入れ子は @media の 1 段のみ） ---
function parse(src) {
  const rules = [];
  const walk = (text, media) => {
    let i = 0;
    while (i < text.length) {
      const open = text.indexOf("{", i);
      if (open < 0) break;
      const head = text.slice(i, open).trim();
      let depth = 1, j = open + 1;
      while (depth && j < text.length) { if (text[j] === "{") depth++; else if (text[j] === "}") depth--; j++; }
      const body = text.slice(open + 1, j - 1);
      if (head.startsWith("@media")) walk(body, head);
      else {
        const decls = {};
        for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) decls[m[1]] = m[2].trim();
        rules.push({ selector: head.replace(/\s+/g, " "), media, decls });
      }
      i = j;
    }
  };
  walk(src, null);
  return rules;
}
const rules = parse(css);
const pick = (selector, mediaPart) => {
  const r = rules.find((x) => x.selector === selector && (mediaPart ? x.media?.includes(mediaPart) : !x.media));
  if (!r) throw new Error(`セレクタが見つからない: ${selector}`);
  return r.decls;
};
const S = {
  root: pick(":root"),
  field: pick(':root[data-mode="field"]'),
  darkMedia: pick(':root:not([data-theme="light"])', "dark"),
  darkMediaField: pick(':root:not([data-theme="light"])[data-mode="field"]', "dark"),
  darkForced: pick(':root[data-theme="dark"]'),
  darkForcedField: pick(':root[data-theme="dark"][data-mode="field"]'),
};
const same = (a, b) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());
const problems = [];
if (!same(S.darkMedia, S.darkForced)) problems.push("暗（OS 設定）と暗（強制）の宣言が一致しない");
if (!same(S.darkMediaField, S.darkForcedField)) problems.push("暗の現場（OS 設定）と暗の現場（強制）が一致しない");

const MODES = [
  ["明", [S.root]],
  ["暗", [S.root, S.darkMedia]],
  ["現場・明", [S.root, S.field]],
  ["現場・暗", [S.root, S.field, S.darkMedia, S.darkMediaField]],
];
const resolve = (layers) => {
  const t = Object.assign({}, ...layers);
  return t;
};

// --- 色 ---
const hex = (s) => { const m = /^#([0-9a-f]{6})$/i.exec(s); if (!m) throw new Error("6 桁の HEX ではない: " + s); return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)); };
const lum = (h) => { const [r, g, b] = hex(h).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

// [区分, 名前, 前景, 背景, 通常の要, 現場の要]。要が null のものは実測の記録だけ
const V = ["no", "needs", "done", "none", "unknown"];
const VN = { no: "飛行不可", needs: "要手続き", done: "手続き済み・情報", none: "手続き不要", unknown: "判定不能" };
const pairs = [];
const P = (g, n, fg, bg, nr, fr) => pairs.push({ g, n, fg, bg, nr, fr });
for (const bg of ["base", "surface", "sunken"]) P("文字", `本文 / ${bg}`, "ink", bg, 4.5, 7);
for (const bg of ["surface", "sunken"]) P("文字", `第二の文字 / ${bg}`, "ink-2", bg, 4.5, 7);
for (const bg of ["base", "surface", "sunken"]) P("文字", `注釈・プレースホルダ / ${bg}`, "ink-3", bg, 4.5, 7);
for (const bg of ["base", "surface", "sunken"]) P("アクセント", `銅の文字・リンク / ${bg}`, "copper-text", bg, 4.5, 7);
P("アクセント", "主ボタンの文字 / 橙の面", "on-orange", "orange", 4.5, 7);
P("アクセント", "主ボタン ホバー：文字 / 明るい橙", "on-orange", "orange-hover", 4.5, 7);
P("アクセント", "主ボタン 押下：橙の文字 / 暗い面", "orange", "on-orange", 4.5, 7);
P("アクセント", "主ボタンの境 / 地", "edge", "base", 3, 4.5);
P("アクセント", "トーストの文字 / 面", "inverse-fg", "inverse-bg", 4.5, 7);
for (const bg of ["base", "surface", "sunken"]) P("アクセント", `フォーカスの輪 / ${bg}`, "focus", bg, 3, 4.5);
for (const bg of ["base", "surface"]) P("アクセント", `銅の線（現在地の印・短い線）/ ${bg}`, "copper", bg, 3, 4.5);
for (const bg of ["base", "surface", "sunken"]) P("押せる部品", `境（ボタン・入力欄・チェック枠）/ ${bg}`, "edge", bg, 3, 4.5);
for (const v of V) {
  P("判定", `${VN[v]}：塗りの上の文字`, `v-${v}-on`, `v-${v}-fill`, 7, 7);
  P("判定", `${VN[v]}：文字・線 / 面`, `v-${v}-fg`, "surface", 4.5, 7);
  P("判定", `${VN[v]}：文字・線 / くぼみ`, `v-${v}-fg`, "sunken", 4.5, 7);
  // 琥珀の塗りは面に対して 1.8:1 しかないので、印は必ず fg の 2px 枠で囲む（枠は上の「文字・線 / 面」で検査済み）
  if (v !== "needs") P("判定", `${VN[v]}：塗り / 面（印の輪郭）`, `v-${v}-fill`, "surface", 3, 4.5);
}
P("アート", "本文 / 等高線の主線（線をまたぐ最悪値）", "ink", "contour-major", 7, 7);
P("無効", "無効の文字 / くぼみ（免除だが目標）", "disabled-fg", "sunken", 3, 4.5);
P("記録のみ", "罫（区切り専用）/ 地", "rule", "base", null, 3);
P("記録のみ", "細い罫 / 地", "rule-soft", "base", null, null);
P("記録のみ", "橙の面 / 地（面専用。線と文字には使わない）", "orange", "base", null, null);
P("記録のみ", "等高線の細線 / 地（1.08〜1.5 の帯に入る）", "contour", "base", null, null);

const results = [];
for (const [mode, layers] of MODES) {
  const t = resolve(layers);
  const col = (k) => { const v = t["--sb-" + k]; if (!v) throw new Error(`${mode}: --sb-${k} がない`); return v; };
  const isField = mode.startsWith("現場");
  for (const p of pairs) {
    const r = ratio(col(p.fg), col(p.bg));
    const need = isField ? p.fr : p.nr;
    results.push({ ...p, mode, ratio: r, need, ok: need == null || r >= need - 1e-9 });
  }
  // 帯の確認（等高線は薄すぎても濃すぎてもいけない）
  const band = ratio(col("contour"), col("base"));
  if (band < 1.08 || band > 1.5) problems.push(`${mode}: 等高線の細線 / 地 = ${band.toFixed(2)}（1.08〜1.5 の外）`);
  // 寸法
  const px = (k) => parseFloat(t["--sb-" + k]);
  const hitMin = isField ? [56, 64] : [48, 52];
  if (px("hit") < hitMin[0]) problems.push(`${mode}: --sb-hit ${px("hit")}px < ${hitMin[0]}`);
  if (px("hit-primary") < hitMin[1]) problems.push(`${mode}: --sb-hit-primary ${px("hit-primary")}px < ${hitMin[1]}`);
  if (px("fs-note") < (isField ? 14 : 12)) problems.push(`${mode}: --sb-fs-note ${px("fs-note")}px が下限未満`);
}
const fails = results.filter((r) => !r.ok);
const f2 = (n) => n.toFixed(2);

if (process.argv.includes("--md")) {
  const modes = MODES.map((m) => m[0]);
  const tok = (layers) => Object.assign({}, ...layers);
  const T = Object.fromEntries(MODES.map(([m, l]) => [m, tok(l)]));
  const names = [["base", "地"], ["surface", "面"], ["sunken", "くぼみ"], ["ink", "文字"], ["ink-2", "第二の文字"], ["ink-3", "注釈"], ["rule", "罫"], ["rule-soft", "細い罫"], ["edge", "押せる部品の境"], ["orange", "橙（面専用）"], ["on-orange", "橙の上の文字"], ["copper", "銅（線）"], ["copper-text", "銅（文字）"], ["focus", "フォーカスの輪"], ["contour", "等高線（細線）"], ["contour-major", "等高線（主線）"]];
  const out = [];
  out.push("| トークン | 意味 | 明 | 暗 | 現場・明 | 現場・暗 |", "|---|---|---|---|---|---|");
  for (const [k, n] of names) out.push(`| \`--sb-${k}\` | ${n} | ${modes.map((m) => "`" + T[m]["--sb-" + k] + "`").join(" | ")} |`);
  for (const v of V) for (const [s, n] of [["fill", "塗り"], ["on", "塗りの上の文字"], ["fg", "文字・線"]]) out.push(`| \`--sb-v-${v}-${s}\` | ${VN[v]}：${n} | ${modes.map((m) => "`" + T[m][`--sb-v-${v}-${s}`] + "`").join(" | ")} |`);
  console.log(out.join("\n"));
  console.log("\n@@");
  const rows = [];
  rows.push("| 区分 | 組 | 要（通常／現場） | 明 | 暗 | 現場・明 | 現場・暗 |", "|---|---|---|---|---|---|---|");
  for (const p of pairs) {
    const cells = modes.map((m) => { const r = results.find((x) => x.n === p.n && x.g === p.g && x.mode === m); return f2(r.ratio) + (r.ok ? "" : " ×"); });
    rows.push(`| ${p.g} | ${p.n} | ${p.nr ?? "—"}／${p.fr ?? "—"} | ${cells.join(" | ")} |`);
  }
  console.log(rows.join("\n"));
  console.log(`\n@@\n検査した組：${pairs.length} × 4 通り = ${results.length}。満たさない組：${fails.length}。`);
} else {
  for (const r of fails) console.log(`NG  ${r.mode}  ${r.g}  ${r.n}  ${f2(r.ratio)} < ${r.need}  (--sb-${r.fg} / --sb-${r.bg})`);
  const worst = (g) => { const xs = results.filter((r) => r.need && r.g === g); return xs.reduce((a, b) => (b.ratio / b.need < a.ratio / a.need ? b : a)); };
  for (const g of ["文字", "アクセント", "押せる部品", "判定", "アート"]) { const w = worst(g); console.log(`最小余裕 ${g}: ${f2(w.ratio)}（要 ${w.need}）${w.mode} ${w.n}`); }
}
for (const p of problems) console.log("NG  " + p);
if (!process.argv.includes("--md")) console.log(`組 ${pairs.length} × 4 通り = ${results.length} 件を検査。満たさない: ${fails.length + problems.length}`);
process.exit(fails.length + problems.length ? 1 : 0);
