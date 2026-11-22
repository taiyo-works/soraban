"use client";

import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { cx, type DataAttrs } from "./cx";
import { Icon, type IconName } from "./icons";

// Tabs (page-level switching), segmented control (2-4 choices, a display switch) and the bottom tab bar used by the
// workspace below 1024px. Opaque, ruled; the selected item is told apart by a rule, weight and colour together. Arrow keys move between items (roving tabindex); Home/End jump.

export type TabItem = { readonly id: string; readonly label: string; readonly icon?: IconName; readonly count?: number };

function useRoving(ids: readonly string[], value: string, onChange: (id: string) => void) {
  const refs = useRef(new Map<string, HTMLElement>());
  const onKeyDown = (e: KeyboardEvent<HTMLElement>): void => {
    const i = ids.indexOf(value);
    let n = -1;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") n = (i + 1) % ids.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") n = (i - 1 + ids.length) % ids.length;
    else if (e.key === "Home") n = 0;
    else if (e.key === "End") n = ids.length - 1;
    if (n < 0) return;
    e.preventDefault();
    const id = ids[n]!;
    onChange(id);
    refs.current.get(id)?.focus();
  };
  const ref = (id: string) => (el: HTMLElement | null) => {
    if (el) refs.current.set(id, el);
    else refs.current.delete(id);
  };
  return { onKeyDown, ref };
}

export const tabId = (prefix: string, id: string): string => `${prefix}-tab-${id}`;
export const panelId = (prefix: string, id: string): string => `${prefix}-panel-${id}`;

/** Underlined tabs. Pair each with a <TabPanel>. */
export function Tabs({
  tabs,
  value,
  onChange,
  label,
  idPrefix,
  ...rest
}: {
  readonly tabs: readonly TabItem[];
  readonly value: string;
  readonly onChange: (id: string) => void;
  readonly label: string;
  readonly idPrefix: string;
} & DataAttrs) {
  const { onKeyDown, ref } = useRoving(tabs.map((t) => t.id), value, onChange);
  return (
    <div {...rest} role="tablist" aria-label={label} onKeyDown={onKeyDown} className="flex max-w-full gap-1 overflow-x-auto border-b border-line [scrollbar-width:none]">
      {tabs.map((t) => {
        const active = t.id === value;
        return (
          <button
            key={t.id}
            ref={ref(t.id)}
            type="button"
            role="tab"
            id={tabId(idPrefix, t.id)}
            aria-selected={active}
            aria-controls={panelId(idPrefix, t.id)}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(t.id)}
            className={cx(
              "-mb-px inline-flex min-h-12 shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 text-body transition-colors duration-[var(--dur)] field:min-h-14",
              active ? "border-accent font-semibold text-fg" : "border-transparent text-fg-soft hov:text-fg",
            )}
          >
            {t.icon ? <Icon name={t.icon} size={18} /> : null}
            {t.label}
            {t.count !== undefined ? <span className="rounded-pill bg-sunken px-1.5 text-aux tabular-nums text-fg-soft">{t.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

export function TabPanel({ idPrefix, id, active, children }: { readonly idPrefix: string; readonly id: string; readonly active: boolean; readonly children: ReactNode }) {
  return (
    <div role="tabpanel" id={panelId(idPrefix, id)} aria-labelledby={tabId(idPrefix, id)} hidden={!active} tabIndex={0} className="pt-4">
      {children}
    </div>
  );
}

/** Segmented control. A radio group: one choice selected. */
export function Segmented({
  options,
  value,
  onChange,
  label,
  ...rest
}: {
  readonly options: readonly { readonly id: string; readonly label: string; readonly icon?: IconName }[];
  readonly value: string;
  readonly onChange: (id: string) => void;
  readonly label: string;
} & DataAttrs) {
  const { onKeyDown, ref } = useRoving(options.map((o) => o.id), value, onChange);
  return (
    <div {...rest} role="radiogroup" aria-label={label} onKeyDown={onKeyDown} className="inline-flex max-w-full rounded-ctl border border-line-strong bg-sunken p-0.5">
      {options.map((o) => {
        const active = o.id === value;
        return (
          <button
            key={o.id}
            ref={ref(o.id)}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(o.id)}
            className={cx(
              "inline-flex min-h-12 min-w-12 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-ctl border px-3 text-table transition-[background-color,color,border-color] duration-[var(--dur)] field:min-h-14 field:text-body",
              active ? "border-accent bg-surface font-semibold text-accent" : "border-transparent text-fg-soft hov:text-fg",
            )}
          >
            {o.icon ? <Icon name={o.icon} size={16} /> : null}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Bottom tab bar for the workspace (below 1024px): opens the input / result / map panels. Opaque fixed chrome. */
export function BottomTabs({
  tabs,
  value,
  onChange,
  label,
  idPrefix,
  className,
  ...rest
}: {
  readonly tabs: readonly TabItem[];
  readonly value: string;
  readonly onChange: (id: string) => void;
  readonly label: string;
  readonly idPrefix: string;
  readonly className?: string;
} & DataAttrs) {
  const { onKeyDown, ref } = useRoving(tabs.map((t) => t.id), value, onChange);
  return (
    <div {...rest} role="tablist" aria-label={label} onKeyDown={onKeyDown} className={cx("grid border-t border-line bg-surface pb-[env(safe-area-inset-bottom)]", className)} style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
      {tabs.map((t) => {
        const active = t.id === value;
        return (
          <button
            key={t.id}
            ref={ref(t.id)}
            type="button"
            role="tab"
            id={tabId(idPrefix, t.id)}
            aria-selected={active}
            aria-controls={panelId(idPrefix, t.id)}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(t.id)}
            className={cx("flex min-h-14 flex-col items-center justify-center gap-0.5 border-t-2 px-1 text-aux touch-manipulation", active ? "border-accent" : "border-transparent")}
          >
            <span className={cx("inline-flex h-7 items-center justify-center transition-colors duration-[var(--dur)]", active ? "text-accent" : "text-fg-mute")}>
              {t.icon ? <Icon name={t.icon} size={20} /> : null}
            </span>
            <span className={active ? "font-bold text-fg" : "text-fg-soft"}>{t.label}</span>
          </button>
        );
      })}
    </div>
  );
}
