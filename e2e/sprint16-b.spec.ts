import { expect, test, type Page } from "@playwright/test";
import { collectTextSamples, expectFontSize, expectNoHorizontalScroll, expectTextZoom } from "./field-checks";

const waitCheck = (page: Page) => page.waitForResponse((r) => r.url().endsWith("/api/check") && r.ok());
const waitDiagnose = (page: Page) => page.waitForResponse((r) => r.url().endsWith("/api/diagnose") && r.ok());

// Sprint 16-B の E2E（DB なし）：文字の下限 14px・本文 16px・rem 化の確かめ（契約 B-1〜B-4、共通条件 K-2・K-4・K-5）。
// 対象：公開の `/`、見本 `/ops/design`（通常・現場）。運航管理の画面は e2e/ops-db/sprint16-b-db.spec.ts。
const MAIN = `http://127.0.0.1:${process.env["E2E_PORT"] ?? 3100}`;
const CATALOG = process.env["E2E_CATALOG_URL"] ?? `http://127.0.0.1:${process.env["E2E_FIXTURE_PORT"] ?? 3101}`;

const SCREENS = [
  { name: "/（公開の判定画面）", url: `${MAIN}/`, ready: '[data-testid="hero-art"]', field: false },
  { name: "/ops/design（通常）", url: `${CATALOG}/ops/design`, ready: '[data-testid="design-catalog"]', field: false },
  { name: "/ops/design（現場）", url: `${CATALOG}/ops/design?mode=field`, ready: '[data-testid="design-catalog"]', field: true },
] as const;

const open = async (page: Page, s: (typeof SCREENS)[number], width: number, height = 844): Promise<void> => {
  await page.setViewportSize({ width, height });
  await page.goto(s.url);
  await expect(page.locator(s.ready)).toBeVisible();
};

test.describe("16-B 公開側：文字の下限・rem 化・200%・320 幅", () => {
  for (const s of SCREENS) {
    for (const w of [375, 390, 1280]) {
      test(`B-1/K-2. ${s.name} ${w}px：画面の文字はすべて 14px 以上。入力欄の値は 16px 以上（現場は 18px 以上）`, async ({ page }) => {
        await open(page, s, w, w >= 1024 ? 800 : 844);
        await expectFontSize(page, "body", 14, `${s.name} ${w}px`);
        const fields = await page.evaluate(() =>
          Array.from(document.querySelectorAll<HTMLElement>("input:not([type=hidden]):not([type=checkbox]):not([type=radio]), select, textarea"))
            .filter((el) => {
              const r = el.getBoundingClientRect();
              return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
            })
            .map((el) => ({ id: el.getAttribute("data-testid") ?? el.tagName.toLowerCase(), size: parseFloat(getComputedStyle(el).fontSize) })),
        );
        const min = s.field ? 18 : 16;
        expect(fields.filter((f) => f.size < min).map((f) => `${f.id} ${f.size}px`), `${s.name} ${w}px：${min}px 未満の入力欄`).toEqual([]);
      });
    }

    test(`B-2. ${s.name}：文字の大きさのトークンは rem（本文 ${s.field ? "18" : "16"}px・補足 14px）。html を 200% にすると本文もその分大きくなる`, async ({ page }) => {
      await open(page, s, 390);
      const tokens = await page.evaluate(() => {
        const cs = getComputedStyle(document.documentElement);
        const probe = (v: string): number => {
          const el = document.createElement("span");
          el.style.fontSize = `var(${v})`;
          document.body.appendChild(el);
          const px = parseFloat(getComputedStyle(el).fontSize);
          el.remove();
          return px;
        };
        return { body: probe("--sb-fs-body"), note: probe("--sb-fs-note"), rawBody: cs.getPropertyValue("--sb-fs-body").trim(), rawNote: cs.getPropertyValue("--sb-fs-note").trim() };
      });
      expect(tokens.body).toBe(s.field ? 18 : 16);
      expect(tokens.note).toBe(14);
      expect(tokens.rawBody, "--sb-fs-body は rem").toMatch(/rem$/);
      expect(tokens.rawNote, "--sb-fs-note は rem").toMatch(/rem$/);
      await page.evaluate(() => {
        document.documentElement.style.fontSize = "200%";
      });
      const zoomed = await page.evaluate(() => {
        const el = document.createElement("span");
        el.style.fontSize = "var(--sb-fs-body)";
        document.body.appendChild(el);
        const px = parseFloat(getComputedStyle(el).fontSize);
        el.remove();
        return px;
      });
      expect(zoomed, "200% で本文の大きさが 2 倍").toBe(tokens.body * 2);
    });

    test(`K-4. ${s.name}：320 幅で横スクロールがない`, async ({ page }) => {
      await open(page, s, 320, 640);
      await expectNoHorizontalScroll(page, `${s.name} 320px`);
    });
  }

  test("B-4/K-5. `/`：文字 200%（390・430 幅）で、横スクロールなし・文字の切れ 0・文字が 2 倍になる・主ボタンに届く", async ({ page }) => {
    await open(page, SCREENS[0], 390);
    await expectTextZoom(page, "/");
  });

  test("K-5 の検査自体が働く：px 固定の文字と、overflow:hidden の固定の高さは検出される", async ({ page }) => {
    await open(page, SCREENS[0], 390);
    await page.evaluate(() => {
      const a = document.createElement("p");
      a.id = "probe-px";
      a.textContent = "px 固定の文字";
      a.style.fontSize = "16px";
      const b = document.createElement("div");
      b.id = "probe-clip";
      b.textContent = "切れる文字 切れる文字 切れる文字 切れる文字 切れる文字 切れる文字 切れる文字 切れる文字";
      b.style.cssText = "height:20px;overflow:hidden;width:200px";
      const main = document.querySelector("main") ?? document.body;
      main.prepend(a, b);
    });
    let failed = "";
    try {
      await expectTextZoom(page, "検出の確認", [390]);
    } catch (e) {
      failed = String((e as Error).message);
    }
    expect(failed, "px 固定か切れのどちらかを検出して失敗する").toMatch(/200% にしても大きくならない文字|文字の切れ/);
  });

  test("B-4. 文字の大きさの標本が十分ある（検査が空でない）", async ({ page }) => {
    await open(page, SCREENS[0], 390);
    expect((await collectTextSamples(page, "body")).length).toBeGreaterThan(20);
  });
});

