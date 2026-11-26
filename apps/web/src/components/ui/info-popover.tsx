"use client";

import { useCallback, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cx } from "./cx";
import { useDismiss } from "./hooks";
import { Icon } from "./icons";

/**
 * 「ⓘ」の小さな説明（利用者メニューの役割の説明が使う）。押す・Enter・Space で開き、ホバーとフォーカスでは仮に見せる。
 * 押す部品は 48px。Escape と外側の押下で閉じる。固定で見せたい注意はここに入れない。
 * 16-N2：旧い `ui/overlays.tsx` の InfoPopover を、色・角丸を --sb-* の名前（bg-sb-*・text-sb-*・rounded-sb-m）にして移した。動き・位置の計算は同じ。
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

  // 画面の中に収める（左右 16px の余白）。レイアウトの値（offsetLeft・offsetWidth）で測るので、出現の動きや自分のずれに影響されない。
  useLayoutEffect(() => {
    if (!open || !panel.current || !root.current) return;
    const left = root.current.getBoundingClientRect().left + panel.current.offsetLeft;
    const right = left + panel.current.offsetWidth;
    const w = document.documentElement.clientWidth;
    let dx = 0;
    if (left < 16) dx = 16 - left;
    else if (right > w - 16) dx = w - 16 - right;
    setShift(dx);
    // 縦：下にはみ出すとき、上に余白があれば上へ開く
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
        // ホバー・フォーカスは仮に見せるだけ。押す（Enter・Space）と固定する。次の押下では、仮の見せ方の元（ホバー・フォーカス）も消して本当に閉じる
        onClick={() => (pinned ? close() : setPinned(true))}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        className="inline-flex min-h-12 min-w-12 items-center justify-center rounded-sb-m text-sb-ink-3 hover:text-sb-ink"
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
          "ds-pop absolute left-1/2 z-30 -ml-[9rem] mt-0 w-[18rem] max-w-[calc(100vw-2rem)] rounded-sb-m border border-sb-edge bg-sb-base p-3 text-table text-sb-ink-2",
          above ? "bottom-full" : "top-full",
        )}
      >
        {children}
      </span>
    </span>
  );
}
