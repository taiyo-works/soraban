import { expect, request as pwRequest, test, type APIRequestContext, type Page } from "@playwright/test";
import { expectFontSize } from "../field-checks";
import { saveScan, scanPage, violationsOf, type ScanRecord } from "../wording-scan";
import { clickSave, expectStep, fillStep, tapBack, tapNext, walkWizard, type WizardValues } from "./plan-wizard";

// Sprint 16-H1 差し戻し 1（reviewer の指摘 R-1・R-3・R-4・N-1〜N-7）の E2E-DB。
// 元の sprint16-h1-db.spec.ts は serial（1 件の失敗で後続が飛ぶ）なので、落ちてよい検査（R-1 の段 ⑤ の行の高さ）を別のファイルにして、互いに独立にした。
const BASE = `http://127.0.0.1:${process.env["E2E_OPS_PORT"] ?? 3300}`;
const stamp = Date.now().toString(36).toUpperCase();

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

test.use({ viewport: { width: 390, height: 844 }, hasTouch: false });

let aircraft: { id: string; registrationMark: string };
let pilotId = "";
let placeName = "";

test.beforeAll(async () => {
  const manager = await apiAs(seeded("a-manager"));
  const registrationMark = `JUSF1${stamp}`.slice(0, 20);
  const r = await manager.post("/api/ops/aircraft", {
    data: { registrationMark, modelName: "段の差し戻し試験機", manufacturer: "DJI", serialNumber: `SN-${registrationMark}`, typeCertified: false, initialFlightMinutes: 0, maxTakeoffWeightKg: 0.9 },
  });
  expect(r.status(), await r.text()).toBe(201);
  aircraft = { ...((await r.json()) as { id: string }), registrationMark };
  placeName = `差し戻し試験の地点 ${stamp}`;
  const p = await manager.post("/api/ops/places", { data: { name: placeName, latitude: 35.1, longitude: 133.1 } });
  expect(p.status(), await p.text()).toBe(201);
  const pilotCtx = await apiAs(seeded("a-pilot"));
  pilotId = ((await (await pilotCtx.get("/api/ops/me")).json()) as { pilotId: string }).pilotId;
  await pilotCtx.dispose();
  await manager.dispose();
});

const open = async (page: Page, url = "/ops/plans/new", who = "a-manager"): Promise<void> => {
  await signIn(page.request, seeded(who));
  await page.goto(url);
  await expect(page.getByTestId("plan-form")).toBeVisible();
  await page.waitForLoadState("networkidle").catch(() => undefined);
};

const full = (label: string): WizardValues => ({
  placeName: `段の差し戻し地点 ${label}`,
  lat: "35.123456",
  lng: "133.654321",
  radius: "120",
  date: "2027-03-05",
  time: "10:30",
  duration: "40",
  title: `E2E 差し戻し ${label}`,
  purpose: "橋梁の点検",
  altitude: "60",
  flags: ["method_night"],
  aircraftId: aircraft.id,
  pilotId,
  permitNumbers: "",
  notes: "差し戻し試験のメモ",
});

/** 段 n まで入力して進む（n=1 は何もしない）。 */
const goToStep = async (page: Page, n: number, v: WizardValues): Promise<void> => {
  if (n > 1) await walkWizard(page, v, n);
};

/** 段の移動を押し直して待つ（Next のルーターの最初の押下の揺れ。sprint-16.md §17-9）。 */
const tapFix = async (page: Page, testId: string, to: number): Promise<void> => {
  for (let i = 0; i < 5; i++) {
    await page.getByTestId(testId).click();
    try {
      await expect(page.getByTestId("plan-form")).toHaveAttribute("data-step", String(to), { timeout: 3_000 });
      return;
    } catch {
      // 押し直す
    }
  }
  await expectStep(page, to);
};

const failSave = async (page: Page, fields: Record<string, string>): Promise<void> => {
  await page.route("**/api/ops/plans", (route) => {
    if (route.request().method() !== "POST") return route.continue();
    return route.fulfill({ status: 422, contentType: "application/json", body: JSON.stringify({ error: "invalid_input", fields }) });
  });
};

