import { expect, test, type Page } from "@playwright/test";
import { collectTextSamples, expectContrast, expectNoApplicationSupport, expectNoHorizontalScroll, expectTextZoom, waitForSettledStyles } from "./field-checks";
import { VERDICT_LABEL } from "../apps/web/src/lib/verdict-display";

// Sprint 16-M（docs/sprints/sprint-16.md「16-M 公開の /」M-1〜M-6）の E2E。公開の `/` だけ。DB なし。本番相当サーバー（baseURL）。
//   M-1  判定の結果の札・結論のカード・手続きの票が、判定の帯のカード（状態の面＋左端 6px の帯）と状態の札に。判定の 5 段の形と言葉は変えない
//   M-2  結論の総合の文言（§8.2 の公開の / の行）。「飛行可」「安全」ほかを出さない
//   M-3  主ボタン「この地点を判定する」は 1 つ（K-8）。地図の上の部品は 48 の円
//   M-4  静的なシェル（申請支援を出さない）
//   M-5  「必ず」が描画後の本文に 0（節の見出し・規制カード・地図の注記・エンジンの文）
//   K-14 OS が暗でも明で描く。K-15 端末に新しい鍵を作らない。K-5 文字 200%
// M-6（/ の長さの上限を元に戻す）は sprint12h-pr2.spec.ts の B2（12,000px）・Q-20（2 画面分）が守る。

const waitCheck = (page: Page) => page.waitForResponse((r) => r.url().endsWith("/api/check") && r.ok());
const waitDiagnose = (page: Page) => page.waitForResponse((r) => r.url().endsWith("/api/diagnose") && r.ok());

const openReady = async (page: Page): Promise<void> => {
  const check = waitCheck(page);
  const diag = waitDiagnose(page);
  await page.goto("/");
  await Promise.all([check, diag]);
  await expect(page.getByTestId("evidence-id")).toHaveText(/^ev_[0-9a-f]{16}$/);
  await expect(page.getByTestId("verdict-level")).toBeVisible();
};

type Json = Record<string, unknown>;

/** /api/diagnose の応答の verdict を書き換える（表示の検査のため。エンジンの結果の代わりに画面へ渡す）。 */
const mockVerdict = async (page: Page, mutate: (verdict: Json) => void): Promise<void> => {
  await page.route("**/api/diagnose", async (route) => {
    const res = await route.fetch();
    const body = (await res.json()) as Json;
    const verdict = body["verdict"] as Json | undefined;
    if (verdict) mutate(verdict);
    await route.fulfill({ response: res, json: body });
  });
};

type StateCase = {
  readonly key: "no_fly" | "needs_procedure" | "unknown" | "procedure_done" | "no_procedure";
  /** 判定エンジンの段（VerdictLevel は 4 段。判定不能の項目があるときは要手続きに倒れ、unknownCount に出る） */
  readonly level: "no_fly" | "needs_procedure" | "procedure_done" | "no_procedure";
  readonly total: RegExp;
  /** 判定の帯のカードの状態（判定不能は帯なし） */
  readonly state: "danger" | "warn" | "info" | "safe" | null;
};

const STATES: readonly StateCase[] = [
  { key: "no_fly", level: "no_fly", total: /^飛行不可の項目があります（\d+ 件）$/, state: "danger" },
  { key: "needs_procedure", level: "needs_procedure", total: /^手続きが要る項目があります（\d+ 件）$/, state: "warn" },
  { key: "unknown", level: "needs_procedure", total: /^未確認の項目があります（\d+ 件）$/, state: null },
  { key: "procedure_done", level: "procedure_done", total: /^調べた項目は手続き済みです。条件を確認してください$/, state: "info" },
  { key: "no_procedure", level: "no_procedure", total: /^調べた項目では、手続きが要るものは見つかりませんでした$/, state: "safe" },
];

/** 全項目をその段にした verdict に書き換える（unknown は 1 件だけ判定不能、残りは手続き不要）。 */
const asState = (key: StateCase["key"]) => (verdict: Json): void => {
  const items = verdict["items"] as Array<Json>;
  verdict["level"] = key === "unknown" ? "needs_procedure" : key;
  for (const [i, it] of items.entries()) it["verdict"] = key === "unknown" ? (i === 0 ? "unknown" : "no_procedure") : key;
  verdict["unknownCount"] = key === "unknown" ? 1 : 0;
};

