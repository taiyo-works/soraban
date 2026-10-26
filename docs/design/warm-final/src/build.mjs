// 実行: node docs/design/warm-final/src/build.mjs
// 統合案（A の骨格＋C の挿絵をトップだけ）を 5 画面ぶんの単体 HTML にする。外部通信なし。
// 出力: top.html / result.html / home.html / field.html / journal.html（docs/design/warm-final/）
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { baseCss, html } from "./css.mjs";
import { DRONE, CLOUD_PATH, ARROW, EXT, PIN_ICON, CHECK, symbols, vm, vtag, mapSvg, LAYERS, swatch, ITEMS } from "./lib.mjs";
const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, "..");
const write = (name, s) => fs.writeFileSync(path.join(out, name), s);

// ───────── 共通の小物 ─────────
const arrows = `<span class="pill-arrow" aria-hidden="true"><span class="ar a1">${ARROW}</span><span class="ar a2">${ARROW}</span></span>`;
const arrowsExt = `<span class="pill-arrow" aria-hidden="true"><span class="ar a1">${EXT}</span><span class="ar a2">${EXT}</span></span>`;
const pill = (cls, label, { icon = arrows, tag = "button", href = "#", extra = "" } = {}) =>
  tag === "a"
    ? `<a class="pill ${cls}" href="${href}" ${extra}><span class="pill-label">${label}</span>${icon}</a>`
    : `<button type="button" class="pill ${cls}" ${extra}><span class="pill-label">${label}</span>${icon}</button>`;
const sec = (n, id, title, note = "") => `<div class="sec-head"><span class="sec-num" aria-hidden="true">${n}</span><h2 id="${id}">${title}</h2>${note ? `<p class="sec-note">${note}</p>` : ""}</div>`;
const stripPc = (css) => css.replace(/@media \(min-width:(900|1024)px\)\{\n[\s\S]*?\n\}\n/g, "");

const ic = {
  home: `<path d="M3.5 11 L12 4 L20.5 11 M6 9.5 V19.5 H18 V9.5"/>`,
  verdict: `<path d="M12 21 C7 15.5 5 12.5 5 10 a7 7 0 0 1 14 0 c0 2.5-2 5.5-7 11z"/><circle cx="12" cy="10" r="2.6"/>`,
  plan: `<rect x="4" y="5.5" width="16" height="14.5" rx="3"/><path d="M4 10.5 H20 M8.5 3.5 V7 M15.5 3.5 V7"/>`,
  journal: `<path d="M5 4.5 H17 a2 2 0 0 1 2 2 V19.5 H7 a2 2 0 0 1-2-2 Z M9 9 H15 M9 12.5 H15"/>`,
  inspect: `<rect x="5" y="4.5" width="14" height="16" rx="3"/><path d="M9.5 3.5h5a1 1 0 0 1 1 1v1.5h-7V4.5a1 1 0 0 1 1-1z"/><path d="M9 13.5l2 2 4-4.5"/>`,
  list: `<path d="M9 7 H20 M9 12 H20 M9 17 H20 M4.5 7 H5.5 M4.5 12 H5.5 M4.5 17 H5.5"/>`,
  back: `<path d="M14 5 L7 12 L14 19"/>`,
};
const svgIc = (k) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ic[k]}</svg>`;
const NAV = [["home", "ホーム", "/ops"], ["verdict", "判定", "/"], ["plan", "計画", "/ops/plans"], ["inspect", "点検", "/ops/inspections"], ["journal", "日誌", "/ops/journal"], ["list", "登録", "/ops/more"]];
// スマホの下タブは 5 つ（流れ：計画→点検→日誌）。判定はタブに置かず、ホームの上部と計画の作成画面のピルから `/` へ行く。PC の左メニューは 6 項目。
const TABS = ["home", "plan", "inspect", "journal", "list"].map((k) => NAV.find((n) => n[0] === k));
const tabbar = (cur) => `<nav class="tabbar" aria-label="主なメニュー" data-testid="ops-bottom-nav">${TABS.map(([k, l, h]) => `<a class="tab" href="${h}"${k === cur ? ' aria-current="page"' : ""}><span class="tab-ic">${svgIc(k)}</span>${l}</a>`).join("")}</nav>`;
const sideNav = (cur) => {
  const it = (k) => { const [, l, h] = NAV.find((n) => n[0] === k); return `<a class="s-item" href="${h}"${k === cur ? ' aria-current="page"' : ""}>${svgIc(k)}<span>${l}</span></a>`; };
  const ch = (l) => `<a class="s-child" href="#">${l}</a>`;
  return `<aside class="side" aria-label="左メニュー">
  <p class="brand s-brand"><span class="brand-mark" aria-hidden="true">${DRONE("brand-drone")}</span>そらばん</p>
  <nav class="s-nav" aria-label="主なメニュー">
    ${it("home")}
    <p class="s-head">調べる</p>${it("verdict")}
    <p class="s-head">飛ばす</p>${it("plan")}${it("inspect")}${it("journal")}
    <p class="s-head s-head-blank"></p>${it("list")}
    <div class="s-children">${["機体", "操縦者", "許可・承認", "地点"].map(ch).join("")}</div>
  </nav>
