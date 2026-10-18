#!/usr/bin/env node
// 取得したデータの出典・取得日をデータセット台帳（data/sources.json）に記録する。
//
//   node record-regulation-sources.mjs did --date 2026-11-01 --prefs 31,32 --page <A16 ダウンロードページ>
//   node record-regulation-sources.mjs industrial --date 2026-11-01 --prefs 31 --page <A29 ダウンロードページ>
//
// 確認日（verifiedAt）を更新するため、判定の証跡 ID が変わる（意図どおり）。
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgDir = path.resolve(here, "..");
const sourcesPath = path.join(pkgDir, "data", "sources.json");

const kind = process.argv[2];
const args = new Map();
for (let i = 3; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);
const today = args.get("--date") ?? new Date().toISOString().slice(0, 10);
const page = args.get("--page");
const sources = JSON.parse(readFileSync(sourcesPath, "utf8"));
const set = (id, patch) => {
  const i = sources.datasets.findIndex((d) => d.id === id);
  if (i < 0) throw new Error(`sources.json に ${id} がない`);
  sources.datasets[i] = { ...sources.datasets[i], ...patch };
};
const PREF_NAME = { "31": "鳥取県", "32": "島根県" };

if (kind === "did") {
  const files = readdirSync(path.join(pkgDir, "data", "did", "r2")).filter((n) => /^pref-\d{2}\.json$/.test(n));
  const prefs = files.map((n) => n.slice(5, 7)).sort();
  set("did-r2", {
    ...(page ? { url: page } : {}),
    acquiredAt: today,
    verifiedAt: today,
    verifiedBy: "fetch-regulation-data（GitHub Actions、自動取得）",
    coverage: `${prefs.map((p) => `${PREF_NAME[p] ?? p}（${p}）`).join("・")}。国土数値情報のダウンロードページから取得（${today}）`,
    bundled: prefs.length > 0,
  });
  console.log(`sources.json: did-r2 を更新（${prefs.join(",")}、取得日 ${today}）`);
} else if (kind === "industrial") {
  const coverage = JSON.parse(
    readFileSync(path.join(pkgDir, "data", "industrial-exclusive", "coverage.json"), "utf8"),
  );
  const recorded = coverage.municipalities.filter((m) => m.status === "recorded");
  set("industrial-exclusive", {
    ...(page ? { url: page } : {}),
    provider: "国土交通省（国土数値情報 用途地域 A29。原典は各市町の都市計画決定）",
    license:
      "国土数値情報の使用許諾条件および各市町村の利用条件に従う（令和元年度版の商用可否はダウンロードページで明示されておらず未確認）",
    baseYear: 2019,
    version: `A29-19（令和元年度）。収録範囲台帳 ${today} 版`,
    acquiredAt: today,
    verifiedAt: today,
    verifiedBy: "fetch-regulation-data（GitHub Actions、自動取得）",
    coverage: `収録済み ${recorded.length} 市町村：${recorded.map((m) => m.muniName).join("・")}（DID との重なりは未確認）`,
    bundled: recorded.length > 0,
  });
  console.log(`sources.json: industrial-exclusive を更新（収録 ${recorded.length} 市町村）`);
} else {
  console.error("usage: record-regulation-sources.mjs did|industrial ...");
  process.exit(2);
}
writeFileSync(sourcesPath, JSON.stringify(sources, null, 2) + "\n");
