// 実行: node docs/design/tokens-v2/check-contrast-v2.mjs [--md]
// soraban-tokens-v2.css を読み、通常と現場の 2 通りでコントラストと寸法の下限を検査する。満たさない組があれば終了コード 1。
// 参考：docs/design/tokens/check-contrast.mjs（v1。暗の 2 通りは v2 では未定義のため含めない）。外部通信・依存なし。
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const css = fs.readFileSync(path.join(here, "soraban-tokens-v2.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

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
const pick = (sel) => { const r = rules.find((x) => x.selector === sel && !x.media); if (!r) throw new Error("セレクタが見つからない: " + sel); return r.decls; };
const ROOT = pick(":root");
const FIELD = pick(':root[data-mode="field"]');
const MODES = [["通常", [ROOT]], ["現場", [ROOT, FIELD]]];

const hex = (s) => { const m = /^#([0-9a-f]{6})$/i.exec(s); if (!m) throw new Error("6 桁の HEX ではない: " + s); return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)); };
const lum = (h) => { const [r, g, b] = hex(h).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

// [区分, 名前, 前景, 背景, 通常の要, 現場の要]
const V = ["no", "needs", "done", "none", "unknown"];
const VN = { no: "飛行不可", needs: "要手続き", done: "手続き済み・情報", none: "手続き不要", unknown: "判定不能" };
const GROUNDS = ["base", "surface", "sunken"];
const pairs = [];
const P = (g, n, fg, bg, nr, fr) => pairs.push({ g, n, fg, bg, nr, fr });
for (const bg of GROUNDS) P("文字", `本文 / ${bg}`, "ink", bg, 4.5, 7);
for (const bg of GROUNDS) P("文字", `第二の文字 / ${bg}`, "ink-2", bg, 4.5, 7);
for (const bg of GROUNDS) P("文字", `注釈 / ${bg}`, "ink-3", bg, 4.5, 7);
for (const bg of GROUNDS) P("文字", `プレースホルダー / ${bg}`, "ph", bg, 4.5, 7);
P("橙", "橙の面の上の墨の文字（主ボタン・チェック）", "on-orange", "orange", 4.5, 7);
P("橙", "明るい橙の上の墨の文字（ホバー・期限タグ）", "ink", "orange-hover", 4.5, 7);
P("橙", "橙の丸の上の墨の矢印（副ボタンのホバー）", "ink", "orange", 3, 4.5);
P("橙", "墨の丸の上の白い矢印（ピルの右端）", "base", "ink", 3, 4.5);
P("橙", "フォーカスの輪 / 橙の面", "focus", "orange", 3, 4.5);
for (const bg of GROUNDS) P("橙", `フォーカスの輪 / ${bg}`, "focus", bg, 3, 4.5);
for (const bg of GROUNDS) P("押せる部品", `縁（入力欄・OFF チップ・チェック枠）/ ${bg}`, "edge", bg, 3, 4.5);
for (const v of V) {
  P("判定", `${VN[v]}：塗りの上の文字`, `v-${v}-on`, `v-${v}-fill`, 4.5, 7);
  for (const bg of GROUNDS) P("判定", `${VN[v]}：文字・線 / ${bg}`, `v-${v}-fg`, bg, 4.5, 7);
  // 琥珀の塗りは地に対して 3:1 に届かないため、印は fg の 2px 枠で囲む（枠は上の「文字・線」で検査済み）
  if (v !== "needs" && v !== "unknown") for (const bg of ["base", "surface"]) P("判定", `${VN[v]}：塗り / ${bg}（印の輪郭）`, `v-${v}-fill`, bg, 3, 4.5);
}
P("挿絵の上", "本文（ヒーローの文字）/ 空の淡い水色", "ink", "art-sky", 4.5, 7);
P("挿絵の上", "本文（ヒーローの文字）/ 空の暖色", "ink", "art-sky-warm", 4.5, 7);
P("挿絵の上", "第二の文字 / 空の淡い水色", "ink-2", "art-sky", 4.5, 7);
P("挿絵の上", "第二の文字 / 空の暖色", "ink-2", "art-sky-warm", 4.5, 7);
// 記録のみ（要件なし。実測値を表に残す）
P("記録のみ", "罫（区切り専用）/ 白", "rule", "base", null, null);
P("記録のみ", "橙の面 / 白（面専用。線と文字には使わない）", "orange", "base", null, null);
P("記録のみ", "桃 #CC6595 の上の墨（不採用の根拠）", "ink", "pink-rejected", null, null);

const results = [];
const problems = [];
for (const [mode, layers] of MODES) {
  const t = Object.assign({}, ...layers);
  t["--sb-pink-rejected"] = "#CC6595";
  const col = (k) => { const v = t["--sb-" + k]; if (!v) throw new Error(`${mode}: --sb-${k} がない`); return v; };
  const isField = mode === "現場";
  for (const p of pairs) {
    const r = ratio(col(p.fg), col(p.bg));
    const need = isField ? p.fr : p.nr;
    results.push({ ...p, mode, ratio: r, need, ok: need == null || r >= need - 1e-9 });
  }
  const px = (k) => parseFloat(t["--sb-" + k]);
  const chk = (name, ok, msg) => { if (!ok) problems.push(`${mode}: ${name} ${msg}`); };
  chk("--sb-hit-min", px("hit-min") >= (isField ? 56 : 44), `${px("hit-min")}px が下限未満`);
  chk("--sb-hit", px("hit") >= (isField ? 56 : 48), `${px("hit")}px が下限未満`);
  chk("--sb-hit-primary", px("hit-primary") >= (isField ? 64 : 56), `${px("hit-primary")}px が下限未満`);
  chk("--sb-hit-row", px("hit-row") >= (isField ? 64 : 48), `${px("hit-row")}px が下限未満`);
  chk("--sb-fs-note", px("fs-note") >= (isField ? 14 : 12), `${px("fs-note")}px が下限未満`);
  chk("--sb-fs-body", px("fs-body") >= (isField ? 18 : 15), `${px("fs-body")}px が下限未満`);
  chk("--sb-dur", !isField || px("dur") === 0, "現場は 0 のはず");
  chk("--sb-dur-rise", !isField || px("dur-rise") === 0, "現場は 0 のはず");
  chk("--sb-shadow", !isField || t["--sb-shadow"] === "none", "現場は none のはず");
  chk("--sb-r-l", px("r-l") === 16 && px("r-m") === 8 && px("r-s") === 4, "角丸は 16/8/4");
}
// 動きの上限：減らす指定でも 0
const rm = rules.find((x) => x.media && x.media.includes("reduce"));
if (!rm || rm.decls["--sb-dur"] !== "0ms" || rm.decls["--sb-dur-rise"] !== "0ms") problems.push("prefers-reduced-motion で動きが 0 にならない");

const fails = results.filter((r) => !r.ok);
const f2 = (n) => n.toFixed(2);
if (process.argv.includes("--md")) {
  const rows = ["| 区分 | 組 | 要（通常／現場） | 通常 | 現場 |", "|---|---|---|---|---|"];
  for (const p of pairs) {
    const cells = MODES.map(([m]) => { const r = results.find((x) => x.n === p.n && x.g === p.g && x.mode === m); return f2(r.ratio) + (r.ok ? "" : " ×"); });
    rows.push(`| ${p.g} | ${p.n} | ${p.nr ?? "—"}／${p.fr ?? "—"} | ${cells.join(" | ")} |`);
  }
  console.log(rows.join("\n"));
} else {
  for (const r of fails) console.log(`NG  ${r.mode}  ${r.g}  ${r.n}  ${f2(r.ratio)} < ${r.need}  (--sb-${r.fg} / --sb-${r.bg})`);
  for (const g of ["文字", "橙", "押せる部品", "判定", "挿絵の上"]) {
    const xs = results.filter((r) => r.need && r.g === g);
    const w = xs.reduce((a, b) => (b.ratio / b.need < a.ratio / a.need ? b : a));
    console.log(`最小余裕 ${g}: ${f2(w.ratio)}（要 ${w.need}）${w.mode} ${w.n}`);
  }
}
for (const p of problems) console.log("NG  " + p);
console.log(`組 ${pairs.length} × 2 通り = ${results.length} 件と寸法・動きを検査。満たさない: ${fails.length + problems.length}`);
process.exit(fails.length + problems.length ? 1 : 0);
