import { launch, signedCtx, SHOT } from "./lib.mjs";
const AC = "9c29615d-b3d2-415c-8d29-2e990530bc19";
const b = await launch();
for (const [name, vp] of [["375x812", { width: 375, height: 812 }], ["360x740", {width:360,height:740}], ["390x844", {width:390,height:844}], ["1280x800", { width: 1280, height: 800 }]]) {
  const ctx = await signedCtx(b, "a-manager", { viewport: vp, hasTouch: vp.width < 500 });
  const page = await ctx.newPage();
  await page.clock.setFixedTime(new Date("2027-01-05T11:30:00+09:00"));
  await page.goto(`/ops/inspections/new?aircraftId=${AC}&takeoffAt=2027-01-05T11:00`);
  await page.getByRole("form", { name: "日常点検の入力" }).waitFor();
  await page.waitForTimeout(900);
  const m = await page.evaluate(() => {
    const note = document.querySelector('[data-testid="inspection-after-takeoff"]');
    const nav = document.querySelector('[data-testid="ops-bottom-nav"]');
    const dt = document.querySelector('[data-testid="inspected"]');
    const time = document.querySelector('[data-testid="inspected"] input[type=time], [data-testid="inspected"] input[inputmode]') ;
    const timeEl = [...document.querySelectorAll('input')].find(i=>i.getAttribute('aria-label')==='実施時刻') || document.getElementById(document.querySelector('label')?.htmlFor||'');
    const r = (e) => e ? (({height,bottom,top})=>({top:Math.round(top),bottom:Math.round(bottom),h:Math.round(height)}))(e.getBoundingClientRect()) : null;
    const navR = nav ? nav.getBoundingClientRect() : null;
    const ids = (timeEl?.getAttribute('aria-describedby')||'').split(' ').filter(Boolean);
    const hintEl = ids.map(i=>document.getElementById(i)).filter(Boolean);
    const form = document.querySelector('form.opx-form');
    return { vh: innerHeight, scrollY, note: r(note), dt: r(dt), navTop: navR && Math.round(navR.top), navDisplay: nav && getComputedStyle(nav).display,
      timeFound: !!timeEl, describedby: ids, hints: hintEl.map(h=>({id:h.id, text:h.innerText.slice(0,40), top:Math.round(h.getBoundingClientRect().top), fs:getComputedStyle(h).fontSize, display:getComputedStyle(h).display})),
      dataDateFirst: form?.hasAttribute('data-date-first'), docW: document.documentElement.scrollWidth, noteText: note?.innerText };
  });
  console.log(name, JSON.stringify(m));
  await page.screenshot({ path: `${SHOT}/i3-${name}.png` });
  await ctx.close();
}
await b.close();
