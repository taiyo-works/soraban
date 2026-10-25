// 実行: node docs/design/warm-compare/src/build.mjs
// 3 案（a.html / b.html / c.html）を単体の HTML として書き出す。外部通信なし（フォントは端末のもの）。
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, "..");

// ───────── 共通の土台（FINESYSTEM 由来）─────────
const BASE = {
  orange: "#F89B48", orangeDeep: "#E99347", orangeLight: "#FFC189",
  white: "#FFFFFF", off: "#F7F7F3", beige: "#EDEDE5",
  ink: "#262523", ink2: "#4A4843", ink3: "#5F5D57", ph: "#68655B", rule: "#C4C4C4", edge: "#5F5D57",
  teal: "#2EBEC4", tealDeep: "#0F6B70", kincha: "#D7A761", pink: "#CF727C", plum: "#A2689B", sky: "#DEF3F4",
  // 判定色は橙と別系統（結果の色）
  no: "#A81D28", noFg: "#9A1A24", needs: "#EDB800", needsFg: "#6B5800", done: "#262523", none: "#225F36", unknown: "#4F5762",
};

// ゆらぎのある閉曲線で等高線を描く
function blob(cx, cy, r, seed, sx = 1, sy = 1) {
  const pts = [];
  const p1 = seed * 1.7, p2 = seed * 2.9, p3 = seed * 4.3;
  for (let i = 0; i <= 72; i++) {
    const t = (i / 72) * Math.PI * 2;
    const k = 1 + 0.13 * Math.sin(2 * t + p1) + 0.07 * Math.sin(3 * t + p2) + 0.035 * Math.sin(5 * t + p3);
    pts.push([cx + Math.cos(t) * r * k * sx, cy + Math.sin(t) * r * k * sy]);
  }
  return "M" + pts.map((p) => p[0].toFixed(1) + " " + p[1].toFixed(1)).join("L") + "Z";
}
function contours(cx, cy, n, r0, step, seed, sx = 1, sy = 1) {
  let s = "";
  for (let i = 0; i < n; i++) {
    const major = i % 4 === 3;
    s += `<path d="${blob(cx, cy, r0 + i * step, seed + i * 0.05, sx, sy)}" class="${major ? "ct-major" : "ct"}"/>`;
  }
  return s;
}

const DRONE = (cls = "") => `
<svg class="${cls}" viewBox="0 0 160 96" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <rect x="62" y="38" width="36" height="18" rx="9"/>
  <circle cx="80" cy="47" r="4.5"/>
  <path d="M64 42 L36 28 M96 42 L124 28 M64 52 L36 66 M96 52 L124 66"/>
  <ellipse cx="30" cy="24" rx="22" ry="4.5"/><ellipse cx="130" cy="24" rx="22" ry="4.5"/>
  <ellipse cx="30" cy="70" rx="22" ry="4.5"/><ellipse cx="130" cy="70" rx="22" ry="4.5"/>
  <path d="M30 24 V28 M130 24 V28 M30 66 V70 M130 66 V70"/>
  <path d="M70 58 V68 M90 58 V68 M64 68 H76 M84 68 H96"/>
</svg>`;

const CLOUD_PATH = "M26 62 C8 62 4 40 22 36 C22 18 46 10 58 24 C66 6 98 6 104 28 C124 22 142 36 134 52 C132 60 126 62 120 62 Z";
const CLOUD = () => `<svg viewBox="0 0 160 70" aria-hidden="true"><path d="${CLOUD_PATH}" fill="currentColor"/></svg>`;

const ARROW = `<svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 10 H15 M10.5 5.5 L15 10 L10.5 14.5"/></svg>`;
const EXT = `<svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 4 H16 V13 M16 4 L5 15"/></svg>`;
const PIN_ICON = `<svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="10" cy="10" r="3.2"/><circle cx="10" cy="10" r="7"/><path d="M10 1.5 V4 M10 16 V18.5 M1.5 10 H4 M16 10 H18.5" stroke-linecap="round"/></svg>`;
const CHECK = `<svg class="chk" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8.5 L6.5 12 L13 4.5"/></svg>`;

// 判定マーク（形で区別：×四角 / △ / ○にチェック / ○の輪 / 点線の四角に？）
const symbols = (r) => `
<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
  <symbol id="m-no" viewBox="0 0 24 24"><rect x="3.5" y="3.5" width="17" height="17" rx="${r}" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M8.6 8.6 L15.4 15.4 M15.4 8.6 L8.6 15.4" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" fill="none"/></symbol>
  <symbol id="m-needs" viewBox="0 0 24 24"><path d="M12 3.6 L21.2 19.6 H2.8 Z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/><path d="M12 9.6 V14.2" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><circle cx="12" cy="17" r="1.3" fill="currentColor"/></symbol>
  <symbol id="m-done" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.6" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M7.8 12.4 L10.9 15.4 L16.4 9" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></symbol>
  <symbol id="m-none" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.2" fill="none" stroke="currentColor" stroke-width="3.4"/></symbol>
  <symbol id="m-unknown" viewBox="0 0 24 24"><rect x="3.5" y="3.5" width="17" height="17" rx="${r}" fill="none" stroke="currentColor" stroke-width="2.2" stroke-dasharray="3 2.6"/><path d="M9.7 9.6 a2.4 2.4 0 1 1 3.5 2.1 c-.8.5-1.2 1-1.2 1.9" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="16.9" r="1.2" fill="currentColor"/></symbol>
</defs></svg>`;
const vm = (k, cls = "vm") => `<svg class="${cls}" aria-hidden="true"><use href="#m-${k}"/></svg>`;
const LABEL = { no: "飛行不可", needs: "要手続き", done: "手続き済み", none: "手続き不要", unknown: "判定不能" };
const vtag = (k, text = LABEL[k]) => `<span class="vtag v-${k}">${vm(k)}<span>${text}</span></span>`;

