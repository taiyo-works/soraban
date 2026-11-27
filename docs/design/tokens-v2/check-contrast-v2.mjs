// 実行: node docs/design/tokens-v2/check-contrast-v2.mjs [--md] [トークンの CSS のパス]
// 既定ではアプリの実ファイル apps/web/src/app/soraban-tokens.css を読み（値の正）、通常・現場・暗・現場の暗の 4 通りでコントラストと寸法の下限を検査する。満たさない組があれば終了コード 1。
// Sprint 16-A：主色は空色 1 色（橙は無い）。地は base #F6F7F9・面 surface #FFFFFF。値の正は docs/sprints/sprint-16.md §3.1。値は var(--sb-…) の参照も解決して読む。
// 暗は強制（:root[data-theme="dark"]）だけ。OS の暗い設定には従わない（@media (prefers-color-scheme: dark) の宣言が残っていないことも検査する）。
// 文字の大きさ・押す部品の下限（補足 12→14・本文 15→16・44→48）は、トークンの値を引き上げる 16-B で上げる（16-A は寸法を変えない契約）。
// 日差しの模擬（S-1）：明の 2 通り（通常・現場）で、画面に当たる外光の反射 g（画面の白の明るさに対する割合）を両方の相対輝度に足した比
//   (L1 + 0.05 + g) / (L2 + 0.05 + g) を求める。g = 0.10 を合否に使い（文字は 3.0 以上、現場の文字は 4.5 以上、押せる部品の境界・判定の印の輪郭は 2.0 以上）、g = 0.25 は記録だけ。
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
const DM = pick(':root[data-theme="dark"]');
const DMF = pick(':root[data-theme="dark"][data-mode="field"]');
// カスケードの順（特異性が同じ組は後ろの宣言が勝つ）：明 → 現場 → 暗 → 現場の暗。暗は強制（data-theme="dark"）だけ
const MODES = [["通常", [ROOT]], ["現場", [ROOT, FIELD]], ["暗", [ROOT, DM]], ["現場・暗", [ROOT, FIELD, DM, DMF]]];
const FIELD_MODES = ["現場", "現場・暗"], DARK_MODES = ["暗", "現場・暗"], LIGHT_MODES = ["通常", "現場"];

