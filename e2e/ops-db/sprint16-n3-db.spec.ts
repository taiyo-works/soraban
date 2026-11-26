import { expect, request as pwRequest, test, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";
import { waitForSettledStyles } from "../field-checks";
import { expectStep, fillStep, tapNext } from "./plan-wizard";

// Sprint 16-N3 の E2E-DB（契約 N3-1〜N3-8。N3-9 は docs/evaluations/logs/sprint-16N3-gen-tap.mjs の記録）。
//   N3-1 現場の 1 行の帯（文字が大きく、上の帯の固定が外れる倍率で、接続と送信待ちの件数だけを画面の上端に固定で残す）
//   N3-2 320・文字 200% の現場で、H3・H4・「ホームへ戻る」が画面の幅を超えない（文書の scrollWidth ≦ 320）
//   N3-3 同じ日の他の計画へのチップの題名が、文字 200% で省略されない
//   N3-4 320・文字 200% の日付・時刻の入力で、入れ物の切れ 0・横スクロール 0
//   N3-5 360 幅ほかの日付欄で、値の文字とカレンダーの絵が重ならない
//   N3-6 header の「そらばん」が、320・360・390 × 100・200% で欠けない
//   N3-7 準備カードの名前は見出しの文だけ（aria-labelledby）
//   N3-8 ホーム 375×812：題 2 行・期限の対象 40 字でも、クイック操作の下端とナビの上端の間 8px 以上
// DB と AUTH_PROVIDER=test・OPS_ENABLED=1 を与えた next start（本番のビルド）に対して実行する。サーバーの時計は OPS_TEST_NOW（JST 2027-01-05 12:00）。
const BASE = `http://127.0.0.1:${process.env["E2E_OPS_PORT"] ?? 3300}`;
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

const DAY = "2027-01-05";
const HQ = { lat: 35.434238, lng: 133.380508 };
const stamp = Date.now().toString(36).toUpperCase();
let seq = 0;

const createAircraft = async (manager: APIRequestContext): Promise<{ id: string }> => {
  const registrationMark = `JUN16${stamp}${seq++}`.slice(0, 20);
  const r = await manager.post("/api/ops/aircraft", {
    data: { registrationMark, modelName: "N3 試験機", manufacturer: "DJI", serialNumber: `SN-${registrationMark}`, typeCertified: false, initialFlightMinutes: 0, maxTakeoffWeightKg: 0.9 },
  });
  expect(r.status(), await r.text()).toBe(201);
  return (await r.json()) as { id: string };
};
const createPilot = async (manager: APIRequestContext, fullName?: string, licenseExpiresOn?: string): Promise<{ id: string }> => {
  const r = await manager.post("/api/ops/pilots", {
    data: licenseExpiresOn
      ? { fullName, hasLicense: true, licenseClass: "second", licenseNumber: `N16-${stamp}-${seq++}`.slice(0, 30), licenseExpiresOn }
      : { fullName: fullName ?? `現場 試験${stamp}${seq++}`, hasLicense: false },
  });
  expect(r.status(), await r.text()).toBe(201);
  return (await r.json()) as { id: string };
};
const createPlan = async (ctx: APIRequestContext, aircraftId: string, pilotId: string, o: { title?: string; hour?: number } = {}): Promise<{ id: string; title: string }> => {
  const title = o.title ?? `N3 ${stamp}-${seq++}`;
  const r = await ctx.post("/api/ops/plans", {
    data: { title, aircraftId, pilotId, plannedStartAt: `${DAY}T${String(o.hour ?? 13).padStart(2, "0")}:00`, durationMinutes: 30, purpose: "現場の空撮", placeName: "試験地点", latitude: HQ.lat, longitude: HQ.lng, flags: [] },
  });
  expect(r.status(), await r.text()).toBe(201);
  return { ...((await r.json()) as { id: string }), title };
};
const prepare = async (page: Page, who = "a-manager") => {
  const manager = await apiAs(seeded(who));
  await signIn(page.request, seeded(who));
  const aircraft = await createAircraft(manager);
  const pilot = await createPilot(manager);
  const plan = await createPlan(manager, aircraft.id, pilot.id);
  return { manager, aircraft, pilot, plan };
};
const openField = async (page: Page, planId: string): Promise<void> => {
  await page.goto(`/ops/plans/${planId}/field`);
  await expect(page.locator('[data-testid="field-root"][data-hydrated="true"]')).toBeVisible();
  await waitForSettledStyles(page);
};
const setOnline = async (page: Page, context: BrowserContext, online: boolean): Promise<void> => {
  await context.setOffline(!online);
  await page.evaluate((on) => window.dispatchEvent(new Event(on ? "online" : "offline")), online).catch(() => undefined);
};
const note = (type: string, description: string): void => {
  test.info().annotations.push({ type, description });
  console.log(`[${type}] ${description}`);
};
const frames = (page: Page): Promise<void> => page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
/** html の文字の大きさを倍率にする（端末の文字の拡大の模擬。K-5 と同じ）。 */
const zoomTo = async (page: Page, pct: number): Promise<void> => {
  await page.evaluate((p) => {
    document.documentElement.style.fontSize = `${p}%`;
  }, pct);
  await frames(page);
};
const resize = async (page: Page, width: number, height = 800): Promise<void> => {
  await page.setViewportSize({ width, height });
  await waitForSettledStyles(page);
};

// 日本語の端末の表示（時刻は 24 時間制。Chromium は locale で値の見え方が変わる）
test.use({ viewport: { width: 390, height: 800 }, hasTouch: true, locale: "ja-JP" });

// ---------------------------------------------------------------- N3-1
const BAND_WIDTHS = [320, 360, 390, 430] as const;
const BAND_ZOOMS = [125, 150, 200] as const;

type BandProbe = {
  readonly mode: "compact" | "full";
  readonly bandPos: string;
  readonly bandH: number;
  readonly lineH: number;
  readonly bandSw: number;
  readonly bandCw: number;
  readonly unsentOnTop: boolean;
  readonly unsentInView: boolean;
  readonly buttonOnTop: boolean;
  readonly buttonRect: { top: number; bottom: number };
  readonly bandBottom: number;
  readonly rects: number;
  readonly docSw: number;
  readonly docCw: number;
  readonly pos: string;
};
/** 離陸のボタンが画面に見える位置までスクロールしたときの、固定の帯の状態。compact（1 行の帯）が出ていればそれを、出ていなければ上の帯（sticky のまま）を測る。 */
const probeBand = async (page: Page, scrollTo: "button" | "bottom" | "top"): Promise<BandProbe> =>
  page.evaluate((where) => {
    const btn = document.querySelector<HTMLElement>('[data-testid="field-flight-button"]')!;
    if (where === "button") btn.scrollIntoView({ block: "center", behavior: "instant" });
    else if (where === "bottom") window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" });
    else window.scrollTo({ top: 0, behavior: "instant" });
    const vis = (e: Element | null): e is HTMLElement => !!e && getComputedStyle(e).display !== "none" && e.getBoundingClientRect().width > 0;
    const compact = document.querySelector<HTMLElement>('[data-testid="field-band-compact"]');
    const full = document.querySelector<HTMLElement>('[data-testid="field-status-band"]')!;
    const mode = vis(compact) ? "compact" : "full";
    const band = (mode === "compact" ? compact : full)!;
    const unsent = band.querySelector<HTMLElement>(mode === "compact" ? '[data-testid="field-band-compact-unsent"]' : '[data-testid="field-status-unsent"]')!;
    const ur = unsent.getBoundingClientRect();
    const hitU = document.elementFromPoint(ur.left + ur.width / 2, ur.top + ur.height / 2);
    const br = btn.getBoundingClientRect();
    const hitB = document.elementFromPoint(br.left + br.width / 2, br.top + br.height / 2);
    const bandR = band.getBoundingClientRect();
    const cs = getComputedStyle(band);
    return {
      mode,
      bandPos: cs.position,
      bandH: bandR.height,
      lineH: parseFloat(cs.lineHeight),
      bandSw: band.scrollWidth,
      bandCw: band.clientWidth,
      unsentOnTop: !!hitU && band.contains(hitU),
      unsentInView: ur.top >= 0 && ur.bottom <= window.innerHeight && ur.left >= 0 && ur.right <= window.innerWidth,
      buttonOnTop: !!hitB && (hitB === btn || btn.contains(hitB)),
      buttonRect: { top: br.top, bottom: br.bottom },
      bandBottom: bandR.bottom,
      rects: unsent.getClientRects().length,
      docSw: document.documentElement.scrollWidth,
      docCw: document.documentElement.clientWidth,
      pos: cs.position,
    };
  }, scrollTo);

for (const w of BAND_WIDTHS) {
  test.describe(`N3-1 現場の 1 行の帯 ${w}`, () => {
    test.use({ viewport: { width: w, height: 800 } });

    test(`文字 125・150・200% で、離陸のボタンの位置でも送信待ちの件数が帯に見え、ボタンを覆わず、帯は 1 行（${w}px）。等倍は今の帯のまま`, async ({ page }) => {
      const { manager, plan } = await prepare(page);
      await openField(page, plan.id);
      // (d) 等倍：今の帯（sticky・100px 以下・< 140）。1 行の帯は出ない
      const full = page.getByTestId("field-status-band");
      expect(await full.evaluate((e) => getComputedStyle(e).position), `${w} 等倍の帯`).toBe("sticky");
      const h100 = (await full.boundingBox())!.height;
      expect(h100, `${w} 等倍の帯の高さ`).toBeLessThanOrEqual(100);
      expect(h100).toBeLessThan(140);
      expect(await page.getByTestId("field-band-compact").isVisible(), `${w} 等倍では 1 行の帯を出さない`).toBe(false);
      for (const z of BAND_ZOOMS) {
        await zoomTo(page, z);
        for (const where of ["button", "bottom", "top"] as const) {
          const p = await probeBand(page, where);
          const tag = `${w}・${z}%・${where}（${p.mode}）`;
          note("band", `${tag}: 帯 ${p.bandH.toFixed(1)}px（行 ${p.lineH.toFixed(1)}px）・位置 ${p.pos}・帯の幅 ${p.bandSw}/${p.bandCw}・文書 ${p.docSw}/${p.docCw}・ボタン ${p.buttonRect.top.toFixed(0)}〜${p.buttonRect.bottom.toFixed(0)}・帯の下端 ${p.bandBottom.toFixed(0)}`);
          // (a) 固定の帯が画面の上端にあり、送信待ちの件数の文字が表示の中で、他の要素に覆われていない
          expect(p.bandPos, `${tag}: 帯は固定`).toBe("sticky");
          expect(p.unsentInView, `${tag}: 送信待ちの件数が表示の中`).toBe(true);
          expect(p.unsentOnTop, `${tag}: 送信待ちの件数の中心が帯の中の要素（覆われていない）`).toBe(true);
          if (where === "button") {
            // (b) 帯が離陸のボタンを覆わない
            expect(p.buttonOnTop, `${tag}: ボタンの中心がボタン`).toBe(true);
          }
          if (p.mode === "compact") {
            // (c) 1 行：折り返さない（高さ ≦ 行の高さ + 上下の余白 12px）・帯の中で横にはみ出さない・件数の塊は 1 片
            expect(p.bandH, `${tag}: 1 行の帯の高さ`).toBeLessThanOrEqual(p.lineH + 12);
            expect(p.bandSw, `${tag}: 帯の横スクロール`).toBeLessThanOrEqual(p.bandCw);
            expect(p.rects, `${tag}: 件数の塊は途中で割れない`).toBe(1);
          }
          // 横スクロール 0（文書。N3-2 で 320 も含めて 0）
          expect(p.docSw, `${tag}: 文書の横スクロール`).toBeLessThanOrEqual(p.docCw);
        }
        // 倍率ごとに、固定が外れる幅では 1 行の帯が出ている（今の実測：文字 150% 以上、320 は 125% 以上で上の帯が static）
        const staticFull = (await full.evaluate((e) => getComputedStyle(e).position)) === "static";
        expect(await page.getByTestId("field-band-compact").isVisible(), `${w}・${z}%: 上の帯が static のときだけ 1 行の帯が出る`).toBe(staticFull);
      }
      await manager.dispose();
    });
  });
}

test.describe("N3-1 圏外・件数の多いとき", () => {
  for (const w of [320, 360]) {
    test.describe(`${w}`, () => {
      test.use({ viewport: { width: w, height: 800 } });
      test(`圏外の帯（「× 接続なし（圏外）」）と 3 桁の件数でも、文字 200% の 1 行の帯は折り返さず、はみ出さない（${w}px）`, async ({ page, context }) => {
        const { manager, plan } = await prepare(page);
        await openField(page, plan.id);
        await setOnline(page, context, false);
        await expect(page.getByTestId("field-status-connection")).toContainText("接続なし");
        await zoomTo(page, 200);
        // 3 桁の件数に差し替えて幅を測る（描画の確認だけ。保存・送信はしない）
        await page.evaluate(() => {
          const el = document.querySelector('[data-testid="field-band-compact-unsent"] > span')!;
          el.textContent = "888 件";
        });
        await frames(page);
        const r = await page.evaluate(() => {
          const band = document.querySelector<HTMLElement>('[data-testid="field-band-compact"]')!;
          const cs = getComputedStyle(band);
          const conn = band.querySelector<HTMLElement>('[data-testid="field-band-compact-connection"]')!;
          const uns = band.querySelector<HTMLElement>('[data-testid="field-band-compact-unsent"]')!;
          return { h: band.getBoundingClientRect().height, lh: parseFloat(cs.lineHeight), sw: band.scrollWidth, cw: band.clientWidth, connText: conn.textContent, connRects: conn.getClientRects().length, unsRects: uns.getClientRects().length, right: uns.getBoundingClientRect().right, vw: document.documentElement.clientWidth, fs: cs.fontSize };
        });
        note("band-offline", `${w}・200%・圏外・888 件: 高さ ${r.h.toFixed(1)}px・帯の幅 ${r.sw}/${r.cw}・右端 ${r.right.toFixed(1)}/${r.vw}・字 ${r.fs}`);
        expect(r.connText).toBe("× 接続なし（圏外）");
        expect(r.h, "1 行").toBeLessThanOrEqual(r.lh + 12);
        expect(r.sw, "帯の横スクロール").toBeLessThanOrEqual(r.cw);
        expect(r.right, "右端が画面の中").toBeLessThanOrEqual(r.vw);
        expect(r.connRects + r.unsRects, "折り返さない（接続・送信待ちの各 1 片）").toBe(2);
        await setOnline(page, context, true);
        await manager.dispose();
      });
    });
  }
});

// ---------------------------------------------------------------- N3-2・N3-3
test.describe("N3-2・N3-3 現場の 320・文字 200%", () => {
  test.use({ viewport: { width: 320, height: 800 } });

  test("文書の横スクロール 0。H3「飛行自粛要請の確認」・H4「飛行マニュアルの組み合わせ制限」・「ホームへ戻る」が画面の幅を超えない。同じ日のチップは題名が省略されない", async ({ page }) => {
    // 実行ごとに一意の値（同じ DB・同じワーカーで --repeat-each しても、今回作った計画だけを数える。F-1）
    const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
    const manager = await apiAs(seeded("a-manager"));
    await signIn(page.request, seeded("a-manager"));
    const aircraft = await createAircraft(manager);
    const pilot = await createPilot(manager);
    // 同じ日の別の計画（別の機体・操縦者。時間も重ならない）。題名は長め（省略されやすい）
    const aircraft2 = await createAircraft(manager);
    const pilot2 = await createPilot(manager);
    const plan = await createPlan(manager, aircraft.id, pilot.id, { title: `朝の河川敷の橋梁点検撮影 ${run}`, hour: 9 });
    await createPlan(manager, aircraft2.id, pilot2.id, { title: `午後の山あいの送電線の巡視撮影 ${run}`, hour: 15 });
    await openField(page, plan.id);
    await expect(page.getByTestId("field-same-day-link").filter({ hasText: new RegExp(`(橋梁点検撮影|送電線の巡視撮影) ${run}`) })).toHaveCount(2);
    await zoomTo(page, 200);
    const r = await page.evaluate((runId) => {
      const de = document.documentElement;
      const box = (el: Element | null) => (el ? el.getBoundingClientRect() : null);
      const byText = (sel: string, t: string): HTMLElement | null => Array.from(document.querySelectorAll<HTMLElement>(sel)).find((e) => (e.textContent ?? "").includes(t)) ?? null;
      const h3 = byText("h3", "飛行自粛要請の確認");
      const h4 = byText("h4", "飛行マニュアルの組み合わせ制限");
      const back = document.querySelector<HTMLElement>('[data-testid="field-back"]');
      const wide: string[] = [];
      for (const el of Array.from(document.body.querySelectorAll<HTMLElement>("*"))) {
        const b = el.getBoundingClientRect();
        if (b.width > 0 && b.right > de.clientWidth + 0.5) wide.push(`${el.getAttribute("data-testid") ?? el.tagName.toLowerCase()} →${b.right.toFixed(0)}`);
      }
      const chips = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="field-same-day-link"]')).filter((a) => new RegExp(`(橋梁点検撮影|送電線の巡視撮影) ${runId}`).test(a.textContent ?? "")).map((a) => {
        const t = a.querySelector<HTMLElement>("span:last-child")!;
        const cs = getComputedStyle(t);
        return { text: t.textContent, ellipsis: cs.textOverflow === "ellipsis" && cs.overflow !== "visible", sw: t.scrollWidth, cw: t.clientWidth, h: a.getBoundingClientRect().height, lines: Math.round(t.getBoundingClientRect().height / parseFloat(cs.lineHeight)), right: a.getBoundingClientRect().right };
      });
      return {
        sw: de.scrollWidth,
        cw: de.clientWidth,
        h3: h3 ? { right: box(h3)!.right, sw: h3.scrollWidth, cw: h3.clientWidth } : null,
        h4: h4 ? { right: box(h4)!.right, sw: h4.scrollWidth, cw: h4.clientWidth } : null,
        back: back ? { right: box(back)!.right, sw: back.scrollWidth, cw: back.clientWidth } : null,
        wide: wide.slice(0, 8),
        chips,
      };
    }, run);
    note("n3-2", `文書 ${r.sw}/${r.cw}・H3 ${JSON.stringify(r.h3)}・H4 ${JSON.stringify(r.h4)}・戻る ${JSON.stringify(r.back)}・はみ出し ${r.wide.join(" / ")}`);
    note("n3-3", `チップ ${JSON.stringify(r.chips)}`);
    expect(r.chips, "今回作った 2 件の計画のチップ（題に今回の値を含むもの）").toHaveLength(2);
    expect(r.h3, "H3 が見つかる").not.toBeNull();
    expect(r.back, "ホームへ戻るが見つかる").not.toBeNull();
    expect(r.wide, `画面の右端（${r.cw}）を超える要素`).toEqual([]);
    expect(r.sw, "文書の scrollWidth").toBeLessThanOrEqual(320);
    for (const x of [r.h3, r.h4, r.back]) if (x) expect(x.right, "見出し・戻るの右端").toBeLessThanOrEqual(r.cw + 0.5);
    // N3-3：チップの題名が省略（text-overflow: ellipsis で切る）されず、全文が読める。押す部品は 56px 以上
    for (const c of r.chips) {
      expect(c.ellipsis, `チップ「${c.text}」が省略表示`).toBe(false);
      expect(c.sw, `チップ「${c.text}」の題名が切れている`).toBeLessThanOrEqual(c.cw + 1);
      expect(c.h, `チップの高さ（押す部品・現場は 56）`).toBeGreaterThanOrEqual(56);
      expect(c.right, "チップの右端").toBeLessThanOrEqual(r.cw + 0.5);
    }
    await manager.dispose();
  });
});

