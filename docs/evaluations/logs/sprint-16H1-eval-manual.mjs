// 手順 2・3: ①〜⑤を手で通して保存。進捗の帯・主ボタン・入力漏れ・端末データ・保存値の一致。
import { apiAs, launch, newPage, mkAircraft, pilotIdOf, shot, settle, T, stepOf, tapNext, BASE, stamp } from "./sprint-16H1-eval-lib.mjs";
const out = [];
const log = (o) => { out.push(o); console.log(JSON.stringify(o)); };
const mgr = await apiAs("a-manager");
const ac = await mkAircraft(mgr, "H1");
const pid = await pilotIdOf("a-pilot");
const browser = await launch();
const PRIMARY = '.opx-btn-primary, .sb-pill-primary, [data-variant="primary"]';

const snapshot = (page) => page.evaluate(async () => {
  const idb = typeof indexedDB.databases === "function" ? (await indexedDB.databases()).map((d) => d.name) : [];
  return {
    local: Object.keys(localStorage), session: Object.keys(sessionStorage), idb, caches: await caches.keys(),
    url: location.search, hist: JSON.stringify(history.state), len: history.length,
  };
});
const info = (page) => page.evaluate((sel) => {
  const pb = document.querySelector('[role="progressbar"]');
  const h = document.querySelector('[data-testid="plan-step-heading"]');
  const prim = Array.from(document.querySelectorAll(sel)).filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
  const bar = document.querySelector('[data-testid="plan-wizard-progress-band"]').getBoundingClientRect();
  const nb = document.querySelector('[data-testid="plan-wizard-next"], [data-testid="plan-submit"]')?.getBoundingClientRect();
  const nav = document.querySelector('[data-testid="ops-bottom-nav"]')?.getBoundingClientRect();
  const notes = Array.from(document.querySelectorAll("main [data-note], main .opx-note")).filter((e) => e.getBoundingClientRect().height > 0).map((e) => e.textContent.slice(0, 24));
  return {
    pb: pb && { now: pb.getAttribute("aria-valuenow"), text: pb.getAttribute("aria-valuetext"), min: pb.getAttribute("aria-valuemin"), max: pb.getAttribute("aria-valuemax"), h: pb.getBoundingClientRect().height },
    heading: h?.textContent, primaries: prim.map((e) => ({ id: e.getAttribute("data-testid"), t: e.textContent.trim(), h: Math.round(e.getBoundingClientRect().height), w: Math.round(e.getBoundingClientRect().width) })),
    bandTop: Math.round(bar.top), bandH: Math.round(bar.height), btnBottom: nb && Math.round(nb.bottom), navTop: nav && Math.round(nav.top),
    scrollW: document.documentElement.scrollWidth, innerW: innerWidth, visibleNotes: notes,
  };
}, PRIMARY);

