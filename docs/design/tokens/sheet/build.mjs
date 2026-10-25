// 実行: node docs/design/tokens/sheet/build.mjs → index.html（外部通信なし）。撮影は shoot.mjs
// 等高線は、アプリの contour.ts（apps/web/src/components/ui/catalog/）をそのまま読んで使う。
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../../..");
const { contours, wobbleLine } = await import(path.join(root, "apps/web/src/components/ui/catalog/contour.ts"));

const tokens = fs.readFileSync(path.join(here, "../soraban-tokens.css"), "utf8");
// 暗・現場を 1 枚に並べるため、:root の宣言を同じ中身の枠（.sc-*）に写す。media は除く
const scoped = tokens
  .replace(/@media \(prefers-color-scheme: dark\) \{[\s\S]*?\n\}\n/, "")
  .replace(/@media \(prefers-reduced-motion[\s\S]*$/, "")
  .replace(/:root\[data-theme="dark"\]\[data-mode="field"\]/g, ".sc-dark.sc-field")
  .replace(/:root\[data-theme="dark"\]/g, ".sc-dark")
  .replace(/:root\[data-mode="field"\]/g, ".sc-field");

const svgPaths = (spec) => {
  const c = contours(spec);
  const minor = c.lines.filter((l) => !l.index).map((l) => l.d).join("");
  const major = c.lines.filter((l) => l.index).map((l) => l.d).join("");
  const labels = c.labels.map((l) => `<text class="cl-label" transform="translate(${l.x.toFixed(1)} ${l.y.toFixed(1)}) rotate(${l.angle})" text-anchor="middle" dy="3">${l.text}</text>`).join("");
  return `<svg viewBox="0 0 ${spec.width} ${spec.height}" preserveAspectRatio="xMaxYMid slice" width="100%" height="100%" aria-hidden="true"><path class="cl-minor" d="${minor}"/><path class="cl-major" d="${major}"/>${labels}</svg>`;
};
const headArt = svgPaths({ seed: 21, width: 1100, height: 330, cell: 8, hills: [{ x: 820, y: 130, rx: 260, ry: 100, turn: 0.35, h: 1 }, { x: 430, y: 290, rx: 160, ry: 60, turn: -0.3, h: 0.5 }], step: 0.05, floor: 40, rise: 10 });
const emptyArt = svgPaths({ seed: 9, width: 520, height: 230, cell: 7, hills: [{ x: 260, y: 120, rx: 150, ry: 70, turn: -0.15, h: 1 }, { x: 90, y: 190, rx: 80, ry: 40, turn: 0.4, h: 0.45 }], step: 0.06, floor: 30, rise: 10 });
const homeArt = svgPaths({ seed: 5, width: 375, height: 150, cell: 7, hills: [{ x: 300, y: 60, rx: 95, ry: 48, turn: 0.4, h: 1 }], step: 0.07, floor: 20, rise: 10 });
const rule = (seed, fig) => `<svg class="rule-line" viewBox="0 0 900 16" preserveAspectRatio="none" aria-hidden="true"><path d="${wobbleLine(seed, 850, 2.6, 8)}" fill="none" stroke="var(--sb-copper)" stroke-width="1.4" vector-effect="non-scaling-stroke"/><text x="878" y="9" text-anchor="middle" dominant-baseline="central" style="font:10px var(--sb-font-lat);fill:var(--sb-ink-3)">${fig}</text></svg>`;

const SYM = `<svg width="0" height="0" style="position:absolute" aria-hidden="true">
<symbol id="m-no" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M7.5 7.5l9 9M16.5 7.5l-9 9" stroke="currentColor" stroke-width="2.4" fill="none"/></symbol>
<symbol id="m-needs" viewBox="0 0 24 24"><path d="M12 3L22 20.5H2Z" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="miter"/><path d="M12 9.5v5.5" stroke="currentColor" stroke-width="2.4"/><rect x="11" y="16.6" width="2" height="2" fill="currentColor"/></symbol>
<symbol id="m-done" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M7.5 12.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="2.2"/></symbol>
<symbol id="m-none" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.6" fill="none" stroke="currentColor" stroke-width="3.2"/></symbol>
<symbol id="m-unknown" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="3 2.6"/><path d="M9.6 9.4c.2-1.6 1.3-2.4 2.6-2.4 1.5 0 2.6.9 2.6 2.2 0 2-2.6 2.1-2.6 4.1" fill="none" stroke="currentColor" stroke-width="2"/><rect x="11.2" y="15.7" width="1.9" height="1.9" fill="currentColor"/></symbol>
<symbol id="i-arrow" viewBox="0 0 20 20"><path d="M3 10h13M11 4.5L16.5 10 11 15.5" fill="none" stroke="currentColor" stroke-width="2"/></symbol>
<symbol id="i-check" viewBox="0 0 20 20"><path d="M4 10.5l4 4 8-9" fill="none" stroke="currentColor" stroke-width="2.6"/></symbol>
<symbol id="i-x" viewBox="0 0 20 20"><path d="M5 5l10 10M15 5L5 15" fill="none" stroke="currentColor" stroke-width="2.6"/></symbol>
<symbol id="i-circle" viewBox="0 0 20 20"><circle cx="10" cy="10" r="3.6" fill="none" stroke="currentColor" stroke-width="2"/></symbol>
<symbol id="i-menu" viewBox="0 0 24 24"><path d="M5 9h14M5 15h14" stroke="currentColor" stroke-width="2" fill="none"/></symbol>
<symbol id="n-home" viewBox="0 0 24 24"><path d="M4 11l8-7 8 7v9H4Z" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linejoin="round"/><path d="M10 20v-6h4v6" fill="none" stroke="currentColor" stroke-width="1.75"/></symbol>
<symbol id="n-judge" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.75"/><path d="M12 2.5v5M12 16.5v5M2.5 12h5M16.5 12h5" stroke="currentColor" stroke-width="1.75"/></symbol>
<symbol id="n-plan" viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="15" fill="none" stroke="currentColor" stroke-width="1.75"/><path d="M4 10h16M9 3v4M15 3v4" stroke="currentColor" stroke-width="1.75" fill="none"/></symbol>
<symbol id="n-log" viewBox="0 0 24 24"><path d="M5 4h11a3 3 0 013 3v13H8a3 3 0 01-3-3Z" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linejoin="round"/><path d="M9 9h6M9 13h6" stroke="currentColor" stroke-width="1.75"/></symbol>
</svg>`;
const ic = (id, c = "") => `<svg class="i ${c}" aria-hidden="true"><use href="#${id}"/></svg>`;
const mk = (k, t, fill = "") => `<span class="mark mk-${k} ${fill}">${ic("m-" + k)}${t}</span>`;
const VN = { no: "飛行不可", needs: "要手続き", done: "手続き済み", none: "手続き不要", unknown: "判定不能" };
const stamp = (k, sub) => `<div class="stamp st-${k}">${ic("m-" + k)}<span>${VN[k]}<small>${sub}</small></span></div>`;
const ar = `<span class="ar">${ic("i-arrow")}</span>`;
const btn = (cls, t, o = {}) => `<span class="btn ${cls}">${o.dots ? `<span class="dots"><i></i><i></i><i></i></span>` : ""}<span>${t}</span>${o.ar ? ar : ""}</span>`;
const fld = (cls, l, v, m = "", req = "") => `<div class="fld ${cls}"><div class="l"><span>${l}</span><em>${req}</em></div><div class="in">${v}${cls === "focus" ? '<i class="caret"></i>' : ""}</div>${m ? `<div class="m">${m}</div>` : ""}</div>`;
const chk = (st, nm, note = "") => `<div class="chk ${st}"><i class="cb">${st === "ok" ? ic("i-check") : st === "ng" ? ic("i-x") : ic("i-circle")}</i><span class="nm">${nm}${note ? `<small>${note}</small>` : ""}</span><b>${{ ok: "正常", ng: "異常", un: "未確認" }[st]}</b></div>`;
const mi = (n, e, o = "", cnt = "") => `<div class="mi ${o}"><span>${n}${cnt ? `<span class="badge cnt">${cnt}</span>` : ""}</span><span class="e">${e}</span></div>`;
const tab = (n, cur) => `<div class="tab${cur ? " cur" : ""}">${n}</div>`;
const tb = (cur) => `<div class="tabbar">${[["n-home", "ホーム"], ["n-judge", "判定"], ["n-plan", "計画"], ["n-log", "日誌"]].map(([g, n]) => `<div class="it${cur === n ? " cur" : ""}">${ic(g)}${n}</div>`).join("")}<div class="hb">${ic("i-menu")}</div></div>`;

// 色の表示（ratio は check-contrast.mjs で出した値を貼らず、ここで同じ式で計算する）
const hexOf = (s) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));
const L = (h) => { const [r, g, b] = hexOf(h).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const R = (a, b) => { const x = L(a), y = L(b); return ((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)).toFixed(1); };
const lightTok = Object.fromEntries([...tokens.slice(0, tokens.indexOf('\n:root[data-mode="field"] {')).matchAll(/--sb-([\w-]+):\s*(#[0-9A-Fa-f]{6})/g)].map((m) => [m[1], m[2].toUpperCase()]));
const sw = (k, name, use, fgk = "ink", bgk = null) => {
  const bg = lightTok[k];
  const fg = L(bg) > 0.35 ? lightTok["ink"] : lightTok["base"];
  const against = bgk ? `${R(bg, lightTok[bgk])}:1 / ${bgk === "base" ? "地" : "面"}` : `${R(bg, fg)}:1`;
  return `<div style="background:${bg};color:${fg}"><b>${name}</b><span class="hx">${bg}</span><span>${use}</span><span class="ratio">${against}</span></div>`;
};

const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=2400"><title>そらばん デザインシステム 1枚シート</title>
<style>${tokens.replace(/@media \(prefers-color-scheme: dark\) \{[\s\S]*?\n\}\n/, "")}</style>
<style>${scoped.slice(scoped.indexOf("\n.sc-field {"))}</style>
<style>${fs.readFileSync(path.join(here, "sheet.css"), "utf8")}</style></head><body>${SYM}

<header class="sheet-head"><div class="art">${headArt}</div>
<div class="meta lat"><span>SORABAN / DESIGN SYSTEM</span><span>v1</span><span>2026-10-25</span><span>正は docs/design/design-system.md</span></div>
<h1>そらばん デザインシステム</h1>
<p>生成りの地、墨の文字、銅の線。ブロックは直角で、押せる部品だけ 3px。PC もスマホも同じ部品を使い、変えるのは配置と密度だけにする。</p></header>

<section class="sx"><div class="sh"><span class="no num">01</span><h2>色</h2><span class="sub">地は生成り、文字は墨。橙は面だけ、線と文字は銅。</span></div>
<div class="cols" style="grid-template-columns:1.75fr 1fr">
<div><div class="sw">
${sw("base", "地", "ページの背景")}${sw("surface", "面", "パネル・入力中の面")}${sw("sunken", "くぼみ", "入力欄・表の見出し")}${sw("ink", "墨（文字）", "本文・見出し")}
${sw("ink-2", "第二の文字", "補足・説明")}${sw("ink-3", "注釈", "12px の注釈", "ink", "base")}${sw("edge", "押せる部品の境", "ボタン・入力欄・チェック枠", "ink", "base")}${sw("rule", "罫", "区切り専用", "ink", "base")}
${sw("orange", "橙（面専用）", "主ボタン・CTA の塗り")}${sw("copper", "銅（線）", "短い線・現在地・フォーカス", "ink", "base")}${sw("copper-text", "銅（文字）", "リンク・強調の文字", "ink", "base")}${sw("contour", "等高線", "背景の線画", "ink", "base")}
</div><p class="cap">各色の数字は生成りの地または面に対する比。通常は文字 4.5:1・線 3:1、現場は 7:1・4.5:1。罫（1.6:1）と橙（2.0:1）は区切りと面だけに使い、押せる部品の境には使わない。</p></div>
<div>
<div class="sub-h">橙は面、銅は線と文字</div>
<div style="display:flex;flex-direction:column;gap:22px">
<div style="background:var(--sb-orange);color:var(--sb-on-orange);padding:22px 24px;font-weight:700;letter-spacing:.08em">橙の面に墨の文字<div class="note" style="color:var(--sb-on-orange);font-weight:400;margin-top:2px">7.1:1。面の上だけで使う</div></div>
<div class="panel" style="padding:22px 24px"><span class="bar"></span><b style="font-size:20px;letter-spacing:.06em">銅の短い線が、見出しの印</b><p class="note" style="margin-top:6px">線は 26px×2px。文字にするときは濃い銅で、<span style="color:var(--sb-copper-text);text-decoration:underline;text-underline-offset:4px">リンクは下線つき</span>。</p></div>
<div class="note"><b>使わない色</b>　ピンク・紫・金茶（判定色と混ざる）。橙の文字・橙のリンク（生成りの上で 2.0:1 で読めない）。灰色の枠だけのボタン（#C4C4C4 は地に 1.6:1）。</div>
</div></div></div></section>

<section class="sx sunk"><div class="sh"><span class="no num">02</span><h2>判定の印</h2><span class="sub">色だけで伝えない。形と文言を必ず添える。青は使わない。</span></div>
<div class="cols" style="grid-template-columns:1fr 1fr 1fr">
<div><div class="sub-h">印（面の上・小）</div><div style="display:flex;flex-direction:column;gap:16px;align-items:flex-start">
${mk("no", "飛行不可")}${mk("needs", "要手続き", "fill")}${mk("done", "手続き済み")}${mk("none", "手続き不要")}${mk("unknown", "判定不能")}</div>
<p class="cap">2px の枠＋形。琥珀の塗りは地との差が小さいので、必ず濃い枠で囲む。</p></div>
<div><div class="sub-h">結果の帯（塗り・白文字は 7:1 以上）</div><div style="display:flex;flex-direction:column;gap:10px">
${stamp("no", "この場所は飛行できません")}${stamp("needs", "飛行の前に手続きが必要です")}${stamp("done", "手続きは済んでいます（本人の記録）")}${stamp("none", "手続きは要りません")}${stamp("unknown", "判定できませんでした。窓口で確認してください")}</div></div>
<div><div class="sub-h">点検のチェック（3 状態）</div><div class="panel">
${chk("ok", "プロペラの欠け・ゆるみ")}${chk("ng", "バッテリーの外観", "ふくらみあり。備考が必須です")}${chk("un", "送信機の電池残量")}</div>
<p class="cap">正常は緑の実線枠と✓。異常は赤の塗りと✕で、備考を書くまで先へ進めない。未確認は灰の点線と○。全項目が正常になるまで「点検完了」は押せない。</p></div>
</div></section>

<section class="sx"><div class="sh"><span class="no num">03</span><h2>文字</h2><span class="sub">Noto Sans JP。階層は 3 段階、12px 未満は使わない。</span></div>
<div class="cols" style="grid-template-columns:1.1fr 1fr 1fr">
<div><div class="sub-h">見出し 20px / 700 / 行間 1.5</div><h3 style="font-size:20px">飛行の前に確かめること</h3>
<div class="sub-h" style="margin-top:28px">本文 15px / 400 / 行間 1.75</div><p>申請の内容は、ご本人が入力して確認します。提出もご本人の名義で行います。このアプリは記入欄と確認の手順をそろえるだけで、書類の作成を代わりに行うことはありません。</p>
<div class="sub-h" style="margin-top:28px">注釈 12px / 400 / 行間 1.7</div><p class="note">最終更新 2026-10-25 08:30。判定は参考情報です。</p></div>
<div><div class="sub-h">数字は等幅</div><div class="num" style="font-size:34px;line-height:1.4;font-weight:600">2026-10-25 08:30<br>120.5 m　0.62 kg</div><p class="cap">Manrope の等幅数字（tabular-nums）。桁がそろい、表で縦に読める。</p>
<div class="sub-h" style="margin-top:28px">見出しの英字</div><div class="lat" style="font-size:12px;font-weight:700;letter-spacing:.16em">HOME　CHECK　PLAN　LOG</div><p class="cap">英字は見出しの上の小さなラベルと、メニューの添え字だけ。12px・字間広め。</p></div>
<div><div class="sub-h">現場モードの大きさ</div><div style="font-size:24px;font-weight:700;line-height:1.5;letter-spacing:.06em">見出し 24px</div><div style="font-size:18px;line-height:1.75">本文 18px</div><div style="font-size:14px;line-height:1.7;color:var(--sb-ink-2)">注釈 14px</div>
<p class="cap" style="margin-top:20px">字間は本文 +0.04em、見出し +0.06em。見出しだけ palt（約物の詰め）。行は全角 35〜40 字まで。強調は 1 画面に 1 つ。</p></div>
</div></section>

<section class="sx sunk"><div class="sh"><span class="no num">04</span><h2>形と線</h2><span class="sub">ブロックは直角。押せる部品だけ 3px。丸は許可リストだけ。</span></div>
<div class="cols" style="grid-template-columns:1fr 1fr 1fr 1.15fr">
<div><div class="sub-h">直角（ブロック）</div><div class="panel" style="padding:20px 22px;min-height:120px"><b>パネル・カード・左メニュー</b><p class="note">角丸 0。区切りは 1px の罫と、面の明暗の差。</p></div></div>
<div><div class="sub-h">3px（押せる部品）</div><div style="display:flex;flex-direction:column;gap:14px">${btn("", "ボタン")}<div class="fld" style="width:auto">${'<div class="in">入力欄</div>'}</div><div style="display:flex;gap:14px;align-items:center"><i class="cb">${ic("i-check")}</i><span>チェックの枠</span></div></div></div>
<div><div class="sub-h">丸（許可リスト 4 つだけ）</div><div style="display:flex;gap:26px;align-items:center"><div style="text-align:center"><span class="round">${ic("i-menu")}</span><div class="note" style="margin-top:6px">ハンバーガー</div></div><div style="text-align:center"><span class="round" style="width:30px;height:30px;border:0;background:var(--sb-copper)"></span><div class="note" style="margin-top:6px">現在地</div></div><div style="text-align:center"><span class="badge" style="margin:4px 0 5px">3</span><div class="note">件数</div></div><div style="text-align:center"><span class="round" style="background:var(--sb-orange)">${ic("i-arrow")}</span><div class="note" style="margin-top:6px">矢印</div></div></div><p class="cap">矢印の丸の置き場は、主ボタン・CTA・丸の矢印ボタンの 3 か所だけ。</p></div>
<div><div class="sub-h">見出しの下は 1 本の等高線</div><b style="font-size:20px;letter-spacing:.06em">今週の計画</b>${rule(7, "120")}<div class="sub-h">モーフィズム：地に近い面だけ</div><div style="display:flex;gap:16px"><div class="panel" style="flex:1;padding:14px 16px"><span class="note">面（ごく弱い浮き）</span></div><div style="flex:1;padding:14px 16px;background:var(--sb-sunken);box-shadow:var(--sb-soft-in)"><span class="note">くぼみ（入力欄）</span></div></div><p class="cap">文字・境・押せる部品には陰影を使わない。現場は陰影をやめて 1.5px の罫にする。</p></div>
</div></section>

<section class="sx"><div class="sh"><span class="no num">05</span><h2>部品と状態</h2><span class="sub">押す部品は 48〜52px 以上（現場 56〜64px）。ホバーと同じ変化を押下・フォーカスにも付ける。</span></div>
<div class="cols" style="grid-template-columns:1.25fr 1fr">
<div><div class="sub-h">主ボタン（橙の面・右端に丸い矢印）</div>
<div class="srow"><span class="lab">通常</span>${btn("primary", "判定をはじめる", { ar: 1 })}<span class="lab">ホバー</span>${btn("primary hover", "判定をはじめる", { ar: 1 })}</div>
<div class="srow"><span class="lab">押下</span>${btn("primary press", "判定をはじめる", { ar: 1 })}<span class="lab">フォーカス</span>${btn("primary focus", "判定をはじめる", { ar: 1 })}</div>
<div class="srow"><span class="lab">無効</span>${btn("primary disabled", "点検を完了する", { ar: 1 })}<span class="note">未確認が 2 件あります。全項目が正常になると押せます。</span></div>
<div class="srow"><span class="lab">読み込み中</span>${btn("primary loading", "保存しています", { dots: 1 })}<span class="note" style="width:360px">現場は動かさず、文字と点の濃さで示す。</span></div>
<div class="sub-h" style="margin-top:28px">副ボタン・文字ボタン・警告</div>
<div class="srow"><span class="lab">副</span>${btn("", "下書きを保存")}${btn("hover", "ホバー")}${btn("press", "押下")}${btn("focus", "フォーカス")}${btn("disabled", "無効")}</div>
<div class="srow"><span class="lab">文字</span>${btn("text", "手順を見る")}<span class="lab">警告</span>${btn("danger", "記録を削除")}<span class="lab" style="width:100px">丸の矢印</span><span class="round">${ic("i-arrow")}</span></div>
<div class="sub-h" style="margin-top:28px">CTA（画面で 1 つ。右端に丸い矢印）</div>
<div class="cta"><span>今日の飛行を判定する<small>地点を選ぶと、必要な手続きが分かります</small></span>${ar}</div>
</div>
<div><div class="sub-h">入力欄（くぼみ・ラベルは常に上）</div><div style="display:grid;grid-template-columns:1fr 1fr;gap:20px 24px">
${fld("", "飛行場所", '<span class="ph">例：○○市△△町 河川敷</span>', "", "必須")}${fld("focus", "飛行場所", "○○市 河川敷", "", "必須")}
${fld("err", "機体の重量", '<span class="num">0.0</span>', `${ic("i-x")}<span>重量を入力してください。100g 以上の機体が対象です。</span>`, "必須")}${fld("dis", "登録番号", "自動入力", "", "変更不可")}</div>
<div class="sub-h" style="margin-top:32px">タブ</div><div class="tabs">${tab("判定", 1)}${tab("計画")}${tab("日誌" + `<span class="badge">2</span>`)}</div>
<div class="sub-h" style="margin-top:32px">データ表</div><table class="tbl"><tr><th>日付</th><th>場所</th><th>判定</th><th class="r">時間</th></tr>
<tr><td class="num">10-25</td><td>河川敷</td><td>${mk("none", "手続き不要")}</td><td class="r num">12:40</td></tr>
<tr><td class="num">10-24</td><td>造成地</td><td>${mk("needs", "要手続き", "fill")}</td><td class="r num">08:15</td></tr>
<tr><td class="num">10-22</td><td>空港周辺</td><td>${mk("no", "飛行不可")}</td><td class="r num">—</td></tr></table></div>
</div>
<div class="cols" style="grid-template-columns:520px 520px 1fr;margin-top:48px;align-items:start">
<div><div class="sub-h">ダイアログ（直角・不透明）</div><div class="dlg"><div class="hd"><span class="bar"></span><h3>提出前の確認</h3></div><div class="bd"><p>記入内容はご本人の入力です。内容を確認し、ご自身の名義で提出してください。</p></div><div class="ft">${btn("", "戻る")}${btn("primary", "確認して進む", { ar: 1 })}</div></div></div>
<div><div class="sub-h">トースト（反転した面・補助の通知だけ）</div><div class="toast">${ic("i-check")}<span style="flex:1">下書きを保存しました</span>${btn("text", "元に戻す")}</div><p class="cap">安全に関わる通知はトーストだけにせず、画面の中にも出す。</p>
<div class="sub-h" style="margin-top:28px">件数バッジ・ハンバーガー</div><div class="row"><span class="badge">3</span><span class="badge">12</span><span class="round">${ic("i-menu")}</span></div></div>
<div><div class="sub-h">空の状態（等高線＋次の操作）</div><div class="panel" style="display:grid;grid-template-columns:1fr 1fr;align-items:center"><div style="padding:24px 28px"><b style="font-size:20px">まだ日誌がありません</b><p class="note" style="margin:6px 0 14px">飛行を記録すると、ここに並びます。</p>${btn("", "日誌を書く")}</div><div style="height:230px">${emptyArt}</div></div></div>
</div></section>

<section class="sx sunk"><div class="sh"><span class="no num">06</span><h2>メニューとレイアウト</h2><span class="sub">PC は左メニュー、スマホは下タブ。同じ部品で、配置だけ変える。</span></div>
<div class="cols" style="grid-template-columns:1.35fr 375px 1fr;align-items:start">
<div><div class="sub-h">PC：左メニュー 240px（調べる／飛ばす／登録）＋ 複数ペイン</div>
<div class="panel" style="display:grid;grid-template-columns:240px 1fr 1fr;min-height:640px;box-shadow:none;border-color:var(--sb-edge)">
<div class="menu"><b class="lat" style="font-size:22px;letter-spacing:.08em;display:block;margin:0 12px 6px">soraban</b><span class="bar" style="margin-left:12px"></span>
<div class="grp">調べる</div>${mi("ホーム", "Home", "cur")}${mi("判定", "Check", "hover")}
<div class="grp">飛ばす</div>${mi("計画", "Plan", "", "2")}${mi("日誌", "Log")}
<div class="grp">登録</div>${mi("機体・操縦者", "Setup", "focus")}${mi("設定", "Settings")}
<div style="position:absolute;left:0;right:0;bottom:0;height:90px;opacity:.9">${homeArt}</div></div>
<div style="padding:28px 28px;border-right:1px solid var(--sb-rule-soft)"><span class="bar"></span><h3 style="font-size:20px">今日の予定</h3>${rule(3, "80")}<div class="panel" style="margin-top:6px">${chk("ok", "機体の登録確認")}${chk("un", "保険の期限")}</div><div style="margin-top:20px">${btn("primary", "点検をはじめる", { ar: 1 })}</div></div>
<div style="padding:28px 28px;background:var(--sb-base)"><span class="bar"></span><h3 style="font-size:20px">判定の結果</h3>${rule(9, "95")}${stamp("needs", "飛行の前に手続きが必要です")}<p class="note" style="margin-top:14px">最大幅は 1200px。左メニューの右に、一覧と詳細を並べる。</p></div></div></div>
<div><div class="sub-h">スマホ：下タブ 4 つ＋丸いハンバーガー</div><div class="phone"><div class="scr"><span class="bar"></span><h3 style="font-size:20px">ホーム</h3>${rule(5, "60")}
<div style="height:96px;margin:-6px -20px 8px;opacity:.9">${homeArt}</div>
${stamp("none", "今日の予定地は手続き不要です")}<div style="margin-top:16px">${btn("primary", "判定をはじめる", { ar: 1 }).replace('class="btn', 'style="width:100%;justify-content:space-between" class="btn')}</div><p class="note" style="margin-top:14px">1 画面 1 目的。主な操作は親指の届く下半分に置く。</p></div>${tb("ホーム")}</div></div>
<div><div class="sub-h">原則</div><div style="display:flex;flex-direction:column;gap:18px">
<div><b>主要な導線は隠さない</b><p class="note">ホーム・判定・計画・日誌・登録を、名称そのままでメニューに出す。ハンバーガーは登録・設定などの奥の入口だけ。</p></div>
<div><b>PC とスマホは同じ仕様</b><p class="note">部品も色も同じ。違うのは並べ方（左メニュー／下タブ）と、1 画面に載せる量だけ。</p></div>
<div><b>現在地は 3 つで示す</b><p class="note">左メニューは銅の点と短い線と太字。下タブは上の短い線と太字。色だけに頼らない。</p></div>
<div><b>幅の目安</b><p class="note">〜767px 下タブ／768〜1023px 下タブ＋2 ペイン／1024px〜 左メニュー。</p></div>
</div></div></div></section>

<section class="sx"><div class="sh"><span class="no num">07</span><h2>暗と現場モード</h2><span class="sub">暗は全体共通の夜間用（OS 設定で自動）。現場は動きなし・陰影なし・大きく。</span></div>
<div class="cols" style="grid-template-columns:repeat(3,1fr);column-gap:40px">
${[["", "明・通常", ""], ["sc-dark", "暗（夜間）", "sc-dark"], ["sc-field", "現場モード・明（56〜64px）", "sc-field"]].map(([c, t, cls]) => `<div><div class="sub-h">${t}</div><div class="frame ${cls}" style="${cls ? "" : ""}"><span class="bar"></span><b style="font-size:var(--sb-fs-head);letter-spacing:.06em">離陸前の点検</b>
<div class="panel" style="margin:14px 0 18px;${cls === "sc-field" ? "border:1.5px solid var(--sb-rule);box-shadow:none" : ""}">${chk("ok", "プロペラ")}${chk("ng", "バッテリー", "備考が必須です")}${chk("un", "送信機")}</div>
<div class="row" style="gap:12px;margin-bottom:16px">${mk("needs", "要手続き", "fill")}${mk("none", "不要")}${mk("no", "不可")}</div>
${btn("primary" + (cls === "sc-field" ? "" : ""), "点検を完了する", { ar: 1 }).replace(/class="btn primary/, 'style="width:100%;justify-content:space-between" class="btn primary')}</div></div>`).join("")}
</div></section>

<section class="sx sunk"><div class="sh"><span class="no num">08</span><h2>動きとアート</h2><span class="sub">事務所の PC と入口は豊かに、現場はゼロ。動画も外部ライブラリも使わない。</span></div>
<div class="cols" style="grid-template-columns:1fr 1fr">
<div><div class="sub-h">動き（時間は棒の長さ、1 秒 = 120px）</div><div class="motion">
<span>押下の色</span><i class="b" style="width:14px"></i><span class="num">120ms</span>
<span>状態の切り替え</span><i class="b" style="width:24px"></i><span class="num">200ms</span>
<span>メニュー（ふわっと）</span><i class="b" style="width:50px"></i><span class="num">420ms</span>
<span>下からせり上がる（1 回）</span><i class="b" style="width:96px"></i><span class="num">800ms</span>
<span>起動画面の拡大と色の膜</span><i class="b" style="width:120px"></i><span class="num">1000ms</span></div>
<p class="cap" style="margin-top:16px">イージングは出入りが cubic-bezier(0.2, 0.8, 0.2, 1)、メニューと膜が cubic-bezier(0.4, 0, 0.2, 1)。起動画面は初回だけ（ロゴと等高線）。現場モードと prefers-reduced-motion では全部 0ms。ホバーで跳ねる・拡大する動きは作らない。</p></div>
<div><div class="sub-h">等高線（contour.ts で生成。文字の背後には置かない）</div><div class="panel" style="height:240px;overflow:hidden;position:relative">${emptyArt.replace('width="100%" height="100%"', 'width="100%" height="100%" preserveAspectRatio="xMidYMid slice"')}<div style="position:absolute;left:28px;bottom:22px;background:var(--sb-surface);padding:10px 16px;border:1px solid var(--sb-rule-soft)"><b>起動画面：ロゴ＋等高線</b><div class="note">初回だけ。約 1 秒でゆっくり広がる</div></div></div>
<p class="cap">使う場所：ページ上部の余白／見出しの下の 1 本線／空の状態／起動画面。線は地の約 1.3 倍の濃さ、本文との差は最悪でも 9:1。</p></div>
</div></section>
</body></html>`;
fs.writeFileSync(path.join(here, "index.html"), html);
console.log("ok", (html.length / 1024).toFixed(0) + "KB");