// ---------------------------------------------------------------- N3-4・N3-5
type DateProbe = { readonly id: string; readonly type: string; readonly value: string; readonly clipped: boolean; readonly sw: number; readonly cw: number; readonly avail: number; readonly need: number; readonly overlap: boolean; readonly textW: number; readonly extra: number };
/** 画面の日付・時刻の標準入力欄を測る。need＝同じ字体（letter-spacing 込み）で測った値の幅＋カレンダーの絵の幅と間（Chromium の既定。下の extra の式）。値が空の欄は「2027/01/05」「12:34」で測る。 */
const probeDateInputs = async (page: Page): Promise<DateProbe[]> =>
  page.evaluate(() => {
    const canvas = document.createElement("canvas").getContext("2d")!;
    const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="date"], input[type="time"]')).filter((i) => i.getBoundingClientRect().width > 0 && getComputedStyle(i).display !== "none");
    return inputs.map((i, n) => {
      const cs = getComputedStyle(i);
      canvas.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      const shown = i.type === "date" ? (i.value || "2027-01-05").replaceAll("-", "/") : i.value || "12:34";
      // 値の幅（letter-spacing も含めて、同じ字体で測る）＋カレンダーの絵の幅と間（Chromium の既定を画素で実測：絵の幅は max(14, 0.8×字の大きさ)、右の余白 4 ＋ 値との最小の間 4、
      // Chromium の描く値は canvas の値より 4 ほど広い。→ extra = max(14, 0.8×字) + 12）。時刻の欄は値の幅だけ（絵は同じ扱い）。
      (canvas as unknown as { letterSpacing: string }).letterSpacing = cs.letterSpacing === "normal" ? "0px" : cs.letterSpacing;
      const fs = parseFloat(cs.fontSize);
      const textW = canvas.measureText(shown).width;
      const extra = Math.max(14, 0.8 * fs) + 12;
      const avail = i.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const need = textW + extra;
      return {
        id: i.getAttribute("data-testid") ?? i.getAttribute("aria-label") ?? `${i.type}#${n}`,
        type: i.type,
        value: i.value,
        clipped: i.scrollWidth > i.clientWidth + 1,
        sw: i.scrollWidth,
        cw: i.clientWidth,
        avail,
        need,
        overlap: avail < textW + extra - 0.5,
        textW,
        extra,
      };
    });
  });

