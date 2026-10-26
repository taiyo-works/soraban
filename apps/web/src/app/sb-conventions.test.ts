import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Sprint 12h PR ②（デザインシステム v2）の約束を、ファイルを読んで固定する：
//   Q-14 書体は next/font の 2 つだけ（Fraunces・IBM Plex・--font-display・--font-mono を `/` の木から外す）
//   Q-15 `/` が読み込むファイルの木に、旧トークン（paper・ink・indigo・brand-・signal-・verdict-*）の参照が 0
//   Q-26 動きの時間はトークン経由（直書き 0）。せり上がりは結論カードだけ。減らす指定・現場で 0
//   色の直書き（#fff・#262523 など）0。トークン経由にする（地図の固定色と PDF を除く）

const SRC = new URL("../", import.meta.url).pathname;
const read = (rel: string): string => readFileSync(join(SRC, rel), "utf8");
const stripComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** `/` が描くファイル（公開の判定画面の木）。PDF の部品（regulation-pdf・application-pdf・pdf-*）は画面ではないので含めない。 */
const TREE = [
  "app/page.tsx",
  "app/layout.tsx",
  "components/hero-illustration.tsx",
  "components/ops-home-entry.tsx",
  "components/regulation-checker.tsx",
  "components/regulation-card.tsx",
  "components/regulation-map.tsx",
  "components/regulation-map-layers.ts",
  "components/current-location-control.tsx",
  "components/verdict-summary.tsx",
  "components/diagnosis-panel.tsx",
  "components/procedure-card.tsx",
  "components/deadline-calendar.tsx",
  "components/manual-draft.tsx",
  "components/prefill-table.tsx",
  "components/ui/sb-parts.tsx",
];

const LEGACY_CLASS =
  /(?<![\w-])(?:bg|text|border|border-[lrtb]|ring|ring-offset|fill|stroke|divide|decoration|accent|from|to|via|outline)-(?:paper(?:-soft|-deep)?|ink(?:-soft|-mute)?|rule(?:-soft)?|indigo-\d+|brand-\d+|signal-[a-z-]+|verdict-(?:no-fly|needs|done|clear|unknown))(?![\w-])/;

