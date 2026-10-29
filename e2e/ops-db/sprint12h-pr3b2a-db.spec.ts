import { expect, request as pwRequest, test, type APIRequestContext, type Page } from "@playwright/test";
import { collectTextSamples, expectNoHorizontalScroll } from "../field-checks";

// Sprint 12h PR ③b2a の E2E-DB（docs/sprints/sprint-12h-pr3b2.md §7 の Q-6〜Q-8・Q-10・Q-12、T-7）。
// 運航管理 `/ops` の登録系の画面（登録の入口・機体・操縦者・許可・承認・地点・利用者）を v2 で描いたことの検査。
// 画面の組み合わせ（幅×明暗）は 1 件の中で回す。DB と AUTH_PROVIDER=test・OPS_ENABLED=1 を与えた next start に対して実行する。

const BASE = `http://127.0.0.1:${process.env.E2E_OPS_PORT ?? 3300}`;
const stamp = Date.now().toString(36).toUpperCase();

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

type Fixture = { readonly aircraftId: string; readonly pilotId: string; readonly permitSoon: string; readonly permitExpired: string; readonly permitRevoked: string; readonly placeId: string };
let fx: Fixture;
const SCHEMES = ["light", "dark"] as const;
const SCREENS = [
  "/ops/more",
  "/ops/aircraft",
  "/ops/aircraft/new",
  "/ops/aircraft/{aircraftId}",
  "/ops/pilots",
  "/ops/pilots/new",
  "/ops/pilots/{pilotId}",
  "/ops/permits",
  "/ops/permits/new",
  "/ops/permits/{permitSoon}",
  "/ops/permits/{permitExpired}",
  "/ops/permits/{permitRevoked}",
  "/ops/places",
  "/ops/places/new",
  "/ops/places/{placeId}",
  "/ops/members",
] as const;
const urlOf = (s: string): string => s.replace(/\{(\w+)\}/g, (_, k: string) => (fx as unknown as Record<string, string>)[k]!);

test.describe.configure({ mode: "serial" });
test.use({ viewport: { width: 375, height: 812 }, hasTouch: true });

test.beforeAll(async () => {
  const manager = await pwRequest.newContext({ baseURL: BASE });
  await signIn(manager, seeded("a-manager"));
  const mark = `JU2A${stamp}`.slice(0, 20);
  const aircraft = await post<{ id: string }>(manager, "/api/ops/aircraft", { registrationMark: mark, modelName: "長い型式名の確認のための機体 Matrice 350 RTK（業務用）", manufacturer: "エスケーエヌ・テクノロジーズ株式会社 長い設計製造者名", serialNumber: `SN-${mark}`, typeCertified: false, initialFlightMinutes: 0, maxTakeoffWeightKg: 0.9 });
  const pilot = await post<{ id: string }>(manager, "/api/ops/pilots", { fullName: `期限切れ 長い氏名の操縦者 ${stamp}`, hasLicense: true, licenseClass: "second", licenseNumber: `S2A-${stamp}`.slice(0, 30), licenseExpiresOn: "2020-01-01" });
  const reg = (n: string, extra: Record<string, unknown> = {}) => ({ permitNumber: `E2E-2A-${stamp}-${n}`, coverage: "blanket", kinds: ["night"], issuedOn: "2026-10-01", validFrom: "2026-10-01", validTo: "2027-09-30", placeScope: { type: "nationwide" }, aircraftScope: { type: "any" }, pilotScope: { type: "any" }, ...extra });
  const soon = await post<{ id: string }>(manager, "/api/ops/permits", reg("SOON-LONG-NUMBER-0123456789", { validTo: "2027-01-20" }));
  const list = (await (await manager.get("/api/ops/permits")).json()) as { permits?: { id: string; permitNumber: string }[] } | { id: string; permitNumber: string }[];
  const rows = Array.isArray(list) ? list : (list.permits ?? []);
  const place = await post<{ id: string }>(manager, "/api/ops/places", { name: `長い名称の地点 ${stamp}`, latitude: 35.434238, longitude: 133.380508, addressText: "鳥取県米子市日吉津 長い住所表記の確認のための文字列 ".repeat(2) });
  fx = {
    aircraftId: aircraft.id,
    pilotId: pilot.id,
    permitSoon: soon.id,
    permitExpired: rows.find((p) => p.permitNumber === "TEST-PERMIT-EXPIRED-003")!.id,
    permitRevoked: rows.find((p) => p.permitNumber === "TEST-PERMIT-REVOKED-004")!.id,
    placeId: place.id,
  };
  await manager.dispose();
});

