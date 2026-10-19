#!/usr/bin/env node
// 市町村の用途地域 GeoJSON から工業専用地域だけを取り出し、同梱形式
// （data/industrial-exclusive/by-muni/{muniCode}.json）に変換して src/data-bundle/industrial-bundle.ts を再生成する。
//
//   node packages/regulations/scripts/build-industrial-exclusive.mjs \
//     --muni 31202 --name 米子市 --in path/to/youto.geojson \
//     --filter-prop <用途地域名の属性> --filter-value 工業専用地域 \
//     --source "米子市 都市計画図（用途地域）" --source-url https://... --base-date 2026-04-01
//
// - 形状の単純化はしない。座標は小数 6 桁に丸める。穴（内側リング）は保持する。
// - 入力は WGS84（JGD2011 の緯度経度でも可）の GeoJSON。投影座標系は事前に変換すること。
// - coverage.json の更新（status: recorded 等）は手で行う（出典・基準日の確認を人が行うため）。
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgDir = path.resolve(here, "..");
const outDir = path.join(pkgDir, "data", "industrial-exclusive", "by-muni");
const bundleTs = path.join(pkgDir, "src", "data-bundle", "industrial-bundle.ts");

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);
const need = (k) => {
  const v = args.get(k);
  if (!v) {
    console.error(`missing ${k}`);
    process.exit(2);
  }
  return v;
};
const muni = need("--muni");
const name = need("--name");
const input = need("--in");
const filterProp = need("--filter-prop");
const filterValue = args.get("--filter-value") ?? "工業専用地域";
const source = need("--source");

const src = JSON.parse(readFileSync(input, "utf8"));
const r6 = (n) => Math.round(n * 1e6) / 1e6;
const zones = [];
for (const f of src.features ?? []) {
  if (String(f.properties?.[filterProp] ?? "") !== filterValue) continue;
  const polys = f.geometry?.type === "Polygon" ? [f.geometry.coordinates] : f.geometry?.type === "MultiPolygon" ? f.geometry.coordinates : [];
  for (const rings of polys) zones.push({ rings: rings.map((ring) => ring.map(([lng, lat]) => [r6(lng), r6(lat)])) });
}
if (zones.length === 0) {
  console.error(`${filterProp}=${filterValue} の地物がありません（書き出しません）`);
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });
writeFileSync(
  path.join(outDir, `${muni}.json`),
  JSON.stringify({
    muniCode: muni,
    muniName: name,
    datasetId: "industrial-exclusive",
    source,
    sourceUrl: args.get("--source-url") ?? null,
    baseDate: args.get("--base-date") ?? null,
    generatedAt: new Date().toISOString().slice(0, 10),
    zones,
  }) + "\n",
);
console.log(`${muni} ${name}: ${zones.length} zones`);

const codes = readdirSync(outDir)
  .map((n) => /^(\d{5})\.json$/.exec(n)?.[1])
  .filter(Boolean)
  .sort();
writeFileSync(
  bundleTs,
  `// このファイルは packages/regulations/scripts/build-industrial-exclusive.mjs が生成する。手で編集しない。
//
// 工業専用地域（DID 除外）のポリゴンを市町村単位で静的 import する。
import type { IndustrialBundleFile } from "../industrial-exclusive";
${codes.map((c) => `import m${c} from "../../data/industrial-exclusive/by-muni/${c}.json";`).join("\n")}

export const INDUSTRIAL_BUNDLE: Readonly<Record<string, IndustrialBundleFile>> = {
${codes.map((c) => `  "${c}": m${c} as unknown as IndustrialBundleFile,`).join("\n")}
};
`,
);
console.log("次に data/industrial-exclusive/coverage.json の当該市町村を status: recorded に更新してください。");
