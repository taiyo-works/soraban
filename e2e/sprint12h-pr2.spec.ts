import { devices, expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { expectFontSize, expectNoApplicationSupport, openDetails } from "./field-checks";
import { Meter, type Measure } from "./judge-measure";
import { BOUNDARY_SHORT } from "../apps/web/src/lib/boundary";

// Sprint 12h PR ②（docs/sprints/sprint-12h-pr2.md）：公開の判定画面 `/` の作り直し（デザインシステム v2）の E2E。
// 本番相当サーバー（baseURL）だけを使う。DB なし。Q 番号は契約の完了条件。
//   Q-8  タップ 44px（4 状態 × 375×812・360×740）／Q-9 判定の 5 段／Q-11 実画面のコントラスト／Q-12 最初の画面と結論の位置
//   Q-13 はみ出し 0（6 幅 × 明・暗）／Q-21 #35 の回帰（追加の 3 本）／Q-22 キーボード・ランドマーク／Q-24 根拠欄／Q-26 動き

const waitCheck = (page: Page) => page.waitForResponse((r) => r.url().endsWith("/api/check") && r.ok());
const waitDiagnose = (page: Page) =>
  page.waitForResponse((r) => r.url().endsWith("/api/diagnose") && r.ok());

const openReady = async (page: Page, url = "/"): Promise<void> => {
  const check = waitCheck(page);
  const diag = waitDiagnose(page);
  await page.goto(url);
  await Promise.all([check, diag]);
  await expect(page.getByTestId("evidence-id")).toHaveText(/^ev_[0-9a-f]{16}$/);
  await expect(page.getByTestId("verdict-level")).toBeVisible();
  await expect(page.locator(".maplibregl-canvas")).toBeVisible();
};

// ───────────────────────── Q-8 タップ 44px ─────────────────────────

type TapReport = { readonly tooSmall: string[]; readonly count: number; readonly tight: string[] };

/** `/` の押す部品（ボタン・リンクのボタン・入力欄・select・summary・タブ・層のチェック行・地図のボタン）の大きさを測る。文の中の語句のリンクは除く。 */
const measureTapTargets = (page: Page): Promise<TapReport> =>
  page.evaluate(() => {
    const describe = (el: Element): string => {
      const t = (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 24);
      const id = (el as HTMLElement).dataset?.["testid"];
      return `${el.tagName.toLowerCase()}${id ? `[${id}]` : ""}${el.className && typeof el.className === "string" ? "." + el.className.split(" ").slice(0, 2).join(".") : ""} 「${t}」`;
    };
    const visible = (el: Element): boolean => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      // 閉じた details の中身（content-visibility: hidden）は、箱があっても見えていない
      const shown = (el as HTMLElement).checkVisibility?.({ checkVisibilityCSS: true, contentVisibilityAuto: true }) ?? true;
      return shown && r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none";
    };
    const isSr = (el: Element): boolean => !!el.closest(".sb-sr, .sr-only");
    // 文の中の語句のリンク：段落（p・li・dd・span）の中で、前後に文字があるインラインのリンク
    const inSentence = (a: Element): boolean => {
      if (a.tagName !== "A") return false;
      if (getComputedStyle(a).display !== "inline") return false;
      const parent = a.parentElement;
      if (!parent) return false;
      const own = Array.from(parent.childNodes)
        .filter((n) => n !== a)
        .map((n) => (n.nodeType === Node.TEXT_NODE ? (n.textContent ?? "") : n instanceof HTMLElement ? n.innerText : ""))
        .join("")
        .trim();
      return own.length > 0;
    };
    const candidates = Array.from(
      document.querySelectorAll<HTMLElement>(
        'a[href], button, select, textarea, summary, [role="tab"], [role="button"], input:not([type="hidden"]), label',
      ),
    ).filter((el) => {
      if (!visible(el) || isSr(el)) return false;
      if (el.tagName === "LABEL") {
        // 押す部品になるのは、チェック・ラジオを持つ行（label）。入力欄に付けただけの label（文字の見出し）は除く
        const c = el.querySelector('input[type="checkbox"], input[type="radio"]');
        return !!c;
      }
      if (el.tagName === "INPUT") {
        const t = (el as HTMLInputElement).type;
        if (t === "checkbox" || t === "radio") return false; // 行（label）で測る
      }
      if (el.closest(".maplibregl-ctrl-attrib") && el.tagName === "A") return false; // 出典表記の文中のリンク
      if (inSentence(el)) return false;
      return true;
    });
    const tooSmall: string[] = [];
    const rects: Array<{ el: Element; r: DOMRect }> = [];
    for (const el of candidates) {
      const r = el.getBoundingClientRect();
      rects.push({ el, r });
      if (r.width < 43.5 || r.height < 43.5) tooSmall.push(`${describe(el)} ${Math.round(r.width * 10) / 10}×${Math.round(r.height * 10) / 10}`);
    }
    // 押す部品どうしの間隔は 8px 以上（案）：重ならず、隣り合う（縦か横で重なる）のに 8px 未満の組
    const tight: string[] = [];
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i]!;
        const b = rects[j]!;
        if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
        const overlapX = a.r.left < b.r.right && b.r.left < a.r.right;
        const overlapY = a.r.top < b.r.bottom && b.r.top < a.r.bottom;
        const gapX = Math.max(b.r.left - a.r.right, a.r.left - b.r.right);
        const gapY = Math.max(b.r.top - a.r.bottom, a.r.top - b.r.bottom);
        if ((overlapY && gapX >= 0 && gapX < 7.5) || (overlapX && gapY >= 0 && gapY < 7.5)) {
          if (a.el.closest(".maplibregl-ctrl-group") && b.el.closest(".maplibregl-ctrl-group")) continue; // 地図の部品のグループ内
          tight.push(`${describe(a.el)} ↔ ${describe(b.el)} 間隔 ${Math.round(Math.min(overlapY ? gapX : 99, overlapX ? gapY : 99))}px`);
        }
      }
    }
    return { tooSmall, count: candidates.length, tight };
  });

const geoContext = async (browser: Browser, baseURL: string | undefined, viewport: { width: number; height: number }): Promise<BrowserContext> =>
  browser.newContext({
    baseURL,
    viewport,
    geolocation: { latitude: 35.4400123, longitude: 133.3500456, accuracy: 150 },
    permissions: ["geolocation"],
  });

test.describe("Q-8 タップ 44px（`/` の押す部品）", () => {
  for (const vp of [
    { width: 375, height: 812 },
    { width: 360, height: 740 },
  ]) {
    test(`${vp.width}×${vp.height}：初期・結果表示後・層の一覧を開いたとき・確認のパネルの 4 状態で、押す部品が幅・高さとも 43.5px 以上で、部品どうしの間隔が 8px 以上`, async ({ browser, baseURL }, testInfo) => {
      const ctx = await geoContext(browser, baseURL, vp);
      const page = await ctx.newPage();
      // 1 初期（判定の結果が出る前の最初の描画）。通信を止めて、結果の出ていない状態を測る
      await page.route("**/api/check", (r) => r.abort());
      await page.route("**/api/diagnose", (r) => r.abort());
      await page.goto("/");
      await expect(page.getByTestId("current-location-button")).toBeVisible();
      await expect(page.locator(".maplibregl-canvas")).toBeVisible();
      const initial = await measureTapTargets(page);
      await page.unroute("**/api/check");
      await page.unroute("**/api/diagnose");

      // 2 結果表示後
      await openReady(page);
      const result = await measureTapTargets(page);

      // 3 層の一覧（出典と状態）と条件の折りたたみを開いたとき
      await page.locator("summary", { hasText: "各層の出典と状態" }).click();
      await page.locator("details", { hasText: "機体・運航条件" }).locator("summary").first().click();
      const opened = await measureTapTargets(page);

      // 4 確認のパネル（精度 100m 超）
      await page.getByTestId("current-location-button").click();
      await expect(page.getByTestId("current-location-candidate")).toBeVisible();
      const confirm = await measureTapTargets(page);

      const all = { 初期: initial, 結果表示後: result, 層の一覧を開いたとき: opened, 確認のパネル: confirm };
      await testInfo.attach("tap-report", { body: JSON.stringify(all, null, 2), contentType: "application/json" });
      for (const [name, rep] of Object.entries(all)) {
        expect(rep.count, `${name}：測った部品の数`).toBeGreaterThan(8);
        expect(rep.tooSmall, `${name}：43.5px 未満の部品`).toEqual([]);
        expect(rep.tight, `${name}：間隔が 8px 未満の押す部品の組`).toEqual([]);
      }
      await ctx.close();
    });
  }
});

