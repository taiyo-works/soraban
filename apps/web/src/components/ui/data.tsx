"use client";

import Link from "next/link";
import { useId, useMemo, useState, type ReactNode } from "react";
import { cx, type DataAttrs } from "./cx";
import { SearchInput, Select } from "./forms";
import { Icon } from "./icons";
import { Button } from "./primitives";

// Data table, filter bar and sparkline (Sprint 12g stage 1a). Everything here works on data already in the page:
// sorting is done in the browser (the lists are fully loaded), filters are controlled by the caller.

export type Density = "standard" | "compact";
export type SortDir = "asc" | "desc";

export type Column<T> = {
  readonly key: string;
  readonly header: string;
  readonly cell: (row: T) => ReactNode;
  /** Present → the column is sortable (aria-sort on the header). */
  readonly sortValue?: (row: T) => string | number;
  readonly align?: "right";
  /** The row's title cell: carries the row link and is shown without a label when stacked. */
  readonly primary?: boolean;
  readonly mono?: boolean;
};

const compare = (a: string | number, b: string | number): number =>
  typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b), "ja", { numeric: true });

/**
 * Data table. Header cells are sort buttons (aria-sort); the row title is a link and the whole row is clickable;
 * below 768px the rows stack as labelled cards (never a horizontal scroll). Density: standard 44px / compact 36px rows.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  rowHref,
  rowTestId,
  caption,
  density = "standard",
  defaultSort,
  selectedKey,
  loading,
  empty,
  rowAction,
  ...rest
}: {
  readonly columns: readonly Column<T>[];
  readonly rows: readonly T[];
  readonly rowKey: (row: T) => string;
  readonly rowHref?: (row: T) => string;
  readonly rowTestId?: (row: T) => string;
  readonly caption: string;
  readonly density?: Density;
  readonly defaultSort?: { readonly key: string; readonly dir: SortDir };
  readonly selectedKey?: string | null;
  readonly loading?: boolean;
  readonly empty?: ReactNode;
  /** Trailing per-row control (preview button, row menu). Stays clickable above the row link. */
  readonly rowAction?: (row: T) => ReactNode;
} & DataAttrs) {
  const [sort, setSort] = useState<{ key: string; dir: SortDir } | null>(defaultSort ?? null);
  const selectId = useId();
  const sorted = useMemo(() => {
    const col = columns.find((c) => c.key === sort?.key);
    if (!col?.sortValue || !sort) return rows;
    const f = col.sortValue;
    const sign = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => sign * compare(f(a), f(b)));
  }, [rows, columns, sort]);
  const sortable = columns.filter((c) => c.sortValue);
  const toggle = (key: string): void =>
    setSort((cur) => (cur?.key === key ? { key, dir: cur.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));

  if (!loading && rows.length === 0 && empty) return <>{empty}</>;

  return (
    <div {...rest} data-density={density} className="flex min-w-0 flex-col gap-2">
      {sortable.length > 0 ? (
        <div className="flex items-center gap-2 md:hidden">
          <label htmlFor={selectId} className="shrink-0 text-aux text-fg-mute">
            並べ替え
          </label>
          <div className="min-w-0 flex-1">
            <Select
              id={selectId}
              value={sort?.key ?? ""}
              onChange={(e) => setSort(e.target.value ? { key: e.target.value, dir: sort?.dir ?? "asc" } : null)}
            >
              <option value="">指定なし</option>
              {sortable.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.header}
                </option>
              ))}
            </Select>
          </div>
          <Button
            variant="secondary"
            size="icon"
            aria-label={sort?.dir === "desc" ? "降順（押すと昇順）" : "昇順（押すと降順）"}
            disabled={!sort}
            onClick={() => sort && toggle(sort.key)}
          >
            <Icon name={sort?.dir === "desc" ? "chevron-down" : "chevron-up"} size={18} />
          </Button>
        </div>
      ) : null}
      <div className="min-w-0 rounded-card md:overflow-hidden md:bg-surface md:shadow-card">
        <table className="ds-table w-full border-collapse text-left text-table">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="bg-sunken text-aux text-fg-mute">
              {columns.map((c) => {
                const active = sort?.key === c.key;
                const ariaSort = !c.sortValue ? undefined : active ? (sort!.dir === "asc" ? "ascending" : "descending") : "none";
                return (
                  <th key={c.key} scope="col" aria-sort={ariaSort} className={cx("px-4 font-medium", c.align === "right" && "text-right")}>
                    {c.sortValue ? (
                      <button
                        type="button"
                        onClick={() => toggle(c.key)}
                        className={cx("-mx-2 inline-flex min-h-11 items-center gap-1 rounded-ctl px-2 hov:text-fg compact:min-h-9", active && "text-fg")}
                      >
                        {c.header}
                        <Icon name={active ? (sort!.dir === "asc" ? "chevron-up" : "chevron-down") : "sort"} size={14} />
                      </button>
                    ) : (
                      <span className="inline-flex min-h-11 items-center compact:min-h-9">{c.header}</span>
                    )}
                  </th>
                );
              })}
              {rowAction ? <th scope="col" className="w-12 px-2"><span className="sr-only">操作</span></th> : null}
            </tr>
          </thead>
          <tbody className="max-md:flex max-md:flex-col max-md:gap-2">
            {loading
              ? Array.from({ length: 4 }, (_, i) => (
                  <tr key={i} aria-hidden="true" className="max-md:rounded-card max-md:bg-surface max-md:p-3 max-md:shadow-card md:border-t md:border-line">
                    {columns.map((c) => (
                      <td key={c.key} className="px-4 py-3">
                        <span className="ds-skeleton block h-4 w-3/4 rounded-ctl bg-sunken" />
                      </td>
                    ))}
                    {rowAction ? <td /> : null}
                  </tr>
                ))
              : sorted.map((row) => {
                  const key = rowKey(row);
                  const href = rowHref?.(row);
                  const selected = selectedKey === key;
                  return (
                    <tr
                      key={key}
                      data-testid={rowTestId?.(row)}
                      aria-selected={selectedKey !== undefined ? selected : undefined}
                      className={cx(
                        "transition-colors duration-[var(--dur-fast)] max-md:rounded-card max-md:bg-surface max-md:p-3 max-md:shadow-card md:border-t md:border-line",
                        href && "hov:bg-accent-soft md:cursor-pointer",
                        selected && "bg-accent-soft",
                      )}
                    >
                      {columns.map((c) => (
                        <td
                          key={c.key}
                          data-label={c.header}
                          data-primary={c.primary ? "" : undefined}
                          className={cx(
                            "px-4 md:h-11 md:py-1.5 compact:md:h-9 compact:md:py-1 max-md:px-0 max-md:py-1",
                            c.align === "right" && "md:text-right",
                            c.mono && "font-mono tabular-nums",
                            c.primary && "font-medium text-fg",
                          )}
                        >
                          {c.primary && href ? (
                            <Link href={href} prefetch={false} className="ds-table-link inline-flex min-h-11 items-center rounded-ctl hov:underline md:min-h-0">
                              {c.cell(row)}
                            </Link>
                          ) : (
                            c.cell(row)
                          )}
                        </td>
                      ))}
                      {rowAction ? <td className="relative z-10 w-12 px-2 md:py-0 max-md:absolute max-md:right-2 max-md:top-2 max-md:w-auto max-md:p-0">{rowAction(row)}</td> : null}
                    </tr>
                  );
                })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Filter bar ───────────────────────────────────────────────────────────────

/** A removable filter chip: "label: value" and an x button that removes it. */
export function Chip({ label, value, onRemove }: { readonly label: string; readonly value: string; readonly onRemove: () => void }) {
  return (
    <span className="inline-flex min-h-8 items-center gap-1 rounded-pill bg-accent-soft pl-3 text-table text-accent">
      <span className="text-fg-mute">{label}</span>
      <span className="font-medium">{value}</span>
      <button
        type="button"
        aria-label={`${label}「${value}」の絞り込みを外す`}
        onClick={onRemove}
        className="inline-flex min-h-11 min-w-9 items-center justify-center rounded-pill hov:bg-accent/10"
      >
        <Icon name="x" size={14} />
      </button>
    </span>
  );
}

/**
 * Filter bar: search, filter controls (slot), applied chips, a result count and "clear all".
 * The caller owns the filter state; this component only lays it out.
 */
export function FilterBar({
  search,
  onSearch,
  searchLabel,
  chips,
  count,
  onClear,
  children,
  ...rest
}: {
  readonly search?: string;
  readonly onSearch?: (v: string) => void;
  readonly searchLabel?: string;
  readonly chips: readonly { readonly id: string; readonly label: string; readonly value: string; readonly onRemove: () => void }[];
  readonly count: number;
  readonly onClear: () => void;
  readonly children?: ReactNode;
} & DataAttrs) {
  return (
    <div {...rest} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {onSearch ? (
          <div className="min-w-[12rem] flex-1 sm:max-w-sm">
            <SearchInput value={search ?? ""} onChange={(e) => onSearch(e.target.value)} aria-label={searchLabel ?? "絞り込み"} placeholder={searchLabel ?? "絞り込み"} />
          </div>
        ) : null}
        {children}
      </div>
      <div className="flex min-h-11 flex-wrap items-center gap-2" aria-live="polite">
        {chips.map((c) => (
          <Chip key={c.id} label={c.label} value={c.value} onRemove={c.onRemove} />
        ))}
        <span className="text-table tabular-nums text-fg-soft" data-testid="filter-count">
          {count} 件
        </span>
        {chips.length > 0 ? (
          <Button variant="quiet" size="sm" onClick={onClear}>
            すべて解除
          </Button>
        ) : null}
      </div>
    </div>
  );
}

// ── Sparkline ────────────────────────────────────────────────────────────────

/**
 * Tiny trend line for values that are already on the page. The numbers are always given in text too (`summary`),
 * because a line alone is not readable by everyone. Flat area fill only (no gradient).
 */
export function Sparkline({ values, summary, width = 96, height = 28 }: { readonly values: readonly number[]; readonly summary: string; readonly width?: number; readonly height?: number }) {
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? width / (values.length - 1) : width;
  const pts = values.map((v, i) => [i * step, height - 2 - (v / max) * (height - 4)] as const);
  const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join("");
  return (
    <svg role="img" aria-label={summary} viewBox={`0 0 ${width} ${height}`} width={width} height={height} className="shrink-0 text-accent">
      <path d={`${d}L${width} ${height}L0 ${height}Z`} fill="currentColor" opacity={0.12} />
      <path d={d} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