describe("Q-14 書体", () => {
  it("layout.tsx は next/font/google の Noto Sans JP と Plus Jakarta Sans だけ。Fraunces・IBM Plex は読み込まない", () => {
    const layout = stripComments(read("app/layout.tsx"));
    expect(layout).toMatch(/from "next\/font\/google"/);
    expect(layout).toMatch(/Noto_Sans_JP/);
    expect(layout).toMatch(/Plus_Jakarta_Sans/);
    expect(layout).not.toMatch(/Fraunces|IBM_Plex|Manrope/);
    // 書体の宣言は 2 つ（google の関数の呼び出しが 2 回）
    expect(layout.match(/(?:Noto_Sans_JP|Plus_Jakarta_Sans)\(\{/g)).toHaveLength(2);
    // 日本語の分割ファイルは先読みしない。数字・英字（latin）だけ先読みする
    expect(layout).toMatch(/Noto_Sans_JP\(\{[\s\S]*?preload: false/);
    expect(layout).toMatch(/Plus_Jakarta_Sans\(\{[\s\S]*?subsets: \["latin"\]/);
  });

  it("`/` の木に --font-display・--font-mono・font-display・font-mono の参照がない。数字は sb-num（Plus Jakarta Sans・tabular-nums）", () => {
    for (const f of TREE) {
      const s = stripComments(read(f));
      expect(s, f).not.toMatch(/--font-display|--font-mono|(?<![\w-])font-display|(?<![\w-])font-mono/);
    }
    const ui = stripComments(read("app/soraban-ui.css"));
    expect(ui).toMatch(/\.sb-num\s*\{[^}]*font-family: var\(--font-num\)[^}]*font-variant-numeric: tabular-nums/);
    expect(stripComments(read("app/soraban-theme.css"))).toMatch(/--font-num: var\(--font-jakarta\)/);
  });
});

describe("Q-15 旧トークン", () => {
  it("`/` の木のファイルに、旧トークンの Tailwind の名前（paper・ink・indigo・brand-・signal-・verdict-*）の参照がない", () => {
    const bad: string[] = [];
    for (const f of TREE) {
      const lines = read(f).split("\n");
      lines.forEach((line, i) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
        if (LEGACY_CLASS.test(line)) bad.push(`${f}:${i + 1}: ${line.trim().slice(0, 90)}`);
      });
    }
    expect(bad).toEqual([]);
  });

  it("画面の判定の色の定数（verdict-display.ts）は --sb-v-* を引く（旧 --color-verdict-* ではない）。PDF の 16 進は別（PDF は変えない）", () => {
    const s = read("lib/verdict-display.ts");
    const screen = s.slice(s.indexOf("export const VERDICT_TONE"), s.indexOf("/** 段階の色（PDF の 16 進"));
    expect(screen).not.toMatch(/verdict-(no-fly|needs|done|clear|unknown)(?!-)/);
    expect(screen).toMatch(/sb-v-no-fg/);
    expect(s).toMatch(/VERDICT_PDF_COLOR/);
  });
});

describe("色の直書き 0（トークン経由）", () => {
  it("`/` の木の TSX・TS に 16 進の色がない（地図の固定色 regulation-map-layers.ts と、地図の層の印の線 regulation-map-zones.ts を除く）", () => {
    const bad: string[] = [];
    for (const f of TREE) {
      if (f === "components/regulation-map-layers.ts") continue;
      const s = stripComments(read(f));
      for (const m of s.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) bad.push(`${f}: ${m[0]}`);
      // rgb()・hsl() の直書きも使わない
      for (const m of s.matchAll(/\b(?:rgba?|hsla?)\(/g)) bad.push(`${f}: ${m[0]}`);
    }
    expect(bad).toEqual([]);
  });

  it("v2 の CSS（soraban-ui.css・soraban-theme.css）の 16 進は、地図の固定色（--sb-map-*）の定義だけ", () => {
    for (const name of ["app/soraban-ui.css", "app/soraban-theme.css"]) {
      const s = stripComments(read(name));
      const lines = s.split("\n").filter((l) => /#[0-9a-fA-F]{3,8}\b/.test(l));
      for (const l of lines) expect(l.trim(), name).toMatch(/^--sb-map-[\w-]+: #[0-9a-fA-F]{6};$/);
    }
  });
});

describe("Q-26 動き", () => {
  const ui = stripComments(read("app/soraban-ui.css"));

  it("時間の直書き（ms・s）が 0：transition・animation の時間はすべて var(--sb-dur*) から引く", () => {
    const bad: string[] = [];
    ui.split("\n").forEach((line, i) => {
      if (!/(transition|animation)/.test(line)) return;
      // 時間の値（0.5s・500ms など）。var(...) の中身と keyframes の名前は対象外
      const noVar = line.replace(/var\([^)]*\)/g, "");
      if (/\b\d+(\.\d+)?m?s\b/.test(noVar)) bad.push(`soraban-ui.css:${i + 1}: ${line.trim()}`);
    });
    expect(bad).toEqual([]);
  });

  it("せり上がり（sb-rise）は結論カードだけにかかる。h1・site-lead・入力・地図には使わない", () => {
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const n of readdirSync(dir)) {
        const p = join(dir, n);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(tsx|ts)$/.test(n) && !/\.test\./.test(n) && /sb-rise/.test(readFileSync(p, "utf8"))) files.push(p.replace(SRC, ""));
      }
    };
    walk(SRC);
    expect(files).toEqual(["components/verdict-summary.tsx"]);
    const vs = read("components/verdict-summary.tsx");
    expect(vs).toMatch(/data-testid="verdict-conclusion"[\s\S]{0,80}\$\{ready \? "sb-rise" : ""\}/);
  });

  it("減らす指定と現場では、動きの時間のトークンが 0（soraban-tokens.css）。矢印の入れ替えは止まる（soraban-ui.css）", () => {
    const tokens = stripComments(read("app/soraban-tokens.css"));
    expect(tokens).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*:root \{ --sb-dur: 0ms; --sb-dur-rise: 0ms; \}/);
    expect(tokens).toMatch(/:root\[data-mode="field"\]\s*\{[^}]*--sb-dur: 0ms;[^}]*--sb-dur-rise: 0ms;/);
    expect(ui).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.sb-pill-arrow \.sb-a2 \{\s*display: none;/);
    expect(ui).toMatch(/:root\[data-mode="field"\] \.sb-pill-arrow \.sb-a2 \{\s*display: none;/);
  });

  it("動きのライブラリを足していない（package.json に差分がない前提の確認：framer-motion・gsap などが依存にない）", () => {
    const pkg = readFileSync(new URL("../../package.json", import.meta.url), "utf8");
    expect(pkg).not.toMatch(/framer-motion|motion|gsap|lottie|react-spring/);
  });
});
