import Link from "next/link";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import { cx, type DataAttrs } from "./cx";
import { Icon, type IconName } from "./icons";

// Presentational building blocks (Sprint 12g stage 1a). Server-safe: no hooks, no state.
// Every component forwards unknown props (so `data-testid` and `aria-*` pass through, like the existing ops Badge).

export type Meaning = "ok" | "warn" | "danger" | "info" | "neutral";

/** The shape that goes with each meaning (colour is never the only cue). */
export const MEANING_ICON: Readonly<Record<Meaning, IconName>> = {
  ok: "check-circle",
  warn: "alert",
  danger: "ban",
  info: "info",
  neutral: "dot",
};

const PILL: Readonly<Record<Meaning, string>> = {
  ok: "bg-ok-bg text-ok-fg [--pill-line:var(--ok-line)]",
  warn: "bg-warn-bg text-warn-fg [--pill-line:var(--warn-line)]",
  danger: "bg-danger-bg text-danger-fg [--pill-line:var(--danger-line)]",
  info: "bg-info-bg text-info-fg [--pill-line:var(--info-line)]",
  neutral: "bg-neutral-bg text-neutral-fg [--pill-line:var(--neutral-line)]",
};

const BAR: Readonly<Record<Meaning, string>> = {
  ok: "bg-ok-bg text-ok-fg [--bar-line:var(--ok-line)]",
  warn: "bg-warn-bg text-warn-fg [--bar-line:var(--warn-line)]",
  danger: "bg-danger-bg text-danger-fg [--bar-line:var(--danger-line)]",
  info: "bg-info-bg text-info-fg [--bar-line:var(--info-line)]",
  neutral: "bg-neutral-bg text-neutral-fg [--bar-line:var(--neutral-line)]",
};

// ── Status pill ──────────────────────────────────────────────────────────────

/** A status as a small ruled mark: one of five meanings, always icon + text. */
export function StatusPill({
  meaning = "neutral",
  icon,
  children,
  className,
  ...rest
}: {
  readonly meaning?: Meaning;
  readonly icon?: IconName;
  readonly children: ReactNode;
  readonly className?: string;
} & DataAttrs) {
  return (
    <span
      {...rest}
      data-meaning={meaning}
      className={cx(
        "inline-flex min-h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-ctl border border-[color-mix(in_srgb,var(--pill-line)_45%,var(--bg-surface))] px-2 text-aux font-medium field:min-h-8 field:px-3 field:text-state field:font-bold",
        PILL[meaning],
        className,
      )}
    >
      <Icon name={icon ?? MEANING_ICON[meaning]} size={14} className="text-[color:var(--pill-line)] field:h-5 field:w-5" />
      {children}
    </span>
  );
}

// ── Button ───────────────────────────────────────────────────────────────────

type Variant = "primary" | "secondary" | "quiet" | "danger";

// The label wraps inside the frame instead of overflowing (min-width, max-width:100%, balanced lines, phrase breaks for
// Japanese). A pressed button gets a darker fill and a 1px shift, never a scale. Nothing casts a shadow.
const BUTTON_BASE =
  "inline-flex max-w-full select-none items-center justify-center gap-2 rounded-ctl border py-2 text-center text-body font-medium leading-snug touch-manipulation [text-wrap:balance] [word-break:auto-phrase] [overflow-wrap:anywhere] " +
  "transition-[background-color,border-color,color] duration-[var(--dur)] ease-[var(--ease)] enabled:act:translate-y-px aria-disabled:cursor-not-allowed disabled:cursor-not-allowed";

const BUTTON_VARIANT: Readonly<Record<Variant, string>> = {
  primary:
    "border-transparent bg-accent-solid font-semibold text-accent-fg enabled:hov:bg-accent-solid-hover enabled:act:bg-[color-mix(in_srgb,var(--accent-solid-hover)_82%,#000)] " +
    "disabled:border-line disabled:bg-sunken disabled:text-fg-mute aria-disabled:border-line aria-disabled:bg-sunken aria-disabled:text-fg-mute",
  secondary:
    "border-line-strong bg-surface text-fg enabled:hov:border-fg enabled:hov:bg-sunken enabled:act:border-fg enabled:act:bg-sunken " +
    "disabled:border-line disabled:bg-sunken disabled:text-fg-mute aria-disabled:border-line aria-disabled:bg-sunken aria-disabled:text-fg-mute",
  // The disabled quiet button has no fill to lose, so a dashed rule marks it as present but unavailable.
  quiet:
    "border-transparent text-accent enabled:hov:bg-accent-soft enabled:hov:underline enabled:act:bg-accent-soft " +
    "disabled:border-dashed disabled:border-line disabled:text-fg-mute aria-disabled:border-dashed aria-disabled:border-line aria-disabled:text-fg-mute",
  danger:
    "border-danger-line bg-danger-bg text-danger-fg enabled:hov:brightness-95 enabled:act:brightness-90 " +
    "disabled:border-line disabled:bg-sunken disabled:text-fg-mute aria-disabled:border-line aria-disabled:bg-sunken aria-disabled:text-fg-mute",
};

