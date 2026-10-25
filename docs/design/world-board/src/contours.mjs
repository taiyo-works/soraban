// 等高線を自前で生成する（外部ライブラリなし）。
// 標高場 = 手置きの丘 + 低周波ノイズ。マーチングスクエアで線を拾い、
// 点を間引いて Catmull-Rom で曲線にし、わずかなゆらぎと、索引線の途切れ＋標高数字を加える。
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}
function makeNoise(seed, cells) {
  const r = rng(seed);
  const g = Array.from({ length: (cells + 3) * (cells + 3) }, () => r());
  const sm = (t) => t * t * (3 - 2 * t);
  return (u, v) => {
    const x = u * cells, y = v * cells;
    const i = Math.floor(x), j = Math.floor(y);
    const fx = sm(x - i), fy = sm(y - j);
    const at = (a, b) => g[(b + 1) * (cells + 3) + (a + 1)];
    const top = at(i, j) * (1 - fx) + at(i + 1, j) * fx;
    const bot = at(i, j + 1) * (1 - fx) + at(i + 1, j + 1) * fx;
    return top * (1 - fy) + bot * fy;
  };
}

export function contours({ w, h, seed = 1, hills, step = 7, levels = 26, majorEvery = 5, labelBase = 20, labelStep = 10, wobble = 0.7 }) {
  const nx = Math.ceil(w / step), ny = Math.ceil(h / step);
  const n1 = makeNoise(seed, 5), n2 = makeNoise(seed + 7, 11);
  const F = [];
  let lo = 1e9, hi = -1e9;
  for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
    const x = (i * step) / w, y = (j * step) / h;
    let z = 0;
    for (const [cx, cy, sx, sy, rot, amp] of hills) {
      const dx = (x - cx) * (w / h), dy = y - cy;
      const c = Math.cos(rot), s = Math.sin(rot);
      const u = (dx * c + dy * s) / sx, v = (-dx * s + dy * c) / sy;
      z += amp * Math.exp(-(u * u + v * v));
    }
    z += 0.22 * n1(x, y) + 0.07 * n2(x, y);
    F.push(z); lo = Math.min(lo, z); hi = Math.max(hi, z);
  }
  const f = (i, j) => F[j * (nx + 1) + i];
  const out = { minor: [], major: [], labels: [], levelsPaths: [] };
  const r = rng(seed * 31 + 5);
  for (let L = 1; L <= levels; L++) {
    const t = lo + ((hi - lo) * L) / (levels + 1);
    const nodes = new Map();
    const node = (k, x, y) => { if (!nodes.has(k)) nodes.set(k, { x, y, nb: [] }); return nodes.get(k); };
    const edgeNode = (e, i, j) => {
      const lerp = (a, b) => (t - a) / (b - a);
      if (e === "T") { const a = f(i, j), b = f(i + 1, j); return node(`h${i},${j}`, (i + lerp(a, b)) * step, j * step); }
      if (e === "B") { const a = f(i, j + 1), b = f(i + 1, j + 1); return node(`h${i},${j + 1}`, (i + lerp(a, b)) * step, (j + 1) * step); }
      if (e === "L") { const a = f(i, j), b = f(i, j + 1); return node(`v${i},${j}`, i * step, (j + lerp(a, b)) * step); }
      const a = f(i + 1, j), b = f(i + 1, j + 1); return node(`v${i + 1},${j}`, (i + 1) * step, (j + lerp(a, b)) * step);
    };
    const link = (e1, e2, i, j) => { const a = edgeNode(e1, i, j), b = edgeNode(e2, i, j); a.nb.push(b); b.nb.push(a); };
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const tl = f(i, j) > t ? 1 : 0, tr = f(i + 1, j) > t ? 1 : 0, br = f(i + 1, j + 1) > t ? 1 : 0, bl = f(i, j + 1) > t ? 1 : 0;
      const c = tl * 8 + tr * 4 + br * 2 + bl;
      const hiC = (f(i, j) + f(i + 1, j) + f(i + 1, j + 1) + f(i, j + 1)) / 4 > t;
      const P = {
        1: [["L", "B"]], 2: [["B", "R"]], 3: [["L", "R"]], 4: [["T", "R"]], 6: [["T", "B"]], 7: [["L", "T"]],
        8: [["L", "T"]], 9: [["T", "B"]], 11: [["T", "R"]], 12: [["L", "R"]], 13: [["B", "R"]], 14: [["L", "B"]],
        5: hiC ? [["L", "T"], ["B", "R"]] : [["T", "R"], ["L", "B"]],
        10: hiC ? [["T", "R"], ["L", "B"]] : [["L", "T"], ["B", "R"]],
      }[c];
      if (P) for (const [a, b] of P) link(a, b, i, j);
    }
    const seen = new Set();
    const chains = [];
    const walk = (start) => {
      const pts = [start]; seen.add(start);
      let cur = start, prev = null;
      for (;;) {
        const nx_ = cur.nb.find((q) => q !== prev && !seen.has(q));
        if (!nx_) break;
        pts.push(nx_); seen.add(nx_); prev = cur; cur = nx_;
      }
      return pts;
    };
    for (const nd of nodes.values()) if (!seen.has(nd) && nd.nb.length === 1) chains.push(walk(nd));
    for (const nd of nodes.values()) if (!seen.has(nd)) { const p = walk(nd); p.push(p[0]); chains.push(p); }
    const isMajor = L % majorEvery === 0;
    const elev = labelBase + (L - 1) * (labelStep / majorEvery) * 1;
    for (const ch of chains) {
      if (ch.length < 8) continue;
      let pts = ch.filter((_, k) => k % 2 === 0 || k === ch.length - 1).map((p, k) => ({
        x: p.x + wobble * Math.sin(k * 0.9 + L), y: p.y + wobble * Math.cos(k * 0.7 + L * 1.3),
      }));
      let parts = [pts];
      if (isMajor && pts.length > 26) {
        const k = Math.floor(pts.length * (0.3 + r() * 0.4));
        const a = pts[k], b = pts[Math.min(k + 1, pts.length - 1)];
        const ang = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
        const rot = ang > 90 ? ang - 180 : ang < -90 ? ang + 180 : ang;
        const win = 7;
        const lab = { x: a.x, y: a.y, rot, text: String(Math.round(labelBase + L * 8)) };
        if (a.x > 24 && a.x < w - 24 && a.y > 14 && a.y < h - 14) {
          parts = [pts.slice(0, Math.max(2, k - win)), pts.slice(Math.min(pts.length - 2, k + win))];
          out.labels.push(lab);
        }
      }
      for (const part of parts) {
        if (part.length < 3) continue;
        let d = `M${part[0].x.toFixed(1)} ${part[0].y.toFixed(1)}`;
        for (let k = 0; k < part.length - 1; k++) {
          const p0 = part[Math.max(0, k - 1)], p1 = part[k], p2 = part[k + 1], p3 = part[Math.min(part.length - 1, k + 2)];
          const c1 = [p1.x + (p2.x - p0.x) / 6, p1.y + (p2.y - p0.y) / 6];
          const c2 = [p2.x - (p3.x - p1.x) / 6, p2.y - (p3.y - p1.y) / 6];
          d += `C${c1[0].toFixed(1)} ${c1[1].toFixed(1)} ${c2[0].toFixed(1)} ${c2[1].toFixed(1)} ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
        }
        (isMajor ? out.major : out.minor).push(d);
        out.levelsPaths.push({ L, major: isMajor, d });
      }
    }
  }
  return out;
}

// SVG の部品を返す。色は CSS 側（.cl-minor / .cl-major / .cl-label）で決める。
export function svgContours(opts, { only = null, extra = "" } = {}) {
  const c = contours(opts);
  const sel = (p) => (only ? only(p) : true);
  const minor = c.levelsPaths.filter((p) => !p.major && sel(p)).map((p) => p.d).join("");
  const major = c.levelsPaths.filter((p) => p.major && sel(p)).map((p) => p.d).join("");
  const labels = only ? "" : c.labels
    .map((l) => `<text class="cl-label" transform="translate(${l.x.toFixed(1)} ${l.y.toFixed(1)}) rotate(${l.rot.toFixed(1)})" text-anchor="middle" dy="3">${l.text}</text>`).join("");
  return `<svg class="contour" viewBox="0 0 ${opts.w} ${opts.h}" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><path class="cl-minor" d="${minor}"/><path class="cl-major" d="${major}"/>${labels}${extra}</svg>`;
}