const open = async (page: Page, s: string, label: string): Promise<void> => {
  await page.goto(urlOf(s));
  await expect(page.locator("main h1").first(), label).toBeVisible();
};

test.describe("Sprint 12h PR ③b2a E2E-DB：運航管理の v2（登録系の画面）", () => {
  test("P3b2a-1. 文字：12px 以上、コントラスト 4.5:1 以上（明・暗。375px）。登録系 16 画面", async ({ page }) => {
    await signIn(page.request, seeded("a-manager"));
    for (const scheme of SCHEMES) {
      await page.emulateMedia({ colorScheme: scheme });
      for (const s of SCREENS) {
        const label = `${scheme} ${s}`;
        await open(page, s, label);
        const samples = await collectTextSamples(page, "main");
        expect(samples.length, label).toBeGreaterThan(0);
        const bad = samples.filter((t) => !t.disabled && !/^0\d$/.test(t.text) && (t.ratio < 4.5 || t.fontSize < 12)).map((t) => `${t.testId ?? t.tag}「${t.text}」 ${t.ratio.toFixed(2)}:1 ${t.fontSize}px`);
        expect(bad, label).toEqual([]);
      }
    }
  });

  test("P3b2a-2. 押す部品：高さ 43.5px 以上（375×812・360×740）。登録の入口のリンクは 56px 以上", async ({ page }) => {
    await signIn(page.request, seeded("a-manager"));
    for (const [w, h] of [[375, 812], [360, 740]] as const) {
      await page.setViewportSize({ width: w, height: h });
      for (const s of SCREENS) {
        const label = `${w}px ${s}`;
        await open(page, s, label);
        const small = await page.evaluate(() => {
          const out: string[] = [];
          const sel = "main button, main a[href], main select, main textarea, main summary, main input:not([type=hidden]):not([type=checkbox]):not([type=radio])";
          for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.height === 0 || getComputedStyle(el).visibility === "hidden") continue;
            if (el.tagName === "A" && el.closest("p, dd")) continue;
            if (r.height < 43.5) out.push(`${el.tagName.toLowerCase()}[${el.getAttribute("data-testid") ?? (el.textContent ?? "").trim().slice(0, 16)}] ${r.width.toFixed(0)}×${r.height.toFixed(1)}`);
          }
          return out;
        });
        expect(small, `${label}: 44px 未満の押す部品`).toEqual([]);
      }
    }
    await page.goto("/ops/more");
    await expect(page.getByTestId("more-menu")).toBeVisible();
    for (const a of await page.getByTestId("more-menu").locator("a").all()) expect((await a.boundingBox())!.height, "登録の入口のリンク").toBeGreaterThanOrEqual(55.5);
  });

  test("P3b2a-3. はみ出し 0：幅 360〜1440 × 明・暗で横スクロールなし。長い記号・氏名・住所・番号が親から出ない", async ({ page }) => {
    await signIn(page.request, seeded("a-manager"));
    for (const scheme of SCHEMES) {
      await page.emulateMedia({ colorScheme: scheme });
      for (const w of [360, 375, 768, 1024, 1280, 1440]) {
        await page.setViewportSize({ width: w, height: 900 });
        for (const s of SCREENS) {
          const label = `${scheme} ${w}px ${s}`;
          await open(page, s, label);
          await expectNoHorizontalScroll(page, label);
          const out = await page.evaluate((vw) => {
            const bad: string[] = [];
            for (const el of Array.from(document.querySelectorAll<HTMLElement>("main *"))) {
              const r = el.getBoundingClientRect();
              if (r.width === 0 || r.height === 0 || el.closest("[aria-hidden='true'], .sr-only")) continue;
              if (r.right > vw + 1 || r.left < -1) bad.push(`${el.tagName.toLowerCase()}.${el.className.toString().slice(0, 30)} ${r.left.toFixed(0)}→${r.right.toFixed(0)}`);
            }
            return bad.slice(0, 5);
          }, w);
          expect(out, `${label}: 画面の端を越える要素`).toEqual([]);
        }
      }
    }
  });

  test("P3b2a-4. 形：角丸は {16・8・4・ピル・円} だけ。影は --sb-shadow だけ（枠の輪を除く）", async ({ page }) => {
    await signIn(page.request, seeded("a-manager"));
    for (const scheme of SCHEMES) {
      await page.emulateMedia({ colorScheme: scheme });
      for (const w of [375, 1280]) {
        await page.setViewportSize({ width: w, height: 900 });
        for (const s of SCREENS) {
          const label = `${scheme} ${w}px ${s}`;
          await open(page, s, label);
          const bad = await page.evaluate(() => {
            const probe = document.createElement("div");
            probe.style.boxShadow = "var(--sb-shadow)";
            document.body.appendChild(probe);
            const token = getComputedStyle(probe).boxShadow;
            probe.remove();
            const shadowOutside = (sh: string): boolean => {
              if (sh === "none" || sh.includes("inset")) return false;
              const layers = sh.split(/,\s*(?=rgba?\()/).filter((l) => !/^rgba\(0, 0, 0, 0\)/.test(l.trim()));
              return layers.length > 0 && layers.join(", ") !== token;
            };
            const out: string[] = [];
            for (const el of Array.from(document.querySelectorAll<HTMLElement>("main *"))) {
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
            }
            return [...new Set(out)].slice(0, 8);
          });
          expect(bad, `${label}: v2 の形の外`).toEqual([]);
        }
      }
    }
  });

  test("P3b2a-5. 旧い見た目の部品がない：rounded-ctl・rounded-sharp・.eyebrow・藍の面のボタンが 0。主ボタンは橙の面。同じ画面の ?query 切り替えは <a>", async ({ page }) => {
    await signIn(page.request, seeded("a-manager"));
    for (const scheme of SCHEMES) {
      await page.emulateMedia({ colorScheme: scheme });
      for (const s of SCREENS) {
        const label = `${scheme} ${s}`;
        await open(page, s, label);
        await expect(page.locator("main .eyebrow, main .bearing-mark, main [class*='rounded-ctl'], main [class*='rounded-sharp']"), label).toHaveCount(0);
        const orange = await page.evaluate(() => {
          const p = document.createElement("div");
          p.style.color = "var(--sb-orange)";
          document.body.appendChild(p);
          const v = getComputedStyle(p).color;
          p.remove();
          return v;
        });
        const blueFaces = await page.evaluate(() =>
          Array.from(document.querySelectorAll<HTMLElement>("main button, main a")).filter((e) => {
            const [r = 0, g = 0, b = 0, a = 1] = getComputedStyle(e).backgroundColor.match(/[\d.]+/g)?.map(Number) ?? [];
            return a > 0.5 && b > r + 40 && b > g + 20;
          }).length,
        );
        expect(blueFaces, `${label}: 藍の面のボタン`).toBe(0);
        const primaries = await page.locator("main .opx-btn-primary:not(:disabled)").evaluateAll((els) => els.map((e) => getComputedStyle(e).backgroundColor));
        for (const f of primaries) expect(f, `${label}: 主ボタンの面`).toBe(orange);
      }
    }
    // 一覧の「取消済みも含める」は通常のリンク（<a>）で、押すと URL が切り替わる（Link の同じ画面の ?query 切り替えを使わない：Q-12）
    await page.goto("/ops/aircraft");
    await page.getByRole("link", { name: "取消済みも含める" }).click();
    await expect(page).toHaveURL(/includeVoided=1/);
  });

  test("P3b2a-6. 期限の札は判定の色（赤・琥珀・緑）を使わない：期限切れ・失効＝墨の面＋「！」、期限間近＝薄い橙の面（明・暗）", async ({ page }) => {
    await signIn(page.request, seeded("a-manager"));
    for (const scheme of SCHEMES) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto("/ops/permits?includeVoided=1");
      await expect(page.getByTestId("permit-list")).toBeVisible();
      const tokens = await page.evaluate(() => {
        const rgb = (v: string): string => {
          const p = document.createElement("div");
          p.style.color = `var(${v})`;
          document.body.appendChild(p);
          const c = getComputedStyle(p).color;
          p.remove();
          return c;
        };
        return { inverse: rgb("--sb-inverse-bg"), soon: rgb("--sb-orange-hover"), judge: ["--sb-v-no-fill", "--sb-v-no-fg", "--sb-v-needs-fill", "--sb-v-needs-fg", "--sb-v-none-fg"].map(rgb) };
      });
      const badges = await page.getByTestId("permit-validity").evaluateAll((els) =>
        els.map((e) => {
          const cs = getComputedStyle(e);
          return { v: e.getAttribute("data-validity"), text: (e.textContent ?? "").trim(), bg: cs.backgroundColor, color: cs.color, border: cs.borderTopColor, before: getComputedStyle(e, "::before").content };
        }),
      );
      for (const kind of ["expired", "revoked", "expiring", "valid"]) expect(badges.some((b) => b.v === kind), `${scheme} ${kind}`).toBe(true);
      for (const b of badges) {
        for (const c of [b.bg, b.color, b.border]) expect(tokens.judge, `${scheme} ${b.v}: 判定の色`).not.toContain(c);
        if (b.v === "expired" || b.v === "revoked") {
          expect(b.bg, `${scheme} ${b.v}`).toBe(tokens.inverse);
          expect(b.before, `${scheme} ${b.v}: 「！」`).toContain("！");
          expect(b.text).toMatch(/^×/); // 文言（テキスト）は変えていない
        }
        if (b.v === "expiring") expect(b.bg, `${scheme} expiring`).toBe(tokens.soon);
      }
      // 技能証明の期限切れの札（詳細）
      await page.goto(`/ops/pilots/${fx.pilotId}`);
      const lic = page.getByTestId("pilot-detail").getByTestId("license-renewal-status").locator(".opx-badge");
      await expect(lic).toContainText("有効期限切れ");
      const l = await lic.evaluate((e) => ({ bg: getComputedStyle(e).backgroundColor, text: e.textContent ?? "" }));
      expect(l.bg, `${scheme} 技能証明`).toBe(tokens.inverse);
      expect(l.text).toContain("！");
    }
  });

  test("P3b2a-7. 現場（data-mode=field）：押す部品は 56px 以上・主ボタンは 64px・動きなし・影なし。登録系の一覧と入力", async ({ page }) => {
    await signIn(page.request, seeded("a-manager"));
    for (const scheme of SCHEMES) {
      await page.emulateMedia({ colorScheme: scheme });
      for (const s of ["/ops/aircraft", "/ops/aircraft/new", "/ops/permits", "/ops/places"]) {
        const label = `現場 ${scheme} ${s}`;
        await open(page, s, label);
        await page.evaluate(() => document.documentElement.setAttribute("data-mode", "field"));
        const r = await page.evaluate(() => {
          const vis = (e: HTMLElement) => e.getBoundingClientRect().height > 0;
          const btns = Array.from(document.querySelectorAll<HTMLElement>("main .opx-btn:not(.opx-btn-sm)")).filter(vis);
          const prim = Array.from(document.querySelectorAll<HTMLElement>("main .opx-btn-primary")).filter(vis);
          const moving = Array.from(document.querySelectorAll<HTMLElement>("main *")).filter((e) => {
            const cs = getComputedStyle(e);
            return cs.transitionDuration.split(",").some((d) => parseFloat(d) > 0) || (cs.animationName !== "none" && cs.animationDuration.split(",").some((d) => parseFloat(d) > 0));
          });
          const shadowed = Array.from(document.querySelectorAll<HTMLElement>("main .sb-block, main .opx-card, main .opx-row, main .opx-table")).filter((e) => getComputedStyle(e).boxShadow !== "none" && !getComputedStyle(e).boxShadow.includes("inset"));
          return {
            minBtn: btns.length ? Math.min(...btns.map((e) => e.getBoundingClientRect().height)) : 99,
            minPrimary: prim.length ? Math.min(...prim.map((e) => e.getBoundingClientRect().height)) : 99,
            moving: moving.slice(0, 5).map((e) => `${e.tagName.toLowerCase()}.${e.className.toString().slice(0, 24)}`),
            shadowed: shadowed.length,
          };
        });
        expect(r.minBtn, `${label} ボタン`).toBeGreaterThanOrEqual(55.5);
        expect(r.minPrimary, `${label} 主ボタン`).toBeGreaterThanOrEqual(63.5);
        expect(r.moving, `${label} 動くもの`).toEqual([]);
        expect(r.shadowed, `${label} 影`).toBe(0);
        await expectNoHorizontalScroll(page, label);
      }
    }
  });
});
