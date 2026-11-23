import { randomUUID } from "node:crypto";
import { expect, request as pwRequest, test, type APIRequestContext, type Page } from "@playwright/test";
import { expectNoHorizontalScroll, expectTextZoom, waitForSettledStyles } from "../field-checks";
import { gotoPlan } from "./plan-screen";

// Sprint 16-C の E2E-DB：部品 1 の実画面（契約 C-2・C-6、K-8、持ち越し 1〜3）。
// 見本の上の検査（C-1・C-3・C-4）は e2e/sprint16-c.spec.ts。ここは運航管理の実画面と、ログインした状態の `/`。
const BASE = `http://127.0.0.1:${process.env["E2E_OPS_PORT"] ?? 3300}`;
const stamp = Date.now().toString(36).toUpperCase();
const DAY = "2027-01-05";

type Who = { readonly authUserId: string; readonly email: string };
const seeded = (key: string): Who => ({ authUserId: key, email: `${key}@example.test` });
const signIn = async (ctx: APIRequestContext, who: Who): Promise<void> => {
  const r = await ctx.post("/api/test-auth/sign-in", { data: { authUserId: who.authUserId, email: who.email, emailVerified: true, name: who.authUserId } });
  expect(r.status()).toBe(200);
};

let planId = "";
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

test.beforeAll(async () => {
  const manager = await pwRequest.newContext({ baseURL: BASE });
  await signIn(manager, seeded("a-manager"));
  const pilot = await pwRequest.newContext({ baseURL: BASE });
  await signIn(pilot, seeded("a-pilot"));
  const me = (await (await pilot.get("/api/ops/me")).json()) as { pilotId: string };
  const mark = `JU16C${stamp}`.slice(0, 20);
  const ac = await manager.post("/api/ops/aircraft", { data: { registrationMark: mark, modelName: "部品の試験機", manufacturer: "DJI", serialNumber: `SN-${mark}`, typeCertified: false, initialFlightMinutes: 0, maxTakeoffWeightKg: 0.9 } });
  expect(ac.status(), await ac.text()).toBe(201);
  const aircraftId = ((await ac.json()) as { id: string }).id;
  const plan = await manager.post("/api/ops/plans", { data: { title: `部品の確認 ${stamp}`, aircraftId, pilotId: me.pilotId, plannedStartAt: `${DAY}T13:00`, durationMinutes: 60, purpose: "空撮", placeName: "試験地点", latitude: 35.434238, longitude: 133.380508, flags: [] } });
  expect(plan.status(), await plan.text()).toBe(201);
  planId = ((await plan.json()) as { id: string }).id;
  await pilot.post(`/api/ops/plans/${planId}/field-events`, { data: { clientEventId: randomUUID(), occurredAt: `${DAY}T12:00`, kind: "takeoff" } });
  await manager.dispose();
  await pilot.dispose();
});

type PrimaryStyle = { bg: string; color: string; h: number; radius: string; fw: string; fs: string; bw: string; bs: string; bc: string; outline: string };
const styleOf = (page: Page, selector: string): Promise<PrimaryStyle> =>
  page.locator(selector).first().evaluate((el) => {
    (el as HTMLElement).focus();
    const c = getComputedStyle(el);
    return { bg: c.backgroundColor, color: c.color, h: Math.round(el.getBoundingClientRect().height * 10) / 10, radius: c.borderTopLeftRadius, fw: c.fontWeight, fs: c.fontSize, bw: c.borderTopWidth, bs: c.borderTopStyle, bc: c.borderTopColor, outline: `${c.outlineStyle} ${c.outlineWidth} ${c.outlineColor} ${c.outlineOffset}` };
  });

test.describe("C-2 実画面：`/` の .sb-pill-primary と `/ops` の .opx-btn-primary は同じ計算スタイル", () => {
  test("面・文字・高さ・角丸・太さ・縁・フォーカスの輪が一致する。丸と矢印がない", async ({ page }) => {
    // 未ログインの `/`（判定する＝主、56px）で測る。ログイン済みで結果があると主は「この判定で飛行計画を作る」（48px）に替わる（K-8、gen2）
    await page.goto("/");
    await page.locator(".sb-pill-primary:not(:disabled)").first().waitFor();
    await waitForSettledStyles(page);
    const pub = await styleOf(page, ".sb-pill-primary:not(:disabled)");
    await signIn(page.request, seeded("a-manager"));
    await page.goto("/ops/plans");
    await expect(page.getByTestId("plan-new-link")).toBeVisible();
    await waitForSettledStyles(page);
    const ops = await styleOf(page, ".opx-btn-primary");
    expect(pub.bg).toBe("rgb(31, 95, 224)");
    expect(pub.color).toBe("rgb(255, 255, 255)");
    expect(pub.h).toBeGreaterThanOrEqual(55.5);
    expect(pub.radius).toBe("12px");
    expect(pub.outline).toContain("solid 3px");
    expect(ops).toEqual(pub);
    const deco = await page.locator(".opx-btn-primary").first().evaluate((el) => ({ before: getComputedStyle(el, "::before").content, after: getComputedStyle(el, "::after").content, kids: el.children.length }));
    expect(deco.before).toMatch(/^(none|normal)$/);
    expect(deco.after).toMatch(/^(none|normal)$/);
  });
});

