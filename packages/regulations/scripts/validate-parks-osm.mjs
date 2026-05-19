// 既存テスト fixture (lat, lng, muniCode) を新しい OSM 公園データに対して評価し、
// 各 fixture が ANY 公園 polygon に含まれるかを確認する。
//
// OSM への切替で既存の evaluateMunicipalParks テストが回帰しないかの事前チェック。
//
// 使い方:
//   node packages/regulations/scripts/validate-parks-osm.mjs

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_DIR = path.resolve(__dirname, "..");
const OSM_DIR = path.join(PKG_DIR, "data", "parks", "by-muni-osm");

const FIXTURES = [
  { muni: "31202", loc: { lat: 35.4267, lng: 133.322 }, expect: "湊山公園" },
  { muni: "32203", loc: { lat: 35.3686, lng: 132.7568 }, expect: "出雲ドーム公園" },
  { muni: "31204", loc: { lat: 35.5455, lng: 133.2235 }, expect: "夢みなと公園" },
  { muni: "31201", loc: { lat: 35.5040, lng: 134.2440 }, expect: "久松公園" },
  { muni: "31203", loc: { lat: 35.4264, lng: 133.8230 }, expect: "打吹公園" },
  { muni: "32201", loc: { lat: 35.4740, lng: 133.0510 }, expect: "城山公園" },
  { muni: "31364", loc: { lat: 35.3995, lng: 133.8790 }, expect: "三朝中央公園" },
  { muni: "31370", loc: { lat: 35.4855, lng: 133.9020 }, expect: "東郷湖羽合臨海公園" },
  { muni: "31329", loc: { lat: 35.4158, lng: 134.2900 }, expect: "船岡竹林公園" },
  { muni: "32206", loc: { lat: 35.3720, lng: 133.1985 }, expect: "月山公園" },
  { muni: "32209", loc: { lat: 35.3610, lng: 132.9040 }, expect: "加茂岩倉遺跡ガイダンス公園" },
  { muni: "32205", loc: { lat: 35.1170, lng: 132.4380 }, expect: "石見銀山公園" },
];

// ray-casting point-in-polygon (lat/lng として扱う、平面近似)
const pointInPolygon = (loc, polygon) => {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lng, yi = polygon[i].lat;
    const xj = polygon[j].lng, yj = polygon[j].lat;
    const intersect =
      yi > loc.lat !== yj > loc.lat &&
      loc.lng < ((xj - xi) * (loc.lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
};

const main = async () => {
  let pass = 0, fail = 0;
  for (const fx of FIXTURES) {
    const file = path.join(OSM_DIR, `${fx.muni}.json`);
    const data = JSON.parse(await readFile(file, "utf8"));
    const hit = data.parks.find((p) => pointInPolygon(fx.loc, p.polygon));
    if (hit) {
      console.log(`PASS  ${fx.muni} (${data.muniName}) — loc inside "${hit.name}" (expected ~${fx.expect})`);
      pass++;
    } else {
      // 最も近い公園を参考表示
      const nearest = data.parks
        .map((p) => {
          const cx = p.polygon.reduce((a, q) => a + q.lng, 0) / p.polygon.length;
          const cy = p.polygon.reduce((a, q) => a + q.lat, 0) / p.polygon.length;
          const d = Math.hypot(cx - fx.loc.lng, cy - fx.loc.lat);
          return { name: p.name, d };
        })
        .sort((a, b) => a.d - b.d)[0];
      console.log(`FAIL  ${fx.muni} (${data.muniName}) — loc NOT inside any park; expected ~${fx.expect}; nearest = ${nearest?.name ?? "(none)"} at Δ${nearest ? (nearest.d * 111).toFixed(2) : "?"}km`);
      fail++;
    }
  }
  console.log(`\n${pass}/${FIXTURES.length} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
};

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
