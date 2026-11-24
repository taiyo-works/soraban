import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BACK_TABLE, BACK_TO, BOTTOM_TABS, currentChildKey, currentChildParent, currentNavKey, FIELD_BACK, NAV_CHILDREN, NAV_GROUPS, NAV_ITEM, navHiddenOn, SIDE_ITEMS, visibleChildrenOf, visibleNavChildren } from "./ops-nav-model";

const PLAN = "00000000-0000-4000-8000-000000000001";

describe("メニューの定義（Sprint 12g-1b 段階 A → 16-F で 4 項目）", () => {
  it("下タブは 4 つ：ホーム／計画／日誌／機体と書類（この順。判定も点検もない）。行き先（URL）は据え置き（F-1）", () => {
    expect(BOTTOM_TABS.map((i) => [i.label, i.href])).toEqual([
      ["ホーム", "/ops"],
      ["計画", "/ops/plans"],
      ["日誌", "/ops/journal"],
      ["機体と書類", "/ops/more"],
    ]);
    expect(BOTTOM_TABS.map((i) => i.key)).toEqual(["today", "plans", "journal", "more"]);
    expect(BOTTOM_TABS.map((i) => i.key)).not.toContain("verdict");
    expect(BOTTOM_TABS.map((i) => i.href)).not.toContain("/ops/inspections");
  });

  it("左メニューは ホーム／計画／日誌／機体と書類 と、区切りの下の判定（PC には判定が残る。F-3）", () => {
    expect(SIDE_ITEMS.map((i) => [i.label, i.href])).toEqual([
      ["ホーム", "/ops"],
      ["計画", "/ops/plans"],
      ["日誌", "/ops/journal"],
      ["機体と書類", "/ops/more"],
      ["判定", "/"],
    ]);
    // 下タブの項目は、すべて左メニューにもある（定義は 1 つ）
    for (const t of BOTTOM_TABS) expect(SIDE_ITEMS).toContain(t);
    expect(Object.keys(NAV_ITEM).sort()).toEqual(SIDE_ITEMS.map((i) => i.key).sort());
  });

  it("左メニューの区切り：ホーム・計画・日誌・機体と書類（見出しなし）、罫のあとに「調べる」＝判定。子は日誌＝飛行記録・点検・事故・ヒヤリハット、機体と書類＝機体・操縦者・許可・承認・地点", () => {
    expect(NAV_GROUPS.map((g) => [g.heading, g.keys])).toEqual([
      [null, ["today", "plans", "journal", "more"]],
      ["調べる", ["verdict"]],
    ]);
    // グループに出る項目は、左メニューの項目と同じ（漏れも重複もない）
    expect(NAV_GROUPS.flatMap((g) => g.keys)).toEqual(SIDE_ITEMS.map((i) => i.key));
    expect(NAV_CHILDREN.map((c) => [c.parent, c.label, c.href, c.key])).toEqual([
      ["journal", "飛行記録", "/ops/flights", "flights"],
      ["journal", "点検", "/ops/inspections", "inspections"],
      ["journal", "事故・ヒヤリハット", "/ops/incidents", "incidents"],
      ["more", "機体", "/ops/aircraft", "aircraft"],
      ["more", "操縦者", "/ops/pilots", "pilots"],
      ["more", "許可・承認", "/ops/permits", "permits"],
      ["more", "地点", "/ops/places", "places"],
    ]);
  });

  it("子項目の出し分けは authz.ts の閲覧の規則に従う（現行は全役割が見られる）。日誌の子と機体と書類の子は親で分かれる", () => {
    for (const role of ["manager", "pilot", "viewer"] as const) {
      expect(visibleChildrenOf("journal", role).map((c) => c.key), role).toEqual(["flights", "inspections", "incidents"]);
      expect(visibleChildrenOf("more", role).map((c) => c.key), role).toEqual(["aircraft", "pilots", "permits", "places"]);
      expect(visibleNavChildren(role).length, role).toBe(NAV_CHILDREN.length);
    }
  });

  it("現場モード・サインイン・アクセス権なしでは出さない", () => {
    expect(navHiddenOn(`/ops/plans/${PLAN}/field`)).toBe(true);
    expect(navHiddenOn(`/ops/plans/${PLAN}/field/`)).toBe(true);
    // Sprint 15：圏外用の現場の枠（現場の URL で返る）も現場モード
    expect(navHiddenOn("/ops/offline/field")).toBe(true);
    expect(navHiddenOn("/ops/offline/inspection")).toBe(false);
    expect(navHiddenOn("/ops/sign-in")).toBe(true);
    expect(navHiddenOn("/ops/no-access")).toBe(true);
    for (const p of ["/", "/ops", "/ops/plans", `/ops/plans/${PLAN}`, `/ops/plans/${PLAN}/report`, "/ops/journal", "/ops/more", "/ops/flights/new"]) {
      expect(navHiddenOn(p), p).toBe(false);
    }
  });

  it("現在地：日誌は飛行記録・日誌・点検（/ops/inspections*。F-2）・事故・ヒヤリハット、計画は /ops/plans*、機体と書類は機体・操縦者・許可・承認・地点・利用者も含む", () => {
    const cases: [string, string | null][] = [
      ["/", "verdict"],
      ["/ops", "today"],
      ["/ops/plans", "plans"],
      [`/ops/plans/${PLAN}`, "plans"],
      [`/ops/plans/${PLAN}/report`, "plans"],
      ["/ops/plans/new", "plans"],
      ["/ops/journal", "journal"],
      ["/ops/flights", "journal"],
      ["/ops/flights/new", "journal"],
      [`/ops/flights/${PLAN}`, "journal"],
      ["/ops/inspections", "journal"],
      ["/ops/inspections/new", "journal"],
      [`/ops/inspections/${PLAN}`, "journal"],
      ["/ops/more", "more"],
      ["/ops/aircraft", "more"],
      ["/ops/pilots/new", "more"],
      ["/ops/places", "more"],
      ["/ops/permits", "more"],
      ["/ops/permits/new", "more"],
      ["/ops/members", "more"],
      ["/somewhere-else", null],
    ];
    for (const [p, key] of cases) expect(currentNavKey(p), p).toBe(key);
  });

  it("`/` では下タブのどれも現在地にならない（判定は左メニューだけ）", () => {
    expect(currentNavKey("/")).toBe("verdict");
    expect(BOTTOM_TABS.some((t) => t.key === currentNavKey("/"))).toBe(false);
  });

  it("子項目の現在地：飛行記録・点検・事故・ヒヤリハット（日誌の子）と機体・操縦者・許可・承認・地点（機体と書類の子）。日誌・機体と書類の画面そのものでは子項目なし", () => {
    expect(currentChildKey("/ops/flights")).toBe("flights");
    expect(currentChildKey("/ops/flights/new")).toBe("flights");
    expect(currentChildKey("/ops/inspections")).toBe("inspections");
    expect(currentChildKey(`/ops/inspections/${PLAN}`)).toBe("inspections");
    expect(currentChildKey("/ops/incidents/new")).toBe("incidents");
    expect(currentChildParent("/ops/inspections/new")).toBe("journal");
    expect(currentChildParent("/ops/flights")).toBe("journal");
    expect(currentChildParent("/ops/permits")).toBe("more");
    expect(currentChildParent("/ops/journal")).toBeNull();
    expect(currentChildKey("/ops/aircraft")).toBe("aircraft");
    expect(currentChildKey(`/ops/aircraft/${PLAN}`)).toBe("aircraft");
    expect(currentChildKey("/ops/pilots/new")).toBe("pilots");
    expect(currentChildKey("/ops/permits")).toBe("permits");
    expect(currentChildKey("/ops/places")).toBe("places");
    for (const p of ["/ops/more", "/ops/members", "/ops/journal", "/ops", "/ops/aircraftx", "/ops/inspectionsx", "/ops/flightsx"]) expect(currentChildKey(p), p).toBeNull();
  });

  it("Sprint 12e → 12g-1b：事故・ヒヤリハットの画面は「日誌」が現在地（登録ではない）。現場の簡易記録では出さない", () => {
    expect(navHiddenOn(`/ops/plans/${PLAN}/field/incident`)).toBe(true);
    expect(navHiddenOn(`/ops/plans/${PLAN}/field/incident/`)).toBe(true);
    expect(navHiddenOn(`/ops/plans/${PLAN}/field/other`)).toBe(false);
    for (const p of ["/ops/incidents", "/ops/incidents/new", `/ops/incidents/${PLAN}`]) {
      expect(navHiddenOn(p), p).toBe(false);
      expect(currentNavKey(p), p).toBe("journal");
    }
  });
});