const hex = (s) => { const m = /^#([0-9a-f]{6})$/i.exec(s); if (!m) throw new Error("6 桁の HEX ではない: " + s); return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)); };
const lum = (h) => { const [r, g, b] = hex(h).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
// 日差しの模擬（S-1）：外光の反射 g を両方の輝度に足す
const veiled = (a, b, g) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05 + g) / (Math.min(x, y) + 0.05 + g); };
const G_PASS = 0.10, G_NOTE = 0.25;

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
P("主色", "主ボタンの面の上の白い文字（主ボタン・チェック）", "on-primary", "primary", 4.5, 7);
P("主色", "主ボタンの押下の面の上の白い文字", "on-primary", "primary-press", 4.5, 7);
P("主色", "主ボタンの白い丸の上の矢印（副ボタンのホバーは主色の丸＋白い矢印）", "primary", "on-primary", 3, 4.5);
P("主色", "薄い主色の面（選択中・現在地・ホバー）の上の本文", "ink", "primary-soft", 4.5, 7);
P("主色", "薄い主色の面の上の第二の文字", "ink-2", "primary-soft", 4.5, 7);
P("主色", "現在地のアイコン（主色）/ 薄い主色の面", "primary", "primary-soft", 3, 4.5);
// 主色の面は、それだけで隣の地に対して 3:1 以上（現場 4.5）。旧 16-1 の「主ボタンの墨の縁」は不要
for (const bg of GROUNDS) P("主色", `主色の面・線 / ${bg}（境界）`, "primary", bg, 3, 4.5);
for (const bg of ["base", "surface"]) P("主色", `主色のリンク文字 / ${bg}`, "primary", bg, 4.5, 7);
for (const bg of GROUNDS) P("主色", `フォーカスの輪 / ${bg}`, "focus", bg, 3, 4.5);
P("主色", "フォーカスの輪 / 薄い主色の面", "focus", "primary-soft", 3, 4.5);
P("押せる部品", "選択中・ホバーの面（薄い主色）の縁", "edge", "primary-soft", 3, 4.5);
for (const bg of GROUNDS) P("押せる部品", `縁（入力欄・OFF チップ・チェック枠）/ ${bg}`, "edge", bg, 3, 4.5);
P("押せる部品", "墨の丸の上の矢印（ピルの右端・行の矢印。明は墨の丸＋白、暗は明るい丸＋墨）", "on-dot", "ink", 3, 4.5);
// 状態色：文字は面の上で 7:1（現場も 7 以上）、印は面・地の上で 3:1（現場 4.5）
const ST = { safe: "安全", warn: "注意", danger: "危険", info: "情報", flying: "飛行中" };
for (const k of Object.keys(ST)) {
  P("状態", `${ST[k]}：文字 / 面`, `st-${k}-text`, `st-${k}-face`, 7, 7);
  P("状態", `${ST[k]}：印 / 面`, `st-${k}-mark`, `st-${k}-face`, 3, 4.5);
  for (const bg of GROUNDS) P("状態", `${ST[k]}：印 / ${bg}`, `st-${k}-mark`, bg, 3, 4.5);
}
P("押せる部品", "副ボタン・ON チップの面の上の本文", "ink", "control", 4.5, 7);
P("押せる部品", "副ボタン・ON チップの面の上の第二の文字", "ink-2", "control", 4.5, 7);
P("押せる部品", "入力欄の面の上の本文", "ink", "field", 4.5, 7);
P("押せる部品", "入力欄の面の上のプレースホルダー", "ph", "field", 4.5, 7);
P("押せる部品", "副ボタン・ON チップの面の縁", "edge", "control", 3, 4.5);
P("押せる部品", "入力欄の縁", "edge", "field", 3, 4.5);
P("押せる部品", "ホバー面（チップ・メニュー）の上の本文", "ink", "hover", 4.5, 7);
P("押せる部品", "期限の札（状態「注意」の面）の上の本文", "ink", "st-warn-face", 4.5, 7);
P("文字", "強調（蛍光ペン風の下線の面）の上の本文", "ink", "mark-bg", 4.5, 7);
P("文字", "反転タグ・ラベル（期限切れ・状態）の文字", "inverse-fg", "inverse-bg", 4.5, 7);
for (const v of V) {
  P("判定", `${VN[v]}：塗りの上の文字`, `v-${v}-on`, `v-${v}-fill`, 4.5, 7);
  for (const bg of GROUNDS) P("判定", `${VN[v]}：文字・線 / ${bg}`, `v-${v}-fg`, bg, 4.5, 7);
  // 印の塗りは地に対して 3:1 以上（判定不能は白の面＋点線の縁で、縁は edge が担う）
  if (v !== "unknown") for (const bg of ["base", "surface"]) P("判定", `${VN[v]}：塗り / ${bg}（印の輪郭）`, `v-${v}-fill`, bg, 3, 4.5);
}
P("挿絵の上", "本文（ヒーローの文字）/ 空（白）", "ink", "art-sky", 4.5, 7);
P("挿絵の上", "第二の文字 / 空（白）", "ink-2", "art-sky", 4.5, 7);
// 記録のみ（要件なし。実測値を表に残す）
P("記録のみ", "罫（区切り専用）/ 白", "rule", "base", null, null);
P("記録のみ", "無効の部品の文字 / 面（WCAG の対象外の用途だけ。補足・本文には使わない）", "ink-disabled", "surface", null, null);
P("記録のみ", "桃 #CC6595 の上の墨（不採用の根拠）", "ink", "pink-rejected", null, null, LIGHT_MODES);
P("記録のみ", "挿絵の線 / 空（暗は暗い空の上の明るい線）", "art-line", "art-sky", null, null);

