// Line art for the style trial: contour fields, a section rule that is one contour line, and a dummy map.
// All of it is drawn here from the generator in contour.ts. Colours come from the set's custom properties (--s-*).
import { buildingMarks, contours, waterLines, wobbleLine, type ContourSpec } from "./contour";

const cache = new Map<string, ReturnType<typeof contours>>();
function cached(key: string, spec: ContourSpec): ReturnType<typeof contours> {
  let c = cache.get(key);
  if (!c) {
    c = contours(spec);
    cache.set(key, c);
  }
  return c;
}

function ContourLines({ id, spec, clip }: { readonly id: string; readonly spec: ContourSpec; readonly clip?: string }) {
  const c = cached(id, spec);
  return (
    <g clipPath={clip ? `url(#${clip})` : undefined}>
      {c.lines.map((l, i) => (
        <path key={i} d={l.d} className={l.index ? "sty-c-index" : "sty-c"} strokeWidth={l.w} />
      ))}
      {c.labels.map((t, i) => (
        <text key={i} x={t.x} y={t.y} transform={`rotate(${t.angle} ${t.x} ${t.y})`} className="sty-c-label" textAnchor="middle" dominantBaseline="central">
          {t.text}
        </text>
      ))}
    </g>
  );
}

/** A band of contour lines (page head, empty states). Decorative: hidden from assistive technology. */
export function ContourBand({ id, spec, className }: { readonly id: string; readonly spec: ContourSpec; readonly className?: string }) {
  return (
    <svg className={`sty-art ${className ?? ""}`} viewBox={`0 0 ${spec.width} ${spec.height}`} preserveAspectRatio="xMaxYMid slice" aria-hidden="true" focusable="false">
      <ContourLines id={id} spec={spec} />
    </svg>
  );
}