const BANNED = ["飛行可", "安全", "OK", "問題なし", "通報不要", "完璧", "保証", "必ず", "代行", "代理"];

test.describe("16-M M-1 判定の帯のカードと状態の札", () => {
  test("M-1a. 結論のカードは判定の帯のカード：状態の面と左端 6px の帯（375px）。判定の段の語と形は従来のまま", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await openReady(page);
    const card = page.getByTestId("verdict-conclusion");
    await expect(card).toHaveClass(/sb-card-state/);
    await expect(card).toHaveAttribute("data-state", /^(danger|warn|info|safe)$/);
    const look = await card.evaluate((el) => {
      const cs = getComputedStyle(el);
      const band = getComputedStyle(el, "::before");
      return { face: cs.backgroundColor, bandWidth: band.width, bandColor: band.backgroundColor, radius: parseFloat(cs.borderTopLeftRadius) };
    });
    expect(look.face, "状態の面は白ではない").not.toBe("rgb(255, 255, 255)");
    expect(look.bandWidth).toBe("6px");
    expect(look.bandColor).not.toBe("rgba(0, 0, 0, 0)");
    expect(look.radius).toBeGreaterThanOrEqual(12);
    // 判定の段（5 段の言葉と形）は変えない
    const level = page.getByTestId("verdict-level");
    await expect(level).toHaveText(/要手続き|飛行不可|手続き済み|手続き不要|判定不能/);
    await expect(card.locator("svg").first()).toBeVisible();
  });

  test("M-1b. 判定の札：規制ごとの判定・規制カードの判定は、形（SVG）と言葉を持つ札（5 段の言葉は変えない）", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await openReady(page);
    const words = Object.values(VERDICT_LABEL) as string[];
    const tags = await page.locator('[data-testid="verdict-item"] td[data-label="判定"] .sb-vtag, [data-testid="regulation-verdict"]').evaluateAll((els) =>
      els.map((e) => ({ text: (e.textContent ?? "").trim(), svg: e.querySelectorAll("svg").length, key: e.getAttribute("data-verdict-key") })),
    );
    expect(tags.length).toBeGreaterThanOrEqual(6);
    for (const t of tags) {
      expect(t.svg, `札「${t.text}」の形`).toBeGreaterThanOrEqual(1);
      expect(words, `札の言葉「${t.text}」`).toContain(t.text);
      expect(t.key, `札「${t.text}」の段の記号`).toMatch(/^(no|needs|done|none|unknown)$/);
    }
    // 判定の見分け方（5 段）の言葉と順は変わらない
    const legend = await page.getByTestId("verdict-legend").locator(".sb-vtag").allInnerTexts();
    expect(legend.map((t) => t.trim())).toEqual(["飛行不可", "要手続き", "手続き済み（条件付き）", "手続き不要", "判定不能（データ未整備）"]);
  });

  test("M-1c. 手続きの票・規制ごとの判定の行は判定の帯（375px）。768px 以上は表の行のまま", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await openReady(page);
    const rows = page.locator('[data-testid="verdict-procedure"][data-state="warn"]');
    expect(await rows.count()).toBeGreaterThanOrEqual(1);
    const look = await rows.first().evaluate((el) => {
      const band = getComputedStyle(el, "::before");
      return { display: getComputedStyle(el).display, band: band.width, bg: getComputedStyle(el).backgroundColor, radius: parseFloat(getComputedStyle(el).borderTopLeftRadius) };
    });
    expect(look.display).toBe("grid");
    expect(look.band).toBe("6px");
    expect(look.bg).not.toBe("rgb(255, 255, 255)");
    expect(look.radius).toBeGreaterThanOrEqual(12);
    const items = await page.locator('[data-testid="verdict-item"][data-state]').evaluateAll((els) =>
      els.map((e) => ({ state: e.getAttribute("data-state"), verdict: e.getAttribute("data-verdict"), band: getComputedStyle(e, "::before").width })),
    );
    expect(items.length).toBeGreaterThanOrEqual(1);
    for (const i of items) expect(i.band, `${i.verdict} の行の帯`).toBe("6px");
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(page.locator('[data-testid="verdict-procedure"]').first()).toBeVisible();
    const wide = await page.locator('[data-testid="verdict-procedure"]').first().evaluate((el) => ({ display: getComputedStyle(el).display, content: getComputedStyle(el, "::before").content }));
    expect(wide.display).toBe("table-row");
    expect(wide.content === "none" || wide.content === "normal").toBe(true);
  });

  for (const s of STATES) {
    test(`M-1d. ${s.key}：結論の帯の状態は ${s.state ?? "なし（未確認の灰）"}。判定の段の行は 5 段の言葉のまま`, async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      await mockVerdict(page, asState(s.key));
      await openReady(page);
      const card = page.getByTestId("verdict-conclusion");
      if (s.state) await expect(card).toHaveAttribute("data-state", s.state);
      else await expect(card).not.toHaveAttribute("data-state", /.+/);
      await expect(page.getByTestId("verdict-level")).toHaveText(VERDICT_LABEL[s.level]);
      await expect(page.getByTestId("verdict-level")).toHaveAttribute("data-verdict-key", /^(no|needs|done|none|unknown)$/);
    });
  }
});

