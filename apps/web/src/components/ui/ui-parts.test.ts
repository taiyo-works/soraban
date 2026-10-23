// Sprint 12g stage 1a contract 1a-5 (unit part): the shared parts render the structure they promise (roles, aria, text
// next to icons, data-testid pass-through, content kept in the DOM). Server-side render only (no browser here); the
// behaviour (keys, focus, sheets) is covered by e2e/sprint12g-1a.spec.ts.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { APP_ICON_PROPOSALS, DroneLineArt } from "./brand-marks";
import { DataTable } from "./data";
import { FormField, Toggle, TextInput } from "./forms";
import { Button, Card, Disclosure, EmptyState, NoticeBar, StatusPill, StatTile } from "./primitives";
import { Segmented, Tabs } from "./tabs";
import { MapPlaceholder, Workspace } from "./workspace";

const html = (el: Parameters<typeof renderToStaticMarkup>[0]): string => renderToStaticMarkup(el);
/** createElement without per-component prop typing (children are passed positionally in these tests). */
const h = (type: unknown, props?: unknown, ...children: unknown[]) => createElement(type as never, props as never, ...(children as never[]));

describe("バッジ・ステータスのピル", () => {
  it("5 つの意味はどれもアイコン（形）＋文言＋色。data-testid を透過する", () => {
    const icons = new Set<string>();
    for (const m of ["ok", "warn", "danger", "info", "neutral"] as const) {
      const out = html(h(StatusPill, { meaning: m, "data-testid": `pill-${m}` }, "文言"));
      expect(out).toContain("<svg");
      expect(out).toContain("文言");
      expect(out).toContain(`data-testid="pill-${m}"`);
      expect(out).toContain(`data-meaning="${m}"`);
      icons.add(out.match(/<svg[\s\S]*?<\/svg>/)![0]);
    }
    expect(icons.size).toBe(5);
  });
});

describe("ボタン", () => {
  it("読み込み中は aria-busy と aria-disabled。属性を透過する。type は既定で button", () => {
    const out = html(h(Button, { loading: true, "data-testid": "b" }, "保存"));
    expect(out).toContain('aria-busy="true"');
    expect(out).toContain('aria-disabled="true"');
    expect(out).toContain('data-testid="b"');
    expect(out).toContain('type="button"');
  });
});

describe("注意バー・折りたたみ・空の状態", () => {
  it("注意バーは role=note で、中身は常に DOM にある（折りたたみに入れない）", () => {
    const out = html(h(NoticeBar, { meaning: "info", "data-testid": "n" }, "固定の注意書き"));
    expect(out).toContain('role="note"');
    expect(out).toContain("固定の注意書き");
    expect(out).not.toContain("<details");
  });
  it("折りたたみは <details>。閉じた状態でも中身は DOM に残る", () => {
    const out = html(h(Disclosure, { summary: "説明" }, "長い説明"));
    expect(out).toContain("<details");
    expect(out).not.toContain("<details open");
    expect(out).toContain("長い説明");
  });
  it("空の状態：見出し・説明・操作", () => {
    const out = html(h(EmptyState, { title: "まだありません", action: h(Button, null, "作成") }, "説明"));
    expect(out).toContain("まだありません");
    expect(out).toContain("説明");
    expect(out).toContain("作成");
  });
  it("カードは 3 種、統計タイルはリンクにできる", () => {
    for (const v of ["primary", "standard", "inset"] as const) expect(html(h(Card, { variant: v }, "x"))).toContain(`data-card="${v}"`);
    const tile = html(h(StatTile, { label: "次にやること", value: 3, unit: "件", status: "期限が近い", meaning: "warn", href: "#x" }));
    expect(tile).toContain('href="#x"');
    expect(tile).toContain("期限が近い");
  });
});

describe("フォーム部品", () => {
  it("必須は文字「必須」。エラーは入力のすぐ下で id でつながる。トグルは role=switch", () => {
    const out = html(
      h(FormField, { id: "x", label: "名称", required: true, error: "入力してください", hint: "補足" }, h(TextInput, { id: "x", invalid: true, "aria-describedby": "x-hint x-error" })),
    );
    expect(out).toContain("必須");
    expect(out).toContain('id="x-error"');
    expect(out).toContain('id="x-hint"');
    expect(out).toContain('aria-invalid="true"');
    expect(out).toContain('for="x"');
    const t = html(h(Toggle, { checked: true, label: "通知", "data-testid": "t" }));
    expect(t).toContain('role="switch"');
    expect(t).toContain('aria-checked="true"');
  });
});

