import type { ReactNode, SVGProps } from "react";
import { cx } from "./cx";

// Icon set (Sprint 12g stage 1a, ui-direction.md 3.6). Hand-drawn inline SVG, no external images or libraries.
// 24px grid, 1.75 stroke on every icon, round caps and joins, currentColor, aria-hidden (the meaning is carried by the
// adjacent text; an icon-only button gets an aria-label on the button).

export const ICON_VIEWBOX = "0 0 24 24";
export const ICON_STROKE = 1.75;

const dot = (cx: number, cy: number, r = 1.1): ReactNode => <circle cx={cx} cy={cy} r={r} fill="currentColor" stroke="none" />;

export const ICON_PATHS = {
  // navigation and domain
  today: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="3.5" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
      {dot(8.5, 14.5)}
    </>
  ),
  plan: (
    <>
      <rect x="4.5" y="3.5" width="15" height="17" rx="3.5" />
      <path d="M8.5 9l1.5 1.5L12.5 8M8.5 15l1.5 1.5 2.5-2.5M15 9.5h1.5M15 15.5h1.5" />
    </>
  ),
  journal: (
    <>
      <path d="M12 6.5C10 5 7.5 4.5 4.5 4.5v14c3 0 5.5.5 7.5 2 2-1.5 4.5-2 7.5-2v-14c-3 0-5.5.5-7.5 2z" />
      <path d="M12 6.5v14" />
    </>
  ),
  flight: (
    <>
      <path d="M21 3L3 10.5l7 3 3 7z" />
      <path d="M10 13.5L21 3" />
    </>
  ),
  inspection: (
    <>
      <rect x="5" y="4.5" width="14" height="16" rx="3" />
      <path d="M9.5 3.5h5a1 1 0 0 1 1 1v1.5h-7V4.5a1 1 0 0 1 1-1z" />
      <path d="M9 13.5l2 2 4-4.5" />
    </>
  ),
  incident: <path d="M13.2 3L5.5 13.4h5.6L10.2 21l8.3-10.8h-5.7z" />,
  permit: (
    <>
      <path d="M7.5 3.5h6.4l4.6 4.6V18a2.5 2.5 0 0 1-2.5 2.5h-8.5A2.5 2.5 0 0 1 5 18V6a2.5 2.5 0 0 1 2.5-2.5z" />
      <path d="M13.5 3.8V8h4.7" />
      <path d="M9 14.3l2.1 2.1 3.9-4" />
    </>
  ),
  aircraft: (
    <>
      <rect x="9.5" y="9.5" width="5" height="5" rx="1.6" />
      <path d="M10.1 10.1L7.5 7.5M13.9 10.1l2.6-2.6M10.1 13.9l-2.6 2.6M13.9 13.9l2.6 2.6" />
      <circle cx="5.6" cy="5.6" r="2.6" />
      <circle cx="18.4" cy="5.6" r="2.6" />
      <circle cx="5.6" cy="18.4" r="2.6" />
      <circle cx="18.4" cy="18.4" r="2.6" />
    </>
  ),
  pilot: (
    <>
      <circle cx="12" cy="8" r="3.6" />
      <path d="M4.5 20c.8-3.8 3.8-6 7.5-6s6.7 2.2 7.5 6" />
    </>
  ),
  place: (
    <>
      <path d="M12 21s-6.5-5.7-6.5-11a6.5 6.5 0 0 1 13 0c0 5.3-6.5 11-6.5 11z" />
      <circle cx="12" cy="10" r="2.3" />
    </>
  ),
  map: (
    <>
      <path d="M9 5.5L3.5 7.5v11L9 16.5l6 2 5.5-2v-11l-5.5 2z" />
      <path d="M9 5.5v11M15 7.5v11" />
    </>
  ),
  more: (
    <>
      {dot(5.5, 12, 1.5)}
      {dot(12, 12, 1.5)}
      {dot(18.5, 12, 1.5)}
    </>
  ),
  // actions
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M15.5 15.5l5 5" />
    </>
  ),
  command: (
    <>
      <path d="M9 9h6v6H9z" />
      <path d="M9 9V6.5A2.5 2.5 0 1 0 6.5 9H9M15 9V6.5A2.5 2.5 0 1 1 17.5 9H15M9 15v2.5A2.5 2.5 0 1 1 6.5 15H9M15 15v2.5a2.5 2.5 0 1 0 2.5-2.5H15" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  "chevron-left": <path d="M14.5 6l-6 6 6 6" />,
  "chevron-right": <path d="M9.5 6l6 6-6 6" />,
  "chevron-up": <path d="M6 14.5l6-6 6 6" />,
  "chevron-down": <path d="M6 9.5l6 6 6-6" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  // status
  "check-circle": (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12.3l2.8 2.8 5.4-5.6" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5.5" />
      {dot(12, 7.8)}
    </>
  ),
  alert: (
    <>
      <path d="M12 4L3 19.5h18z" />
      <path d="M12 10v4.2" />
      {dot(12, 17)}
    </>
  ),
  ban: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M5.7 5.7l12.6 12.6" />
    </>
  ),
  dot: <circle cx="12" cy="12" r="5" fill="currentColor" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.2 2" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="10.5" width="14" height="10" rx="3" />
      <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
    </>
  ),
  history: (
    <>
      <path d="M4 12a8 8 0 1 0 2.6-5.9L4 8.5" />
      <path d="M4 4v4.5h4.5M12 8v4.2l2.8 1.8" />
    </>
  ),
  help: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.6 9.6a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2-2.4 3.5" />
      {dot(12, 16.9)}
    </>
  ),
  // controls
  filter: <path d="M4 5.5h16l-6.2 7.4V19l-3.6 1.5v-7.6z" />,
  sort: <path d="M8 19V5M8 5L4.5 8.5M8 5l3.5 3.5M16 5v14M16 19l-3.5-3.5M16 19l3.5-3.5" />,
  sliders: (
    <>
      <path d="M4 8h9M17 8h3M4 16h3M11 16h9" />
      <circle cx="15" cy="8" r="2" />
      <circle cx="9" cy="16" r="2" />
    </>
  ),
  columns: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="3" />
      <path d="M9.2 4.5v15M14.8 4.5v15" />
    </>
  ),
  list: (
    <>
      <path d="M9 7h11M9 12h11M9 17h11" />
      {dot(4.8, 7, 1.2)}
      {dot(4.8, 12, 1.2)}
      {dot(4.8, 17, 1.2)}
    </>
  ),
  sidebar: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="3" />
      <path d="M9.5 4.5v15" />
    </>
  ),
  maximize: <path d="M14 4.5h5.5V10M10 19.5H4.5V14M19.5 4.5l-6 6M4.5 19.5l6-6" />,
  minimize: <path d="M19.5 10H14V4.5M4.5 14H10v5.5M14 10l6-6M10 14l-6 6" />,
  // theme
  sun: (
    <>
      <circle cx="12" cy="12" r="3.8" />
      <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6L7 7M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4" />
    </>
  ),
  moon: <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a6.8 6.8 0 0 0 10.5 10.5z" />,
  monitor: (
    <>
      <rect x="3.5" y="4.5" width="17" height="12" rx="2.5" />
      <path d="M9 20h6M12 16.5V20" />
    </>
  ),
  // utility
  "external-link": <path d="M13 4.5h6.5V11M19.5 4.5L11 13M17 14v3.5a2 2 0 0 1-2 2H6.5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2H10" />,
  copy: (
    <>
      <rect x="8.5" y="8.5" width="11" height="11" rx="2.5" />
      <path d="M15.5 8.5v-2a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2" />
    </>
  ),
  download: <path d="M12 4.5v10M7.5 10.5L12 15l4.5-4.5M5 19.5h14" />,
  keyboard: (
    <>
      <rect x="2.5" y="6" width="19" height="12" rx="3" />
      <path d="M7 10h.5M11.75 10h.5M16.5 10h.5M8 14h8" />
    </>
  ),
  "sign-out": <path d="M10 4.5H6.5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2H10M15 8l4 4-4 4M19 12H9.5" />,
} as const satisfies Record<string, ReactNode>;

export type IconName = keyof typeof ICON_PATHS;
export const ICON_NAMES = Object.keys(ICON_PATHS) as readonly IconName[];

type IconProps = {
  readonly name: IconName;
  /** CSS pixels. Default 20. */
  readonly size?: number;
  readonly className?: string;
} & Omit<SVGProps<SVGSVGElement>, "name" | "viewBox" | "children" | "className" | "width" | "height">;

/** Decorative icon: always aria-hidden. Give the button or the neighbouring text the accessible name. */
export function Icon({ name, size = 20, className, ...rest }: IconProps) {
  return (
    <svg
      {...rest}
      viewBox={ICON_VIEWBOX}
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={ICON_STROKE}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={cx("shrink-0", className)}
    >
      {ICON_PATHS[name]}
    </svg>
  );
}
