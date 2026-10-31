import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Sprint 12h PR ③b1・③b2a（運航管理 `/ops` の v2）の約束を、ファイルを読んで固定する：
//   Q-9 / Q-5  v2 のトークンだけ：③b1・③b2a で触った画面・部品に、色の直書き 0・旧トークンの参照 0
//   Q-18a 公開の `/` の CSS を増やさない：ops-v2*.css は app/ops/layout.tsx だけが読む。`/` の木の部品は ops 専用の .opx-* を使わない

const SRC = new URL("../../", import.meta.url).pathname;
const read = (rel: string): string => readFileSync(join(SRC, rel), "utf8");
const stripComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** ③b1 で v2 にした画面・部品（残りの ③b2 は含めない。docs/evaluations/12h-pr3b1-test-changes.md に一覧） */
const B1_FILES = [
  "app/ops/page.tsx",
  "app/ops/plans/page.tsx",
  "app/ops/plans/new/page.tsx",
  "app/ops/plans/[id]/page.tsx",
  "app/ops/plans/[id]/edit/page.tsx",
  "app/ops/inspections/page.tsx",
  "app/ops/inspections/new/page.tsx",
  "app/ops/inspections/[id]/page.tsx",
  "app/ops/journal/page.tsx",
  "app/ops/flights/page.tsx",
  "app/ops/flights/new/page.tsx",
  "app/ops/flights/[id]/page.tsx",
  "components/ops/ui.tsx",
  "components/ops/today-ui.tsx",
  "components/ops/judge-pills.tsx",
  "components/ops/more-rows.tsx",
  "components/ops/plan-ui.tsx",
  "components/ops/plans-client.tsx",
  "components/ops/procedure-client.tsx",
  "components/ops/records-client.tsx",
  "components/ops/record-filter.tsx",
  "components/ops/versions.tsx",
  "components/ops/change-notice.tsx",
  "components/ops/journal-ui.tsx",
];

const LEGACY =
  /(?<![\w-])(?:[a-z-]+:)*(?:rounded-(?:ctl|sharp|soft|t-sharp|b-sharp)|(?:bg|text|border|border-[lrtb]|ring|ring-offset|fill|stroke|divide|decoration|accent|from|to|via|outline|placeholder:text)-(?:paper(?:-soft|-deep)?|ink(?:-soft|-mute)?|rule(?:-soft)?|indigo-\d+|brand-\d+|signal-[a-z-]+|verdict-(?:no-fly|needs|done|clear|unknown)|fg(?:-soft|-mute)?|accent(?:-soft|-solid|-fg)?|surface|sunken|app|line(?:-strong)?|(?:ok|warn|danger|info|neutral)-(?:fg|bg|line))|hov:|inputClass-old)(?![\w-])/;
const HEX_OR_RGB = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/;
// Tailwind の色の名前の直指定（bg-red-500 など）
const TAILWIND_PALETTE = /(?<![\w-])(?:bg|text|border|ring|fill|stroke|divide)-(?:red|amber|yellow|orange|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|pink|rose|slate|gray|zinc|neutral|stone|black|white)(?:-\d{2,3})?(?![\w-])/;

/** ③b2a で v2 にした登録系の画面・部品（docs/evaluations/12h-pr3b2a-test-changes.md に一覧。残りの現場・事故・通報・判定の履歴は ③b2b） */
const B2A_FILES = [
  "app/ops/aircraft/page.tsx",
  "app/ops/aircraft/new/page.tsx",
  "app/ops/aircraft/[id]/page.tsx",
  "app/ops/pilots/page.tsx",
  "app/ops/pilots/new/page.tsx",
  "app/ops/pilots/[id]/page.tsx",
  "app/ops/permits/page.tsx",
  "app/ops/permits/new/page.tsx",
  "app/ops/permits/[id]/page.tsx",
  "app/ops/places/page.tsx",
  "app/ops/places/new/page.tsx",
  "app/ops/places/[id]/page.tsx",
  "app/ops/members/page.tsx",
  "app/ops/more/page.tsx",
  "app/ops/sign-in/page.tsx",
  "app/ops/no-access/page.tsx",
  "components/ops/permits-client.tsx",
  "components/ops/permit-ui.tsx",
  "components/ops/license-renewal.tsx",
];