// ───────────────────────── Q-9 判定の 5 段 ─────────────────────────

test.describe("Q-9 判定の 5 段（形と語。橙は使わない）", () => {
  for (const scheme of ["light", "dark"] as const) {
    test(`${scheme}：見分け方の札が 5 つあり、形（svg）・語・色がそれぞれ別。橙の塗りの札・印がない`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width: 375, height: 812 });
      await openReady(page);
      const tags = page.getByTestId("verdict-legend").locator(".sb-vtag");
      await expect(tags).toHaveCount(5);
      const info = await tags.evaluateAll((els) =>
        els.map((e) => ({
          text: (e.textContent ?? "").trim(),
          shape: e.querySelector("svg")?.innerHTML ?? "",
          bg: getComputedStyle(e).backgroundColor,
          key: e.getAttribute("data-verdict-key"),
        })),
      );
      const texts = info.map((i) => i.text);
      for (const w of ["飛行不可", "要手続き", "手続き済み", "手続き不要", "判定不能"]) expect(texts.some((t) => t.includes(w)), `語 ${w}`).toBe(true);
      expect(new Set(info.map((i) => i.shape)).size, "形が 5 つとも別").toBe(5);
      expect(new Set(info.map((i) => i.text)).size, "語が 5 つとも別").toBe(5);
      expect(new Set(info.map((i) => i.key)).size).toBe(5);
      for (const i of info) {
        expect(i.shape.length, `${i.text} の形`).toBeGreaterThan(20);
        expect(i.bg, `${i.text} は橙の塗りでない`).not.toBe("rgb(248, 155, 72)");
        expect(i.bg).not.toBe("rgb(255, 193, 137)");
      }
      // 結論の大きな印・規制ごとの札も橙でない
      const orange = await page.evaluate(() =>
        Array.from(document.querySelectorAll(".sb-vtag, .sb-v-big, [data-testid='regulation-verdict']")).filter((e) => {
          const c = getComputedStyle(e).backgroundColor;
          return c === "rgb(248, 155, 72)" || c === "rgb(255, 193, 137)";
        }).length,
      );
      expect(orange).toBe(0);
    });
  }

  test("グレースケール（彩度 0）にしても、結論の語と形が読める（形と語が色に頼らない）", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await openReady(page);
    await page.addStyleTag({ content: "html{filter:grayscale(1)}" });
    const level = page.getByTestId("verdict-level");
    await expect(level).toHaveText(/要手続き|飛行不可|手続き不要|手続き済み|判定不能/);
    await expect(page.getByTestId("verdict-conclusion").locator("svg").first()).toBeVisible();
    // 結論の語は、塗りの色でなく文字として出ている（読み上げ・グレースケールでも同じ）
    expect((await level.innerText()).length).toBeGreaterThan(2);
  });
});

// ───────────────────────── Q-11 実画面のコントラスト ─────────────────────────

/** 文字の実際の描画色と、その背後の色（祖先の背景を重ねて求める）のコントラスト比が足りない要素を返す。挿絵の上は空の淡い範囲で測る。 */
const lowContrastText = (page: Page) =>
  page.evaluate(() => {
    const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
    const toRgba = (c: string): [number, number, number, number] => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = "rgba(0,0,0,0)";
      ctx.fillStyle = c;
      ctx.fillRect(0, 0, 1, 1);
      const d = ctx.getImageData(0, 0, 1, 1).data;
      return [d[0]!, d[1]!, d[2]!, d[3]! / 255];
    };
    const lum = (r: number, g: number, b: number) => {
      const f = (v: number) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const ratio = (a: number[], b: number[]) => {
      const x = lum(a[0]!, a[1]!, a[2]!);
      const y = lum(b[0]!, b[1]!, b[2]!);
      return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
    };
    const root = getComputedStyle(document.documentElement);
    const skyColors = [root.getPropertyValue("--sb-art-sky").trim()].map((c) => toRgba(c));
    const bgOf = (el: Element): number[] | "art" | "map" => {
      // 後ろの色：祖先を上へたどり、不透明な背景に着くまで重ねる
      const layers: Array<[number, number, number, number]> = [];
      for (let e: Element | null = el; e; e = e.parentElement) {
        if (e.matches(".sb-hero")) return "art";
        if (e.matches(".sb-map-frame .maplibregl-canvas-container, .maplibregl-canvas-container")) return "map";
        const bg = toRgba(getComputedStyle(e).backgroundColor);
        if (bg[3] > 0) layers.push(bg);
        if (bg[3] >= 1) break;
      }
      let base: number[] = toRgba(getComputedStyle(document.body).backgroundColor).slice(0, 3);
      for (const l of layers.reverse()) base = [0, 1, 2].map((i) => l[i]! * l[3] + base[i]! * (1 - l[3]));
      return base;
    };
    const bad: string[] = [];
    let checked = 0;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const seen = new Set<Element>();
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement;
      if (!el || seen.has(el)) continue;
      if (!(n.textContent ?? "").trim()) continue;
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || cs.visibility === "hidden" || cs.display === "none") continue;
      if (el.closest(".sb-sr, .sr-only, script, style, [aria-hidden='true'], .maplibregl-canvas-container, .maplibregl-ctrl-attrib")) continue;
      seen.add(el);
      const fg = toRgba(cs.color);
      let opacity = 1;
      for (let e: Element | null = el; e; e = e.parentElement) opacity *= Number(getComputedStyle(e).opacity);
      if (opacity < 0.99) continue; // せり上がりの途中など
      const bg = bgOf(el);
      const px = parseFloat(cs.fontSize);
      const bold = Number(cs.fontWeight) >= 700;
      const need = px >= 24 || (px >= 18.66 && bold) ? 3 : 4.5;
      let worst: number;
      if (bg === "art") worst = Math.min(...skyColors.map((s) => ratio(fg, s)));
      else if (bg === "map") continue;
      else worst = ratio(fg, bg);
      checked++;
      if (worst < need) bad.push(`${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0]} 「${(n.textContent ?? "").trim().slice(0, 18)}」 ${worst.toFixed(2)} < ${need}（${cs.color}）`);
    }
    return { bad, checked };
  });

