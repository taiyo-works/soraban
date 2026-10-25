// 実行: node docs/design/shape-compare/build.mjs  → index.html を作る（外部通信なし）
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { svgContours } from "../world-board/src/contours.mjs";
const here = path.dirname(fileURLToPath(import.meta.url));

/* ---------- 色（世界観ボードの値。★は今回、足りなかったので直した値） ---------- */
const C = {
  base: "#F7F7F3", surface: "#FFFFFF", sunken: "#ECEBE4", ink: "#262523",
  g700: "#4A4843", g500: "#6A6862", g300: "#A8A69E", g200: "#C9C7BE", g100: "#E4E3DC",
  edge: "#4D4B46",        // ★ 旧 #6B6963（地に対し 5.1:1）→ 現場の 7:1 を満たす値
  orange: "#F89B48", copper: "#B4541F",
  copperText: "#8A3A10",  // ★ 銅を「文字」に使うときはこちら（旧 #B4541F は 4.6:1）
  red: "#A81D28", redText: "#9A1A24", // ★ 赤の文字・線は暗い側へ（旧 6.2:1 → 7:1 超）
  amber: "#EDB800", blue: "#1D5A8E", green: "#225F36",
};
const hex = (s) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));
const lum = (c) => { const [r, g, b] = (typeof c === "string" ? hex(c) : c).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const over = (fg, bg, a) => hex(bg).map((v, i) => Math.round(v * (1 - a) + hex(fg)[i] * a)); // fg を a の濃さで bg に重ねる
const rgbHex = (c) => "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase();
const transWhite = over("#FFFFFF", C.base, 0.6);

/* ---------- 部品（A と B で同じ HTML。形は CSS だけで変える） ---------- */
const SVG = `<svg width="0" height="0" style="position:absolute" aria-hidden="true">
<symbol id="s-red" viewBox="0 0 22 22"><rect x="2" y="2" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M6.5 6.5l9 9M15.5 6.5l-9 9" stroke="currentColor" stroke-width="2.4" fill="none"/></symbol>
<symbol id="s-amber" viewBox="0 0 22 22"><path d="M11 2.5L20.5 19.5H1.5Z" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="miter"/><path d="M11 8.5v5.5" stroke="currentColor" stroke-width="2.4"/><rect x="10" y="15.4" width="2" height="2" fill="currentColor"/></symbol>
<symbol id="s-blue" viewBox="0 0 22 22"><circle cx="11" cy="11" r="9" fill="none" stroke="currentColor" stroke-width="2.2"/><circle cx="11" cy="11" r="4" fill="currentColor"/></symbol>
<symbol id="s-green" viewBox="0 0 22 22"><circle cx="11" cy="11" r="9" fill="none" stroke="currentColor" stroke-width="2.4"/></symbol>
<symbol id="s-arrow" viewBox="0 0 18 18"><path d="M2.5 9h12M10 4.5L14.5 9 10 13.5" fill="none" stroke="currentColor" stroke-width="2"/></symbol>
<symbol id="s-check" viewBox="0 0 20 20"><path d="M4 10.5l4 4 8-9" fill="none" stroke="currentColor" stroke-width="2.6"/></symbol>
<symbol id="s-x" viewBox="0 0 20 20"><path d="M5 5l10 10M15 5L5 15" fill="none" stroke="currentColor" stroke-width="2.6"/></symbol>
</svg>`;
const ico = (id, cls = "") => `<svg class="${cls}"><use href="#${id}"/></svg>`;
const ar = `<span class="ar">${ico("s-arrow")}</span>`;
const chip = (kind, text) => {
  const m = { red: "s-red", amber: "s-amber", blue: "s-blue", green: "s-green" }[kind];
  return `<span class="chip c-${kind}">${ico(m)}${text}</span>`;
};
const btn = (kind, text, arrow = false) => `<span class="btn b-${kind}"><span>${text}</span>${arrow ? ar : ""}</span>`;
const field = (state, label, value, msg = "") => `<div class="fld ${state}"><div class="fl-l">${label}</div><div class="in">${value}${state === "focus" ? '<i class="caret"></i>' : ""}</div>${msg ? `<div class="fl-e">${ico("s-red")}${msg}</div>` : ""}</div>`;
const chk = (st, name, note = "") => {
  const t = { ok: "正常", ng: "異常", un: "未確認" }[st];
  const g = st === "ok" ? ico("s-check") : st === "ng" ? ico("s-x") : "";
  return `<div class="chk ${st}"><i class="cb">${g}</i><span class="nm">${name}${note ? `<small>${note}</small>` : ""}</span><b class="st">${t}</b></div>`;
};
const mi = (name, en, o = {}) => `<div class="mi${o.cur ? " cur" : ""}"><div class="n">${o.cur ? '<span class="pip"></span>' : ""}${name}${o.n ? `<span class="cnt">${o.n}</span>` : ""}</div><span class="e">${en}</span></div>`;
const hb = (x = false) => `<span class="hb${x ? " x" : " two"}"><i></i></span>`;
const tabbar = (cur, x = false) => {
  const t = [["Home", "ホーム"], ["Check", "判定"], ["Plan", "計画"], ["Log", "日誌"]];
  return `<div class="tabbar">${t.map(([g, j]) => `<div class="it${cur === j ? " cur" : ""}"><span class="g">${g}</span>${j}${j === "計画" ? '<span class="badge">2</span>' : ""}</div>`).join("")}<div>${hb(x)}</div></div>`;
};

/* ---------- スマホ 3 枚 ---------- */
const bgHome = svgContours({ w: 375, h: 780, seed: 21, levels: 16, hills: [[0.8, 0.3, 0.25, 0.4, 0.3, 1], [0.2, 0.9, 0.3, 0.2, 0, 0.6]] });
const bgMenu = svgContours({ w: 375, h: 780, seed: 15, levels: 24, hills: [[0.3, 0.75, 0.3, 0.25, 0.4, 1], [0.9, 0.2, 0.2, 0.3, 0, 0.5], [0.5, 0.45, 0.2, 0.2, 0, 0.4]] });
const bgPc = svgContours({ w: 240, h: 780, seed: 33, levels: 14, hills: [[0.4, 0.85, 0.5, 0.2, 0.3, 1]] });

const mHome = `<div class="scr mob"><div class="bgc" style="opacity:.35">${bgHome}</div>
<div class="top"><b>そらばん</b><span class="mono">10/25（日）</span></div>
<div class="pad">
  <div class="pan nextf"><span class="bar"></span><div class="k">次の飛行</div>
    <div class="time mono">9:30<small>–10:15</small></div>
    <div class="where">弓ヶ浜（米子市）　DID 外・目視内</div>
    <div class="chips">${chip("blue", "手続き済み")}</div>
    ${btn("cta", "飛行前点検へ", true)}</div>
  <div class="sec"><span class="bar"></span><h3>今日の予定</h3></div>
  <div class="row"><span class="mono">8:50</span><span>飛行前点検</span><span class="w mono">6 / 9</span></div>
  <div class="row"><span class="mono">9:30</span><span>飛行　弓ヶ浜</span><span class="w mono">〜10:15</span></div>
  <div class="row"><span class="mono">11:00</span><span>飛行日誌を書く</span><span class="w">未</span></div>
  <div class="due"><div class="d1"><span class="mono">あと 2 日</span>${chip("amber", "要手続き")}</div><div class="d2">飛行許可・承認の申請<br><small>11月11日の飛行　期限 10月27日（火）</small></div></div>
</div>${tabbar("ホーム")}</div>`;

const mCheck = `<div class="scr mob"><div class="top"><b>飛行前点検</b><span class="mono">6 / 9</span></div>
<div class="pad" style="padding-top:18px">
  <div class="prog"><div class="segs"><i class="f"></i><i class="f"></i><i class="f"></i><i class="f"></i><i class="f"></i><i class="f"></i><i></i><i></i><i></i></div>
  <div class="pl mono">確認済み 6 / 9　異常 1</div></div>
  <div class="list">
  ${chk("ok", "機体全般", "機器の取付状態")}${chk("ng", "プロペラ", "先端に欠け")}${chk("ok", "フレーム")}${chk("ok", "通信系統")}${chk("ok", "推進系統")}${chk("ok", "電源系統")}${chk("un", "自動制御系統")}${chk("un", "操縦装置")}${chk("un", "バッテリー・燃料")}
  </div>
  <div style="margin-top:14px">${btn("off", "点検完了（あと 3 項目）")}</div>
</div>${tabbar("計画")}</div>`;

const mMenu = `<div class="scr mob"><div class="bgc">${bgMenu}</div>
<div class="top"><b>そらばん</b><span class="mono">10/25（日）</span></div>
<div class="pad" style="padding-top:14px"><div class="mlist">
  ${mi("ホーム", "HOME", { cur: 1 })}${mi("判定", "JUDGE")}${mi("飛行計画", "PLANS")}${mi("点検", "CHECKS", { n: 3 })}${mi("飛行日誌", "LOG")}${mi("通報・許可", "REPORTS", { n: 1 })}${mi("機体", "AIRCRAFT")}${mi("設定", "SETTINGS")}
</div></div>${tabbar("ホーム", true)}</div>`;

/* ---------- PC 1 枚 ---------- */
const pc = `<div class="scr pc"><div class="top"><div class="tl"><b>そらばん</b></div><span class="mono">2026-10-25（日）</span></div>
<div class="side"><div class="bgc" style="opacity:.4">${bgPc}</div><div class="mlist" style="position:relative">
  ${mi("ホーム", "HOME", { cur: 1 })}${mi("判定", "JUDGE")}${mi("飛行計画", "PLANS")}${mi("点検", "CHECKS", { n: 3 })}${mi("飛行日誌", "LOG")}${mi("通報・許可", "REPORTS", { n: 1 })}${mi("機体", "AIRCRAFT")}${mi("設定", "SETTINGS")}
</div></div>
<div class="main">
  <div class="grid">
    <div class="pan nextf big"><span class="bar"></span><div class="k">次の飛行</div>
      <div class="time mono">9:30<small>–10:15</small></div>
      <div class="where">弓ヶ浜（米子市）　DID 外・目視内</div>
      <div class="chips">${chip("blue", "手続き済み")}</div>
      <div class="acts">${btn("cta", "飛行前点検へ", true)}${btn("sub", "判定をやり直す")}</div></div>
    <div class="card dues"><div class="sec"><span class="bar"></span><h3>近づく期限</h3></div>
      <div class="due"><div class="d1"><span class="mono">あと 2 日</span>${chip("amber", "要手続き")}</div><div class="d2">飛行許可・承認の申請<br><small>11月11日の飛行　期限 10月27日（火）</small></div></div>
      <div class="due"><div class="d1"><span class="mono">未記入</span>${chip("amber", "要手続き")}</div><div class="d2">飛行日誌<br><small>10月24日の飛行　弓ヶ浜</small></div></div>
    </div>
  </div>
  <div class="card recent"><div class="sec"><span class="bar"></span><h3>直近の飛行</h3></div>
    <div class="trow th mono"><span>日付</span><span>時刻</span><span>場所</span><span style="text-align:right">時間</span><span>日誌</span></div>
    <div class="trow"><span class="mono">10/24</span><span class="mono">14:10–14:42</span><span>弓ヶ浜</span><span class="mono" style="text-align:right">32 分</span><span>未記入</span></div>
    <div class="trow"><span class="mono">10/19</span><span class="mono">10:05–10:31</span><span>皆生海岸</span><span class="mono" style="text-align:right">26 分</span><span>記入済み</span></div>
    <div class="trow"><span class="mono">10/12</span><span class="mono">9:20–9:52</span><span>弓ヶ浜</span><span class="mono" style="text-align:right">32 分</span><span>記入済み</span></div>
  </div>
</div></div>`;

/* ---------- 部品一覧 ---------- */
const parts = `
<div class="pg"><div class="pk">ボタン　主・副・CTA・危険・無効</div>
  <div class="brow">${btn("main", "判定を見る", true)}${btn("sub", "判定をやり直す")}</div>
  <div class="brow">${btn("cta", "飛行前点検へ", true)}${btn("danger", `${ico("s-red")}計画を削除`)}</div>
  <div class="brow">${btn("off", "点検完了（あと 3 項目）")}</div>
  <p class="cap">主＝普通の前向きの操作。CTA＝1 画面に 1 つ（橙の面）。危険＝取り消せない操作（赤の線と文字＋×の印）。無効は破線＋文言で理由を書く。高さ 52px。</p></div>
<div class="pg"><div class="pk">入力欄　通常・フォーカス・エラー（ラベルは常に見える位置）</div>
  <div class="frow">${field("", "飛行場所", "弓ヶ浜")}${field("focus", "開始時刻", "9:30")}</div>
  <div class="frow">${field("err", "飛行高度（m）", "180", "150 m 以上は許可が必要です。高度を下げるか、手続きに進んでください。")}</div></div>
<div class="pg"><div class="pk">チェック項目　正常・異常・未確認（記号＋文言＋形。下段はグレースケール）</div>
  <div class="two"><div class="list">${chk("ok", "フレーム")}${chk("ng", "プロペラ", "先端に欠け")}${chk("un", "操縦装置")}</div>
  <div class="list gray">${chk("ok", "フレーム")}${chk("ng", "プロペラ", "先端に欠け")}${chk("un", "操縦装置")}</div></div></div>
<div class="pg"><div class="pk">判定の 4 段の印　色＋形＋文言（下段はグレースケール）</div>
  <div class="chips2">${chip("red", "飛行不可")}${chip("amber", "要手続き")}${chip("blue", "手続き済み")}${chip("green", "手続き不要")}</div>
  <div class="chips2 gray">${chip("red", "飛行不可")}${chip("amber", "要手続き")}${chip("blue", "手続き済み")}${chip("green", "手続き不要")}</div></div>
<div class="pg"><div class="pk">カード・パネル　メニューの項目・件数バッジ・丸い操作部品</div>
  <div class="two" style="align-items:start">
    <div class="card"><span class="bar"></span><div class="cti">近づく期限</div><div class="cb2">飛行許可・承認の申請<br><small>11月11日の飛行　期限 10月27日（火）</small></div></div>
    <div class="pan"><span class="bar"></span><div class="cti">次の飛行</div><div class="mono" style="font-size:36px;line-height:1.2">9:30<small style="font-size:16px">–10:15</small></div></div>
  </div>
  <div class="two" style="margin-top:18px;align-items:start">
    <div class="mlist">${mi("ホーム", "HOME", { cur: 1 })}${mi("点検", "CHECKS", { n: 3 })}${mi("通報・許可", "REPORTS", { n: 1 })}</div>
    <div class="smalls"><span class="cnt">3</span><span class="rar">${ico("s-arrow")}</span>${hb()}<span class="locdot"><span class="pip"></span></span><span class="cap">件数・丸の矢印・ハンバーガー・現在地。丸はここまで。</span></div>
  </div>
  <div class="mobv"><span class="cap" style="display:block;margin:18px 0 8px">スマホ幅の値（B は カード 8px・入力 4px。A は同じく 0）</span>
    <div class="two"><div class="card" style="padding:14px 16px"><div class="cti" style="margin:0">カード</div></div>${field("", "飛行場所", "弓ヶ浜")}</div></div>
</div>`;

/* ---------- コントラスト実測 ---------- */
const W = "#FFFFFF";
const tw = rgbHex(transWhite);
const fmt = (n) => n.toFixed(2);
const row = (name, fg, bg, note = "") => {
  const r = ratio(fg, bg);
  const mk = (t) => (r >= t ? '<b class="ok2">○</b>' : '<b class="ng2">×</b>');
  return `<tr><td class="sm"><span style="color:${fg};background:${bg}">Aあ</span></td><td>${name}</td><td class="r mono">${fmt(r)}</td><td class="c">${mk(4.5)}</td><td class="c">${mk(7)}</td><td class="nt">${note}</td></tr>`;
};
const rowsCommon = [
  ["本文　墨 / 生成り", C.ink, C.base],
  ["注記　g700 / 生成り", C.g700, C.base],
  ["補助　g500 / 生成り（英字の添え書きだけ）", C.g500, C.base, "注記には使わない"],
  ["銅の文字　B4541F / 生成り", C.copper, C.base, "★ 文字には 8A3A10 を使う"],
  ["銅の文字（直した値）8A3A10 / 生成り", C.copperText, C.base],
  ["橙の面の文字　墨 / 橙", C.ink, C.orange],
  ["橙の面の境界　橙 / 生成り", C.orange, C.base, "★ 面だけでは見えない。墨 1px の線を足す"],
  ["橙の面の境界（直した値）墨 / 生成り", C.ink, C.base],
  ["危険　赤の文字と線 9A1A24 / 白", C.redText, W, "旧 B3202B は 6.65"],
  ["エラーの文字と線 9A1A24 / 生成り", C.redText, C.base],
  ["フォーカスの線　墨 / 白", C.ink, W, "太さ 2px＋外側に橙 3px"],
  ["判定　白 / 赤 A81D28", W, C.red, "★ 旧 B3202B は 6.65"],
  ["判定　墨 / 黄（黄は暗い文字なので元から足りている）", C.ink, C.amber],
  ["判定　白 / 青 1D5A8E", W, C.blue, "旧のまま（7.2 で足りていた）"],
  ["判定　白 / 緑 225F36", W, C.green, "★ 旧 2B6B3D は 6.42"],
  ["チェック「正常」の文字　緑 / 白", C.green, W, "★ 旧は 6.42"],
  ["チェック「正常」の文字　緑 / 生成り", C.green, C.base],
  ["無効ボタンの文字　g500 / くぼみ色", C.g500, C.sunken, "無効は基準の対象外。読める線は守る"],
];
const rowsA = [
  ["A 主ボタン　生成り文字 / 墨の面", C.base, C.ink],
  ["A 副ボタン・入力欄の線　edge / 生成り", C.edge, C.base, "★ 旧 6B6963 は 5.1"],
  ["A 入力欄の線　edge / くぼみ色", C.edge, C.sunken, "★ 旧は 4.6"],
  ["A くぼみ色 / 生成り（面の差）", C.sunken, C.base, "面の差は 1.1。境界は線が担う"],
];
const rowsB = [
  ["B 主ボタン　墨の文字 / 半透明の白(" + tw + ")", C.ink, tw],
  ["B 主ボタンの線　edge / 生成り", C.edge, C.base, "★ 旧 6B6963 は 5.1"],
  ["B 半透明の白 / 生成り（面の差）", tw, C.base, "面だけでは見えない。線が必須"],
  ["B 入力欄の線　edge / 白", C.edge, W],
  ["B カードの白 / 生成り（面の差）", W, C.base, "押せないので可。輪郭は影 24px 頼み"],
];
const rowsC = [
  ["C 主ボタン　生成り文字 / 墨の面", C.base, C.ink],
  ["C 副ボタン・入力欄の線　edge / 生成り", C.edge, C.base, "A と同じ線。角だけ 3px"],
  ["C 入力欄の線　edge / くぼみ色", C.edge, C.sunken],
  ["C 丸い矢印　生成り / 墨の円（主）", C.base, C.ink],
  ["C 丸い矢印　橙 / 墨の円（CTA）", C.orange, C.ink],
  ["C 現在の項目の押す領域　くぼみ色 / 生成り", C.sunken, C.base, "面の差は 1.1。位置は銅の点と太字が示す"],
];
const th = `<thead><tr><th>見本</th><th>組み合わせ</th><th style="text-align:right">比</th><th>4.5</th><th>7</th><th>備考</th></tr></thead>`;
const tbl = (rows) => `<table class="ct">${th}<tbody>${rows.map((r) => row(...r)).join("")}</tbody></table>`;

/* ---------- ページ ---------- */
const shell = (cls, inner) => `<div class="${cls}">${inner}</div>`;
const css = fs.readFileSync(path.join(here, "style.css"), "utf8");
const txt = fs.readFileSync(path.join(here, "text.html"), "utf8");
const T = (k) => txt.split(`<!--${k}-->`)[1].split("<!--/-->")[0];

let html = fs.readFileSync(path.join(here, "page.html"), "utf8");
const rep = {
  CSS: css.replace(/\{\{(\w+)\}\}/g, (_, k) => C[k] || ""),
  SVG, PARTS_A: shell("sa", parts), PARTS_B: shell("sb", parts), PARTS_C: shell("sc", parts),
  CT_COMMON: tbl(rowsCommon), CT_A: tbl(rowsA), CT_B: tbl(rowsB), CT_C: tbl(rowsC),
  M_HOME_A: shell("sa", mHome), M_HOME_B: shell("sb", mHome), M_HOME_C: shell("sc", mHome),
  M_CHECK_A: shell("sa", mCheck), M_CHECK_B: shell("sb", mCheck), M_CHECK_C: shell("sc", mCheck),
  M_MENU_A: shell("sa", mMenu), M_MENU_B: shell("sb", mMenu), M_MENU_C: shell("sc", mMenu),
  PC_A: shell("sa", pc), PC_B: shell("sb", pc), PC_C: shell("sc", pc),
  SUMMARY: T("summary"), NOTES_HOME: T("n-home"), NOTES_CHECK: T("n-check"), NOTES_MENU: T("n-menu"), NOTES_PC: T("n-pc"), NOTES_C: T("n-c"), VERDICT: T("verdict"),
};
for (const [k, v] of Object.entries(rep)) html = html.replace(`{{${k}}}`, () => v);
fs.writeFileSync(path.join(here, "index.html"), html);
console.log("ok", (html.length / 1024).toFixed(0) + "KB");