describe("タブ・セグメント", () => {
  it("タブは tablist / tab / aria-selected / aria-controls。選択中だけ tabindex=0", () => {
    const out = html(h(Tabs, { idPrefix: "p", label: "見本", value: "b", onChange: () => {}, tabs: [{ id: "a", label: "A" }, { id: "b", label: "B" }] }));
    expect(out).toContain('role="tablist"');
    expect(out.match(/role="tab"/g)).toHaveLength(2);
    expect(out).toMatch(/aria-selected="true"[^>]*aria-controls="p-panel-b"[^>]*tabindex="0"/);
    expect(out).toMatch(/aria-selected="false"[^>]*aria-controls="p-panel-a"[^>]*tabindex="-1"/);
  });
  it("セグメントは radiogroup の中の radio", () => {
    const out = html(h(Segmented, { label: "表示", value: "a", onChange: () => {}, options: [{ id: "a", label: "A" }, { id: "b", label: "B" }] }));
    expect(out).toContain('role="radiogroup"');
    expect(out.match(/role="radio"/g)).toHaveLength(2);
  });
});

describe("データテーブル", () => {
  type R = { id: string; name: string; n: number };
  const rows: R[] = [{ id: "1", name: "B", n: 2 }, { id: "2", name: "A", n: 1 }];
  const columns = [
    { key: "name", header: "名称", primary: true, cell: (r: R) => r.name, sortValue: (r: R) => r.name },
    { key: "n", header: "数", cell: (r: R) => r.n, sortValue: (r: R) => r.n },
    { key: "x", header: "備考", cell: () => "-" },
  ];
  it("並べ替えは aria-sort（並べ替えられる列だけ）。既定の並びを反映。行全体のリンクと、積み重ね用のラベル", () => {
    const out = html(h(DataTable<R>, { caption: "一覧", columns, rows, rowKey: (r: R) => r.id, rowHref: (r: R) => `#r${r.id}`, defaultSort: { key: "name", dir: "asc" }, "data-testid": "tbl" }));
    expect(out).toContain('aria-sort="ascending"');
    expect(out).toContain('aria-sort="none"');
    expect(out.match(/aria-sort=/g)).toHaveLength(2);
    expect(out).toContain("<caption");
    expect(out.indexOf("#r2")).toBeLessThan(out.indexOf("#r1"));
    expect(out).toContain("ds-table-link");
    expect(out).toContain('data-label="数"');
  });
  it("読み込み中は骨組み、空は空の状態", () => {
    const loading = html(h(DataTable<R>, { caption: "c", columns, rows: [], rowKey: (r: R) => r.id, loading: true }));
    expect(loading).toContain("ds-skeleton");
    const empty = html(h(DataTable<R>, { caption: "c", columns, rows: [], rowKey: (r: R) => r.id, empty: h(EmptyState, { title: "ありません" }) }));
    expect(empty).toContain("ありません");
    expect(empty).not.toContain("<table");
  });
});

describe("ワークスペース", () => {
  it("入力・結果・地図・シートの見出し（結論）がすべて DOM にある。ペインの端のトグルは aria-expanded / aria-controls", () => {
    const out = html(
      h(Workspace, {
        map: h(MapPlaceholder),
        input: h("div", { id: "in-marker" }, "入力の中身"),
        result: h("div", { id: "res-marker" }, "結果の中身"),
        peek: "結論：要手続き",
        "data-testid": "ws",
      }),
    );
    expect(out).toContain("入力の中身");
    expect(out).toContain("結果の中身");
    expect(out).toContain("結論：要手続き");
    expect(out).toContain('data-testid="workspace-peek"');
    expect(out).toContain('data-sheet-stage="peek"');
    expect(out).toMatch(/data-testid="workspace-toggle-left"/);
    expect(out).toMatch(/aria-expanded="true"/);
    expect(out).toContain('role="tablist"');
    expect(out.match(/role="tab"/g)).toHaveLength(3);
  });
});

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