// ───────── 差し戻し 1（R1-3・R1-4）：本文 16px・行の高さ 1.7、補足（data-note）14px・1.5 ─────────
// この検査は、designer の工程（R1-1・R1-2）の前は落ちてよい。落ちた一覧が designer の作業の一覧になる。
type PublicState = "初期" | "判定の結果を出した状態" | "details を開いた状態";
const openPublicState = async (page: Page, state: PublicState): Promise<void> => {
  if (state === "初期") {
    // 判定の結果が出る前の最初の描画。通信は応答しないまま止める（abort すると「判定に失敗しました」の表示になり、初期の状態ではなくなる）。
    await page.route("**/api/check", () => undefined);
    await page.route("**/api/diagnose", () => undefined);
    await page.goto(SCREENS[0].url);
    await expect(page.locator(SCREENS[0].ready)).toBeVisible();
    return;
  }
  const check = waitCheck(page);
  const diag = waitDiagnose(page);
  await page.goto(SCREENS[0].url);
  await Promise.all([check, diag]);
  await expect(page.getByTestId("verdict-level")).toBeVisible();
  if (state === "details を開いた状態") {
    await page.evaluate(() => {
      for (const d of Array.from(document.querySelectorAll("details"))) (d as HTMLDetailsElement).open = true;
    });
  }
};

test.describe("16-B 差し戻し 1 R1-3/R1-4 公開側：本文 16px・行の高さ 1.7、補足 14px・1.5（data-note）", () => {
  for (const state of ["初期", "判定の結果を出した状態", "details を開いた状態"] as const) {
    for (const w of [375, 390, 1280]) {
      test(`R1-3. /（${state}）${w}px：印のない p・li・dd は 16px・1.7 以上、data-note は 14px・1.5 以上。data-note の置き場所が正しい`, async ({ page }) => {
        await page.setViewportSize({ width: w, height: w >= 1024 ? 800 : 844 });
        await openPublicState(page, state);
        await expectFontSize(page, "body", 14, `/（${state}）${w}px`, { body: 16 });
      });
    }
  }
  for (const w of [375, 390, 1280]) {
    test(`R1-3. /ops/design ${w}px：印のない p・li・dd は 16px・1.7 以上、data-note は 14px・1.5 以上`, async ({ page }) => {
      await open(page, SCREENS[1], w, w >= 1024 ? 800 : 844);
      await expectFontSize(page, "body", 14, `/ops/design ${w}px`, { body: 16 });
    });
  }
});

