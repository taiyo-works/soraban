import { launch, signedCtx, api, SHOT } from "./lib.mjs";
const KEYS = ["general","propeller","frame","communication","propulsion","power","autopilot","controller","battery"];
const DAY = "2027-01-05";
const m = await api("a-manager");
const p = await api("a-pilot");
const pilotId = (await (await p.get("/api/ops/me")).json()).pilotId;
const tag = Date.now().toString(36).toUpperCase().slice(-5);
const mk = async (mark) => { const r = await m.post("/api/ops/aircraft", { data: { registrationMark: mark, modelName: "評価機", manufacturer: "DJI", serialNumber: "SN-" + mark, typeCertified: false, initialFlightMinutes: 0, maxTakeoffWeightKg: 0.9 } }); return (await r.json()).id; };
const N = await mk("JU16N" + tag), A = await mk("JU16A" + tag), N2 = await mk("JU16M" + tag), A2 = await mk("JU16B" + tag);
const ins = async (ac, abn, t) => { const r = await m.post("/api/ops/inspections", { data: { aircraftId: ac, pilotId, inspectedAt: `${DAY}T${t}`, timing: "pre_flight", placeName: "本社", items: { ...Object.fromEntries(KEYS.map(k => [k, { result: "normal" }])), ...(abn ? { propeller: { result: "abnormal", note: "欠け" } } : {}) } } }); if (r.status()!==201) throw new Error(await r.text()); return (await r.json()).id; };
await ins(N, false, "08:00"); await ins(A, true, "08:10");
const nv = await ins(N2, false, "08:20"); const av = await ins(A2, true, "08:30");
for (const id of [nv, av]) { const v = await m.post(`/api/ops/inspections/${id}/void`, { data: { expectedVersion: 1, reason: "評価の取消" } }); if (v.status()!==200) throw new Error(await v.text()); }
const AC0 = "9c29615d-b3d2-415c-8d29-2e990530bc19";
const plan = await m.post("/api/ops/plans", { data: { title: "評価の未実施 " + tag, aircraftId: AC0, pilotId, plannedStartAt: `${DAY}T13:00`, durationMinutes: 60, purpose: "空撮", placeName: "試験地点", latitude: 35.434238, longitude: 133.380508, flags: [] } });
console.log("plan", plan.status());
console.log(JSON.stringify({ tag, N, A, N2, A2 }));
const b = await launch();
for (const [name, vp] of [["375", { width: 375, height: 812 }], ["1280", { width: 1280, height: 800 }]]) {
  const ctx = await signedCtx(b, "a-manager", { viewport: vp, hasTouch: name === "375" });
  const page = await ctx.newPage();
  await page.clock.setFixedTime(new Date("2027-01-05T12:00:00+09:00"));
  for (const q of ["", "?includeVoided=1"]) {
    await page.goto("/ops/inspections" + q);
    await page.getByTestId("inspection-list").waitFor();
    await page.waitForTimeout(700);
    const rows = await page.evaluate((tag) => {
      const sel = '[data-testid="inspection-row"],[data-testid="inspection-pending-row"]';
      return [...document.querySelectorAll(sel)].filter(e => /JU16[NAMB]/.test(e.innerText) || e.dataset.testid === "inspection-pending-row").map(e => ({ kind: e.dataset.testid, text: e.innerText.replace(/\n+/g, " | "), tones: [...e.querySelectorAll(".sb-state")].map(s => `${s.dataset.tone}:${s.innerText.trim()}:svg${s.querySelectorAll("svg").length}`), h: Math.round(e.getBoundingClientRect().height), tag: e.tagName }));
    }, tag);
    const prim = await page.evaluate(() => [...document.querySelectorAll("main .sb-pill-primary")].filter(e => e.getBoundingClientRect().height > 0).map(e => e.textContent.trim()));
    console.log(name, q || "(default)", JSON.stringify({ rows, prim }, null, 1));
    await page.screenshot({ path: `${SHOT}/s5-list-${name}${q ? "-voided" : ""}.png`, fullPage: true });
  }
  await ctx.close();
}
await b.close();
