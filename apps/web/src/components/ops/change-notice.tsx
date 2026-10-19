"use client";

// 登録・訂正・取消・利用者の変更の後は画面を読み直す（ops-client.tsx の reloadAfterChange）。
// 読み直した後に結果を一度だけ示すため、読み直す直前に「一度きりの印」を sessionStorage に置き、
// 読み直した画面の ChangeNotice が受け取って role="status" で示し、対象（版の一覧の新しい行など）へスクロールしてフォーカスを移す。
// 印には表示する文言（版番号などで、個人情報を含めない）と、示す場所（画面のパスと対象）だけを入れる。
import { useEffect, useRef, useState } from "react";

const KEY = "soraban:ops-change-notice";
/** 読み直しに時間がかかっても拾えるよう、印は 2 分だけ有効にする。 */
const TTL_MS = 2 * 60 * 1000;

type Flash = { readonly path: string; readonly target: string; readonly message: string; readonly at: number };

/** 読み直す直前に呼ぶ。target は ChangeNotice の target と同じ文字列。 */
export const setChangeFlash = (path: string, target: string, message: string): void => {
  try {
    const f: Flash = { path, target, message, at: Date.now() };
    window.sessionStorage.setItem(KEY, JSON.stringify(f));
  } catch {
    // 保存できない環境（プライベートブラウズ等）では結果を示さないだけ
  }
};

/** 自分宛ての印を読む（消さない）。期限切れ・別の画面の印はここで捨てる。 */
const peekFlash = (target: string): Flash | null => {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return null;
    const f = JSON.parse(raw) as Flash;
    if (Date.now() - f.at > TTL_MS || f.path !== window.location.pathname) {
      window.sessionStorage.removeItem(KEY);
      return null;
    }
    return f.target === target ? f : null;
  } catch {
    return null;
  }
};

const clearFlash = (): void => {
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    // 何もしない
  }
};

/**
 * 結果の表示。focusSelector を渡すと、その要素（なければ表示そのもの）へスクロールしてフォーカスを移す。
 * 読み上げのため、role="status" の要素は最初から置いておき、文言だけを後から入れる。
 */
export function ChangeNotice({
  target,
  focusSelector,
  className = "",
}: {
  readonly target: string;
  readonly focusSelector?: string;
  readonly className?: string;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const ref = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    // 開発時の StrictMode で effect が 2 回走っても示せるよう、印は表示する時点で消す
    const f = peekFlash(target);
    if (!f) return;
    let frame = 0;
    // 読み直し後のブラウザのスクロール復元より後に、文言を入れてからスクロールとフォーカスを行う
    const t = window.setTimeout(() => {
      clearFlash();
      setMessage(f.message);
      frame = window.requestAnimationFrame(() => {
        const el = (focusSelector ? document.querySelector<HTMLElement>(focusSelector) : null) ?? ref.current;
        if (!el) return;
        el.scrollIntoView({ block: "center" });
        el.focus({ preventScroll: true });
      });
    }, 50);
    return () => {
      window.clearTimeout(t);
      window.cancelAnimationFrame(frame);
    };
  }, [target, focusSelector]);

  return (
    <p
      ref={ref}
      role="status"
      tabIndex={-1}
      data-testid="ops-change-notice"
      className={
        message
          ? `rounded-sharp border border-signal-green/60 bg-signal-green-soft px-3 py-2 text-sm text-signal-green outline-none focus-visible:ring-2 focus-visible:ring-brand-700 ${className}`
          : "sr-only"
      }
    >
      {message ?? ""}
    </p>
  );
}