// 検査自体が働くことの確認（R1-3）。アプリの画面に頼らず、値の決まった小さな HTML で確かめる。
test.describe("16-B 差し戻し 1 R1-3：本文の検査自体が働く（陰性の確認）", () => {
  const BODY = "font-size:16px;line-height:1.7;margin:0";
  const NOTE = "font-size:14px;line-height:1.5;margin:0";
  /** html を root の中に置いて検査し、失敗の文面（通れば空）を返す。 */
  const run = async (page: Page, html: string, opts?: { body: number }): Promise<string> => {
    await page.setContent(`<!doctype html><html><body style="font-size:16px;margin:0"><main id="probe-root" style="width:600px">${html}</main></body></html>`);
    try {
      await (opts ? expectFontSize(page, "#probe-root", 14, "検査の確認", opts) : expectFontSize(page, "#probe-root", 14, "検査の確認"));
      return "";
    } catch (e) {
      return String((e as Error).message);
    }
  };

  test("印のない 14px の p は失敗する。16px・1.7 の p は通る", async ({ page }) => {
    expect(await run(page, `<p data-testid="ok" style="${BODY}">本文の文</p>`, { body: 16 })).toBe("");
    const msg = await run(page, `<p data-testid="small-body" style="${NOTE}">印のない 14px の文</p>`, { body: 16 });
    expect(msg).toContain("small-body");
    expect(msg).toContain("14px");
  });

  test("data-note を付けると通る。補足の行の高さが 1.5 未満なら失敗する", async ({ page }) => {
    expect(await run(page, `<p data-testid="n" data-note style="${NOTE}">補足の文</p>`, { body: 16 })).toBe("");
    const msg = await run(page, `<p data-testid="tight-note" data-note style="font-size:14px;line-height:1.4;margin:0">詰めた補足</p>`, { body: 16 });
    expect(msg).toContain("tight-note");
    expect(msg).toContain("1.40");
  });

  test("本文の行の高さが 1.69 未満・normal なら失敗する。誤差 0.01 は許す", async ({ page }) => {
    expect(await run(page, `<p style="font-size:16px;line-height:1.5;margin:0">1.5</p>`, { body: 16 })).toContain("1.50");
    expect(await run(page, `<p style="font-size:16px;line-height:normal;margin:0">normal</p>`, { body: 16 })).toContain("normal");
    expect(await run(page, `<p style="font-size:16px;line-height:27.1px;margin:0">1.694</p>`, { body: 16 })).toBe("");
  });

  test("div・section などに data-note を付けると失敗する。ul・li・span・time・small は許す", async ({ page }) => {
    const msg = await run(page, `<div data-testid="card" data-note><p style="${BODY}">本文</p></div>`, { body: 16 });
    expect(msg).toContain("data-note は");
    expect(msg).toContain("div[card]");
    expect(await run(page, `<section data-note><p style="${BODY}">本文</p></section>`, { body: 16 })).toContain("section");
    expect(await run(page, `<ul data-note style="margin:0"><li style="${NOTE}">出典 1</li><li style="${NOTE}">出典 2</li></ul>`, { body: 16 })).toBe("");
    expect(await run(page, `<p style="${BODY}">本文 <span data-note style="${NOTE}">日付</span> <time data-note style="${NOTE}">2026-11-22</time> <small data-note style="${NOTE}">小</small></p>`, { body: 16 })).toBe("");
  });

  test("本文の中の印のない子孫（span）は検査される。ボタン・リンクの中の文字は除く", async ({ page }) => {
    const bad = await run(page, `<p style="${BODY}">本文 <span data-testid="kid" style="font-size:14px;line-height:1.7">小さい子孫</span></p>`, { body: 16 });
    expect(bad).toContain("kid");
    expect(await run(page, `<p style="${BODY}">本文 <a href="#x" style="font-size:14px;line-height:1.2">リンク</a> <button style="font-size:14px">押す</button></p>`, { body: 16 })).toBe("");
  });

  test("現場（body: 18）では 16px の p が失敗する。非表示の p は対象外。opts を省略したときは従来の 14px の検査だけ", async ({ page }) => {
    expect(await run(page, `<p data-testid="p16" style="${BODY}">16px</p>`, { body: 18 })).toContain("p16");
    expect(await run(page, `<p style="${NOTE};display:none">隠れた 14px</p><p style="${BODY}">本文</p>`, { body: 16 })).toBe("");
    expect(await run(page, `<p style="${NOTE}">印のない 14px</p>`)).toBe("");
  });
});
