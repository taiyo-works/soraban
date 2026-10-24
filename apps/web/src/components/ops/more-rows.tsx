"use client";

// ホームの一覧の「ほか N 件を見る」（その場で開く。新しいルートは作らない）。先頭の数件だけを最初の画面に出し、残りは押すと開く。
// 残りの行はサーバーで描いた要素（<li>）を子として受け取る（hidden で隠すだけなので、閉じていても文書には残る）。ボタンは枠の最後の行になる。
// キーボード：ボタンは Tab で届き、Enter・Space で開閉する。aria-expanded と aria-controls で、開いているかと対象を伝える。
import { useId, useState, type ReactNode } from "react";
import { Icon } from "@/components/ui/icons";

export function MoreRows({ count, children, "data-testid": testId = "more-rows" }: { readonly count: number; readonly children: ReactNode; readonly "data-testid"?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <>
      <ul id={id} hidden={!open} className="flex flex-col divide-y divide-line border-t border-line" data-testid={`${testId}-list`}>
        {children}
      </ul>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        data-testid={`${testId}-toggle`}
        className="flex min-h-11 w-full items-center gap-1.5 border-t border-line text-table text-accent touch-manipulation hov:underline"
      >
        <Icon name={open ? "chevron-up" : "chevron-down"} size={16} />
        {open ? `ほか ${count} 件を閉じる` : `ほか ${count} 件を見る`}
      </button>
    </>
  );
}