/** 枠・アイコン・チェックの色（縁の edge・チェックの輪郭・判定の印）が地に対して 3:1 以上。 */
const lowContrastShapes = (page: Page) =>
  page.evaluate(() => {
    const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
    const toRgba = (c: string): [number, number, number, number] => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = "rgba(0,0,0,0)";
      ctx.fillStyle = c;
      ctx.fillRect(0, 0, 1, 1);
      const d = ctx.getImageData(0, 0, 1, 1).data;
      return [d[0]!, d[1]!, d[2]!, d[3]! / 255];
    };
    const lum = (c: number[]) => {
      const f = (v: number) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(c[0]!) + 0.7152 * f(c[1]!) + 0.0722 * f(c[2]!);
    };
    const ratio = (a: number[], b: number[]) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
    const groundOf = (el: Element): number[] => {
      for (let e: Element | null = el.parentElement; e; e = e.parentElement) {
        const bg = toRgba(getComputedStyle(e).backgroundColor);
        if (bg[3] >= 1) return bg;
      }
      return toRgba(getComputedStyle(document.body).backgroundColor);
    };
    const bad: string[] = [];
    // 入力欄・select の縁、チェックの枠、層のチップの縁（ON の墨・OFF の破線）、副ボタンの縁
    const sel = "input.sb-input, select.sb-input, input.sb-check, .sb-layer, .sb-pill-secondary, .sb-text-btn";
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const cs = getComputedStyle(el);
      const border = toRgba(cs.borderTopColor);
      if (parseFloat(cs.borderTopWidth) < 1 || border[3] === 0) continue;
      // 縁は、外側の地に対して 3:1（部品の境が見える）。面の色（橙のチェックなど）は縁の内側で、縁との比は要件にしない
      const outer = groundOf(el);
      if (ratio(border, outer) < 3 - 1e-9) bad.push(`${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0]} 縁/地 ${ratio(border, outer).toFixed(2)}`);
    }
    // 判定の印（色は currentColor。塗りの上の色と、塗りが地に対して 3:1、または 2px の枠つき）
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(".sb-vtag svg, .sb-v-big svg"))) {
      const host = el.parentElement!;
      const fillOrGround = toRgba(getComputedStyle(host).backgroundColor);
      const mark = toRgba(getComputedStyle(el).color);
      const ground = fillOrGround[3] >= 1 ? fillOrGround : groundOf(host);
      if (ratio(mark, ground) < 3 - 1e-9) bad.push(`印 ${host.textContent?.trim().slice(0, 8)} ${ratio(mark, ground).toFixed(2)}`);
    }
    return bad;
  });

test.describe("Q-11 実画面のコントラスト（文字 4.5:1・大きい文字 3:1・枠と印 3:1）", () => {
  for (const vp of [
    { width: 375, height: 812 },
    { width: 1280, height: 800 },
  ]) {
    for (const scheme of ["light", "dark"] as const) {
      test(`${vp.width}px・${scheme}`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: scheme });
        await page.setViewportSize(vp);
        await openReady(page);
        // 隠れている説明・条件を開いて、全部の文字を測る
        for (const s of await page.locator("details > summary").all()) await s.click();
        await page.waitForTimeout(300);
        const text = await lowContrastText(page);
        expect(text.checked, "測った文字の要素数").toBeGreaterThan(80);
        expect(text.bad, `文字のコントラスト不足（${text.checked} 要素）`).toEqual([]);
        expect(await lowContrastShapes(page), "枠・印のコントラスト不足").toEqual([]);
      });
    }
  }
});

// ───────────────────────── Q-12 最初の画面と結論の位置 ─────────────────────────

test.describe("Q-12 375×812 の最初の画面", () => {
  test("免責の短文（site-disclaimer）・住所の入力欄・「この地点を判定する」「現在地で判定」の 2 つのボタンが最初の画面に入り、結論は 1 回のスクロール（1 画面分以内）で見える", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await openReady(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(page.getByTestId("site-disclaimer")).toBeInViewport({ ratio: 1 });
    await expect(page.locator("#address-input")).toBeInViewport({ ratio: 1 });
    await expect(page.getByRole("button", { name: /この地点を判定する/ })).toBeInViewport({ ratio: 1 });
    await expect(page.getByTestId("current-location-button")).toBeInViewport({ ratio: 1 });
    await expect(page.getByTestId("current-location-button")).toContainText("現在地で判定");
    // 結論は入力の直下（契約 §6.2 の順：入力 → 結論 → 地図）。最初の画面（812px）のすぐ下で、1 画面分のスクロールで見出しごと入る
    const top = await page.getByTestId("verdict-conclusion").evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
    await testInfo.attach("conclusion-top", { body: String(Math.round(top)), contentType: "text/plain" });
    expect(top, "結論の上端（ページ上の位置）").toBeLessThanOrEqual(812 + 200);
    await page.evaluate(() => window.scrollTo(0, 812));
    await expect(page.locator("#verdict-heading")).toBeInViewport({ ratio: 1 });
  });
});

// ───────────────────────── B1 判定したあと結論が画面に入る（評価 B1。モバイル端末の模擬） ─────────────────────────

// 実機に近い条件：isMobile・hasTouch・小さめの高さ（ブラウザの上下の帯を引いたあとの見える高さ）。375×812 の模擬ではなく端末の定義を使う。
const MOBILES = [
  { name: "iPhone SE 第 3 世代（375×667）", use: devices["iPhone SE (3rd gen)"] },
  { name: "iPhone SE 第 1 世代（320×568）", use: devices["iPhone SE"] },
  { name: "Pixel 5（393×727）", use: devices["Pixel 5"] },
] as const;

const conclusionPos = (page: Page) =>
  page.evaluate(() => {
    const el = document.querySelector('[data-testid="verdict-conclusion"]');
    const r = el?.getBoundingClientRect();
    return { top: r ? r.top : null, bottom: r ? r.bottom : null, vh: window.innerHeight, scrollY: window.scrollY, focus: (document.activeElement as HTMLElement | null)?.id ?? "" };
  });

// 滑らかなスクロールの着地を待つ。地図を先に画面へ入れると結論は一旦画面の上（top が負）にあり、
// 「半分より上」だけだとその負の値が通り、着地（scroll-margin-top: 12px）の前の数 px を拾う。
// 着地後の上端は 0 以上かつ画面の上半分。返した値は、その条件が真だったときの位置。
const expectConclusionEntered = async (page: Page, viewportHeight: number) => {
  let pos = await conclusionPos(page);
  await expect
    .poll(
      async () => {
        pos = await conclusionPos(page);
        const top = pos.top ?? -1;
        return top >= 0 && top < viewportHeight * 0.5;
      },
      { message: "結論の上端が画面の上半分に入っている" },
    )
    .toBe(true);
  return pos;
};