</aside>`;
};
// 判定への入口（ホームの上部と計画の作成画面）。1 タップで判定画面（/）へ。高さ 48px 以上
const judgeJump = (caption) => `<section class="jump" aria-label="判定へ"><p class="jump-cap">${caption}</p><div class="jump-row">${pill("pill-secondary pill-sm", "現在地で判定", { tag: "a", href: "/", icon: `<span class="pill-arrow" aria-hidden="true"><span class="ar a1">${PIN_ICON}</span><span class="ar a2">${PIN_ICON}</span></span>` })}${pill("pill-secondary pill-sm", "場所を調べる", { tag: "a", href: "/" })}</div></section>`;
const meBtn = `<button type="button" class="me" aria-label="利用者メニュー：山田 太郎（運航管理者）"><span class="me-ic" aria-hidden="true">山</span><span class="me-name">山田 太郎　運航管理者</span></button>`;
const opsCss = `
body.ops{min-height:100vh;display:flex;flex-direction:column;background:var(--off)}
.shell{flex:1;display:flex;flex-direction:column;min-width:0}
.main{flex:1;padding:20px 16px 28px}
.s-brand{font-size:26px}
.s-nav{display:flex;flex-direction:column;gap:4px}
.s-head{margin:14px 0 2px 14px;font-size:12px;font-weight:700;color:var(--ink-3);letter-spacing:.1em}
.s-head-blank{margin:6px 0 0}
.s-item{display:flex;align-items:center;gap:12px;min-height:48px;padding:0 16px;border-radius:var(--pill);font-size:15px;font-weight:700;color:var(--ink);text-decoration:none}
.s-item svg{width:22px;height:22px;flex:none}
.s-item:hover{background:var(--beige)}
.s-item[aria-current="page"]{background:var(--orange);color:var(--sb-on-orange)}
.s-children{display:flex;flex-direction:column;margin-left:26px;border-left:2px solid var(--rule)}
.s-child{display:flex;align-items:center;min-height:44px;padding:0 14px;font-size:14px;font-weight:500;color:var(--ink-2);text-decoration:none}
.jump{margin-bottom:20px}
.jump-cap{font-size:13px;font-weight:700;color:var(--ink-2);margin-bottom:8px}
.jump-row{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.jump .pill{padding-left:16px;gap:6px;font-size:14px;min-width:0}
.jump .pill-sm .pill-arrow{width:40px;height:40px}
.page-title{display:none}
.pc-only{display:none}
@media (min-width:1024px){
  body.ops{display:grid;grid-template-columns:264px minmax(0,1fr)}
  .side{display:flex;flex-direction:column;gap:22px;position:sticky;top:0;height:100vh;padding:24px 16px;background:var(--white);border-right:1px solid var(--rule)}
  .tabbar,.m-only{display:none}
  .pc-only{display:inline-flex}
  .topbar{position:static;min-height:84px;padding:20px 32px 0;background:transparent;border-bottom:0}
  .topbar h1{font-size:28px}
  .me{border-color:var(--rule)}
  .me-name{display:inline}
  .main{padding:16px 32px 56px;max-width:1080px;width:100%}
}
`;

// ───────── (a) トップ：挿絵つきヒーロー ─────────
function heroSvg(w, h, k) {
  const m = k === "m";
  const P = m
    ? { sun: [322, 148, 28, 43], far: "M0 150 C60 130 130 140 200 154 S330 162 390 140 V232 H0Z", farCrest: "M0 150 C60 130 130 140 200 154 S330 162 390 140",
        mid: "M0 180 C80 152 170 170 250 186 S350 178 390 166 V232 H0Z", near: "M0 208 C90 188 180 200 270 212 S360 206 390 198 V232 H0Z",
        flight: "M40 202 C96 162 170 118 226 78", drone: [248, 22, 84], clouds: [[216, 98, 0.36], [336, 92, 0.3]] }
    : { sun: [1060, 168, 56, 84], far: "M0 262 C200 252 420 260 640 236 S1010 172 1280 194 V320 H0Z", farCrest: "M0 262 C200 252 420 260 640 236 S1010 172 1280 194",
        mid: "M0 290 C240 268 460 294 700 274 S1070 228 1280 248 V320 H0Z", near: "M0 313 C300 297 560 313 820 301 S1150 283 1280 295 V320 H0Z",
        flight: "M690 258 C760 210 830 150 905 92", drone: [880, 30, 150], clouds: [[1110, 40, 0.95], [700, 96, 0.62], [1190, 150, 0.55]] };
  const id = (s) => `${s}-${k}`;
  const line = [10, 24, 38].map((d) => `<use href="#${id("crest")}" y="${d}"/>`).join("");
  const cl = P.clouds.map(([x, y, s]) => `<g transform="translate(${x} ${y}) scale(${s})"><path d="${CLOUD_PATH}" fill="var(--sb-art-cloud)" stroke="var(--sb-art-line)" stroke-width="${(2 / s).toFixed(1)}" stroke-linejoin="round"/></g>`).join("");
  const [dx, dy, dw] = P.drone;
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
  <defs>
    <linearGradient id="${id("sky")}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--sb-art-sky)"/><stop offset=".62" stop-color="var(--sb-art-sky-warm)"/><stop offset="1" stop-color="var(--sb-art-sky-low)"/></linearGradient>
    <path id="${id("crest")}" d="${P.farCrest}" fill="none"/>
    <clipPath id="${id("clip")}"><path d="${P.far}"/></clipPath>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#${id("sky")})"/>
  <circle cx="${P.sun[0]}" cy="${P.sun[1]}" r="${P.sun[2]}" fill="var(--sb-orange)"/>
  <circle cx="${P.sun[0]}" cy="${P.sun[1]}" r="${P.sun[3]}" fill="none" stroke="var(--sb-orange)" stroke-width="3" stroke-dasharray="2 9" stroke-linecap="round"/>
  ${cl}
  <path d="${P.flight}" fill="none" stroke="var(--sb-art-line)" stroke-width="2.4" stroke-dasharray="2 9" stroke-linecap="round"/>
  <path d="${P.far}" fill="var(--sb-art-hill-far)"/>
  <g clip-path="url(#${id("clip")})" fill="none" stroke="var(--sb-art-line)" stroke-opacity=".28" stroke-width="1.6">${line}</g>
  <path d="${P.mid}" fill="var(--sb-art-hill-mid)"/>
  <path d="${P.near}" fill="var(--sb-base)"/>
  <svg x="${dx}" y="${dy}" width="${dw}" height="${(dw * 0.6).toFixed(0)}" viewBox="0 0 160 96" fill="none" stroke="var(--sb-art-line)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="color:var(--sb-art-line)">
    <rect x="62" y="38" width="36" height="18" rx="9" fill="var(--sb-base)"/><circle cx="80" cy="47" r="4.5"/>
    <path d="M64 42 L36 28 M96 42 L124 28 M64 52 L36 66 M96 52 L124 66"/>
    <ellipse cx="30" cy="24" rx="22" ry="4.5"/><ellipse cx="130" cy="24" rx="22" ry="4.5"/><ellipse cx="30" cy="70" rx="22" ry="4.5"/><ellipse cx="130" cy="70" rx="22" ry="4.5"/>
    <path d="M30 24 V28 M130 24 V28 M30 66 V70 M130 66 V70 M70 58 V68 M90 58 V68 M64 68 H76 M84 68 H96"/>
  </svg>
</svg>`;
}
const facts = `<dl class="facts"><div><dt>運営者</dt><dd>フューチャーテック株式会社</dd></div><div><dt>利用の範囲</dt><dd>現在は社内での試験運用中</dd></div><div><dt>対象地域</dt><dd>鳥取県・島根県</dd></div></dl>`;
const leadP = `<p class="lead"><strong>業務でドローンを飛ばす事業者・操縦者のための道具です。</strong><span class="lead-more">飛ばす前に、その地点がどの法令・条例に当たり、どの手続きが要るかを一度に確かめ、出典つきの記録として残せます。</span></p>`;

