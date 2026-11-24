// 準備カードの通報の行の 4 通り＋基本・空・viewer を実データで確かめる（375×812 と 1280×800、通常と色なし）。
import { apiAs, launch, newPage, mkAircraft, pilotId, mkPlan, confirmPlan, record, voidAll, shot, waitStyles, stamp } from "./sprint-16G-eval-lib.mjs";

const out = [];
const bm = await apiAs("b-manager");
const pid = await pilotId();
const browser = await launch();

const snap = async (label, who = "b-manager") => {
  for (const [w, h] of [[375, 812], [1280, 800]]) {
    const { context, page } = await newPage(browser, who, { width: w, height: h });
    await page.goto(`${process.env.EVAL_BASE ?? "http://127.0.0.1:3400"}/ops`);
    await page.waitForSelector('[data-testid="ops-today"]');
    await waitStyles(page);
    const info = await page.evaluate(() => {
      const q = (id) => document.querySelector(`[data-testid="${id}"]`);
      const t = (id) => q(id)?.innerText?.replace(/\s+/g, " ").trim() ?? null;
      const nav = q("ops-bottom-nav");
      const quick = q("home-quick");
      const prep = q("home-prep");
      return {
        order: Array.from(document.querySelectorAll("[data-testid]")).map((e) => e.getAttribute("data-testid")).filter((x) => /^(today-heading|home-prep|home-next|home-primary|home-deadlines|home-quick|home-all|today-empty)$/.test(x)),
        prepTone: prep?.getAttribute("data-tone") ?? null,
        prepState: prep?.getAttribute("data-state") ?? null,
        aria: prep?.getAttribute("aria-label") ?? null,
        report: t("home-prep-report"),
        reportTone: q("home-prep-report")?.getAttribute("data-tone") ?? null,
        reportNote: t("home-prep-report-note"),
        insp: t("home-prep-inspection"),
        judge: t("home-prep-judgement"),
        judgeTone: q("home-prep-judgement")?.getAttribute("data-tone") ?? null,
        primary: t("home-primary"),
        primaryCount: Array.from(document.querySelectorAll('.opx-btn-primary, .sb-pill-primary, [data-variant="primary"]')).filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }).length,
        quickBottom: quick ? Math.round(quick.getBoundingClientRect().bottom) : null,
        navTop: nav ? Math.round(nav.getBoundingClientRect().top) : null,
        scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth,
      };
    });
    out.push({ label, who, w, h, ...info });
    await shot(page, `${label}-${w}x${h}`);
    if (w === 375) {
      const cdp = await context.newCDPSession(page);
      await cdp.send("Emulation.setEmulatedVisionDeficiency", { type: "achromatopsia" });
      await shot(page, `${label}-${w}x${h}-gray`);
    }
    await context.close();
  }
};

try {
  await voidAll(bm);
  await snap("empty");
  await snap("empty-viewer", "a-viewer");

  const ac = await mkAircraft(bm, "n");
  // 基本：通報なし
  let id = await mkPlan(bm, { title: `基本 ${stamp}`, aircraftId: ac, pilotId: pid, place: `地点基本${stamp}`, flags: ["method_night"] });
  await confirmPlan(bm, id);
  await snap("base-noreport");
  // 受付番号あり
  await record(bm, id, { dipsNumber: "FP-EVAL-0001" });
  await snap("report-num");
  await voidAll(bm);

  // 番号なし
  id = await mkPlan(bm, { title: `番号なし ${stamp}`, aircraftId: await mkAircraft(bm, "m"), pilotId: pid, place: `地点番号なし${stamp}`, flags: ["method_night"] });
  await confirmPlan(bm, id);
  await record(bm, id, { numberUnavailable: true, memo: "完了画面に番号が出なかった" });
  await snap("report-nonum");
  await voidAll(bm);

  // 取り消し（計画を中止 → 取消の記録）
  id = await mkPlan(bm, { title: `取消 ${stamp}`, aircraftId: await mkAircraft(bm, "c"), pilotId: pid, place: `地点取消${stamp}`, flags: ["method_night"] });
  await confirmPlan(bm, id);
  await record(bm, id, { dipsNumber: "FP-EVAL-0003" });
  const p = await (await bm.get(`/api/ops/plans/${id}`)).json();
  await bm.post(`/api/ops/plans/${id}/void`, { data: { expectedVersion: p.version, reason: "評価：中止" } });
  try { await record(bm, id, { dipsNumber: "CANCEL-0003" }, "cancel"); } catch (e) { out.push({ label: "cancel-record-error", err: String(e).slice(0, 300) }); }
  await snap("report-cancelled");
  await voidAll(bm);

  // 対象外（100g 未満）
  id = await mkPlan(bm, { title: `模型 ${stamp}`, aircraftId: await mkAircraft(bm, "x", 0.9), pilotId: pid, place: `地点模型${stamp}` });
  await confirmPlan(bm, id).catch(() => undefined);
  await snap("report-model");
  await voidAll(bm);
} finally {
  await voidAll(bm).catch(() => undefined);
  await browser.close();
  await bm.dispose();
}
console.log(JSON.stringify(out, null, 1));
