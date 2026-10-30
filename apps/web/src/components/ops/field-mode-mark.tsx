"use client";

import { useLayoutEffect } from "react";

// 現場モードの印（Sprint 12h PR ③b2b）。現場の 2 画面（…/field・…/field/incident）を開いている間だけ <html data-mode="field"> を付け、
// 画面を離れる（unmount）か、Next.js のキャッシュ機能で隠される（effect が止まる）と外す。
// 現場の値（7:1・56／64px・影なし・動きなし）は soraban-tokens.css の :root[data-mode="field"] が持つ。この部品は値を持たない。
// 公開の `/` は ops を読まない（この部品は app/ops 以下の現場のページだけが置く）。④で、設定や入力画面での自動切り替えに置き換える。
export const FIELD_MODE_ATTR = "data-mode";
export const FIELD_MODE_VALUE = "field";

export function FieldModeMark() {
  useLayoutEffect(() => {
    const root = document.documentElement;
    const before = root.getAttribute(FIELD_MODE_ATTR);
    root.setAttribute(FIELD_MODE_ATTR, FIELD_MODE_VALUE);
    return () => {
      // 自分が付けた印だけを外す（ほかが別の値に変えていたら触らない）
      if (root.getAttribute(FIELD_MODE_ATTR) === FIELD_MODE_VALUE) {
        if (before && before !== FIELD_MODE_VALUE) root.setAttribute(FIELD_MODE_ATTR, before);
        else root.removeAttribute(FIELD_MODE_ATTR);
      }
    };
  }, []);
  return null;
}