function topPage() {
  const css = `
body.p-top{background:var(--white)}
.hero{position:relative;height:232px;overflow:hidden;background:var(--sb-art-sky)}
.hero-art{position:absolute;inset:0}.hero-art svg{position:absolute;inset:0;width:100%;height:100%}
.art-p{display:none}
.hero-text{position:relative;z-index:2;padding:18px 16px 0}
.hero-text h1{margin-top:8px;max-width:12.5em;font-size:16px;font-weight:700;color:var(--ink);letter-spacing:.05em;line-height:1.5}
.intro-pc{display:none}
.intro-m{padding:14px 16px 4px}.intro-m .lead-more{display:none}
.intro-m .lead{font-size:14px;line-height:1.85;color:var(--ink-2)}
.intro-m .lead strong{display:block;color:var(--ink);font-size:14.5px}
.facts{display:flex;flex-wrap:wrap;gap:6px 8px;margin-top:10px}
.facts div{display:inline-flex;gap:6px;align-items:center;min-height:28px;padding:2px 12px;border-radius:var(--pill);background:var(--sb-control);border:1px solid var(--rule);font-size:12.5px;line-height:1.4}
.facts dt{color:var(--ink-3)}.facts dd{font-weight:700}
.check-grid{display:grid;grid-template-columns:1fr;gap:20px}
.col-left{display:flex;flex-direction:column;gap:20px;min-width:0}.col-right{min-width:0}
.band-first{padding-top:20px}
.band-first .sec-head{margin-bottom:16px;min-height:48px}
@media (min-width:900px){
  .hero{height:320px}
  .art-m,.intro-m{display:none}.art-p{display:block}
  .hero-inner{position:relative;z-index:2;max-width:1120px;margin:0 auto;padding:34px 32px 0}
  .hero-text{padding:0;max-width:600px}
  .hero-text .brand{font-size:46px}
  .hero-text .brand-mark{width:56px;height:56px}.hero-text .brand-drone{width:38px}
  .hero-text h1{max-width:none;font-size:19px;margin-top:6px}
  .intro-pc{display:block;margin-top:10px}
  .intro-pc .lead{font-size:14.5px;line-height:1.8;color:var(--ink)}
  .intro-pc .lead strong{display:inline;font-weight:700}
  .intro-pc .facts{margin-top:10px}
  .check-grid{grid-template-columns:minmax(0,5fr) minmax(0,6fr);gap:28px;align-items:start}
  .col-right{position:sticky;top:20px}
  .band-first{padding-top:36px}
}
`;
  const body = `${symbols(3)}
<header class="hero" aria-label="そらばん">
  <div class="hero-art" aria-hidden="true"><div class="art-m">${heroSvg(390, 232, "m")}</div><div class="art-p">${heroSvg(1280, 320, "p")}</div></div>
  <div class="hero-inner"><div class="hero-text">
    <p class="brand"><span class="brand-mark" aria-hidden="true">${DRONE("brand-drone")}</span>そらばん</p>
    <h1>ドローン飛行の可否判定と運航管理</h1>
    <div class="intro-pc">${leadP}${facts}</div>
  </div></div>
</header>
<div class="intro-m band-white">${leadP}${facts}</div>

<section class="band band-off band-first" aria-labelledby="h-check">
  ${sec("01", "h-check", "地点を判定する", "住所・座標・地図のクリックで地点を指定できます")}
  <div class="check-grid">
    <div class="col-left">
      <form class="block input-block" onsubmit="return false">
        <label class="lbl" for="addr">住所または緯度・経度</label>
        <input id="addr" class="inp" type="text" value="鳥取県米子市加茂町1丁目1番地" placeholder="例: 鳥取県米子市加茂町1丁目1番地">
        <p class="hint">国土地理院の住所検索で位置を決めます。座標（35.4283, 133.3306）や Google マップの URL も貼れます。</p>
        <div class="btn-row">
          ${pill("pill-primary", "この地点を判定する")}
          ${pill("pill-secondary", "現在地で判定", { icon: `<span class="pill-arrow" aria-hidden="true"><span class="ar a1">${PIN_ICON}</span><span class="ar a2">${PIN_ICON}</span></span>` })}
        </div>
      </form>
      <article class="block verdict-block rise" aria-labelledby="h-verdict">
        <div class="v-head"><div class="v-big vb-needs">${vm("needs")}</div><div><p class="v-eyebrow" id="h-verdict">結論</p><p class="v-word">要手続き</p><p class="v-place">米子市役所　35.4283, 133.3306</p></div></div>
        <p class="v-lead">この地点で飛ばすには、<strong>手続きが 1 件</strong>必要です。許可・承認が下りるまで飛行は始められません。</p>
        <div class="v-meta"><span class="tag-pill">確認日 2026-10-25</span><span class="tag-pill">出典つき</span></div>
        <div class="v-meta">${pill("pill-secondary pill-sm", "結果を PDF で保存")}</div>
      </article>
    </div>
    <div class="col-right">
      <div class="block map-block">
        <div class="map-frame">${mapSvg({ mapChipR: 17 })}</div>
        <div class="layers" role="group" aria-label="規制レイヤー">
          <p class="layers-title">規制レイヤー（5/7 表示）<span>押すと地図の表示を切り替えます</span></p>
          <div class="chips">${LAYERS.map(([label, k, on]) => `<button type="button" class="chip ${on ? "is-on" : "is-off"}" aria-pressed="${on}">${on ? CHECK : '<span class="chk-empty" aria-hidden="true"></span>'}${swatch(k)}<span>${label}</span></button>`).join("")}</div>
        </div>
      </div>
    </div>
  </div>
</section>

<section class="band band-beige" aria-labelledby="h-proc">
  ${sec("02", "h-proc", "要手続きの手続き", "期限の近い順に並べています")}
  <div class="proc-grid">${procCards()}</div>
</section>

<section class="band band-white" aria-labelledby="h-items">
  ${sec("03", "h-items", "規制ごとの判定", "形と言葉で見分けられます。色だけでは区別しません")}
  <ul class="items block">${ITEMS.map(itemLi).join("")}</ul>
  <div class="legend block-soft" aria-label="判定の見分け方"><p class="legend-title">判定の見分け方</p><div class="legend-row">${["no", "needs", "done", "none", "unknown"].map((k) => vtag(k)).join("")}</div></div>
</section>

<section class="band band-off foot-band" aria-labelledby="h-disc">
  <h2 id="h-disc" class="disc-title">免責事項</h2>
  <p class="disc">本ツールは参考情報であり、飛行可否を最終的に保証するものではありません。緊急用務空域等の動的情報は反映していません。実運用前に必ず <a href="#">国土交通省 DIPS</a>、警察庁、各自治体の最新情報をご確認ください。自治体の条例データの一部は手作業で収録しており、各データに確認日と確からしさ（低・中・高）を付けています。</p>
  <p class="copy">© 2026 フューチャーテック株式会社　鳥取県西伯郡日吉津村</p>
  <p class="src-note">出典：国土交通省「国土数値情報（人口集中地区 A16 令和2年、用途地域 A29 令和元年度）」、国土地理院ジオコーダ・住所検索・ベクタータイル、警察庁・防衛省（小型無人機等飛行禁止法）、鳥取県・島根県例規集。画面の文言は表示見本です。</p>
</section>`;
  return html({ title: "そらばん 判定画面（統合案）", bodyClass: "p-top", css, body });
}
const itemLi = ([src, title, note, k]) => `<li class="item"><span class="src src-${src}">${src}</span><div class="item-text"><p class="item-title">${title}</p><p class="item-note">${note}</p></div>${vtag(k)}</li>`;
function procCards() {
  return `<article class="block proc"><span class="proc-no" aria-hidden="true">1</span><div class="proc-body">
    <h3>無人航空機の飛行許可・承認の申請（DID の上空）</h3><p class="proc-where">出す先：国土交通省 DIPS 2.0（オンライン）</p>
    <div class="tags"><span class="tag-pill tag-deadline">期限　飛行の 10 開庁日前まで</span><span class="tag-pill">法令　国（航空法）</span></div>
    <p class="proc-note">申請書はご本人の名義で作成し、ご本人が提出します。そらばんは入力項目の下書きまでを手伝います。</p>
    ${pill("pill-secondary pill-sm", "DIPS 2.0 を開く", { icon: arrowsExt })}</div></article>
  <article class="block proc proc-done"><span class="proc-no" aria-hidden="true">${vm("done", "vm vm-lg")}</span><div class="proc-body">
    <h3>庁舎周辺での飛行（鳥取県条例）</h3><p class="proc-where">記録：施設管理者の同意（本人入力）</p>
    <div class="tags"><span class="tag-pill">条件　飛行前に管理者へ連絡</span><span class="tag-pill">法令　県</span></div>
    <p class="proc-note">ご本人が自分で手続きを済ませた記録の表示です。そらばんが手続きを行ったわけではありません。</p></div></article>`;
}