const BUTTON_SIZE = {
  md: "min-h-11 min-w-28 px-4 field:min-h-14 field:px-5 field:text-[1.125rem]",
  sm: "min-h-11 min-w-20 px-3 field:min-h-14",
  icon: "min-h-11 min-w-11 px-0 field:min-h-14 field:min-w-14",
} as const;

export function buttonClass(variant: Variant = "secondary", size: keyof typeof BUTTON_SIZE = "md", extra?: string): string {
  return cx(BUTTON_BASE, BUTTON_VARIANT[variant], BUTTON_SIZE[size], extra);
}

export function Spinner({ size = 18, label }: { readonly size?: number; readonly label?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      className="shrink-0 animate-spin"
      role={label ? "status" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <circle cx="12" cy="12" r="9" stroke="var(--line-strong)" />
      <path d="M21 12a9 9 0 0 0-9-9" />
    </svg>
  );
}

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  readonly variant?: Variant;
  readonly size?: keyof typeof BUTTON_SIZE;
  readonly icon?: IconName;
  /** Loading: the button keeps its size, shows a spinner, and ignores clicks (aria-busy). */
  readonly loading?: boolean;
};

export function Button({ variant = "secondary", size = "md", icon, loading, className, children, onClick, type = "button", ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      aria-busy={loading || undefined}
      aria-disabled={loading || undefined}
      onClick={loading ? (e) => e.preventDefault() : onClick}
      className={buttonClass(variant, size, className)}
    >
      {loading ? <Spinner size={16} /> : icon ? <Icon name={icon} size={18} className="shrink-0" /> : null}
      {children}
    </button>
  );
}

/** A link that looks like a button. */
export function ButtonLink({
  variant = "secondary",
  size = "md",
  icon,
  className,
  children,
  href,
  ...rest
}: Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & { readonly href: string; readonly variant?: Variant; readonly size?: keyof typeof BUTTON_SIZE; readonly icon?: IconName }) {
  return (
    <Link {...rest} href={href} prefetch={false} className={buttonClass(variant, size, className)}>
      {icon ? <Icon name={icon} size={18} className="shrink-0" /> : null}
      {children}
    </Link>
  );
}

// ── Cards ────────────────────────────────────────────────────────────────────

/** Three card shapes: primary (large, one per screen), standard (a thin rule), inset (a ground step only, no border). */
export function Card({
  variant = "standard",
  as: Tag = "div",
  className,
  children,
  ...rest
}: { readonly variant?: "primary" | "standard" | "inset"; readonly as?: "div" | "section" | "article" | "aside" | "li"; readonly className?: string; readonly children: ReactNode } & Omit<HTMLAttributes<HTMLElement>, "className" | "children">) {
  return (
    <Tag
      {...rest}
      data-card={variant}
      className={cx(
        "min-w-0 rounded-ctl",
        variant === "primary" && "border border-line-strong bg-surface p-5 sm:p-6",
        variant === "standard" && "border border-line bg-surface p-4",
        variant === "inset" && "bg-sunken p-4",
        className,
      )}
    >
      {children}
    </Tag>
  );
}

/** Statistic tile: a number with its unit, a label, and a status (icon + text). The whole tile can be one link. */
export function StatTile({
  label,
  value,
  unit,
  status,
  meaning = "neutral",
  href,
  size = "row",
  ...rest
}: {
  readonly label: string;
  readonly value: ReactNode;
  readonly unit?: string;
  readonly status?: string;
  readonly meaning?: Meaning;
  readonly href?: string;
  /** "lead" is the one large tile; "row" is the compact list row. */
  readonly size?: "lead" | "row";
} & DataAttrs) {
  const body = (
    <>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-aux text-fg-mute">{label}</span>
        <span className="flex items-baseline gap-1">
          <span className={cx("font-semibold tabular-nums tracking-tight text-fg", size === "lead" ? "text-stat" : "text-h2")}>{value}</span>
          {unit ? <span className="text-aux text-fg-mute">{unit}</span> : null}
        </span>
      </span>
      {status ? <StatusPill meaning={meaning}>{status}</StatusPill> : null}
      {href ? <Icon name="chevron-right" size={18} className="text-fg-mute" /> : null}
    </>
  );
  // The lead tile has a rule around it; the compact rows have none and are separated by the list that holds them.
  const cls = cx(
    "flex items-center justify-between gap-3",
    size === "lead" ? "rounded-ctl border border-line-strong bg-surface p-5" : "py-3",
    href && "min-h-11 transition-colors hov:bg-accent-soft field:min-h-14",
  );
  return href ? (
    <Link {...rest} href={href} prefetch={false} className={cls}>
      {body}
    </Link>
  ) : (
    <div {...rest} className={cls}>
      {body}
    </div>
  );
}

