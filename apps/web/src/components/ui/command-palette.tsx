"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { cx } from "./cx";
import { useKeydown } from "./hooks";
import { Icon, type IconName } from "./icons";
import { Kbd } from "./primitives";
import { Dialog } from "./overlays";

// Command palette and shortcut list (components only; wired into the app shell in stage 1b).
// Opens with Ctrl+K / Cmd+K; never from inside a text field or when `enabled` is false (field mode).
// It filters the commands it is given; it does not search records (no new API).

export type Command = {
  readonly id: string;
  readonly label: string;
  readonly group: string;
  readonly icon?: IconName;
  /** Shortcut keys shown on the right, e.g. ["G", "T"]. */
  readonly keys?: readonly string[];
  readonly keywords?: string;
  readonly onSelect: () => void;
};

/** Ctrl+K / Cmd+K toggles the palette. Ignored in text fields and when disabled. */
export function usePaletteHotkey(toggle: () => void, enabled = true): void {
  const handler = useCallback(
    (e: KeyboardEvent | globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        toggle();
      }
    },
    [toggle],
  );
  useKeydown(handler, { enabled, ignoreEditable: true });
}

export function CommandPalette({
  open,
  onClose,
  commands,
  "data-testid": testId = "command-palette",
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly commands: readonly Command[];
  readonly "data-testid"?: string;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) => `${c.label} ${c.group} ${c.keywords ?? ""}`.toLowerCase().includes(q));
  }, [commands, query]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  // Closing (Escape, backdrop, a command) clears the query for the next time.
  const close = (): void => {
    setQuery("");
    setActive(0);
    onClose();
  };
  const run = (c: Command | undefined): void => {
    if (!c) return;
    close();
    c.onSelect();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (results.length ? (i + 1) % results.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (results.length ? (i - 1 + results.length) % results.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      run(results[active]);
    }
  };

  // Group headings: show one above the first command of each group.
  const headingAt = new Set(results.flatMap((c, i) => (i === 0 || results[i - 1]!.group !== c.group ? [i] : [])));
  return (
    <Dialog open={open} onClose={close} title="コマンド" kind="dialog" data-testid={testId} initialFocus="input">
      <div className="-mx-1 flex flex-col gap-2">
        <div className="relative">
          <Icon name="search" size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-mute" />
          <input
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={results[active] ? `${listId}-${results[active]!.id}` : undefined}
            aria-label="画面や操作を検索"
            placeholder="画面や操作を検索"
            autoComplete="off"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            className="min-h-11 w-full rounded-ctl border border-line-strong bg-surface pl-10 pr-3 text-[1rem] text-fg placeholder:text-fg-mute"
          />
        </div>
        <ul id={listId} ref={listRef} role="listbox" aria-label="候補" className="max-h-[50dvh] overflow-y-auto">
          {results.length === 0 ? (
            <li role="presentation" className="px-3 py-6 text-center text-table text-fg-mute">
              見つかりません
            </li>
          ) : null}
          {results.map((c, i) => {
            const header = headingAt.has(i) ? c.group : null;
            return (
              <li key={c.id} role="presentation">
                {header ? <p className="px-3 pb-1 pt-3 text-aux font-medium text-fg-mute">{header}</p> : null}
                <div
                  id={`${listId}-${c.id}`}
                  role="option"
                  aria-selected={i === active}
                  data-index={i}
                  onMouseMove={() => setActive(i)}
                  onClick={() => run(c)}
                  className={cx("flex min-h-11 cursor-pointer items-center gap-3 rounded-ctl px-3 text-body", i === active ? "bg-accent-soft text-fg" : "text-fg-soft")}
                >
                  {c.icon ? <Icon name={c.icon} size={18} className={i === active ? "text-accent" : "text-fg-mute"} /> : <span className="w-[18px]" />}
                  <span className="min-w-0 flex-1 truncate">{c.label}</span>
                  {c.keys ? (
                    <span className="flex gap-1">
                      {c.keys.map((k) => (
                        <Kbd key={k}>{k}</Kbd>
                      ))}
                    </span>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-aux text-fg-mute">
          <span className="inline-flex items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd>選ぶ</span>
          <span className="inline-flex items-center gap-1"><Kbd>Enter</Kbd>実行</span>
          <span className="inline-flex items-center gap-1"><Kbd>Esc</Kbd>閉じる</span>
        </p>
      </div>
    </Dialog>
  );
}

/** `sequence`: keys are pressed one after another (G then T); otherwise together (Ctrl + K). */
export type ShortcutGroup = {
  readonly title: string;
  readonly items: readonly { readonly keys: readonly string[]; readonly label: string; readonly sequence?: boolean }[];
};

/** The "?" sheet: every shortcut that actually exists, grouped. */
export function ShortcutSheet({ open, onClose, groups, "data-testid": testId = "shortcut-sheet" }: { readonly open: boolean; readonly onClose: () => void; readonly groups: readonly ShortcutGroup[]; readonly "data-testid"?: string }) {
  return (
    <Dialog open={open} onClose={onClose} title="キーボードショートカット" kind="sheet" data-testid={testId}>
      <div className="flex flex-col gap-5">
        {groups.map((g) => (
          <section key={g.title} className="flex flex-col gap-1">
            <h3 className="text-aux font-medium text-fg-mute">{g.title}</h3>
            <dl className="flex flex-col divide-y divide-line">
              {g.items.map((it) => (
                <div key={it.label} className="flex min-h-11 items-center justify-between gap-4 py-1.5">
                  <dt className="min-w-0 text-body text-fg">{it.label}</dt>
                  <dd className="flex shrink-0 items-center gap-1">
                    {it.keys.map((k, i) => (
                      <span key={`${k}-${i}`} className="flex items-center gap-1">
                        {i > 0 ? <span className="text-aux text-fg-mute">{it.sequence ? "→" : "+"}</span> : null}
                        <Kbd>{k}</Kbd>
                      </span>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Dialog>
  );
}
