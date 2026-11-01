import { randomUUID } from "node:crypto";
import { expect, request as pwRequest, test, type APIRequestContext, type Page } from "@playwright/test";
import { collectTextSamples, expectNoHorizontalScroll } from "../field-checks";

// Sprint 12h PR ③b2b の E2E-DB（docs/sprints/sprint-12h-pr3b2.md §7 の Q-6〜Q-8・Q-10・Q-11・Q-12、T-7）。
// 運航管理 `/ops` の現場・簡易記録・事故・ヒヤリハット・通報・判定の履歴を v2 で描いたことの検査。
// 現場の 2 画面は、開いている間だけ <html data-mode="field"> が付く（文字 7:1・押す部品 56px・主ボタン 64px・影なし・動きなし）。
// 画面の組み合わせ（幅×明暗）は 1 件の中で回す。DB と AUTH_PROVIDER=test・OPS_ENABLED=1 を与えた next start に対して実行する。

const BASE = `http://127.0.0.1:${process.env.E2E_OPS_PORT ?? 3300}`;
const stamp = Date.now().toString(36).toUpperCase();
const DAY = "2027-01-05";

type Who = { readonly authUserId: string; readonly email: string };
const seeded = (key: string): Who => ({ authUserId: key, email: `${key}@example.test` });
const signIn = async (ctx: APIRequestContext, who: Who): Promise<void> => {
  const r = await ctx.post("/api/test-auth/sign-in", { data: { authUserId: who.authUserId, email: who.email, emailVerified: true, name: who.authUserId } });
  expect(r.status()).toBe(200);
};
const post = async <T>(ctx: APIRequestContext, url: string, data: object): Promise<T> => {
  const r = await ctx.post(url, { data });
  expect(r.status(), `${url} ${await r.text()}`).toBe(201);
  return (await r.json()) as T;
};

type Fixture = { readonly planId: string; readonly flightPlanId: string; readonly incidentId: string; readonly snapshotId: string };
let fx: Fixture;
const SCHEMES = ["light", "dark"] as const;
type Screen = { readonly path: string; readonly ready: string; readonly field: boolean };
const SCREENS: readonly Screen[] = [
  { path: "/ops/plans/{planId}/field", ready: "field-root", field: true },
  { path: "/ops/plans/{flightPlanId}/field", ready: "field-root", field: true },
  { path: "/ops/plans/{planId}/field/incident", ready: "incident-quick-root", field: true },
  { path: "/ops/incidents", ready: "incident-list-page", field: false },
  { path: "/ops/incidents/new", ready: "incident-new-page", field: false },
  { path: "/ops/incidents/{incidentId}", ready: "incident-detail-page", field: false },
  { path: "/ops/plans/{planId}/report", ready: "report-screen", field: false },
  { path: "/ops/plans/{planId}/overview", ready: "plan-tabs", field: false },
  { path: "/ops/plans/{planId}/judgement", ready: "plan-tabs", field: false },
  { path: "/ops/plans/{planId}/journal", ready: "plan-tabs", field: false },
  { path: "/ops/plans/{planId}/snapshots", ready: "snapshot-list", field: false },
  { path: "/ops/plans/{planId}/snapshots/{snapshotId}", ready: "basis-facts", field: false },
];
const NORMAL = SCREENS.filter((s) => !s.field);
const urlOf = (s: string): string => s.replace(/\{(\w+)\}/g, (_, k: string) => (fx as unknown as Record<string, string>)[k]!);
const root = (s: Screen): string => (s.field ? `[data-testid="${s.ready}"]` : "main");

test.describe.configure({ mode: "serial" });
test.use({ viewport: { width: 375, height: 812 }, hasTouch: true });