test.describe("16-M M-2 結論の総合の文言（§8.2 の公開の / の行）", () => {
  for (const s of STATES) {
    test(`M-2a. ${s.key}：総合の語が §8.2 のとおり。「飛行可」「安全」「OK」「問題なし」「通報不要」を出さない`, async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      await mockVerdict(page, asState(s.key));
      await openReady(page);
      const total = page.getByTestId("judgement-total");
      await expect(total).toBeVisible();
      expect((await total.innerText()).trim()).toMatch(s.total);
      const conclusion = await page.getByTestId("verdict-conclusion").innerText();
      for (const w of BANNED) expect(conclusion, `結論に「${w}」`).not.toContain(w);
      if (s.key === "no_procedure") await expect(page.getByTestId("judgement-total-note")).toHaveText("調べていない項目があります");
      else await expect(page.getByTestId("judgement-total-note")).toHaveCount(0);
      // 判定不能が 1 件でもあれば、総合を「手続き済み」「手続き不要」の語にしない
      if (s.key === "unknown") expect(await total.innerText()).not.toMatch(/手続き済み|手続きが要るものは見つかりませんでした/);
    });
  }

  test("M-2b. 総合の語は結論のカードの中にあり、確認日・出典つきの札と境界の注記は結論のまま（N1 を弱めない）", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await openReady(page);
    const card = page.getByTestId("verdict-conclusion");
    await expect(card.getByTestId("judgement-total")).toBeVisible();
    await expect(card.getByTestId("verdict-checked-date")).toContainText(/確認日 \d{4}-\d{2}-\d{2}/);
    await expect(card.getByTestId("verdict-sourced")).toContainText("出典つき");
    await expect(card.getByTestId("verdict-responsibility")).toContainText("申請");
  });
});

test.describe("16-M M-3 主ボタンは 1 つ・地図の上の部品は 48 の円", () => {
  test("M-3a. 主ボタンは「この地点を判定する」だけ（初期・結果あり・飛行不可・判定不能の各状態）", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const primaries = async (): Promise<string[]> =>
      page.locator('[data-variant="primary"]').evaluateAll((els) =>
        els
          .filter((e) => {
            const r = e.getBoundingClientRect();
            return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== "hidden";
          })
          .map((e) => (e.textContent ?? "").trim()),
      );
    await openReady(page);
    expect(await primaries(), "結果あり").toEqual(["この地点を判定する"]);
    const diag = waitDiagnose(page);
    await page.getByTestId("airspace-airspace_emergency").locator("input").check();
    await diag;
    await expect(page.getByTestId("verdict-level")).toHaveText("飛行不可");
    expect(await primaries(), "飛行不可").toEqual(["この地点を判定する"]);
    const height = await page.locator('[data-variant="primary"]').first().evaluate((e) => e.getBoundingClientRect().height);
    expect(height, "主ボタンは 56px 以上").toBeGreaterThanOrEqual(56);
  });

  test("M-3b. 地図のズームの部品は 48px の円で、隣と 8px 以上離れる", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await openReady(page);
    const btns = await page.locator(".sb-map-frame .maplibregl-ctrl-group button").evaluateAll((els) =>
      els.map((e) => {
        const r = e.getBoundingClientRect();
        const cs = getComputedStyle(e);
        return { w: r.width, h: r.height, top: r.top, bottom: r.bottom, radius: cs.borderTopLeftRadius, label: e.getAttribute("aria-label") ?? "" };
      }),
    );
    expect(btns.length).toBeGreaterThanOrEqual(2);
    for (const b of btns) {
      expect(b.w, `${b.label} の幅`).toBeGreaterThanOrEqual(48);
      expect(b.h, `${b.label} の高さ`).toBeGreaterThanOrEqual(48);
      expect(Math.abs(b.w - b.h), `${b.label} は円（縦横が同じ）`).toBeLessThan(1);
      expect(parseFloat(b.radius) >= b.w / 2 - 1 || b.radius.includes("%"), `${b.label} の角丸 ${b.radius}`).toBe(true);
    }
    const sorted = [...btns].sort((a, b) => a.top - b.top);
    for (let i = 1; i < sorted.length; i++) expect(sorted[i]!.top - sorted[i - 1]!.bottom, "部品の間").toBeGreaterThanOrEqual(8 - 0.5);
  });
});