// ───────── 地図 ─────────
function mapSvg(d) {
  return `
<svg class="map-svg" viewBox="0 0 640 440" preserveAspectRatio="xMidYMid slice" role="img" aria-label="米子市役所の周辺の地図。人口集中地区（斜線の面）の中に現在地の印があり、右下に空港等周辺の破線の円がある。">
  <defs>
    <pattern id="hatch" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="9" height="9" fill="var(--did-tint)"/><path d="M0 0V9" stroke="var(--did-line)" stroke-width="3"/></pattern>
    <pattern id="dots" width="9" height="9" patternUnits="userSpaceOnUse"><circle cx="4.5" cy="4.5" r="1.7" fill="var(--park-line)"/></pattern>
  </defs>
  <rect width="640" height="440" fill="var(--map-land)"/>
  <path d="M430 0 C470 40 560 50 640 40 V0 Z M0 400 C60 380 120 420 200 440 H0 Z" fill="var(--map-water)"/>
  <path d="M430 0 C470 40 560 50 640 40" fill="none" stroke="var(--map-shore)" stroke-width="3"/>
  <g fill="none">${contours(110, 330, 7, 34, 26, 1.3, 1.25, 0.9)}${contours(540, 150, 6, 30, 24, 4.1, 1.1, 0.8)}</g>
  <g fill="none" stroke-linecap="round">
    <path d="M0 250 C120 230 220 260 330 232 S520 200 640 230" stroke="var(--road-casing)" stroke-width="12"/>
    <path d="M0 250 C120 230 220 260 330 232 S520 200 640 230" stroke="var(--road)" stroke-width="8"/>
    <path d="M330 232 C340 150 300 90 320 0" stroke="var(--road-casing)" stroke-width="10"/>
    <path d="M330 232 C340 150 300 90 320 0" stroke="var(--road)" stroke-width="6"/>
    <path d="M330 232 C350 300 420 340 470 440" stroke="var(--road-casing)" stroke-width="10"/>
    <path d="M330 232 C350 300 420 340 470 440" stroke="var(--road)" stroke-width="6"/>
  </g>
  <path d="M232 168 Q300 120 392 150 Q452 196 430 270 Q380 322 290 306 Q222 270 232 168 Z" fill="url(#hatch)" stroke="var(--did-line)" stroke-width="3" stroke-linejoin="round"/>
  <path d="M70 90 Q110 60 170 80 Q190 120 150 150 Q90 160 70 90 Z" fill="url(#dots)" stroke="var(--park-line)" stroke-width="2.4" stroke-dasharray="2 5" stroke-linecap="round"/>
  <circle cx="560" cy="372" r="86" fill="none" stroke="var(--air-line)" stroke-width="3" stroke-dasharray="10 7"/>
  <path d="M520 372 H600" stroke="var(--air-line)" stroke-width="5" stroke-linecap="round"/>
  <circle cx="330" cy="232" r="46" fill="var(--pin-halo)" stroke="var(--ink)" stroke-width="2" stroke-dasharray="2 5" stroke-linecap="round"/>
  <circle cx="330" cy="232" r="13" fill="var(--orange)" stroke="var(--ink)" stroke-width="3.5"/>
  <circle cx="330" cy="232" r="4" fill="var(--ink)"/>
  <g font-size="24" font-weight="700" fill="var(--ink)">
    <rect x="352" y="196" width="150" height="34" rx="${d.mapChipR}" fill="#fff" stroke="var(--ink)" stroke-width="2"/>
    <text x="364" y="221">米子市役所</text>
    <rect x="248" y="262" width="62" height="32" rx="${d.mapChipR}" fill="var(--ink)"/><text x="259" y="285" fill="#fff" font-size="22">DID</text>
    <text x="440" y="344" font-size="22">空港等周辺</text>
    <text x="84" y="190" font-size="22">公園</text>
  </g>
</svg>`;
}

const LAYERS = [
  ["DID", "did", true], ["工業専用", "ind", false], ["空港等周辺", "air", true], ["小型無人機法", "law", true],
  ["都市公園", "park", true], ["指定史跡", "heri", false], ["公衆密集地", "crowd", true],
];
const swatch = (k) => ({
  did: `<svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><rect x="2" y="3" width="16" height="14" rx="2" fill="var(--did-tint)" stroke="var(--did-line)" stroke-width="2"/><path d="M5 15 L15 5 M9 16 L17 8 M3 11 L9 5" stroke="var(--did-line)" stroke-width="1.6"/></svg>`,
  ind: `<svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><rect x="2" y="3" width="16" height="14" rx="2" fill="#B9B7AE" stroke="#4A4843" stroke-width="1.6"/></svg>`,
  air: `<svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><circle cx="10" cy="10" r="7.5" fill="none" stroke="var(--air-line)" stroke-width="2.2" stroke-dasharray="3.4 2.4"/></svg>`,
  law: `<svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><circle cx="10" cy="10" r="7.5" fill="none" stroke="var(--ink)" stroke-width="2.2"/><circle cx="10" cy="10" r="2.6" fill="var(--ink)"/></svg>`,
  park: `<svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><rect x="2" y="3" width="16" height="14" rx="5" fill="none" stroke="var(--park-line)" stroke-width="2" stroke-dasharray="1.5 3.2" stroke-linecap="round"/><circle cx="7" cy="10" r="1.4" fill="var(--park-line)"/><circle cx="13" cy="10" r="1.4" fill="var(--park-line)"/></svg>`,
  heri: `<svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><path d="M10 2.5 L17.5 10 L10 17.5 L2.5 10 Z" fill="none" stroke="var(--ink)" stroke-width="2"/></svg>`,
  crowd: `<svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><circle cx="10" cy="10" r="7.5" fill="none" stroke="var(--ink)" stroke-width="2.2" stroke-dasharray="1.2 3.2" stroke-linecap="round"/></svg>`,
}[k]);

const ITEMS = [
  ["国", "航空法 第132条の85　人口集中地区（DID）", "この地点は DID の中です。無人航空機を飛ばすには国土交通大臣の許可・承認が要ります。", "needs"],
  ["国", "航空法　空港等周辺", "空港等の周辺区域の外です。", "none"],
  ["国", "小型無人機等飛行禁止法", "対象施設の周辺地域の外です。", "none"],
  ["県", "鳥取県 迷惑行為等防止条例（庁舎の周辺 100m）", "施設管理者の同意を記録済みです。条件：飛行前に管理者へ連絡。", "done"],
  ["市", "米子市 都市公園条例", "公園の区域データが未整備のため、判定できません。市の窓口で確認してください。", "unknown"],
];