test.describe("B1 判定したあと、結論が画面に入る（スクロールを待たない・フォーカスも結論の見出しへ）", () => {
  for (const m of MOBILES) {
    test(`${m.name}：初期表示で、結論は 1 画面分のスクロールで見出しごと入る（余裕あり）`, async ({ browser }) => {
      const ctx = await browser.newContext({ ...m.use });
      const page = await ctx.newPage();
      await openReady(page);
      const initial = await conclusionPos(page);
      expect(initial.scrollY, "開いただけではスクロールしない").toBe(0);
      // 1 画面分（vh）スクロールして、結論の見出しが画面の上半分に入る（5px の差に頼らない）
      await page.evaluate(() => window.scrollBy(0, window.innerHeight));
      const after = await page.locator("#verdict-heading").evaluate((el) => {
        const r = el.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom };
      });
      expect(after.top, "1 画面分スクロールした後の見出しの上端").toBeGreaterThan(0);
      // 見出しの下端も画面に入り、下に余裕（結論の語・形が見える）がある
      expect(after.bottom, "1 画面分スクロールした後の見出しの下端").toBeLessThan(initial.vh - 80);
      await ctx.close();
    });

    test(`${m.name}：「この地点を判定する」を押すと、結論の上端が画面に入り、フォーカスが結論の見出しへ移る`, async ({ browser }) => {
      const ctx = await browser.newContext({ ...m.use });
      const page = await ctx.newPage();
      await openReady(page);
      await page.getByLabel("住所または緯度・経度").fill("35.4278, 133.3314");
      const check = waitCheck(page);
      const diag = waitDiagnose(page);
      await page.getByRole("button", { name: "この地点を判定する" }).click();
      await Promise.all([check, diag]);
      await expect(page.locator("#verdict-heading")).toBeFocused();
      const pos = await expectConclusionEntered(page, m.use.viewport!.height);
      expect(pos.scrollY, "スクロールした").toBeGreaterThan(0);
      await ctx.close();
    });

    test(`${m.name}：地図をクリックして地点を選ぶと、同じように結論が画面に入る`, async ({ browser }) => {
      const ctx = await browser.newContext({ ...m.use });
      const page = await ctx.newPage();
      await openReady(page);
      const map = page.getByTestId("regulation-map");
      await map.scrollIntoViewIfNeeded();
      const check = waitCheck(page);
      const diag = waitDiagnose(page);
      // 地図の左上寄りを押す（ズームボタン・帰属の外）
      const box = (await map.boundingBox())!;
      await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.6);
      await Promise.all([check, diag]);
      await expect(page.locator("#verdict-heading")).toBeFocused();
      await expectConclusionEntered(page, m.use.viewport!.height);
      await ctx.close();
    });
  }

  test("動きを減らす設定と現場モードでは、結論へ瞬間に移る（滑らかなスクロールにしない）", async ({ browser }) => {
    for (const mode of ["reduce", "field"] as const) {
      const ctx = await browser.newContext({ ...devices["Pixel 5"], reducedMotion: mode === "reduce" ? "reduce" : "no-preference" });
      const page = await ctx.newPage();
      await openReady(page);
      if (mode === "field") await page.evaluate(() => document.documentElement.setAttribute("data-mode", "field"));
      // scrollIntoView の behavior を記録する（instant＝auto）
      await page.evaluate(() => {
        const orig = Element.prototype.scrollIntoView;
        (window as unknown as { __behaviors: string[] }).__behaviors = [];
        Element.prototype.scrollIntoView = function (arg?: boolean | ScrollIntoViewOptions) {
          (window as unknown as { __behaviors: string[] }).__behaviors.push(typeof arg === "object" && arg ? String(arg.behavior) : "none");
          return orig.call(this, arg as ScrollIntoViewOptions);
        };
      });
      await page.getByLabel("住所または緯度・経度").fill("35.4278, 133.3314");
      const check = waitCheck(page);
      await page.getByRole("button", { name: "この地点を判定する" }).click();
      await check;
      await expect(page.locator("#verdict-heading")).toBeFocused();
      const behaviors = await page.evaluate(() => (window as unknown as { __behaviors: string[] }).__behaviors);
      expect(behaviors, mode).toEqual(["auto"]);
      await ctx.close();
    }
  });

  test("通常は滑らかに移る（smooth）。初回の自動判定では動かさない", async ({ browser }) => {
    const ctx = await browser.newContext({ ...devices["Pixel 5"] });
    const page = await ctx.newPage();
    await page.addInitScript(() => {
      const orig = Element.prototype.scrollIntoView;
      (window as unknown as { __behaviors: string[] }).__behaviors = [];
      Element.prototype.scrollIntoView = function (arg?: boolean | ScrollIntoViewOptions) {
        (window as unknown as { __behaviors: string[] }).__behaviors.push(typeof arg === "object" && arg ? String(arg.behavior) : "none");
        return orig.call(this, arg as ScrollIntoViewOptions);
      };
    });
    await openReady(page);
    expect(await page.evaluate(() => (window as unknown as { __behaviors: string[] }).__behaviors), "初回の自動判定").toEqual([]);
    await page.getByLabel("住所または緯度・経度").fill("35.4278, 133.3314");
    const check = waitCheck(page);
    await page.getByRole("button", { name: "この地点を判定する" }).click();
    await check;
    await expect(page.locator("#verdict-heading")).toBeFocused();
    expect(await page.evaluate(() => (window as unknown as { __behaviors: string[] }).__behaviors)).toEqual(["smooth"]);
    await ctx.close();
  });
});

// ───────────────────────── Q-13 はみ出し 0 ─────────────────────────

const overflowReport = (page: Page) =>
  page.evaluate(() => {
    const doc = document.documentElement;
    const bad: string[] = [];
    const sel = "button, a.sb-pill, .sb-pill, .sb-tag, .sb-vtag, .sb-layer, .sb-text-btn, .sb-status, h1, h2, h3, summary, label.sb-check-row, .sb-check-row";
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (el.closest(".sb-sr, .sr-only")) continue;
      // 文字が枠から出ない（切れない）
      if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== "visible") bad.push(`切れる: ${el.tagName}.${String(el.className).split(" ")[0]} 「${(el.textContent ?? "").trim().slice(0, 16)}」`);
      // 親の枠から出ない
      const parent = el.closest<HTMLElement>(".sb-block, .sb-item-card, .sb-block-soft, section, header, li") === el ? el.parentElement : el.closest<HTMLElement>(".sb-block, .sb-item-card, .sb-block-soft, section, header");
      if (parent) {
        const p = parent.getBoundingClientRect();
        if (r.right > p.right + 1 || r.left < p.left - 1) bad.push(`親からはみ出す: ${el.tagName}.${String(el.className).split(" ")[0]} 「${(el.textContent ?? "").trim().slice(0, 16)}」 ${Math.round(r.left)}-${Math.round(r.right)} / 親 ${Math.round(p.left)}-${Math.round(p.right)}`);
      }
      if (r.right > doc.clientWidth + 1) bad.push(`画面からはみ出す: ${el.tagName}.${String(el.className).split(" ")[0]} 右端 ${Math.round(r.right)}`);
    }
    return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth, bad };
  });

test.describe("Q-13 はみ出し 0", () => {
  for (const width of [360, 375, 768, 1024, 1280, 1440]) {
    for (const scheme of ["light", "dark"] as const) {
      test(`${width}px・${scheme}：横スクロールなし。文字・ボタン・チップが親の枠から出ない`, async ({ page }, testInfo) => {
        await page.emulateMedia({ colorScheme: scheme });
        await page.setViewportSize({ width, height: width < 700 ? 800 : 900 });
        await openReady(page);
        for (const s of await page.locator("details > summary").all()) await s.click();
        // 長い地点名・住所（折り返しの確認）
        await page.getByRole("button", { name: /松江城/ }).first().click();
        await expect(page.getByTestId("regulation-map")).toHaveAttribute("data-did-pref", "32", { timeout: 30_000 });
        await expect(page.getByTestId("verdict-level")).toBeVisible();
        const rep = await overflowReport(page);
        expect(rep.scrollWidth, "横スクロール").toBeLessThanOrEqual(rep.clientWidth);
        expect(rep.bad).toEqual([]);
        if (scheme === "light" && width >= 1024) {
          const w = await page.getByTestId("regulation-map").evaluate((el) => Math.round(el.getBoundingClientRect().width));
          await testInfo.attach("map-width", { body: `${width}px の画面で、地図の幅 ${w}px（未ログイン）`, contentType: "text/plain" });
        }
      });
    }
  }
});

