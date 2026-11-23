import { expect, request as pwRequest, test, type APIRequestContext, type Page } from "@playwright/test";
import { collectTextSamples, expectNoHorizontalScroll } from "../field-checks";

// Sprint 12h PR ③b1 の E2E-DB（docs/sprints/sprint-12h-pr3.md §8 の Q-9〜Q-11・Q-13〜Q-16）。
// 運航管理 `/ops` の共通部品と、毎日使う流れの画面（ホーム・計画の一覧／作成／詳細・点検の一覧／入力／詳細・日誌・飛行記録）を v2 で描いたことの検査。
// 画面の組み合わせ（幅×明暗）は 1 件の中で回す（件数と時間を抑える）。DB と AUTH_PROVIDER=test・OPS_ENABLED=1 を与えた next start に対して実行する。

const BASE = `http://127.0.0.1:${process.env.E2E_OPS_PORT ?? 3300}`;
const DAY = "2027-01-05";
const stamp = Date.now().toString(36).toUpperCase();
let seq = 0;

type Who = { readonly authUserId: string; readonly email: string };
const seeded = (key: string): Who => ({ authUserId: key, email: `${key}@example.test` });
const signIn = async (ctx: APIRequestContext, who: Who): Promise<void> => {
  const r = await ctx.post("/api/test-auth/sign-in", { data: { authUserId: who.authUserId, email: who.email, emailVerified: true, name: who.authUserId } });
  expect(r.status()).toBe(200);
};
const apiAs = async (who: Who): Promise<APIRequestContext> => {
  const ctx = await pwRequest.newContext({ baseURL: BASE });
  await signIn(ctx, who);
  return ctx;
};
const ALL_NORMAL = Object.fromEntries(
  ["general", "propeller", "frame", "communication", "propulsion", "power", "autopilot", "controller", "battery"].map((k) => [k, { result: "normal" }]),
);
const post = async <T>(ctx: APIRequestContext, url: string, data: object): Promise<T> => {
  const r = await ctx.post(url, { data });
  expect(r.status(), `${url} ${await r.text()}`).toBe(201);
  return (await r.json()) as T;
};

type Fixture = { readonly planId: string; readonly inspectionId: string; readonly flightId: string; readonly mark: string };
let fx: Fixture;

const SCHEMES = ["light", "dark"] as const;
/** 検査する画面（組織 A の運航管理者）。{id} は fixture で置き換える。 */
const SCREENS = [
  "/ops",
  "/ops/plans",
  "/ops/plans/new",
  "/ops/plans/{planId}",
  "/ops/plans/{planId}/overview",
  "/ops/plans/{planId}/judgement",
  "/ops/plans/{planId}/journal",
  "/ops/plans/{planId}/edit",
  "/ops/inspections",
  "/ops/inspections/new",
  "/ops/inspections/{inspectionId}",
  "/ops/journal",
  "/ops/flights",
  "/ops/flights/new",
  "/ops/flights/{flightId}",
] as const;
const urlOf = (s: string): string => s.replace("{planId}", fx.planId).replace("{inspectionId}", fx.inspectionId).replace("{flightId}", fx.flightId);

test.describe.configure({ mode: "serial" });
test.use({ viewport: { width: 375, height: 812 }, hasTouch: true });