function page(d) {
  const sec = (n, id, title, note = "") => `<div class="sec-head"><span class="sec-num" aria-hidden="true">${n}</span><h2 id="${id}">${title}</h2>${note ? `<p class="sec-note">${note}</p>` : ""}</div>`;
  const pill = (cls, label, icon = ARROW) => `<button type="button" class="pill ${cls}"><span class="pill-label">${label}</span><span class="pill-arrow">${icon}</span></button>`;
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>そらばん 判定画面 ${d.name}</title>
<style>
${css(d)}
</style>
</head>
<body class="d-${d.id}">
${symbols(d.markR)}
${d.defs ?? ""}
<div class="page">

<header class="hero band band-white">
  ${d.hero}
  <div class="hero-text">
    <p class="brand"><span class="brand-mark" aria-hidden="true">${DRONE("brand-drone")}</span>そらばん</p>
    <h1>ドローン飛行の可否判定と運航管理</h1>
    <p class="lead"><strong>業務でドローンを飛ばす事業者・操縦者のための道具です。</strong>飛ばす前に、その地点がどの法令・条例に当たり、どの手続きが要るかを一度に確かめ、出典つきの記録として残せます。</p>
    <dl class="facts">
      <div><dt>運営者</dt><dd>フューチャーテック株式会社</dd></div>
      <div><dt>利用の範囲</dt><dd>現在は社内での試験運用中</dd></div>
      <div><dt>対象地域</dt><dd>鳥取県・島根県</dd></div>
    </dl>
  </div>
</header>

<section class="band band-off" aria-labelledby="h-check">
  ${sec("01", "h-check", "地点を判定する", "住所・座標・地図のクリックで地点を指定できます")}
  <div class="check-grid">
    <div class="col-left">
      <form class="block input-block" onsubmit="return false">
        <label for="addr">住所または緯度・経度</label>
        <input id="addr" type="text" value="鳥取県米子市加茂町1丁目1番地" placeholder="例: 鳥取県米子市加茂町1丁目1番地">
        <p class="hint">国土地理院の住所検索で位置を決めます。座標（35.4283, 133.3306）や Google マップの URL も貼れます。</p>
        <div class="btn-row">
          ${pill("pill-primary", "この地点を判定する")}
          ${pill("pill-secondary", "現在地で判定", PIN_ICON)}
        </div>
      </form>

      <article class="block verdict-block" aria-labelledby="h-verdict">
        ${d.verdictHead}
        <p class="v-lead">この地点で飛ばすには、<strong>手続きが 1 件</strong>必要です。許可・承認が下りるまで飛行は始められません。</p>
        <div class="v-meta"><span class="tag-pill">確認日 2026-10-25</span><span class="tag-pill">出典つき</span></div>
        <div class="v-meta"><button type="button" class="pill pill-secondary pill-sm"><span class="pill-label">結果を PDF で保存</span><span class="pill-arrow">${ARROW}</span></button></div>
      </article>
    </div>

    <div class="col-right">
      <div class="block map-block">
        ${d.mapDeco ?? ""}
        <div class="map-frame">${mapSvg(d)}</div>
        <div class="layers" role="group" aria-label="規制レイヤー">
          <p class="layers-title">規制レイヤー（5/7 表示）<span>押すと地図の表示を切り替えます</span></p>
          <div class="chips">
            ${LAYERS.map(([label, k, on]) => `<button type="button" class="chip ${on ? "is-on" : "is-off"}" aria-pressed="${on}">${on ? CHECK : '<span class="chk-empty" aria-hidden="true"></span>'}${swatch(k)}<span>${label}</span></button>`).join("")}
          </div>
        </div>
      </div>
    </div>
  </div>
</section>

<section class="band band-beige" aria-labelledby="h-proc">
  ${sec("02", "h-proc", "要手続きの手続き", "期限の近い順に並べています")}
  <div class="proc-grid">
    <article class="block proc">
      <span class="proc-no" aria-hidden="true">1</span>
      <div class="proc-body">
        <h3>無人航空機の飛行許可・承認の申請（DID の上空）</h3>
        <p class="proc-where">出す先：国土交通省 DIPS 2.0（オンライン）</p>
        <div class="tags"><span class="tag-pill tag-deadline">期限　飛行の 10 開庁日前まで</span><span class="tag-pill">法令　国（航空法）</span></div>
        <p class="proc-note">申請書はご本人の名義で作成し、ご本人が提出します。そらばんは入力項目の下書きまでを手伝います。</p>
        <button type="button" class="pill pill-secondary pill-sm"><span class="pill-label">DIPS 2.0 を開く</span><span class="pill-arrow">${EXT}</span></button>
      </div>
    </article>
    <article class="block proc proc-done">
      <span class="proc-no" aria-hidden="true">${vm("done", "vm vm-lg")}</span>
      <div class="proc-body">
        <h3>庁舎周辺での飛行（鳥取県条例）</h3>
        <p class="proc-where">記録：施設管理者の同意（本人入力）</p>
        <div class="tags"><span class="tag-pill">条件　飛行前に管理者へ連絡</span><span class="tag-pill">法令　県</span></div>
        <p class="proc-note">ご本人が自分で手続きを済ませた記録の表示です。そらばんが手続きを行ったわけではありません。</p>
      </div>
    </article>
  </div>
</section>

<section class="band band-white" aria-labelledby="h-items">
  ${sec("03", "h-items", "規制ごとの判定", "形と言葉で見分けられます。色だけでは区別しません")}
  <ul class="items block">
    ${ITEMS.map(([src, title, note, k]) => `<li class="item"><span class="src src-${src}">${src}</span><div class="item-text"><p class="item-title">${title}</p><p class="item-note">${note}</p></div>${vtag(k)}</li>`).join("")}
  </ul>
  <div class="legend block-soft" aria-label="判定の見分け方">
    <p class="legend-title">判定の見分け方</p>
    <div class="legend-row">${["no", "needs", "done", "none", "unknown"].map((k) => vtag(k)).join("")}</div>
  </div>
</section>

<section class="band band-off foot" aria-labelledby="h-disc">
  <h2 id="h-disc" class="disc-title">免責事項</h2>
  <p class="disc">本ツールは参考情報であり、飛行可否を最終的に保証するものではありません。緊急用務空域等の動的情報は反映していません。実運用前に必ず <a href="#">国土交通省 DIPS</a>、警察庁、各自治体の最新情報をご確認ください。自治体の条例データの一部は手作業で収録しており、各データに確認日と確からしさ（低・中・高）を付けています。</p>
  <p class="copy">© 2026 フューチャーテック株式会社　鳥取県西伯郡日吉津村</p>
  <p class="src-note">出典：国土交通省「国土数値情報（人口集中地区 A16 令和2年、用途地域 A29 令和元年度）」、国土地理院ジオコーダ・住所検索・ベクタータイル、警察庁・防衛省（小型無人機等飛行禁止法）、鳥取県・島根県例規集。画面の文言は表示見本です。</p>
</section>

</div>
</body>
</html>`;
}

// ───────── CSS ─────────
function css(d) {
  const t = { ...BASE, ...d.tokens };
  return `
:root{
  --orange:${t.orange}; --orange-deep:${t.orangeDeep}; --orange-light:${t.orangeLight};
  --white:${t.white}; --off:${t.off}; --beige:${t.beige};
  --ink:${t.ink}; --ink-2:${t.ink2}; --ink-3:${t.ink3}; --ph:${t.ph}; --rule:${t.rule}; --edge:${t.edge};
  --teal:${t.teal}; --teal-deep:${t.tealDeep}; --kincha:${t.kincha}; --pink:${t.pink}; --sky:${t.sky};
  --v-no:${t.no}; --v-no-fg:${t.noFg}; --v-needs:${t.needs}; --v-needs-fg:${t.needsFg}; --v-done:${t.done}; --v-none:${t.none}; --v-unknown:${t.unknown};
  --r-l:${d.r.l}px; --r-m:${d.r.m}px; --r-s:${d.r.s}px; --pill:9999px;
  --shadow:${d.shadow};
  --map-land:${d.map.land}; --map-water:${d.map.water}; --map-shore:${d.map.shore};
  --road:${d.map.road}; --road-casing:${d.map.casing};
  --did-tint:${d.map.didTint}; --did-line:${d.map.didLine}; --park-line:${d.map.park}; --air-line:${d.map.air}; --pin-halo:${d.map.halo};
  --ease:cubic-bezier(.22,.8,.2,1);
  --font:"Noto Sans JP","Plus Jakarta Sans","Hiragino Sans","Yu Gothic UI","Yu Gothic","IPAGothic","IPAPGothic",sans-serif;
}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--white);color:var(--ink);font-family:var(--font);font-size:15px;line-height:1.75;letter-spacing:.03em;line-break:strict;word-break:auto-phrase;overflow-wrap:anywhere}
h1,h2,h3,p,ul,dl,dd,figure{margin:0;padding:0}
ul{list-style:none}
button{font:inherit;color:inherit;letter-spacing:inherit}
a{color:var(--ink);text-underline-offset:3px;text-decoration-thickness:2px;text-decoration-color:var(--orange)}
:focus-visible{outline:3px solid var(--ink);outline-offset:3px}
.page{overflow:hidden}

