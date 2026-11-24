// Sprint 16-G 評価用の共通部品（手動シナリオの測定。アプリのコードは変えない）。
import { chromium, request } from "@playwright/test";

export const BASE = process.env.EVAL_BASE ?? "http://127.0.0.1:3400";
export const DAY = "2027-01-05";
export const stamp = Date.now().toString(36).toUpperCase();
export const SHOT = "/home/user/soraban/docs/evaluations/screenshots/sprint-16G";

export const apiAs = async (key) => {
  const ctx = await request.newContext({ baseURL: BASE });
  const r = await ctx.post("/api/test-auth/sign-in", { data: { authUserId: key, email: `${key}@example.test`, emailVerified: true, name: key } });
  if (r.status() !== 200) throw new Error(`sign-in ${key} ${r.status()}`);
  return ctx;
};

export const launch = () =>
  chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });

export const newPage = async (browser, key, viewport, extra = {}) => {
  const context = await browser.newContext({ viewport, hasTouch: true, serviceWorkers: "block", ...extra });
  const r = await context.request.post(`${BASE}/api/test-auth/sign-in`, { data: { authUserId: key, email: `${key}@example.test`, emailVerified: true, name: key } });
  if (r.status() !== 200) throw new Error("sign-in failed");
  const page = await context.newPage();
  return { context, page };
};

export const voidAll = async (ctx) => {
  for (let i = 0; i < 6; i++) {
    const t = await (await ctx.get("/api/ops/today")).json();
    const ids = [...(t.card ? [t.card.planId] : []), ...t.rest.map((r) => r.planId), ...t.upcoming.map((u) => u.planId)];
    if (!ids.length) return;
    for (const id of ids) {
      const p = await (await ctx.get(`/api/ops/plans/${id}`)).json();
      if (!p.voided) await ctx.post(`/api/ops/plans/${id}/void`, { data: { expectedVersion: p.version, reason: "評価の後始末" } });
    }
  }
};

export const mkAircraft = async (ctx, tag, kg = 0.9) => {
  const mark = `JU${tag}${stamp}`.slice(0, 20);
  const r = await ctx.post("/api/ops/aircraft", { data: { registrationMark: mark, modelName: "評価機", manufacturer: "DJI", serialNumber: `SN-${mark}`, typeCertified: false, initialFlightMinutes: 0, maxTakeoffWeightKg: kg } });
  if (r.status() !== 201) throw new Error("aircraft " + (await r.text()));
  return (await r.json()).id;
};

export const pilotId = async () => {
  const bp = await apiAs("b-pilot");
  const me = await (await bp.get("/api/ops/me")).json();
  await bp.dispose();
  return me.pilotId;
};

export const mkPlan = async (ctx, o) => {
  const r = await ctx.post("/api/ops/plans", {
    data: { title: o.title, aircraftId: o.aircraftId, pilotId: o.pilotId, plannedStartAt: o.start ?? `${DAY}T13:00`, durationMinutes: 30, purpose: "空撮", placeName: o.place, latitude: o.lat ?? 35.434238, longitude: o.lng ?? 133.380508, flags: o.flags ?? [] },
  });
  if (r.status() !== 201) throw new Error("plan " + (await r.text()));
  return (await r.json()).id;
};

export const confirmPlan = async (ctx, id) => {
  const c = await (await ctx.get(`/api/ops/plans/${id}`)).json();
  const r = await ctx.post(`/api/ops/plans/${id}/request-confirmation`, { data: { expectedVersion: c.version } });
  if (r.status() !== 200) throw new Error("confirm " + (await r.text()));
};

export const record = async (ctx, id, manual, kind = "new") => {
  const a = await (await ctx.get(`/api/ops/plans/${id}`)).json();
  const r = await ctx.post(`/api/ops/plans/${id}/reports`, { data: { kind, expectedPlanVersion: a.version, inputs: { flightSpeed: 40, assistantsNumber: 1 }, manual: { reportedAt: `${DAY}T11:30`, confirmedDipsDone: true, confirmedMatchesLatest: true, ...manual } } });
  if (r.status() >= 300) throw new Error("report " + (await r.text()));
};

export const shot = (page, name) => page.screenshot({ path: `${SHOT}/eval-${name}.png`, fullPage: false });
export const waitStyles = async (page) => {
  await page.waitForFunction(() => document.getAnimations().length === 0, null, { timeout: 5000 }).catch(() => undefined);
  await page.waitForTimeout(250);
};