describe("戻りリンクの行き先の統一（A6）", () => {
  it("戻り先は「メニューで親になっている画面」：すべての画面で、戻り先の現在地＝いまの画面の現在地", () => {
    for (const row of BACK_TABLE) {
      if (row.back === null) continue;
      expect(currentNavKey(row.back.href), `${row.screen} → ${row.back.href}`).toBe(currentNavKey(row.screen));
    }
  });

  it("1 段目の画面（ホーム・計画・日誌・機体と書類）には戻りリンクを置かない", () => {
    for (const s of ["/ops", "/ops/plans", "/ops/journal", "/ops/more"]) {
      expect(BACK_TABLE.find((r) => r.screen === s)?.back, s).toBeNull();
    }
  });

  it("F-2：点検の一覧は日誌の下の画面。戻りリンクは「日誌」（戻り先とナビの現在地が一致）", () => {
    expect(BACK_TABLE.find((r) => r.screen === "/ops/inspections")?.back).toEqual({ href: "/ops/journal", label: "日誌" });
    expect(currentNavKey("/ops/inspections")).toBe("journal");
  });

  it("点検の新規・詳細の戻り先は点検の一覧（ラベルは「点検の一覧」。タブ名に合わせる）", () => {
    for (const s of ["/ops/inspections/new", `/ops/inspections/${PLAN}`]) {
      expect(BACK_TABLE.find((r) => r.screen === s)?.back, s).toEqual({ href: "/ops/inspections", label: "点検の一覧" });
    }
  });

  it("一覧の戻り先：機体と書類の下の一覧は機体と書類へ、飛行記録・点検・事故の一覧は日誌へ。現場モードの退路は「ホームへ戻る」", () => {
    for (const s of ["/ops/aircraft", "/ops/pilots", "/ops/permits", "/ops/places", "/ops/members"]) {
      expect(BACK_TABLE.find((r) => r.screen === s)?.back, s).toEqual(BACK_TO.register);
    }
    for (const s of ["/ops/flights", "/ops/inspections", "/ops/incidents"]) {
      expect(BACK_TABLE.find((r) => r.screen === s)?.back, s).toEqual(BACK_TO.journal);
    }
    expect(BACK_TO.register).toEqual({ href: "/ops/more", label: "機体と書類" });
    expect(BACK_TO.journal).toEqual({ href: "/ops/journal", label: "日誌" });
    expect(FIELD_BACK).toEqual({ href: "/ops", label: "ホームへ戻る" });
  });
});

