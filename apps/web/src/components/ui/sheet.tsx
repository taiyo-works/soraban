"use client";

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";

// ボトムシート（Sprint 16-D D-3。見た目は soraban-ui.css の .sb-sheet*）。
// 高さは 3 段（ピーク 120px・中間 50%・全面 90%）。暗幕は中間以上だけ。中間と全面は、フォーカスをシートの中に閉じ込める（aria-modal）。ピークは地の画面を操作できる（閉じ込めない）。
// 開くと見出しにフォーカスし、Esc と「閉じる」で閉じ、開いた元の部品にフォーカスを戻す。キーボードで「広げる」「縮める」ボタンから段を変える。
// 端末のストレージは使わない。段の状態は画面の中だけに持つ。

export type SheetStage = "peek" | "half" | "full";
const ORDER: readonly SheetStage[] = ["peek", "half", "full"];

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

const focusables = (root: HTMLElement): HTMLElement[] =>
  Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => !el.closest("[hidden]") && el.getClientRects().length > 0);

export function Sheet({
  open,
  onClose,
  title,
  children,
  defaultStage = "half",
  testId = "sheet",
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title: string;
  readonly children: ReactNode;
  readonly defaultStage?: SheetStage;
  readonly testId?: string;
}) {
  // 開いているときだけ中身を持つ（閉じると段の状態も捨てる。次に開いたときは defaultStage から始まる）
  return open ? (
    <SheetOpen onClose={onClose} title={title} defaultStage={defaultStage} testId={testId}>
      {children}
    </SheetOpen>
  ) : null;
}

function SheetOpen({
  onClose,
  title,
  children,
  defaultStage,
  testId,
}: {
  readonly onClose: () => void;
  readonly title: string;
  readonly children: ReactNode;
  readonly defaultStage: SheetStage;
  readonly testId: string;
}) {
  const [stage, setStage] = useState<SheetStage>(defaultStage);
  const rootRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const modal = stage !== "peek";
  const idx = ORDER.indexOf(stage);
  const canExpand = idx < ORDER.length - 1;
  const canShrink = idx > 0;

  // 開いた元の部品を覚え、見出しにフォーカスする。閉じる（この部品が外れる）とき、元にフォーカスを戻す。
  useEffect(() => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    titleRef.current?.focus();
    const back = opener.current;
    return () => {
      if (back && back.isConnected) back.focus();
    };
  }, []);

  // Esc で閉じる（フォーカスがシートの中にあっても外にあっても）。
  const close = useCallback(() => onClose(), [onClose]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // 変換中（IME の確定前）の Esc は変換の取り消しなので、シートを閉じない
      if (e.key === "Escape" && !e.isComposing && e.keyCode !== 229) {
        e.stopPropagation();
        close();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [close]);

  // 中間・全面：フォーカスがシートの外へ出たら、見出しへ戻す（Tab の循環は下の onKeyDown が受け持つ）
  useEffect(() => {
    if (!modal) return;
    const onFocusIn = (e: FocusEvent): void => {
      const sheet = sheetRef.current;
      if (sheet && e.target instanceof Node && !sheet.contains(e.target)) titleRef.current?.focus();
    };
    document.addEventListener("focusin", onFocusIn);
    return () => document.removeEventListener("focusin", onFocusIn);
  }, [modal]);

  // 段を変えたとき、押したボタンが無くなって（端の段）フォーカスが失われたら、残っている段のボタンへ移す
  const lostFocus = useRef(false);
  useEffect(() => {
    if (!lostFocus.current) return;
    lostFocus.current = false;
    const sheet = sheetRef.current;
    if (!sheet || sheet.contains(document.activeElement)) return;
    const next = sheet.querySelector<HTMLElement>(canExpand ? '[data-sheet-action="expand"]' : '[data-sheet-action="shrink"]');
    (next ?? titleRef.current)?.focus();
  }, [stage, canExpand]);

  const change = (next: SheetStage): void => {
    lostFocus.current = true;
    setStage(next);
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (!modal || e.key !== "Tab") return;
    const sheet = sheetRef.current;
    if (!sheet) return;
    const items = focusables(sheet);
    if (items.length === 0) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    const active = document.activeElement;
    // 見出し（tabindex=-1）から出る Tab と、端での循環
    if (e.shiftKey && (active === first || active === titleRef.current || !sheet.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !sheet.contains(active))) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="sb-sheet-root" ref={rootRef} data-testid={`${testId}-root`}>
      {modal ? <div className="sb-sheet-scrim" aria-hidden="true" onClick={close} data-testid={`${testId}-scrim`} /> : null}
      <div
        ref={sheetRef}
        className="sb-sheet"
        role="dialog"
        aria-modal={modal ? "true" : "false"}
        aria-labelledby={titleId}
        data-stage={stage}
        data-testid={testId}
        onKeyDown={onKeyDown}
      >
        <span className="sb-sheet-handle" aria-hidden="true" />
        <div className="sb-sheet-head">
          <h2 id={titleId} ref={titleRef} tabIndex={-1} className="sb-sheet-title" data-testid={`${testId}-title`}>
            {title}
          </h2>
          <div className="sb-sheet-actions">
            {/* 端の段では、押せない側のボタンを出さない（押せないボタンを置かない）。段は data-stage と、見出しの脇の語で分かる */}
            {canExpand ? (
              <button type="button" className="sb-pill sb-pill-text" data-sheet-action="expand" data-testid={`${testId}-expand`} onClick={() => change(ORDER[idx + 1]!)}>
                <span className="sb-pill-label">広げる</span>
              </button>
            ) : null}
            {canShrink ? (
              <button type="button" className="sb-pill sb-pill-text" data-sheet-action="shrink" data-testid={`${testId}-shrink`} onClick={() => change(ORDER[idx - 1]!)}>
                <span className="sb-pill-label">縮める</span>
              </button>
            ) : null}
            <button type="button" className="sb-pill sb-pill-secondary" data-testid={`${testId}-close`} onClick={close}>
              <span className="sb-pill-label">閉じる</span>
            </button>
          </div>
        </div>
        <div className="sb-sheet-body" data-testid={`${testId}-body`} tabIndex={-1}>
          {children}
        </div>
      </div>
    </div>
  );
}
