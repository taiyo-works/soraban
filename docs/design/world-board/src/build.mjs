// 実行: node docs/design/world-board/src/build.mjs  → ../index.html を作る
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { svgContours } from "./contours.mjs";
const here = path.dirname(fileURLToPath(import.meta.url));
let html = fs.readFileSync(path.join(here, "template.html"), "utf8");

const route = (pts, dot) => `<path d="M${pts.map((p) => p.join(" ")).join("L")}" fill="none" stroke="#A8501F" stroke-width="2" stroke-dasharray="2 6" stroke-linecap="round"/>` +
  pts.slice(1, -1).map((p) => `<rect x="${p[0] - 4}" y="${p[1] - 4}" width="8" height="8" fill="#A8501F"/>`).join("") +
  `<circle cx="${dot[0]}" cy="${dot[1]}" r="11" fill="none" stroke="#A8501F" stroke-width="1.5"/><circle cx="${dot[0]}" cy="${dot[1]}" r="5" fill="#A8501F"/>`;

const hero = svgContours({ w: 820, h: 500, seed: 11, levels: 24, hills: [[0.62, 0.5, 0.2, 0.2, 0.4, 1], [0.2, 0.3, 0.16, 0.25, -0.3, 0.55], [0.88, 0.88, 0.2, 0.12, 0, 0.5]] },
  { extra: route([[330, 360], [470, 300], [560, 250], [650, 215], [720, 120]], [330, 360]) });
const art = svgContours({ w: 940, h: 480, seed: 4, levels: 25, hills: [[0.3, 0.55, 0.25, 0.18, 0.5, 1], [0.72, 0.35, 0.2, 0.3, -0.4, 0.8], [0.55, 0.8, 0.3, 0.1, 0.1, 0.5]] },
  { extra: route([[120, 400], [250, 330], [400, 280], [560, 300], [700, 200], [820, 130]], [120, 400]) });
const artn = svgContours({ w: 520, h: 230, seed: 9, levels: 20, hills: [[0.45, 0.5, 0.3, 0.22, 0.2, 1], [0.85, 0.2, 0.15, 0.2, 0, 0.5]] });
const sp = { w: 340, h: 460, seed: 6, levels: 22, hills: [[0.5, 0.5, 0.3, 0.2, 0.3, 1], [0.12, 0.85, 0.2, 0.2, 0, 0.5]] };
const s2 = svgContours(sp, { only: (p) => p.L <= 9 });
const s3 = svgContours(sp).replace("<svg class=\"contour\"", "<svg class=\"contour\" style=\"opacity:.5\"");
const homebg = svgContours({ w: 340, h: 150, seed: 21, levels: 12, hills: [[0.8, 0.5, 0.25, 0.4, 0.3, 1]] });
const menubg = svgContours({ w: 340, h: 340, seed: 15, levels: 16, hills: [[0.3, 0.7, 0.3, 0.25, 0.4, 1], [0.9, 0.2, 0.2, 0.3, 0, 0.5]] });

const rep = { HERO: hero, ART: art, ARTN: artn, S2: s2, S3: s3, HOMEBG: homebg, MENUBG: menubg };
for (const [k, v] of Object.entries(rep)) html = html.replace(`{{${k}}}`, () => v);
fs.writeFileSync(path.join(here, "..", "index.html"), html);
console.log("ok", (html.length / 1024).toFixed(0) + "KB");
