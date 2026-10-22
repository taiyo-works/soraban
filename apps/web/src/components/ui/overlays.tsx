"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { cx, type DataAttrs } from "./cx";
import { useDismiss } from "./hooks";
import { Icon, type IconName } from "./icons";
import { Button } from "./primitives";

// Overlays (Sprint 12g stage 1a): dialog / bottom sheet / drawer on the native <dialog>, the (i) popover, toasts, and a
// context menu. <dialog>.showModal() gives focus containment, Escape and an inert background; focus is returned to the
// opener on close. Motion is 200-240ms and is switched off by prefers-reduced-motion (globals.css).

// ── Dialog / sheet / drawer ──────────────────────────────────────────────────

type DialogKind = "dialog" | "drawer" | "sheet";

const PANEL: Readonly<Record<DialogKind, string>> = {
  // centred from 768px, a bottom sheet below
  dialog:
    "fixed inset-x-0 bottom-0 m-0 max-h-[92dvh] w-full rounded-t-sheet md:static md:mx-auto md:my-[8vh] md:max-h-[84dvh] md:w-[min(32rem,calc(100vw-3rem))] md:rounded-sheet",
  // right side from 768px (360-420px), a bottom sheet below
  drawer:
    "fixed inset-x-0 bottom-0 m-0 max-h-[92dvh] w-full rounded-t-sheet md:inset-y-0 md:left-auto md:right-0 md:max-h-none md:w-[min(26rem,100vw)] md:rounded-l-sheet md:rounded-tr-none",
  // always a bottom sheet
  sheet: "fixed inset-x-0 bottom-0 m-0 max-h-[92dvh] w-full rounded-t-sheet md:mx-auto md:max-w-[40rem]",
};

export function Dialog({
  open,
  onClose,
  title,
  kind = "dialog",
  footer,
  children,
  "data-testid": testId,
  initialFocus,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title: string;
  readonly kind?: DialogKind;
  readonly footer?: ReactNode;
  readonly children: ReactNode;
  readonly "data-testid"?: string;
  /** CSS selector inside the dialog to focus on open (default: the first focusable element). */
  readonly initialFocus?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const drag = useRef<{ y: number } | null>(null);
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      el.showModal();
      if (initialFocus) el.querySelector<HTMLElement>(initialFocus)?.focus();
    } else if (!open && el.open) {
      el.close();
    }
  }, [open, initialFocus]);

  // The native close event (Escape, form[method=dialog]) is the single source of "closed": mirror it into state and
  // put focus back where it was.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onNativeClose = (): void => {
      setOffset(0);
      onClose();
      const back = opener.current;
      if (back && back.isConnected) back.focus({ preventScroll: true });
    };
    el.addEventListener("close", onNativeClose);
    return () => el.removeEventListener("close", onNativeClose);
  }, [onClose]);

  // Keep Tab inside the dialog: the native modal makes the page inert, but Tab at the last control would otherwise leave
  // for the browser UI. Wrap from the last control to the first (and back with Shift+Tab).
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDialogElement>): void => {
    if (e.key !== "Tab") return;
    const focusable = [...e.currentTarget.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])')].filter(
      (el) => el.offsetParent !== null || el === document.activeElement,
    );
    if (focusable.length === 0) return;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === e.currentTarget)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const onHandleDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    drag.current = { y: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onHandleMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (drag.current) setOffset(Math.max(0, e.clientY - drag.current.y));
  };
  const onHandleUp = (): void => {
    if (!drag.current) return;
    drag.current = null;
    if (offset > 96) onClose();
    else setOffset(0);
  };

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      data-testid={testId}
      className="ds-dialog"
      onKeyDown={onKeyDown}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div
        className={cx("ds-dialog-panel flex flex-col overflow-hidden bg-surface text-fg shadow-float", PANEL[kind])}
        style={offset ? { transform: `translateY(${offset}px)`, transition: "none" } : undefined}
      >
        <div
          className="flex shrink-0 cursor-grab touch-none justify-center pb-1 pt-2 md:hidden"
          onPointerDown={onHandleDown}
          onPointerMove={onHandleMove}
          onPointerUp={onHandleUp}
          onPointerCancel={onHandleUp}
          aria-hidden="true"
        >
          <span className="h-1 w-9 rounded-pill bg-line-strong" />
        </div>
        <div className="flex shrink-0 items-center justify-between gap-3 px-5 pb-2 pt-2 md:pt-4">
          <h2 id={titleId} className="min-w-0 text-h2 font-semibold">
            {title}
          </h2>
          <button
            type="button"
            aria-label="閉じる"
            onClick={onClose}
            className="-mr-2 inline-flex min-h-11 min-w-11 items-center justify-center rounded-ctl text-fg-soft hov:bg-sunken field:min-h-14 field:min-w-14"
          >
            <Icon name="x" size={20} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4 text-body">{children}</div>
        {footer ? (
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">{footer}</div>
        ) : null}
      </div>
    </dialog>
  );
}

// ── (i) popover ──────────────────────────────────────────────────────────────