const results = [];
const veil = [];
const problems = [];
for (const [mode, layers] of MODES) {
  const t = Object.assign({}, ...layers);
  t["--sb-pink-rejected"] = "#CC6595";
  const resolveVar = (v, depth = 0) => { const m = /^var\((--[\w-]+)\)$/.exec(v); if (!m) return v; if (depth > 5 || !t[m[1]]) throw new Error(`${mode}: ${m[1]} を解決できない`); return resolveVar(t[m[1]], depth + 1); };
  for (const k of Object.keys(t)) t[k] = resolveVar(t[k]);
  const col = (k) => { const v = t["--sb-" + k]; if (!v) throw new Error(`${mode}: --sb-${k} がない`); return v; };
  const isField = FIELD_MODES.includes(mode), isDark = DARK_MODES.includes(mode);
  for (const p of pairs) {
    if (p.only && !p.only.includes(mode)) continue;
    const r = ratio(col(p.fg), col(p.bg));
    const need = isField ? p.fr : p.nr;
    results.push({ ...p, mode, ratio: r, need, ok: need == null || r >= need - 1e-9 });
  }
  if (LIGHT_MODES.includes(mode)) {
    for (const p of pairs) {
      if (p.only && !p.only.includes(mode)) continue;
      if (p.nr == null) continue;
      const text = p.nr === 4.5;
      // 判定の塗り（現場では 20px 以上の太字で使う）の上の文字は、日差しの模擬では 3.0 以上
      const relaxed = /^v-.+-fill$/.test(p.bg);
      const need = text ? (isField && !relaxed ? 4.5 : 3.0) : 2.0;
      const r = veiled(col(p.fg), col(p.bg), G_PASS);
      veil.push({ ...p, mode, ratio: r, need, ok: r >= need - 1e-9, note: veiled(col(p.fg), col(p.bg), G_NOTE) });
    }
  }
  // 値は px か rem（1rem = 16px）。rem は 16 倍して px に直して比べる
  const px = (k) => { const v = String(t["--sb-" + k]).trim(); return /rem$/.test(v) ? parseFloat(v) * 16 : parseFloat(v); };
  const chk = (name, ok, msg) => { if (!ok) problems.push(`${mode}: ${name} ${msg}`); };
  chk("--sb-hit-min", px("hit-min") >= (isField ? 56 : 48), `${px("hit-min")}px が下限未満`);
  chk("--sb-hit", px("hit") >= (isField ? 56 : 48), `${px("hit")}px が下限未満`);
  chk("--sb-hit-primary", px("hit-primary") >= (isField ? 64 : 56), `${px("hit-primary")}px が下限未満`);
  chk("--sb-hit-row", px("hit-row") >= (isField ? 64 : 48), `${px("hit-row")}px が下限未満`);
  chk("--sb-fs-note", px("fs-note") >= 14, `${px("fs-note")}px が下限未満`);
  chk("--sb-fs-body", px("fs-body") >= (isField ? 18 : 16), `${px("fs-body")}px が下限未満`);
  for (const d of ["dur", "dur-press", "dur-sheet", "dur-state", "dur-rise"]) chk("--sb-" + d, !isField || px(d) === 0, "現場は 0 のはず");
  chk("--sb-dur", px("dur") === (isField ? 0 : 180) && px("dur-press") === (isField ? 0 : 120) && px("dur-sheet") === (isField ? 0 : 280) && px("dur-state") === (isField ? 0 : 300), "動きは標準 180・押下 120・シート 280・状態 300ms（現場 0）");
  chk("--sb-shadow", !isField || t["--sb-shadow"] === "none", "現場は none のはず");
  chk("--sb-shadow-float", !isField || t["--sb-shadow-float"] === "none", "現場は none のはず");
  if (!isDark) chk("--sb-shadow", t["--sb-shadow"] === "none", "明は none のはず（影は日差しで見えない）");
  if (!isDark && !isField) chk("--sb-shadow-float", t["--sb-shadow-float"] === "0 -4px 24px rgba(20, 24, 31, 0.08)", "明の浮くものの影は 0 -4px 24px rgba(20,24,31,.08)：" + t["--sb-shadow-float"]);
  if (isDark && !isField) chk("--sb-shadow-float", /^0 0 0 1px #[0-9a-f]{6}$/i.test(t["--sb-shadow-float"]), "暗は 1px の輪郭のはず：" + t["--sb-shadow-float"]);
  if (isDark && !isField) chk("--sb-shadow", /^0 0 0 1px #[0-9a-f]{6}$/i.test(t["--sb-shadow"]), "暗は影（ぼかし）を使わず 1px の輪郭のはず：" + t["--sb-shadow"]);
  chk("--sb-r-l", px("r-l") === 16 && px("r-m") === 8 && px("r-s") === 4, "従来の角丸は 16/8/4（16-C まで残す）");
  chk("--sb-r-card", px("r-card") === 16 && px("r-control") === 12 && px("r-sheet") === 20, "角丸の新しい名前は card 16・control 12・sheet 20");
}
// 暗の構造の検査。暗は休眠（強制の data-theme="dark" だけ）：OS の暗い設定に従う宣言が残っていないこと
if (rules.some((x) => x.media && x.media.includes("prefers-color-scheme"))) problems.push("@media (prefers-color-scheme: …) の宣言が残っている（Sprint 16：常に明るい表示）");
// 暗は明のトークンを引きずらない：色を持つトークンは、明と同じでよいと明示したもの以外すべて暗で再定義する
const SAME_IN_DARK = new Set([]);   // 色を持つトークンはすべて暗で再定義する（明と同じでよいものは無い）
const isColor = (v) => /^(#[0-9a-f]{6}|rgba?\()/i.test(v);
for (const k of Object.keys(ROOT)) if (/orange/i.test(k)) problems.push(`橙のトークンが残っている: ${k}（橙はロゴだけ）`);
for (const k of Object.keys(ROOT)) {
  if ((isColor(ROOT[k]) || k === "--sb-shadow" || k === "--sb-tile-filter") && !SAME_IN_DARK.has(k) && !(k in DM)) problems.push(`暗で再定義されていない明のトークン: ${k}`);
}
for (const k of SAME_IN_DARK) if (k in DM) problems.push(`暗で変えないはずのトークンを暗が再定義している: ${k}`);
for (const k of Object.keys(FIELD)) if (isColor(FIELD[k]) && !(k in DM)) problems.push(`現場の色が暗で再定義されていない（明の現場の値が暗に漏れる）: ${k}`);
// 明：地は #F6F7F9、面は白、くぼみは #EEF1F5。主色は #1F5FE0 の 1 色。影なし、装飾のトークンなし
const eq = (k, v) => { if ((ROOT["--sb-" + k] ?? "").toUpperCase() !== v) problems.push(`明：--sb-${k} は ${v} のはず: ${ROOT["--sb-" + k]}`); };
eq("base", "#F6F7F9"); eq("surface", "#FFFFFF"); eq("sunken", "#EEF1F5"); eq("primary", "#1F5FE0"); eq("on-primary", "#FFFFFF");
if (ROOT["--sb-shadow"] !== "none") problems.push("明：--sb-shadow は none のはず: " + ROOT["--sb-shadow"]);
for (const gone of ["--sb-sec-num", "--sb-halo", "--sb-contour", "--sb-contour-major"]) if (gone in ROOT) problems.push(`装飾のトークンが残っている: ${gone}`);
for (const g of ["base", "surface", "sunken"]) { const [r, , b2] = hex(ROOT["--sb-" + g]); if (r > b2) problems.push(`明：--sb-${g} ${ROOT["--sb-" + g]} は青みのある薄いグレーのはず（ベージュ・生成りは使わない）`); }
{ const L = (k) => lum(ROOT["--sb-" + k]); if (!(L("sunken") < L("base") && L("base") < L("surface"))) problems.push("明の面の序列が sunken < base < surface ではない"); }
// 橙系の色（色相 20〜50°・彩度 0.5 以上）はトークンにない。状態「注意」（琥珀）と判定の要手続きだけは別
{
  const hue = (h) => { const [r, g, b] = hex(h).map((v) => v / 255); const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; if (!d) return [0, 0]; const hh = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return [((hh * 60) + 360) % 360, mx ? d / mx : 0]; };
  for (const r of rules) for (const [k, v] of Object.entries(r.decls)) {
    if (!/^#[0-9a-f]{6}$/i.test(v) || /^--sb-(st-warn|v-needs)/.test(k)) continue;
    const [h, sat] = hue(v);
    if (h >= 20 && h <= 50 && sat >= 0.5) problems.push(`橙系の色が残っている: ${k} ${v}（橙はロゴだけ）`);
  }
}
// 暗の地：純黒にしない、青みのある黒（青 ≥ 赤）
for (const [nm, d] of [["暗", DM], ["現場・暗", Object.assign({}, DM, DMF)]]) {
  for (const g of GROUNDS) {
    const v = d["--sb-" + g]; const [r, gg, b] = hex(v);
    if (v.toUpperCase() === "#000000" || Math.max(r, gg, b) < 8) problems.push(`${nm}: --sb-${g} ${v} は純黒に近い`);
    if (r > b) problems.push(`${nm}: --sb-${g} ${v} は青みのある黒（青 ≥ 赤）ではない`);
  }
}
// 暗の面の序列：base < surface < sunken（面は地より少し明るく、面の一段上はさらに明るい）
{ const L = (k) => lum(DM["--sb-" + k]); if (!(L("base") < L("surface") && L("surface") < L("sunken"))) problems.push("暗の面の序列が base < surface < sunken ではない"); }
// 動きの上限：減らす指定でも 0
const rm = rules.find((x) => x.media && x.media.includes("reduce"));
if (!rm || ["--sb-dur", "--sb-dur-press", "--sb-dur-sheet", "--sb-dur-state", "--sb-dur-rise"].some((k) => rm.decls[k] !== "0ms")) problems.push("prefers-reduced-motion で動きが 0 にならない");

const fails = results.filter((r) => !r.ok);
const veilFails = veil.filter((r) => !r.ok);
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
  for (const g of ["文字", "主色", "押せる部品", "状態", "判定", "挿絵の上"]) {
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
for (const r of veilFails) console.log(`NG  日差し g=${G_PASS} ${r.mode}  ${r.g}  ${r.n}  ${f2(r.ratio)} < ${r.need}  (--sb-${r.fg} / --sb-${r.bg})`);
for (const [m] of MODES.filter(([m2]) => LIGHT_MODES.includes(m2))) {
  const xs = veil.filter((r) => r.mode === m);
  const w = xs.reduce((a, b) => (b.ratio / b.need < a.ratio / a.need ? b : a));
  const w25 = xs.reduce((a, b) => (b.note / b.need < a.note / a.need ? b : a));
  console.log(`日差しの模擬（${m}。g=${G_PASS} が合否、g=${G_NOTE} は記録）: ${xs.length} 件。最小余裕 ${f2(w.ratio)}（要 ${w.need}）${w.n}／g=${G_NOTE}: ${f2(w25.note)}（要 ${w25.need}。記録のみ）${w25.n}`);
}
const perMode = MODES.map(([m]) => `${m} ${results.filter((r) => r.mode === m).length}`).join("／");
console.log(`組 ${pairs.length}（${perMode}）= 計 ${results.length} 件と、寸法・動き・暗の構造を検査。日差しの模擬 ${veil.length} 件。満たさない: ${fails.length + problems.length + veilFails.length}`);
process.exit(fails.length + problems.length + veilFails.length ? 1 : 0);
