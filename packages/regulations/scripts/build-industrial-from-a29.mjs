#!/usr/bin/env node
// 国土数値情報 用途地域（A29、令和元年度＝A29-19）の都道府県 GeoJSON から、工業専用地域を市町村ごとに
// 取り出して build-industrial-exclusive.mjs で同梱形式に変換し、収録範囲台帳（coverage.json）と
// データセット台帳（sources.json）に出典・取得日を記録する。
//
//   node build-industrial-from-a29.mjs --in a29-31.geojson --pref 31 --date 2026-11-01 --page <A29 ダウンロードページ>
//
// - 用途地域名の属性は A29_005（ダウンロードページで確認、2026-10-19）。値が「工業専用地域」の地物を使う。
// - 市町村コードの属性は、値が当該都道府県の 5 桁コードになっている属性を自動で探す（見つからなければ失敗）。
// - 工業専用地域が 1 件もない市町村は収録しない（台帳は変更しない）。
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgDir = path.resolve(here, "..");
const coveragePath = path.join(pkgDir, "data", "industrial-exclusive", "coverage.json");

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);
const input = args.get("--in");
const pref = args.get("--pref");
const today = args.get("--date") ?? new Date().toISOString().slice(0, 10);
const page = args.get("--page") ?? "";
if (!input || !pref) {
  console.error("usage: build-industrial-from-a29.mjs --in <geojson> --pref <31|32> [--date] [--page]");
  process.exit(2);
}

const TYPE_PROP = "A29_005";
const TARGET = "工業専用地域";
const src = JSON.parse(readFileSync(input, "utf8"));
const features = src.features ?? [];
if (features.length === 0) {
  console.log(`A29 pref ${pref}: 地物なし（スキップ）`);
  process.exit(0);
}
const props0 = features[0].properties ?? {};
console.log(`A29 pref ${pref} 属性（先頭地物）: ${JSON.stringify(props0)}`);
if (!(TYPE_PROP in props0)) {
  console.log(`A29 pref ${pref}: 属性 ${TYPE_PROP} が無い（スキップ）`);
  process.exit(0);
}
const values = [...new Set(features.map((f) => String(f.properties?.[TYPE_PROP] ?? "")))];
console.log(`A29 pref ${pref} の ${TYPE_PROP} の値: ${values.join(" / ")}`);

const codeProp = Object.keys(props0).find((k) => {
  const vals = features.slice(0, 100).map((f) => String(f.properties?.[k] ?? ""));
  return vals.length > 0 && vals.every((v) => new RegExp(`^${pref}\\d{3}$`).test(v));
});
if (!codeProp) {
  console.error(`A29 pref ${pref}: 市町村コードの属性を特定できない（失敗）`);
  process.exit(1);
}
const nameProp = Object.keys(props0).find(
  (k) => k !== TYPE_PROP && /[市町村]$/.test(String(props0[k] ?? "")),
);

const targets = features.filter((f) => String(f.properties?.[TYPE_PROP] ?? "") === TARGET);
const byMuni = new Map();
for (const f of targets) {
  const code = String(f.properties[codeProp]);
  if (!byMuni.has(code)) byMuni.set(code, []);
  byMuni.get(code).push(f);
}
console.log(`A29 pref ${pref}: 工業専用地域 ${targets.length} 地物 / ${byMuni.size} 市町村`);

const coverage = JSON.parse(readFileSync(coveragePath, "utf8"));
const tmp = mkdtempSync(path.join(os.tmpdir(), "a29-"));
const sourceName = "国土数値情報 用途地域（A29）令和元年度版（国土交通省）";
for (const [code, list] of byMuni) {
  const muniName =
    (nameProp && String(list[0].properties[nameProp] ?? "")) ||
    coverage.municipalities.find((m) => m.muniCode === code)?.muniName ||
    code;
  const file = path.join(tmp, `${code}.geojson`);
  writeFileSync(file, JSON.stringify({ type: "FeatureCollection", features: list }));
  execFileSync(
    process.execPath,
    [
      path.join(here, "build-industrial-exclusive.mjs"),
      "--muni", code,
      "--name", muniName,
      "--in", file,
      "--filter-prop", TYPE_PROP,
      "--filter-value", TARGET,
      "--source", sourceName,
      "--source-url", page,
      "--base-date", "2019",
    ],
    { stdio: "inherit" },
  );
  const entry = {
    muniCode: code,
    muniName,
    status: "recorded",
    didOverlap: "unverified",
    source: `${sourceName} ${page}（取得日 ${today}）`,
    baseDate: "2019年度（令和元年度）",
    checkedAt: today,
    note: "fetch-regulation-data（GitHub Actions）で自動取得。更新時点が古い（令和元年度）ため、市の最新の用途地域図との照合が必要。DID との重なりは未確認",
  };
  const i = coverage.municipalities.findIndex((m) => m.muniCode === code);
  if (i >= 0) coverage.municipalities[i] = { ...coverage.municipalities[i], ...entry };
  else coverage.municipalities.push(entry);
}
coverage.verifiedAt = today;
coverage.municipalities.sort((a, b) => a.muniCode.localeCompare(b.muniCode));
writeFileSync(coveragePath, JSON.stringify(coverage, null, 2) + "\n");

if (byMuni.size > 0) {
  execFileSync(
    process.execPath,
    [path.join(here, "record-regulation-sources.mjs"), "industrial", "--date", today, "--prefs", pref, "--page", page],
    { stdio: "inherit" },
  );
}