test.beforeAll(async () => {
  const manager = await apiAs(seeded("a-manager"));
  const pilots = (await (await manager.get("/api/ops/pilots")).json()) as { pilots?: { id: string }[] } | { id: string }[];
  const pilotId = (Array.isArray(pilots) ? pilots : (pilots.pilots ?? []))[0]!.id;
  const mark = `JU3B${stamp}${seq++}`;
  const aircraft = await post<{ id: string }>(manager, "/api/ops/aircraft", { registrationMark: mark, modelName: "v2 試験機", manufacturer: "DJI", serialNumber: `SN-${mark}`, typeCertified: false, initialFlightMinutes: 0, maxTakeoffWeightKg: 0.9 });
  const plan = await post<{ id: string }>(manager, "/api/ops/plans", {
    title: `v2 試験の計画 ${stamp}`,
    aircraftId: aircraft.id,
    pilotId,
    plannedStartAt: `${DAY}T13:00`,
    durationMinutes: 60,
    purpose: "空撮",
    placeName: "試験地点",
    latitude: 35.434238,
    longitude: 133.380508,
    flags: [],
  });
  // Sprint 15：点検は計画に結び付ける（計画の現場の「済」に数える点検。意図の変更）
  const inspection = await post<{ id: string }>(manager, "/api/ops/inspections", { aircraftId: aircraft.id, pilotId, inspectedAt: `${DAY}T08:30`, timing: "pre_flight", placeName: "本社 駐車場", items: ALL_NORMAL, planId: plan.id });
  await post(manager, "/api/ops/inspections", { aircraftId: aircraft.id, pilotId, inspectedAt: `${DAY}T09:10`, timing: "post_flight", placeName: "本社 駐車場", items: { ...ALL_NORMAL, propeller: { result: "abnormal", note: "欠け" } } });
  const flight = await post<{ id: string }>(manager, "/api/ops/flights", { aircraftId: aircraft.id, pilotId, purpose: "空撮", takeoffPlace: "米子市日吉津 本社", landingPlace: "米子市日吉津 本社", safetyIssue: false, takeoffAt: `${DAY}T09:00`, landingAt: `${DAY}T09:26` });
  fx = { planId: plan.id, inspectionId: inspection.id, flightId: flight.id, mark };
  await manager.dispose();
});