/* 面は白・オフホワイト・ベージュを交互に敷く */
.band{position:relative;padding:40px 16px}
.band>*{max-width:1120px;margin-left:auto;margin-right:auto}
.band-white{background:var(--white)}
.band-off{background:var(--off)}
.band-beige{background:var(--beige)}

/* 見出し：左 5px の橙線＋背後の大きな薄い数字 */
.sec-head{position:relative;margin-bottom:22px;padding:6px 0 6px 14px;border-left:5px solid var(--orange);min-height:56px;display:flex;flex-direction:column;justify-content:center;gap:2px}
.sec-head h2{font-size:22px;line-height:1.4;letter-spacing:.06em;font-weight:700}
.sec-num{position:absolute;right:0;top:-34px;font-size:112px;line-height:1;font-weight:800;letter-spacing:0;color:rgba(248,155,72,.2);font-family:"Plus Jakarta Sans","Noto Sans JP",sans-serif;pointer-events:none;z-index:0}
.sec-head h2,.sec-note{position:relative;z-index:1}
.sec-note{font-size:13px;color:var(--ink-3);line-height:1.6}

/* ヒーロー */
.hero{padding-top:28px;padding-bottom:36px}
.hero-text{position:relative;z-index:2;display:flex;flex-direction:column;gap:14px}
.brand{display:flex;align-items:center;gap:10px;font-size:34px;font-weight:800;letter-spacing:.1em;line-height:1.2}
.brand-mark{display:inline-flex;width:44px;height:44px;align-items:center;justify-content:center;border-radius:var(--pill);background:var(--orange);color:var(--ink)}
.brand-drone{width:30px;height:auto}
h1{font-size:17px;font-weight:700;color:var(--ink-2);letter-spacing:.06em;line-height:1.5}
.lead{max-width:40em;font-size:15px;line-height:1.9;color:var(--ink-2)}
.lead strong{display:block;color:var(--ink);font-weight:700}
.facts{display:grid;grid-template-columns:1fr;gap:6px;max-width:640px;margin-top:4px;padding:12px 0;border-top:1px solid var(--rule);border-bottom:1px solid var(--rule)}
.facts div{display:grid;grid-template-columns:6.2em 1fr;gap:8px;font-size:13px;line-height:1.6}
.facts dt{color:var(--ink-3)}

/* 面（ブロック） */
.block{background:var(--white);border-radius:var(--r-l);box-shadow:var(--shadow);padding:20px 16px}
.band-white .block{background:var(--off)}
.block-soft{border-radius:var(--r-l);background:var(--off);padding:16px;margin-top:16px}
.check-grid{display:grid;grid-template-columns:1fr;gap:20px}
.col-left{display:flex;flex-direction:column;gap:20px;min-width:0}
.col-right{min-width:0}