test.describe("R-1. 段 ①〜⑤：禁止語・限定語の走査（18-3）と本文 16px・行の高さ 1.7（16-B R1-3/R1-4）", () => {
  test("R-1a. 段 ①〜⑤ を順に進め、各段で禁止語・限定語の走査（violationsOf）が 0 件", async ({ page }) => {
    test.setTimeout(120_000);
    await open(page);
    const v = full("R1a");
    const all: ScanRecord[] = [];
    for (let n = 1; n <= 5; n++) {
      await expectStep(page, n);
      all.push(...(await scanPage(page, "/ops/plans/new", `段 ${n}`)));
      if (n < 5) {
        await fillStep(page, n, v);
        await tapNext(page);
      }
    }
    // 誤りを出した状態（段 ① の入力漏れ）も走査する
    await tapBack(page);
    await tapBack(page);
    await tapBack(page);
    await tapBack(page);
    await expectStep(page, 1);
    await fillStep(page, 1, { placeName: "", lat: "", lng: "" });
    await page.getByTestId("plan-wizard-next").click();
    await expect(page.locator("main .sb-field-error:visible").first()).toBeVisible();
    all.push(...(await scanPage(page, "/ops/plans/new", "段 1（入力漏れの誤り）")));
    saveScan("ops-plan-wizard-steps", all);
    expect(violationsOf(all)).toEqual([]);
  });

  for (const n of [1, 2, 3, 4, 5]) {
    // 段 ⑤ は `.opx-wiz-row dd` の行の高さが 1.6（16-B R1-3 の 1.7 未満）。CSS は designer の担当なので、designer の修正までこの 1 件は失敗のまま残す
    test(`R-1b. 段 ${n}：印のない p・li・dd は 16px・1.7 以上、data-note は 14px・1.5 以上（375・390・1280px）`, async ({ page }) => {
      await open(page);
      await goToStep(page, n, full(`R1b${n}`));
      await expectStep(page, n);
      for (const w of [375, 390, 1280]) {
        await page.setViewportSize({ width: w, height: w >= 1024 ? 800 : 844 });
        await expectFontSize(page, "body", 14, `計画の作成 段 ${n} ${w}px`, { body: 16 });
      }
    });
  }
});

test.describe("R-3・N-1・N-2. サーバーの 422 が段へ戻る導線で、fieldset・欄に結ばれる", () => {
  test("R-3・N-1. 422（flags・pilotPermits）→ ③・④へ戻る。fieldset の aria-describedby に plan-err-flags・plan-err-pilotPermits、記号付きの 1 行。直すと下の誤りの 1 行も消え、保存できる", async ({ page }) => {
    await open(page);
    await walkWizard(page, full("R3"), 5);
    await failSave(page, { flags: "飛行の方法の選び方を見直してください", pilotPermits: "同意・通報・許可の選び方を見直してください" });
    await clickSave(page);
    await expect(page.getByTestId("plan-review-errors")).toBeVisible();
    await expect(page.getByTestId("plan-review-error")).toHaveCount(2);
    await expect(page.getByTestId("plan-review-error-fix-3")).toBeVisible();
    await expect(page.getByTestId("plan-review-error-fix-4")).toBeVisible();
    await expect(page.locator("[data-form-error]")).toBeVisible();

    const linked = async (fieldset: string, errId: string, text: string): Promise<void> => {
      const fs = page.getByTestId(fieldset);
      expect(((await fs.getAttribute("aria-describedby")) ?? "").split(/\s+/), `${fieldset} の aria-describedby`).toContain(errId);
      const e = page.locator(`#${errId}`);
      await expect(e).toBeVisible();
      await expect(e).toContainText(text);
      await expect(e.locator("svg"), "記号").toHaveCount(1);
      expect(await e.getAttribute("role"), "role は alert でない").toBeNull();
    };
    await tapFix(page, "plan-review-error-fix-3", 3);
    await linked("plan-flags", "plan-err-flags", "飛行の方法の選び方");
    // 直して「確認に戻る」：③の誤りは消え、④の誤りは残る。下の誤りの 1 行は、まだ残っている誤りがあるので残る
    await expect(page.getByTestId("plan-wizard-next")).toHaveText("確認に戻る");
    await tapFix(page, "plan-wizard-next", 5);
    await expect(page.getByTestId("plan-review-error")).toHaveCount(1);
    await expect(page.locator("[data-form-error]")).toBeVisible();
    await tapFix(page, "plan-review-error-fix-4", 4);
    await linked("plan-permits", "plan-err-pilotPermits", "同意・通報・許可の選び方");
    // N-1：誤りが空になったら、下の誤りの 1 行も消える
    await tapFix(page, "plan-wizard-next", 5);
    await expect(page.getByTestId("plan-review-errors")).toHaveCount(0);
    await expect(page.locator("[data-form-error]"), "N-1：下の誤りの 1 行が消える").toHaveCount(0);
    // 保存できる
    await page.unroute("**/api/ops/plans");
    await clickSave(page);
    await page.waitForURL(/\/ops\/plans\/[0-9a-f-]{36}$/);
  });

  test("N-2. 422（savedPlaceId・thirdPartyOverflight）→ ① の「よく使う地点」の欄と ③ の「立入管理措置／第三者上空」の欄に、結ばれた記号付きの 1 行", async ({ page }) => {
    await open(page);
    await fillStep(page, 1, { savedPlace: placeName });
    await tapNext(page);
    await walkWizard(page, { ...full("N2"), placeName: undefined, lat: undefined, lng: undefined, access: "no_third_party" }, 5);
    await failSave(page, { savedPlaceId: "選べない地点です", thirdPartyOverflight: "第三者上空の選び方を見直してください" });
    await clickSave(page);
    await expect(page.getByTestId("plan-review-error")).toHaveCount(2);
    await expect(page.getByTestId("plan-review-error-fix-1")).toBeVisible();
    await expect(page.getByTestId("plan-review-error-fix-3")).toBeVisible();
    const inField = async (testId: string, text: string): Promise<void> => {
      const el = page.getByTestId(testId);
      await expect(el).toHaveAttribute("aria-invalid", "true");
      const ids = ((await el.getAttribute("aria-describedby")) ?? "").split(/\s+/);
      const err = page.locator(".sb-field-error:visible", { hasText: text });
      await expect(err).toHaveCount(1);
      expect(ids).toContain((await err.getAttribute("id")) ?? "none");
      await expect(err.locator("svg")).toHaveCount(1);
    };
    await tapFix(page, "plan-review-error-fix-1", 1);
    await inField("plan-saved-place", "選べない地点です");
    await tapFix(page, "plan-wizard-next", 5);
    await tapFix(page, "plan-review-error-fix-3", 3);
    await inField("plan-access", "第三者上空の選び方");
  });
});