// ───────────────────────── Q-21 #35 の回帰（追加の 3 本） ─────────────────────────

const map = (page: Page) => page.getByTestId("regulation-map");
const KEYS = ["airports", "did", "industrial", "base", "parks", "heritage", "sensitive"] as const;

test.describe("Q-21 地図の層（追加）", () => {
  test("(a) 画面幅を 1023↔1024px に切り替えた直後（地図のサイズ変更中）に層を切り替えても、地図に反映される", async ({ page }) => {
    await page.setViewportSize({ width: 1023, height: 900 });
    await openReady(page);
    await expect(map(page)).toHaveAttribute("data-did-pref", "31", { timeout: 60_000 });
    const did = page.getByLabel(/DID（航空法/);
    for (const width of [1024, 1023, 1024]) {
      await page.setViewportSize({ width, height: 900 });
      await did.uncheck();
      await expect(map(page)).toHaveAttribute("data-hidden-layers", "did", { timeout: 15_000 });
      await expect(map(page)).toHaveAttribute("data-layer-visibility", /did:none/, { timeout: 15_000 });
      await page.setViewportSize({ width: width === 1024 ? 1023 : 1024, height: 900 });
      await did.check();
      await expect(map(page)).toHaveAttribute("data-hidden-layers", "", { timeout: 15_000 });
      await expect(map(page)).toHaveAttribute("data-layer-visibility", /did:visible/, { timeout: 15_000 });
    }
  });

  test("(b) 7 層を 1 つずつ off／on し、data-hidden-layers と MapLibre から読み戻した実際の visibility が一致する", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openReady(page);
    await expect(map(page)).toHaveAttribute("data-did-pref", "31", { timeout: 60_000 });
    const checkboxes = page.getByTestId("layer-list").getByRole("checkbox");
    await expect(checkboxes).toHaveCount(7);
    // 一覧の順は、短いチップ → 幅いっぱいの行（飛行禁止法）。読み上げの名前で層を引く
    const names: Record<(typeof KEYS)[number], RegExp> = {
      airports: /空港等周辺/,
      did: /DID（航空法/,
      industrial: /工業専用地域/,
      base: /小型無人機等飛行禁止法 対象施設/,
      parks: /都市公園/,
      heritage: /指定史跡/,
      sensitive: /公衆密集地/,
    };
    for (const key of KEYS) {
      const box = page.getByTestId("layer-list").getByLabel(names[key]);
      await box.uncheck();
      await expect(map(page)).toHaveAttribute("data-hidden-layers", key, { timeout: 15_000 });
      const vis = await map(page).getAttribute("data-layer-visibility");
      const states = Object.fromEntries(vis!.split(",").map((p) => p.split(":") as [string, string]));
      expect(states[key], `${key} の実際の visibility`).toBe("none");
      for (const other of KEYS.filter((k) => k !== key)) expect(states[other], `${other}（${key} を消したとき）`).toBe("visible");
      await box.check();
      await expect(map(page)).toHaveAttribute("data-hidden-layers", "", { timeout: 15_000 });
      await expect(map(page)).toHaveAttribute("data-layer-visibility", new RegExp(`${key}:visible`), { timeout: 15_000 });
    }
    // 全部消して全部戻す
    for (const key of KEYS) await page.getByTestId("layer-list").getByLabel(names[key]).uncheck();
    await expect(map(page)).toHaveAttribute("data-hidden-layers", "airports,did,industrial,base,parks,heritage,sensitive", { timeout: 15_000 });
    const all = (await map(page).getAttribute("data-layer-visibility"))!.split(",").map((p) => p.split(":")[1]);
    expect(all.every((v) => v === "none")).toBe(true);
  });

  test("(c) 判定で島根県に移ると DID が島根県のものに替わり（data-did-pref）、スマホ幅・PC 幅のどちらでも同じ", async ({ page }) => {
    for (const width of [375, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await openReady(page);
      await expect(map(page)).toHaveAttribute("data-did-pref", "31", { timeout: 60_000 });
      await page.getByRole("button", { name: /松江城/ }).first().click();
      await expect(map(page)).toHaveAttribute("data-did-pref", "32", { timeout: 30_000 });
      await page.getByRole("button", { name: /米子市役所/ }).first().click();
      await expect(map(page)).toHaveAttribute("data-did-pref", "31", { timeout: 30_000 });
    }
  });
});

// ───────────────────────── Q-22 キーボード・ランドマーク ─────────────────────────

test.describe("Q-22 キーボードとランドマーク", () => {
  test("最初の Tab でスキップリンクが現れ、本文へ移る。main・header・見出しの階層がある。Tab 順は 入力 → 結論 → 地図 で、DOM の順と同じ", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await openReady(page);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "本文へ移動" });
    await expect(skip).toBeFocused();
    await expect(skip).toBeInViewport();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/#main$/);
    // ランドマークと見出し
    await expect(page.locator("main")).toHaveCount(1);
    await expect(page.locator("header").first()).toBeVisible();
    await expect(page.locator("h1")).toHaveCount(1);
    expect(await page.locator("h2").count()).toBeGreaterThanOrEqual(3);
    // DOM の順：入力欄 → 結論 → 地図（契約 §6.2。見た目の順と同じ）
    const order = await page.evaluate(() => {
      const pos = (sel: string): number => {
        const el = document.querySelector(sel);
        return el ? Array.from(document.querySelectorAll("*")).indexOf(el) : -1;
      };
      return [pos("#address-input"), pos('[data-testid="verdict-conclusion"]'), pos('[data-testid="regulation-map"]')];
    });
    expect(order[0]).toBeGreaterThan(-1);
    expect(order[1]).toBeGreaterThan(order[0]!);
    expect(order[2]).toBeGreaterThan(order[1]!);
    // Tab の順で、入力欄 → 現在地 → 地図の操作 → 層のチェック の順に進み、見た目の順（上から下）と同じ
    await page.locator("#address-input").focus();
    const seen: Array<{ id: string; y: number }> = [];
    for (let i = 0; i < 18; i++) {
      await page.keyboard.press("Tab");
      const info = await page.evaluate(() => {
        const e = document.activeElement as HTMLElement | null;
        if (!e) return null;
        const r = e.getBoundingClientRect();
        return { id: e.dataset["testid"] ?? e.id ?? e.tagName, label: e.getAttribute("aria-label") ?? (e.textContent ?? "").trim().slice(0, 12), y: r.top + window.scrollY, x: r.left };
      });
      if (info) seen.push({ id: `${info.id}:${info.label}`, y: info.y });
    }
    // 上から下へ（同じ行の左右の移動は y が同じ）。大きく戻らない（地図のズームボタンは地図の上端付近）
    for (let i = 1; i < seen.length; i++) expect(seen[i]!.y, `${seen[i - 1]!.id} → ${seen[i]!.id}`).toBeGreaterThanOrEqual(seen[i - 1]!.y - 60);
  });

  test("フォーカスの輪が見える（3px の輪・要素から離す。--sb-focus）。入力欄・ボタン・チェック・リンクのどれでも消えない", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openReady(page);
    const targets = [
      page.locator("#address-input"),
      page.getByTestId("current-location-button"),
      page.getByRole("button", { name: /この地点を判定する/ }),
      page.getByLabel(/DID（航空法/),
    ];
    for (const t of targets) {
      await t.focus();
      await page.keyboard.press("Shift+Tab");
      await page.keyboard.press("Tab");
      const o = await t.evaluate((el) => {
        // :focus-visible の輪は、要素自身または包む label（チェック行）に付く
        const host = el.closest("label") ?? el;
        const cs = getComputedStyle(host);
        const own = getComputedStyle(el);
        const pick = (c: CSSStyleDeclaration) => ({ style: c.outlineStyle, width: parseFloat(c.outlineWidth), offset: parseFloat(c.outlineOffset), color: c.outlineColor });
        return { host: pick(cs), own: pick(own) };
      });
      const ring = o.own.style !== "none" && o.own.width >= 3 ? o.own : o.host;
      expect(ring.style).not.toBe("none");
      expect(ring.width).toBeGreaterThanOrEqual(3);
      expect(ring.offset).toBeGreaterThanOrEqual(3);
    }
  });

  test("地図のドラッグ以外の操作はキーボードでできる：層の切り替え（Space）、現在地ボタン（Enter）、地点の例（Enter）、住所の入力（Enter で検索）", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openReady(page);
    await expect(map(page)).toHaveAttribute("data-did-pref", "31", { timeout: 60_000 });
    const did = page.getByLabel(/DID（航空法/);
    await did.focus();
    await page.keyboard.press("Space");
    await expect(map(page)).toHaveAttribute("data-hidden-layers", "did", { timeout: 15_000 });
    await page.keyboard.press("Space");
    await expect(map(page)).toHaveAttribute("data-hidden-layers", "", { timeout: 15_000 });
    const check = waitCheck(page);
    await page.getByRole("button", { name: /松江城/ }).first().focus();
    await page.keyboard.press("Enter");
    await check;
    await expect(map(page)).toHaveAttribute("data-did-pref", "32", { timeout: 30_000 });
    // 地図の標準ボタン（ズーム）もキーボードで押せる
    const zoomIn = page.locator(".maplibregl-ctrl-zoom-in");
    await zoomIn.focus();
    await expect(zoomIn).toBeFocused();
  });
});