// ───────── (b) 結果：3 状態をスマホで並べる ─────────
function resultPage() {
  const topbar = (place) => `<header class="topbar"><a class="back" href="#">${svgIc("back")}判定へ</a><h1>判定結果<span class="sub">${place}</span></h1></header>`;
  const head = (cls, key, word, place, lead) => `<article class="block verdict-block rise" aria-label="結論：${word}">
      <div class="v-head"><div class="v-big ${cls}">${vm(key)}</div><div><p class="v-eyebrow">結論</p><p class="v-word">${word}</p><p class="v-place">${place}</p></div></div>
      <p class="v-lead">${lead}</p>
      <div class="v-meta"><span class="tag-pill">確認日 2026-10-25</span><span class="tag-pill">出典つき</span></div>
      <div class="v-meta">${pill("pill-secondary pill-sm", "結果を PDF で保存")}</div></article>`;
  const rows = (arr) => `<ul class="items block">${arr.map(itemLi).join("")}</ul>`;
  const reason = (title, body, tag) => `<article class="block proc"><span class="proc-no" aria-hidden="true">${vm(tag, "vm vm-lg")}</span><div class="proc-body"><h3>${title}</h3><p class="proc-note" style="color:var(--ink-2)">${body}</p></div></article>`;
  const phone = (label, inner) => `<section class="phone" aria-label="${label}"><p class="phone-label">${label}</p><div class="phone-in">${inner}</div></section>`;
  const needs = phone("要手続き", `${topbar("米子市役所　35.4283, 133.3306")}
    <div class="band band-off">${head("vb-needs", "needs", "要手続き", "米子市役所　35.4283, 133.3306", "この地点で飛ばすには、<strong>手続きが 1 件</strong>必要です。許可・承認が下りるまで飛行は始められません。")}</div>
    <div class="band band-beige"><div class="sec-head"><h2>要手続きの手続き</h2><p class="sec-note">期限の近い順</p></div><div class="proc-grid">${procCards().split('<article class="block proc proc-done">')[0]}</div></div>
    <div class="band band-white"><div class="sec-head"><h2>規制ごとの判定</h2></div>${rows(ITEMS.slice(0, 3))}</div>`);
  const nofly = phone("飛行不可", `${topbar("米子鬼太郎空港の周辺　35.4922, 133.2358")}
    <div class="band band-off">${head("vb-no", "no", "飛行不可", "米子鬼太郎空港の周辺　35.4922, 133.2358", "この場所・条件では<strong>飛ばせません</strong>。手続きで解消できる制限ではないため、飛行場所か条件を見直してください。")}</div>
    <div class="band band-beige"><div class="sec-head"><h2>飛行できない理由</h2></div><div class="proc-grid">${reason("空港等の周辺区域の中です", "航空法の空港等周辺の制限に当たります。地点か高度を変えて、もう一度判定してください。", "no")}</div></div>
    <div class="band band-white"><div class="sec-head"><h2>規制ごとの判定</h2></div>${rows([["国", "航空法　空港等周辺", "空港等の周辺区域の中です。この場所・条件では飛ばせません。", "no"], ["国", "航空法　人口集中地区（DID）", "この地点は DID の外です。", "none"], ["国", "小型無人機等飛行禁止法", "対象施設の周辺地域の外です。", "none"]])}</div>`);
  const clear = phone("手続き不要", `${topbar("日野川の河川敷　35.3958, 133.3721")}
    <div class="band band-off">${head("vb-none", "none", "手続き不要", "日野川の河川敷　35.3958, 133.3721", "調べた範囲では、この地点に<strong>必要な手続きはありません</strong>。飛ぶ前の安全確認は、いつもどおり行ってください。")}</div>
    <div class="band band-beige"><div class="sec-head"><h2>飛行の前後に行うこと</h2></div><div class="proc-grid">${reason("飛行前の日常点検と、飛行日誌の記録", "手続きは要りませんが、点検と記録は毎回必要です。計画を作ると、行程に沿って案内します。", "done")}</div></div>
    <div class="band band-white"><div class="sec-head"><h2>規制ごとの判定</h2></div>${rows([["国", "航空法　人口集中地区（DID）", "この地点は DID の外です。", "none"], ["国", "航空法　空港等周辺", "空港等の周辺区域の外です。", "none"], ["市", "米子市 都市公園条例", "公園の区域データが未整備のため、判定できません。市の窓口で確認してください。", "unknown"]])}</div>`);
  const css = stripPc(`
body.p-result{background:var(--sb-sunken)}
.results{display:flex;gap:28px;justify-content:center;align-items:flex-start;padding:28px 24px 40px}
.phone{width:390px;flex:none}
.phone-label{margin:0 0 10px;display:inline-flex;align-items:center;min-height:32px;padding:2px 16px;border-radius:var(--pill);background:var(--sb-inverse-bg);color:var(--sb-inverse-fg);font-size:14px;font-weight:700;letter-spacing:.06em}
.phone-in{border-radius:var(--r-l);overflow:hidden;background:var(--white);box-shadow:var(--sb-shadow)}
.phone-in .topbar{position:static}
.phone-in .band{padding:24px 16px}
.phone-in .sec-head{margin-bottom:14px;min-height:44px}
.phone-in .sec-head h2{font-size:18px}
.phone-in .item .vtag{white-space:normal}
`);
  return html({ title: "そらばん 判定の結果（3 状態）", bodyClass: "p-result", css, body: `${symbols(3)}<main class="results">${needs}${nofly}${clear}</main>` }).replace(baseCss, stripPc(baseCss));
}