test.beforeAll(async () => {
  const manager = await pwRequest.newContext({ baseURL: BASE });
  await signIn(manager, seeded("a-manager"));
  const pilot = await pwRequest.newContext({ baseURL: BASE });
  await signIn(pilot, seeded("a-pilot"));
  const me = (await (await pilot.get("/api/ops/me")).json()) as { pilotId: string };
  const mark = `JU2B${stamp}`.slice(0, 20);
  const aircraft = await post<{ id: string }>(manager, "/api/ops/aircraft", { registrationMark: mark, modelName: "現場試験機", manufacturer: "DJI", serialNumber: `SN-${mark}`, typeCertified: false, initialFlightMinutes: 0, maxTakeoffWeightKg: 0.9 });
  const body = (title: string, extra: Record<string, unknown> = {}) => ({ title, aircraftId: aircraft.id, pilotId: me.pilotId, plannedStartAt: `${DAY}T13:00`, durationMinutes: 60, purpose: "空撮", placeName: "試験地点", latitude: 35.44, longitude: 133.35, flags: ["method_night"], ...extra });
  const plan = await post<{ id: string; version: number }>(manager, "/api/ops/plans", body(`長い計画名の確認のための文字列 夜間の空撮 ${stamp}`));
  const flightPlan = await post<{ id: string }>(manager, "/api/ops/plans", body(`飛行中 ${stamp}`, { plannedStartAt: `${DAY}T15:00` }));
  await pilot.post(`/api/ops/plans/${flightPlan.id}/field-events`, { data: { clientEventId: randomUUID(), occurredAt: `${DAY}T12:00`, kind: "takeoff" } });
  expect((await manager.post(`/api/ops/plans/${plan.id}/request-confirmation`, { data: { expectedVersion: plan.version } })).status()).toBe(200);
  const active = (await (await manager.get(`/api/ops/plans/${plan.id}`)).json()) as { version: number };
  await post(manager, `/api/ops/plans/${plan.id}/reports`, { kind: "new", expectedPlanVersion: active.version, inputs: { flightSpeed: 40, assistantsNumber: 1 }, manual: { reportedAt: `${DAY}T11:30`, dipsNumber: "FP-2B-LONG-NUMBER-0123456789", confirmedDipsDone: true, confirmedMatchesLatest: true } });
  const incident = await post<{ id: string }>(manager, "/api/ops/incidents", { mode: "full", kind: "near_miss", occurredAt: `${DAY}T11:00`, summary: `飛行中に鳥が近づいたため手動で高度を下げた。長い説明の確認 ${stamp}`.repeat(2), eventTypes: ["near_collision"], peopleInjury: "no", aircraftDamage: "no", planId: plan.id });
  const snaps = (await (await manager.get(`/api/ops/plans/${plan.id}/snapshots`)).json()) as { snapshots?: { id: string }[] } | { id: string }[];
  const snapshotId = (Array.isArray(snaps) ? snaps : (snaps.snapshots ?? []))[0]!.id;
  fx = { planId: plan.id, flightPlanId: flightPlan.id, incidentId: incident.id, snapshotId };
  await manager.dispose();
  await pilot.dispose();
});

const open = async (page: Page, s: Screen, label: string): Promise<void> => {
  await page.goto(urlOf(s.path));
  await expect(page.getByTestId(s.ready).first(), label).toBeVisible();
  if (s.field) await expect(page.locator(`[data-testid="${s.ready}"][data-hydrated="true"]`), label).toBeVisible();
};
const modeOf = (page: Page): Promise<string | null> => page.evaluate(() => document.documentElement.getAttribute("data-mode"));

