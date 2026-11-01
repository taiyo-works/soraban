"use client";

import { useEffect } from "react";

// 計画の各画面で、URL の hash の要素までスクロールする（Sprint 17-1 差し戻し）。
// 新しい画面は Suspense でストリーミングされ、描画の直後は本文が display:none の中にあるため、ブラウザや Next の
// hash へのスクロールが空振りする（旧アンカーの移送・「次にやること」のクライアント遷移の後に先頭のままになる）。
// 要素が現れ、表示されるまで待ってからスクロールする。要素が最後まで無ければ（条件で出ない節）何もしない。
const TOP_OFFSET_PX = 64; // 上バー（48px）の下に見出しが隠れない余白
const GIVE_UP_MS = 6000;

export function HashScroll() {
  useEffect(() => {
    let timer = 0;
    const run = (): void => {
      window.clearTimeout(timer);
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (!id) return;
      const startedAt = Date.now();
      const tryScroll = (): void => {
        const el = document.getElementById(id);
        if (el && el.getClientRects().length > 0) {
          // 折りたたんだ中身を指す hash（例：#procedures）は、先に開く
          for (const d of el.querySelectorAll("details[data-open-on-hash]")) (d as HTMLDetailsElement).open = true;
          // 描画が落ち着く（流し込みで高さが変わる）まで 1 回待ってから、実際の位置へ
          window.requestAnimationFrame(() => {
            const top = el.getBoundingClientRect().top + window.scrollY - TOP_OFFSET_PX;
            window.scrollTo({ top: Math.max(0, top) });
          });
          return;
        }
        if (Date.now() - startedAt < GIVE_UP_MS) timer = window.setTimeout(tryScroll, 50);
      };
      tryScroll();
    };
    run();
    window.addEventListener("hashchange", run);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("hashchange", run);
    };
  }, []);
  return null;
}
