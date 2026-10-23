"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";

/** True while the viewport matches the media query. Server and first client render report `false`. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (cb: () => void) => {
      const m = window.matchMedia(query);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Keys typed into these must never trigger a global shortcut. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") {
    const t = (target as HTMLInputElement).type;
    return !["checkbox", "radio", "button", "submit", "reset", "range", "color", "file", "image"].includes(t);
  }
  return false;
}

/** A modal dialog (or the field-mode screen) is open: single-key shortcuts must stay quiet. */
export function isInsideModal(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && target.closest("dialog[open]") !== null;
}

/**
 * Global key handler. `ignoreEditable` skips events from inputs, `ignoreModal` skips events inside an open dialog.
 * Returns nothing; the listener is removed on unmount.
 */
export function useKeydown(
  handler: (e: KeyboardEvent) => void,
  { enabled = true, ignoreEditable = true, ignoreModal = false }: { readonly enabled?: boolean; readonly ignoreEditable?: boolean; readonly ignoreModal?: boolean } = {},
): void {
  useEffect(() => {
    if (!enabled) return;
    const on = (e: KeyboardEvent): void => {
      if (e.defaultPrevented || e.isComposing) return;
      if (ignoreEditable && isEditableTarget(e.target)) return;
      if (ignoreModal && isInsideModal(e.target)) return;
      handler(e);
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [handler, enabled, ignoreEditable, ignoreModal]);
}

/**
 * Calls `onDismiss` for a pointer press outside `ref`'s element, and on Escape. A press inside `also` (the opener) is not
 * outside: the opener's own click toggles, so closing here first would let that click reopen it.
 */
export function useDismiss(
  ref: { readonly current: HTMLElement | null },
  open: boolean,
  onDismiss: () => void,
  also?: { readonly current: HTMLElement | null },
): void {
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent): void => {
      if (!ref.current || !(e.target instanceof Node)) return;
      if (!ref.current.contains(e.target) && !also?.current?.contains(e.target)) onDismiss();
    };
    const key = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onDismiss();
    };
    document.addEventListener("pointerdown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", down);
      document.removeEventListener("keydown", key);
    };
  }, [ref, also, open, onDismiss]);
}