// ── Page header, notice bar, empty state, skeleton, kbd, disclosure ─────────

/** Page header: title, optional back link, optional actions (one primary + one secondary at most). No description. */
export function PageHeader({
  title,
  back,
  meta,
  actions,
  as: Heading = "h1",
  ...rest
}: {
  /** Heading level: "h3" for a sample screen shown inside another page (one h1 per page). */
  readonly as?: "h1" | "h2" | "h3";
  readonly title: ReactNode;
  readonly back?: { readonly href: string; readonly label: string };
  readonly meta?: ReactNode;
  readonly actions?: ReactNode;
} & DataAttrs) {
  return (
    <header {...rest} className="flex flex-col gap-1">
      {back ? (
        <Link href={back.href} prefetch={false} className="-mb-1 inline-flex min-h-11 items-center gap-1 self-start text-aux text-accent hov:underline field:min-h-14">
          <Icon name="chevron-left" size={16} />
          {back.label}
        </Link>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
          <Heading className="text-h1 font-semibold text-fg">{title}</Heading>
          {meta ? <span className="text-table text-fg-mute">{meta}</span> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}

/** Fixed notice: always visible (never folded into a disclosure or a tooltip). 1-2 lines on a tonal band. */
export function NoticeBar({
  meaning = "info",
  icon,
  title,
  children,
  ...rest
}: { readonly meaning?: Meaning; readonly icon?: IconName; readonly title?: string; readonly children: ReactNode } & DataAttrs) {
  return (
    <div
      {...rest}
      role="note"
      data-meaning={meaning}
      className={cx("flex items-start gap-3 rounded-ctl border border-[color-mix(in_srgb,var(--bar-line)_40%,var(--bg-surface))] px-4 py-3 text-table", BAR[meaning])}
    >
      <Icon name={icon ?? MEANING_ICON[meaning]} size={18} className="mt-0.5 text-[color:var(--bar-line)]" />
      <div className="min-w-0 flex-1">
        {title ? <p className="font-semibold">{title}</p> : null}
        <div>{children}</div>
      </div>
    </div>
  );
}

/** Empty state: icon (or art), one line, the next action. A fuller explanation is allowed here and only here. */
export function EmptyState({
  icon = "list",
  art,
  title,
  children,
  action,
  ...rest
}: {
  readonly icon?: IconName;
  readonly art?: ReactNode;
  readonly title: string;
  readonly children?: ReactNode;
  readonly action?: ReactNode;
} & DataAttrs) {
  return (
    <div {...rest} className="flex flex-col items-center gap-3 rounded-ctl bg-sunken px-6 py-10 text-center">
      {art ? (
        <span className="text-fg-mute">{art}</span>
      ) : (
        <span className="text-fg-mute">
          <Icon name={icon} size={28} />
        </span>
      )}
      <p className="text-h3 font-semibold text-fg">{title}</p>
      {children ? <p className="max-w-[36ch] text-table text-fg-soft">{children}</p> : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}

/** Loading placeholder (decorative). */
export function Skeleton({ className }: { readonly className?: string }) {
  return <span aria-hidden="true" className={cx("ds-skeleton block rounded-ctl bg-sunken", className)} />;
}

/** A keyboard key cap. */
export function Kbd({ children }: { readonly children: ReactNode }) {
  return (
    <kbd className="inline-flex min-h-6 min-w-6 items-center justify-center rounded-ctl border border-line-strong bg-surface px-1.5 font-mono text-aux text-fg-soft">
      {children}
    </kbd>
  );
}

/** Disclosure ("説明"): native <details>. Closed on every visit (state is not remembered). */
export function Disclosure({
  summary,
  icon = "info",
  defaultOpen = false,
  children,
  ...rest
}: { readonly summary: ReactNode; readonly icon?: IconName; readonly defaultOpen?: boolean; readonly children: ReactNode } & DataAttrs) {
  return (
    <details {...rest} open={defaultOpen || undefined} className="group rounded-ctl bg-sunken">
      <summary className="flex min-h-11 field:min-h-14 field:text-body cursor-pointer list-none items-center gap-2 rounded-ctl px-4 text-table font-medium text-fg-soft hov:text-fg [&::-webkit-details-marker]:hidden">
        <Icon name={icon} size={16} className="text-fg-mute" />
        <span className="min-w-0 flex-1">{summary}</span>
        <Icon name="chevron-down" size={16} className="text-fg-mute transition-transform duration-[var(--dur)] group-open:rotate-180" />
      </summary>
      <div className="px-4 pb-4 text-table text-fg-soft">{children}</div>
    </details>
  );
}

/** Section heading inside a screen. */
export function SectionTitle({ children, aside, ...rest }: { readonly children: ReactNode; readonly aside?: ReactNode } & DataAttrs) {
  return (
    <div {...rest} className="flex items-center justify-between gap-3">
      <h2 className="text-h2 font-semibold text-fg">{children}</h2>
      {aside}
    </div>
  );
}