/**
 * Small explanation behind an (i) button. Opens on tap/click and Enter/Space, and previews on hover and focus.
 * 44px tap area; Escape and an outside press close it. Never hold a fixed notice in here (those stay visible).
 */
export function InfoPopover({ label, children, "data-testid": testId }: { readonly label: string; readonly children: ReactNode; readonly "data-testid"?: string }) {
  const [pinned, setPinned] = useState(false);
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const [shift, setShift] = useState(0);
  const [above, setAbove] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  const panel = useRef<HTMLSpanElement>(null);
  const id = useId();
  const open = pinned || hover || focus;
  const close = useCallback(() => {
    setPinned(false);
    setHover(false);
    setFocus(false);
  }, []);
  useDismiss(root, open, close);

  // Keep the panel inside the viewport (a 16px gutter on each side). Measured from layout (offsetLeft / offsetWidth), which
  // ignores transforms, so neither the entrance animation nor the shift itself changes what is measured.
  useLayoutEffect(() => {
    if (!open || !panel.current || !root.current) return;
    const left = root.current.getBoundingClientRect().left + panel.current.offsetLeft;
    const right = left + panel.current.offsetWidth;
    const w = document.documentElement.clientWidth;
    let dx = 0;
    if (left < 16) dx = 16 - left;
    else if (right > w - 16) dx = w - 16 - right;
    setShift(dx);
    // Vertical: open upward when the panel would run off the bottom and there is room above the button.
    const r = root.current.getBoundingClientRect();
    const h = panel.current.offsetHeight;
    setAbove(r.bottom + h > window.innerHeight - 8 && r.top - h >= 8);
  }, [open]);

  return (
    <span ref={root} className="relative inline-flex" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <button
        type="button"
        data-testid={testId}
        aria-label={`説明：${label}`}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setPinned((p) => !p)}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-pill text-fg-mute hov:text-accent"
      >
        <Icon name="info" size={18} />
      </button>
      <span
        ref={panel}
        id={id}
        role="note"
        hidden={!open}
        style={{ translate: `${shift}px 0` }}
        className={cx(
          "ds-pop absolute left-1/2 z-30 -ml-[9rem] mt-0 w-[18rem] max-w-[calc(100vw-2rem)] rounded-card bg-surface p-3 text-table leading-relaxed text-fg-soft shadow-float",
          above ? "bottom-full" : "top-full",
        )}
      >
        {children}
      </span>
    </span>
  );
}

// ── Toast ────────────────────────────────────────────────────────────────────

type ToastItem = { readonly id: number; readonly message: string; readonly meaning: "ok" | "info" | "warn" };
type ToastApi = { readonly show: (message: string, meaning?: ToastItem["meaning"]) => void };

const ToastContext = createContext<ToastApi | null>(null);

/**
 * Auxiliary notices (saved, copied). They are added next to the on-screen result, never instead of it:
 * anything that matters for safety stays in the page itself. polite live region; 4s; Escape-free (not modal).
 */
