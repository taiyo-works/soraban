#!/usr/bin/env node
// 国土数値情報 A16（人口集中地区、令和2年＝A16-20）の GeoJSON から、鳥取県（31）・島根県（32）の
// 同梱データ（data/did/r2/pref-XX.json）を作り、src/data-bundle/did-bundle.ts を再生成する。
//
//   node packages/regulations/scripts/build-did-r2.mjs --in path/to/A16-20_00_DID.geojson [--prefs 31,32]
//        [--code-prop 行政コード] [--name-prop 市町村名称] [--year 2020]
//
// - 形状の単純化はしない（境界が縮むと過小判定になる）。座標は小数 6 桁に丸めるだけ。
// - 合計容量が 10MB を超える場合は書き出さずに終了する（Sprint 7 契約。オーケストレーターに報告）。
// - 属性名は A16-15 の GeoJSON（行政コード・市町村名称）を既定とし、無ければ候補から自動で探す。
//   見つからなければ失敗させる（推測で埋めない）。
//
// 出典: 国土数値情報（人口集中地区データ）（国土交通省）
//       https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-A16-2020.html
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgDir = path.resolve(here, "..");
const outDir = path.join(pkgDir, "data", "did", "r2");
const bundleTs = path.join(pkgDir, "src", "data-bundle", "did-bundle.ts");
const MAX_BYTES = 10 * 1024 * 1024;

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);
const input = args.get("--in");
if (!input) {
  console.error("usage: build-did-r2.mjs --in <A16-20 GeoJSON> [--prefs 31,32]");
  process.exit(2);
}
const prefs = (args.get("--prefs") ?? "31,32").split(",").map((s) => s.trim());
const year = Number(args.get("--year") ?? 2020);

// A16-20 の GeoJSON（2026-10-18 の取得で確認）：A16_001=DIDid（7 桁）、A16_002=行政コード（5 桁）、A16_003=市区町村名称。
const CODE_CANDIDATES = [args.get("--code-prop"), "行政コード", "市区町村コード", "A16_002", "KEN_CITY"].filter(Boolean);
const NAME_CANDIDATES = [args.get("--name-prop"), "市町村名称", "市区町村名称", "市区町村名", "A16_003", "CITY_NAME"].filter(Boolean);

const src = JSON.parse(readFileSync(input, "utf8"));
if (src.type !== "FeatureCollection" || !Array.isArray(src.features)) {
  throw new Error("入力が GeoJSON FeatureCollection ではありません");
}
const sampleProps = src.features[0]?.properties ?? {};
// 市区町村コードの属性は「値が 5 桁の数字」であることを確かめて選ぶ（DIDid 等の 7 桁を取り違えない）。
const isMuniCodeProp = (k) => {
  const vals = src.features.slice(0, 50).map((f) => String(f.properties?.[k] ?? ""));
  return vals.length > 0 && vals.filter((v) => /^\d{5}$/.test(v)).length / vals.length >= 0.9;
};
const codeProp = CODE_CANDIDATES.find((k) => k in sampleProps && isMuniCodeProp(k));
const nameProp = NAME_CANDIDATES.find(
  (k) => k in sampleProps && k !== codeProp && !/^\d+$/.test(String(sampleProps[k] ?? "")),
);
if (!codeProp || !nameProp) {
  throw new Error(
    `市区町村コード・名称の属性が見つかりません。--code-prop / --name-prop で指定してください。属性: ${Object.keys(sampleProps).join(", ")}`,
  );
}

const r6 = (n) => Math.round(n * 1e6) / 1e6;
const ring6 = (ring) => ring.map(([lng, lat]) => [r6(lng), r6(lat)]);

const written = [];
let total = 0;
const outputs = [];
for (const pref of prefs) {
  const features = [];
  for (const f of src.features) {
    const code = String(f.properties?.[codeProp] ?? "");
    if (code.slice(0, 2) !== pref) continue;
    const name = String(f.properties?.[nameProp] ?? "");
    const polys = f.geometry?.type === "Polygon" ? [f.geometry.coordinates] : f.geometry?.type === "MultiPolygon" ? f.geometry.coordinates : [];
    for (const rings of polys) features.push({ muniCode: code, muniName: name, rings: rings.map(ring6) });
  }
  if (features.length === 0) {
    console.warn(`pref ${pref}: 該当する DID がありません（書き出しません）`);
    continue;
  }
  const file = {
    datasetId: "did-r2",
    baseYear: year,
    prefCode: pref,
    source: `国土数値情報 人口集中地区データ（A16）${year}年版（国土交通省）https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-A16-2020.html`,
    generatedAt: new Date().toISOString().slice(0, 10),
    features,
  };
  const text = JSON.stringify(file);
  total += Buffer.byteLength(text);
  outputs.push({ pref, text, count: features.length });
}
if (total > MAX_BYTES) {
  if (process.env.ALLOW_OVERSIZE === "1") {
    console.warn(`警告: 合計 ${(total / 1024 / 1024).toFixed(2)}MB が目安 10MB を超えています（ALLOW_OVERSIZE=1 のため書き出します）`);
  } else {
    console.error(`合計 ${(total / 1024 / 1024).toFixed(2)}MB が上限 10MB を超えるため書き出しません（オーケストレーターに報告）`);
    process.exit(1);
  }
}
mkdirSync(outDir, { recursive: true });
for (const o of outputs) {
  writeFileSync(path.join(outDir, `pref-${o.pref}.json`), o.text + "\n");
  written.push(o.pref);
  console.log(`pref ${o.pref}: ${o.count} polygons`);
}

const imports = written.map((p) => `import pref${p} from "../../data/did/r2/pref-${p}.json";`).join("\n");
const entries = written.map((p) => `  "${p}": pref${p} as unknown as DidBundleFile,`).join("\n");
writeFileSync(
  bundleTs,
  `// このファイルは packages/regulations/scripts/build-did-r2.mjs が生成する。手で編集しない。
//
// 鳥取県（31）・島根県（32）の DID（国土数値情報 A16 令和2年）を静的 import で同梱し、
// 本番（Vercel）でもファイル I/O なしで読み込めるようにする。
import type { DidBundleFile } from "../did-data";
${imports}

export const DID_BUNDLE: Readonly<Record<string, DidBundleFile>> = {
${entries}
};
`,
);
console.log(`done. total ${(total / 1024 / 1024).toFixed(2)}MB → ${path.relative(process.cwd(), outDir)}`);
console.log("次に data/sources.json の did-r2（acquiredAt・bundled・coverage）を更新してください。");