// ───────── (c) ホーム ─────────
const routeSteps = (states) => {
  const names = ["判定", "計画", "確認", "通報", "点検", "飛行", "日誌"];
  const chk = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5 L6.5 12 L13 4.5"/></svg>`;
  const play = `<svg viewBox="0 0 16 16" fill="currentColor"><path d="M5 3 L13 8 L5 13 Z"/></svg>`;
  return `<ol class="route" aria-label="行程">${names.map((n, i) => { const s = states[i]; return `<li class="rs rs-${s}"><span class="rs-dot" aria-hidden="true">${s === "done" ? chk : s === "next" ? play : ""}</span><span class="rs-name">${n}</span><span class="rs-state">${{ done: "済", next: "次", todo: "未" }[s]}</span></li>`; }).join("")}</ol>`;
};
function homePage() {
  const row = (tags, title, sub) => `<a class="row" href="#"><span class="row-main"><span class="row-tags">${tags}</span><span class="row-title">${title}</span><span class="row-sub">${sub}</span></span><span class="row-go" aria-hidden="true">${ARROW}</span></a>`;
  const t = (txt, c = "") => `<span class="tag-pill ${c}">${txt}</span>`;
  const css = opsCss + `
.next-card .pill{align-self:stretch}
.home-grid{display:grid;grid-template-columns:1fr;gap:24px}
.col{display:flex;flex-direction:column;gap:24px;min-width:0}
.route-wrap{padding:6px 0 0}
.nc-action{display:flex;flex-direction:column;gap:2px;padding:12px 14px;border-radius:var(--r-m);background:var(--off);margin-top:-2px}
.foot-note{margin-top:28px;padding:16px;border-radius:var(--r-l);background:var(--beige);font-size:12.5px;line-height:1.8;color:var(--ink-2)}
.main>.top-actions{margin-bottom:16px}
@media (min-width:1024px){
  .jump-row{max-width:520px}
  .home-grid{grid-template-columns:minmax(0,7fr) minmax(0,5fr);gap:28px;align-items:start}
  .next-card{padding:28px}
  .next-card .pill{align-self:flex-start;min-width:320px}
  .nc-time{font-size:52px}
  .nc-title{font-size:24px}
  .top-actions{display:flex;align-items:center;gap:12px;margin-left:auto}
}
`;
  const nextCard = `<article class="block next-card rise" aria-label="次の飛行" data-testid="today-card">
    <div class="nc-top"><span class="nc-reason">次の飛行（今日）</span></div>
    <div class="nc-top"><span class="nc-time">10:30</span><span class="nc-date">10/25（日）　〜 11:15</span></div>
    <h3 class="nc-title">加茂川 護岸の点検撮影</h3>
    <p class="nc-facts"><span>機体　<b>JU0123</b></span><span>操縦者　<b>山田 太郎</b></span></p>
    <p class="nc-facts"><span>判定　<b>要手続き（許可・承認の登録あり）</b></span><span>通報　<b>通報済み</b></span><span>確認　<b>運航管理者が確認済み</b></span></p>
    <div class="route-wrap">${routeSteps(["done", "done", "done", "done", "next", "todo", "todo"])}</div>
    <p class="nc-next">いまの「次」は <b>点検</b>。<a href="#">日常点検をする</a></p>
    ${pill("pill-primary", "現場モードを開く")}
  </article>`;
  const next = `<section aria-label="次にやること" class="next-actions"><h2 class="sect-title">次にやること<span class="aside">3 件</span></h2>
    <div class="block list">
      ${row(t("今日", "tag-deadline"), "日常点検をする", "加茂川 護岸の点検撮影　JU0123 の飛行前点検がまだありません。")}
      ${row(t("56 日後", "tag-deadline"), "技能証明を更新する", "山田 太郎　有効期限 2026-12-20（更新の受付期間）")}
      ${row(t("10/23 の飛行"), "日誌の食い違いを確認する", "計画の時間帯と、飛行記録の時刻が合っていません。")}
    </div><a class="more-link" href="#">ほか 2 件を見る</a></section>`;
  const deadlines = `<section aria-label="近づく期限" data-testid="home-deadlines"><h2 class="sect-title">近づく期限<span class="aside">60 日以内</span></h2>
    <div class="block list">
      ${row(t("！ 5 日過ぎ", "tag-strong") + t("技能証明"), "鈴木 次郎", "有効期限 2026-10-20　期限を過ぎています")}
      ${row(t("残り 46 日", "tag-deadline") + t("許可・承認"), "DID 上空の包括許可", "有効な最終日 2026-12-10")}
      ${row(t("残り 56 日", "tag-deadline") + t("技能証明"), "山田 太郎", "有効期限 2026-12-20　更新の受付期間")}
    </div><p class="quiet">機体の期限は、記録する場所がまだないため出ません。</p></section>`;
  const upcoming = `<section aria-label="直近の飛行"><h2 class="sect-title">直近の飛行<span class="aside">7 日以内</span></h2>
    <div class="block list">
      ${row(t("10/27（火）　9:00"), "日野川 橋脚の点検", "判定 済 ／ 計画 済 ／ 確認 次")}
    </div></section>
    <div class="m-only">${pill("pill-secondary", "飛行計画を作る", { extra: 'style="width:100%"' })}</div>`;
  const body = `${symbols(3)}
${sideNav("home")}
<div class="shell">
  <header class="topbar"><h1>ホーム<span class="sub">2026年10月25日（日）</span></h1>
    <span class="top-actions"><span class="pc-only">${pill("pill-primary", "飛行計画を作る", { extra: 'style="min-height:52px"' })}</span>${meBtn}</span></header>
  <main class="main">${judgeJump("飛ばす前に、地点を判定する")}<div class="home-grid"><div class="col">${nextCard}${next}</div><div class="col">${deadlines}${upcoming}</div></div>
    <p class="foot-note" data-testid="today-disclaimer">本ツールは参考情報であり、飛行可否を最終的に保証するものではありません。実運用前に必ず国土交通省 DIPS、警察庁、各自治体の最新情報をご確認ください。</p></main>
</div>
${tabbar("home")}`;
  return html({ title: "そらばん ホーム（運航管理）", bodyClass: "ops p-home", css, body });
}