export function ToastProvider({ children }: { readonly children: ReactNode }) {
  const [items, setItems] = useState<readonly ToastItem[]>([]);
  const seq = useRef(0);
  const show = useCallback((message: string, meaning: ToastItem["meaning"] = "ok") => {
    const id = ++seq.current;
    setItems((cur) => [...cur.slice(-2), { id, message, meaning }]);
    window.setTimeout(() => setItems((cur) => cur.filter((t) => t.id !== id)), 4000);
  }, []);
  const api = useMemo<ToastApi>(() => ({ show }), [show]);
  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        role="status"
        aria-live="polite"
        data-testid="toast-region"
        className="pointer-events-none fixed inset-x-0 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-50 flex flex-col items-center gap-2 px-4"
      >
        {items.map((t) => (
          <div key={t.id} data-testid="toast" className="ds-pop pointer-events-auto flex min-h-11 max-w-[28rem] items-center gap-2 rounded-card bg-fg px-4 py-2 text-table shadow-float" style={{ color: "var(--bg-surface)" }}>
            <Icon name={t.meaning === "ok" ? "check-circle" : t.meaning === "warn" ? "alert" : "info"} size={18} />
            <span>{t.message}</span>
            <button
              type="button"
              aria-label="通知を閉じる"
              onClick={() => setItems((cur) => cur.filter((x) => x.id !== t.id))}
              className="-mr-2 inline-flex min-h-11 min-w-11 items-center justify-center rounded-ctl hov:bg-white/10"
            >
              <Icon name="x" size={16} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error("useToast must be used inside <ToastProvider>");
  return api;
}

// ── Context menu / row menu ──────────────────────────────────────────────────

export type MenuItem = {
  readonly id: string;
  readonly label: string;
  readonly icon?: IconName;
  readonly onSelect: () => void;
};

/**
 * Row menu. Opens from the "…" button, a right click, a long press (touch) or Shift+F10 / the Menu key on the wrapper.
 * role="menu"; Arrow keys move, Home/End jump, Escape or an outside press closes and returns focus.
 */
export function ContextMenu({
  items,
  label,
  children,
  "data-testid": testId,
}: {
  readonly items: readonly MenuItem[];
  readonly label: string;
  readonly children: ReactNode;
  readonly "data-testid"?: string;
}) {
  // `y` is where the menu's top edge would go; `above` (the trigger's top edge, when opened from the button) is where its
  // bottom edge goes instead if the menu does not fit below.
  const [at, setAt] = useState<{ x: number; y: number; above?: number } | null>(null);
  const [top, setTop] = useState<number | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const press = useRef<number | null>(null);
  const open = at !== null;
  const close = useCallback((restore = true) => {
    setAt(null);
    if (restore) button.current?.focus({ preventScroll: true });
  }, []);
  useDismiss(menu, open, () => close(false), button);

  useEffect(() => {
    if (open) menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [open]);

  // Keep the whole menu inside the viewport (an 8px gutter): measure its height, flip above the trigger when it does not
  // fit below, otherwise slide it up. A menu taller than the viewport scrolls (max-h on the element). Runs before paint.
  useLayoutEffect(() => {
    if (!at || !menu.current) {
      setTop(null);
      return;
    }
    const h = menu.current.offsetHeight;
    const vh = window.innerHeight;
    let y = at.y;
    if (y + h > vh - 8) y = at.above !== undefined && at.above - h >= 8 ? at.above - h : vh - 8 - h;
    setTop(Math.max(8, y));
  }, [at]);

  const onMenuKey = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    const els = [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const i = els.indexOf(document.activeElement as HTMLElement);
    const go = (n: number): void => {
      e.preventDefault();
      els[(n + els.length) % els.length]?.focus();
    };
    if (e.key === "ArrowDown") go(i + 1);
    else if (e.key === "ArrowUp") go(i - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(els.length - 1);
    else if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "Tab") close();
  };

  return (
    <div
      ref={root}
      data-testid={testId}
      className="relative flex items-center gap-1"
      onContextMenu={(e) => {
        e.preventDefault();
        setAt({ x: e.clientX, y: e.clientY });
      }}
      onKeyDown={(e) => {
        if ((e.shiftKey && e.key === "F10") || e.key === "ContextMenu") {
          e.preventDefault();
          const r = button.current?.getBoundingClientRect();
          setAt({ x: r ? r.left : 16, y: r ? r.bottom : 16, above: r?.top });
        }
      }}
      onTouchStart={(e) => {
        const t = e.touches[0];
        if (!t) return;
        press.current = window.setTimeout(() => setAt({ x: t.clientX, y: t.clientY }), 550);
      }}
      onTouchEnd={() => press.current && window.clearTimeout(press.current)}
      onTouchMove={() => press.current && window.clearTimeout(press.current)}
    >
      <div className="min-w-0 flex-1">{children}</div>
      <button
        ref={button}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setAt(open ? null : { x: r.right, y: r.bottom, above: r.top });
        }}
        className="relative z-10 inline-flex min-h-11 min-w-11 items-center justify-center rounded-ctl text-fg-soft hov:bg-sunken"
      >
        <Icon name="more" size={20} />
      </button>
      {at ? (
        <div
          ref={menu}
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKey}
          style={{ left: Math.min(at.x, (typeof window === "undefined" ? 0 : window.innerWidth) - 224), top: top ?? at.y }}
          className="glass ds-pop fixed z-50 flex max-h-[calc(100dvh-1rem)] w-56 flex-col overflow-y-auto rounded-card p-1 shadow-float"
        >
          {items.map((it) => (
            <button
              key={it.id}
              type="button"
              role="menuitem"
              onClick={() => {
                close();
                it.onSelect();
              }}
              className="flex min-h-11 items-center gap-2 rounded-ctl px-3 text-left text-body text-fg hov:bg-accent-soft focus-visible:bg-accent-soft"
            >
              {it.icon ? <Icon name={it.icon} size={18} className="text-fg-mute" /> : null}
              {it.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Confirmation with a reason: the shape used for "cancel / correct / withdraw" later (the reason is required). */
export function ReasonDialog({
  open,
  onClose,
  title,
  confirmLabel,
  onConfirm,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title: string;
  readonly confirmLabel: string;
  readonly onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const id = useId();
  const ok = reason.trim().length > 0;
  return (
    <Dialog
      open={open}
      onClose={() => {
        setReason("");
        onClose();
      }}
      title={title}
      kind="dialog"
      initialFocus="textarea"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            やめる
          </Button>
          <Button
            variant="danger"
            disabled={!ok}
            onClick={() => {
              onConfirm(reason.trim());
              setReason("");
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <label htmlFor={id} className="mb-1.5 flex items-center gap-2 text-table font-medium">
        理由
        <span className="rounded-pill bg-sunken px-1.5 text-aux text-fg-soft">必須</span>
      </label>
      <textarea
        id={id}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        className="min-h-24 w-full rounded-ctl border border-line-strong bg-surface px-3 py-2.5 text-[16px] leading-relaxed text-fg placeholder:text-fg-mute"
        placeholder="記録に残す理由を入力します"
      />
    </Dialog>
  );
}

export type { DataAttrs };
