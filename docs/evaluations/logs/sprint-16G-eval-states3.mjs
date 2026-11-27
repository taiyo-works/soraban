// 準備カードの通報の行の 4 通り＋基本・空・viewer を実データで確かめる（375×812 と 1280×800、通常と色なし）。
import { execSync } from "node:child_process";
import { apiAs, launch, newPage, mkAircraft, pilotId, mkPlan, confirmPlan, record, voidAll, shot, waitStyles, stamp } from "./sprint-16G-eval-lib.mjs";

const out = [];
const sql = (q) => execSync(`psql postgresql://postgres:postgres@localhost:5432/ev16g_man -v ON_ERROR_STOP=1 -tAc "SET session_replication_role = replica; ${q.replace(/"/g, "\\\"")}"`).toString();
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
  const ALL = Object.fromEntries(["general","propeller","frame","communication","propulsion","power","autopilot","controller","battery"].map((k) => [k, { result: "normal" }]));
  for (const variant of ["num", "nonum"]) {
    const ac = await mkAircraft(bm, variant === "num" ? "p" : "q", 0.9);
    const id = await mkPlan(bm, { title: `帯 ${variant} ${stamp}`, aircraftId: ac, pilotId: pid, place: `地点帯${variant}${stamp}`, flags: ["method_night"] });
    await confirmPlan(bm, id);
    await record(bm, id, variant === "num" ? { dipsNumber: "FP-EVAL-0010" } : { numberUnavailable: true, memo: "番号が出なかった" });
    const ir = await bm.post("/api/ops/inspections", { data: { aircraftId: ac, pilotId: pid, planId: id, timing: "pre_flight", inspectedAt: "2027-01-05T11:00", placeName: "駐車場", items: ALL } });
    out.push({ label: `insp-${variant}`, status: ir.status(), body: (await ir.text()).slice(0, 200) });
    sql(`update judgement_snapshots set result = jsonb_set(result, '{verdict,items}', jsonb_build_array(jsonb_build_object('verdict','no_procedure'))) where plan_id = '${id}'`);
    await snap(`band-${variant}`);
    await voidAll(bm);
  }
} finally {
  await voidAll(bm).catch(() => undefined);
  await browser.close();
  await bm.dispose();
}
console.log(JSON.stringify(out, null, 1));
