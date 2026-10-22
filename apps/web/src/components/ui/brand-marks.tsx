import type { ReactNode } from "react";
import { cx } from "./cx";

// App icon proposals and the drone line art (Sprint 12g stage 1a, user request 2026-10-22).
// Not exported to public/ yet: they live here as SVG components until the user picks one.
//
// App icon rules: square, painted to all four corners, no rounded corners (the OS masks them), no text, flat and fine
// (no gloss, reflection or gradient). A drone outline plus a thin flight-path curve, with a different composition per
// proposal. Colours come from CSS variables so the proposals follow the palette chosen in the catalog; the fallbacks
// (a placeholder blue and white) apply when an icon is rendered outside `.ds`.

const BG = "var(--appicon-bg, #0a5fd0)";
const FG = "var(--appicon-fg, #ffffff)";

type MarkProps = {
  /** CSS pixels. The icon is square. */
  readonly size?: number;
  readonly className?: string;
  /** Accessible name. Omit for decorative use. */
  readonly label?: string;
};

function Mark({ size = 180, className, label, children }: MarkProps & { readonly children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 120 120"
      width={size}
      height={size}
      className={cx("block shrink-0", className)}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
      shapeRendering="geometricPrecision"
    >
      <rect width="120" height="120" fill={BG} />
      {children}
    </svg>
  );
}

const line = { fill: "none", stroke: FG, strokeLinecap: "round", strokeLinejoin: "round" } as const;
const solid = { fill: FG, stroke: "none" } as const;

/** One quadcopter seen from above, centred on (0, 0). `arm` is the distance from the body to each rotor on both axes. */
function QuadTop({ arm, rotor, body, stroke }: { readonly arm: number; readonly rotor: number; readonly body: number; readonly stroke: number }) {
  const hub = arm - rotor * 0.72; // arms stop at the rotor's rim, so the line never crosses the ring
  const k = body / 2 + 1;
  return (
    <>
      <g {...line} strokeWidth={stroke}>
        <path d={`M${-k} ${-k}L${-hub} ${-hub}M${k} ${-k}L${hub} ${-hub}M${-k} ${k}L${-hub} ${hub}M${k} ${k}L${hub} ${hub}`} />
        <circle cx={-arm} cy={-arm} r={rotor} />
        <circle cx={arm} cy={-arm} r={rotor} />
        <circle cx={-arm} cy={arm} r={rotor} />
        <circle cx={arm} cy={arm} r={rotor} />
      </g>
      <rect x={-body / 2} y={-body / 2} width={body} height={body} rx={body * 0.32} {...solid} />
    </>
  );
}

/** Proposal A: seen from straight above and centred; a single flight path ends in a dot below. Calm and symmetric. */
export function AppIconTopView(props: MarkProps) {
  return (
    <Mark {...props}>
      <g transform="translate(60 51)">
        <QuadTop arm={27} rotor={13} body={17} stroke={4.4} />
      </g>
      <path d="M17 104C33 109 44 98 60 100.5S88 106 100 99" {...line} strokeWidth={3.8} opacity={0.9} />
      <circle cx="103" cy="97.5" r="4.2" {...solid} />
    </Mark>
  );
}

/** Proposal B: the drone banks at the upper right, a long trail sweeps up from the lower left corner and thins out. */
export function AppIconSweep(props: MarkProps) {
  return (
    <Mark {...props}>
      <path d="M-6 112C22 112 30 92 46 79S60 64 63 58" {...line} strokeWidth={4} opacity={0.95} />
      <path d="M-6 130C26 128 38 106 54 94" {...line} strokeWidth={3.6} opacity={0.5} />
      <path d="M12 140C38 138 52 118 66 108" {...line} strokeWidth={3.2} opacity={0.26} />
      <g transform="translate(77 44) rotate(-16)">
        <QuadTop arm={21} rotor={10} body={13} stroke={4.2} />
      </g>
    </Mark>
  );
}

/**
 * Proposal C: a side view of the drone hovering inside a thin geofence ring. The ring is cut open at the lower right
 * and ends in a dot, so it reads as a path that goes around the area.
 */
export function AppIconOrbit(props: MarkProps) {
  return (
    <Mark {...props}>
      <path d="M97.6 87.4A42 42 0 1 1 104 74" {...line} strokeWidth={3.8} opacity={0.9} />
      <circle cx="100.5" cy="82" r="4.2" {...solid} />
      <g transform="translate(60 61) scale(1.22) translate(-60 -61)">
        <g {...line} strokeWidth={3.6}>
          <rect x="46" y="55" width="28" height="12" rx="6" />
          <path d="M46 61H36M74 61h10M36 61v-8M84 61v-8M26 53h20M74 53h20" />
          <path d="M60 67v4M51 74h18" />
        </g>
        <circle cx="60" cy="76.5" r="3" {...solid} />
      </g>
    </Mark>
  );
}

export const APP_ICON_PROPOSALS = [
  { id: "top-view", label: "案 A「真上」", note: "真上から見たドローンを中央に、航跡を下端に細く", Icon: AppIconTopView },
  { id: "sweep", label: "案 B「航跡」", note: "小さなドローンを右上に、航跡を左下の隅から大きく", Icon: AppIconSweep },
  { id: "orbit", label: "案 C「周回」", note: "横から見たドローンを、上下の細い周回の線で囲む", Icon: AppIconOrbit },
] as const;

/**
 * Drone line art for empty states (kept small). Stroke 1.75px regardless of scale (non-scaling-stroke), currentColor.
 * Decorative: always aria-hidden.
 */
export function DroneLineArt({ className, width = 160 }: { readonly className?: string; readonly width?: number }) {
  const s = { fill: "none", stroke: "currentColor", strokeWidth: 1.75, strokeLinecap: "round", strokeLinejoin: "round", vectorEffect: "non-scaling-stroke" } as const;
  return (
    <svg viewBox="0 0 200 140" width={width} height={(width * 140) / 200} aria-hidden="true" focusable="false" className={cx("shrink-0", className)}>
      {/* ground shadow and the flight path trailing behind */}
      <ellipse cx="100" cy="122" rx="34" ry="5" {...s} opacity={0.35} />
      <path d="M8 118C34 118 46 106 66 104" {...s} strokeDasharray="0.5 6" opacity={0.8} />
      {/* arms run from the body to each rotor hub (the far pair sits higher, the near pair lower and larger) */}
      <path d="M85 59L57 38M115 59l28-21M85 71L52 87M115 71l33 16" {...s} />
      {/* rotor discs (perspective ellipses) with a blade line and a hub post each */}
      <ellipse cx="52" cy="34" rx="24" ry="6.5" {...s} />
      <ellipse cx="148" cy="34" rx="24" ry="6.5" {...s} />
      <ellipse cx="44" cy="84" rx="27" ry="7.5" {...s} />
      <ellipse cx="156" cy="84" rx="27" ry="7.5" {...s} />
      <path d="M34 32.5l36 3M130 35.5l36-3M24 82l40 4M136 86l40-4" {...s} opacity={0.45} />
      <path d="M52 34v5M148 34v5M44 84v5M156 84v5" {...s} />
      {/* body and camera gimbal */}
      <rect x="82" y="54" width="36" height="22" rx="8" {...s} />
      <path d="M100 76v6" {...s} />
      <circle cx="100" cy="87" r="5" {...s} />
    </svg>
  );
}