// ───────────────────────── Q-24 根拠欄 ─────────────────────────

test.describe("Q-24 根拠欄（既存の出典・確認日・版・改正・確からしさを整えて見せる）", () => {
  test("規制カードごとに、使用データ（名前・基準年・確認日・版）・反映済みの改正・出典・確からしさ・条文確認日が出る。出さないもの（判例・確認の状態の 3 段階）を出していない", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openReady(page);
    const cards = page.locator('[data-testid^="regulation-card-"]');
    const n = await cards.count();
    expect(n).toBeGreaterThanOrEqual(3);
    for (let i = 0; i < n; i++) {
      const card = cards.nth(i);
      const ds = card.getByTestId("regulation-datasets");
      await expect(ds, `カード ${i}`).toContainText("根拠");
      await expect(ds).toContainText("使用データ");
      await expect(ds).toContainText(/確認日 \d{4}-\d{2}-\d{2}/);
      await expect(card).toContainText(/確からしさ (高|中|低)/);
      await expect(card).toContainText(/条文確認 \d{4}-\d{2}-\d{2}/);
    }
    // 畳んである根拠の詳細は、開くと見える（開いた状態の印は B2 で確かめる）
    const first = cards.first().getByTestId("regulation-detail");
    await expect(first).not.toHaveAttribute("open", "");
    await expect(cards.first().getByTestId("regulation-datasets")).toBeHidden();
    await openDetails(first);
    await expect(cards.first().getByTestId("regulation-datasets")).toBeVisible();
    // 畳んだままでも、出典・確認日・確からしさは見えている（根拠を隠さない）
    await expect(cards.nth(1).getByRole("link", { name: /出典/ })).toBeVisible();
    await expect(cards.nth(1).getByTestId("regulation-data-verified")).toBeVisible();
    // 版（台帳の version）：DID のカードに出る（引けないカードでも崩れない）
    await expect(page.getByTestId("regulation-card-aviation-law-did").getByTestId("regulation-datasets")).toContainText(/版 A16-20/);
    // 反映済みの改正（飛行禁止法のカード）
    await expect(page.locator('[data-testid^="regulation-card-small-drone"]').getByTestId("regulation-datasets")).toContainText("反映済みの改正");
    // 出さないもの：判例・裁判例、確認の状態としての「確認済み／要確認／未確認」の札（独立した札・状態の欄）
    await page.evaluate(() => document.querySelectorAll("details").forEach((d) => ((d as HTMLDetailsElement).open = true)));
    const text = await page.locator("main").innerText();
    expect(text).not.toMatch(/判例|裁判例/);
    const statusChips = await page.locator("main *").evaluateAll((els) =>
      els.filter((e) => e.children.length === 0 && /^(確認済み|要確認|未確認)$/.test((e.textContent ?? "").trim())).length,
    );
    expect(statusChips, "確認の状態（3 段階）の札").toBe(0);
  });
});

// ───────────────────────── Q-26 動き ─────────────────────────

test.describe("Q-26 動き", () => {
  test("せり上がりは結論カードだけ（0.6s・1 回）。h1・site-lead・入力・地図は動かない", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");
    await expect(page.getByTestId("verdict-level")).toBeVisible();
    const names = await page.evaluate(() =>
      document
        .getAnimations()
        .filter((a) => (a as CSSAnimation).animationName)
        .map((a) => ({ name: (a as CSSAnimation).animationName, target: (a.effect as KeyframeEffect).target?.getAttribute("data-testid") ?? (a.effect as KeyframeEffect).target?.tagName, duration: a.effect?.getTiming().duration, iterations: a.effect?.getTiming().iterations })),
    );
    const rise = names.filter((a) => a.name === "sb-rise");
    expect(rise.length).toBeLessThanOrEqual(1);
    for (const a of rise) {
      expect(a.target).toBe("verdict-conclusion");
      expect(a.duration).toBe(600);
      expect(a.iterations).toBe(1);
    }
    for (const sel of ["h1", '[data-testid="site-lead"]', "#address-input", '[data-testid="regulation-map"]']) {
      const animated = await page.locator(sel).evaluate((el) => el.getAnimations({ subtree: true }).length);
      expect(animated, sel).toBe(0);
    }
  });

  test("reducedMotion: reduce で、せり上がり・矢印の入れ替えの時間が 0", async ({ browser, baseURL }) => {
    const ctx = await browser.newContext({ baseURL, reducedMotion: "reduce", viewport: { width: 375, height: 812 } });
    const page = await ctx.newPage();
    await openReady(page);
    const r = await page.evaluate(() => {
      const cs = getComputedStyle(document.querySelector('[data-testid="verdict-conclusion"]')!);
      const pill = getComputedStyle(document.querySelector(".sb-pill-arrow .sb-ar")!);
      return { rise: cs.animationDuration, pill: pill.transitionDuration, token: getComputedStyle(document.documentElement).getPropertyValue("--sb-dur-rise").trim() };
    });
    // 0（globals.css の減らす指定は 0.01ms の !important を当てるため、算出値は 1e-5 秒）。体感できない 0.1ms 以下を 0 とみなす
    expect(parseFloat(r.rise)).toBeLessThanOrEqual(0.0001);
    expect(parseFloat(r.pill)).toBeLessThanOrEqual(0.0001);
    expect(r.token).toMatch(/^0(ms|s)$/);
    // 矢印の入れ替え（2 つ目の矢印）は出さない
    await expect(page.locator(".sb-pill-arrow .sb-a2").first()).toBeHidden();
    await ctx.close();
  });

  test("通常：矢印の入れ替えは 0.5s（ホバー・フォーカス・押下）", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openReady(page);
    const d = await page.evaluate(() => getComputedStyle(document.querySelector(".sb-pill-arrow .sb-ar")!).transitionDuration);
    expect(d).toBe("0.5s");
  });
});