/** ③b2b で v2 にした現場・事故・通報・判定の履歴の画面・部品（docs/evaluations/12h-pr3b2b-test-changes.md に一覧。これで /ops の旧トークンは 0） */
const B2B_FILES = [
  "components/ops/field-client.tsx",
  "components/ops/incident-quick-client.tsx",
  "components/ops/incident-client.tsx",
  "components/ops/incident-ui.tsx",
  "app/ops/incidents/page.tsx",
  "app/ops/incidents/new/page.tsx",
  "app/ops/incidents/[id]/page.tsx",
  "components/ops/report-client.tsx",
  "components/ops/report-parts.tsx",
  "app/ops/plans/[id]/report/page.tsx",
  "app/ops/plans/[id]/snapshots/page.tsx",
  "app/ops/plans/[id]/snapshots/[sid]/page.tsx",
  "app/ops/plans/[id]/field/page.tsx",
  "app/ops/plans/[id]/field/incident/page.tsx",
  "components/ops/field-mode-mark.tsx",
  "components/ops/ops-frame.tsx",
];

describe("Q-9 ③b1・Q-5 ③b2a／③b2b の画面・部品は v2 のトークンだけ", () => {
  for (const f of [...B1_FILES, ...B2A_FILES, ...B2B_FILES]) {
    it(`${f}：旧トークンの参照・色の直書きが 0`, () => {
      const src = stripComments(read(f));
      expect(src.match(LEGACY)?.[0] ?? null).toBeNull();
      expect(src.match(TAILWIND_PALETTE)?.[0] ?? null).toBeNull();
      expect(src.match(/#[0-9a-fA-F]{6}\b|\brgba?\(|\bhsla?\(/)?.[0] ?? null).toBeNull();
    });
  }
  it("③b2a・③b2b：登録系と現場・事故・通報・履歴の画面に、旧い部品の名前（ui/primitives・font-display・font-mono・左の線の枠）が 0", () => {
    for (const f of [...B2A_FILES, ...B2B_FILES]) {
      const src = stripComments(read(f));
      expect(src, f).not.toMatch(/ui\/primitives/);
      expect(src.match(/(?<![\w-])(?:font-display|font-mono|font-light|text-aux|text-body|text-table)(?![\w-])/)?.[0] ?? null, f).toBeNull();
      expect(src.match(/border-l-(?:2|4)\b/)?.[0] ?? null, f).toBeNull();
    }
  });
  it("③b2a：許可・承認の期限の札（有効性・技能証明の更新）は判定の色を使わない（墨の面＋「！」／薄い橙の面）", () => {
    const permit = stripComments(read("components/ops/permit-ui.tsx"));
    const m = /export const VALIDITY_TONE[\s\S]*?};/.exec(permit)?.[0] ?? "";
    expect(m).toMatch(/expiring: "soon"/);
    expect(m).toMatch(/expired: "alert"/);
    expect(m).toMatch(/revoked: "alert"/);
    for (const tone of ["amber", "red"]) expect(m, tone).not.toMatch(new RegExp(`"${tone}"`));
    const lic = stripComments(read("components/ops/license-renewal.tsx"));
    const t = /const STAGE_TONE[\s\S]*?};/.exec(lic)?.[0] ?? "";
    expect(t).not.toMatch(/"(?:red|amber|green)"/);
    const css = stripComments(read("app/ops/ops-v2.css"));
    const alert = /\.opx-badge-alert \{[^}]*\}/.exec(css)?.[0] ?? "";
    expect(alert).toMatch(/--sb-inverse-bg/);
    expect(alert).not.toMatch(/--sb-v-/);
    const soon = /\.opx-badge-soon \{[^}]*\}/.exec(css)?.[0] ?? "";
    expect(soon).toMatch(/--sb-orange-hover/);
    expect(soon).not.toMatch(/--sb-v-/);
  });
  it("ops-v2.css・ops-v2-screens.css に色の直書きがない（色は var(--sb-*) か color-mix だけ）", () => {
    for (const f of ["app/ops/ops-v2.css", "app/ops/ops-v2-screens.css"]) {
      const css = stripComments(read(f));
      expect(css.match(HEX_OR_RGB)?.[0] ?? null).toBeNull();
    }
  });
  it("影・角丸・動きの時間は --sb-* のトークン経由（px の角丸は 50% 以外に直書きしない）", () => {
    for (const f of ["app/ops/ops-v2.css", "app/ops/ops-v2-screens.css"]) {
      const css = stripComments(read(f));
      expect(css).not.toMatch(/box-shadow:\s*[^;]*\d+px\s+\d+px\s+\d+px\s+rgb/);
      expect(css).not.toMatch(/transition:[^;]*\b\d+(?:\.\d+)?m?s\b/);
      expect(css).not.toMatch(/animation:[^;]*\b\d+(?:\.\d+)?m?s\b/);
      expect(css).not.toMatch(/border-radius:\s*\d+px/);
    }
  });
});