/** 持ち越し 1：全幅の主ボタンで、文字が見え、余計な装飾（丸・矢印）が重ならない。 */
const expectCleanFullWidthPrimary = async (page: Page, testId: string, label: string): Promise<void> => {
  const btn = page.getByTestId(testId).first();
  await expect(btn, label).toBeVisible();
  const r = await btn.evaluate((el) => {
    const c = getComputedStyle(el);
    const range = document.createRange();
    range.selectNodeContents(el);
    const t = range.getBoundingClientRect();
    const b = el.getBoundingClientRect();
    const pe = el.parentElement!;
    const pcs = getComputedStyle(pe);
    const parent = { width: pe.clientWidth - parseFloat(pcs.paddingLeft) - parseFloat(pcs.paddingRight) };
    return {
      w: b.width, parentW: parent.width, text: (el.textContent ?? "").trim(), before: getComputedStyle(el, "::before").content, after: getComputedStyle(el, "::after").content,
      kids: el.querySelectorAll("svg, .sb-pill-arrow").length, textInside: t.left >= b.left - 0.5 && t.right <= b.right + 0.5 && t.top >= b.top - 0.5 && t.bottom <= b.bottom + 0.5,
      textCx: (t.left + t.right) / 2, btnCx: (b.left + b.right) / 2, color: c.color, bg: c.backgroundColor, display: c.display, visibility: c.visibility,
    };
  });
  expect(r.text.length, label).toBeGreaterThan(0);
  expect(r.w, `${label}: 全幅`).toBeGreaterThanOrEqual(r.parentW - 1);
  expect(r.textInside, `${label}: 文字が枠の中に見える`).toBe(true);
  expect(Math.abs(r.textCx - r.btnCx), `${label}: 文字が面の中央（丸の分の偏りがない）`).toBeLessThanOrEqual(1.5);
  expect(r.before, label).toMatch(/^(none|normal)$/);
  expect(r.after, label).toMatch(/^(none|normal)$/);
  expect(r.kids, `${label}: 丸・矢印の要素がない`).toBe(0);
  expect(r.color).toBe("rgb(255, 255, 255)");
  expect(r.bg).toBe("rgb(31, 95, 224)");
};

test.describe("持ち越し 1：全幅の主ボタン（ホーム「計画を開く」・日誌「飛行記録を入力」）", () => {
  test("ホームの today-card-primary（390・全幅）", async ({ page }) => {
    await signIn(page.request, seeded("a-manager"));
    await page.goto("/ops");
    await expect(page.getByTestId("today-heading")).toBeVisible();
    await waitForSettledStyles(page);
    const has = await page.getByTestId("today-card-primary").count();
    test.skip(has === 0, "今日の計画がないので、ホームの全幅の主ボタンは出ない（日誌の側で確かめる）");
    await expectCleanFullWidthPrimary(page, "today-card-primary", "ホーム「計画を開く」");
  });

  test("日誌の journal-new-flight（390・全幅）", async ({ page }) => {
    await signIn(page.request, seeded("a-manager"));
    await page.goto("/ops/journal");
    await expect(page.getByTestId("journal-new-flight")).toBeVisible();
    await waitForSettledStyles(page);
    await expectCleanFullWidthPrimary(page, "journal-new-flight", "日誌「飛行記録を入力」");
  });

  test("計画の主画面の plan-primary-action（390・全幅）", async ({ page }) => {
    await signIn(page.request, seeded("a-manager"));
    await page.goto(`/ops/plans/${planId}`);
    await expect(page.getByTestId("plan-primary-action")).toBeVisible();
    await waitForSettledStyles(page);
    await expectCleanFullWidthPrimary(page, "plan-primary-action", "計画の主画面の主ボタン");
  });
});

