const { chromium, request } = require("/home/user/soraban/node_modules/@playwright/test");
const fs = require("fs");
const BASE = "http://127.0.0.1:" + (process.env.PORT || 3400);
const OUT = process.argv[2];
const DAY = "2027-01-05";
const KEYS = ["general","propeller","frame","communication","propulsion","power","autopilot","controller","battery"];
const stamp = Date.now().toString(36).toUpperCase();
const signIn = async (ctx, key) => { const r = await ctx.post("/api/test-auth/sign-in", { data: { authUserId: key, email: key + "@example.test", emailVerified: true, name: key } }); if (r.status() !== 200) throw new Error("signin " + r.status()); };
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const api = await request.newContext({ baseURL: BASE });
  await signIn(api, "a-manager");
  const pilotCtx = await request.newContext({ baseURL: BASE }); await signIn(pilotCtx, "a-pilot");
  const pilotId = (await (await pilotCtx.get("/api/ops/me")).json()).pilotId;
  const mk = async (m) => { const r = await api.post("/api/ops/aircraft", { data: { registrationMark: m, modelName: "点検の試験機", manufacturer: "DJI", serialNumber: "SN-" + m, typeCertified: false, initialFlightMinutes: 0, maxTakeoffWeightKg: 0.9 } }); if (r.status() !== 201) throw new Error(await r.text()); return (await r.json()).id; };
  const acNew = await mk(("JU16S" + stamp + "A").slice(0, 20));
  const acOk = await mk(("JU16S" + stamp + "B").slice(0, 20));
  const acBad = await mk(("JU16S" + stamp + "C").slice(0, 20));
  const acVoid = await mk(("JU16S" + stamp + "D").slice(0, 20));
  const post = async (aircraftId, at, timing, abnormal) => { const r = await api.post("/api/ops/inspections", { data: { aircraftId, pilotId, inspectedAt: DAY + "T" + at, timing, placeName: "本社", items: { ...Object.fromEntries(KEYS.map(k => [k, { result: "normal" }])), ...(abnormal ? { propeller: { result: "abnormal", note: "欠け" } } : {}) } } }); if (r.status() !== 201) throw new Error(await r.text()); return (await r.json()).id; };
  await post(acOk, "08:00", "pre_flight", false);
  await post(acBad, "08:10", "post_flight", true);
  const vid = await post(acVoid, "08:20", "pre_flight", true);
  const v = await api.post(`/api/ops/inspections/${vid}/void`, { data: { expectedVersion: 1, reason: "試験の取消" } }); if (v.status() !== 200) throw new Error(await v.text());
  const plan = await api.post("/api/ops/plans", { data: { title: `未実施のカード ${stamp}`, aircraftId: acNew, pilotId, plannedStartAt: `${DAY}T13:00`, durationMinutes: 60, purpose: "空撮", placeName: "試験地点", latitude: 35.434238, longitude: 133.380508, flags: [] } });
  if (plan.status() !== 201) throw new Error(await plan.text());
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
  const only = process.argv[3] ? process.argv[3].split(",") : null;
  const scenes = {
    "input-incomplete": async (page) => { await page.goto(`/ops/inspections/new?aircraftId=${acNew}`); await page.getByTestId("inspection-item-general").waitFor(); for (const k of ["general","propeller","frame","communication"]) await page.getByRole("radiogroup", { name: new RegExp("の結果") }).filter({ has: page.locator(`input[name="item-${k}"]`) }).getByRole("radio", { name: "正常" }).check(); },
    "input-abnormal": async (page) => { await page.goto(`/ops/inspections/new?aircraftId=${acNew}`); await page.getByTestId("inspection-item-general").waitFor(); const rg = (k) => page.getByRole("radiogroup").filter({ has: page.locator(`input[name="item-${k}"]`) }); for (const k of ["general","frame"]) await rg(k).getByRole("radio", { name: "正常" }).check(); await rg("propeller").getByRole("radio", { name: "異常" }).check(); },
    "input-from-journal": async (page) => { await page.clock.setFixedTime(new Date("2027-01-05T11:30:00+09:00")); await page.goto(`/ops/inspections/new?aircraftId=${acNew}&takeoffAt=${DAY}T11:00`); await page.getByTestId("inspection-item-general").waitFor(); },
    "list": async (page) => { await page.goto("/ops/inspections?includeVoided=1"); await page.getByTestId("inspection-list").waitFor(); },
  };
  const sizes = [360, 375, 1280];
  for (const [name, fn] of Object.entries(scenes)) {
    if (only && !only.includes(name)) continue;
    for (const w of sizes) for (const z of [100, 200]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: w === 1280 ? 800 : 812 }, hasTouch: w < 1000, serviceWorkers: "block", baseURL: BASE });
      await signIn(ctx.request, "a-manager");
      const page = await ctx.newPage();
      await fn(page);
      await page.evaluate((z) => { document.documentElement.style.fontSize = z + "%"; }, z);
      await page.evaluate(() => document.getAnimations().forEach(a => a.finish()));
      await page.waitForTimeout(300);
      const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, h: document.documentElement.scrollHeight }));
      console.log(name, w, z, JSON.stringify(m));
      await page.screenshot({ path: `${OUT}/${name}-${w}-${z}.png`, fullPage: true });
      if (w === 375 && z === 100) {
        await page.screenshot({ path: `${OUT}/${name}-375-100-first.png` });
        await page.addStyleTag({ content: "html{filter:grayscale(1)}" });
        await page.screenshot({ path: `${OUT}/${name}-375-100-gray.png`, fullPage: true });
      }
      await ctx.close();
    }
  }
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