type DateScreen = { readonly name: string; readonly open: (page: Page) => Promise<void> };
const DATE_SCREENS: readonly DateScreen[] = [
  {
    name: "飛行記録の入力",
    open: async (page) => {
      await page.goto("/ops/flights/new");
      await expect(page.getByRole("form").first()).toBeVisible();
    },
  },
  {
    name: "点検の入力",
    open: async (page) => {
      await page.goto("/ops/inspections/new");
      await expect(page.getByRole("form", { name: "日常点検の入力" })).toBeVisible();
    },
  },
  {
    name: "計画作成の段 ②",
    open: async (page) => {
      await page.goto("/ops/plans/new");
      await expect(page.getByTestId("plan-form")).toBeVisible();
      await page.waitForLoadState("networkidle").catch(() => undefined);
      await fillStep(page, 1, { placeName: "N3 試験地点", lat: "35.123456", lng: "133.654321", radius: "120" });
      await tapNext(page);
      await expectStep(page, 2);
      await expect(page.getByTestId("plan-start-date")).toBeVisible();
    },
  },
];

test.describe("N3-4・N3-5 日付・時刻の入力", () => {
  for (const sc of DATE_SCREENS) {
    test(`N3-4 ${sc.name}：320 幅・文字 200% で入れ物の切れ 0・横スクロール 0。値の全文が見える`, async ({ page }) => {
      await signIn(page.request, seeded("a-manager"));
      await resize(page, 320);
      await sc.open(page);
      await waitForSettledStyles(page);
      await zoomTo(page, 200);
      const inputs = await probeDateInputs(page);
      const doc = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
      note("n3-4", `${sc.name} 320・200%: ${inputs.map((x) => `${x.id}=${x.value || "(空)"} ${x.cw}/${x.sw}（要 ${x.need.toFixed(0)}・余 ${x.avail.toFixed(0)}）`).join(" ; ")}・文書 ${doc.sw}/${doc.cw}`);
      expect(inputs.length, "日付・時刻の入力欄がある").toBeGreaterThan(0);
      expect(inputs.filter((x) => x.clipped).map((x) => `${x.id} ${x.cw}<${x.sw}`), "入れ物の切れ").toEqual([]);
      expect(inputs.filter((x) => x.overlap).map((x) => `${x.id} 余 ${x.avail.toFixed(1)} < 要 ${x.need.toFixed(1)}`), "値とカレンダーの絵が収まらない").toEqual([]);
      expect(doc.sw, "文書の横スクロール").toBeLessThanOrEqual(doc.cw);
    });
  }

  for (const w of [360, 375, 390]) {
    for (const z of [100, 200]) {
      test(`N3-5 ${w} 幅・文字 ${z}%：点検・飛行記録・計画作成の日付欄で、値の文字とカレンダーの絵が重ならない`, async ({ page }) => {
        await signIn(page.request, seeded("a-manager"));
        await resize(page, w);
        for (const sc of DATE_SCREENS) {
          await sc.open(page);
          await waitForSettledStyles(page);
          if (z !== 100) await zoomTo(page, z);
          const inputs = (await probeDateInputs(page)).filter((x) => x.type === "date");
          note("n3-5", `${sc.name} ${w}・${z}%: ${inputs.map((x) => `${x.id}=${x.value || "(空)"} 余 ${x.avail.toFixed(1)} 要 ${x.need.toFixed(1)}（値 ${x.textW.toFixed(1)}＋絵と間 ${x.extra.toFixed(1)}）`).join(" ; ")}`);
          expect(inputs.length, `${sc.name}: 日付欄がある`).toBeGreaterThan(0);
          expect(inputs.filter((x) => x.overlap).map((x) => `${x.id} 余 ${x.avail.toFixed(1)} < 要 ${x.need.toFixed(1)}`), `${sc.name} ${w}・${z}%`).toEqual([]);
          expect(inputs.filter((x) => x.clipped).map((x) => x.id), `${sc.name}: 入れ物の切れ`).toEqual([]);
        }
      });
    }
  }
});

