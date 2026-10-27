// 実行: node docs/design/tokens-v2/check-contrast-v2.mjs [--md] [トークンの CSS のパス]
// 既定ではアプリの実ファイル apps/web/src/app/soraban-tokens.css を読み（値の正）、通常・現場・暗・現場の暗の 4 通りでコントラストと寸法の下限を検査する。満たさない組があれば終了コード 1。
// 暗は「OS 設定（@media の :root:not([data-theme="light"])）」と「強制（:root[data-theme="dark"]）」の宣言の一致も検査する。
// 参考：docs/design/tokens/check-contrast.mjs（v1。暗の一致検査の考え方を踏襲）。外部通信・依存なし。
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const fileArg = process.argv.slice(2).find((a) => !a.startsWith("--"));
const TOKENS_PATH = fileArg ? path.resolve(fileArg) : path.join(here, "../../../apps/web/src/app/soraban-tokens.css");
const css = fs.readFileSync(TOKENS_PATH, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

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
const DARK_MEDIA = "@media (prefers-color-scheme: dark)";
const pick = (sel, media = null) => { const r = rules.find((x) => x.selector === sel && x.media === media); if (!r) throw new Error("セレクタが見つからない: " + sel + (media ? " in " + media : "")); return r.decls; };
const ROOT = pick(":root");
const FIELD = pick(':root[data-mode="field"]');
const DM = pick(':root:not([data-theme="light"])', DARK_MEDIA);
const DMF = pick(':root:not([data-theme="light"])[data-mode="field"]', DARK_MEDIA);
const DF = pick(':root[data-theme="dark"]');
const DFF = pick(':root[data-theme="dark"][data-mode="field"]');
// カスケードの順（特異性が同じ組は後ろの宣言が勝つ）：明 → 現場 → 暗 → 現場の暗
const MODES = [["通常", [ROOT]], ["現場", [ROOT, FIELD]], ["暗", [ROOT, DM]], ["現場・暗", [ROOT, FIELD, DM, DMF]]];
const FIELD_MODES = ["現場", "現場・暗"], DARK_MODES = ["暗", "現場・暗"], LIGHT_MODES = ["通常", "現場"];

const hex = (s) => { const m = /^#([0-9a-f]{6})$/i.exec(s); if (!m) throw new Error("6 桁の HEX ではない: " + s); return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)); };
const lum = (h) => { const [r, g, b] = hex(h).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

// [区分, 名前, 前景, 背景, 通常の要, 現場の要, 対象の通り（省略で全部）]
const V = ["no", "needs", "done", "none", "unknown"];
const VN = { no: "飛行不可", needs: "要手続き", done: "手続き済み・情報", none: "手続き不要", unknown: "判定不能" };
const GROUNDS = ["base", "surface", "sunken"];
const pairs = [];
const P = (g, n, fg, bg, nr, fr, only = null) => pairs.push({ g, n, fg, bg, nr, fr, only });
for (const bg of GROUNDS) P("文字", `本文 / ${bg}`, "ink", bg, 4.5, 7);
for (const bg of GROUNDS) P("文字", `第二の文字 / ${bg}`, "ink-2", bg, 4.5, 7);
for (const bg of GROUNDS) P("文字", `注釈 / ${bg}`, "ink-3", bg, 4.5, 7);
for (const bg of GROUNDS) P("文字", `プレースホルダー / ${bg}`, "ph", bg, 4.5, 7);
P("橙", "橙の面の上の墨の文字（主ボタン・チェック）", "on-orange", "orange", 4.5, 7);
P("橙", "明るい橙の上の墨の文字（ホバー・期限タグ。暗でも文字は on-orange の墨）", "on-orange", "orange-hover", 4.5, 7);
P("橙", "橙の丸の上の墨の矢印（副ボタンのホバー）", "on-orange", "orange", 3, 4.5);
P("橙", "墨の丸の上の矢印（ピルの右端。明は墨の丸＋白、暗は明るい丸＋墨）", "on-dot", "ink", 3, 4.5);
P("橙", "主ボタンの墨の丸の上の白い矢印（橙の面の上は明暗とも同じ）", "on-orange-fg", "on-orange", 3, 4.5);
P("橙", "主ボタンのホバーの白い丸の上の墨の矢印", "on-orange", "on-orange-fg", 3, 4.5);
// 輪は要素から 3px 離して描く（outline-offset）ので、橙の面には接せず地に接する。暗では輪が明るく橙の面とは 3:1 にならないため、明の通りだけ検査する
P("橙", "フォーカスの輪 / 橙の面", "focus", "orange", 3, 4.5, LIGHT_MODES);
for (const bg of GROUNDS) P("橙", `フォーカスの輪 / ${bg}`, "focus", bg, 3, 4.5);
for (const bg of GROUNDS) P("押せる部品", `縁（入力欄・OFF チップ・チェック枠）/ ${bg}`, "edge", bg, 3, 4.5);
P("押せる部品", "副ボタン・ON チップの面の上の本文", "ink", "control", 4.5, 7);
P("押せる部品", "副ボタン・ON チップの面の上の第二の文字", "ink-2", "control", 4.5, 7);
P("押せる部品", "入力欄の面の上の本文", "ink", "field", 4.5, 7);
P("押せる部品", "入力欄の面の上のプレースホルダー", "ph", "field", 4.5, 7);
P("押せる部品", "副ボタン・ON チップの面の縁", "edge", "control", 3, 4.5);
P("押せる部品", "入力欄の縁", "edge", "field", 3, 4.5);
P("押せる部品", "ホバー面（チップ・メニュー）の上の本文", "ink", "hover", 4.5, 7);
P("文字", "強調（蛍光ペン風の下線の面）の上の本文", "ink", "mark-bg", 4.5, 7);
P("文字", "反転タグ・ラベル（期限切れ・状態）の文字", "inverse-fg", "inverse-bg", 4.5, 7);
for (const v of V) {
  P("判定", `${VN[v]}：塗りの上の文字`, `v-${v}-on`, `v-${v}-fill`, 4.5, 7);
  for (const bg of GROUNDS) P("判定", `${VN[v]}：文字・線 / ${bg}`, `v-${v}-fg`, bg, 4.5, 7);
  // 琥珀の塗りは地に対して 3:1 に届かないため、印は fg の 2px 枠で囲む（枠は上の「文字・線」で検査済み）
  if (v !== "needs" && v !== "unknown") for (const bg of ["base", "surface"]) P("判定", `${VN[v]}：塗り / ${bg}（印の輪郭）`, `v-${v}-fill`, bg, 3, 4.5);
  // 暗は塗りが明るく、琥珀も地に 3:1 以上あるので、枠なしでも印の輪郭が地から離れる（暗は 3 つの地すべてで確かめる）
  if (v === "needs") for (const bg of GROUNDS) P("判定", `${VN[v]}：塗り / ${bg}（暗の印の輪郭）`, `v-${v}-fill`, bg, 3, 4.5, DARK_MODES);
}
P("挿絵の上", "本文（ヒーローの文字）/ 空の淡い水色", "ink", "art-sky", 4.5, 7);
P("挿絵の上", "本文（ヒーローの文字）/ 空の暖色", "ink", "art-sky-warm", 4.5, 7);
P("挿絵の上", "第二の文字 / 空の淡い水色", "ink-2", "art-sky", 4.5, 7);
P("挿絵の上", "第二の文字 / 空の暖色", "ink-2", "art-sky-warm", 4.5, 7);
// 記録のみ（要件なし。実測値を表に残す）
P("記録のみ", "罫（区切り専用）/ 白", "rule", "base", null, null);
P("記録のみ", "橙の面 / 白（面専用。線と文字には使わない）", "orange", "base", null, null);
P("記録のみ", "桃 #CC6595 の上の墨（不採用の根拠）", "ink", "pink-rejected", null, null, LIGHT_MODES);
P("記録のみ", "挿絵の線 / 空の淡い水色（暗は暗い空の上の明るい線）", "art-line", "art-sky", null, null);

const results = [];
const problems = [];
for (const [mode, layers] of MODES) {
  const t = Object.assign({}, ...layers);
  t["--sb-pink-rejected"] = "#CC6595";
  const col = (k) => { const v = t["--sb-" + k]; if (!v) throw new Error(`${mode}: --sb-${k} がない`); return v; };
  const isField = FIELD_MODES.includes(mode), isDark = DARK_MODES.includes(mode);
  for (const p of pairs) {
    if (p.only && !p.only.includes(mode)) continue;
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
  if (isDark && !isField) chk("--sb-shadow", /^0 0 0 1px #[0-9a-f]{6}$/i.test(t["--sb-shadow"]), "暗は影（ぼかし）を使わず 1px の輪郭のはず：" + t["--sb-shadow"]);
  chk("--sb-r-l", px("r-l") === 16 && px("r-m") === 8 && px("r-s") === 4, "角丸は 16/8/4");
}
// 暗の構造の検査（v1 の check-contrast.mjs と design-tokens.test.ts の考え方）
const same = (a, b) => { const ka = Object.keys(a).sort(), kb = Object.keys(b).sort(); return ka.length === kb.length && ka.every((k, i) => k === kb[i] && a[k] === b[k]); };
if (!same(DM, DF)) problems.push("暗（OS 設定）と暗（強制）の宣言が一致しない");
if (!same(DMF, DFF)) problems.push("暗の現場（OS 設定）と暗の現場（強制）の宣言が一致しない");
// 暗は明のトークンを引きずらない：色を持つトークンは、明と同じでよいと明示したもの以外すべて暗で再定義する
const SAME_IN_DARK = new Set(["--sb-orange", "--sb-orange-hover", "--sb-orange-deep", "--sb-on-orange", "--sb-on-orange-fg"]);
const isColor = (v) => /^(#[0-9a-f]{6}|rgba?\()/i.test(v);
for (const k of Object.keys(ROOT)) {
  if ((isColor(ROOT[k]) || k === "--sb-shadow" || k === "--sb-tile-filter") && !SAME_IN_DARK.has(k) && !(k in DM)) problems.push(`暗で再定義されていない明のトークン: ${k}`);
}
for (const k of SAME_IN_DARK) if (k in DM) problems.push(`暗で変えないはずのトークンを暗が再定義している: ${k}`);
for (const k of Object.keys(FIELD)) if (isColor(FIELD[k]) && !(k in DM)) problems.push(`現場の色が暗で再定義されていない（明の現場の値が暗に漏れる）: ${k}`);
// 暗の地：純黒にしない、温かい（赤 ≥ 青）
for (const [nm, d] of [["暗", DM], ["現場・暗", Object.assign({}, DM, DMF)]]) {
  for (const g of GROUNDS) {
    const v = d["--sb-" + g]; const [r, gg, b] = hex(v);
    if (v.toUpperCase() === "#000000" || Math.max(r, gg, b) < 8) problems.push(`${nm}: --sb-${g} ${v} は純黒に近い`);
    if (r < b) problems.push(`${nm}: --sb-${g} ${v} は温かい黒（赤 ≥ 青）ではない`);
  }
}
// 暗の面の序列：sunken < base < surface（面は地より少し明るく、くぼみは深い）
{ const L = (k) => lum(DM["--sb-" + k]); if (!(L("sunken") < L("base") && L("base") < L("surface"))) problems.push("暗の面の序列が sunken < base < surface ではない"); }
// 動きの上限：減らす指定でも 0
const rm = rules.find((x) => x.media && x.media.includes("reduce"));
if (!rm || rm.decls["--sb-dur"] !== "0ms" || rm.decls["--sb-dur-rise"] !== "0ms") problems.push("prefers-reduced-motion で動きが 0 にならない");

const fails = results.filter((r) => !r.ok);
const f2 = (n) => n.toFixed(2);
if (process.argv.includes("--md")) {
  const rows = ["| 区分 | 組 | 要（通常／現場） | 通常 | 現場 | 暗 | 現場・暗 |", "|---|---|---|---|---|---|---|"];
  for (const p of pairs) {
    const cells = MODES.map(([m]) => { const r = results.find((x) => x.n === p.n && x.g === p.g && x.mode === m); return r ? f2(r.ratio) + (r.ok ? "" : " ×") : "—"; });
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
for (const [m] of MODES) {
  const xs = results.filter((r) => r.need && r.mode === m);
  const w = xs.reduce((a, b) => (b.ratio / b.need < a.ratio / a.need ? b : a));
  console.log(`最小余裕（${m}）: ${f2(w.ratio)}（要 ${w.need}）${w.g} ${w.n}`);
}
for (const p of problems) console.log("NG  " + p);
const perMode = MODES.map(([m]) => `${m} ${results.filter((r) => r.mode === m).length}`).join("／");
console.log(`組 ${pairs.length}（${perMode}）= 計 ${results.length} 件と、寸法・動き・暗の構造を検査。満たさない: ${fails.length + problems.length}`);
process.exit(fails.length + problems.length ? 1 : 0);
