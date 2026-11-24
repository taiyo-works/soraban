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
  // 対象外（100g 未満）：API では最小 0.1kg=100g のため作れない。評価用 DB の判定の記録の重さを 50g に書き換えて再現する
  let id = await mkPlan(bm, { title: `模型 ${stamp}`, aircraftId: await mkAircraft(bm, "x", 0.9), pilotId: pid, place: `地点模型${stamp}` });
  await confirmPlan(bm, id).catch(() => undefined);
  sql(`update judgement_snapshots set input = jsonb_set(input, '{droneWeightG}', '50'), result = jsonb_set(result, '{droneWeightG}', '50') where plan_id = '${id}'`);
  await snap("model-50g");
  await voidAll(bm);

  // 判定の件数の組み合わせ（判定の記録の項目を書き換える）
  id = await mkPlan(bm, { title: `判定 ${stamp}`, aircraftId: await mkAircraft(bm, "j", 0.9), pilotId: pid, place: `地点判定${stamp}`, flags: ["method_night"] });
  await confirmPlan(bm, id);
  await record(bm, id, { dipsNumber: "FP-EVAL-0009" });
  const V = (a) => `jsonb_build_array(${a.map((v) => `jsonb_build_object('verdict','${v}')`).join(",")})`;
  const variants = {
    "j-unk-none": V(["unknown", "no_procedure"]),
    "j-unk-done": V(["unknown", "procedure_done"]),
    "j-done-none": V(["procedure_done", "no_procedure"]),
    "j-none-only": V(["no_procedure", "no_procedure"]),
    "j-empty": "'[]'::jsonb",
    "j-weird": `jsonb_build_array(jsonb_build_object('verdict','weird'), jsonb_build_object('verdict','no_procedure'))`,
    "j-needs-unk": V(["needs_procedure", "unknown"]),
  };
  for (const [k, expr] of Object.entries(variants)) {
    sql(`update judgement_snapshots set result = jsonb_set(result, '{verdict,items}', ${expr}) where plan_id = '${id}'`);
    await snap(k);
  }
  await voidAll(bm);
} finally {
  await voidAll(bm).catch(() => undefined);
  await browser.close();
  await bm.dispose();
}
console.log(JSON.stringify(out, null, 1));
