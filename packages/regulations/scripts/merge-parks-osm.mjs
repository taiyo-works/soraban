// data/parks/by-muni/{code}.json (Phase 0/1 手描き seed) と
// data/parks/by-muni-osm/{code}.json (OSM fetch) をマージし、
// by-muni/{code}.json を上書きする。
//
// 設計判断:
//   - ハンドメイドが先頭 (test fixture の anchor として優先)
//   - OSM は名前未重複のものだけ追加 (dedupe by name)
//   - source label を "Phase 0/1 seed + OpenStreetMap supplement" に更新
//   - 名前重複は ハンドメイド版が勝つ (test polygon を温存)
//
// 使い方:
//   node packages/regulations/scripts/merge-parks-osm.mjs
//   node packages/regulations/scripts/merge-parks-osm.mjs --dry-run

import { readFile, writeFile, copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_DIR = path.resolve(__dirname, "..");
const HAND_DIR = path.join(PKG_DIR, "data", "parks", "by-muni");
const OSM_DIR = path.join(PKG_DIR, "data", "parks", "by-muni-osm");
const BACKUP_DIR = path.join(PKG_DIR, "data", "parks", "by-muni-handdrawn-backup");

const MUNI_CODES = [
  "31201", "31202", "31203", "31204",
  "31329", "31364", "31370",
  "32201", "32203", "32205", "32206", "32209",
];

const main = async () => {
  const dryRun = process.argv.includes("--dry-run");
  if (!dryRun) await mkdir(BACKUP_DIR, { recursive: true });

  const summary = [];
  for (const code of MUNI_CODES) {
    const handFile = path.join(HAND_DIR, `${code}.json`);
    const osmFile = path.join(OSM_DIR, `${code}.json`);
    const hand = JSON.parse(await readFile(handFile, "utf8"));
    const osm = JSON.parse(await readFile(osmFile, "utf8"));

    const handNames = new Set(hand.parks.map((p) => p.name));
    const osmAdded = osm.parks.filter((p) => !handNames.has(p.name));

    const merged = {
      muniCode: code,
      muniName: hand.muniName,
      prefCode: hand.prefCode ?? code.slice(0, 2),
      source: "Phase 0/1 手描き seed + OpenStreetMap (Overpass API) 補完。OSM: © OpenStreetMap contributors, ODbL",
      verifiedAt: new Date().toISOString(),
      parks: [...hand.parks, ...osmAdded],
    };

    summary.push({
      code,
      muniName: hand.muniName,
      hand: hand.parks.length,
      osm: osm.parks.length,
      added: osmAdded.length,
      total: merged.parks.length,
    });

    if (dryRun) continue;
    // バックアップ → 上書き
    await copyFile(handFile, path.join(BACKUP_DIR, `${code}.json`));
    await writeFile(handFile, JSON.stringify(merged, null, 2) + "\n");
  }

  console.log("\nmuni    | hand | osm  | added | total");
  console.log("--------|------|------|-------|------");
  for (const s of summary) {
    console.log(
      `${s.code} ${s.muniName.padEnd(4, "　")} | ${String(s.hand).padStart(4)} | ${String(s.osm).padStart(4)} | ${String(s.added).padStart(5)} | ${String(s.total).padStart(5)}`,
    );
  }
  const tot = summary.reduce((a, s) => ({
    hand: a.hand + s.hand,
    osm: a.osm + s.osm,
    added: a.added + s.added,
    total: a.total + s.total,
  }), { hand: 0, osm: 0, added: 0, total: 0 });
  console.log(`TOTAL   | ${String(tot.hand).padStart(4)} | ${String(tot.osm).padStart(4)} | ${String(tot.added).padStart(5)} | ${String(tot.total).padStart(5)}`);
  if (dryRun) console.log("\n(dry-run, no files written)");
  else console.log(`\nbackups: ${path.relative(PKG_DIR, BACKUP_DIR)}`);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
