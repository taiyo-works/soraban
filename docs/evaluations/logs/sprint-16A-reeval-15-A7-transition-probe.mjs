import { chromium } from "/home/user/soraban/node_modules/@playwright/test/index.mjs";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
const lum = (c) => { const [r,g,bl] = c.map(v => { v/=255; return v<=0.03928? v/12.92 : ((v+0.055)/1.055)**2.4 }); return 0.2126*r+0.7152*g+0.0722*bl };
const ratio = (a,c) => { const x=lum(a), y=lum(c); return (Math.max(x,y)+0.05)/(Math.min(x,y)+0.05) };
const parse = (s) => s.match(/[\d.]+/g).slice(0,3).map(Number);
let bad = 0, N = 12; const seen = new Map();
for (let i=0;i<N;i++) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto("http://127.0.0.1:3100/");
  await page.waitForSelector('[data-testid="hero-art"]');
  // sample the primary button 30 times over ~1.5s
  const samples = await page.evaluate(async () => {
    const out = [];
    const t0 = performance.now();
    while (performance.now() - t0 < 2500) {
      const btn = [...document.querySelectorAll('[data-testid="current-location"] button')].find(b => /判定/.test(b.textContent) && !/現在地/.test(b.textContent));
      if (btn) { const cs = getComputedStyle(btn); out.push({ t: Math.round(performance.now()-t0), text: btn.textContent, disabled: btn.disabled, bg: cs.backgroundColor, fg: cs.color, tr: cs.transitionProperty+" "+cs.transitionDuration, anim: btn.getAnimations().length }); }
      await new Promise(r => requestAnimationFrame(r));
    }
    return out;
  });
  const prev = []; 
  for (const s of samples) { const r = ratio(parse(s.fg), parse(s.bg)); const key = `${s.text}|dis=${s.disabled}|bg=${s.bg}|fg=${s.fg}|anim=${s.anim}`; if (!seen.has(key)) seen.set(key, {n:0, minT:s.t, r: r.toFixed(2), tr:s.tr}); seen.get(key).n++; }
  const last = samples.at(-1); console.log(i, "final:", last.text, "disabled", last.disabled, last.bg, last.fg, ratio(parse(last.fg), parse(last.bg)).toFixed(2));
  await ctx.close();
}
for (const [k,v] of seen) console.log(v.r, v.n, "firstSeenAt", v.minT, k, v.tr);
await b.close();