describe("名称の統一（A5）：古い呼び名が画面のコードに残っていない", () => {
  const SRC = path.resolve(__dirname, "../..");
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) => {
      const p = path.join(dir, n);
      if (statSync(p).isDirectory()) return walk(p);
      return /\.(tsx?|ts)$/.test(n) && !/\.test\.ts$/.test(n) ? [p] : [];
    });
  // デザイン見本（app/ops/design）は、実画面ではないため対象外
  const files = [...walk(path.join(SRC, "app")), ...walk(path.join(SRC, "components")), ...walk(path.join(SRC, "lib"))].filter((f) => !f.includes(`${path.sep}catalog${path.sep}`));
  const BANNED = ["運航管理のトップ", "運航管理へ", "地点判定へ", "今日へ戻る", 'title="その他"', 'label: "その他"', 'label: "今日"'];

  it("「運航管理のトップ」「運航管理へ」「地点判定へ」「今日へ戻る」「その他」「今日」（メニューの名称）が画面に出ない", () => {
    expect(files.length).toBeGreaterThan(50);
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      // コメント行は対象外（画面に出る文字列だけを見る）
      const code = text
        .split("\n")
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
        .join("\n");
      for (const w of BANNED) expect(code.includes(w), `${path.relative(SRC, f)} に「${w}」がある`).toBe(false);
    }
  });
});

describe("アイコンの重複（M-6）", () => {
  it("メニューの 5 項目と子項目は、すべて別のアイコン（判定と地点、点検と日誌、操縦者と利用者を取り違えない）", () => {
    const icons = [...SIDE_ITEMS.map((i) => i.icon), ...NAV_CHILDREN.map((c) => c.icon)];
    expect(new Set(icons).size).toBe(icons.length);
  });
});
