#!/usr/bin/env node
// 同梱の DID（data/did/r2/pref-XX.json）と工業専用地域（data/industrial-exclusive/by-muni/*.json）の
// 重なりを計算し、収録範囲台帳（coverage.json）の didOverlap と、台帳（sources.json）の記述を更新する。
//
//   node packages/regulations/scripts/compute-did-overlap.mjs [--date YYYY-MM-DD] [--check]
//
// - 重なりの判定：工専のポリゴンと DID のポリゴン（どの市町村の DID でもよい）が、辺の交差または
//   一方が他方を含む関係にあれば overlap。外周リングで判定する（穴は考慮しない＝重なりを見落とさない側）。
// - 収録済み（recorded）の市町村：overlap / no_overlap を確定し、重なった DID の市町村名を note に書く。
// - 未収録で industrialZoneInSource === false（入手元のデータに工専がない）の市町村：no_overlap。
// - --check：台帳を書き換えず、結果が台帳と食い違えば終了コード 1（CI・テスト用）。
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(here, "..", "data");
const args = process.argv.slice(2);
const check = args.includes("--check");
const dateIdx = args.indexOf("--date");
const today = dateIdx >= 0 ? args[dateIdx + 1] : new Date().toISOString().slice(0, 10);

const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

const pip = ([x, y], ring) => {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
};
const orient = (a, b, c) => Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
const segCross = (a, b, c, d) => {
  const o1 = orient(a, b, c), o2 = orient(a, b, d), o3 = orient(c, d, a), o4 = orient(c, d, b);
  return o1 !== o2 && o3 !== o4 && o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0;
};
const bbox = (ring) => {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of ring) {
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  return [x0, y0, x1, y1];
};
const bboxHit = (a, b) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
const ringsOverlap = (r1, r2) => {
  if (!bboxHit(bbox(r1), bbox(r2))) return false;
  if (r1.some((p) => pip(p, r2)) || r2.some((p) => pip(p, r1))) return true;
  for (let i = 0; i < r1.length; i++) {
    const a = r1[i], b = r1[(i + 1) % r1.length];
    for (let j = 0; j < r2.length; j++) {
      if (segCross(a, b, r2[j], r2[(j + 1) % r2.length])) return true;
    }
  }
  return false;
};

const didDir = path.join(dataDir, "did", "r2");
const did = readdirSync(didDir)
  .filter((n) => /^pref-\d{2}\.json$/.test(n))
  .flatMap((n) => readJson(path.join(didDir, n)).features);
if (did.length === 0) {
  console.error("同梱の DID がないため重なりを計算できない");
  process.exit(check ? 1 : 0);
}

const covPath = path.join(dataDir, "industrial-exclusive", "coverage.json");
const coverage = readJson(covPath);
const zoneDir = path.join(dataDir, "industrial-exclusive", "by-muni");
const results = new Map();
for (const n of readdirSync(zoneDir).filter((x) => /^\d{5}\.json$/.test(x))) {
  const z = readJson(path.join(zoneDir, n));
  const hitMunis = new Set();
  for (const zone of z.zones) {
    for (const f of did) {
      if (ringsOverlap(zone.rings[0], f.rings[0])) hitMunis.add(f.muniName);
    }
  }
  results.set(z.muniCode, [...hitMunis].sort());
}

let mismatch = 0;
for (const e of coverage.municipalities) {
  let next;
  let overlapNote;
  if (e.status === "recorded" && results.has(e.muniCode)) {
    const hits = results.get(e.muniCode);
    next = hits.length > 0 ? "overlap" : "no_overlap";
    overlapNote =
      hits.length > 0
        ? `工業専用地域が DID（${hits.join("・")}）と重なる`
        : "工業専用地域は同梱の DID と重ならない";
  } else if (e.industrialZoneInSource === false) {
    next = "no_overlap";
    overlapNote = "入手元（国土数値情報 用途地域 A29 令和元年度）に工業専用地域がないため重なりなし";
  } else {
    next = "unverified";
  }
  if (e.didOverlap !== next) mismatch++;
  console.log(`${e.muniCode} ${e.muniName}: ${e.status} → didOverlap=${next}${overlapNote ? `（${overlapNote}）` : ""}`);
  if (!check) {
    e.didOverlap = next;
    if (overlapNote) {
      e.overlapNote = `${overlapNote}（compute-did-overlap.mjs、${today}）`;
    }
  }
}

if (check) {
  if (mismatch > 0) {
    console.error(`台帳の didOverlap が計算結果と ${mismatch} 件食い違う`);
    process.exit(1);
  }
  process.exit(0);
}

writeFileSync(covPath, JSON.stringify(coverage, null, 2) + "\n");

const srcPath = path.join(dataDir, "sources.json");
const sources = readJson(srcPath);
const ind = sources.datasets.find((d) => d.id === "industrial-exclusive");
if (ind) {
  const over = coverage.municipalities.filter((m) => m.status === "recorded" && m.didOverlap === "overlap");
  const noOver = coverage.municipalities.filter((m) => m.status === "recorded" && m.didOverlap === "no_overlap");
  const rec = coverage.municipalities.filter((m) => m.status === "recorded");
  ind.coverage = `収録済み ${rec.length} 市町村：${rec.map((m) => m.muniName).join("・")}。DID との重なり（${today} 計算）：あり＝${over.map((m) => m.muniName).join("・") || "なし"}／なし＝${noOver.map((m) => m.muniName).join("・") || "なし"}`;
}
writeFileSync(srcPath, JSON.stringify(sources, null, 2) + "\n");
console.log("coverage.json・sources.json を更新した");
