import { launch, signedCtx, SHOT } from "./lib.mjs";
const AC = "9c29615d-b3d2-415c-8d29-2e990530bc19";
const b = await launch();
const ctx = await signedCtx(b, "a-manager", { viewport: { width: 375, height: 812 }, hasTouch: true });
const page = await ctx.newPage();
await page.clock.setFixedTime(new Date("2027-01-05T11:30:00+09:00"));
await page.goto(`/ops/inspections/new?aircraftId=${AC}&takeoffAt=2027-01-05T11:00`);
await page.getByRole("form", { name: "日常点検の入力" }).waitFor();
await page.waitForTimeout(900);
const t = page.getByLabel("実施時刻", { exact: true });
const cdp = await ctx.newCDPSession(page);
async function ax(label) {
  const h = await t.elementHandle();
  const { nodes } = await cdp.send("Accessibility.getPartialAXTree", { objectId: (await cdp.send("DOM.resolveNode", { backendNodeId: (await cdp.send("DOM.describeNode", { objectId: undefined }).catch(()=>({node:{}}))).node?.backendNodeId }).catch(()=>({}))).object?.objectId, fetchRelatives: false }).catch(() => ({ nodes: [] }));
  return nodes;
}
// アクセシブルな説明を、DOM から aria-describedby を辿って組み立てて確かめる（CDP の木は環境で不安定なため）
const desc = async () => page.evaluate(() => {
  const el = [...document.querySelectorAll("input")].find((i) => i.getAttribute("aria-label") === "実施時刻");
  const ids = (el.getAttribute("aria-describedby") || "").split(" ").filter(Boolean);
  return ids.map((i) => { const e = document.getElementById(i); return { id: i, exists: !!e, text: e?.innerText.slice(0, 30), hidden: e ? (getComputedStyle(e).display === "none" || e.closest("[aria-hidden=true]") !== null) : null }; });
});
console.log("describedby(note shown)", JSON.stringify(await desc()));
// 離陸より前に直す → 注記が消え、補足はそのまま
await t.fill("10:50");
await page.waitForTimeout(400);
console.log("noteCount", await page.getByTestId("inspection-after-takeoff").count());
console.log("describedby(note gone)", JSON.stringify(await desc()));
const g = await page.evaluate(() => { const f = document.querySelector('[data-testid="inspected"]').getBoundingClientRect(); const h = document.querySelector(".sb-insp-dt-hint").getBoundingClientRect(); return { fieldBottom: Math.round(f.bottom), hintTop: Math.round(h.top), gap: Math.round(h.top - f.bottom) }; });
console.log("gap hint-below-field (no note)", JSON.stringify(g));
await page.screenshot({ path: `${SHOT}/i3-375x812-note-gone.png` });
// 空にして誤りを出す
await t.fill("");
await page.getByLabel("実施時刻", { exact: true }).blur();
await page.getByRole("button", { name: "保存", exact: true }).click();
await page.waitForTimeout(600);
console.log("describedby(error?)", JSON.stringify(await desc()));
// 訂正（isEdit）は dateFirst でない
await ctx.close(); await b.close();