/** The rule under a heading: one hand-drawn contour line that ends in a small elevation figure. */
export function ContourRule({ seed, figure }: { readonly seed: number; readonly figure: string }) {
  const w = 600;
  return (
    <svg className="sty-rule" viewBox={`0 0 ${w} 14`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <path d={wobbleLine(seed, w - 44, 2.4, 7)} className="sty-c-index" strokeWidth="1.1" vectorEffect="non-scaling-stroke" />
      <text x={w - 22} y="7.5" className="sty-c-label" textAnchor="middle" dominantBaseline="central">
        {figure}
      </text>
    </svg>
  );
}

export const HERO_SPEC: ContourSpec = {
  seed: 21,
  width: 640,
  height: 190,
  cell: 8,
  hills: [
    { x: 520, y: 80, rx: 150, ry: 62, turn: 0.35, h: 1 },
    { x: 330, y: 168, rx: 90, ry: 40, turn: -0.3, h: 0.5 },
  ],
  step: 0.05,
  floor: 40,
  rise: 10,
};

export const HOME_SPEC: ContourSpec = {
  seed: 5,
  width: 375,
  height: 130,
  cell: 7,
  hills: [{ x: 300, y: 50, rx: 95, ry: 48, turn: 0.4, h: 1 }],
  step: 0.07,
  floor: 20,
  rise: 10,
};

export const EMPTY_SPEC: ContourSpec = {
  seed: 9,
  width: 340,
  height: 150,
  cell: 7,
  hills: [
    { x: 170, y: 78, rx: 105, ry: 48, turn: -0.15, h: 1 },
    { x: 60, y: 120, rx: 50, ry: 28, turn: 0.4, h: 0.45 },
  ],
  step: 0.06,
  floor: 30,
  rise: 10,
};

const MAP_SPEC: ContourSpec = {
  seed: 11,
  width: 375,
  height: 700,
  cell: 7,
  hills: [
    { x: 316, y: 150, rx: 120, ry: 80, turn: 0.5, h: 1 },
    { x: 30, y: 230, rx: 80, ry: 70, turn: 0.1, h: 0.62 },
    { x: 250, y: 330, rx: 60, ry: 34, turn: -0.4, h: 0.32 },
    { x: 60, y: 440, rx: 120, ry: 70, turn: 0.2, h: 0.5 },
  ],
  step: 0.042,
  base: 0.1,
  floor: 10,
  rise: 10,
  minHeight: 0.1,
};

// the coast: land above and right, sea below-left. One outline clips the contours (land) and the water lining (sea).
const COAST_LINE = "M0 292 C30 288 52 304 78 318 C104 332 112 350 138 362 C152 369 160 380 170 396 C178 420 196 470 210 700";
const LAND = "M0 0 H375 V700 H210 C196 470 178 420 170 396 C160 380 152 369 138 362 C112 350 104 332 78 318 C52 304 30 288 0 292 Z";
const SEA = `${COAST_LINE} H0 V292 Z`;
const RIVER = "M338 -4 C322 40 352 74 322 112 C296 146 330 176 292 214 C262 244 276 270 238 296 C214 312 190 322 176 372";
const ROAD = "M-4 238 C60 222 96 252 150 246 C210 240 236 208 300 214 C330 217 352 206 380 192";
const RAIL = "M-4 262 C48 252 86 272 142 270";
const TOWN = "M118 168 L214 150 L262 196 L258 262 L196 290 L128 262 Z";

/** The dummy map of the judgement screen: terrain, coast, river, road, a built-up area, a restricted ring, and the point. */
export function MapPicture({ uid }: { readonly uid: string }) {
  const land = `${uid}-land`;
  const town = `${uid}-town`;
  const sea = `${uid}-sea`;
  const marks = buildingMarks(4, 128, 164, 256, 280, 46);
  return (
    <svg className="sty-map-svg" viewBox="0 0 375 700" preserveAspectRatio="xMidYMin slice" aria-hidden="true" focusable="false">
      <defs>
        <clipPath id={land}>
          <path d={LAND} />
        </clipPath>
        <clipPath id={sea}>
          <path d={SEA} />
        </clipPath>
        <clipPath id={town}>
          <path d={TOWN} />
        </clipPath>
      </defs>
      <rect width="375" height="700" className="sty-map-ground" />
      <ContourLines id={`map-${uid.split("-")[0]}`} spec={MAP_SPEC} clip={land} />
      {/* sea */}
      <g clipPath={`url(#${sea})`}>
        <path d={waterLines(6, 2, 210, 300, 700, 7)} className="sty-c-index" strokeWidth="0.8" />
      </g>
      <path d={COAST_LINE} className="sty-map-coast" />
      <g transform="translate(0 40)">
      {/* built-up area: hatching in the "needs procedure" ink, a dashed edge, and building marks */}
      <g clipPath={`url(#${town})`}>
        {Array.from({ length: 40 }, (_, i) => (
          <line key={i} x1={100 + i * 6} y1={140} x2={40 + i * 6} y2={300} className="sty-map-hatch" />
        ))}
      </g>
      <path d={TOWN} className="sty-map-town" />
      {marks.map((m, i) => (
        <rect key={i} x={m.x} y={m.y} width={m.s} height={m.s} className="sty-map-bldg" />
      ))}
      </g>
      {/* river, road with a casing, railway */}
      <path d={RIVER} className="sty-map-river" />
      <path d={ROAD} className="sty-map-road-casing" />
      <path d={ROAD} className="sty-map-road" />
      <path d={RAIL} className="sty-map-rail-ties" />
      <path d={RAIL} className="sty-map-rail" />
      {/* restricted ring around an aerodrome in the corner */}
      <circle cx="26" cy="20" r="112" className="sty-map-ring" />
      <path d="M-4 22 L58 6" className="sty-map-runway-casing" />
      <path d="M-4 22 L58 6" className="sty-map-runway" />
      {/* labels (halo keeps them readable over the lines) */}
      <text x="172" y="338" className="sty-map-label">見本町</text>
      <text x="268" y="262" className="sty-map-label sty-map-label-river" transform="rotate(-48 268 262)">見本川</text>
      <text x="318" y="150" className="sty-map-label">見本山 218</text>
      <text x="62" y="408" className="sty-map-label sty-map-label-sea">見本湾</text>
      <text x="64" y="104" className="sty-map-label sty-map-label-ring">空港周辺の制限区域</text>
      <g transform="translate(0 40)">
      {/* the point: a surveyor's cross inside a dashed accuracy ring; the centre dot is round on purpose (a position) */}
      <circle cx="196" cy="222" r="26" className="sty-map-accuracy" />
      <path d="M196 188 v22 M196 234 v22 M162 222 h22 M208 222 h22" className="sty-map-cross-casing" />
      <path d="M196 188 v22 M196 234 v22 M162 222 h22 M208 222 h22" className="sty-map-cross" />
      <circle cx="196" cy="222" r="5" className="sty-map-dot" />
      </g>
      {/* scale bar and north mark, drawn like a survey sheet */}
      <path d="M16 330 h72 M16 325 v10 M52 327 v6 M88 325 v10" className="sty-map-scale" />
      <text x="16" y="319" className="sty-map-label">0</text>
      <text x="76" y="319" className="sty-map-label">500 m</text>
    </svg>
  );
}