// ---------------------------------------------------------------- N3-6
for (const w of [320, 360, 390]) {
  for (const z of [100, 200]) {
    test(`N3-6 header の「そらばん」が欠けない（${w}px・文字 ${z}%）。header の部品は 48px 以上`, async ({ page }) => {
      await signIn(page.request, seeded("a-manager"));
      await resize(page, w);
      await page.goto("/ops");
      await expect(page.getByTestId("ops-brand-mark")).toBeVisible();
      await waitForSettledStyles(page);
      if (z !== 100) await zoomTo(page, z);
      const r = await page.evaluate(() => {
        const vw = document.documentElement.clientWidth;
        const mark = document.querySelector<HTMLElement>('[data-testid="ops-brand-mark"]')!;
        const spans = Array.from(mark.querySelectorAll<HTMLElement>("span")).map((s) => {
          const b = s.getBoundingClientRect();
          return { text: s.textContent, left: b.left, right: b.right, sw: s.scrollWidth, cw: s.clientWidth, rects: s.getClientRects().length, lines: Math.round(b.height / parseFloat(getComputedStyle(s).lineHeight)) };
        });
        const m = mark.getBoundingClientRect();
        const btn = document.querySelector<HTMLElement>('[data-testid="user-menu-button"]')!.getBoundingClientRect();
        const header = document.querySelector<HTMLElement>('[data-testid="ops-header"]')!;
        const hr = header.getBoundingClientRect();
        return { vw, spans, mark: { left: m.left, right: m.right, h: m.height }, btn: { left: btn.left, right: btn.right, w: btn.width, h: btn.height }, header: { h: hr.height, sw: header.scrollWidth, cw: header.clientWidth }, docSw: document.documentElement.scrollWidth };
      });
      note("n3-6", `${w}・${z}%: ${r.spans.map((s) => `「${s.text}」 ${s.left.toFixed(0)}〜${s.right.toFixed(0)}（${s.cw}/${s.sw}・${s.lines} 行）`).join(" ; ")}・ボタン ${r.btn.left.toFixed(0)}〜${r.btn.right.toFixed(0)}（${r.btn.w.toFixed(0)}×${r.btn.h.toFixed(0)}）・header 高さ ${r.header.h.toFixed(0)}`);
      const word = r.spans.find((s) => s.text === "そらばん");
      expect(word, "「そらばん」の文字の要素").toBeTruthy();
      for (const s of r.spans) {
        expect(s.sw, `「${s.text}」の中身が切れている（scrollWidth ≦ clientWidth + 1）`).toBeLessThanOrEqual(s.cw + 1);
        expect(s.left, `「${s.text}」の左端`).toBeGreaterThanOrEqual(0);
        expect(s.right, `「${s.text}」の右端が表示の幅の中`).toBeLessThanOrEqual(r.vw);
      }
      expect(word!.right, "「そらばん」は利用者メニューのボタンと重ならない").toBeLessThanOrEqual(r.btn.left + 0.5);
      expect(r.btn.w, "利用者メニューのボタン").toBeGreaterThanOrEqual(48);
      expect(r.btn.h, "利用者メニューのボタン").toBeGreaterThanOrEqual(48);
      expect(r.mark.h, "ロゴのリンクの高さ（押す部品）").toBeGreaterThanOrEqual(48);
      expect(r.header.sw, "header の横スクロール").toBeLessThanOrEqual(r.header.cw);
      expect(r.docSw, "文書の横スクロール").toBeLessThanOrEqual(r.vw);
    });
  }
}

