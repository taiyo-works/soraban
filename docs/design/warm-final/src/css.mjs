// 5 画面で共有する CSS。トークンは docs/design/tokens-v2/soraban-tokens-v2.css をそのまま読み込む（単一の出どころ）。
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const here = path.dirname(fileURLToPath(import.meta.url));
export const tokens = fs.readFileSync(path.join(here, "../../tokens-v2/soraban-tokens-v2.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

export const baseCss = `
:root{
  --font:"Noto Sans JP","Plus Jakarta Sans","Hiragino Sans","Yu Gothic UI","Yu Gothic","IPAGothic","IPAPGothic",sans-serif;
  --ink:var(--sb-ink); --ink-2:var(--sb-ink-2); --ink-3:var(--sb-ink-3); --ph:var(--sb-ph); --rule:var(--sb-rule); --edge:var(--sb-edge);
  --orange:var(--sb-orange); --orange-light:var(--sb-orange-hover); --white:var(--sb-base); --off:var(--sb-surface); --beige:var(--sb-sunken);
  --r-l:var(--sb-r-l); --r-m:var(--sb-r-m); --r-s:var(--sb-r-s); --pill:var(--sb-pill);
  --v-needs-fg:var(--sb-v-needs-fg); --v-no:var(--sb-v-no-fill); --v-needs:var(--sb-v-needs-fill); --v-done:var(--sb-v-done-fill); --v-none:var(--sb-v-none-fill); --v-unknown:var(--sb-v-unknown-fg);
  --ct:var(--sb-contour); --ct-major:var(--sb-contour-major);
  --map-land:#FBF6EC; --map-water:#DEF3F4; --map-shore:#2EBEC4; --road:#FFFFFF; --road-casing:#C4C4C4;
  --map-ink:#262523; --map-swatch-bg:transparent;
  --did-tint:#FFE3C7; --did-line:#B3500A; --park-line:#225F36; --air-line:#4A4843; --pin-halo:rgba(248,155,72,.28);
}
/* 地図の凡例の見本は地図と同じ明るい下地に載せる（暗でも地図タイルは明るいまま。見本専用の定義） */
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--map-swatch-bg:#FBF6EC}}
:root[data-theme="dark"]{--map-swatch-bg:#FBF6EC}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--sb-base);color:var(--sb-ink);font-family:var(--font);font-size:var(--sb-fs-body);line-height:1.75;letter-spacing:.03em;line-break:strict;word-break:auto-phrase;overflow-wrap:anywhere}
h1,h2,h3,p,ul,ol,dl,dd,figure{margin:0;padding:0}
ul,ol{list-style:none}
button,select,input{font:inherit;color:inherit;letter-spacing:inherit}
a{color:var(--ink);text-underline-offset:3px;text-decoration-thickness:2px;text-decoration-color:var(--orange)}
:focus-visible{outline:3px solid var(--sb-focus);outline-offset:3px}
.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}

/* 帯（白・オフホワイト・ベージュを交互に） */
.band{position:relative;padding:36px 16px}
.band>*{max-width:1120px;margin-left:auto;margin-right:auto}
.band-white{background:var(--white)}.band-off{background:var(--off)}.band-beige{background:var(--beige)}

/* 見出し：左 5px の橙線＋背後の大きな薄い数字 */
.sec-head{position:relative;margin-bottom:20px;padding:6px 0 6px 14px;border-left:5px solid var(--orange);min-height:56px;display:flex;flex-direction:column;justify-content:center;gap:2px}
.sec-head h2{font-size:22px;line-height:1.4;letter-spacing:.06em;font-weight:700;position:relative;z-index:1}
.sec-num{position:absolute;right:0;top:-34px;font-size:112px;line-height:1;font-weight:800;letter-spacing:0;color:var(--sb-sec-num);font-family:"Plus Jakarta Sans","Noto Sans JP",sans-serif;pointer-events:none}
.sec-note{font-size:13px;color:var(--ink-3);line-height:1.6;position:relative;z-index:1}

/* ブロック（影は 0 0 24px 黒 10% のみ） */
.block{background:var(--white);border-radius:var(--r-l);box-shadow:var(--sb-shadow);padding:20px 16px}
.band-white .block{background:var(--off)}
.block-soft{border-radius:var(--r-l);background:var(--off);padding:16px;margin-top:16px}
.band-off .block-soft{background:var(--white)}

/* ピルボタン：右端に墨の丸。ホバー・押下・フォーカスで矢印が入れ替わる（動き 1 種類め） */
.pill{position:relative;display:inline-flex;align-items:center;justify-content:space-between;gap:14px;min-height:var(--sb-hit);padding:4px 4px 4px 24px;border-radius:var(--pill);border:1px solid transparent;cursor:pointer;font-weight:700;font-size:15px;line-height:1.3;text-align:left;text-decoration:none;color:var(--ink);transition:background var(--sb-dur) var(--sb-ease)}
.pill-label{flex:1;min-width:0}
.pill-arrow{position:relative;flex:none;display:block;width:44px;height:44px;border-radius:var(--pill);background:var(--ink);color:var(--sb-on-dot);overflow:hidden;transition:background var(--sb-dur) var(--sb-ease),color var(--sb-dur) var(--sb-ease)}
.pill-arrow .ar{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;transition:transform var(--sb-dur) var(--sb-ease)}
.pill-arrow .a2{transform:translateX(-130%)}
.pill:hover .a1,.pill:active .a1,.pill:focus-visible .a1{transform:translateX(130%)}
.pill:hover .a2,.pill:active .a2,.pill:focus-visible .a2{transform:none}
.pill-primary{background:var(--orange);color:var(--sb-on-orange);min-height:var(--sb-hit-primary);font-size:16px}
.pill-primary .pill-arrow{width:48px;height:48px;background:var(--sb-on-orange);color:var(--sb-on-orange-fg)}
.pill-primary:hover,.pill-primary:active,.pill-primary:focus-visible{background:var(--orange-light)}
.pill-primary:hover .pill-arrow,.pill-primary:active .pill-arrow,.pill-primary:focus-visible .pill-arrow{background:var(--sb-on-orange-fg);color:var(--sb-on-orange)}
.pill-secondary{background:var(--sb-control);border-color:var(--rule);}
.band-white .pill-secondary{background:var(--sb-control)}
.pill-secondary:hover .pill-arrow,.pill-secondary:active .pill-arrow,.pill-secondary:focus-visible .pill-arrow{background:var(--orange);color:var(--sb-on-orange)}
.pill-sm{min-height:48px;font-size:14px;padding-left:20px}
.pill-sm .pill-arrow{width:40px;height:40px}
.pill[disabled],.pill[aria-disabled="true"]{background:var(--sb-sunken);color:var(--ink-3);border:1.5px dashed var(--edge);cursor:not-allowed}
.pill[disabled] .pill-arrow,.pill[aria-disabled="true"] .pill-arrow{background:var(--edge)}
.pill[disabled]:hover .a1,.pill[aria-disabled="true"]:hover .a1{transform:none}
.pill[disabled]:hover .a2,.pill[aria-disabled="true"]:hover .a2{transform:translateX(-130%)}
.pill-block{width:100%}
@media (prefers-reduced-motion:reduce){
  *{transition:none!important;animation:none!important}
  .pill-arrow .a2{display:none}
  .pill:hover .a1,.pill:active .a1,.pill:focus-visible .a1{transform:none}
}
:root[data-mode="field"] .pill-arrow .a2{display:none}
:root[data-mode="field"] .pill:hover .a1,:root[data-mode="field"] .pill:active .a1,:root[data-mode="field"] .pill:focus-visible .a1{transform:none}

/* せり上がり表示（動き 2 種類め。ページごとに 1 回だけ） */
@keyframes rise{from{opacity:0;transform:translateY(24px)}to{opacity:1;transform:none}}
.rise{animation:rise var(--sb-dur-rise) var(--sb-ease) 1 both}

/* 判定タグ：形のマークと言葉をセットで */
.vtag{display:inline-flex;align-items:center;gap:6px;min-height:30px;padding:3px 14px 3px 8px;border-radius:var(--pill);font-size:13px;font-weight:700;line-height:1.3;white-space:nowrap}
.vm{width:20px;height:20px;flex:none}.vm-lg{width:28px;height:28px}
.v-no{background:var(--sb-v-no-fill);color:var(--sb-v-no-on)}
.v-needs{background:var(--sb-v-needs-fill);color:var(--sb-v-needs-on);box-shadow:inset 0 0 0 2px var(--sb-v-needs-fg)}
.v-done{background:var(--sb-v-done-fill);color:var(--sb-v-done-on)}
.v-none{background:var(--sb-v-none-fill);color:var(--sb-v-none-on)}
.v-unknown{background:var(--sb-v-unknown-fill);color:var(--sb-v-unknown-on);box-shadow:inset 0 0 0 1.5px var(--sb-v-unknown-fg)}
.tag-pill{display:inline-flex;align-items:center;gap:4px;min-height:28px;padding:2px 12px;border-radius:var(--pill);background:var(--white);border:1px solid var(--rule);font-size:12.5px;line-height:1.4;color:var(--ink-2);font-weight:500}
.band-white .tag-pill,.block .tag-pill{background:var(--off)}
.tag-deadline{background:var(--orange-light)!important;border-color:transparent;color:var(--sb-on-orange);font-weight:700}
.tag-strong{background:var(--sb-inverse-bg)!important;border-color:transparent;color:var(--sb-inverse-fg);font-weight:700}

/* 結論の大きな印 */
.v-head{display:flex;align-items:center;gap:14px}
.v-big{flex:none;width:68px;height:68px;display:flex;align-items:center;justify-content:center;border-radius:var(--r-m)}
.v-big svg{width:44px;height:44px}
.vb-needs{background:var(--sb-v-needs-fill);color:var(--sb-v-needs-on);box-shadow:inset 0 0 0 3px var(--sb-v-needs-fg)}
.vb-no{background:var(--sb-v-no-fill);color:var(--sb-v-no-on)}
.vb-none{background:var(--sb-v-none-fill);color:var(--sb-v-none-on)}
.v-eyebrow{font-size:13px;color:var(--ink-3);font-weight:500;letter-spacing:.08em}
.v-word{font-size:30px;font-weight:800;line-height:1.25;letter-spacing:.08em}
.v-place{font-size:13px;color:var(--ink-3);line-height:1.6;margin-top:2px}
.v-lead{font-size:15px;line-height:1.85}
.v-lead strong{background:linear-gradient(transparent 62%,var(--sb-mark-bg) 62%)}
.v-meta{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.verdict-block{display:flex;flex-direction:column;gap:14px}

/* 入力 */
label.lbl,.lbl{display:block;font-size:14px;font-weight:700;margin-bottom:8px;letter-spacing:.05em}
.inp,select.inp{width:100%;height:52px;border:1.5px solid var(--edge);border-radius:var(--r-m);background:var(--sb-field);padding:0 16px;font-size:16px;color:var(--ink);letter-spacing:.03em}
select.inp{appearance:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='none' stroke='%23262523' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M5 8l5 5 5-5'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 14px center;background-size:20px;padding-right:44px}
.inp::placeholder{color:var(--ph);opacity:1}
.hint{margin-top:8px;font-size:12.5px;line-height:1.7;color:var(--ink-3)}
.btn-row{display:flex;flex-direction:column;gap:12px;margin-top:16px}
.input-block .lbl{margin-bottom:8px}

/* 地図・チップ */
.map-block{padding:12px;position:relative}
.map-frame{position:relative;border-radius:var(--r-m);overflow:hidden;border:1px solid var(--rule);aspect-ratio:640/440;background:var(--map-land)}
.map-svg{display:block;width:100%;height:100%;filter:var(--sb-tile-filter)}
.ct{stroke:var(--ct);stroke-width:1.4}.ct-major{stroke:var(--ct-major);stroke-width:2.2}
.layers{padding:14px 4px 4px}
.layers-title{font-size:14px;font-weight:700;line-height:1.5;margin-bottom:10px}
.layers-title span{display:block;font-size:12.5px;font-weight:400;color:var(--ink-3)}
.chips{display:flex;flex-wrap:wrap;gap:8px}
.chip{display:inline-flex;align-items:center;gap:8px;min-height:var(--sb-hit-min);padding:6px 16px 6px 12px;border-radius:var(--pill);cursor:pointer;font-size:14px;font-weight:700;line-height:1.2;background:transparent;transition:background var(--sb-dur) var(--sb-ease)}
.chip.is-on{background:var(--sb-control);border:2px solid var(--ink);color:var(--ink)}
.chip.is-off{border:2px dashed var(--edge);color:var(--ink-3);font-weight:500}
.chip.is-on .chk{flex:none;width:18px;height:18px;padding:2px;border-radius:var(--pill);background:var(--orange);color:var(--sb-on-orange)}
.chip .chk-empty{flex:none;width:18px;height:18px;border-radius:var(--pill);border:2px solid var(--edge)}
.chip.is-off svg:not(.chk){opacity:.6}
.chip>svg:not(.chk){border-radius:4px;background:var(--map-swatch-bg)}
.chip:hover,.chip:focus-visible{background:var(--sb-hover)}

/* 手続き・規制ごとの判定 */
.proc-grid{display:grid;grid-template-columns:1fr;gap:16px}
.proc{display:flex;gap:14px;align-items:flex-start}
.proc-no{flex:none;width:40px;height:40px;border-radius:var(--pill);background:var(--ink);color:var(--sb-on-dot);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:18px}
.proc-done .proc-no{background:var(--off);color:var(--sb-v-done-fg)}
.proc-body{display:flex;flex-direction:column;gap:8px;min-width:0}
.proc h3{font-size:16.5px;line-height:1.55;letter-spacing:.04em}
.proc-where{font-size:13.5px;color:var(--ink-2)}
.tags{display:flex;flex-wrap:wrap;gap:6px}
.proc-note{font-size:13px;line-height:1.75;color:var(--ink-3)}
.proc .pill{align-self:flex-start;margin-top:4px}
.items{padding:6px 16px}
.item{display:grid;grid-template-columns:36px 1fr;gap:6px 12px;padding:14px 0;border-bottom:1px solid var(--rule)}
.item:last-child{border-bottom:0}
.item .vtag{grid-column:2;justify-self:start}
.src{width:32px;height:32px;border-radius:var(--pill);display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;background:var(--beige);color:var(--ink)}
.band-beige .src{background:var(--white)}
.item-title{font-size:15px;font-weight:700;line-height:1.55}
.item-note{font-size:13.5px;color:var(--ink-2);line-height:1.75;margin-top:2px}
.legend-title{font-size:13px;font-weight:700;margin-bottom:8px}
.legend-row{display:flex;flex-wrap:wrap;gap:8px}
.disc-title{font-size:14px;font-weight:700;margin-bottom:6px}
.disc{font-size:13px;line-height:1.9;color:var(--ink-2)}
.copy{margin-top:16px;font-size:13px;color:var(--ink-2)}
.src-note{margin-top:6px;font-size:12px;line-height:1.8;color:var(--ink-3)}

/* ブランド */
.brand{display:flex;align-items:center;gap:10px;font-size:30px;font-weight:800;letter-spacing:.1em;line-height:1.2}
.brand-mark{display:inline-flex;width:44px;height:44px;align-items:center;justify-content:center;border-radius:var(--pill);background:var(--orange);color:var(--sb-on-orange);box-shadow:0 0 0 4px var(--sb-halo)}
.brand-drone{width:30px;height:auto}

/* 下 5 タブ（スマホ）と左メニュー（PC）、利用者メニュー */
.tabbar{position:sticky;bottom:0;z-index:5;display:grid;grid-template-columns:repeat(5,1fr);background:var(--white);border-top:1px solid var(--rule);padding-bottom:env(safe-area-inset-bottom)}
.tab{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;min-height:60px;padding:6px 0;font-size:12px;font-weight:700;color:var(--ink-2);text-decoration:none;line-height:1.2}
.tab-ic{width:56px;height:30px;border-radius:var(--pill);display:grid;place-items:center}
.tab-ic svg{width:22px;height:22px}
.tab[aria-current="page"]{color:var(--ink)}
.tab[aria-current="page"] .tab-ic{background:var(--orange);color:var(--sb-on-orange)}
.topbar{position:sticky;top:0;z-index:5;display:flex;align-items:center;gap:12px;min-height:60px;padding:8px 16px;background:var(--white);border-bottom:1px solid var(--rule)}
.topbar h1{flex:1;min-width:0;font-size:20px;font-weight:800;letter-spacing:.06em;line-height:1.3}
.topbar .sub{display:block;font-size:12.5px;font-weight:500;color:var(--ink-3);letter-spacing:.03em}
.me{flex:none;display:inline-flex;align-items:center;gap:10px;min-height:44px;min-width:44px;border-radius:var(--pill);border:1px solid var(--rule);background:var(--white);padding:0;cursor:pointer;font-weight:700}
.me-ic{width:42px;height:42px;border-radius:var(--pill);background:var(--ink);color:var(--sb-on-dot);display:grid;place-items:center;font-size:16px}
.me-name{display:none;font-size:14px;padding-right:16px}
.back{display:inline-flex;align-items:center;gap:6px;min-height:44px;padding:0 14px 0 8px;border-radius:var(--pill);font-size:14px;font-weight:700;text-decoration:none;color:var(--ink);border:1px solid var(--rule);background:var(--white)}
.back svg{width:20px;height:20px}
.side{display:none}

/* 行程の 1 行 */
.route{display:grid;grid-template-columns:repeat(7,1fr);gap:2px}
.rs{display:flex;flex-direction:column;align-items:center;gap:3px;padding:8px 0 6px;border-radius:var(--r-m);text-align:center;line-height:1.2}
.rs-dot{width:22px;height:22px;border-radius:var(--pill);display:grid;place-items:center}
.rs-dot svg{width:12px;height:12px}
.rs-name{font-size:13px;font-weight:700;letter-spacing:.02em}
.rs-state{font-size:12px;font-weight:500;color:var(--ink-3)}
.rs-done .rs-dot{background:var(--ink);color:var(--sb-on-dot)}
.rs-next{background:var(--orange);color:var(--sb-on-orange)}
.rs-next .rs-dot{background:var(--sb-on-orange);color:var(--orange)}
.rs-next .rs-state{color:var(--sb-on-orange);font-weight:700}
.rs-todo .rs-dot{border:2px dashed var(--edge)}
.rs-todo .rs-name{color:var(--ink-2);font-weight:500}

/* ホーム */
.stack{display:flex;flex-direction:column;gap:20px}
.sect-title{display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin-bottom:10px;font-size:17px;font-weight:800;letter-spacing:.06em;line-height:1.4;padding-left:12px;border-left:5px solid var(--orange)}
.sect-title .aside{font-size:13px;font-weight:500;color:var(--ink-3);letter-spacing:.03em}
.next-card{display:flex;flex-direction:column;gap:14px;padding:20px 16px}
.nc-top{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
.nc-reason{font-size:13px;font-weight:700;color:var(--ink-2)}
.nc-time{font-size:40px;font-weight:800;line-height:1;letter-spacing:.02em;font-family:"Plus Jakarta Sans","Noto Sans JP",sans-serif;font-variant-numeric:tabular-nums}
.nc-date{font-size:13px;color:var(--ink-3)}
.nc-title{font-size:20px;line-height:1.5;font-weight:800;letter-spacing:.05em}
.nc-facts{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:13.5px;color:var(--ink-2)}
.nc-facts b{color:var(--ink)}
.nc-next{font-size:13.5px;color:var(--ink-2);line-height:1.7}
.nc-next b{color:var(--ink)}
.list{padding:4px 16px}
.row{display:grid;grid-template-columns:1fr 40px;align-items:center;gap:12px;padding:14px 0;border-bottom:1px solid var(--rule);min-height:64px;color:inherit;text-decoration:none}
.row:last-child{border-bottom:0}
.row-main{display:flex;flex-direction:column;gap:4px;min-width:0}
.row-tags{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.row-title{font-size:15px;font-weight:700;line-height:1.5}
.row-sub{font-size:13px;color:var(--ink-2);line-height:1.6}
.row-go{width:36px;height:36px;border-radius:var(--pill);background:var(--ink);color:var(--sb-on-dot);display:grid;place-items:center;justify-self:end}
.row-go svg{width:18px;height:18px}
.more-link{display:inline-flex;align-items:center;min-height:44px;font-size:14px;font-weight:700;margin-top:4px}
.quiet{font-size:13px;color:var(--ink-3);line-height:1.7;padding:6px 0 10px}
.foot-band .disc{font-size:12.5px}

@media (min-width:900px){
  body{font-size:16px}
  .band{padding:56px 32px}
  .sec-head{margin-bottom:26px}
  .sec-head h2{font-size:26px}
  .sec-num{font-size:150px;top:-52px}
  .block{padding:28px}
  .map-block{padding:14px}
  .proc-grid{grid-template-columns:1fr 1fr}
  .proc{padding:24px}
  .item{grid-template-columns:40px 1fr auto;align-items:center;gap:16px;padding:18px 0}
  .item .vtag{grid-column:3;justify-self:end}
  .items{padding:8px 28px}
  .v-word{font-size:36px}.v-big{width:80px;height:80px}.v-big svg{width:52px;height:52px}
  .disc,.src-note{padding-right:18%}
}
`;
export const html = ({ title, attrs = "", bodyClass = "", body, css = "", lang = "ja" }) => `<!doctype html>
<html lang="${lang}"${attrs}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
${tokens}
${baseCss}
${css}
</style>
</head>
<body class="${bodyClass}">
${body}
</body>
</html>`;