// ───────── (d) 現場の点検 ─────────
function fieldPage() {
  const css = `
body{background:var(--sb-surface);font-size:var(--sb-fs-body);line-height:1.6}
.f{max-width:560px;margin:0 auto;padding:12px 16px 32px;display:flex;flex-direction:column;gap:16px}
.f-back{display:flex;align-items:center;gap:8px;min-height:var(--sb-hit);padding:0 18px 0 12px;border:var(--sb-rule-w) solid var(--sb-edge);border-radius:var(--sb-pill);background:var(--sb-control);font-size:var(--sb-fs-body);font-weight:700;text-decoration:none;color:var(--ink);align-self:flex-start}
.f-back svg{width:24px;height:24px}
.f-title{font-size:var(--sb-fs-h);font-weight:800;line-height:1.45;letter-spacing:.04em}
.f-sub{font-size:var(--sb-fs-body);color:var(--ink-2)}
.f-steps{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.f-step{display:flex;align-items:center;justify-content:center;gap:6px;min-height:var(--sb-hit-row);border:var(--sb-mark-w) solid var(--sb-edge);border-radius:var(--sb-pill);background:var(--sb-control);font-size:var(--sb-fs-body);font-weight:700;text-align:center;line-height:1.3;padding:0 6px;text-decoration:none;color:var(--ink)}
.f-step[aria-current="step"]{background:var(--orange);border-color:var(--ink);color:var(--sb-on-orange)}
.f-sync{display:flex;align-items:center;gap:10px;min-height:var(--sb-hit);font-size:var(--sb-fs-body);font-weight:700}
.f-sec-title{font-size:var(--sb-fs-h);font-weight:800;letter-spacing:.05em;padding-left:12px;border-left:6px solid var(--orange)}
.f-card{background:var(--sb-control);border:var(--sb-rule-w) solid var(--sb-edge);border-radius:var(--sb-r-l);padding:12px 16px 16px;display:flex;flex-direction:column;gap:12px}
.f-card.is-next{border:var(--sb-mark-w) solid var(--ink)}
.chk-row{display:flex;align-items:center;gap:14px;min-height:var(--sb-hit-row);padding:4px 0}
.chk-box{flex:none;width:40px;height:40px;border-radius:var(--sb-r-s);border:var(--sb-mark-w) solid var(--sb-edge);display:grid;place-items:center;background:var(--sb-control)}
.chk-box svg{width:26px;height:26px}
.is-done .chk-box{background:var(--ink);color:var(--sb-on-dot);border-color:var(--ink)}
.chk-name{flex:1;min-width:0;font-size:var(--sb-fs-body);font-weight:800;line-height:1.4}
.chk-state{flex:none;font-size:var(--sb-fs-body);font-weight:800;white-space:nowrap}
.chk-note{font-size:var(--sb-fs-note);color:var(--ink-2);line-height:1.6}
.f-lbl{font-size:var(--sb-fs-body);font-weight:700}
.f-sel{width:100%;height:var(--sb-hit-row);border:var(--sb-mark-w) solid var(--sb-edge);border-radius:var(--sb-r-m);background:var(--sb-field);padding:0 14px;font-size:var(--sb-fs-body);appearance:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='none' stroke='%23262523' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M5 8l5 5 5-5'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 14px center;background-size:24px;padding-right:48px}
.f-radios{display:flex;flex-direction:column;gap:10px}
.f-radio{display:flex;align-items:center;gap:14px;min-height:var(--sb-hit-row);padding:0 16px;border:var(--sb-mark-w) solid var(--sb-edge);border-radius:var(--sb-r-m);background:var(--sb-control);font-size:var(--sb-fs-body);font-weight:700}
.f-radio.is-on{background:var(--sb-surface);border-color:var(--ink)}
.f-radio .dot{flex:none;width:28px;height:28px;border-radius:var(--sb-pill);border:var(--sb-mark-w) solid var(--sb-edge);display:grid;place-items:center}
.f-radio.is-on .dot::after{content:"";width:14px;height:14px;border-radius:var(--sb-pill);background:var(--ink)}
.f-btn{width:100%;min-height:var(--sb-hit-primary)}
.f-btn.pill-secondary{border:var(--sb-mark-w) solid var(--ink);background:var(--sb-control)}
.f-reason{font-size:var(--sb-fs-note);color:var(--ink-2);line-height:1.6;text-align:center}
.f-card .pill{padding-left:20px;font-size:var(--sb-fs-body)}
body.p-field{display:flex;flex-direction:column;min-height:100vh}
body.p-field .f{flex:1;width:100%;padding-bottom:40px}
/* 現場でも下タブを出す（高さ 64px。本文の末尾はタブの上に十分な余白を取り、隠れない） */
body.p-field .tab{min-height:max(64px,var(--sb-hit-primary));font-size:var(--sb-fs-note);border-top:0}
body.p-field .tabbar{border-top:var(--sb-rule-w) solid var(--sb-edge)}
body.p-field .tab-ic{height:36px}
`;
  const chkSvg = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8.5 L6.5 12 L13 4.5"/></svg>`;
  const body = `${symbols(3)}<main class="f" aria-label="現場モード">
  <a class="f-back" href="#">${svgIc("back")}ホームへ戻る</a>
  <div><h1 class="f-title">加茂川 護岸の点検撮影</h1><p class="f-sub">10:30　JU0123　山田 太郎</p></div>
  <nav class="f-steps" aria-label="段階"><a class="f-step" href="#flight" aria-current="step">▶ ① 飛行前</a><a class="f-step" href="#">○ ② 離着陸</a><a class="f-step" href="#">○ ③ 日誌</a></nav>
  <p class="f-sync"><span aria-hidden="true">✓</span>送信済み</p>
  <h2 class="f-sec-title" id="preflight">① 飛行前の確認</h2>

  <section class="f-card is-done" aria-label="日常点検">
    <div class="chk-row"><span class="chk-box" aria-hidden="true">${chkSvg}</span><span class="chk-name">日常点検</span><span class="chk-state">✓ 済</span></div>
    <p class="chk-note">今日 07:42　山田 太郎　9 項目すべて正常</p>
  </section>

  <section class="f-card is-next" aria-label="緊急用務空域の確認">
    <div class="chk-row"><span class="chk-box" aria-hidden="true"></span><span class="chk-name">緊急用務空域の確認</span><span class="chk-state">－ 未</span></div>
    <label class="f-lbl" for="em-src">確認した情報源</label>
    <select id="em-src" class="f-sel"><option>国土交通省 公示のページ</option></select>
    <div role="radiogroup" aria-label="緊急用務空域の確認結果" class="f-radios">
      <div class="f-radio is-on" role="radio" aria-checked="true" tabindex="0"><span class="dot" aria-hidden="true"></span>指定されていない</div>
      <div class="f-radio" role="radio" aria-checked="false" tabindex="-1"><span class="dot" aria-hidden="true"></span>指定されている</div>
    </div>
    ${pill("pill-primary f-btn", "確認した")}
  </section>

  <section class="f-card" aria-label="通報済みの再確認">
    <div class="chk-row"><span class="chk-box" aria-hidden="true"></span><span class="chk-name">通報済みの再確認</span><span class="chk-state">－ 未</span></div>
    <p class="chk-note">DIPS への通報は 2026-10-24 に記録されています。</p>
    ${pill("pill-secondary f-btn", "通報内容を再確認した")}
  </section>

  <section class="f-card" aria-label="携行品">
    <div class="chk-row"><span class="chk-box" aria-hidden="true"></span><span class="chk-name">携行品</span><span class="chk-state">－ 未</span></div>
    <p class="chk-note">許可書を携行し、書かれた条件を確認してください。</p>
    ${pill("pill-secondary f-btn", "必要な書類・携行品を確認した")}
  </section>

  ${pill("pill-primary f-btn", "② 離着陸へ進む", { extra: 'disabled aria-describedby="why"' })}
  <p class="f-reason" id="why">あと 3 項目が未了です。すべて済むと押せます。</p>
</main>
${tabbar("plan")}`;
  return html({ title: "そらばん 現場の点検（飛行前）", attrs: ' data-mode="field"', bodyClass: "p-field", css: opsCss + css, body });
}

