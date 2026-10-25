// Contour lines for the style trial's art: a small, deterministic generator (no images, no outside material).
// A terrain height field is built from a few elongated hills plus a hand tremor, then traced with marching squares at
// regular heights. Every fifth line is an "index" line, drawn a little heavier and carrying an elevation figure, as on a
// printed survey map. The same seed always gives the same drawing.

export type Hill = { readonly x: number; readonly y: number; readonly rx: number; readonly ry: number; readonly turn: number; readonly h: number };

export type ContourSpec = {
  readonly seed: number;
  readonly width: number;
  readonly height: number;
  /** grid cell size in drawing units (smaller is smoother and heavier) */
  readonly cell?: number;
  readonly hills: readonly Hill[];
  /** height between two lines (the field runs roughly 0..1) */
  readonly step: number;
  /** first line height */
  readonly base?: number;
  /** a figure shown on index lines: elevation = floor + level index * rise */
  readonly floor?: number;
  readonly rise?: number;
  /** drawn only above this height (so a sea or lake can be left empty) */
  readonly minHeight?: number;
  /** hand tremor, 0..1 (0.5 is a steady hand) */
  readonly tremor?: number;
};

export type ContourLine = { readonly d: string; readonly index: boolean; readonly w: number };
export type ContourLabel = { readonly x: number; readonly y: number; readonly angle: number; readonly text: string };
export type Contours = { readonly lines: readonly ContourLine[]; readonly labels: readonly ContourLabel[] };

