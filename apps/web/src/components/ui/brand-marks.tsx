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

/** Proposal 1: seen from straight above, centred; the flight path runs along the bottom. */
export function AppIconTopView(props: MarkProps) {
  return (
    <Mark {...props}>
      <g {...line} strokeWidth={4.5}>
        <rect x="51" y="43" width="18" height="18" rx="5" />
        <path d="M54 46L41 33M66 46l13-13M54 58L41 71M66 58l13 13" />
        <circle cx="32" cy="24" r="12" />
        <circle cx="88" cy="24" r="12" />
        <circle cx="32" cy="80" r="12" />
        <circle cx="88" cy="80" r="12" />
      </g>
      <path d="M16 103C34 109 46 96 62 100S90 107 104 98" {...line} strokeWidth={3} opacity={0.85} />
    </Mark>
  );
}

/** Proposal 2: a small drone banking at the upper right, with a long path sweeping in from the lower left corner. */
export function AppIconSweep(props: MarkProps) {
  return (
    <Mark {...props}>
      <path d="M-4 118C28 116 24 90 46 78S58 62 62 56" {...line} strokeWidth={3.2} opacity={0.9} />
      <path d="M6 128C42 124 36 98 58 86" {...line} strokeWidth={2.6} opacity={0.5} />
      <g transform="translate(78 42) rotate(-15) scale(0.66)" {...line} strokeWidth={6.5}>
        <rect x="-8" y="-8" width="16" height="16" rx="5" />
        <path d="M-6-6L-20-20M6-6l14-14M-6 6L-20 20M6 6l14 14" />
        <circle cx="-26" cy="-26" r="8.5" />
        <circle cx="26" cy="-26" r="8.5" />
        <circle cx="-26" cy="26" r="8.5" />
        <circle cx="26" cy="26" r="8.5" />
      </g>
    </Mark>
  );
}

/** Proposal 3: a side view of the drone, ringed by a thin orbit path above and below. */
export function AppIconOrbit(props: MarkProps) {
  return (
    <Mark {...props}>
      <g {...line} strokeWidth={4.5}>
        <rect x="43" y="52" width="34" height="15" rx="7" />
        <path d="M43 58H30M77 58h13M30 58V45M90 58V45M18 45h24M78 45h24" />
        <path d="M60 67v6" />
        <circle cx="60" cy="76" r="4" />
        <path d="M49 67l-6 15M71 67l6 15M36 83h15M69 83h15" />
      </g>
      <g {...line} strokeWidth={3}>
        <path d="M16 94C34 112 86 112 104 92" opacity={0.9} />
        <path d="M24 32C42 14 78 14 96 32" opacity={0.55} />
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
      {/* flight path */}
      <path d="M12 126C46 126 54 108 80 104" {...s} strokeDasharray="1 6" />
      {/* arms run to the rotor hubs */}
      <path d="M88 62L52 42M112 62l36-20M90 74L64 94M110 74l26 20" {...s} />
      {/* rotor discs (perspective ellipses) with a hub each */}
      <ellipse cx="50" cy="40" rx="24" ry="7" {...s} />
      <ellipse cx="150" cy="40" rx="24" ry="7" {...s} />
      <ellipse cx="62" cy="96" rx="24" ry="7" {...s} />
      <ellipse cx="138" cy="96" rx="24" ry="7" {...s} />
      <path d="M50 38v4M150 38v4M62 94v4M138 94v4" {...s} />
      {/* body and camera */}
      <path d="M86 58h28a6 6 0 0 1 6 6v8a6 6 0 0 1-6 6H86a6 6 0 0 1-6-6v-8a6 6 0 0 1 6-6z" {...s} />
      <circle cx="100" cy="88" r="5" {...s} />
      <path d="M100 78v5" {...s} />
    </svg>
  );
}
