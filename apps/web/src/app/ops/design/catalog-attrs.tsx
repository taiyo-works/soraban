"use client";

import { useLayoutEffect } from "react";

// 見本の設定（現場モード・強制の暗）を <html> に付け、見本を離れる（unmount）と外す。値は固定の語だけ（URL の生の文字列は入れない）。
export function CatalogAttrs({ mode, theme }: { readonly mode: "field" | null; readonly theme: "dark" | null }) {
  useLayoutEffect(() => {
    const root = document.documentElement;
    const set: Array<[string, string]> = [];
    if (mode) set.push(["data-mode", mode]);
    if (theme) set.push(["data-theme", theme]);
    for (const [k, v] of set) root.setAttribute(k, v);
    return () => {
      for (const [k, v] of set) if (root.getAttribute(k) === v) root.removeAttribute(k);
    };
  }, [mode, theme]);
  return null;
}