describe("Q-18a 公開の `/` の CSS を増やさない", () => {
  it("ops-v2*.css を import するのは app/ops/layout.tsx だけ", () => {
    const layout = read("app/ops/layout.tsx");
    expect(layout).toMatch(/import "\.\/ops-v2\.css";/);
    expect(layout).toMatch(/import "\.\/ops-v2-screens\.css";/);
    for (const f of ["app/layout.tsx", "app/page.tsx", "app/globals.css", "app/soraban-ui.css", "components/ops-home-entry.tsx"]) {
      expect(read(f)).not.toMatch(/ops-v2/);
    }
  });
  it("`/` の帯が使う TodayBadge・TodayNextActions・MoreRows は、ops 専用の .opx-* を使わない（`/` は ops-v2.css を読まない）", () => {
    const today = read("components/ops/today-ui.tsx");
    const a = today.indexOf("const BADGE_CLASS");
    const b = today.indexOf("// 行程の 1 行");
    expect(today.slice(a, b)).not.toMatch(/opx-/);
    const c = today.indexOf("// 急ぎ度の札");
    const d = today.indexOf("export function TodayNextActions");
    expect(today.slice(c, d)).not.toMatch(/opx-/);
    // TodayNextActions の見出し（heading が真のときだけ。`/` の帯は heading={false}）は /ops だけに出る。一覧の部分は共通の .sb-* だけ
    const e = today.indexOf("export function TodayNextActions");
    const f = today.indexOf("/** 近づく期限");
    expect(today.slice(e, f).replace(/<div className="sb-sec-head sb-sec-row">[\s\S]*?<\/div>/, "")).not.toMatch(/opx-/);
    expect(read("components/ops/more-rows.tsx")).not.toMatch(/opx-/);
  });
  it("ops-v2.css の部品は @layer components の中（Tailwind の部品で重ね書きできる）。旧い名前の置き換えは .ops-v2 の中だけ", () => {
    const css = stripComments(read("app/ops/ops-v2.css"));
    expect(css).toMatch(/@layer components \{/);
    expect(css).toMatch(/^\.ds\.ops-v2 \{/m);
    // `.ds` 全体（/ops/design の見本）は書き換えない
    expect(css).not.toMatch(/^\.ds \{/m);
  });
  it("現場（…/field）にも .ops-v2 の枠を当て、現場の 2 画面だけが表示中の間 data-mode=\"field\" を付ける（③b2b。③b1 の「枠を当てない」を反転）", () => {
    const frame = read("components/ops/ops-frame.tsx");
    expect(frame).not.toMatch(/isField/);
    expect(frame).toMatch(/ds ds-page ops-v2/);
    for (const f of ["app/ops/plans/[id]/field/page.tsx", "app/ops/plans/[id]/field/incident/page.tsx"]) {
      expect(read(f), f).toMatch(/<FieldModeMark \/>/);
    }
    // 印を付ける部品は、離れたとき（unmount・Activity で隠れたとき）に外す
    const mark = stripComments(read("components/ops/field-mode-mark.tsx"));
    expect(mark).toMatch(/useLayoutEffect/);
    expect(mark).toMatch(/removeAttribute/);
    // 現場の 2 ページ以外・公開の `/` は data-mode を設定しない（読むだけ）
    for (const f of ["app/globals.css", "app/page.tsx", "app/layout.tsx", "app/ops/layout.tsx", "components/ops/ops-frame.tsx", "components/ops/field-client.tsx", "components/ops/incident-quick-client.tsx"]) {
      expect(stripComments(read(f)), f).not.toMatch(/setAttribute\(\s*["']data-mode|dataset\.mode|data-mode=["']field/);
    }
  });
});

describe("Q-11 押す部品の下限", () => {
  it("ボタン・戻りリンク・チップは --sb-hit-min（44px）以上のトークンを使う", () => {
    const css = stripComments(read("app/ops/ops-v2.css"));
    for (const cls of [".opx-btn", ".opx-back", ".opx-seg > a"]) {
      const i = css.indexOf(`${cls} {`);
      expect(i, cls).toBeGreaterThan(-1);
      const block = css.slice(i, css.indexOf("}", i));
      expect(block, cls).toMatch(/min-height:\s*var\(--sb-hit(?:-min)?\)/);
    }
  });
});