test.describe("R-4. ブラウザの戻る（番兵の履歴）", () => {
  const typeAtStepOne = async (page: Page): Promise<void> => {
    await fillStep(page, 1, { placeName: "戻るの確認の地点" });
  };
  const viaList = async (page: Page): Promise<void> => {
    await signIn(page.request, seeded("a-manager"));
    await page.goto("/ops/plans");
    await page.waitForLoadState("networkidle").catch(() => undefined);
    await page.getByTestId("plan-new-link").click();
    await expect(page.getByTestId("plan-form")).toBeVisible();
    await page.waitForLoadState("networkidle").catch(() => undefined);
  };

  test("R-4. 入力のあと、段 ① でブラウザの戻る → 確認。取り消すと留まり（入力は残る）、もう一度戻ると再び確認。離れるを選ぶと前の画面へ", async ({ page }) => {
    await viaList(page);
    const dialogs: { type: string; message: string }[] = [];
    let accept = false;
    page.on("dialog", (d) => {
      dialogs.push({ type: d.type(), message: d.message() });
      void (accept ? d.accept() : d.dismiss());
    });
    await typeAtStepOne(page);
    await page.goBack();
    await expect.poll(() => dialogs.length).toBe(1);
    expect(dialogs[0]!.type).toBe("confirm");
    expect(dialogs[0]!.message).toContain("保存されていません");
    await expect(page.getByTestId("plan-form")).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/ops/plans/new");
    await expectStep(page, 1);
    await expect(page.getByTestId("plan-place-name")).toHaveValue("戻るの確認の地点");
    // 番兵が積み直されている：もう一度戻ると、また確認
    await page.goBack();
    await expect.poll(() => dialogs.length).toBe(2);
    expect(new URL(page.url()).pathname).toBe("/ops/plans/new");
    // 離れるを選ぶ
    accept = true;
    await page.goBack();
    await expect.poll(() => dialogs.length).toBeGreaterThanOrEqual(3);
    await page.waitForURL(/\/ops\/plans$/);
    page.removeAllListeners("dialog");
  });

  test("R-4. 入力が無いときは、ブラウザの戻るで確認を出さない", async ({ page }) => {
    await viaList(page);
    let dialogs = 0;
    page.on("dialog", (d) => {
      dialogs += 1;
      void d.dismiss();
    });
    await page.goBack();
    await page.waitForURL(/\/ops\/plans$/);
    expect(dialogs).toBe(0);
    page.removeAllListeners("dialog");
  });

  test("R-4. 段の間の戻る・進む（段 ② から ① など）では確認を出さない", async ({ page }) => {
    await viaList(page);
    let dialogs = 0;
    page.on("dialog", (d) => {
      dialogs += 1;
      void d.dismiss();
    });
    const v = full("R4c");
    await walkWizard(page, v, 3);
    await page.goBack();
    await expectStep(page, 2);
    await page.goBack();
    await expectStep(page, 1);
    await page.goForward();
    await expectStep(page, 2);
    expect(dialogs).toBe(0);
    page.removeAllListeners("dialog");
  });
});

