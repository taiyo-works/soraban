// Sprint 12g stage 1a contract 1a-4: the icon set. Every icon is defined, uses the same 24px grid and stroke, and is
// decorative (aria-hidden). No external images or libraries.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ICON_NAMES, ICON_PATHS, ICON_STROKE, ICON_VIEWBOX, Icon } from "./icons";

// The icons named in docs/design/ui-direction.md 3.6 (aliases: flight = paper-plane, aircraft = drone, ...).
const REQUIRED = [
  "today", "plan", "journal", "flight", "inspection", "incident", "permit", "aircraft", "pilot", "place", "more",
  "search", "command", "plus", "chevron-left", "chevron-right", "chevron-up", "chevron-down", "check", "check-circle",
  "x", "info", "alert", "ban", "clock", "filter", "sort", "columns", "sidebar", "sun", "moon", "monitor",
  "external-link", "copy", "download", "keyboard", "help", "sign-out", "lock", "history",
];

describe("アイコン（1a-4）", () => {
  it("設計書の約 32 個（以上）がすべて定義されている", () => {
    expect(ICON_NAMES.length).toBeGreaterThanOrEqual(32);
    for (const n of REQUIRED) expect(ICON_NAMES, n).toContain(n);
  });

  it("全アイコンが同じ viewBox（24px の方眼）・同じ線の太さ（1.75）・currentColor・aria-hidden で描かれる", () => {
    expect(ICON_VIEWBOX).toBe("0 0 24 24");
    expect(ICON_STROKE).toBe(1.75);
    for (const name of ICON_NAMES) {
      const html = renderToStaticMarkup(createElement(Icon, { name }));
      expect(html, name).toContain('viewBox="0 0 24 24"');
      expect(html, name).toContain('stroke-width="1.75"');
      expect(html, name).toContain('stroke="currentColor"');
      expect(html, name).toContain('stroke-linecap="round"');
      expect(html, name).toContain('stroke-linejoin="round"');
      expect(html, name).toContain('aria-hidden="true"');
      expect(html, name).toContain('focusable="false"');
      expect(html, name).not.toMatch(/<title|aria-label|role=/);
    }
  });

  it("どのアイコンにも図形があり、色の直書き・外部参照・グラデーションがない", () => {
    for (const name of ICON_NAMES) {
      const html = renderToStaticMarkup(createElement(Icon, { name }));
      expect(html, name).toMatch(/<(path|circle|rect)\b/);
      expect(html, name).not.toMatch(/#[0-9a-f]{3,6}\b|rgb\(|url\(|href=|<image|<use|Gradient/i);
    }
    expect(Object.keys(ICON_PATHS).length).toBe(ICON_NAMES.length);
  });

  it("名前がない・大きさの指定が効く", () => {
    const html = renderToStaticMarkup(createElement(Icon, { name: "check", size: 32 }));
    expect(html).toContain('width="32"');
    expect(html).toContain('height="32"');
  });
});

describe("外部の画像・ライブラリに依存しない（components/ui）", () => {
  const dir = path.resolve(path.dirname(new URL(import.meta.url).pathname));
  const walk = (d: string): string[] =>
    readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  const sources = walk(dir).filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f));

  it("import は react・next・自分たちのコードだけ。画像ファイル・外部 URL を読まない", () => {
    expect(sources.length).toBeGreaterThanOrEqual(8);
    const ALLOWED = /^(react|react-dom|next\/[a-z-]+|@\/|@soraban\/regulations|\.{1,2}\/)/;
    for (const f of sources) {
      const text = readFileSync(f, "utf8");
      for (const m of text.matchAll(/^import[^"']*["']([^"']+)["']/gm)) {
        expect(m[1], `${path.relative(dir, f)}: ${m[1]}`).toMatch(ALLOWED);
      }
      expect(text, path.relative(dir, f)).not.toMatch(/https?:\/\//);
      expect(text, path.relative(dir, f)).not.toMatch(/\.(png|jpe?g|gif|webp|svg)["']/);
    }
  });

  it("認証・DB・外部通信を使わない（見本）", () => {
    for (const f of sources) {
      const text = readFileSync(f, "utf8");
      expect(text, path.relative(dir, f)).not.toMatch(/\bfetch\(|XMLHttpRequest|WebSocket|sendBeacon|@soraban\/db|getPool|process\.env|\/api\//);
    }
  });
});
