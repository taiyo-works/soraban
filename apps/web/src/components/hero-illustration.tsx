/*
 * 公開の `/` のヘッダーの挿絵（C 案：地図の帯の上の飛行経路。2026-11-04 ユーザー決定。docs/design/header-c/）。
 * 見出しの下端に、地図の格子（薄い面と罫）の帯を置き、その上を墨の太い経路線が離陸点から着陸点へ進む。
 * 経由点（白地に墨の輪）・離陸点（白の面に墨の輪）・着陸点（墨の面）・ドローン（墨の線画）は SVG の中。
 *
 * - インライン SVG：画像の要求は 0 件。img ではないので LCP の要素にならない。優先読み込みもない。
 * - 装飾：aria-hidden、textContent なし。文字は帯の上に置かない。
 * - 挿絵の色は墨と白だけ（グラデーションなし。Sprint 16-A：橙は使わない）。
 * - 帯の格子と経路は、幅に合わせて伸縮する（preserveAspectRatio="none"＋non-scaling-stroke で線の太さは一定）。
 *   点とドローンは入れ子の SVG（x を % で置き、サイズは px）で、伸縮で楕円にならない。
 * - 高さはスマホ 128px、PC 240px（soraban-ui.css の .sb-hero）。帯はスマホ 40px、PC 84px。スマホ用と PC 用の 2 枚を CSS で切り替える。
 * 状態・効果・アニメーションを持たないサーバーコンポーネント。
 */

type Pt = readonly [number, number];

/** 帯（viewBox の幅 w、高さ h）の座標 → 入れ子 SVG の位置（x は %、y は px）。 */
const at = (w: number, [x, y]: Pt) => ({ x: `${((x / w) * 100).toFixed(3)}%`, y });

function Band({ w, h, grid, route, waypoints, start, end, drone, droneW }: {
  readonly w: number;
  readonly h: number;
  readonly grid: string;
  readonly route: readonly Pt[];
  readonly waypoints: readonly Pt[];
  readonly start: Pt;
  readonly end: Pt;
  readonly drone: Pt;
  readonly droneW: number;
}) {
  const d = route.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x} ${y}`).join(" ");
  const dh = droneW * 0.6;
  return (
    <svg aria-hidden="true">
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" width="100%" height="100%" fill="none">
        <path d={grid} fill="none" stroke="var(--sb-rule)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        <path d={d} fill="none" stroke="var(--sb-art-line)" strokeWidth={6} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      </svg>
      {waypoints.map((p) => (
        <svg key={p.join()} {...at(w, p)} width="0" height="0" overflow="visible">
          <circle r={7} fill="var(--sb-art-cloud)" stroke="var(--sb-art-line)" strokeWidth={2.5} />
        </svg>
      ))}
      <svg {...at(w, start)} width="0" height="0" overflow="visible">
        <circle r={8} fill="var(--sb-art-sky)" stroke="var(--sb-art-line)" strokeWidth={2.5} />
      </svg>
      <svg {...at(w, end)} width="0" height="0" overflow="visible">
        <circle r={5} fill="var(--sb-art-line)" />
      </svg>
      <svg {...at(w, drone)} width="0" height="0" overflow="visible">
        <DroneLine x={-droneW / 2} y={-dh / 2} width={droneW} height={dh} />
      </svg>
    </svg>
  );
}

function DroneLine({ x, y, width, height }: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }) {
  return (
    <svg x={x} y={y} width={width} height={height} viewBox="0 0 160 96" fill="none" stroke="var(--sb-art-line)" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
      <rect x="62" y="38" width="36" height="18" rx="9" fill="var(--sb-art-cloud)" />
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
        <Band
          w={375}
          h={40}
          grid="M0 12 H375 M0 28 H375 M60 0 V40 M140 0 V40 M220 0 V40 M300 0 V40"
          route={[[18, 31], [96, 31], [140, 12], [236, 12], [286, 26], [350, 26]]}
          waypoints={[[140, 12], [286, 26]]}
          start={[18, 31]}
          end={[350, 26]}
          drone={[342, 12]}
          droneW={52}
        />
      </div>
      <div className="sb-art-p">
        <Band
          w={1280}
          h={84}
          grid="M0 28 H1280 M0 56 H1280 M160 0 V84 M320 0 V84 M480 0 V84 M640 0 V84 M800 0 V84 M960 0 V84 M1120 0 V84"
          route={[[40, 66], [300, 66], [420, 26], [760, 26], [900, 54], [1180, 54]]}
          waypoints={[[300, 66], [760, 26]]}
          start={[40, 66]}
          end={[1180, 54]}
          drone={[1160, 28]}
          droneW={88}
        />
      </div>
    </div>
  );
}
