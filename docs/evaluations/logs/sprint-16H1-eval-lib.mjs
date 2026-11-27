// Sprint 16-H1 評価用の共通部品（手動シナリオの測定。アプリのコードは変えない）。
import { chromium, request } from "@playwright/test";

export const BASE = process.env.EVAL_BASE ?? "http://127.0.0.1:3400";
export const stamp = Date.now().toString(36).toUpperCase();
export const SHOT = "/home/user/soraban/docs/evaluations/screenshots/sprint-16H1";

export const apiAs = async (key) => {
  const ctx = await request.newContext({ baseURL: BASE });
  const r = await ctx.post("/api/test-auth/sign-in", { data: { authUserId: key, email: `${key}@example.test`, emailVerified: true, name: key } });
  if (r.status() !== 200) throw new Error(`sign-in ${key} ${r.status()}`);
  return ctx;
};
export const launch = () => chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
export const newPage = async (browser, key, viewport, extra = {}) => {
  const context = await browser.newContext({ viewport, hasTouch: false, serviceWorkers: "block", ...extra });
  const r = await context.request.post(`${BASE}/api/test-auth/sign-in`, { data: { authUserId: key, email: `${key}@example.test`, emailVerified: true, name: key } });
  if (r.status() !== 200) throw new Error("sign-in failed");
  const page = await context.newPage();
  return { context, page };
};
export const mkAircraft = async (ctx, tag, kg = 0.9) => {
  const mark = `JU${tag}${stamp}`.slice(0, 20);
  const r = await ctx.post("/api/ops/aircraft", { data: { registrationMark: mark, modelName: "評価機", manufacturer: "DJI", serialNumber: `SN-${mark}`, typeCertified: false, initialFlightMinutes: 0, maxTakeoffWeightKg: kg } });
  if (r.status() !== 201) throw new Error("aircraft " + (await r.text()));
  return { id: (await r.json()).id, mark };
};
export const pilotIdOf = async (key) => {
  const c = await apiAs(key);
  const me = await (await c.get("/api/ops/me")).json();
  await c.dispose();
  return me.pilotId;
};
export const shot = (page, name, full = false) => page.screenshot({ path: `${SHOT}/eval-${name}.png`, fullPage: full });
export const settle = async (page) => {
  await page.waitForFunction(() => document.getAnimations().length === 0, null, { timeout: 5000 }).catch(() => undefined);
  await page.waitForTimeout(200);
};
export const T = (page, id) => page.locator(`[data-testid="${id}"]`);
export const stepOf = (page) => T(page, "plan-form").getAttribute("data-step");
export const tapNext = async (page) => {
  const cur = Number(await stepOf(page));
  for (let i = 0; i < 5; i++) {
    await T(page, "plan-wizard-next").click();
    await page.waitForTimeout(400);
    if (Number(await stepOf(page)) !== cur) return { attempts: i + 1 };
  }
  return { attempts: 5, stuck: true };
};