test.describe("N-3・N-5・N-6・N-7", () => {
  test("N-3. 履歴の移動で ⑤ に着いたとき、①〜④に漏れがあれば、漏れのある最初の段へ戻す", async ({ page }) => {
    await open(page);
    await walkWizard(page, full("N3"), 5);
    await page.goBack();
    await page.goBack();
    await page.goBack();
    await expectStep(page, 2);
    await fillStep(page, 2, { time: "" });
    await page.goForward();
    await page.goForward();
    await page.goForward();
    await expectStep(page, 2);
    await expect(page.getByTestId("plan-start-time")).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByTestId("plan-wizard-next")).toHaveText("確認に戻る");
    await fillStep(page, 2, { time: "11:00" });
    await tapFix(page, "plan-wizard-next", 5);
    await expect(page.getByTestId("plan-review-start")).toContainText("11:00");
  });

  test("N-5. 各段で URL のクエリは step だけ。history.state に入力値（氏名・座標・計画名・目的・メモ）が無い", async ({ page }) => {
    await open(page);
    const v = full("N5");
    const secrets = [v.placeName!, "35.123456", "133.654321", v.title!, "橋梁の点検", v.notes!, pilotId];
    for (let n = 1; n <= 5; n++) {
      if (n < 5) await fillStep(page, n, v);
      const u = new URL(page.url());
      expect([...u.searchParams.keys()], `段 ${n}：URL のクエリ`).toEqual(n === 1 && !u.searchParams.has("step") ? [] : ["step"]);
      const state = await page.evaluate(() => JSON.stringify(window.history.state));
      for (const w of secrets) {
        expect(state, `段 ${n}：history.state に「${w}」`).not.toContain(w);
        expect(u.search + u.hash, `段 ${n}：URL に「${w}」`).not.toContain(encodeURIComponent(w));
      }
      if (n < 5) await tapNext(page);
    }
  });

  test("N-5. 引き継ぎの URL でも、各段のクエリは引き継ぎの鍵と step だけ。入力した値は URL・history.state に出ない", async ({ page }) => {
    await open(page, "/ops/plans/new?lat=35.2&lng=133.2&flags=method_night&date=2027-03-20");
    const allowed = new Set(["lat", "lng", "flags", "date", "step"]);
    const v = full("N5h");
    const secrets = [v.placeName!, v.title!, v.notes!, pilotId];
    for (let n = 1; n <= 4; n++) {
      await fillStep(page, n, n === 1 ? { placeName: v.placeName! } : n === 2 ? { time: "08:00", duration: "30" } : n === 3 ? { title: v.title!, purpose: "判定からの計画" } : { aircraftId: aircraft.id, pilotId, notes: v.notes! });
      const u = new URL(page.url());
      for (const k of u.searchParams.keys()) expect(allowed.has(k), `段 ${n}：クエリ ${k}`).toBe(true);
      const state = await page.evaluate(() => JSON.stringify(window.history.state));
      for (const w of secrets) {
        expect(state, `段 ${n}：history.state に「${w}」`).not.toContain(w);
        expect(decodeURIComponent(u.search), `段 ${n}：URL に「${w}」`).not.toContain(w);
      }
      await tapNext(page);
    }
  });

  test("N-6. 引き継ぎの値があっても、入力の前は beforeunload が取り消されない。入力すると取り消される", async ({ page }) => {
    await open(page, "/ops/plans/new?lat=35.2&lng=133.2&weightG=900&flags=method_night&permits=park_manager&date=2027-03-20&access=yes");
    await expect(page.getByTestId("plan-handoff-note")).toBeVisible();
    const probe = () =>
      page.evaluate(() => {
        const e = new Event("beforeunload", { cancelable: true });
        window.dispatchEvent(e);
        return e.defaultPrevented;
      });
    expect(await probe(), "引き継ぎの値だけでは取り消さない").toBe(false);
    await fillStep(page, 1, { placeName: "引き継ぎの地点" });
    expect(await probe(), "入力すると取り消す").toBe(true);
  });

  test("N-7. この画面に /ops/plans/new そのもの（クエリ違いを含む）へのリンクが無い", async ({ page }) => {
    await open(page);
    for (let n = 1; n <= 5; n++) {
      expect(await page.locator('a[href^="/ops/plans/new"]').count(), `段 ${n}：/ops/plans/new へのリンク`).toBe(0);
      if (n < 5) {
        await fillStep(page, n, full("N7"));
        await tapNext(page);
      }
    }
  });
});