// ───────────────────────── Q-20 実画面の台本 ─────────────────────────

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

test.describe("Q-20 実画面の台本（①住所 ②現在地 ③詳細 ④層）：押す回数 2・1・2・2 以内、ページのスクロールは 2 画面分以内", () => {
  for (const [width, height] of [
    [375, 812],
    [1280, 800],
  ] as const) {
    const vp = `${width}x${height}`;
    test(`${vp}`, async ({ browser }, testInfo) => {
      // 住所検索の索引が架空のフィクスチャのサーバー（2 台目）で測る（外部の住所検索に頼らない。sprint12g-judge の「現状」と同じ）
      const ctx = await browser.newContext({
        baseURL: `http://127.0.0.1:${process.env["E2E_FIXTURE_PORT"] ?? 3101}`,
        viewport: { width, height },
        geolocation: { latitude: 35.4400123, longitude: 133.3500456, accuracy: 30 },
        permissions: ["geolocation"],
      });
      await ctx.route("**/cyberjapandata.gsi.go.jp/**", (r) => r.fulfill({ status: 200, contentType: "image/png", body: PNG }));
      const page = await ctx.newPage();
      await Meter.install(page);
      const open = async (): Promise<void> => {
        const first = waitDiagnose(page);
        await page.goto("/");
        await first;
        await expect(page.getByTestId("regulation-map")).toHaveAttribute("data-center-lat", /\d/);
        await expect(page.locator(".maplibregl-canvas")).toBeVisible();
        await page.waitForTimeout(500);
      };
      const map = page.getByTestId("regulation-map");
      const answer = page.getByTestId("verdict-conclusion");
      const results: Measure[] = [];

      // ① 住所で判定（入力 1 回＋「住所で位置決定」1 回）
      await open();
      let m = new Meter(page);
      const done1 = waitDiagnose(page);
      await m.fill(page.getByPlaceholder(/米子市加茂町1丁目1番地/), "鳥取県米子市試験町一丁目3番7号");
      await m.click(page.getByRole("button", { name: "住所で位置決定" }));
      await done1;
      await page.waitForTimeout(300);
      results.push(await m.finish("current", vp, "1-address", map, answer, 120));

      // ② 現在地で判定（押したらすぐ。精度 30m は確認なし）
      await open();
      m = new Meter(page);
      const done2 = waitDiagnose(page);
      await m.click(page.getByTestId("current-location-button"));
      await done2;
      await page.waitForTimeout(300);
      results.push(await m.finish("current", vp, "2-geo", map, answer, 120));

      // ③ 詳細（DID の判定の根拠）を確かめる。縦積みの画面では、結論のすぐ下の「要手続きの手続き」の先頭（DID 上空の許可。判定の根拠の文）を読む
      await open();
      m = new Meter(page);
      results.push(await m.finish("current", vp, "3-detail", map, page.getByTestId("verdict-procedures").locator("tbody > tr").first(), 300));

      // ④ 層（DID）を切り替えて、地図を見る
      await open();
      m = new Meter(page);
      await m.click(page.getByLabel(/DID（航空法/));
      await expect(map).toHaveAttribute("data-hidden-layers", "did");
      results.push(await m.finish("current", vp, "4-layer", map, answer, 120, false));

      await testInfo.attach("script-counts", { body: JSON.stringify(results, null, 2), contentType: "application/json" });
      const max = { "1-address": 2, "2-geo": 1, "3-detail": 2, "4-layer": 2 } as const;
      for (const r of results) {
        expect(r.taps, `${vp} ${r.script} の押す回数`).toBeLessThanOrEqual(max[r.script as keyof typeof max]);
        expect(r.screens, `${vp} ${r.script} のスクロール量（画面の高さの何枚分か）`).toBeLessThanOrEqual(2);
      }
      await ctx.close();
    });
  }
});

// ───────────────────────── B2 縦の長さ：畳んだ状態と開いた状態（評価 B2） ─────────────────────────

test.describe("B2 縦が長すぎない：規制カード・収録の一覧は見出し（と要約）だけ、開くと中身（申請支援は Sprint 18-1 で止めた）", () => {
  test("375px：ページ全体の高さが main（同条件 16,646px）を超えない。畳んだ部分は既定で閉じている", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await openReady(page);
    // 以前は diagnosis-details（申請の準備）が見えることを待っていた。Sprint 18-1 で止めたので、出ないことを確かめる。
    // 高さの上限（16,646／13,500）は変えない。画面が短くなる変更なので、上限を下げた検査は足さず、実測値を test-changes に記す。
    await expect(page.getByTestId("diagnosis-details")).toHaveCount(0);
    const h = await page.evaluate(() => document.documentElement.scrollHeight);
    await testInfo.attach("page-height-375", { body: String(h), contentType: "text/plain" });
    expect(h, "ページ全体の高さ（375px）").toBeLessThanOrEqual(16_646);
    expect(h, "ページ全体の高さ（375px）。畳んだ効果が残っている").toBeLessThanOrEqual(13_500);
    // Sprint 18-1：申請支援を止めて短くなった（前 12,086px → 後 11,244px の実測）。上の 2 つの上限は変えず、短くなった分が戻らないよう上限を足す。
    expect(h, "ページ全体の高さ（375px）。申請支援を止めた後の高さ").toBeLessThanOrEqual(12_000);
    await expect(page.getByTestId("coverage-details")).not.toHaveAttribute("open", "");
    const cards = page.locator('[data-testid^="regulation-card-"]');
    const n = await cards.count();
    expect(n).toBeGreaterThanOrEqual(3);
    for (let i = 0; i < n; i++) await expect(cards.nth(i).getByTestId("regulation-detail")).not.toHaveAttribute("open", "");
  });

  test("畳んだままでも見える要約：規制カードの名称・段・判定・この地点の理由・出典・確認日・確からしさ。結論の札（確認日・出典つき）と免責", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await openReady(page);
    const card = page.getByTestId("regulation-card-aviation-law-did");
    await expect(card.getByRole("heading", { level: 3 })).toBeVisible();
    await expect(card.getByTestId("regulation-base-status")).toBeVisible();
    await expect(card.getByTestId("regulation-verdict")).toBeVisible();
    await expect(card).toContainText("この地点");
    await expect(card.getByRole("link", { name: /出典/ })).toBeVisible();
    await expect(card.getByTestId("regulation-data-verified")).toBeVisible();
    await expect(card).toContainText(/確からしさ (高|中|低)/);
    await expect(page.getByTestId("verdict-checked-date")).toContainText(/確認日 \d{4}-\d{2}-\d{2}/);
    await expect(page.getByTestId("verdict-sourced")).toContainText("出典つき");
    await expect(page.getByTestId("site-disclaimer")).toBeVisible();
    await expect(page.getByTestId("result-details").getByText("免責").first()).toBeVisible();
    // 以前は申請支援のカテゴリー切り分けと「申請の準備」の畳みを検査していた。Sprint 18-1 で止めたので、出ないことを検査する。
    await expectNoApplicationSupport(page, "12h-pr2 B2");
  });

  test("開閉：キーボード（Enter・Space）で開閉でき、開いた状態は 矢印の向き・文字（開く／閉じる）で分かる", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await openReady(page);
    // 以前は diagnosis-details（申請の準備）で検査していた。同じ部品（Disclosure）の収録の一覧（coverage-details）で続ける（Sprint 18-1）。
    const dd = page.getByTestId("coverage-details");
    const summary = dd.locator("> summary");
    await summary.scrollIntoViewIfNeeded();
    const hint = async (): Promise<{ text: string; transform: string }> =>
      summary.evaluate((el) => ({
        text: getComputedStyle(el.querySelector(".sb-disc-hint")!, "::before").content,
        transform: getComputedStyle(el.querySelector(".sb-disc-chev")!).transform,
      }));
    const closed = await hint();
    expect(closed.text).toBe('"開く"');
    await summary.focus();
    await page.keyboard.press("Enter");
    await expect(dd).toHaveAttribute("open", "");
    const opened = await hint();
    expect(opened.text).toBe('"閉じる"');
    expect(opened.transform, "矢印の向きが変わる（形で分かる）").not.toBe(closed.transform);
    await expect(dd.locator("li").first()).toBeVisible();
    await summary.focus();
    await page.keyboard.press("Space");
    await expect(dd).not.toHaveAttribute("open", "");
    expect((await hint()).text).toBe('"開く"');
    const box = (await summary.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    await summary.focus();
    expect(await summary.evaluate((e) => getComputedStyle(e).outlineStyle)).toBe("solid");
  });

  test("収録の一覧は閉じていて、開くと一覧が出る", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await openReady(page);
    const cov = page.getByTestId("coverage-details");
    await expect(cov).not.toHaveAttribute("open", "");
    await expect(cov.locator("li").first()).toBeHidden();
    await openDetails(cov);
    expect(await cov.locator("li").count()).toBeGreaterThanOrEqual(5);
    await expect(cov.locator("li").first()).toBeVisible();
  });

  test("「申請の準備」は無い：必要手続きのチェックリスト・提出期限・束ね PDF が出ない（Sprint 18-1）", async ({ page }) => {
    // 以前：「申請の準備」を開くと必要手続き・提出期限・束ね PDF が出ることを検査していた。
    await page.setViewportSize({ width: 1280, height: 900 });
    await openReady(page);
    await expectNoApplicationSupport(page, "12h-pr2 申請の準備");
    // 畳みを全部開いても出ない
    await page.evaluate(() => document.querySelectorAll("details").forEach((d) => ((d as HTMLDetailsElement).open = true)));
    await expectNoApplicationSupport(page, "12h-pr2 申請の準備（全部開く）");
  });
});