test.describe("C-6 / K-8 主ボタンは 1 画面に 1 つ（data-variant=\"primary\"）", () => {
  const SCREENS = [
    { name: "ホーム", path: "/ops", ready: "today-heading" },
    { name: "計画の一覧", path: "/ops/plans", ready: "plan-count" },
    { name: "点検の一覧", path: "/ops/inspections", ready: "inspection-new" },
    { name: "日誌", path: "/ops/journal", ready: "journal-new-flight" },
  ] as const;
  for (const s of SCREENS) {
    for (const w of [375, 390, 1280]) {
      test(`${s.name} ${w}px：見えている data-variant="primary" は 1 つ。クラスだけの主ボタンは無い`, async ({ page }) => {
        await signIn(page.request, seeded("a-manager"));
        await page.setViewportSize({ width: w, height: w >= 1024 ? 800 : 844 });
        await page.goto(s.path);
        await expect(page.getByTestId(s.ready).first()).toBeVisible();
        await waitForSettledStyles(page);
        const n = await page.locator('[data-variant="primary"]:visible').count();
        expect(n, `${s.name} ${w}px`).toBe(1);
        const stray = await page.locator(".opx-btn-primary:not([data-variant]):not(.opx-btn-flat), .sb-pill-primary:not([data-variant])").evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().width > 0).length);
        expect(stray, "data-variant の付いていない主ボタン").toBe(0);
      });
    }
  }

  test("ホームに今日の計画がある状態でも 1 つ（計画を開く）", async ({ page }) => {
    await signIn(page.request, seeded("a-manager"));
    await page.goto("/ops");
    await expect(page.getByTestId("today-heading")).toBeVisible();
    await waitForSettledStyles(page);
    expect(await page.locator('[data-variant="primary"]:visible').count()).toBe(1);
  });
});

test.describe("K-8 ログイン済み・判定結果ありの `/`：主ボタンは 1 つ（この判定で飛行計画を作る）", () => {
  for (const w of [375, 390, 1280]) {
    test(`${w}px：見えている data-variant="primary" は 1 つで、判定するは副`, async ({ page }) => {
      await signIn(page.request, seeded("a-manager"));
      await page.setViewportSize({ width: w, height: w >= 1024 ? 800 : 844 });
      await page.goto("/");
      await expect(page.getByTestId("verdict-level")).toBeVisible({ timeout: 60_000 });
      const plan = page.getByTestId("create-plan-from-verdict");
      await expect(plan).toBeVisible();
      await waitForSettledStyles(page);
      expect(await page.locator('[data-variant="primary"]:visible').count(), `${w}px`).toBe(1);
      await expect(plan).toHaveAttribute("data-variant", "primary");
      // 16-C 差し戻し 1：主は標準寸法（高さ 56 以上・文字 16px 以上）。副の「判定する」より小さく見えない
      const pb = (await plan.boundingBox())!;
      expect(pb.height, `${w}px：主の高さ`).toBeGreaterThanOrEqual(55.5);
      expect(await plan.evaluate((e) => parseFloat(getComputedStyle(e).fontSize)), `${w}px：主の文字`).toBeGreaterThanOrEqual(16);
      const sb = (await page.locator('button[type="submit"].sb-pill:visible').first().boundingBox())!;
      expect(pb.height, `${w}px：主は副より小さくない`).toBeGreaterThanOrEqual(sb.height);
      const submit = page.locator('button[type="submit"].sb-pill:visible').first();
      await expect(submit).toHaveClass(/sb-pill-secondary/);
      await expect(submit).not.toHaveAttribute("data-variant", "primary");
      const stray = await page.locator(".sb-pill-primary:not([data-variant])").count();
      expect(stray).toBe(0);
    });
  }
});

