// 16-N3 designer：1 行の帯の中身の自然な幅（圏外・888 件の最悪の場合）と、左右の余白を足したときに 1 行に収まるか。
import { chromium, request as pwRequest } from "@playwright/test";
const BASE = process.env.BASE ?? "http://127.0.0.1:3400";
const PAD = Number(process.env.PAD ?? 2);
const stamp = Date.now().toString(36).toUpperCase();
const c = await pwRequest.newContext({ baseURL: BASE });
await c.post("/api/test-auth/sign-in", { data: { authUserId: "a-manager", email: "a-manager@example.test", emailVerified: true, name: "a" } });
const post = async (p, d) => (await c.post(p, { data: d })).json();
const ac = await post("/api/ops/aircraft", { registrationMark: `JU16E${stamp}`.slice(0, 20), modelName: "N3", manufacturer: "DJI", serialNumber: `SN-E${stamp}`, typeCertified: false, initialFlightMinutes: 0, maxTakeoffWeightKg: 0.9 });
const pl = await post("/api/ops/pilots", { fullName: `現場 E${stamp}`, hasLicense: false });
const plan = await post("/api/ops/plans", { title: `帯 ${stamp}`, aircraftId: ac.id, pilotId: pl.id, plannedStartAt: "2027-01-05T13:00", durationMinutes: 30, purpose: "x", placeName: "y", latitude: 35.43, longitude: 133.38, flags: [] });
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
for (const w of [320, 360, 390, 430]) for (const z of [125, 150, 200]) {
  const ctx = await b.newContext({ viewport: { width: w, height: 700 }, hasTouch: true, locale: "ja-JP", serviceWorkers: "block" });
  await ctx.request.post(`${BASE}/api/test-auth/sign-in`, { data: { authUserId: "a-manager", email: "a-manager@example.test", emailVerified: true, name: "a" } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/ops/plans/${plan.id}/field`);
  await page.locator('[data-testid="field-root"][data-hydrated="true"]').waitFor();
  const r = await page.evaluate(([z, PAD]) => {
    document.documentElement.style.fontSize = z + "%";
    const e = document.querySelector('[data-testid="field-band-compact"]');
    if (getComputedStyle(e).display === "none") return null;
    e.style.paddingInline = PAD + "px";
    e.children[0].textContent = "× 接続なし（圏外）"; e.children[1].querySelector("span").textContent = "888 件";
    const a = e.children[0].getBoundingClientRect(), u = e.children[1].getBoundingClientRect();
    return { fs: getComputedStyle(e).fontSize, gap: Math.round((u.left - a.right) * 10) / 10, lines: e.getBoundingClientRect().height, sw: e.scrollWidth, cw: e.clientWidth, right: u.right };
  }, [z, PAD]);
  console.log(w, z, JSON.stringify(r));
  await ctx.close();
}
await b.close();