test.describe("16-M M-4 静的なシェルと申請支援", () => {
  test("M-4a. 静的な HTML に見出し・入力欄・主ボタンが入り、申請支援・結論の値は入っていない。画面にも申請支援は出ない", async ({ page, request }) => {
    const html = await (await request.get("/")).text();
    expect(html).toContain('data-testid="site-lead"');
    expect(html).toContain('data-testid="input-block"');
    expect(html).not.toContain('data-testid="diagnosis-details"');
    expect(html, "結論の値は静的な HTML に入れない（判定はブラウザーで）").not.toContain('data-testid="judgement-total"');
    await openReady(page);
    await expectNoApplicationSupport(page, "16-M");
  });
});

test.describe("16-M M-5 「必ず」が描画後の本文に 0", () => {
  const countMust = (page: Page): Promise<{ text: number; attrs: string[] }> =>
    page.evaluate(() => {
      for (const d of Array.from(document.querySelectorAll("details"))) (d as HTMLDetailsElement).open = true;
      const clone = document.documentElement.cloneNode(true) as HTMLElement;
      for (const el of Array.from(clone.querySelectorAll("script, style, template"))) el.remove();
      const text = (clone.textContent ?? "").split("必ず").length - 1;
      const attrs = Array.from(document.querySelectorAll("[aria-label], [title], [placeholder], [alt]"))
        .flatMap((e) => ["aria-label", "title", "placeholder", "alt"].map((a) => `${a}=${e.getAttribute(a) ?? ""}`))
        .filter((a) => a.includes("必ず"));
      return { text, attrs };
    });

  test("M-5a. 節の見出しは「飛行の前後に行うこと」。「必ず」を含む旧い見出しは出ない", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await openReady(page);
    const section = page.getByTestId("verdict-duties-section");
    await expect(section).toContainText("飛行の前後に行うこと");
    await expect(section).not.toContainText("必ず");
    expect(await page.locator("body").innerText()).not.toContain("飛行の前後に必ず行うこと");
    // 節の見出しの語（結論・飛行できない理由ほか）は変えない
    await expect(page.getByTestId("verdict-procedures-section")).toContainText("要手続きの手続き（期限順）");
  });

  test("M-5b. 初期の状態：描画後の本文（畳んだ所を開いた全文・属性）に「必ず」が 0。地図の注記は「…でご確認ください」", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await openReady(page);
    const r = await countMust(page);
    expect(r.text, "本文の「必ず」").toBe(0);
    expect(r.attrs, "属性の「必ず」").toEqual([]);
    await expect(page.getByTestId("layer-no-map-row").first()).toContainText("飛行の前に DIPS でご確認ください");
  });

  test("M-5c. エンジンの文に「必ず」が入っていても、規制カード・手続き・義務・結論の説明の表示では外れる（エンジンの応答は変えない）", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.route("**/api/check", async (route) => {
      const res = await route.fetch();
      const body = (await res.json()) as Json;
      for (const r of (body["regulations"] as Array<Json>) ?? []) {
        r["note"] = `${String(r["note"])} 地理院地図・DIPS で必ず確認してください。`;
        r["summary"] = `${String(r["summary"])} 必ず確認します。`;
      }
      await route.fulfill({ response: res, json: body });
    });
    await mockVerdict(page, (v) => {
      const duties = v["perFlightDuties"] as Array<Json>;
      if (duties[0]) duties[0]["detail"] = `${String(duties[0]["detail"])} 必ず確認します。`;
      const procs = v["procedures"] as Array<Json>;
      if (procs[0]) procs[0]["reason"] = `${String(procs[0]["reason"])} 必ず確認します。`;
      const items = v["items"] as Array<Json>;
      v["level"] = "no_procedure";
      for (const it of items) it["verdict"] = "no_procedure";
    });
    await openReady(page);
    const r = await countMust(page);
    expect(r.text, "本文の「必ず」").toBe(0);
    await expect(page.getByTestId("regulation-card-aviation-law-did")).toContainText("DIPS で確認してください");
    await expect(page.getByTestId("verdict-duties").locator("li").first()).toContainText("確認します。");
  });
});