test.describe("持ち越し 2：札の記号と文字の縦の中心（±1px）", () => {
  test("計画の一覧の plan-state・plan-report の札", async ({ page }) => {
    await signIn(page.request, seeded("a-manager"));
    await page.goto("/ops/plans");
    await expect(page.getByTestId("plan-count")).toBeVisible();
    await waitForSettledStyles(page);
    const rows = await page.evaluate(() => {
      const out: { id: string; dy: number; text: string }[] = [];
      for (const el of Array.from(document.querySelectorAll<HTMLElement>('[data-testid="plan-state"], [data-testid="plan-report"]'))) {
        const glyph = el.firstElementChild as HTMLElement | null;
        const textNode = Array.from(el.childNodes).find((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim());
        if (!glyph || !textNode) continue;
        const gr = document.createRange();
        gr.selectNodeContents(glyph);
        const g = gr.getBoundingClientRect();
        const tr = document.createRange();
        tr.selectNodeContents(textNode);
        const rects = tr.getClientRects();
        const first = rects[0]!;
        // 1 行目の文字の中心と、記号の中心
        out.push({ id: el.getAttribute("data-testid")!, dy: Math.abs(g.top + g.height / 2 - (first.top + first.height / 2)), text: (textNode.textContent ?? "").trim().slice(0, 12) });
      }
      return out;
    });
    expect(rows.length, "札が 1 つも無い").toBeGreaterThan(0);
    for (const r of rows) expect(r.dy, `${r.id}「${r.text}」の記号と文字の縦の中心`).toBeLessThanOrEqual(1);
  });
});

test.describe("持ち越し 3：運航管理にログインした状態の `/`（K-5 文字 200%）", () => {
  test("`/` を 390・430 幅・文字 200% にしても横スクロールがない（入口の丸い矢印が無い）", async ({ page }) => {
    await signIn(page.request, seeded("a-manager"));
    await page.goto("/");
    await expect(page.getByTestId("home-ops-link")).toBeVisible();
    await waitForSettledStyles(page);
    await expectNoHorizontalScroll(page, "ログイン状態の /（等倍）");
    await expectTextZoom(page, "ログイン状態の /");
    const arrows = await page.locator(".sb-pill-arrow").count();
    expect(arrows).toBe(0);
  });
});

test.describe("16-C 差し戻し 1：文字 200%（390・430）で切れ・横スクロールがない 2 画面", () => {
  test("計画の主画面（plan-digest の判定を見る・計画の確認へ）", async ({ page }) => {
    await signIn(page.request, seeded("a-manager"));
    await gotoPlan(page, `/ops/plans/${planId}`);
    await expect(page.getByTestId("plan-digest").first()).toBeAttached();
    await waitForSettledStyles(page);
    await expectTextZoom(page, "計画の主画面");
    // 評価の計画は判定の行が長かった（札が増える）。実画面の札（判定の札・確認の札）を複製して左に並べる。折り返せない 1 語は入れない。
    await page.evaluate(() => {
      const left = (a: Element | null): HTMLElement | null => a?.querySelector<HTMLElement>(":scope > span:first-child") ?? null;
      const hosts = [left(document.querySelector('[data-testid="plan-digest"] [data-testid="plan-judge-link"]')), left(document.querySelector('[data-testid="plan-digest"] [data-testid="plan-confirm-link"]'))];
      for (const host of hosts) {
        if (!host) continue;
        const kids = Array.from(host.children).slice(1);
        for (let i = 0; i < 3; i++) for (const k of kids) host.appendChild(k.cloneNode(true));
        const note = document.createElement("span");
        note.className = "text-sm text-sb-ink-2";
        note.textContent = "判定の根拠が古い可能性があります（出典の更新を確認）";
        host.appendChild(note);
      }
    });
    await expectTextZoom(page, "計画の主画面（plan-digest の左を長くした）");
    // expectTextZoom は「直接の文字を持つ要素」の切れしか見ない。切れる入れ物は plan-digest（nav）自身なので、直接測る（差し戻し 1 再評価）。
    for (const w of [390, 430]) {
      await page.setViewportSize({ width: w, height: 844 });
      await page.evaluate(() => {
        document.documentElement.style.fontSize = "200%";
      });
      await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
      const m = await page.evaluate(() => {
        const nav = document.querySelector<HTMLElement>('[data-testid="plan-digest"]')!;
        const nr = nav.getBoundingClientRect();
        const links = Array.from(nav.querySelectorAll<HTMLElement>("a")).map((a) => {
          const r = a.getBoundingClientRect();
          const tailEl = a.querySelector<HTMLElement>(":scope > span:last-child")!;
          return { id: a.getAttribute("data-testid"), right: r.right, tailRight: tailEl.getBoundingClientRect().right, tailText: tailEl.textContent };
        });
        return { sw: nav.scrollWidth, cw: nav.clientWidth, navRight: nr.right, links };
      });
      await page.evaluate(() => {
        document.documentElement.style.fontSize = "";
      });
      expect(m.links.length, `${w}px: リンクが無い`).toBeGreaterThanOrEqual(2);
      expect(m.sw, `${w}px 200%: plan-digest の scrollWidth ${m.sw} > clientWidth ${m.cw}（nav が切れている）`).toBeLessThanOrEqual(m.cw + 1);
      for (const l of m.links) {
        expect(l.right, `${w}px 200%: ${l.id} の右端が nav の外`).toBeLessThanOrEqual(m.navRight + 1);
        expect(l.tailRight, `${w}px 200%: ${l.id}「${l.tailText}」の右端が nav の枠の外`).toBeLessThanOrEqual(m.navRight + 1);
      }
    }
  });
  test("登録（場所）/ops/places（place-row-name）", async ({ page }) => {
    await signIn(page.request, seeded("a-manager"));
    await page.goto("/ops/places");
    await expect(page.getByTestId("place-row-name").first()).toBeVisible();
    await waitForSettledStyles(page);
    await expectTextZoom(page, "/ops/places");
  });
});