// ---------------------------------------------------------------- N3-7
test("N3-7 準備カードの名前は見出しの文だけ。中の操作は読み上げで 1 回ずつ使える", async ({ page }) => {
  const manager = await apiAs(seeded("b-manager"));
  await signIn(page.request, seeded("b-manager"));
  const aircraft = await createAircraft(manager);
  const bp = await apiAs(seeded("b-pilot"));
  const me = (await (await bp.get("/api/ops/me")).json()) as { pilotId: string };
  await bp.dispose();
  const plan = await createPlan(manager, aircraft.id, me.pilotId, { title: `準備カード ${stamp}`, hour: 14 });
  await page.goto("/ops");
  const card = page.getByTestId("home-prep");
  await expect(card).toBeVisible();
  const heading = (await page.getByTestId("home-prep-title").innerText()).trim();
  expect(heading).toBe("次の飛行の準備");
  // カードの名前（アクセシビリティの木）は見出しの文だけ。以前の「通報、…。点検、…。」の 1 文は名前に使わない
  const named = page.getByRole("region", { name: heading, exact: true });
  await expect(named).toHaveCount(1);
  const snap = await named.ariaSnapshot();
  note("n3-7", snap.replaceAll("\n", " ⏎ ").slice(0, 600));
  expect(snap.split("\n")[0], "カードの名前の行").toBe(`- region "${heading}":`);
  const labelAttr = await card.getAttribute("aria-label");
  expect(labelAttr, "aria-label を使わない（aria-labelledby にする）").toBeNull();
  const by = await card.getAttribute("aria-labelledby");
  expect(by, "aria-labelledby が見出しの id").toBeTruthy();
  expect(await page.locator(`[id="${by}"]`).innerText()).toBe(heading);
  // 中の文字は、カードの名前（見出し）と別に、行ごとに 1 回ずつ読まれる（名前に同じ文が入っていない）
  const rows = await card.locator("li").count();
  expect(rows).toBe(3);
  for (const id of ["report", "inspection", "judgement"]) {
    const text = (await page.getByTestId(`home-prep-${id}-text`).innerText()).trim();
    expect(snap.split(text).length - 1, `行「${id}」の文は木に 1 回`).toBe(1);
  }
  // 中の操作（リンク・ボタン）は、DOM の数と、アクセシビリティの木の数が同じ（隠れていない）
  const ops = await card.locator("a[href], button").count();
  const inTree = (snap.match(/- (link|button) /g) ?? []).length;
  expect(inTree, "中の操作の数").toBe(ops);
  await manager.dispose();
  void plan;
});