/* 入力 */
.input-block label{display:block;font-size:14px;font-weight:700;margin-bottom:8px;letter-spacing:.05em}
input[type=text]{width:100%;height:52px;border:1.5px solid var(--edge);border-radius:var(--r-m);background:#fff;padding:0 16px;font:inherit;font-size:16px;color:var(--ink);letter-spacing:.03em}
input::placeholder{color:var(--ph);opacity:1}
.hint{margin-top:8px;font-size:12.5px;line-height:1.7;color:var(--ink-3)}
.btn-row{display:flex;flex-direction:column;gap:12px;margin-top:16px}

/* ピルボタン：右端に墨の丸＋白い矢印。ホバー/押下/フォーカスで丸が橙に変わる */
.pill{position:relative;display:inline-flex;align-items:center;justify-content:space-between;gap:14px;min-height:52px;padding:4px 4px 4px 24px;border-radius:var(--pill);border:1px solid transparent;cursor:pointer;font-weight:700;font-size:15px;line-height:1.3;text-align:left;transition:background .5s var(--ease),color .5s var(--ease)}
.pill-label{flex:1;min-width:0}
.pill-arrow{flex:none;display:inline-flex;align-items:center;justify-content:center;width:44px;height:44px;border-radius:var(--pill);background:var(--ink);color:#fff;transition:background .5s var(--ease),color .5s var(--ease),transform .5s var(--ease)}
.pill-primary{background:var(--orange);color:var(--ink);min-height:56px;font-size:16px}
.pill-primary .pill-arrow{width:48px;height:48px}
.pill-primary:hover,.pill-primary:active,.pill-primary:focus-visible{background:var(--orange-light)}
.pill-secondary{background:rgba(255,255,255,.92);border-color:var(--rule);color:var(--ink)}
.pill-secondary:hover .pill-arrow,.pill-secondary:active .pill-arrow,.pill-secondary:focus-visible .pill-arrow{background:var(--orange);color:var(--ink);transform:translateX(2px)}
.pill-primary:hover .pill-arrow,.pill-primary:active .pill-arrow,.pill-primary:focus-visible .pill-arrow{background:#fff;color:var(--ink);transform:translateX(2px)}
.pill-sm{min-height:48px;font-size:14px;padding-left:20px}
.pill-sm .pill-arrow{width:40px;height:40px}

/* 判定タグ：形のマークと言葉をセットで */
.vtag{display:inline-flex;align-items:center;gap:6px;min-height:30px;padding:3px 14px 3px 8px;border-radius:var(--pill);font-size:13px;font-weight:700;line-height:1.3;white-space:nowrap}
.vm{width:20px;height:20px;flex:none}
.vm-lg{width:28px;height:28px}
.v-no{background:var(--v-no);color:#fff}
.v-needs{background:var(--v-needs);color:var(--ink);box-shadow:inset 0 0 0 2px var(--v-needs-fg)}
.v-done{background:var(--v-done);color:#F7F7F3}
.v-none{background:var(--v-none);color:#fff}
.v-unknown{background:#fff;color:var(--v-unknown);box-shadow:inset 0 0 0 1.5px var(--v-unknown)}
.tag-pill{display:inline-flex;align-items:center;min-height:28px;padding:2px 12px;border-radius:var(--pill);background:var(--white);border:1px solid var(--rule);font-size:12.5px;line-height:1.4;color:var(--ink-2);font-weight:500}
.band-white .tag-pill{background:var(--off)}
.tag-deadline{background:var(--orange-light)!important;border-color:transparent;color:var(--ink);font-weight:700}

/* 結論 */
.verdict-block{display:flex;flex-direction:column;gap:14px}
.v-head{display:flex;align-items:center;gap:14px}
.v-big{flex:none;width:68px;height:68px;display:flex;align-items:center;justify-content:center;background:var(--v-needs);color:var(--ink);box-shadow:inset 0 0 0 3px var(--v-needs-fg);border-radius:var(--r-m)}
.v-big svg{width:44px;height:44px}
.v-eyebrow{font-size:13px;color:var(--ink-3);font-weight:500;letter-spacing:.08em}
.v-word{font-size:30px;font-weight:800;line-height:1.25;letter-spacing:.08em}
.v-place{font-size:13px;color:var(--ink-3);line-height:1.6;margin-top:2px}
.v-lead{font-size:15px;line-height:1.85}
.v-lead strong{background:linear-gradient(transparent 62%,var(--orange-light) 62%)}
.v-meta{display:flex;flex-wrap:wrap;align-items:center;gap:8px;position:relative;z-index:1}

/* 地図 */
.map-block{padding:12px;position:relative}
.map-frame{position:relative;border-radius:var(--r-m);overflow:hidden;border:1px solid var(--rule);aspect-ratio:640/440;background:var(--map-land)}
.map-svg{display:block;width:100%;height:100%}
.ct{stroke:var(--ct);stroke-width:1.4}
.ct-major{stroke:var(--ct-major);stroke-width:2.2}
.layers{padding:14px 4px 4px}
.layers-title{font-size:14px;font-weight:700;line-height:1.5;margin-bottom:10px}
.layers-title span{display:block;font-size:12.5px;font-weight:400;color:var(--ink-3)}
.chips{display:flex;flex-wrap:wrap;gap:8px}
.chip{display:inline-flex;align-items:center;gap:8px;min-height:44px;padding:6px 16px 6px 12px;border-radius:var(--pill);cursor:pointer;font-size:14px;font-weight:700;line-height:1.2;transition:background .5s var(--ease)}
.chip.is-on{background:#fff;border:2px solid var(--ink);color:var(--ink)}
.chip.is-off{background:transparent;border:2px dashed var(--edge);color:var(--ink-3);font-weight:500}
.chip.is-on .chk{flex:none;width:18px;height:18px;padding:2px;border-radius:var(--pill);background:var(--orange);color:var(--ink)}
.chip .chk-empty{flex:none;width:18px;height:18px;border-radius:var(--pill);border:2px solid var(--edge)}
.chip.is-off svg:not(.chk){opacity:.6}
.chip:hover{background:var(--orange-light)}

/* 手続き */
.proc-grid{display:grid;grid-template-columns:1fr;gap:16px}
.proc{display:flex;gap:14px;align-items:flex-start}
.proc-no{flex:none;width:40px;height:40px;border-radius:var(--pill);background:var(--ink);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:18px}
.proc-done .proc-no{background:var(--off);color:var(--v-done)}
.proc-body{display:flex;flex-direction:column;gap:8px;min-width:0}
.proc h3{font-size:16.5px;line-height:1.55;letter-spacing:.04em}
.proc-where{font-size:13.5px;color:var(--ink-2)}
.tags{display:flex;flex-wrap:wrap;gap:6px}
.proc-note{font-size:13px;line-height:1.75;color:var(--ink-3)}
.proc .pill{align-self:flex-start;margin-top:4px}

/* 規制ごとの判定 */
.items{padding:6px 16px}
.item{display:grid;grid-template-columns:36px 1fr;gap:6px 12px;padding:14px 0;border-bottom:1px solid var(--rule)}
.item:last-child{border-bottom:0}
.item .vtag{grid-column:2;justify-self:start}
.src{width:32px;height:32px;border-radius:var(--pill);display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;background:var(--beige);color:var(--ink)}
.item-title{font-size:15px;font-weight:700;line-height:1.55}
.item-note{font-size:13.5px;color:var(--ink-2);line-height:1.75;margin-top:2px}
.legend-title{font-size:13px;font-weight:700;margin-bottom:8px}
.legend-row{display:flex;flex-wrap:wrap;gap:8px}

/* 免責 */
.disc-title{font-size:14px;font-weight:700;margin-bottom:6px}
.disc{font-size:13px;line-height:1.9;color:var(--ink-2)}
.copy{margin-top:18px;font-size:13px;color:var(--ink-2)}
.src-note{margin-top:6px;font-size:12px;line-height:1.8;color:var(--ink-3)}
@media (min-width:900px){.disc,.src-note{padding-right:18%}}

.hero-art{position:absolute;pointer-events:none}

@media (min-width:900px){
  body{font-size:16px}
  .band{padding:64px 32px}
  .hero{padding-top:56px;padding-bottom:64px}
  .brand{font-size:48px}
  .brand-mark{width:60px;height:60px}.brand-drone{width:40px}
  h1{font-size:20px}
  .lead{font-size:16px}
  .facts{grid-template-columns:repeat(3,1fr);gap:24px;padding:16px 0}
  .facts div{grid-template-columns:1fr;gap:2px}
  .sec-head{margin-bottom:28px}
  .sec-head h2{font-size:26px}
  .sec-num{font-size:150px;top:-52px}
  .check-grid{grid-template-columns:minmax(0,5fr) minmax(0,6fr);gap:28px;align-items:start}
  .col-right{position:sticky;top:20px}
  .block{padding:28px 28px}
  .map-block{padding:14px}
  .proc-grid{grid-template-columns:1fr 1fr}
  .proc{padding:24px}
  .item{grid-template-columns:40px 1fr auto;align-items:center;gap:16px;padding:18px 0}
  .item .vtag{grid-column:3;justify-self:end}
  .items{padding:8px 28px}
  .v-word{font-size:36px}
  .v-big{width:80px;height:80px}.v-big svg{width:52px;height:52px}
}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
${d.css}
`;
}

// ───────── 案ごとの定義 ─────────
const CT_A = "--ct:rgba(233,147,71,.38);--ct-major:rgba(233,147,71,.7)";

// A：角丸 16/8/4＋ピル。FINESYSTEM に最も近い。
const A = {
  id: "a", name: "A 角をほんの少し丸める",
  r: { l: 16, m: 8, s: 4 }, markR: 3, mapChipR: 17,
  shadow: "0 0 24px rgba(0,0,0,.1)",
  map: { land: "#FBF6EC", water: "#DEF3F4", shore: "#2EBEC4", road: "#FFFFFF", casing: "#C4C4C4", didTint: "#FFE3C7", didLine: "#B3500A", park: "#225F36", air: "#4A4843", halo: "rgba(248,155,72,.28)" },
  tokens: {},
  hero: `<div class="hero-art art-a" aria-hidden="true">
    <svg viewBox="0 0 520 300" width="100%" height="100%" preserveAspectRatio="xMaxYMid slice" fill="none">
      <g style="${CT_A}">${contours(380, 170, 9, 28, 20, 2.2, 1.35, 0.95)}</g>
      <circle cx="420" cy="92" r="44" fill="#FFC189"/>
      <circle cx="420" cy="92" r="64" fill="none" stroke="#F89B48" stroke-width="3" stroke-dasharray="2 9" stroke-linecap="round"/>
      <path d="M40 250 C140 210 190 120 300 118 S440 76 500 40" stroke="#262523" stroke-width="2.4" stroke-dasharray="2 9" stroke-linecap="round"/>
    </svg>
    <div class="art-drone">${DRONE()}</div>
  </div>`,
  verdictHead: `<div class="v-head"><div class="v-big">${vm("needs", "vm")}</div><div><p class="v-eyebrow" id="h-verdict">結論</p><p class="v-word">要手続き</p><p class="v-place">米子市役所　35.4283, 133.3306</p></div></div>`,
  css: `
:root{${CT_A}}
.art-a{inset:0 0 0 auto;width:100%}
.art-a svg{position:absolute;inset:0}
.art-drone{position:absolute;right:18px;top:20px;width:92px;color:var(--ink)}
.art-drone svg{width:100%;height:auto}
.d-a .lead{max-width:30em}
@media (min-width:900px){
  .art-a{width:56%}
  .art-drone{right:12%;top:70px;width:190px;transform:rotate(-6deg)}
}
@media (max-width:899px){.art-a svg{opacity:.3}.art-a .art-drone{display:none}}
.d-a .brand-mark{box-shadow:0 0 0 4px var(--orange-light)}
`,
};

// B：紙の質感・手描き線・傾いたスタンプ
const paperNoise = encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency=".8" numOctaves="3" seed="7"/><feColorMatrix values="0 0 0 0 .35  0 0 0 0 .27  0 0 0 0 .18  0 0 0 .085 0"/></filter><rect width="240" height="240" filter="url(#n)"/></svg>`);
const fiber = encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><filter id="f"><feTurbulence type="fractalNoise" baseFrequency=".012 .06" numOctaves="2" seed="3"/><feColorMatrix values="0 0 0 0 .5  0 0 0 0 .38  0 0 0 0 .25  0 0 0 .09 0"/></filter><rect width="400" height="400" filter="url(#f)"/></svg>`);
const tear = (fill) => encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 24" preserveAspectRatio="none"><path d="M0 24 V9 C60 3 90 14 150 8 S250 2 310 10 S420 16 480 8 S590 1 650 9 S760 15 820 7 S930 2 990 10 S1110 14 1200 6 V24 Z" fill="${fill}"/></svg>`);
const tapeMask = encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 30" preserveAspectRatio="none"><path d="M0 0 L4 4 L0 8 L4 12 L0 16 L4 20 L0 24 L4 28 L0 30 H96 L92 26 L96 22 L92 18 L96 14 L92 10 L96 6 L92 2 L96 0 Z"/></svg>');
const scribble = encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 260 10" preserveAspectRatio="none"><path d="M2 6 C40 1 70 9 110 4 S190 8 258 3" fill="none" stroke="#E99347" stroke-width="3.5" stroke-linecap="round"/></svg>');
const B = {
  id: "b", name: "B 手触りのある紙",
  r: { l: 14, m: 8, s: 3 }, markR: 2, mapChipR: 8,
  shadow: "3px 4px 0 rgba(38,37,35,.14)",
  map: { land: "#F6EBD3", water: "#DEF3F4", shore: "#2EBEC4", road: "#FFFDF6", casing: "#B9A98C", didTint: "#FBE0BE", didLine: "#B3500A", park: "#225F36", air: "#4A4843", halo: "rgba(248,155,72,.3)" },
  tokens: { white: "#FFFDF7", off: "#F8F2E4", beige: "#EFE5CF" },
  defs: `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
    <filter id="rough" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency=".035" numOctaves="2" seed="4" result="t"/><feDisplacementMap in="SourceGraphic" in2="t" scale="3.2"/></filter>
    <filter id="ink" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency=".06" numOctaves="2" seed="9" result="t"/><feDisplacementMap in="SourceGraphic" in2="t" scale="2.2" result="d"/><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="2" result="n"/><feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -1.1 1.55" result="m"/><feComposite in="d" in2="m" operator="in"/></filter>
  </defs></svg>`,
  hero: `<div class="hero-art art-b" aria-hidden="true">
    <svg viewBox="0 0 520 300" width="100%" height="100%" preserveAspectRatio="xMaxYMid slice" fill="none" filter="url(#rough)">
      <g style="--ct:rgba(38,37,35,.28);--ct-major:rgba(38,37,35,.5)">${contours(390, 190, 7, 26, 22, 5.2, 1.3, 0.95)}</g>
      <path d="M60 262 C150 220 200 140 300 132 S430 84 490 52" stroke="#262523" stroke-width="2.6" stroke-dasharray="1 10" stroke-linecap="round"/>
      <circle cx="430" cy="78" r="30" stroke="#E99347" stroke-width="5" fill="none"/>
      <path d="M404 50 L462 108 M416 40 L470 94" stroke="#E99347" stroke-width="3" stroke-linecap="round"/>
    </svg>
    <div class="art-drone">${DRONE()}</div>
    <span class="tape tape-hero"></span>
  </div>`,
  verdictHead: `<div class="v-head">
    <svg class="stamp" viewBox="0 0 290 150" role="img" aria-label="結論：要手続き（印）" filter="url(#ink)">
      <rect x="6" y="6" width="278" height="138" rx="16" fill="none" stroke="#6B5800" stroke-width="6"/>
      <rect x="16" y="16" width="258" height="118" rx="10" fill="none" stroke="#6B5800" stroke-width="2"/>
      <use href="#m-needs" x="26" y="36" width="56" height="56" color="#6B5800"/>
      <text x="92" y="76" font-size="40" font-weight="800" fill="#6B5800" letter-spacing="4">要手続き</text>
      <text x="92" y="108" font-size="16" font-weight="700" fill="#6B5800" letter-spacing="2">2026.10.25 確認</text>
    </svg>
    <div><p class="v-eyebrow" id="h-verdict">結論</p><p class="v-place">米子市役所<br>35.4283, 133.3306</p></div></div>`,
  mapDeco: `<span class="tape tape-map" aria-hidden="true"></span>`,
  css: `
body.d-b{background-color:var(--white);background-image:url("data:image/svg+xml,${paperNoise}"),url("data:image/svg+xml,${fiber}")}
:root{--ct:rgba(38,37,35,.26);--ct-major:rgba(38,37,35,.5)}
.d-b .band-white{background:transparent}.d-b .band-off{background:rgba(248,242,228,.92)}.d-b .band-beige{background:rgba(239,229,207,.96)}
.d-b .band:not(.hero){padding-top:52px}
.d-b .band::before{content:"";position:absolute;left:0;right:0;top:-1px;height:18px;background-size:100% 100%;background-repeat:no-repeat;pointer-events:none}
.d-b .band-off::before{background-image:url("data:image/svg+xml,${tear("#FFFDF7")}")}
.d-b .band-beige::before{background-image:url("data:image/svg+xml,${tear("#F8F2E4")}")}
.d-b .band-white:not(.hero)::before{background-image:url("data:image/svg+xml,${tear("#EFE5CF")}")}
.d-b .hero::before{display:none}
.d-b .block,.d-b .block-soft{border:1.75px solid var(--ink);border-radius:14px 7px 12px 8px / 8px 13px 7px 14px;background:var(--white)}
.d-b .band-white .block,.d-b .band-white .block-soft{background:var(--off)}
.d-b .block-soft{box-shadow:none}
.d-b input[type=text]{border-radius:9px 5px 8px 6px / 6px 8px 5px 9px;border:2px solid var(--ink)}
.d-b .sec-head{border-left:0;padding-left:0}
.d-b .sec-head h2{padding-left:14px;border-left:5px solid var(--orange);align-self:flex-start}
.d-b .sec-note{padding-left:19px}
.d-b .sec-head::after{content:"";position:absolute;left:19px;bottom:-6px;width:min(260px,70%);height:10px;background:url("data:image/svg+xml,${scribble}") no-repeat;background-size:100% 100%}
.d-b .pill-primary{box-shadow:2px 3px 0 var(--ink);border:2px solid var(--ink)}
.d-b .pill-secondary{border:2px solid var(--ink);background:var(--white)}
.d-b .pill-primary:active{transform:translate(2px,3px);box-shadow:none}
.d-b .tag-pill{border:1.5px solid var(--edge);background:var(--white)}
.d-b .tag-deadline{border-color:var(--ink)!important}
.d-b .src{background:var(--kincha);border:1.5px solid var(--ink)}
.d-b .src-県{background:#EBB7BC}.d-b .src-市{background:var(--sky)}
.d-b .map-frame{border:2px solid var(--ink);border-radius:8px 4px 7px 5px/5px 7px 4px 8px}
.stamp{flex:none;width:176px;height:auto;transform:rotate(-7deg);margin:4px 2px 4px 0}
.tape{position:absolute;display:block;width:96px;height:30px;background:rgba(215,167,97,.9);box-shadow:0 1px 2px rgba(0,0,0,.12);z-index:3;-webkit-mask:url("data:image/svg+xml,${tapeMask}") center/100% 100%;mask:url("data:image/svg+xml,${tapeMask}") center/100% 100%}
.tape-map{top:-12px;left:22px;transform:rotate(-5deg)}
.tape-hero{right:6%;top:16px;transform:rotate(7deg)}
.art-b{inset:0 0 0 auto;width:100%}
.art-b>svg{position:absolute;inset:0;opacity:.85}
.art-b .art-drone{position:absolute;right:20px;top:18px;width:90px;color:var(--ink)}
.art-b .art-drone svg{width:100%;height:auto;filter:url(#rough)}
@media (max-width:899px){.art-b>svg{opacity:.28}.art-b .art-drone,.tape-hero{display:none}}
@media (min-width:900px){.art-b{width:56%}.art-b .art-drone{right:13%;top:74px;width:190px;transform:rotate(-8deg)}.stamp{width:230px}}
`,
};

// C：空と地図の絵本
const C = {
  id: "c", name: "C 空と地図の絵本",
  r: { l: 24, m: 12, s: 6 }, markR: 5, mapChipR: 17,
  shadow: "0 0 24px rgba(0,0,0,.1)",
  map: { land: "#FFF4E2", water: "#BFE9EC", shore: "#2EBEC4", road: "#FFFFFF", casing: "#C4C4C4", didTint: "#FFD6AB", didLine: "#B3500A", park: "#0F6B70", air: "#0F6B70", halo: "rgba(248,155,72,.3)" },
  tokens: {},
  hero: `<div class="hero-art art-c" aria-hidden="true">
    <svg viewBox="0 0 1000 420" preserveAspectRatio="xMidYMax slice" width="100%" height="100%">
      <defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#DEF3F4"/><stop offset=".62" stop-color="#FFF1DE"/><stop offset="1" stop-color="#FFC189"/></linearGradient></defs>
      <rect width="1000" height="420" fill="url(#sky)"/>
      <circle cx="790" cy="214" r="86" fill="#F89B48"/><circle cx="790" cy="214" r="122" fill="none" stroke="#F89B48" stroke-width="3" stroke-dasharray="2 10" stroke-linecap="round"/>
      <path d="M0 300 C120 230 240 250 350 290 S560 320 700 262 S900 230 1000 270 V420 H0Z" fill="#FFC189"/>
      <path d="M0 340 C140 280 300 300 420 340 S650 372 800 318 S940 300 1000 320 V420 H0Z" fill="#2EBEC4"/>
      <path d="M0 385 C160 345 330 365 480 392 S800 400 1000 360 V420 H0Z" fill="#0F6B70"/>
      <g fill="none" stroke="#262523" stroke-opacity=".38" stroke-width="1.8">
        <path d="M60 296 C150 262 250 270 330 296"/><path d="M110 296 C170 278 240 282 290 296"/>
        <path d="M600 304 C680 270 780 266 880 292"/><path d="M660 304 C720 286 800 282 850 298"/>
        <path d="M30 352 C150 322 300 334 420 352"/><path d="M480 356 C600 330 720 336 830 346"/>
      </g>
    </svg>
    <div class="cloud cloud-1">${CLOUD()}</div><div class="cloud cloud-2">${CLOUD()}</div>
    <div class="art-drone">${DRONE()}</div>
  </div>`,
  verdictHead: `<div class="v-head"><div class="v-big">${vm("needs", "vm")}</div><div><p class="v-eyebrow" id="h-verdict">結論</p><p class="v-word">要手続き</p><p class="v-place">米子市役所　35.4283, 133.3306</p></div></div>`,
  mapDeco: `<div class="cloud cloud-map" aria-hidden="true">${CLOUD()}</div>`,
  css: `
:root{--ct:rgba(46,190,196,.55);--ct-major:rgba(15,107,112,.6)}
.d-c .hero{padding:0;background:var(--sky);overflow:hidden;border-radius:0 0 32px 32px}
.d-c .hero>*{max-width:none}
.art-c{position:absolute;inset:0}
.art-c>svg{position:absolute;inset:0;width:100%;height:100%}
.d-c .hero-text{position:relative;max-width:1120px;margin:0 auto;padding:28px 16px 170px}
.d-c .brand,.d-c h1,.d-c .lead{max-width:34em}
.d-c .lead{color:var(--ink)}
.d-c .facts{border-color:rgba(38,37,35,.35)}
.d-c .facts dt{color:var(--ink-2)}
.d-c .brand-mark{background:var(--orange);box-shadow:0 0 0 4px #fff}
.d-c h1{color:var(--ink)}
.cloud{position:absolute;color:#fff;pointer-events:none}
.cloud svg{width:100%;height:auto;display:block}
.cloud-1{right:6%;top:30px;width:110px;opacity:.95}.cloud-2{right:34%;top:110px;width:84px;opacity:.9}
.art-c .art-drone{position:absolute;right:8%;top:70px;width:88px;color:var(--ink);transform:rotate(-8deg)}
.art-c .art-drone svg{width:100%;height:auto}
.d-c .band:not(.hero){padding-top:44px}
.d-c .verdict-block{position:relative;overflow:hidden;padding-bottom:62px}
.d-c .verdict-block::after{content:"";position:absolute;left:0;right:0;bottom:0;height:44px;background:url("data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 44" preserveAspectRatio="none"><path d="M0 44 V26 C60 8 120 8 180 22 S300 38 400 14 V44Z" fill="#DEF3F4"/><path d="M0 44 V34 C80 20 140 26 210 34 S330 40 400 28 V44Z" fill="#2EBEC4" opacity=".55"/></svg>')}") no-repeat;background-size:100% 100%;pointer-events:none}
.d-c .v-big{border-radius:22px;box-shadow:inset 0 0 0 3px var(--v-needs-fg),0 0 0 5px var(--sky)}
.d-c .map-block{background:var(--white);border:2px solid var(--ink);box-shadow:5px 5px 0 var(--teal)}
.d-c .map-frame{border-radius:16px;border:1.5px solid var(--ink)}
.cloud-map{left:-14px;top:-20px;width:92px;z-index:3;color:#fff;filter:drop-shadow(0 1.5px 0 #262523) drop-shadow(0 -1px 0 #262523) drop-shadow(1.5px 0 0 #262523) drop-shadow(-1.5px 0 0 #262523)}
.d-c .chip.is-on .chk{background:var(--teal)}
.d-c .band-beige{background:var(--sky)}
.d-c .band-beige .block{background:var(--white)}
.d-c .band-beige .tag-pill{background:var(--off)}
.d-c .src{background:var(--sky);color:var(--ink)}
.d-c .src-県{background:var(--orange-light)}.d-c .src-市{background:#C8EEF0}
.d-c .proc-no{background:var(--teal);color:var(--ink)}
.d-c .proc-done .proc-no{background:var(--off);color:var(--v-done)}
.d-c input[type=text]{border-radius:16px}
@media (max-width:899px){.art-c .art-drone{display:none}}
@media (min-width:900px){
  .d-c .hero-text{padding:64px 32px 210px}
  .cloud-1{right:7%;top:34px;width:170px}.cloud-2{right:36%;top:150px;width:120px}
  .art-c .art-drone{right:14%;top:96px;width:170px}
  .cloud-map{width:120px;left:-22px;top:-30px}
}
`,
};

for (const d of [A, B, C]) fs.writeFileSync(path.join(out, `${d.id}.html`), page(d));
console.log("built a.html b.html c.html");
