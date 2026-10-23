"use client";

import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { cx, type DataAttrs } from "./cx";
import { Icon, type IconName } from "./icons";

// Tabs (page-level switching), segmented control (2-4 choices, a display switch) and the bottom tab bar used by the
// workspace below 1024px. Arrow keys move between items (roving tabindex); Home/End jump.

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
              "-mb-px inline-flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 text-body transition-colors duration-[var(--dur-fast)] field:min-h-14",
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

/** iOS-style segmented control. A radio group: one choice selected. */
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
    <div {...rest} role="radiogroup" aria-label={label} onKeyDown={onKeyDown} className="inline-flex max-w-full rounded-ctl bg-sunken p-0.5">
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
              "inline-flex min-h-11 min-w-11 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-[6px] px-3 text-table transition-[background-color,color,box-shadow] duration-[var(--dur-fast)] field:min-h-14 field:text-body",
              active ? "bg-surface font-semibold text-fg shadow-[0_1px_3px_rgb(0_0_0/0.15),0_0_0_0.5px_var(--line)]" : "text-fg-soft hov:text-fg",
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

/** Bottom tab bar for the workspace (below 1024px): opens the input / result / map panels. Translucent fixed chrome. */
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
    <div {...rest} role="tablist" aria-label={label} onKeyDown={onKeyDown} className={cx("glass grid border-t border-line pb-[env(safe-area-inset-bottom)]", className)} style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
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
            className="flex min-h-14 flex-col items-center justify-center gap-0.5 px-1 text-aux touch-manipulation"
          >
            <span className={cx("inline-flex h-7 w-14 items-center justify-center rounded-pill transition-colors duration-[var(--dur-fast)]", active ? "bg-accent-soft text-accent" : "text-fg-mute")}>
              {t.icon ? <Icon name={t.icon} size={20} /> : null}
            </span>
            <span className={active ? "font-bold text-fg" : "text-fg-soft"}>{t.label}</span>
          </button>
        );
      })}
    </div>
  );
}
