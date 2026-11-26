import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Sprint 16-N2（N-2。旧 16 の T-1・T-3）：旧トークン・色の直書きの検査を、ファイルの列挙（ops-v2-conventions の B1・B2A・B2B・S17、
// sb-conventions の TREE）から `apps/web/src/**` 全体に広げる。新しく足したファイルも、列挙に入れ忘れても検査される。
// 例外は下の 3 つの表だけ（理由つき）。足すときは、理由をここと docs/evaluations/sprint-16-test-changes.md に書く。外す方向だけ許す。

const SRC = new URL("../", import.meta.url).pathname;
const stripComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const walk = (dir: string, out: string[] = []): string[] => {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
};
const ALL = walk(SRC).map((p) => relative(SRC, p));
const isTest = (f: string): boolean => /\.test\.|\.test-helpers\./.test(f);
const CODE = ALL.filter((f) => /\.(ts|tsx)$/.test(f) && !isTest(f));
const CSS = ALL.filter((f) => /\.css$/.test(f));
const read = (f: string): string => readFileSync(join(SRC, f), "utf8");

/** 色の直書きを許すファイルと理由。画面の色は --sb-*（Tailwind の bg-sb-* など）だけ。 */
const HEX_EXEMPT: Readonly<Record<string, string>> = {
  "components/regulation-pdf.tsx": "PDF（同上）",
  "components/pdf-verdict.tsx": "PDF（同上）",
  "components/regulation-map-layers.ts": "地図の固定色（--sb-map-* と同じ値。地図の外の色ではない）",
  "components/regulation-map-zones.ts": "地図の層の印の線（地図の中の色）",
  "lib/verdict-display.ts": "判定の PDF の 16 進（VERDICT_PDF_COLOR）。画面の色は --sb-v-*",
  "lib/pwa.ts": "PWA の theme_color・background_color（マニフェストは CSS の変数を読めない。値は地 #F6F7F9）",
  "proxy.ts": "エラー画面の組み込みの CSS（アプリの CSS を読まない応答。色の名前も自前）",
  "components/ui/brand-marks.tsx": "アプリのアイコン案（参照 0。--appicon-* が無いときの仮の青と白）",
};

const LEGACY =
  /(?<![\w-])(?:[a-z-]+:)*(?:rounded-(?:ctl|sharp|soft|t-sharp|b-sharp|pill)|(?:bg|text|border|border-[lrtbxy]|ring|ring-offset|fill|stroke|divide|decoration|accent|from|to|via|outline|placeholder:text)-(?:paper(?:-soft|-deep)?|ink(?:-soft|-mute)?|rule(?:-soft)?|indigo-\d+|brand-\d+|signal-[a-z-]+|verdict-(?:no-fly|needs|done|clear|unknown)|fg(?:-soft|-mute)?|accent(?:-soft|-solid|-fg)?|surface|sunken|app|line(?:-strong)?|(?:ok|warn|danger|info|neutral)-(?:fg|bg|line))|hov:|(?:foc|act|field|compact):(?:min-|max-|px-|py-|p-|h-|w-|text-|bg-|border-|font-|gap-|underline|translate|brightness))(?![\w-])/;
const OLD_VAR = /var\(--(?:bg-(?:app|surface|sunken)|fg(?:-soft|-mute)?|line(?:-strong)?|accent(?:-soft|-solid(?:-hover)?|-fg)?|(?:ok|warn|danger|info|neutral)-(?:fg|bg|line)|verdict-[a-z-]+|scrim|r-journal|r-pill|color-(?:paper|ink|rule|indigo|brand|signal|verdict)[\w-]*|dur(?:-sheet)?|ease)\b/;
const OLD_CLASS = /(?<![\w-])(?:ds-dialog|ds-dialog-panel|ds-table|ds-table-link|ds-skeleton|bearing-mark|contour-rule)(?![\w-])/;
const TAILWIND_PALETTE =
  /(?<![\w-])(?:bg|text|border|ring|fill|stroke|divide)-(?:red|amber|yellow|orange|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|pink|rose|slate|gray|zinc|neutral|stone|black|white)(?:-\d{2,3})?(?![\w-])/;
const HEX = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/;

describe("N-2 旧トークン・色の直書きの検査は apps/web/src 全体", () => {
  it("検査の対象が実際に広い（TS・TSX 100 ファイル以上、CSS 5 ファイル以上）", () => {
    expect(CODE.length).toBeGreaterThanOrEqual(100);
    expect(CSS.length).toBeGreaterThanOrEqual(5);
  });

  it("TS・TSX（テストを除く）に、旧い色・角丸の Tailwind 名、variant、旧い class の名前、旧い CSS 変数の参照が 0", () => {
    const bad: string[] = [];
    for (const f of CODE) {
      const src = stripComments(read(f));
      for (const [label, re] of [["旧い Tailwind 名", LEGACY], ["旧い class", OLD_CLASS], ["旧い変数", OLD_VAR], ["色の名前の直指定", TAILWIND_PALETTE]] as const) {
        // 色の直書きを許したファイル（PDF・地図）は、Tailwind の色の名前の直指定も同じ理由で許す
        if (re === TAILWIND_PALETTE && f in HEX_EXEMPT) continue;
        const m = src.match(re)?.[0];
        if (m) bad.push(`${f}: ${label} ${m}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("TS・TSX（テストを除く）に色の直書き（16 進・rgb・hsl）が 0。例外は HEX_EXEMPT の理由つきのファイルだけ", () => {
    const bad: string[] = [];
    for (const f of CODE) {
      if (f in HEX_EXEMPT) continue;
      const m = stripComments(read(f)).match(HEX)?.[0];
      if (m) bad.push(`${f}: ${m}`);
    }
    expect(bad).toEqual([]);
  });

  it("例外の表の行は、いまも色の直書きを持つファイルだけ（持たなくなった行は外す）", () => {
    const stale = Object.keys(HEX_EXEMPT).filter((f) => !CODE.includes(f) || !HEX.test(stripComments(read(f))));
    expect(stale).toEqual([]);
  });

  it("CSS：旧い色の変数・旧い class が 0。16 進・rgb は soraban-tokens.css の値と --sb-map-*（地図の固定色）、見本の日差しの模擬の白い膜だけ", () => {
    const bad: string[] = [];
    for (const f of CSS) {
      const css = stripComments(read(f));
      const old = css.match(OLD_VAR)?.[0] ?? css.match(/(?<![\w-])\.(?:ds-dialog|ds-table|ds-skeleton|eyebrow|bearing-mark|contour-rule|field)(?![\w-])/)?.[0];
      if (old) bad.push(`${f}: ${old}`);
      if (f === "app/soraban-tokens.css") continue;
      for (const line of css.split("\n")) {
        if (!HEX.test(line)) continue;
        if (/^\s*--sb-map-[\w-]+:\s*#[0-9a-fA-F]{6};$/.test(line)) continue;
        if (f === "app/ops/design/catalog.css" && /^\s*background:\s*rgba\(255, 255, 255, 0\.35\);$/.test(line)) continue;
        bad.push(`${f}: ${line.trim()}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
