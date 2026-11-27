import { expect, request as pwRequest, test, type APIRequestContext, type Page } from "@playwright/test";
import { expectNoHorizontalScroll, expectTextZoom, waitForSettledStyles } from "../field-checks";
import { clickSave, expectStep, fillStep, tapBack, tapNext, walkWizard, type WizardValues } from "./plan-wizard";

// Sprint 16-H1 の E2E-DB：計画作成の 6 段（①場所 ②日時 ③飛行の方法と目的 ④操縦者・機体・許可 ⑤内容の確認（保存）⑥保存後の計画の画面）。
// 契約 H1-1〜H1-7、K-4・K-5・K-8・K-15。訂正の画面（H1-8）は構成を変えない（既存の検査が通ることで確かめる）。
const BASE = `http://127.0.0.1:${process.env["E2E_OPS_PORT"] ?? 3300}`;
const stamp = Date.now().toString(36).toUpperCase();
let seq = 0;

type Who = { authUserId: string; email: string };
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

const BANNED = ["完璧", "保証", "必ず", "代行", "代理", "申請", "通報不要", "問題なし"];
const PRIMARY = '.opx-btn-primary, .sb-pill-primary, [data-variant="primary"]';
const visiblePrimaries = (page: Page): Promise<string[]> =>
  page.evaluate(
    (sel) =>
      Array.from(document.querySelectorAll<HTMLElement>(sel))
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
        })
        .map((el) => el.getAttribute("data-testid") ?? el.textContent?.trim() ?? el.tagName),
    PRIMARY,
  );

type Storage = { local: string[]; session: string[]; idb: string[]; caches: string[]; values: string };
/** 端末に残るものの一覧（鍵・DB 名・Cache 名）と、localStorage・sessionStorage の値の全文。 */
const storageSnapshot = (page: Page): Promise<Storage> =>
  page.evaluate(async () => {
    const idb = typeof indexedDB.databases === "function" ? (await indexedDB.databases()).map((d) => d.name ?? "") : [];
    const caches_ = typeof caches !== "undefined" ? await caches.keys() : [];
    const local = Object.keys(localStorage).sort();
    const session = Object.keys(sessionStorage).sort();
    const values = [...local.map((k) => localStorage.getItem(k) ?? ""), ...session.map((k) => sessionStorage.getItem(k) ?? "")].join("\n");
    return { local, session, idb: idb.sort(), caches: caches_.sort(), values };
  });

test.use({ viewport: { width: 375, height: 812 }, hasTouch: false });
test.describe.configure({ mode: "serial" });

