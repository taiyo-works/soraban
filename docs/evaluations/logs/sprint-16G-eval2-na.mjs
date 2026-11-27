// 再評価：対象外（模型航空機）の行。評価用 DB の判定の記録の重さを 50g に書き換えて再現（API の最小は 100g のため）。補足なし・未確認（点線の四角）・禁止語 0。
import { execSync } from "node:child_process";
import { apiAs, launch, newPage, mkAircraft, pilotId, mkPlan, confirmPlan, voidAll, shot, waitStyles, stamp } from "./sprint-16G-eval2-lib.mjs";
const sql = (q) => execSync(`psql postgresql://postgres:postgres@localhost:5432/ev16g2_man2 -v ON_ERROR_STOP=1 -tAc "SET session_replication_role = replica; ${q.replace(/"/g, "\\\"")}"`).toString();
const BAD = ["完璧", "保証", "必ず", "代行", "代理", "申請", "通報不要", "問題なし", "必須としません", "免除"];
const bm = await apiAs("b-manager"); const pid = await pilotId(); const browser = await launch(); const out = [];
try {
  await voidAll(bm);
  const id = await mkPlan(bm, { title: `模型 ${stamp}`, aircraftId: await mkAircraft(bm, "x" + Math.random().toString(36).slice(2, 4), 0.9), pilotId: pid, place: `地点模型${stamp}` });
  await confirmPlan(bm, id).catch(() => undefined);
  sql(`update judgement_snapshots set input = jsonb_set(input, '{droneWeightG}', '50'), result = jsonb_set(result, '{droneWeightG}', '50') where plan_id = '${id}'`);
  for (const [w, h] of [[375, 812], [1280, 800]]) {
    const { context, page } = await newPage(browser, "b-manager", { width: w, height: h });
    await page.goto(`http://127.0.0.1:3400/ops`); await page.waitForSelector('[data-testid="home-prep"]'); await waitStyles(page);
    const m = await page.evaluate(() => {
      const q = (id) => document.querySelector(`[data-testid="${id}"]`);
      const row = q("home-prep-report");
      const cs = row?.querySelector("svg"); 
      return { reportText: q("home-prep-report-text")?.innerText, note: q("home-prep-report-note") ? q("home-prep-report-note").innerText : null, noteCount: document.querySelectorAll('[data-testid="home-prep-report-note"]').length,
        rowHtml: row?.outerHTML.slice(0, 1500), rowTone: row?.getAttribute("data-tone") ?? row?.closest("[data-tone]")?.getAttribute("data-tone"), svgDash: cs ? [...cs.querySelectorAll("*")].map((e) => e.getAttribute("stroke-dasharray")).filter(Boolean) : null,
        prepAria: q("home-prep")?.getAttribute("aria-label"), whole: document.body.innerText };
    });
    m.bad = BAD.filter((b) => m.whole.includes(b)); delete m.whole;
    out.push({ w, h, ...m }); await shot(page, `na-${w}x${h}`); await context.close();
  }
} finally { await voidAll(bm).catch(() => undefined); await browser.close(); await bm.dispose(); }
console.log(JSON.stringify(out, null, 1));