// ───────────────────────── N1〜N5 非ブロッカー（評価） ─────────────────────────

test.describe("N1 結論の札と責任の注記", () => {
  test("結論に「確認日」「出典つき」の札と境界の注記（BOUNDARY_SHORT）。代行・代理申請の語がない", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await openReady(page);
    const ev = page.getByTestId("verdict-evidence");
    await expect(ev).toBeVisible();
    await expect(ev.getByTestId("verdict-checked-date")).toContainText(/確認日 \d{4}-\d{2}-\d{2}/);
    await expect(ev.getByTestId("verdict-sourced")).toContainText(/出典つき（\d+ 件）/);
    // 以前は「ご本人の名義で作成し、ご本人が提出します。そらばんは入力項目の下書きまでを手伝います。」を固定していた。Sprint 18-1 で境界の文（BOUNDARY_SHORT）に差し替えた。
    await expect(page.getByTestId("verdict-responsibility")).toContainText(BOUNDARY_SHORT);
    await expect(page.getByTestId("verdict-responsibility")).not.toContainText("下書き");
    await page.evaluate(() => document.querySelectorAll("details").forEach((d) => ((d as HTMLDetailsElement).open = true)));
    const text = await page.locator("main").innerText();
    expect(text).not.toMatch(/代行|代理申請|代理で申請/);
  });

  test("「手続き済み」の記録の注記は、結論が「手続き済み」のときだけ付く", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openReady(page);
    const level = async (): Promise<string | null> => page.getByTestId("verdict-summary").getAttribute("data-level");
    const note = page.getByTestId("verdict-responsibility");
    // 要手続き：責任の注記だけ
    expect(await level()).not.toBe("procedure_done");
    await expect(note).not.toContainText("そらばんが手続きを行ったわけではありません");
    // DID の許可を入れ、可能な限り手続き済みに近づける（結論が手続き済みになった場合は記録の注記が付く）
    const conditions = page.locator("details", { hasText: "機体・運航条件" }).first();
    await openDetails(conditions);
    const diag = waitDiagnose(page);
    await conditions.getByRole("checkbox", { name: "国交省 DIPS：DID 上空の飛行許可" }).check();
    await diag;
    await expect(page.getByTestId("verdict-summary")).not.toHaveAttribute("data-level", "pending");
    if ((await level()) === "procedure_done") await expect(note).toContainText("そらばんが手続きを行ったわけではありません");
    else await expect(note).not.toContainText("そらばんが手続きを行ったわけではありません");
  });
});

test.describe("N2 文字は 12px 以上", () => {
  for (const [w, h] of [[375, 812], [1280, 800]] as const) {
    test(`${w}px：/ の文字（地図の層の状態の札を含む）はすべて 12px 以上`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await openReady(page);
      await expectFontSize(page, "main", 12, `${w}px`);
    });
  }
});

test.describe("N3 地図の高さ（スマホは画面の高さの 40〜50%）", () => {
  for (const [w, h] of [[375, 812], [390, 700], [360, 740], [393, 727]] as const) {
    test(`${w}×${h}`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await openReady(page);
      const mh = (await page.getByTestId("regulation-map").boundingBox())!.height;
      expect(mh, `地図の高さ ${mh}（画面の高さ ${h} の ${Math.round((mh / h) * 100)}%）`).toBeGreaterThanOrEqual(260);
      expect(mh / h, "画面の高さに対する割合").toBeGreaterThanOrEqual(0.38);
      expect(mh / h, "画面の高さに対する割合").toBeLessThanOrEqual(0.52);
    });
  }
});

test.describe("N4 結論より下の箱も v2 の丸み", () => {
  test("手続きの票・規制ごとの判定・飛行の前後の点検・規制カードの角が丸い（12px 以上）", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await openReady(page);
    const radii = await page.evaluate(() => {
      const r = (el: Element | null): number => (el ? parseFloat(getComputedStyle(el).borderTopLeftRadius) : -1);
      return {
        procedure: r(document.querySelector('[data-testid="verdict-procedure"]')),
        item: r(document.querySelector('[data-testid="verdict-item"]')),
        duties: r(document.querySelector('[data-testid="verdict-duties"]')),
        card: r(document.querySelector('[data-testid^="regulation-card-"]')),
        verdictLine: r(document.querySelector('[data-testid="regulation-verdict-line"]')),
      };
    });
    for (const [k, v] of Object.entries(radii)) expect(v, `${k} の角の丸み`).toBeGreaterThanOrEqual(8);
    expect(radii.procedure).toBeGreaterThanOrEqual(12);
    expect(radii.item).toBeGreaterThanOrEqual(12);
    expect(radii.card).toBeGreaterThanOrEqual(12);
  });
});

test.describe("N5 PC の最初の画面に 2 つのピル", () => {
  for (const [w, h] of [[1280, 800], [1440, 900]] as const) {
    test(`${w}×${h}：「この地点を判定する」「現在地で判定」が最初の画面に入る`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await openReady(page);
      await page.evaluate(() => window.scrollTo(0, 0));
      await expect(page.getByRole("button", { name: "この地点を判定する" })).toBeInViewport({ ratio: 1 });
      await expect(page.getByTestId("current-location-button")).toBeInViewport({ ratio: 1 });
      await expect(page.locator("#address-input")).toBeInViewport({ ratio: 1 });
    });
  }
});