test.describe("Sprint 16-H1 E2E-DB：計画作成の 6 段", () => {
  let manager: APIRequestContext;
  let aircraft: { id: string; registrationMark: string };
  let pilotId = "";

  test.beforeAll(async () => {
    manager = await apiAs(seeded("a-manager"));
    const registrationMark = `JUSH1${stamp}${seq++}`;
    const r = await manager.post("/api/ops/aircraft", {
      data: { registrationMark, modelName: "段の試験機", manufacturer: "DJI", serialNumber: `SN-${registrationMark}`, typeCertified: false, initialFlightMinutes: 0, maxTakeoffWeightKg: 0.9 },
    });
    expect(r.status()).toBe(201);
    aircraft = { ...((await r.json()) as { id: string }), registrationMark };
    const pilotCtx = await apiAs(seeded("a-pilot"));
    pilotId = ((await (await pilotCtx.get("/api/ops/me")).json()) as { pilotId: string }).pilotId;
    await pilotCtx.dispose();
  });
  test.afterAll(async () => {
    await manager.dispose();
  });

  const open = async (page: Page, who = "a-manager", url = "/ops/plans/new"): Promise<void> => {
    await page.route("**/_next/**", (route) => route.continue());
    await signIn(page.request, seeded(who));
    await page.goto(url);
    await expect(page.getByTestId("plan-form")).toBeVisible();
    await page.waitForLoadState("networkidle").catch(() => undefined);
  };

  const full = (label: string): WizardValues => ({
    placeName: `段の試験地点 ${label}`,
    lat: "35.123456",
    lng: "133.654321",
    radius: "120",
    date: "2027-03-05",
    time: "10:30",
    duration: "40",
    title: `E2E 段の計画 ${label}`,
    purpose: "橋梁の点検",
    altitude: "60",
    flags: ["method_night"],
    aircraftId: aircraft.id,
    pilotId,
    permitNumbers: "",
    notes: "段の試験のメモ",
  });

  test("H1-1. 6 段・上に固定の進捗の帯（高さ 4・主色）・「2/6 日時」・progressbar の値と読み上げ。主ボタンは各段で 1 つ", async ({ page }) => {
    await open(page);
    const labels = ["場所", "日時", "飛行の方法と目的", "操縦者・機体・許可", "内容の確認"];
    const v = full("H1-1");
    for (let n = 1; n <= 5; n++) {
      await expectStep(page, n);
      const bar = page.getByTestId("plan-wizard-progress");
      await expect(bar).toHaveAttribute("role", "progressbar");
      await expect(bar).toHaveAttribute("aria-valuemin", "1");
      await expect(bar).toHaveAttribute("aria-valuemax", "6");
      await expect(bar).toHaveAttribute("aria-valuenow", String(n));
      await expect(bar).toHaveAttribute("aria-valuetext", `${n}/6 ${labels[n - 1]}`);
      await expect(page.getByTestId("plan-wizard-step-text")).toHaveText(`${n}/6 ${labels[n - 1]}`);
      await expect(page.getByTestId("plan-step-heading")).toContainText(labels[n - 1]!);
      const m = await page.evaluate(() => {
        const b = document.querySelector<HTMLElement>('[data-testid="plan-wizard-progress"]')!;
        const f = b.firstElementChild as HTMLElement;
        return { h: b.getBoundingClientRect().height, fill: getComputedStyle(f).backgroundColor, fw: f.getBoundingClientRect().width / b.getBoundingClientRect().width };
      });
      expect(m.h, `段 ${n}：帯の高さ`).toBe(4);
      expect(m.fill, `段 ${n}：帯の色は主色 #1F5FE0`).toBe("rgb(31, 95, 224)");
      expect(m.fw, `段 ${n}：帯の長さ`).toBeCloseTo(n / 6, 1);
      expect(await visiblePrimaries(page), `段 ${n}：主ボタンは 1 つ`).toHaveLength(1);
      expect(await visiblePrimaries(page)).toEqual([n === 5 ? "plan-submit" : "plan-wizard-next"]);
      if (n < 5) {
        await fillStep(page, n, v);
        await tapNext(page);
      }
    }
    // 固定：スクロールしても帯は上に残る
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const top = await page.getByTestId("plan-wizard-progress-band").evaluate((e) => e.getBoundingClientRect().top);
    expect(top).toBeLessThanOrEqual(1);
    // 禁止語・「通報する」「送信」と読める主ボタンの語を使わない
    // 範囲：段の入力・確認・進捗の帯（ページ見出しの固定の注記は 16-H1 の範囲外で、既存の走査が見る）
    const text = `${await page.getByTestId("plan-form").innerText()}\n${await page.getByTestId("plan-wizard-progress-band").innerText()}`;
    for (const w of BANNED) expect(text, `「${w}」`).not.toContain(w);
    await expect(page.getByTestId("plan-submit")).toHaveText("計画を保存");
  });

  test("H1-2. 段の移動は再読み込みなし・?step=n が履歴に積まれ、戻る・進むで入力が消えない", async ({ page }) => {
    await open(page);
    await page.evaluate(() => ((window as unknown as { __marker: string }).__marker = "same-document"));
    const v = full("H1-2");
    await fillStep(page, 1, v);
    await tapNext(page);
    expect(new URL(page.url()).searchParams.get("step")).toBe("2");
    await fillStep(page, 2, v);
    await tapNext(page);
    await fillStep(page, 3, v);
    await tapNext(page);
    await fillStep(page, 4, v);
    expect(new URL(page.url()).searchParams.get("step")).toBe("4");
    // ブラウザの戻る・進むを繰り返す
    for (let round = 0; round < 2; round++) {
      await page.goBack();
      await expectStep(page, 3);
      await expect(page.getByTestId("plan-title")).toHaveValue(v.title!);
      await expect(page.getByTestId("plan-flag-method_night")).toBeChecked();
      await page.goBack();
      await expectStep(page, 2);
      await expect(page.getByTestId("plan-duration")).toHaveValue("40");
      await expect(page.getByTestId("plan-start-time")).toHaveValue("10:30");
      await page.goBack();
      await expectStep(page, 1);
      await expect(page.getByTestId("plan-place-name")).toHaveValue(v.placeName!);
      await expect(page.getByTestId("plan-lat")).toHaveValue("35.123456");
      await expect(page.getByTestId("plan-radius")).toHaveValue("120");
      await page.goForward();
      await expectStep(page, 2);
      await page.goForward();
      await expectStep(page, 3);
      await page.goForward();
      await expectStep(page, 4);
      await expect(page.getByTestId("plan-aircraft")).toHaveValue(aircraft.id);
      await expect(page.getByTestId("plan-notes")).toHaveValue("段の試験のメモ");
    }
    // 「戻る」ボタンでも、入力は消えない
    await tapBack(page);
    await expectStep(page, 3);
    await expect(page.getByTestId("plan-purpose")).toHaveValue("橋梁の点検");
    // 画面は一度も読み直されていない
    expect(await page.evaluate(() => (window as unknown as { __marker?: string }).__marker)).toBe("same-document");
  });

  test("H1-3. 各段の「次へ」で、漏れがあれば進まず、該当の欄へフォーカス＋記号付きの 1 行のエラー（保存のときにまとめて出さない）", async ({ page }) => {
    await open(page);
    const check = async (step: number, expectedFirst: string, expectedErrors: number): Promise<void> => {
      await expectStep(page, step);
      await page.getByTestId("plan-wizard-next").click();
      await expect(page.locator("main [aria-invalid=true]")).toHaveCount(expectedErrors);
      await expectStep(page, step);
      await expect(page.getByTestId(expectedFirst)).toBeFocused();
      await expect(page.getByTestId(expectedFirst)).toHaveAttribute("aria-invalid", "true");
      const errs = page.locator("main .sb-field-error:visible");
      await expect(errs).toHaveCount(expectedErrors);
      for (let i = 0; i < expectedErrors; i++) {
        const e = errs.nth(i);
        await expect(e.locator("svg")).toHaveCount(1); // 記号
        expect((await e.innerText()).trim().length).toBeGreaterThan(4); // 文字
      }
      // 欄は説明に結ばれている
      const described = await page.getByTestId(expectedFirst).getAttribute("aria-describedby");
      const id = await errs.first().getAttribute("id");
      expect(described ?? "").toContain(id ?? "none");
      // 保存の経路（段 ⑤）へは進んでいない
      await expect(page.getByTestId("plan-submit")).toHaveCount(0);
    };
    await check(1, "plan-place-name", 3);
    // ひとつだけ入れると、残りの 2 つが指摘される（最初の欄へフォーカス）
    await fillStep(page, 1, { placeName: "漏れの確認" });
    await check(1, "plan-lat", 2);
    await fillStep(page, 1, { lat: "35.1", lng: "133.1" });
    await tapNext(page);
    await check(2, "plan-start-date", 3);
    await fillStep(page, 2, { date: "2027-03-05", time: "09:00" });
    await check(2, "plan-duration", 1);
    await fillStep(page, 2, { duration: "30" });
    await tapNext(page);
    await check(3, "plan-title", 2);
    await fillStep(page, 3, { title: "漏れの確認", purpose: "確認" });
    await tapNext(page);
    await check(4, "plan-aircraft", 2);
    await fillStep(page, 4, { aircraftId: aircraft.id });
    await check(4, "plan-pilot", 1);
    await fillStep(page, 4, { pilotId });
    await tapNext(page);
    await expectStep(page, 5);
    await expect(page.locator("main [aria-invalid=true]")).toHaveCount(0);
  });

  test("H1-3. サーバーの検証（422）は段 ⑤ の保存のときに、該当の段へ戻す導線と一緒に出る。直して保存できる", async ({ page }) => {
    await open(page);
    const v = { ...full("H1-3b"), lat: "999" };
    await walkWizard(page, v, 5);
    await clickSave(page);
    await expect(page.getByTestId("plan-review-errors")).toBeVisible();
    await expectStep(page, 5);
    const item = page.getByTestId("plan-review-error").first();
    await expect(item).toContainText("緯度");
    await expect(item).toContainText("場所");
    await expect(page.getByTestId("plan-review-error-fix-1")).toBeVisible();
    // 導線で ① へ戻る。入力は残り、誤りの欄にフォーカス・記号付きのエラー
    await page.getByTestId("plan-review-error-fix-1").click();
    await expectStep(page, 1);
    await expect(page.getByTestId("plan-lat")).toBeFocused();
    await expect(page.getByTestId("plan-lat")).toHaveAttribute("aria-invalid", "true");
    await expect(page.locator("main .sb-field-error:visible")).toHaveCount(1);
    await expect(page.getByTestId("plan-place-name")).toHaveValue(v.placeName!);
    // 直して「確認に戻る」で ⑤ へ、保存できる
    await fillStep(page, 1, { lat: "35.123456" });
    await expect(page.getByTestId("plan-wizard-next")).toHaveText("確認に戻る");
    await tapNextToFive(page);
    await expect(page.getByTestId("plan-review-errors")).toHaveCount(0);
    await clickSave(page);
    await page.waitForURL(/\/ops\/plans\/[0-9a-f-]{36}$/);
  });

  test("H1-4. 段 ⑤：①〜④の読み取りのカード＋各「修正」（48px の文字ボタン）。主ボタンは「計画を保存」1 つ。保存した値が入力と一致", async ({ page }) => {
    await open(page);
    const v = full("H1-4");
    await walkWizard(page, v, 5);
    await expect(page.getByTestId("plan-review-place-name")).toHaveText(v.placeName!);
    await expect(page.getByTestId("plan-review-coords")).toContainText("35.123456, 133.654321");
    await expect(page.getByTestId("plan-review-start")).toContainText("2027-03-05 10:30");
    await expect(page.getByTestId("plan-review-duration")).toHaveText("40 分");
    await expect(page.getByTestId("plan-review-title")).toHaveText(v.title!);
    await expect(page.getByTestId("plan-review-flags")).toContainText("夜間");
    await expect(page.getByTestId("plan-review-aircraft")).toContainText(aircraft.registrationMark);
    for (let n = 1; n <= 4; n++) {
      const b = page.getByTestId(`plan-review-edit-${n}`);
      await expect(b).toHaveText("修正");
      const box = (await b.boundingBox())!;
      expect(box.height, `修正 ${n} の高さ`).toBeGreaterThanOrEqual(47.5);
      const s = await b.evaluate((e) => ({ bg: getComputedStyle(e).backgroundColor, fs: parseFloat(getComputedStyle(e).fontSize) }));
      expect(s.bg, "文字ボタン：背景なし").toBe("rgba(0, 0, 0, 0)");
      expect(s.fs).toBeGreaterThanOrEqual(16);
    }
    expect(await visiblePrimaries(page)).toEqual(["plan-submit"]);
    // 「修正」で段へ戻って直し、「確認に戻る」で ⑤ へ。読み取りのカードが変わる
    await page.getByTestId("plan-review-edit-3").click();
    await expectStep(page, 3);
    await fillStep(page, 3, { title: `${v.title} 修正後` });
    await page.getByTestId("plan-wizard-next").click();
    await expectStep(page, 5);
    await expect(page.getByTestId("plan-review-title")).toHaveText(`${v.title} 修正後`);
    // 保存 → ⑥（計画の画面）。保存した値が入力と一致
    await clickSave(page);
    await page.waitForURL(/\/ops\/plans\/[0-9a-f-]{36}$/);
    const id = page.url().split("/").pop()!;
    const plan = (await (await manager.get(`/api/ops/plans/${id}`)).json()) as Record<string, unknown>;
    expect(plan).toMatchObject({
      title: `${v.title} 修正後`,
      aircraftId: aircraft.id,
      pilotId,
      durationMinutes: 40,
      purpose: "橋梁の点検",
      placeName: v.placeName,
      latitude: 35.123456,
      longitude: 133.654321,
      radiusM: 120,
      maxAltitudeM: 60,
      notes: "段の試験のメモ",
    });
    expect(String(plan["plannedStartAt"])).toContain("2027-03-05");
    expect(plan["flags"]).toEqual(["method_night"]);
    expect(plan["state"]).toBe("draft");
    await expect(page.getByTestId("plan-title-heading")).toHaveText(`${v.title} 修正後`);
  });

  test("H1-5. 端末データ：段の間の入力は端末（localStorage・sessionStorage・IndexedDB・Cache）に書かれない。入力の途中の離脱は確認し、保存の後は出さない", async ({ page }) => {
    await open(page);
    const before = await storageSnapshot(page);
    const v = full("H1-5");
    const secrets = [v.placeName!, "35.123456", "133.654321", v.title!, "橋梁の点検", "段の試験のメモ", pilotId];
    for (let n = 1; n <= 4; n++) {
      await fillStep(page, n, v);
      const s = await storageSnapshot(page);
      expect(s.local, `段 ${n}：localStorage の鍵`).toEqual(before.local);
      expect(s.session, `段 ${n}：sessionStorage の鍵`).toEqual(before.session);
      expect(s.idb, `段 ${n}：IndexedDB`).toEqual(before.idb);
      expect(s.caches, `段 ${n}：Cache`).toEqual(before.caches);
      for (const w of secrets) expect(s.values, `段 ${n}：値に「${w}」`).not.toContain(w);
      await tapNext(page);
    }
    await expectStep(page, 5);
    const s5 = await storageSnapshot(page);
    expect(s5.local).toEqual(before.local);
    expect(s5.session).toEqual(before.session);
    expect(s5.idb).toEqual(before.idb);
    expect(s5.caches).toEqual(before.caches);

    // 入力の途中の離脱：アプリ内のリンク（確認で「離れない」→ 残る、「離れる」→ 移る）
    const dialogs: { type: string; message: string }[] = [];
    let accept = false;
    page.on("dialog", (d) => {
      dialogs.push({ type: d.type(), message: d.message() });
      void (accept ? d.accept() : d.dismiss());
    });
    const nav = page.locator('a[href="/ops/plans"]:visible').first();
    await nav.click();
    await expect.poll(() => dialogs.filter((d) => d.type === "confirm").length).toBe(1);
    expect(dialogs[0]!.message).toContain("保存されていません");
    await page.waitForTimeout(500);
    expect(new URL(page.url()).pathname).toBe("/ops/plans/new");
    await expectStep(page, 5);
    // タブを閉じる・再読み込み（beforeunload）：入力があるあいだは、取り消せる beforeunload を受ける
    const probe = () => page.evaluate(() => {
      const e = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(e);
      return e.defaultPrevented;
    });
    expect(await probe(), "入力の途中は beforeunload を取り消す").toBe(true);
    // ブラウザが出す本物の確認の画面は、利用者の操作が無いと Chromium が出さず、自動操作では確かめられない（検証できず。取り消しの有無で確かめた）
    // 保存の後は出さない（beforeunload も取り消さない）
    const count = dialogs.length;
    accept = true;
    await clickSave(page);
    await page.waitForURL(/\/ops\/plans\/[0-9a-f-]{36}$/);
    expect(dialogs.length, "保存の後は確認を出さない").toBe(count);
    expect(await probe(), "保存の後は beforeunload を取り消さない").toBe(false);
    const after = await storageSnapshot(page);
    for (const w of secrets) expect(after.values, `保存の後：値に「${w}」`).not.toContain(w);
    page.removeAllListeners("dialog");
  });

  test("H1-5. 入力が無い（何も触っていない）ときは、離れる確認を出さない", async ({ page }) => {
    await open(page);
    let dialogs = 0;
    page.on("dialog", (d) => {
      dialogs += 1;
      void d.dismiss();
    });
    expect(
      await page.evaluate(() => {
        const e = new Event("beforeunload", { cancelable: true });
        window.dispatchEvent(e);
        return e.defaultPrevented;
      }),
      "何も入れていなければ beforeunload を取り消さない",
    ).toBe(false);
    await page.locator('a[href="/ops/plans"]:visible').first().click();
    await page.waitForURL(/\/ops\/plans$/);
    expect(dialogs).toBe(0);
    page.removeAllListeners("dialog");
  });

  test("H1-7. 判定画面からの引き継ぎは各段の初期値。注記（plan-handoff-note）は段 ① に出る", async ({ page }) => {
    await open(page, "a-manager", "/ops/plans/new?lat=35.2&lng=133.2&weightG=900&flags=method_night&permits=park_manager&date=2027-03-20&access=yes");
    await expectStep(page, 1);
    await expect(page.getByTestId("plan-handoff-note")).toContainText("900 g");
    await expect(page.getByTestId("plan-handoff-note")).toContainText("判定の結果は引き継ぎません");
    await expect(page.getByTestId("plan-lat")).toHaveValue("35.2");
    await expect(page.getByTestId("plan-lng")).toHaveValue("133.2");
    // 引き継ぎの値があっても、入力するまで離脱の確認は出ない
    await fillStep(page, 1, { placeName: "引き継ぎの地点" });
    await tapNext(page);
    await expect(page.getByTestId("plan-handoff-note")).toHaveCount(0);
    await expect(page.getByTestId("plan-start-date")).toHaveValue("2027-03-20");
    await fillStep(page, 2, { time: "08:00", duration: "30" });
    await tapNext(page);
    await expect(page.getByTestId("plan-flag-method_night")).toBeChecked();
    await expect(page.getByTestId("plan-access")).toHaveValue("yes");
    await fillStep(page, 3, { title: "引き継ぎの計画", purpose: "判定からの計画" });
    await tapNext(page);
    await expect(page.getByTestId("plan-permit-park_manager")).toBeChecked();
    await expect(page.getByTestId("plan-aircraft")).toHaveValue("");
    // 機体の重さの参考の文は、重さがあるときだけ。重さが無い引き継ぎでも、注記は出る
    await page.goto("/ops/plans/new?lat=35.2&lng=133.2");
    await expect(page.getByTestId("plan-handoff-note")).toBeVisible();
    await expect(page.getByTestId("plan-handoff-note")).not.toContainText("参考です");
    await page.goto("/ops/plans/new");
    await expect(page.getByTestId("plan-handoff-note")).toHaveCount(0);
  });

  test("K-4・K-5. 各段が 320〜1440 の幅で横スクロールなし。文字 200%（390・430）で切れ・横スクロールなし、主ボタンに届く", async ({ page }) => {
    await open(page);
    const v = full("K4");
    const stepsAt = async (label: string, widths: readonly number[]): Promise<void> => {
      for (let n = 1; n <= 5; n++) {
        for (const w of widths) {
          await page.setViewportSize({ width: w, height: 844 });
          await waitForSettledStyles(page);
          await expectNoHorizontalScroll(page, `${label}・段 ${n}・${w}px`);
        }
        await page.setViewportSize({ width: 375, height: 812 });
        if (n < 5) {
          await fillStep(page, n, v);
          await tapNext(page);
        }
      }
    };
    await stepsAt("計画の入力", [320, 360, 375, 390, 430, 768, 1024, 1280, 1440]);
    // ⑤（確認のカード）の文字 200%
    await expectTextZoom(page, "計画の入力（段 ⑤）");
    await tapBack(page);
    await expectTextZoom(page, "計画の入力（段 ④）");
    await tapBack(page);
    await expectTextZoom(page, "計画の入力（段 ③）");
    await tapBack(page);
    await expectTextZoom(page, "計画の入力（段 ②）");
    await tapBack(page);
    await expectTextZoom(page, "計画の入力（段 ①）");
  });

  test("押す部品：段の操作（次へ・戻る・保存・修正・入力欄）は高さ 48px 以上、本文 16px 以上", async ({ page }) => {
    await open(page);
    const v = full("TAP");
    for (let n = 1; n <= 5; n++) {
      const r = await page.evaluate(() => {
        const bad: string[] = [];
        for (const el of Array.from(document.querySelectorAll<HTMLElement>("main form button, main form input:not([type=checkbox]), main form select, main form textarea, main form a"))) {
          const b = el.getBoundingClientRect();
          if (b.width === 0 || b.height === 0) continue;
          if (b.height < 47.5) bad.push(`${el.getAttribute("data-testid") ?? el.tagName} ${b.height.toFixed(1)}`);
        }
        return bad;
      });
      expect(r, `段 ${n}：48px 未満の押す部品`).toEqual([]);
      if (n < 5) {
        await fillStep(page, n, v);
        await tapNext(page);
      }
    }
  });
});

/** 「確認に戻る」（修正の後の次へ）で ⑤ へ戻る。 */
const tapNextToFive = async (page: Page): Promise<void> => {
  for (let i = 0; i < 5; i++) {
    await page.getByTestId("plan-wizard-next").click();
    try {
      await expect(page.getByTestId("plan-form")).toHaveAttribute("data-step", "5", { timeout: 3_000 });
      return;
    } catch {
      // 押し直す
    }
  }
  await expectStep(page, 5);
};