// ---------------------------------------------------------------- N3-8
test.describe("N3-8 ホームの余裕", () => {
  test.use({ viewport: { width: 375, height: 812 } });
  test("375×812：計画の題が 2 行・期限の対象が 40 字でも、クイック操作の下端とナビの上端の間 8px 以上", async ({ page }) => {
    const bm = await apiAs(seeded("b-manager"));
    // 組織 B の今日以降の計画を片付ける（他の検査の計画を巻き込まない：この試験が作ったものだけ）
    const aircraft = await createAircraft(bm);
    const bp = await apiAs(seeded("b-pilot"));
    const me = (await (await bp.get("/api/ops/me")).json()) as { pilotId: string };
    await bp.dispose();
    const longTitle = `橋梁の定期点検と河川敷の空撮の合同飛行 ${stamp}`;
    const plan = await createPlan(bm, aircraft.id, me.pilotId, { title: longTitle, hour: 13 });
    const name40 = `四十字の氏名で期限の対象を長くする試験操縦者${stamp}ＡＢＣＤＥＦＧＨＩＪＫＬ`.slice(0, 40);
    expect(name40.length).toBe(40);
    await createPilot(bm, name40, "2027-01-06");
    await signIn(page.request, seeded("b-manager"));
    await page.goto("/ops");
    await expect(page.getByTestId("home-prep")).toBeVisible();
    await waitForSettledStyles(page);
    const m = await page.evaluate(() => {
      const title = document.querySelector<HTMLElement>('[data-testid="today-heading"]')!;
      const next = document.querySelector<HTMLElement>('[data-testid="home-next"]');
      const nextTitle = document.querySelector<HTMLElement>('[data-testid="home-next-title"]');
      const q = document.querySelector<HTMLElement>('[data-testid="home-quick"]')!.getBoundingClientRect();
      const nav = document.querySelector<HTMLElement>('[data-testid="ops-bottom-nav"]')!.getBoundingClientRect();
      const dl = document.querySelector<HTMLElement>('[data-testid="deadline-row"]');
      const lh = (e: HTMLElement | null) => (e ? Math.round(e.getBoundingClientRect().height / parseFloat(getComputedStyle(e).lineHeight)) : 0);
      return { scrollY: window.scrollY, quickBottom: q.bottom, navTop: nav.top, margin: nav.top - q.bottom, titleLines: lh(nextTitle ?? title), deadlineText: dl?.textContent?.replace(/\s+/g, " ").trim().slice(0, 90) ?? "(なし)", deadlineLines: lh(dl) };
    });
    note("n3-8", `余裕 ${m.margin.toFixed(2)}px（クイック下端 ${m.quickBottom.toFixed(1)}・ナビ上端 ${m.navTop.toFixed(1)}）・題の行数 ${m.titleLines}・期限 ${m.deadlineText}（${m.deadlineLines} 行相当）`);
    expect(m.scrollY).toBe(0);
    // 着手時の実測（基準 a12cef5）は -14.88px。designer が収めた（準備カードの見出しと日時を 1 行・上下の余白 10→8px。余裕 11.13px）。
    // 以前あった「8px 未満なら fixme で飛ばす」は外した（退行したら落ちる）。
    expect(m.margin, `クイック操作の下端とナビの上端の余裕 ${m.margin}px`).toBeGreaterThanOrEqual(8);
    void plan;
    await bm.dispose();
  });
});