test.describe("Sprint 12h PR ③b1 E2E-DB：運航管理の v2（共通部品・毎日使う流れの画面）", () => {
  test("P3b1-1. 文字：14px 以上、コントラスト 4.5:1 以上（明・暗。375px）。主要 12 画面", async ({ page }) => {
    await signIn(page.request, seeded("a-manager"));
    for (const scheme of SCHEMES) {
      await page.emulateMedia({ colorScheme: scheme });
      for (const s of SCREENS) {
        const label = `${scheme} ${s}`;
        await page.goto(urlOf(s));
        await expect(page.locator("main h1").first(), label).toBeVisible();
        const samples = await collectTextSamples(page, "main");
        expect(samples.length, label).toBeGreaterThan(0);
        // 背後の大きな薄い番号（装飾。aria-hidden）は読ませない文字なので、数えない
        const bad = samples.filter((t) => !t.disabled && !/^0\d$/.test(t.text) && (t.ratio < 4.5 || t.fontSize < 14)).map((t) => `${t.testId ?? t.tag}「${t.text}」 ${t.ratio.toFixed(2)}:1 ${t.fontSize}px`);
        expect(bad, `${label}`).toEqual([]);
      }
    }
  });

  test("P3b1-2. 押す部品：高さ 47.5px 以上（ボタン・リンクのボタン・入力欄・select・summary・チップ・戻りリンク）。375×812・360×740。文の中のリンクは除く", async ({ page }) => {
    await signIn(page.request, seeded("a-manager"));
    for (const [w, h] of [[375, 812], [360, 740]] as const) {
      await page.setViewportSize({ width: w, height: h });
      for (const s of SCREENS) {
        const label = `${w}px ${s}`;
        await page.goto(urlOf(s));
        await expect(page.locator("main h1").first(), label).toBeVisible();
        const small = await page.evaluate(() => {
          const out: string[] = [];
          const sel = "main button, main a[href], main select, main textarea, main summary, main input:not([type=hidden]):not([type=checkbox]):not([type=radio])";
          for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) continue;
            if (getComputedStyle(el).visibility === "hidden") continue;
            // 文の中の語句のリンク（段落・項目の値の中）は除く
            if (el.tagName === "A" && el.closest("p, dd")) continue;
            if (r.height < 47.5) out.push(`${el.tagName.toLowerCase()}[${el.getAttribute("data-testid") ?? (el.textContent ?? "").trim().slice(0, 16)}] ${r.width.toFixed(0)}×${r.height.toFixed(1)}`);
          }
          return out;
        });
        expect(small, `${label}: 44px 未満の押す部品`).toEqual([]);
      }
    }
  });

  test("P3b1-3. はみ出し 0：幅 360・375・768・1024・1280・1440px × 明・暗で横スクロールなし。要素が画面の右端を越えない", async ({ page }) => {
    await signIn(page.request, seeded("a-manager"));
    for (const scheme of SCHEMES) {
      await page.emulateMedia({ colorScheme: scheme });
      for (const w of [320, 360, 375, 768, 1024, 1280, 1440]) {
        await page.setViewportSize({ width: w, height: 900 });
        for (const s of SCREENS) {
          const label = `${scheme} ${w}px ${s}`;
          await page.goto(urlOf(s));
          await expect(page.locator("main h1").first(), label).toBeVisible();
          await expectNoHorizontalScroll(page, label);
          const out = await page.evaluate((vw) => {
            const bad: string[] = [];
            for (const el of Array.from(document.querySelectorAll<HTMLElement>("main *"))) {
              const r = el.getBoundingClientRect();
              if (r.width === 0 || r.height === 0) continue;
              if (el.closest("[aria-hidden='true'], .sr-only")) continue;
              if (r.right > vw + 1 || r.left < -1) bad.push(`${el.tagName.toLowerCase()}.${el.className.toString().slice(0, 30)} ${r.left.toFixed(0)}→${r.right.toFixed(0)}`);
            }
            return bad.slice(0, 5);
          }, w);
          expect(out, `${label}: 画面の端を越える要素`).toEqual([]);
        }
      }
    }
  });

  test("P3b1-4. 形：角丸は {16・8・4・ピル・円} だけ。影は --sb-shadow だけ（枠線の輪を除く）。旧い角丸 5px・2px が 0", async ({ page }) => {
    await signIn(page.request, seeded("a-manager"));
    for (const scheme of SCHEMES) {
      await page.emulateMedia({ colorScheme: scheme });
      for (const s of SCREENS) {
        const label = `${scheme} ${s}`;
        await page.goto(urlOf(s));
        await expect(page.locator("main h1").first(), label).toBeVisible();
        const bad = await page.evaluate(() => {
          const probe = document.createElement("div");
          probe.style.boxShadow = "var(--sb-shadow)";
          document.body.appendChild(probe);
          const token = getComputedStyle(probe).boxShadow;
          probe.remove();
    const shadowOutside = (sh: string, tok: string): boolean => {
      if (sh === "none" || sh.includes("inset")) return false;
      // Tailwind の影の部品は、透明な層（rgba(0, 0, 0, 0)）を重ねる。透明を除いた残りが --sb-shadow だけならよい
      const layers = sh.split(/,\s*(?=rgba?\()/).filter((l) => !/^rgba\(0, 0, 0, 0\)/.test(l.trim()));
      return layers.length > 0 && layers.join(", ") !== tok;
    };
          const out: string[] = [];
          for (const el of Array.from(document.querySelectorAll<HTMLElement>("main *"))) {
            const cs = getComputedStyle(el);
            if (cs.display === "none") continue;
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) continue;
            // ネイティブの入力部品（checkbox・radio・date・time の内部）は描画をブラウザが持つ
            if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) continue;
            for (const prop of ["borderTopLeftRadius", "borderTopRightRadius", "borderBottomLeftRadius", "borderBottomRightRadius"] as const) {
              const v = cs[prop];
              if (v === "0px" || v.endsWith("%")) continue;
              const px = parseFloat(v);
              if (px >= 100) continue; // ピル
              if (![16, 12, 8, 4].includes(px) && !(Math.abs(r.width - r.height) <= 1 && px >= Math.min(r.width, r.height) / 2 - 0.5)) out.push(`${el.tagName.toLowerCase()}.${el.className.toString().slice(0, 24)} ${prop}=${v}`);
            }
            const sh = cs.boxShadow;
            if (shadowOutside(sh, token)) out.push(`${el.tagName.toLowerCase()}.${el.className.toString().slice(0, 24)} boxShadow=${sh.slice(0, 40)}`);
          }
          return [...new Set(out)].slice(0, 8);
        });
        expect(bad, `${label}: v2 の形の外`).toEqual([]);
      }
    }
  });

  test("P3b1-5. 旧い見た目の部品がない：旧いボタン・札・見出しの名前（rounded-ctl・eyebrow・bearing-mark）と藍の地が 0。主ボタンは主色の面＋白の文字（4.5:1 以上）", async ({ page }) => {
    await signIn(page.request, seeded("a-manager"));
    for (const scheme of SCHEMES) {
      await page.emulateMedia({ colorScheme: scheme });
      for (const s of SCREENS) {
        const label = `${scheme} ${s}`;
        await page.goto(urlOf(s));
        await expect(page.locator("main h1").first(), label).toBeVisible();
        await expect(page.locator("main .eyebrow, main .bearing-mark, main [class*='rounded-ctl'], main [class*='rounded-sharp']"), label).toHaveCount(0);
        const primary = await page.evaluate(() => {
          const p = document.createElement("div");
          p.style.color = "var(--sb-primary)";
          document.body.appendChild(p);
          const v = getComputedStyle(p).color;
          p.remove();
          return v;
        });
        const blueFaces = await page.evaluate((own) =>
          Array.from(document.querySelectorAll<HTMLElement>("main button, main a")).filter((e) => {
            const bgc = getComputedStyle(e).backgroundColor;
            const m = bgc.match(/[\d.]+/g)?.map(Number) ?? [];
            const [r = 0, g = 0, b = 0, a = 1] = m;
            return a > 0.5 && b > r + 40 && b > g + 20 && bgc !== own; // 藍・青の面（主色の面は除く）
          }).length, primary,
        );
        expect(blueFaces, `${label}: 藍の面のボタン`).toBe(0);
        const primaries = await page.locator("main .opx-btn-primary:not(:disabled), main .sb-pill-primary:not(:disabled)").evaluateAll((els) => els.map((e) => getComputedStyle(e).backgroundColor));
        for (const f of primaries) expect(f, `${label}: 主ボタンの面`).toBe(primary);
      }
    }
  });

  test("P3b1-6. 現場（data-mode=field）：押す部品は 56px 以上・主ボタンは 64px・動きなし・影なし。点検の入力と飛行記録の入力", async ({ page }) => {
    await signIn(page.request, seeded("a-manager"));
    for (const scheme of SCHEMES) {
      await page.emulateMedia({ colorScheme: scheme });
      for (const s of ["/ops/inspections/new", "/ops/flights/new", "/ops/inspections"]) {
        const label = `現場 ${scheme} ${s}`;
        await page.goto(s);
        await expect(page.locator("main h1").first(), label).toBeVisible();
        await page.evaluate(() => document.documentElement.setAttribute("data-mode", "field"));
        const r = await page.evaluate(() => {
          const btns = Array.from(document.querySelectorAll<HTMLElement>("main .opx-btn:not(.opx-btn-sm)")).filter((e) => e.getBoundingClientRect().height > 0);
          const prim = Array.from(document.querySelectorAll<HTMLElement>("main .opx-btn-primary")).filter((e) => e.getBoundingClientRect().height > 0);
          const moving = Array.from(document.querySelectorAll<HTMLElement>("main *")).filter((e) => {
            const cs = getComputedStyle(e);
            const t = cs.transitionDuration.split(",").some((d) => parseFloat(d) > 0);
            const a = cs.animationName !== "none" && cs.animationDuration.split(",").some((d) => parseFloat(d) > 0);
            return t || a;
          });
          const shadowed = Array.from(document.querySelectorAll<HTMLElement>("main .sb-block, main .opx-card")).filter((e) => getComputedStyle(e).boxShadow !== "none" && !getComputedStyle(e).boxShadow.includes("inset"));
          return {
            minBtn: Math.min(...btns.map((e) => e.getBoundingClientRect().height)),
            minPrimary: prim.length ? Math.min(...prim.map((e) => e.getBoundingClientRect().height)) : 99,
            moving: moving.slice(0, 5).map((e) => `${e.tagName.toLowerCase()}.${e.className.toString().slice(0, 24)}`),
            shadowed: shadowed.length,
          };
        });
        expect(r.minBtn, `${label} ボタンの高さ`).toBeGreaterThanOrEqual(55.5);
        expect(r.minPrimary, `${label} 主ボタンの高さ`).toBeGreaterThanOrEqual(63.5);
        expect(r.moving, `${label} 動くもの`).toEqual([]);
        expect(r.shadowed, `${label} 影`).toBe(0);
        await expectNoHorizontalScroll(page, label);
      }
    }
  });

  test("P3b1-7. 点検の一覧の区分チップ（通常のリンク <a>）：押すと URL と一覧が切り替わる。直前に記録した点検が、チップを往復しても古いまま残らない（6 往復）", async ({ page }) => {
    const manager = await apiAs(seeded("a-manager"));
    const pilots = (await (await manager.get("/api/ops/pilots")).json()) as { pilots?: { id: string }[] } | { id: string }[];
    const pilotId = (Array.isArray(pilots) ? pilots : (pilots.pilots ?? []))[0]!.id;
    const aircraft = await post<{ id: string }>(manager, "/api/ops/aircraft", { registrationMark: `JU3C${stamp}${seq++}`, modelName: "チップ試験機", manufacturer: "DJI", serialNumber: `SN-C${stamp}${seq}`, typeCertified: false, initialFlightMinutes: 0, maxTakeoffWeightKg: 0.9 });
    await signIn(page.request, seeded("a-manager"));
    await page.goto("/ops/inspections");
    const all = page.getByTestId("inspection-timing-all");
    const post_ = page.getByTestId("inspection-timing-post_flight");
    const pre = page.getByTestId("inspection-timing-pre_flight");
    // 通常のリンク（<a>）。next/link のクライアント遷移は、往復を繰り返すと切り替わらなくなることがあった（docs/evaluations/12h-pr3b1-test-changes.md §E）
    await expect(post_).toHaveAttribute("href", /timing=post_flight/);
    let total = await page.getByTestId("inspection-row").count();
    for (let i = 0; i < 6; i++) {
      await post_.click();
      await expect(page).toHaveURL(/timing=post_flight/);
      await expect(post_).toHaveAttribute("aria-current", "true");
      await expect(pre).not.toHaveAttribute("aria-current", "true");
      // 絞り込んだ中で、区分が飛行前の行はない
      await expect(page.getByTestId("inspection-row").filter({ hasText: "飛行前" })).toHaveCount(0);
      // 間に点検を 1 件記録する（別の人が記録した想定）。チップで「すべて」へ戻ると、その点検が出る
      await post(manager, "/api/ops/inspections", { aircraftId: aircraft.id, pilotId, inspectedAt: `${DAY}T${String(5 + i).padStart(2, "0")}:00`, timing: "pre_flight", placeName: "本社 駐車場", items: ALL_NORMAL });
      total += 1;
      await all.click();
      await expect(page).not.toHaveURL(/timing=/);
      await expect(all).toHaveAttribute("aria-current", "true");
      await expect(page.getByTestId("inspection-count")).toHaveText(`${total} 件`);
    }
    await manager.dispose();
  });
});
