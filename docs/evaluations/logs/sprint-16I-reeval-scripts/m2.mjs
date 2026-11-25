// 通常の入口（日誌を経由しない）の構造と見た目を、ビルドごとに記録する。引数: タグ（new / old）
import { launch, signedCtx } from "./lib.mjs";
import fs from "node:fs";
const tag = process.argv[2];
const OUT = `/tmp/claude-0/-home-user/3a0be5e9-1995-5895-af4d-44ce47f73d07/scratchpad/m2-${tag}`;
fs.mkdirSync(OUT, { recursive: true });
const AC = "9c29615d-b3d2-415c-8d29-2e990530bc19";
const b = await launch();
const res = {};
for (const [name, vp] of [["375x812", { width: 375, height: 812 }], ["1280x800", { width: 1280, height: 800 }]]) {
  for (const [kind, q] of [["normal", `aircraftId=${AC}`], ["normal-noac", ``]]) {
    const ctx = await signedCtx(b, "a-pilot", { viewport: vp, hasTouch: vp.width < 500 });
    const page = await ctx.newPage();
    await page.clock.setFixedTime(new Date("2027-01-05T11:30:00+09:00"));
    await page.goto(`/ops/inspections/new${q ? "?" + q : ""}`);
    await page.getByRole("form", { name: "日常点検の入力" }).waitFor();
    await page.waitForTimeout(1000);
    const m = await page.evaluate(() => {
      const form = document.querySelector("form.opx-form");
      const timeEl = [...document.querySelectorAll("input")].find((i) => i.getAttribute("aria-label") === "実施時刻");
      const ids = (timeEl?.getAttribute("aria-describedby") || "").split(" ").filter(Boolean);
      const hint = ids.map((i) => document.getElementById(i)).filter(Boolean)[0];
      const fs = timeEl?.closest("fieldset");
      const seq = [...form.querySelectorAll("fieldset, label, summary, button, span, p, h2, h3")].slice(0, 40).map((e) => e.tagName + ":" + (e.innerText || "").slice(0, 20).replace(/\n/g, "|"));
      return { dateFirst: form.hasAttribute("data-date-first"), hintInFieldset: !!(hint && fs && fs.contains(hint)), hintText: hint?.innerText.slice(0, 30), hintTop: hint && Math.round(hint.getBoundingClientRect().top), fsTop: fs && Math.round(fs.getBoundingClientRect().top), fsBottom: fs && Math.round(fs.getBoundingClientRect().bottom), seq, h: document.documentElement.scrollHeight };
    });
    res[`${name}-${kind}`] = m;
    await page.screenshot({ path: `${OUT}/${name}-${kind}.png`, fullPage: true });
    await ctx.close();
  }
}
fs.writeFileSync(`${OUT}/m2.json`, JSON.stringify(res, null, 1));
console.log(tag, JSON.stringify(Object.fromEntries(Object.entries(res).map(([k, v]) => [k, { dateFirst: v.dateFirst, hintInFieldset: v.hintInFieldset, hintTop: v.hintTop, fsBottom: v.fsBottom, h: v.h }]))));
await b.close();
