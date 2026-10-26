// 共通の部品（warm-compare/src/build.mjs から引き継ぎ）。SVG の断片と判定マーク。
export function blob(cx, cy, r, seed, sx = 1, sy = 1) {
  const pts = [];
  const p1 = seed * 1.7, p2 = seed * 2.9, p3 = seed * 4.3;
  for (let i = 0; i <= 72; i++) {
    const t = (i / 72) * Math.PI * 2;
    const k = 1 + 0.13 * Math.sin(2 * t + p1) + 0.07 * Math.sin(3 * t + p2) + 0.035 * Math.sin(5 * t + p3);
    pts.push([cx + Math.cos(t) * r * k * sx, cy + Math.sin(t) * r * k * sy]);
  }
  return "M" + pts.map((p) => p[0].toFixed(1) + " " + p[1].toFixed(1)).join("L") + "Z";
}
export function contours(cx, cy, n, r0, step, seed, sx = 1, sy = 1) {
  let s = "";
  for (let i = 0; i < n; i++) {
    const major = i % 4 === 3;
    s += `<path d="${blob(cx, cy, r0 + i * step, seed + i * 0.05, sx, sy)}" class="${major ? "ct-major" : "ct"}"/>`;
  }
  return s;
}

export const DRONE = (cls = "") => `
<svg class="${cls}" viewBox="0 0 160 96" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <rect x="62" y="38" width="36" height="18" rx="9"/>
  <circle cx="80" cy="47" r="4.5"/>
  <path d="M64 42 L36 28 M96 42 L124 28 M64 52 L36 66 M96 52 L124 66"/>
  <ellipse cx="30" cy="24" rx="22" ry="4.5"/><ellipse cx="130" cy="24" rx="22" ry="4.5"/>
  <ellipse cx="30" cy="70" rx="22" ry="4.5"/><ellipse cx="130" cy="70" rx="22" ry="4.5"/>
  <path d="M30 24 V28 M130 24 V28 M30 66 V70 M130 66 V70"/>
  <path d="M70 58 V68 M90 58 V68 M64 68 H76 M84 68 H96"/>
</svg>`;

export const CLOUD_PATH = "M26 62 C8 62 4 40 22 36 C22 18 46 10 58 24 C66 6 98 6 104 28 C124 22 142 36 134 52 C132 60 126 62 120 62 Z";
export const CLOUD = () => `<svg viewBox="0 0 160 70" aria-hidden="true"><path d="${CLOUD_PATH}" fill="currentColor"/></svg>`;

export const ARROW = `<svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 10 H15 M10.5 5.5 L15 10 L10.5 14.5"/></svg>`;
export const EXT = `<svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 4 H16 V13 M16 4 L5 15"/></svg>`;
export const PIN_ICON = `<svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="10" cy="10" r="3.2"/><circle cx="10" cy="10" r="7"/><path d="M10 1.5 V4 M10 16 V18.5 M1.5 10 H4 M16 10 H18.5" stroke-linecap="round"/></svg>`;
export const CHECK = `<svg class="chk" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8.5 L6.5 12 L13 4.5"/></svg>`;

// 判定マーク（形で区別：×四角 / △ / ○にチェック / ○の輪 / 点線の四角に？）
export const symbols = (r) => `
<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
  <symbol id="m-no" viewBox="0 0 24 24"><rect x="3.5" y="3.5" width="17" height="17" rx="${r}" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M8.6 8.6 L15.4 15.4 M15.4 8.6 L8.6 15.4" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" fill="none"/></symbol>
  <symbol id="m-needs" viewBox="0 0 24 24"><path d="M12 3.6 L21.2 19.6 H2.8 Z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/><path d="M12 9.6 V14.2" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><circle cx="12" cy="17" r="1.3" fill="currentColor"/></symbol>
  <symbol id="m-done" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.6" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M7.8 12.4 L10.9 15.4 L16.4 9" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></symbol>
  <symbol id="m-none" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.2" fill="none" stroke="currentColor" stroke-width="3.4"/></symbol>
  <symbol id="m-unknown" viewBox="0 0 24 24"><rect x="3.5" y="3.5" width="17" height="17" rx="${r}" fill="none" stroke="currentColor" stroke-width="2.2" stroke-dasharray="3 2.6"/><path d="M9.7 9.6 a2.4 2.4 0 1 1 3.5 2.1 c-.8.5-1.2 1-1.2 1.9" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="16.9" r="1.2" fill="currentColor"/></symbol>
</defs></svg>`;
export const vm = (k, cls = "vm") => `<svg class="${cls}" aria-hidden="true"><use href="#m-${k}"/></svg>`;
export const LABEL = { no: "飛行不可", needs: "要手続き", done: "手続き済み", none: "手続き不要", unknown: "判定不能" };
export const vtag = (k, text = LABEL[k]) => `<span class="vtag v-${k}">${vm(k)}<span>${text}</span></span>`;

