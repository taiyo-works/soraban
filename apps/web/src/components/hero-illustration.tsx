/*
 * 判定のトップの挿絵（丘の稜線・雲・日の出・ドローンの線画）。独自の SVG で、トップ（`/`）だけに置く。
 * Sprint 16 Q2（ユーザー決定）：塗りを外して線画に。線は墨（--sb-art-line）、日の出だけ橙、地は白。構図・高さ・位置は変えない。
 * 丘と雲の内側の白（--sb-art-cloud）は背後の線を隠すだけで、塗りの色ではない。ブランドの刷新で作り直す暫定の絵（docs/sprints/brand-visual-plan.md I-1）。
 *
 * - インライン SVG：画像の要求は 0 件。img ではないので LCP の要素にならない。優先読み込みもない。
 * - 装飾：aria-hidden、textContent なし。文字は丘の上に置かない（文字は挿絵の空の上だけ）。
 * - 色は --sb-art-*（挿絵専用）と --sb-orange・--sb-base だけ。
 * - 稜線は奥から手前へ線を太くする（奥 1.4〜1.6、中 1.8〜2、手前 2.4〜2.8）。丘の内側は白で、線は稜線だけ（縁に縦横の線を出さない）。
 * - 高さはスマホ 232px、PC 320px（soraban-ui.css の .sb-hero）。スマホ用と PC 用の 2 枚を CSS で切り替える。
 * 状態・効果・アニメーションを持たないサーバーコンポーネント。
 */

const CLOUD_PATH = "M26 62 C8 62 4 40 22 36 C22 18 46 10 58 24 C66 6 98 6 104 28 C124 22 142 36 134 52 C132 60 126 62 120 62 Z";

function Cloud({ x, y, scale, stroke }: { readonly x: number; readonly y: number; readonly scale: number; readonly stroke: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <path d={CLOUD_PATH} fill="var(--sb-art-cloud)" stroke="var(--sb-art-line)" strokeWidth={stroke} strokeLinejoin="round" />
    </g>
  );
}

/** 丘：内側は背後の線を隠す白だけ（線なし）。線は稜線だけに引き、画面の左右・下の縁に縦横の線を出さない。 */
function Hill({ d, ridge, w }: { readonly d: string; readonly ridge: string; readonly w: number }) {
  return (
    <>
      <path d={d} fill="var(--sb-art-cloud)" />
      <path d={ridge} fill="none" stroke="var(--sb-art-line)" strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" />
    </>
  );
}

function DroneLine({ x, y, width, height }: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }) {
  return (
    <svg x={x} y={y} width={width} height={height} viewBox="0 0 160 96" fill="none" stroke="var(--sb-art-line)" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
      <rect x="62" y="38" width="36" height="18" rx="9" fill="var(--sb-base)" />
      <circle cx="80" cy="47" r="4.5" />
      <path d="M64 42 L36 28 M96 42 L124 28 M64 52 L36 66 M96 52 L124 66" />
      <ellipse cx="30" cy="24" rx="22" ry="4.5" />
      <ellipse cx="130" cy="24" rx="22" ry="4.5" />
      <ellipse cx="30" cy="70" rx="22" ry="4.5" />
      <ellipse cx="130" cy="70" rx="22" ry="4.5" />
      <path d="M30 24 V28 M130 24 V28 M30 66 V70 M130 66 V70 M70 58 V68 M90 58 V68 M64 68 H76 M84 68 H96" />
    </svg>
  );
}

/** ブランドの丸の中の小さなドローン（装飾）。 */
export function BrandDrone() {
  return (
    <svg viewBox="0 0 160 96" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="62" y="38" width="36" height="18" rx="9" />
      <circle cx="80" cy="47" r="4.5" />
      <path d="M64 42 L36 28 M96 42 L124 28 M64 52 L36 66 M96 52 L124 66" />
      <ellipse cx="30" cy="24" rx="22" ry="4.5" />
      <ellipse cx="130" cy="24" rx="22" ry="4.5" />
      <ellipse cx="30" cy="70" rx="22" ry="4.5" />
      <ellipse cx="130" cy="70" rx="22" ry="4.5" />
      <path d="M30 24 V28 M130 24 V28 M30 66 V70 M130 66 V70" />
      <path d="M70 58 V68 M90 58 V68 M64 68 H76 M84 68 H96" />
    </svg>
  );
}

export function HeroIllustration() {
  return (
    <div className="sb-hero-art" aria-hidden="true" data-testid="hero-art">
      <div className="sb-art-m">
        <svg viewBox="0 22 390 128" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
          <circle cx="330" cy="104" r="22" fill="var(--sb-orange)" />
          <Cloud x={204} y={46} scale={0.3} stroke={6.7} />
          <Cloud x={340} y={58} scale={0.26} stroke={7.5} />
          <Hill d="M0 112 C60 96 130 104 200 116 S330 124 390 104 V150 H0Z" ridge="M0 112 C60 96 130 104 200 116 S330 124 390 104" w={1.4} />
          <Hill d="M0 132 C80 112 170 126 250 136 S350 130 390 120 V150 H0Z" ridge="M0 132 C80 112 170 126 250 136 S350 130 390 120" w={1.8} />
          <path d="M0 146 C90 136 180 142 270 148 S360 145 390 141" fill="none" stroke="var(--sb-art-line)" strokeWidth="2.4" strokeLinecap="round" />
          <DroneLine x={250} y={26} width={74} height={44} />
        </svg>
      </div>
      <div className="sb-art-p">
        <svg viewBox="0 40 1280 280" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
          <circle cx="1060" cy="168" r="56" fill="var(--sb-orange)" />
          <Cloud x={1110} y={52} scale={0.95} stroke={2.1} />
          <Cloud x={700} y={96} scale={0.62} stroke={3.2} />
          <Cloud x={1190} y={150} scale={0.55} stroke={3.6} />
          <path d="M690 258 C760 210 830 150 905 92" fill="none" stroke="var(--sb-art-line)" strokeWidth="2.4" strokeDasharray="2 9" strokeLinecap="round" />
          <Hill d="M0 262 C200 252 420 260 640 236 S1010 172 1280 194 V320 H0Z" ridge="M0 262 C200 252 420 260 640 236 S1010 172 1280 194" w={1.6} />
          <Hill d="M0 290 C240 268 460 294 700 274 S1070 228 1280 248 V320 H0Z" ridge="M0 290 C240 268 460 294 700 274 S1070 228 1280 248" w={2} />
          <path d="M0 313 C300 297 560 313 820 301 S1150 283 1280 295" fill="none" stroke="var(--sb-art-line)" strokeWidth="2.8" strokeLinecap="round" />
          <DroneLine x={880} y={48} width={150} height={90} />
        </svg>
      </div>
    </div>
  );
}