// ───────── (e) 飛行日誌の入力 ─────────
function journalPage() {
  const css = opsCss + `
.j-note{display:flex;gap:10px;align-items:flex-start;padding:12px 14px;border-radius:var(--r-m);background:var(--beige);font-size:13px;line-height:1.7;color:var(--ink-2)}
.form{display:flex;flex-direction:column;gap:16px}
.step .sec-head{margin-bottom:14px;min-height:44px;padding-top:2px;padding-bottom:2px}
.step .sec-head h2{font-size:18px}
.step .sec-num{font-size:72px;top:-22px}
.fld{display:flex;flex-direction:column;gap:6px;margin-bottom:16px}.fld:last-child{margin-bottom:0}
.fld .lbl{margin:0;display:flex;align-items:center;gap:8px}
.req{display:inline-flex;align-items:center;min-height:20px;padding:0 8px;border-radius:var(--pill);background:var(--sb-inverse-bg);color:var(--sb-inverse-fg);font-size:12px;font-weight:700}
.dt{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.dt .now{grid-column:1/-1}
.btn-s{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:48px;padding:0 20px;border-radius:var(--pill);border:1px solid var(--rule);background:var(--sb-control);font-size:14px;font-weight:700;cursor:pointer}
.btn-s svg{width:18px;height:18px}
.choices{display:flex;flex-wrap:wrap;gap:8px}
.radios{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.rad{display:flex;align-items:center;gap:10px;min-height:56px;padding:0 16px;border:1.5px solid var(--edge);border-radius:var(--r-m);background:var(--sb-control);font-weight:700}
.rad.is-on{border:2px solid var(--ink);background:var(--off)}
.rad .dot{flex:none;width:24px;height:24px;border-radius:var(--pill);border:2px solid var(--edge);display:grid;place-items:center}
.rad.is-on .dot::after{content:"";width:12px;height:12px;border-radius:var(--pill);background:var(--orange);box-shadow:0 0 0 2px var(--ink)}
.savebar{position:sticky;bottom:0;z-index:4;padding:12px 16px;background:rgba(247,247,243,.96);border-top:1px solid var(--rule);display:flex;flex-direction:column;gap:6px}
.savebar .hint{margin:0;text-align:center}
@media (min-width:1024px){.form{max-width:760px}}
`;
  const now = `<button type="button" class="btn-s now"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="10" cy="10" r="7.5"/><path d="M10 5.5 V10 L13 12"/></svg>今の時刻を入れる</button>`;
  const stepHead = (n, id, t) => `<div class="sec-head"><span class="sec-num" aria-hidden="true">${n}</span><h2 id="${id}">${t}</h2></div>`;
  const chip = (txt, on) => `<button type="button" class="chip ${on ? "is-on" : "is-off"}" aria-pressed="${on}">${on ? CHECK : '<span class="chk-empty" aria-hidden="true"></span>'}<span>${txt}</span></button>`;
  const body = `${symbols(3)}
<div class="shell" style="flex:1">
  <header class="topbar"><a class="back" href="#">${svgIc("back")}日誌</a><h1>飛行記録を入力<span class="sub">様式1　飛行日誌</span></h1>${meBtn}</header>
  <main class="main"><form class="form" onsubmit="return false">
    <p class="j-note"><span aria-hidden="true">✓</span><span>入力中の内容は、この端末に下書きとして残ります。再読み込みや通信の切断では消えません。保存すると下書きは消えます。</span></p>

    <section class="block step" aria-labelledby="s1">${stepHead("01", "s1", "機体・操縦者・日常点検")}
      <div class="fld"><label class="lbl" for="ac">機体<span class="req">必須</span></label><select id="ac" class="inp"><option>JU0123</option></select></div>
      <div class="fld"><label class="lbl" for="pl">操縦者<span class="req">必須</span></label><select id="pl" class="inp"><option>山田 太郎</option></select></div>
      <div class="fld"><label class="lbl" for="ins">日常点検</label><select id="ins" class="inp"><option>2026-10-25 07:42　飛行前　正常</option></select><p class="hint">同じ機体の、飛行日の点検から選びます。</p></div>
    </section>

    <section class="block step" aria-labelledby="s2">${stepHead("02", "s2", "離陸")}
      <div class="fld"><label class="lbl" for="tp">離陸場所<span class="req">必須</span></label><input id="tp" class="inp" type="text" value="加茂川 左岸 護岸の上"><p class="hint">地名・施設名など、正確な位置が分かる名前（100 文字以内）</p>
        ${pill("pill-secondary pill-sm", "現在地を入れる", { icon: `<span class="pill-arrow" aria-hidden="true"><span class="ar a1">${PIN_ICON}</span><span class="ar a2">${PIN_ICON}</span></span>` })}</div>
      <div class="fld"><span class="lbl">離陸時刻<span class="req">必須</span></span><div class="dt">${now}<input class="inp" type="text" value="2026-10-25" aria-label="離陸日"><input class="inp" type="text" value="10:32" aria-label="離陸時刻"></div><p class="hint">日本時間（24 時間制、分まで）。手で直せます。</p></div>
    </section>

    <section class="block step" aria-labelledby="s3">${stepHead("03", "s3", "着陸")}
      <div class="fld"><span class="lbl">着陸時刻<span class="req">必須</span></span><div class="dt">${now}<input class="inp" type="text" value="2026-10-25" aria-label="着陸日"><input class="inp" type="text" value="10:58" aria-label="着陸時刻"></div><p class="hint">飛行時間　26 分（離陸から着陸まで）</p></div>
      <div class="fld"><label class="lbl" for="lp">着陸場所<span class="req">必須</span></label><input id="lp" class="inp" type="text" value="加茂川 左岸 護岸の上"></div>
    </section>

    <section class="block step" aria-labelledby="s4">${stepHead("04", "s4", "飛行概要")}
      <div class="fld"><label class="lbl" for="pu">飛行の目的<span class="req">必須</span></label><input id="pu" class="inp" type="text" value="護岸の点検（空撮）"><p class="hint">例：空撮、インフラ点検、測量（100 文字以内）</p></div>
      <div class="fld"><span class="lbl">特定飛行の形態</span><div class="choices" role="group" aria-label="特定飛行の形態">${chip("人口集中地区（DID）上空", true)}${chip("夜間飛行", false)}${chip("目視外飛行", false)}${chip("人・物件から 30m 未満", false)}${chip("催し場所上空", false)}</div></div>
    </section>

    <section class="block step" aria-labelledby="s5">${stepHead("05", "s5", "安全に影響のあった事項・不具合")}
      <div class="fld" role="radiogroup" aria-label="飛行の安全に影響のあった事項"><span class="lbl">飛行の安全に影響のあった事項<span class="req">必須</span></span>
        <div class="radios"><div class="rad is-on" role="radio" aria-checked="true" tabindex="0"><span class="dot" aria-hidden="true"></span>なし</div><div class="rad" role="radio" aria-checked="false" tabindex="-1"><span class="dot" aria-hidden="true"></span>あり</div></div></div>
    </section>
  </form></main>
  <div class="savebar">${pill("pill-primary", "保存する", { extra: 'style="width:100%"' })}<p class="hint">保存すると、版として残り、あとから訂正できます。</p></div>
</div>
${tabbar("journal")}`;
  return html({ title: "そらばん 飛行日誌の入力", bodyClass: "ops p-journal", css, body });
}