// ---------------------------------------------------------------- ログアウトの確認の説明文（§17 の 30）
test.describe("ログアウトの確認：signout-keep の説明文", () => {
  for (const w of [320, 375]) {
    test.describe(`${w}`, () => {
      test.use({ viewport: { width: w, height: 812 } });
      test(`文の途中で折り返さない（文節のまとまりごとに折れる）。文言は変えない（${w}px）`, async ({ page, context }) => {
        const { manager, plan } = await prepare(page);
        await openField(page, plan.id);
        // 圏外で押して、端末に送信待ちを 1 件作る（サーバーには届かない）。ログアウトの確認が出る
        await context.setOffline(true);
        await page.getByTestId("field-flight-button").click();
        await expect(page.getByTestId("field-unsent")).toContainText("未送信 1 件");
        await context.setOffline(false);
        await page.goto("/ops/more");
        await expect(async () => {
          await page.getByTestId("user-menu-button").click();
          await page.getByTestId("signout").click();
          await expect(page.getByTestId("signout-warning")).toBeVisible({ timeout: 2000 });
        }).toPass({ timeout: 20_000 });
        await waitForSettledStyles(page);
        const keep = page.getByTestId("signout-keep");
        await expect(keep).toContainText("（先読みは消します。同じ人がログインすると続きを送ります）");
        const r = await keep.evaluate((btn) => {
          const note = btn.querySelector<HTMLElement>("span:last-child")!;
          const segs = Array.from(note.querySelectorAll<HTMLElement>("span")).map((s) => {
            const cs = getComputedStyle(s);
            return { text: s.textContent, lines: Math.round(s.getBoundingClientRect().height / parseFloat(cs.lineHeight)), right: s.getBoundingClientRect().right };
          });
          return { text: note.textContent, segs, vw: document.documentElement.clientWidth, noteH: note.getBoundingClientRect().height, lh: parseFloat(getComputedStyle(note).lineHeight) };
        });
        note("signout-keep", `${w}: ${r.segs.map((s) => `「${s.text}」${s.lines} 行`).join(" / ")}・説明の高さ ${r.noteH.toFixed(1)}px`);
        expect(r.text).toBe("（先読みは消します。同じ人がログインすると続きを送ります）");
        expect(r.segs.length, "文節のまとまり").toBe(3);
        for (const s of r.segs) {
          expect(s.lines, `「${s.text}」は途中で折れない`).toBe(1);
          expect(s.right, `「${s.text}」の右端が画面の中`).toBeLessThanOrEqual(r.vw);
        }
        await manager.dispose();
      });
    });
  }
});