// ───────── 地図 ─────────
export function mapSvg(d) {
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
  <circle cx="330" cy="232" r="46" fill="var(--pin-halo)" stroke="var(--map-ink)" stroke-width="2" stroke-dasharray="2 5" stroke-linecap="round"/>
  <circle cx="330" cy="232" r="13" fill="var(--orange)" stroke="var(--map-ink)" stroke-width="3.5"/>
  <circle cx="330" cy="232" r="4" fill="var(--map-ink)"/>
  <g font-size="24" font-weight="700" fill="var(--map-ink)">
    <rect x="352" y="196" width="150" height="34" rx="${d.mapChipR}" fill="#fff" stroke="var(--map-ink)" stroke-width="2"/>
    <text x="364" y="221">米子市役所</text>
    <rect x="248" y="262" width="62" height="32" rx="${d.mapChipR}" fill="var(--map-ink)"/><text x="259" y="285" fill="#fff" font-size="22">DID</text>
    <text x="440" y="344" font-size="22">空港等周辺</text>
    <text x="84" y="190" font-size="22">公園</text>
  </g>
</svg>`;
}

export const LAYERS = [
  ["DID", "did", true], ["工業専用", "ind", false], ["空港等周辺", "air", true], ["小型無人機法", "law", true],
  ["都市公園", "park", true], ["指定史跡", "heri", false], ["公衆密集地", "crowd", true],
];
export const swatch = (k) => ({
  did: `<svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><rect x="2" y="3" width="16" height="14" rx="2" fill="var(--did-tint)" stroke="var(--did-line)" stroke-width="2"/><path d="M5 15 L15 5 M9 16 L17 8 M3 11 L9 5" stroke="var(--did-line)" stroke-width="1.6"/></svg>`,
  ind: `<svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><rect x="2" y="3" width="16" height="14" rx="2" fill="#B9B7AE" stroke="#4A4843" stroke-width="1.6"/></svg>`,
  air: `<svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><circle cx="10" cy="10" r="7.5" fill="none" stroke="var(--air-line)" stroke-width="2.2" stroke-dasharray="3.4 2.4"/></svg>`,
  law: `<svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><circle cx="10" cy="10" r="7.5" fill="none" stroke="var(--map-ink)" stroke-width="2.2"/><circle cx="10" cy="10" r="2.6" fill="var(--map-ink)"/></svg>`,
  park: `<svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><rect x="2" y="3" width="16" height="14" rx="5" fill="none" stroke="var(--park-line)" stroke-width="2" stroke-dasharray="1.5 3.2" stroke-linecap="round"/><circle cx="7" cy="10" r="1.4" fill="var(--park-line)"/><circle cx="13" cy="10" r="1.4" fill="var(--park-line)"/></svg>`,
  heri: `<svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><path d="M10 2.5 L17.5 10 L10 17.5 L2.5 10 Z" fill="none" stroke="var(--map-ink)" stroke-width="2"/></svg>`,
  crowd: `<svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><circle cx="10" cy="10" r="7.5" fill="none" stroke="var(--map-ink)" stroke-width="2.2" stroke-dasharray="1.2 3.2" stroke-linecap="round"/></svg>`,
}[k]);

export const ITEMS = [
  ["国", "航空法 第132条の85　人口集中地区（DID）", "この地点は DID の中です。無人航空機を飛ばすには国土交通大臣の許可・承認が要ります。", "needs"],
  ["国", "航空法　空港等周辺", "空港等の周辺区域の外です。", "none"],
  ["国", "小型無人機等飛行禁止法", "対象施設の周辺地域の外です。", "none"],
  ["県", "鳥取県 迷惑行為等防止条例（庁舎の周辺 100m）", "施設管理者の同意を記録済みです。条件：飛行前に管理者へ連絡。", "done"],
  ["市", "米子市 都市公園条例", "公園の区域データが未整備のため、判定できません。市の窓口で確認してください。", "unknown"],
];