for (const [w, h] of [[375, 812], [390, 844], [1280, 800]]) {
  const { context, page } = await newPage(browser, "a-manager", { width: w, height: h });
  const tag = `${w}`;
  const vals = { placeName: `評価地点${tag}${stamp}`, lat: "35.123456", lng: "133.654321", radius: "150", date: "2027-04-08", time: "14:30", duration: "55", title: `評価計画${tag}${stamp}`, purpose: "評価の目的", altitude: "70", notes: `評価メモ${tag}` };
  await page.goto(`${BASE}/ops/plans/new`);
  await T(page, "plan-form").waitFor();
  await page.waitForLoadState("networkidle").catch(() => {});
  await settle(page);
  // ① 空で次へ → エラー
  const before = await snapshot(page);
  log({ w, step: 1, phase: "initial", info: await info(page), snap: before });
  await shot(page, `${tag}-step1`);
  await T(page, "plan-wizard-next").click();
  await page.waitForTimeout(300);
  const e1 = await page.evaluate(() => {
    const a = document.activeElement; const errs = Array.from(document.querySelectorAll('[id^="plan-err"], [data-testid*="err"], [role="alert"], .opx-field-error')).map((e) => ({ id: e.id, t: e.textContent.trim().slice(0, 60), svg: !!e.querySelector("svg") || /[▲!×⚠]/.test(e.textContent), role: e.getAttribute("role") }));
    return { step: document.querySelector('[data-testid="plan-form"]').dataset.step, focus: a?.getAttribute("data-testid"), invalid: Array.from(document.querySelectorAll('[aria-invalid="true"]')).map((e) => e.getAttribute("data-testid")), errs };
  });
  log({ w, step: 1, phase: "empty-next", e1 });
  await shot(page, `${tag}-step1-error`);
  await T(page, "plan-place-name").fill(vals.placeName);
  await T(page, "plan-lat").fill(vals.lat);
  await T(page, "plan-lng").fill(vals.lng);
  await T(page, "plan-radius").fill(vals.radius);
  log({ w, step: 1, phase: "next", r: await tapNext(page), snap: await snapshot(page) });
  // ② 空
  await settle(page);
  log({ w, step: 2, info: await info(page), snap: await snapshot(page) });
  await shot(page, `${tag}-step2`);
  await T(page, "plan-wizard-next").click(); await page.waitForTimeout(300);
  log({ w, step: 2, phase: "empty-next", step_after: await stepOf(page), focus: await page.evaluate(() => document.activeElement?.getAttribute("data-testid")), invalid: await page.evaluate(() => Array.from(document.querySelectorAll('[aria-invalid="true"]')).map((e) => e.getAttribute("data-testid"))) });
  await shot(page, `${tag}-step2-error`);
  await T(page, "plan-start-date").fill(vals.date); await T(page, "plan-start-time").fill(vals.time); await T(page, "plan-duration").fill(vals.duration);
  await tapNext(page); await settle(page);
  // ③
  log({ w, step: 3, info: await info(page), snap: await snapshot(page) });
  await shot(page, `${tag}-step3`);
  await T(page, "plan-wizard-next").click(); await page.waitForTimeout(300);
  log({ w, step: 3, phase: "empty-next", step_after: await stepOf(page), focus: await page.evaluate(() => document.activeElement?.getAttribute("data-testid")) });
  await shot(page, `${tag}-step3-error`);
  await T(page, "plan-title").fill(vals.title); await T(page, "plan-purpose").fill(vals.purpose); await T(page, "plan-altitude").fill(vals.altitude);
  await T(page, "plan-flag-method_night").check();
  await tapNext(page); await settle(page);
  // ④
  log({ w, step: 4, info: await info(page), snap: await snapshot(page) });
  await shot(page, `${tag}-step4`);
  await T(page, "plan-wizard-next").click(); await page.waitForTimeout(300);
  log({ w, step: 4, phase: "empty-next", step_after: await stepOf(page), focus: await page.evaluate(() => document.activeElement?.getAttribute("data-testid")) });
  await shot(page, `${tag}-step4-error`);
  await T(page, "plan-aircraft").selectOption(ac.id); await T(page, "plan-pilot").selectOption(pid); await T(page, "plan-notes").fill(vals.notes);
  await tapNext(page); await settle(page);
  // ⑤
  log({ w, step: 5, info: await info(page), snap: await snapshot(page), cards: await page.evaluate(() => Array.from(document.querySelectorAll('[data-testid^="plan-review-"]')).map((e) => e.getAttribute("data-testid") + "=" + e.textContent.replace(/\s+/g, " ").slice(0, 90))) });
  await shot(page, `${tag}-step5`); await shot(page, `${tag}-step5-full`, true);
  // 修正 → ② に戻って直す → 確認に戻る
  await T(page, "plan-review-edit-2").click(); await page.waitForTimeout(300);
  log({ w, phase: "edit2", step: await stepOf(page), nextLabel: (await T(page, "plan-wizard-next").textContent()).trim(), btn: await T(page, "plan-review-edit-2").count() });
  await T(page, "plan-duration").fill("50"); vals.duration = "50";
  await T(page, "plan-wizard-next").click(); await page.waitForTimeout(400);
  log({ w, phase: "back-to-review", step: await stepOf(page), dur: await T(page, "plan-review-duration").textContent() });
  // 修正ボタン寸法
  log({ w, phase: "edit-btn", boxes: await page.evaluate(() => [1,2,3,4].map((n) => { const r = document.querySelector(`[data-testid="plan-review-edit-${n}"]`).getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; })) });
  // 保存
  await T(page, "plan-submit").click();
  await page.waitForURL(/\/ops\/plans\/[0-9a-f-]{36}$/, { timeout: 30000 });
  const id = page.url().split("/").pop();
  const rec = await (await mgr.get(`/api/ops/plans/${id}`)).json();
  log({ w, phase: "saved", id, saved: { title: rec.title, place: rec.placeName, lat: rec.latitude, lng: rec.longitude, start: rec.plannedStartAt, dur: rec.durationMinutes, purpose: rec.purpose, status: rec.status, aircraftId: rec.aircraftId === ac.id, pilotId: rec.pilotId === pid, notes: rec.notes, flags: rec.flags, alt: rec.maxAltitudeM, radius: rec.radiusM, areas: JSON.stringify(rec.areas)?.slice(0, 80) }, expected: vals });
  await shot(page, `${tag}-saved`);
  await context.close();
}
import fs from "node:fs";
fs.writeFileSync("/home/user/soraban/docs/evaluations/logs/sprint-16H1-eval-manual.json", JSON.stringify(out, null, 1));
await browser.close(); await mgr.dispose();