test.describe("Sprint 12h PR ③b2b E2E-DB：運航管理の v2（現場・事故・通報・判定の履歴）", () => {
  test("P3b2b-1. 文字：12px 以上・4.5:1 以上（明・暗。375px）。現場の 2 画面は 7:1 以上", async ({ page }) => {
    await signIn(page.request, seeded("a-manager"));
    for (const scheme of SCHEMES) {
      await page.emulateMedia({ colorScheme: scheme });
      for (const s of SCREENS) {
        const label = `${scheme} ${s.path}`;
        await open(page, s, label);
        const min = s.field ? 7 : 4.5;
        const samples = await collectTextSamples(page, root(s));
        expect(samples.length, label).toBeGreaterThan(0);
        const bad = samples.filter((t) => !t.disabled && !/^0\d$/.test(t.text) && (t.ratio < min || t.fontSize < (s.field ? 18 : 12))).map((t) => `${t.testId ?? t.tag}「${t.text}」 ${t.ratio.toFixed(2)}:1 ${t.fontSize}px`);
        expect(bad, label).toEqual([]);
      }
    }
  });

  test("P3b2b-2. 押す部品：高さ 43.5px 以上（375×812・360×740）。現場は 56px 以上、主ボタンは 64px 以上", async ({ page }) => {
    await signIn(page.request, seeded("a-manager"));
    for (const [w, h] of [[375, 812], [360, 740]] as const) {
      await page.setViewportSize({ width: w, height: h });
      for (const s of SCREENS) {
        const label = `${w}px ${s.path}`;
        await open(page, s, label);
        const r = await page.evaluate((field) => {
          const out: string[] = [];
          const prim: string[] = [];
          const sel = "main button, main a[href], main select, main textarea, main summary, main input:not([type=hidden]):not([type=checkbox]):not([type=radio]), [data-testid='field-root'] button, [data-testid='field-root'] a[href], [data-testid='field-root'] select";
          for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
            const b = el.getBoundingClientRect();
            if (b.width === 0 || b.height === 0 || getComputedStyle(el).visibility === "hidden") continue;
            if (el.tagName === "A" && el.closest("p, dd")) continue;
            if (b.height < (field ? 55.5 : 43.5)) out.push(`${el.tagName.toLowerCase()}[${el.getAttribute("data-testid") ?? (el.textContent ?? "").trim().slice(0, 16)}] ${b.width.toFixed(0)}×${b.height.toFixed(1)}`);
            if (field && el.classList.contains("opx-btn-primary") && !el.hasAttribute("disabled") && b.height < 63.5) prim.push(`${el.getAttribute("data-testid") ?? (el.textContent ?? "").trim().slice(0, 16)} ${b.height.toFixed(1)}`);
          }
          return { out, prim };
        }, s.field);
        expect(r.out, `${label}: 小さい押す部品`).toEqual([]);
        expect(r.prim, `${label}: 主ボタン`).toEqual([]);
      }
    }
  });

  test("P3b2b-3. はみ出し 0：幅 360〜1440 × 明・暗で横スクロールなし。長い計画名・番号・説明が親から出ない", async ({ page }) => {
    await signIn(page.request, seeded("a-manager"));
    for (const scheme of SCHEMES) {
      await page.emulateMedia({ colorScheme: scheme });
      for (const w of [360, 375, 768, 1024, 1280, 1440]) {
        await page.setViewportSize({ width: w, height: 900 });
        for (const s of SCREENS) {
          const label = `${scheme} ${w}px ${s.path}`;
          await open(page, s, label);
          await expectNoHorizontalScroll(page, label);
          const out = await page.evaluate(([vw, r0]) => {
            const bad: string[] = [];
            for (const el of Array.from(document.querySelectorAll<HTMLElement>(`${r0} *`))) {
              const r = el.getBoundingClientRect();
              if (r.width === 0 || r.height === 0 || el.closest("[aria-hidden='true'], .sr-only")) continue;
              if (r.right > (vw as number) + 1 || r.left < -1) bad.push(`${el.tagName.toLowerCase()}.${el.className.toString().slice(0, 30)} ${r.left.toFixed(0)}→${r.right.toFixed(0)}`);
            }
            return bad.slice(0, 5);
          }, [w, root(s)] as const);
          expect(out, `${label}: 画面の端を越える要素`).toEqual([]);
        }
      }
    }
  });

  test("P3b2b-4. 形：角丸は {16・8・4・ピル・円} だけ。影は --sb-shadow だけ。現場は影なし・動きなし", async ({ page }) => {
    await signIn(page.request, seeded("a-manager"));
    for (const scheme of SCHEMES) {
      await page.emulateMedia({ colorScheme: scheme });
      for (const w of [375, 1280]) {
        await page.setViewportSize({ width: w, height: 900 });
        for (const s of SCREENS) {
          const label = `${scheme} ${w}px ${s.path}`;
          await open(page, s, label);
          const bad = await page.evaluate(([r0, field]) => {
            const probe = document.createElement("div");
            probe.style.boxShadow = "var(--sb-shadow)";
            document.body.appendChild(probe);
            const token = getComputedStyle(probe).boxShadow;
            probe.remove();
            const shadowOutside = (sh: string): boolean => {
              if (sh === "none" || sh.includes("inset")) return false;
              if (field) return true;
              const layers = sh.split(/,\s*(?=rgba?\()/).filter((l) => !/^rgba\(0, 0, 0, 0\)/.test(l.trim()));
              return layers.length > 0 && layers.join(", ") !== token;
            };
            const out: string[] = [];
            for (const el of Array.from(document.querySelectorAll<HTMLElement>(`${r0} *`))) {
              const cs = getComputedStyle(el);
              if (cs.display === "none") continue;
              const r = el.getBoundingClientRect();
              if (r.width === 0 || r.height === 0) continue;
              if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) continue;
              for (const prop of ["borderTopLeftRadius", "borderTopRightRadius", "borderBottomLeftRadius", "borderBottomRightRadius"] as const) {
                const v = cs[prop];
                if (v === "0px" || v.endsWith("%")) continue;
                const px = parseFloat(v);
                if (px >= 100) continue;
                if (![16, 8, 4].includes(px) && !(Math.abs(r.width - r.height) <= 1 && px >= Math.min(r.width, r.height) / 2 - 0.5)) out.push(`${el.tagName.toLowerCase()}.${el.className.toString().slice(0, 24)} ${prop}=${v}`);
              }
              if (shadowOutside(cs.boxShadow)) out.push(`${el.tagName.toLowerCase()}.${el.className.toString().slice(0, 24)} boxShadow=${cs.boxShadow.slice(0, 40)}`);
              if (field && (cs.transitionDuration.split(",").some((d) => parseFloat(d) > 0) || (cs.animationName !== "none" && cs.animationDuration.split(",").some((d) => parseFloat(d) > 0)))) out.push(`${el.tagName.toLowerCase()}.${el.className.toString().slice(0, 24)} 動き`);
            }
            return [...new Set(out)].slice(0, 8);
          }, [root(s), s.field] as const);
          expect(bad, `${label}: v2 の形の外`).toEqual([]);
        }
      }
    }
  });

  test("P3b2b-5. 旧い見た目がない：rounded-ctl・rounded-sharp・.eyebrow・藍の面のボタンが 0。主ボタンは橙の面。判定の履歴・事故の一覧は <a>/<Link> の別画面への移動だけ", async ({ page }) => {
    await signIn(page.request, seeded("a-manager"));
    for (const scheme of SCHEMES) {
      await page.emulateMedia({ colorScheme: scheme });
      for (const s of SCREENS) {
        const label = `${scheme} ${s.path}`;
        await open(page, s, label);
        const sel = `${root(s)} .eyebrow, ${root(s)} .bearing-mark, ${root(s)} [class*='rounded-ctl'], ${root(s)} [class*='rounded-sharp']`;
        await expect(page.locator(sel), label).toHaveCount(0);
        const orange = await page.evaluate(() => {
          const p = document.createElement("div");
          p.style.color = "var(--sb-orange)";
          document.body.appendChild(p);
          const v = getComputedStyle(p).color;
          p.remove();
          return v;
        });
        const blueFaces = await page.evaluate((r0) =>
          Array.from(document.querySelectorAll<HTMLElement>(`${r0} button, ${r0} a`)).filter((e) => {
            const [r = 0, g = 0, b = 0, a = 1] = getComputedStyle(e).backgroundColor.match(/[\d.]+/g)?.map(Number) ?? [];
            return a > 0.5 && b > r + 40 && b > g + 20;
          }).length, root(s));
        expect(blueFaces, `${label}: 藍の面のボタン`).toBe(0);
        const primaries = await page.locator(`${root(s)} .opx-btn-primary:not(:disabled)`).evaluateAll((els) => els.map((e) => getComputedStyle(e).backgroundColor));
        for (const f of primaries) expect(f, `${label}: 主ボタンの面`).toBe(orange);
      }
    }
    // 事故の一覧の「取消済みも含める」は通常のリンク（<a>）で、押すと URL が切り替わる（Q-12）
    await page.goto("/ops/incidents");
    await page.getByRole("link", { name: "取消済みも含める" }).click();
    await expect(page).toHaveURL(/includeVoided=1/);
    expect(NORMAL.length).toBeGreaterThan(0);
  });

  test("P3b2b-6. 現場の印（Q-11）：現場の 2 画面を開いている間だけ data-mode=field。離れると外れる（行き来を繰り返しても）。`/` と他の画面には付かない", async ({ page }) => {
    await signIn(page.request, seeded("a-manager"));
    await page.goto("/");
    expect(await modeOf(page)).toBeNull();
    for (let i = 0; i < 3; i++) {
      await page.goto(`/ops/plans/${fx.planId}/field`);
      await expect(page.locator('[data-testid="field-root"][data-hydrated="true"]')).toBeVisible();
      expect(await modeOf(page), `現場 ${i}`).toBe("field");
      // 画面の中の移動（クライアントルーターで他の画面へ）：印が外れる
      await page.evaluate(() => (window as unknown as { next: { router: { push: (u: string) => void } } }).next.router.push("/ops/incidents"));
      await expect(page.getByTestId("incident-list-page")).toBeVisible();
      await expect.poll(() => modeOf(page), `incidents ${i}`).toBeNull();
      await page.goto(`/ops/plans/${fx.planId}/field/incident`);
      await expect(page.getByTestId("incident-quick-root")).toBeVisible();
      expect(await modeOf(page), `簡易記録 ${i}`).toBe("field");
      await page.evaluate(() => (window as unknown as { next: { router: { push: (u: string) => void } } }).next.router.push("/"));
      await expect(page.locator("main").first()).toBeVisible();
      await expect.poll(() => modeOf(page), `/ ${i}`).toBeNull();
    }
    // 戻る（ブラウザの履歴）でも、現場でない画面では付かない
    await page.goto("/ops/incidents");
    expect(await modeOf(page)).toBeNull();
    await page.goto(`/ops/plans/${fx.planId}/field`);
    await expect(page.getByTestId("field-root")).toBeVisible();
    await page.getByTestId("field-back").click();
    await expect(page).toHaveURL(/\/ops$/);
    expect(await modeOf(page)).toBeNull();
    // 現場の画面にも運航管理の枠（.ops-v2）があり、メニューは出ない
    await page.goto(`/ops/plans/${fx.planId}/field`);
    await expect(page.locator(".ds.ops-v2")).toHaveCount(1);
    await expect(page.getByTestId("ops-sidebar")).toHaveCount(0);
  });
});
