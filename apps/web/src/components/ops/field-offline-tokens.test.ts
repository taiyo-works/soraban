import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Sprint 16-K（現場・圏外）の約束を、ファイルを読んで固定する（K2-1・K2-4）。
//   K2-1  現場（field-client・incident-quick-client）と圏外の画面（offline-shells）、PWA の登録の案内（pwa-register）、先読み（field-prefetch）、
//         現場モードの印（field-mode-mark）に、旧い名前（paper・ink-soft・brand-*・signal-*・rounded-sharp・font-mono など）と色の直書きが 0。
//   K2-1  圏外の画面 4 つ（today・field・inspection・journal）と、枠の読み込み・見つからない・圏外では行えない画面のすべてが、現場モードの印（FieldModeMark）を置く。
//   K2-4  現場の主ボタン（data-variant="primary"）は、離着陸・日誌へのリンクだけ（確認・保存・リンクは副）。

const SRC = new URL("../../", import.meta.url).pathname;
const read = (rel: string): string => readFileSync(join(SRC, rel), "utf8");
const stripComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const FILES = [
  "components/ops/offline-shells.tsx",
  "components/ops/pwa-register.tsx",
  "components/ops/field-prefetch.tsx",
  "components/ops/field-mode-mark.tsx",
  "components/ops/field-client.tsx",
  "components/ops/incident-quick-client.tsx",
];

const LEGACY =
  /(?<![\w-])(?:[a-z-]+:)*(?:rounded-(?:ctl|sharp|soft|t-sharp|b-sharp)|(?:bg|text|border|border-[lrtb]|ring|ring-offset|fill|stroke|divide|decoration|accent|from|to|via|outline|placeholder:text)-(?:paper(?:-soft|-deep)?|ink(?:-soft|-mute)?|rule(?:-soft)?|indigo-\d+|brand-\d+|signal-[a-z-]+|verdict-(?:no-fly|needs|done|clear|unknown)|fg(?:-soft|-mute)?|accent(?:-soft|-solid|-fg)?|surface|sunken|app|line(?:-strong)?|(?:ok|warn|danger|info|neutral)-(?:fg|bg|line))|hov:)(?![\w-])/;
const OLD_PARTS = /(?<![\w-])(?:font-display|font-mono|font-light|text-aux|text-body|text-table)(?![\w-])|border-l-(?:2|4|8)(?![\w[-])|ui\/primitives/;
const HEX_OR_RGB = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/;

describe("16-K K2-1 現場・圏外・PWA の案内は新しいトークンだけ", () => {
  for (const f of FILES) {
    it(`${f}：旧い名前・旧い部品・色の直書きが 0`, () => {
      const src = stripComments(read(f));
      expect(src.match(LEGACY)?.[0] ?? null).toBeNull();
      expect(src.match(OLD_PARTS)?.[0] ?? null).toBeNull();
      expect(src.match(HEX_OR_RGB)?.[0] ?? null).toBeNull();
    });
  }
  it("offline-shells：すべての <main> が現場モードの印を置く（today・field・inspection・journal・読み込み・見つからない・圏外では行えない）", () => {
    const src = stripComments(read("components/ops/offline-shells.tsx"));
    const mains = src.match(/<main\b/g)?.length ?? 0;
    const marks = src.match(/<FieldModeMark \/>/g)?.length ?? 0;
    expect(mains).toBeGreaterThanOrEqual(6);
    // <main> ごとに 1 つ、加えて現場の画面（FieldClient を返す枠）で 1 つ
    expect(marks).toBe(mains + 1);
    for (const m of src.split("<main").slice(1)) expect(m.slice(0, m.indexOf("</main>") === -1 ? undefined : m.indexOf("</main>"))).toMatch(/<FieldModeMark \/>/);
  });
  it("pwa-register：新しい版の知らせは新しい部品（opx-box・opx-btn）で、主ボタンを足さない（K-8）", () => {
    const src = stripComments(read("components/ops/pwa-register.tsx"));
    expect(src).toMatch(/opx-box/);
    expect(src).toMatch(/opx-btn/);
    expect(src).not.toMatch(/data-variant/);
    expect(src).not.toMatch(/opx-btn-primary/);
  });
});

describe("16-K K2-4 現場の主ボタンは 1 つの状態に 1 つ", () => {
  it("field-client：data-variant を持つのは離着陸のボタンと日誌へのリンクだけ。確認・保存・リンクは副", () => {
    const src = stripComments(read("components/ops/field-client.tsx"));
    const found = [...src.matchAll(/["']?data-variant["']?\s*[=:]/g)].length;
    expect(found).toBe(3); // 着陸・離陸・日誌を記入する
    for (const id of ["field-docs-confirm", "field-restriction-submit", "field-site-submit", "field-inspection-link", "field-em-submit", "field-recheck-submit", "field-carry-submit", "field-post-link"]) {
      const i = src.indexOf(id);
      expect(i, id).toBeGreaterThan(0);
      expect(src.slice(Math.max(0, i - 400), i + 120), id).not.toMatch(/BTN_PRIMARY|data-variant/);
    }
  });
  it("offline-shells：主ボタン（data-variant）は保存の 1 つずつ（点検・日誌）", () => {
    const src = stripComments(read("components/ops/offline-shells.tsx"));
    expect([...src.matchAll(/data-variant="primary"/g)].length).toBe(2);
    expect(src).toMatch(/data-variant="primary"[^>]*BTN_PRIMARY[^>]*onClick=\{\(\) => void save\(\)\} data-testid="offline-inspection-save"/);
    expect(src).toMatch(/data-variant="primary"[^>]*BTN_PRIMARY[^>]*onClick=\{\(\) => void save\(\)\} data-testid="offline-journal-save"/);
  });
});

describe("16-K K2-3 状態の帯", () => {
  it("field-client：帯には短い印と文字（！古い可能性）だけを置き、説明は帯の外の field-status-prefetch-stale-help", () => {
    const src = stripComments(read("components/ops/field-client.tsx"));
    const band = src.slice(src.indexOf('data-testid="field-status-band"'), src.indexOf("</section>", src.indexOf('data-testid="field-status-band"')));
    expect(band).toMatch(/data-testid="field-status-prefetch-stale"/);
    expect(band).toMatch(/！古い可能性/);
    expect(band).not.toMatch(/field-status-prefetch-stale-help/);
    expect(band).not.toMatch(/登録が変わっていないか/);
    expect(src).toMatch(/data-testid="field-status-prefetch-stale-help"/);
  });
});