// deterministic hash / noise
const hash = (a: number, b: number, seed: number): number => {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(seed | 0, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
};
const smooth = (t: number): number => t * t * (3 - 2 * t);
function valueNoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = smooth(x - xi);
  const fy = smooth(y - yi);
  const a = hash(xi, yi, seed);
  const b = hash(xi + 1, yi, seed);
  const c = hash(xi, yi + 1, seed);
  const d = hash(xi + 1, yi + 1, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

export function heightAt(spec: ContourSpec, px: number, py: number): number {
  let v = 0;
  for (const hill of spec.hills) {
    const dx = px - hill.x;
    const dy = py - hill.y;
    const c = Math.cos(hill.turn);
    const s = Math.sin(hill.turn);
    const u = (dx * c + dy * s) / hill.rx;
    const w = (-dx * s + dy * c) / hill.ry;
    v += hill.h * Math.exp(-(u * u + w * w) / 2);
  }
  const t = spec.tremor ?? 0.5;
  // slow undulation (the land is not a clean bump) and a fine shake (the hand)
  v += (valueNoise(px / 70, py / 70, spec.seed) - 0.5) * 0.16;
  v += (valueNoise(px / 11, py / 11, spec.seed + 7) - 0.5) * 0.02 * t * 2;
  return v;
}

const r1 = (n: number): string => (Math.round(n * 10) / 10).toString();

type Pt = readonly [number, number];

function smoothPath(pts: readonly Pt[], closed: boolean): string {
  if (pts.length < 3) return `M${r1(pts[0]![0])} ${r1(pts[0]![1])}L${r1(pts[pts.length - 1]![0])} ${r1(pts[pts.length - 1]![1])}`;
  const mid = (a: Pt, b: Pt): Pt => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  if (closed) {
    const m0 = mid(pts[pts.length - 1]!, pts[0]!);
    let d = `M${r1(m0[0])} ${r1(m0[1])}`;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i]!;
      const m = mid(p, pts[(i + 1) % pts.length]!);
      d += `Q${r1(p[0])} ${r1(p[1])} ${r1(m[0])} ${r1(m[1])}`;
    }
    return d + "Z";
  }
  let d = `M${r1(pts[0]![0])} ${r1(pts[0]![1])}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i]!;
    const m = mid(p, pts[i + 1]!);
    d += `Q${r1(p[0])} ${r1(p[1])} ${r1(m[0])} ${r1(m[1])}`;
  }
  const last = pts[pts.length - 1]!;
  return d + `L${r1(last[0])} ${r1(last[1])}`;
}

export function contours(spec: ContourSpec): Contours {
  const cell = spec.cell ?? 7;
  const cols = Math.ceil(spec.width / cell) + 1;
  const rows = Math.ceil(spec.height / cell) + 1;
  const grid: number[] = new Array(cols * rows);
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) grid[j * cols + i] = heightAt(spec, i * cell, j * cell);
  let hMin = Infinity;
  let hMax = -Infinity;
  for (const v of grid) {
    hMin = Math.min(hMin, v);
    hMax = Math.max(hMax, v);
  }
  const base = spec.base ?? Math.ceil(hMin / spec.step) * spec.step;
  const lines: ContourLine[] = [];
  const labels: ContourLabel[] = [];
  const hCount = cols * rows;
  const at = (i: number, j: number): number => grid[j * cols + i]!;

  let levelIndex = 0;
  for (let level = base; level < hMax; level += spec.step, levelIndex++) {
    if (spec.minHeight !== undefined && level < spec.minHeight) continue;
    const index = levelIndex % 5 === 0;
    // segments as pairs of edge ids; the edge id fixes where the crossing is
    const pos = new Map<number, Pt>();
    const segs: [number, number][] = [];
    const crossing = (id: number, i0: number, j0: number, i1: number, j1: number): number => {
      if (!pos.has(id)) {
        const a = at(i0, j0);
        const b = at(i1, j1);
        const t = (level - a) / (b - a);
        // the hand is never exact: a crossing slips a little along its own edge
        const slip = (hash(id, levelIndex, spec.seed) - 0.5) * 0.06 * (spec.tremor ?? 0.5) * 2;
        const tt = Math.min(0.97, Math.max(0.03, t + slip));
        pos.set(id, [(i0 + (i1 - i0) * tt) * cell, (j0 + (j1 - j0) * tt) * cell]);
      }
      return id;
    };
    for (let j = 0; j < rows - 1; j++) {
      for (let i = 0; i < cols - 1; i++) {
        const a = at(i, j) > level;
        const b = at(i + 1, j) > level;
        const c = at(i + 1, j + 1) > level;
        const d = at(i, j + 1) > level;
        const code = (a ? 8 : 0) | (b ? 4 : 0) | (c ? 2 : 0) | (d ? 1 : 0);
        if (code === 0 || code === 15) continue;
        const top = (): number => crossing(j * cols + i, i, j, i + 1, j);
        const bottom = (): number => crossing((j + 1) * cols + i, i, j + 1, i + 1, j + 1);
        const left = (): number => crossing(hCount + j * cols + i, i, j, i, j + 1);
        const right = (): number => crossing(hCount + j * cols + i + 1, i + 1, j, i + 1, j + 1);
        switch (code) {
          case 1:
          case 14:
            segs.push([left(), bottom()]);
            break;
          case 2:
          case 13:
            segs.push([bottom(), right()]);
            break;
          case 3:
          case 12:
            segs.push([left(), right()]);
            break;
          case 4:
          case 11:
            segs.push([top(), right()]);
            break;
          case 5:
            segs.push([top(), right()], [left(), bottom()]);
            break;
          case 6:
          case 9:
            segs.push([top(), bottom()]);
            break;
          case 7:
          case 8:
            segs.push([top(), left()]);
            break;
          case 10:
            segs.push([top(), left()], [bottom(), right()]);
            break;
        }
      }
    }
    // chain the segments
    const byEdge = new Map<number, number[]>();
    segs.forEach(([p, q], k) => {
      for (const e of [p, q]) {
        const l = byEdge.get(e);
        if (l) l.push(k);
        else byEdge.set(e, [k]);
      }
    });
    const used = new Array<boolean>(segs.length).fill(false);
    const walk = (start: number, from: number): number[] => {
      const out: number[] = [];
      let edge = from;
      for (;;) {
        const next = (byEdge.get(edge) ?? []).find((k) => !used[k]);
        if (next === undefined) break;
        used[next] = true;
        const [p, q] = segs[next]!;
        edge = p === edge ? q : p;
        out.push(edge);
        if (edge === start) break;
      }
      return out;
    };
    let longest: { pts: Pt[]; len: number; closed: boolean } | null = null;
    for (let k = 0; k < segs.length; k++) {
      if (used[k]) continue;
      used[k] = true;
      const [p, q] = segs[k]!;
      const forward = walk(p, q);
      const closed = forward.length > 0 && forward[forward.length - 1] === p;
      let ids: number[];
      if (closed) ids = [p, q, ...forward.slice(0, -1)];
      else ids = [...walk(q, p).reverse(), p, q, ...forward];
      if (ids.length < 7) continue; // specks are not drawn
      const pts = ids.map((e) => pos.get(e)!);
      const hw = 0.72 + hash(levelIndex, ids.length, spec.seed) * 0.2;
      lines.push({ d: smoothPath(pts, closed), index, w: index ? 1.15 : Math.round(hw * 100) / 100 });
      if (index && (!longest || ids.length > longest.len)) longest = { pts, len: ids.length, closed };
    }
    if (index && longest && longest.len >= 24) {
      const m = Math.floor(longest.len / 2);
      const a = longest.pts[m - 1]!;
      const b = longest.pts[Math.min(m + 1, longest.pts.length - 1)]!;
      let angle = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
      if (angle > 90) angle -= 180;
      if (angle < -90) angle += 180;
      const p = longest.pts[m]!;
      labels.push({ x: p[0], y: p[1], angle: Math.round(angle), text: String(Math.round((spec.floor ?? 0) + levelIndex * (spec.rise ?? 10))) });
    }
  }
  return { lines, labels };
}

/** One hand-drawn line across `width`, as a path (used under headings in place of a straight rule). */
export function wobbleLine(seed: number, width: number, amp: number, y = amp + 1): string {
  const pts: Pt[] = [];
  const n = Math.max(6, Math.round(width / 28));
  for (let i = 0; i <= n; i++) {
    const x = (width * i) / n;
    pts.push([x, y + (valueNoise(i * 0.9, seed, seed) - 0.5) * 2 * amp]);
  }
  return smoothPath(pts, false);
}

/** Water lining: short horizontal strokes of uneven length, as engraved on printed charts. */
export function waterLines(seed: number, x0: number, x1: number, y0: number, y1: number, gap: number): string {
  let d = "";
  let row = 0;
  for (let y = y0; y <= y1; y += gap, row++) {
    let x = x0 + hash(row, 1, seed) * 18;
    while (x < x1) {
      const len = 8 + hash(Math.round(x), row, seed) * 22;
      const yy = y + (hash(row, Math.round(x), seed + 3) - 0.5) * 1.2;
      d += `M${r1(x)} ${r1(yy)}h${r1(Math.min(len, x1 - x))}`;
      x += len + 7 + hash(Math.round(x), row + 40, seed) * 26;
    }
  }
  return d;
}

/** Scattered building marks inside a box (small squares at uneven spots). */
export function buildingMarks(seed: number, x0: number, y0: number, x1: number, y1: number, count: number): { x: number; y: number; s: number }[] {
  const out: { x: number; y: number; s: number }[] = [];
  for (let k = 0; k < count; k++) {
    out.push({ x: x0 + hash(k, 2, seed) * (x1 - x0), y: y0 + hash(k, 3, seed) * (y1 - y0), s: 2 + Math.round(hash(k, 4, seed) * 2) });
  }
  return out;
}