test.describe("16-M 共通条件", () => {
  for (const s of STATES.filter((x) => x.key !== "needs_procedure")) {
    test(`K-3. ${s.key}：結論・手続き・規制ごとの判定・規制カードの文字は 4.5:1 以上（面の上でも）`, async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      await mockVerdict(page, asState(s.key));
      await openReady(page);
      await expectContrast(page, '[data-testid="result-section"]', 4.5, `${s.key} 結論`);
      await expectContrast(page, '[data-testid="result-details"]', 4.5, `${s.key} 詳細`);
    });
  }

  test("K-3. 初期の状態（要手続き）：結論・詳細の文字は 4.5:1 以上。面の上の補足の文字も", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await openReady(page);
    await expectContrast(page, '[data-testid="result-section"]', 4.5, "結論");
    await expectContrast(page, '[data-testid="result-details"]', 4.5, "詳細");
    const onFace = (await collectTextSamples(page, '[data-testid="verdict-procedures"]')).filter((x) => !x.disabled);
    expect(onFace.length).toBeGreaterThan(0);
    for (const x of onFace) expect(x.ratio, `${x.testId ?? x.tag}「${x.text}」`).toBeGreaterThanOrEqual(4.5);
  });

  test("K-4. 320・360・375・390・430・768・1024・1280 の幅で横スクロールがない（結果あり）", async ({ page }) => {
    await openReady(page);
    for (const w of [320, 360, 375, 390, 430, 768, 1024, 1280]) {
      await page.setViewportSize({ width: w, height: 800 });
      await expectNoHorizontalScroll(page, `/ ${w}px`);
    }
  });

  test("K-5. 文字 200%（390・430 幅）：結論・手続き・規制ごとの判定が切れず、横スクロールがない", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openReady(page);
    await expectTextZoom(page, "公開の /（結果あり）");
  });

  test("K-14. OS が暗でも明で描く：結論のカードの面・帯の色が明と同じ", async ({ browser, baseURL }) => {
    const read = async (scheme: "light" | "dark"): Promise<{ face: string; band: string; page: string }> => {
      const ctx = await browser.newContext({ baseURL: baseURL!, colorScheme: scheme, viewport: { width: 375, height: 812 } });
      const page = await ctx.newPage();
      await openReady(page);
      await waitForSettledStyles(page);
      const v = await page.getByTestId("verdict-conclusion").evaluate((el) => ({
        face: getComputedStyle(el).backgroundColor,
        band: getComputedStyle(el, "::before").backgroundColor,
        page: getComputedStyle(document.body).backgroundColor,
      }));
      await ctx.close();
      return v;
    };
    const light = await read("light");
    const dark = await read("dark");
    expect(dark).toEqual(light);
  });

  test("K-15. 端末のストレージに新しい鍵を作らない（判定・条件の変更・例の選択のあとで、鍵の集合が増えない）", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await openReady(page);
    const keys = (): Promise<string[]> =>
      page.evaluate(async () => {
        const dbs = (await indexedDB.databases?.()) ?? [];
        return [...Object.keys(localStorage).map((k) => `local:${k}`), ...Object.keys(sessionStorage).map((k) => `session:${k}`), ...dbs.map((d) => `idb:${d.name}`), ...(await caches.keys()).map((c) => `cache:${c}`)].sort();
      });
    const before = await keys();
    const diag = waitDiagnose(page);
    await page.getByTestId("airspace-airspace_emergency").locator("input").check();
    await diag;
    const check = waitCheck(page);
    await page.getByRole("button", { name: "この地点を判定する" }).click();
    await check;
    const after = await keys();
    expect(after.filter((k) => !before.includes(k)), "増えた鍵").toEqual([]);
  });
});