// ───────── 点検の一覧 ─────────
function inspectionsPage() {
  const t = (txt, c = "") => `<span class="tag-pill ${c}">${txt}</span>`;
  const todo = (when, kind, plan, ac) => `<a class="row" href="#"><span class="row-main"><span class="row-tags">${t(when, when === "今日" ? "tag-deadline" : "")}${t(kind)}${t("－ 未実施", "tag-strong")}</span><span class="row-title">${plan}</span><span class="row-sub">機体　${ac}</span></span><span class="row-go" aria-hidden="true">${ARROW}</span></a>`;
  const rec = (dt, ac, who, kind, ok) => `<a class="row" href="#"><span class="row-main"><span class="row-tags">${t(dt)}${t(kind)}${ok ? t("✓ 正常") : t("！ 異常あり", "tag-strong")}</span><span class="row-title">${ac}</span><span class="row-sub">実施者　${who}</span></span><span class="row-go" aria-hidden="true">${ARROW}</span></a>`;
  const chipf = (txt, on) => `<button type="button" class="chip ${on ? "is-on" : "is-off"}" aria-pressed="${on}">${on ? CHECK : '<span class="chk-empty" aria-hidden="true"></span>'}<span>${txt}</span></button>`;
  const css = opsCss + `
.insp-new{margin-bottom:20px}
.insp-new .pill{width:100%}
.filters{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:20px}
.count{font-size:13px;color:var(--ink-3)}
@media (min-width:1024px){.insp-new .pill{width:auto;min-width:320px}}
`;
  const body = `${symbols(3)}
${sideNav("inspect")}
<div class="shell">
  <header class="topbar"><h1>点検<span class="sub">飛行前・飛行後の日常点検</span></h1>${meBtn}</header>
  <main class="main">
    <div class="insp-new">${pill("pill-primary", "新しい点検", { tag: "a", href: "/ops/inspections/new" })}</div>
    <section aria-label="未実施の点検" class="stack"><h2 class="sect-title">未実施<span class="aside">3 件</span></h2>
      <div class="block list">
        ${todo("今日", "飛行前", "加茂川 護岸の点検撮影　10:30", "JU0123")}
        ${todo("昨日", "飛行後", "日野川 橋脚の点検（10/24）", "JU0456")}
        ${todo("10/27", "飛行前", "日野川 橋脚の点検　9:00", "JU0456")}
      </div></section>
    <section aria-label="点検の記録" style="margin-top:28px"><h2 class="sect-title">記録<span class="aside">新しい順</span></h2>
      <div class="filters" role="group" aria-label="区分で絞り込む">${chipf("すべて", true)}${chipf("飛行前", false)}${chipf("飛行後", false)}</div>
      <div class="block list">
        ${rec("10/24 07:42", "JU0456", "山田 太郎", "飛行前", true)}
        ${rec("10/23 15:10", "JU0123", "佐藤 花子", "飛行後", false)}
        ${rec("10/23 08:05", "JU0123", "佐藤 花子", "飛行前", true)}
      </div><p class="quiet count">3 件</p></section>
  </main>
</div>
${tabbar("inspect")}`;
  return html({ title: "そらばん 点検の一覧", bodyClass: "ops p-inspections", css, body });
}

// ───────── 計画の作成（判定への導線つき） ─────────
function planNewPage() {
  const css = opsCss + `
.form{display:flex;flex-direction:column;gap:16px}
.fld{display:flex;flex-direction:column;gap:6px;margin-bottom:16px}.fld:last-child{margin-bottom:0}
.req{display:inline-flex;align-items:center;min-height:20px;padding:0 8px;border-radius:var(--pill);background:var(--sb-inverse-bg);color:var(--sb-inverse-fg);font-size:12px;font-weight:700;margin-left:8px}
.fld .lbl{margin:0}
.savebar{position:sticky;bottom:0;z-index:4;padding:12px 16px;background:rgba(247,247,243,.96);border-top:1px solid var(--rule)}
@media (min-width:1024px){.form{max-width:760px}}
`;
  const body = `${symbols(3)}
${sideNav("plan")}
<div class="shell">
  <header class="topbar"><a class="back" href="/ops/plans">${svgIc("back")}計画</a><h1>飛行計画を作る</h1>${meBtn}</header>
  <main class="main"><form class="form" onsubmit="return false">
    ${judgeJump("地点がまだ決まっていないときは、先に判定画面で調べられます")}
    <section class="block"><div class="fld"><label class="lbl" for="pn">計画の名前<span class="req">必須</span></label><input id="pn" class="inp" type="text" value="加茂川 護岸の点検撮影"></div>
      <div class="fld"><label class="lbl" for="pp">飛行する場所<span class="req">必須</span></label><input id="pp" class="inp" type="text" value="鳥取県米子市加茂町1丁目1番地"><p class="hint">住所か座標。判定した地点は、そのまま使えます。</p></div>
      <div class="fld"><label class="lbl" for="pd">飛行日時<span class="req">必須</span></label><input id="pd" class="inp" type="text" value="2026-10-25　10:30 〜 11:15"></div>
      <div class="fld"><label class="lbl" for="pa">機体<span class="req">必須</span></label><select id="pa" class="inp"><option>JU0123</option></select></div></section>
  </form></main>
  <div class="savebar">${pill("pill-primary", "計画を保存する", { extra: 'style="width:100%"' })}</div>
</div>
${tabbar("plan")}`;
  return html({ title: "そらばん 飛行計画を作る", bodyClass: "ops p-plannew", css, body });
}

write("top.html", topPage());
write("result.html", resultPage());
write("home.html", homePage());
write("field.html", fieldPage());
write("journal.html", journalPage());
write("inspections.html", inspectionsPage());
write("plan-new.html", planNewPage());
console.log("built top / result / home / field / inspections / journal / plan-new");
