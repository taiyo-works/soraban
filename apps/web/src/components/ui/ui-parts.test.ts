// Sprint 12g stage 1a contract 1a-5 の共通部品の単体検査。16-N2（N-1）で、参照 0 になった旧い部品（primitives・overlays・forms・data・
// workspace・tabs・command-palette・journey-line・verdict-stamp）を消したので、その部品だけを確かめていた検査も外した（残るのは brand-marks）。
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { APP_ICON_PROPOSALS, DroneLineArt } from "./brand-marks";

const html = (el: Parameters<typeof renderToStaticMarkup>[0]): string => renderToStaticMarkup(el);
/** createElement without per-component prop typing (children are passed positionally in these tests). */
const h = (type: unknown, props?: unknown, ...children: unknown[]) => createElement(type as never, props as never, ...(children as never[]));

describe("アプリのアイコン案とドローンの線画（要望 2026-10-22）", () => {
  it("3 案。正方形・角丸なし・文字なし・グラデーションなし・色は CSS 変数（currentColor 相当）", () => {
    expect(APP_ICON_PROPOSALS).toHaveLength(3);
    const compositions = new Set<string>();
    for (const { id, Icon } of APP_ICON_PROPOSALS) {
      const out = html(h(Icon, { size: 180 }));
      expect(out, id).toContain('viewBox="0 0 120 120"');
      expect(out, id).toContain('width="180"');
      expect(out, id).toContain('height="180"');
      // the background is the first rect: full size, no corner radius
      expect(out, id).toMatch(/<rect width="120" height="120" fill="var\(--appicon-bg, #0a5fd0\)"><\/rect>/);
      expect(out, id).not.toMatch(/\brx=.*width="120"/);
      expect(out, id).not.toMatch(/<text|<tspan|Gradient|<filter|<image|filter=|<mask|<clipPath/i);
      expect(out, id).toContain("var(--appicon-fg, #ffffff)");
      compositions.add(out);
    }
    expect(compositions.size).toBe(3);
  });
  it("装飾として使うと aria-hidden、名前を渡すと role=img", () => {
    const { Icon } = APP_ICON_PROPOSALS[0];
    expect(html(h(Icon, {}))).toContain('aria-hidden="true"');
    expect(html(h(Icon, { label: "アイコン案" }))).toContain('role="img"');
  });
  it("ドローンの線画は 線 1.75px・currentColor・装飾（aria-hidden）・倍率で太さが変わらない", () => {
    const out = html(h(DroneLineArt, { width: 160 }));
    expect(out).toContain('stroke-width="1.75"');
    expect(out).toContain('stroke="currentColor"');
    expect(out).toContain('aria-hidden="true"');
    expect(out).toContain('vector-effect="non-scaling-stroke"');
    expect(out).not.toMatch(/Gradient|<image/);
  });
});
