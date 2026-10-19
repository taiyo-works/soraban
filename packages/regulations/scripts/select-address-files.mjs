// DCAT フィード（アドレス・ベース・レジストリ）から、住所検索の索引に使う配布ファイルを選ぶ（Sprint 9）。
//
//   node select-address-files.mjs <feed.json> "<都道府県コード…>" <manifest.tsv>
//
// 出力（manifest.tsv）：category<TAB>url<TAB>最終更新日<TAB>ファイル名。標準出力には選定のログ（Markdown）を書く。
// パスの接頭辞は abr-geocoder（abrdb/internal/schema/config_full.yaml の s3_text_path・s3_pos_path）と同じ。
// 最終更新日は abr-geocoder と同じく dataset.description の「最終更新日: …」から読む。
import { readFileSync, writeFileSync } from "node:fs";

const [feedPath, prefsArg, outPath] = process.argv.slice(2);
if (!feedPath || !prefsArg || !outPath) {
  console.error("usage: select-address-files.mjs <feed.json> <prefs> <manifest.tsv>");
  process.exit(2);
}
const prefs = prefsArg.split(/\s+/).filter(Boolean).map((p) => String(Number(p)));

// category: [接頭辞, 単位（pref | city | all）]
const CATEGORIES = {
  city: ["mt_city/pref/", "pref"],
  city_pos: ["mt_city_pos/pref/", "pref"],
  town: ["mt_town_fullset/pref/", "pref"],
  town_pos: ["mt_town_pos/pref/", "pref"],
  rsdtdsp_blk: ["mt_rsdtdsp_blk/pref/", "pref"],
  rsdtdsp_blk_pos: ["mt_rsdtdsp_blk_pos/pref/", "pref"],
  rsdtdsp_rsdt: ["mt_rsdtdsp_rsdt/pref/", "pref"],
  rsdtdsp_rsdt_pos: ["mt_rsdtdsp_rsdt_pos/pref/", "pref"],
  parcel: ["mt_parcel/city/", "city"],
  parcel_pos: ["mt_parcel_pos/city/", "city"],
};

const feed = JSON.parse(readFileSync(feedPath, "utf8"));
const datasets = Array.isArray(feed.dataset) ? feed.dataset : [];
console.log(`- フィードのデータセット数: ${datasets.length}`);

const modifiedOf = (desc) => {
  const m = /最終更新日:\s*(\S+)/.exec(String(desc ?? ""));
  return m ? m[1] : "";
};

const all = [];
for (const ds of datasets) {
  for (const dist of ds.distribution ?? []) {
    const url = dist.accessURL ?? dist.downloadURL;
    if (typeof url !== "string" || !url.endsWith(".csv.zip")) continue;
    all.push({ url, modified: modifiedOf(ds.description) || String(ds.modified ?? "") });
  }
}
console.log(`- .csv.zip の配布ファイル数: ${all.length}`);

const pathOf = (u) => {
  try {
    return new URL(u).pathname.replace(/^\/+/, "");
  } catch {
    return "";
  }
};

const rows = [];
for (const [category, [prefix, unit]] of Object.entries(CATEGORIES)) {
  const under = all.filter((f) => pathOf(f.url).startsWith(prefix));
  const picked = under.filter((f) => {
    const name = f.url.split("/").pop() ?? "";
    if (unit === "pref") {
      const m = /pref(\d+)(?:_pos)?\.csv\.zip$/.exec(name);
      return m !== null && prefs.includes(String(Number(m[1])));
    }
    const m = /city(\d{6})(?:_pos)?\.csv\.zip$/.exec(name);
    return m !== null && prefs.includes(String(Number(m[1].slice(0, 2))));
  });
  console.log(
    `- ${category}（${prefix}）：配下 ${under.length} 件中 ${picked.length} 件を選定` +
      (under.length > 0 && picked.length === 0 ? `（例：${under[0].url}）` : ""),
  );
  for (const f of picked.sort((a, b) => a.url.localeCompare(b.url))) {
    rows.push([category, f.url, f.modified, f.url.split("/").pop()].join("\t"));
  }
}
writeFileSync(outPath, rows.length ? rows.join("\n") + "\n" : "");
