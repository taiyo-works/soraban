// Sprint 12g stage 1a contract 1a-5 (unit part): the shared parts render the structure they promise (roles, aria, text
// next to icons, data-testid pass-through, content kept in the DOM). Server-side render only (no browser here); the
// behaviour (keys, focus, sheets) is covered by e2e/sprint12g-1a.spec.ts.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { APP_ICON_PROPOSALS, DroneLineArt } from "./brand-marks";
import { DataTable } from "./data";
import { JourneyLine, stagesFromDone } from "./journey-line";
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
  it("ラベルが枠の中で折り返し、最小の幅を持ち、ピル型・影・拡大を使わない", () => {
    for (const size of ["md", "sm"] as const) {
      const cls = html(h(Button, { size }, "長いラベル")).match(/class="([^"]*)"/)![1]!.split(/\s+/);
      expect(cls, size).toEqual(expect.arrayContaining(["max-w-full", "[text-wrap:balance]", "[overflow-wrap:anywhere]", "leading-snug"]));
      expect(cls, size).not.toContain("whitespace-nowrap");
      expect(cls.some((c) => c.startsWith("min-w-")), size).toBe(true);
      expect(cls.some((c) => c.startsWith("shadow") || c.includes("scale") || c.includes("rounded-pill")), size).toBe(false);
    }
    // the icon-only size is not stretched to the label minimum
    expect(html(h(Button, { size: "icon" }, "x"))).not.toMatch(/min-w-(20|28)/);
  });
  it("押下は拡大でなく濃い地と 1px のずれ。無効の控えめボタンには破線の罫がある", () => {
    const primary = html(h(Button, { variant: "primary" }, "保存"));
    expect(primary).toContain("enabled:act:translate-y-px");
    expect(primary).toContain("enabled:act:bg-[");
    const quiet = html(h(Button, { variant: "quiet" }, "あとで"));
    expect(quiet).toContain("disabled:border-dashed");
    expect(quiet).toContain("aria-disabled:border-dashed");
  });
});

describe("入力欄", () => {
  it("内側の影と発光する枠を使わず、ピル型にしない。ラベルは欄の前にある。必須は文字の印", () => {
    const out = html(h(FormField, { id: "f", label: "機体の登録記号", required: true, error: "形式が違います" }, h(TextInput, { id: "f", invalid: true })));
    expect(out.indexOf("機体の登録記号")).toBeLessThan(out.indexOf("<input"));
    expect(out).toContain("必須");
    const input = out.match(/<input[^>]*class="([^"]*)"/)![1]!;
    expect(input).not.toMatch(/shadow|rounded-pill/);
    expect(input).toContain("rounded-ctl");
    expect(input).toContain("border-line-strong");
    expect(out).not.toContain("rounded-pill");
  });
});

describe("判定の印", () => {
  it("記号と言葉が付き、色だけで区別しない。回転・影を使わない", async () => {
    const { VerdictStamp } = await import("./verdict-stamp");
    const levels = ["no_fly", "needs_procedure", "procedure_done", "no_procedure", "unknown"] as const;
    const shapes = new Set<string>();
    for (const level of levels) {
      const out = html(h(VerdictStamp, { level, "data-testid": `stamp-${level}` }));
      expect(out).toContain("<svg");
      expect(out).toContain(`data-level="${level}"`);
      expect(out).toContain(`data-testid="stamp-${level}"`);
      expect(out).not.toMatch(/rotate|shadow|rounded-pill/);
      shapes.add(out.match(/data-shape="([^"]+)"/)![1]!);
    }
    expect(shapes.size).toBe(5);
    expect(html(h(VerdictStamp, { level: "no_fly" }))).toContain("飛行不可");
    expect(html(h(VerdictStamp, { level: "procedure_done" }))).toContain("手続き済み（条件付き）");
    expect(html(h(VerdictStamp, { level: "unknown" }))).toContain("判定不能");
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

describe("行程の 1 行（Sprint 12g-1b A8）", () => {
  const stages = [
    { label: "判定", state: "done" },
    { label: "計画", state: "next" },
    { label: "確認", state: "todo" },
    { label: "通報", state: "skip", stateLabel: "対象外" },
  ] as const;

  it("各段は文字（名前と 済／次／未／対象外）と印で示し、色（罫線）は補助。段の数だけ列を作る", () => {
    const out = html(h(JourneyLine, { stages }));
    expect(out).toContain('data-testid="route"');
    expect(out).toContain('aria-label="行程"');
    expect(out.match(/data-stage-state="/g)).toHaveLength(4);
    for (const t of ["判定", "計画", "確認", "通報", "済", "次", "未", "対象外"]) expect(out).toContain(t);
    // 済は check、次は chevron の印。未は空きだけ（文字が伝える）
    expect(out.match(/<svg/g)).toHaveLength(2);
    expect(out).toContain("grid-template-columns:repeat(4, minmax(0, 1fr))");
  });

  it("段の名前と状態は折り返さず、12px 未満の文字を使わない（text-aux = 12px、text-table = 13px 以上）", () => {
    const out = html(h(JourneyLine, { stages, compact: true }));
    expect(out).toContain("whitespace-nowrap");
    expect(out).not.toMatch(/text-\[(9|10|11)px\]|text-xs/);
  });

  it("見本用：済の段数から作る（済の次が「次」、先は「未」）。「次」の文言を変えられる", () => {
    expect(stagesFromDone(["a", "b", "c"], 1).map((s) => s.state)).toEqual(["done", "next", "todo"]);
    expect(stagesFromDone(["a", "b", "c"], 1, "いま")[1]?.stateLabel).toBe("いま");
  });
});