// ---------------------------------------------------------------- 判断して記録する項目（記録のみ。直すかは designer が決める）
// 契約の「判断して記録する項目」のうち、計画作成の 2 件の実測値を残す（検査はしない。値は注記とログに出る）。
//   ・320・文字 200% の段 ③〜⑤ で、進捗の帯と下部ナビが表示を占める割合（16-H2 L-1）
//   ・段 ② の日付の標準入力欄が最初の画面に入るか（§17 の 15）
// N3_SHOTS_DIR を与えたときだけ、各段の撮影をそのディレクトリへ書く。
test.describe("判断項目の実測（記録のみ）", () => {
  for (const [w, h] of [[320, 640], [360, 740]] as const) {
    test(`計画作成 ${w}×${h}・文字 200%：進捗の帯と下部ナビの占める割合・段 ② の日付欄の位置`, async ({ page }) => {
      await signIn(page.request, seeded("a-manager"));
      const manager = await apiAs(seeded("a-manager"));
      const aircraft = await createAircraft(manager);
      const pilot = await createPilot(manager);
      await resize(page, w, h);
      await page.goto("/ops/plans/new");
      await expect(page.getByTestId("plan-form")).toBeVisible();
      await page.waitForLoadState("networkidle").catch(() => undefined);
      const values = { placeName: "N3 判断項目の地点", lat: "35.123456", lng: "133.654321", radius: "120", date: "2027-01-05", time: "13:00", duration: "30", title: `N3 判断 ${stamp}`, purpose: "橋梁の点検", altitude: "60", aircraftId: aircraft.id, pilotId: pilot.id };
      const shotDir = process.env["N3_SHOTS_DIR"];
      for (let step = 1; step <= 5; step++) {
        await expectStep(page, step);
        await waitForSettledStyles(page);
        await zoomTo(page, 200);
        await page.evaluate(() => window.scrollTo(0, 0));
        const m = await page.evaluate(() => {
          const box = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`)?.getBoundingClientRect() ?? null;
          const prog = box("plan-wizard-progress-band");
          const nav = box("ops-bottom-nav");
          const date = box("plan-start-date");
          return { vh: window.innerHeight, progH: prog?.height ?? 0, progTop: prog?.top ?? 0, navH: nav?.height ?? 0, navTop: nav?.top ?? 0, dateTop: date?.top ?? null, dateBottom: date?.bottom ?? null };
        });
        const share = ((m.progH + m.navH) / m.vh) * 100;
        note("n3-judge", `${w}×${h}・200%・段 ${step}: 進捗の帯 ${m.progH.toFixed(0)}px + 下部ナビ ${m.navH.toFixed(0)}px = 表示の ${share.toFixed(1)}%${m.dateBottom !== null ? `・日付欄 ${m.dateTop!.toFixed(0)}〜${m.dateBottom.toFixed(0)}px（ナビ上端 ${m.navTop.toFixed(0)}px。${m.dateBottom <= m.navTop ? "最初の画面に入る" : "最初の画面に入らない"}）` : ""}`);
        if (shotDir) await page.screenshot({ path: `${shotDir}/wizard-step${step}-${w}-200.png` });
        await zoomTo(page, 100);
        if (step < 5) {
          await fillStep(page, step, values);
          await tapNext(page);
        }
      }
      await manager.dispose();
    });
  }
});
