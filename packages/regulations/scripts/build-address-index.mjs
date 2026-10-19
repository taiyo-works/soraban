// アドレス・ベース・レジストリ（デジタル庁）の CSV から、住所検索の同梱索引を作る（Sprint 9）。
//
//   node build-address-index.mjs --work <取得作業ディレクトリ> --manifest <manifest.tsv> \
//     --out packages/regulations/data/address --bundle packages/regulations/src/data-bundle/address-bundle.ts \
//     --acquired YYYY-MM-DD --feed <DCAT フィード URL>
//
// 入力：<work>/csv/<category>/*.csv（fetch-address-data.sh が展開したもの。category は select-address-files.mjs と同じ）
// 出力：
//   - <out>/index-<pref>.json   … 市区町村・町字・住居表示（街区・住居）。座標は [緯度, 経度] を小数 6 桁に丸める
//   - <out>/parcels-<pref>.json … 地番（座標付き）。住所データの合計が 10MB 以内に収まる場合だけ書く
//   - <out>/stats.json          … 件数・座標付き件数・容量・市区町村ごとの地番の位置付き件数・取得元 URL・取得日・版
//   - <out>/README.md           … stats.json の内容を表にしたもの（出典・加工の旨を含む）
//   - <bundle>                  … 索引を静的 import する TypeScript（手で編集しない）
// 列は CSV の見出し行の名前で読む（abr-geocoder の config_full.yaml と同じ列名）。廃止（ablt_date あり）は除く。
// 同じ入力からは同じ出力になる（並びは各 ID の昇順、生成日時は取得日）。
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import readline from "node:readline";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
for (const k of ["work", "manifest", "out", "bundle", "acquired", "feed"]) {
  if (!args[k]) {
    console.error(`missing --${k}`);
    process.exit(2);
  }
}
const LIMIT_BYTES = 10_000_000; // 住所データの同梱分の上限（10MB）
const PREF_NAMES = { 31: "鳥取県", 32: "島根県" };

const manifest = readFileSync(args.manifest, "utf8")
  .split("\n")
  .filter(Boolean)
  .map((l) => {
    const [category, url, modified, file] = l.split("\t");
    return { category, url, modified, file };
  });

// ---- CSV ----
const parseLine = (line) => {
  const out = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else q = false;
      } else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
};

const csvFiles = (category) => {
  const dir = path.join(args.work, "csv", category);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith(".csv"))
    .sort()
    .map((f) => path.join(dir, f));
};

/** CSV を 1 行ずつ読み、見出し名 → 値のオブジェクトを渡す。 */
const eachRow = async (file, fn) => {
  const rl = readline.createInterface({ input: createReadStream(file, "utf8"), crlfDelay: Infinity });
  let header = null;
  for await (let line of rl) {
    if (header === null) {
      header = parseLine(line.replace(/^﻿/, "")).map((h) => h.trim());
      continue;
    }
    if (line.length === 0) continue;
    const cells = parseLine(line);
    const row = {};
    for (let i = 0; i < header.length; i++) row[header[i]] = (cells[i] ?? "").trim();
    fn(row);
  }
  return header ?? [];
};

const dirBytes = (category) => csvFiles(category).reduce((s, f) => s + statSync(f).size, 0);
const zipBytes = (category) => {
  const dir = path.join(args.work, "zip", category);
  if (!existsSync(dir)) return 0;
  return readdirSync(dir).reduce((s, f) => s + statSync(path.join(dir, f)).size, 0);
};

const round6 = (v) => {
  const n = Number(v);
  return v !== "" && Number.isFinite(n) ? Math.round(n * 1e6) / 1e6 : null;
};
const isLive = (row) => !row.ablt_date;
const prefOfLg = (lg) => String(Number(String(lg).slice(0, 2)));

/** 位置参照（_pos）を key → [lat, lng] にまとめる。 */
const loadPos = async (category, keyOf, filter = () => true) => {
  const map = new Map();
  let srid = new Set();
  for (const f of csvFiles(category).filter(filter)) {
    await eachRow(f, (r) => {
      const lat = round6(r.rep_lat);
      const lng = round6(r.rep_lon);
      if (lat === null || lng === null) return;
      if (r.rep_srid) srid.add(r.rep_srid);
      const k = keyOf(r);
      if (!map.has(k)) map.set(k, [lat, lng]);
    });
  }
  return { map, srid: [...srid].sort() };
};

const headers = {};
const sridAll = new Set();

// ---- 市区町村 ----
const cityPos = await loadPos("city_pos", (r) => r.lg_code);
cityPos.srid.forEach((s) => sridAll.add(s));
const cities = []; // {lg, pref, county, city, ward, pos}
for (const f of csvFiles("city")) {
  headers.city = await eachRow(f, (r) => {
    if (!isLive(r) || !r.city) return;
    if (!PREF_NAMES[prefOfLg(r.lg_code)]) return;
    cities.push({ lg: r.lg_code, pref: r.pref, county: r.county, city: r.city, ward: r.ward, pos: cityPos.map.get(r.lg_code) ?? null });
  });
}
cities.sort((a, b) => a.lg.localeCompare(b.lg));
console.log(`市区町村: ${cities.length}（座標付き ${cities.filter((c) => c.pos).length}）`);

// ---- 町字 ----
const townPos = await loadPos("town_pos", (r) => `${r.lg_code}:${r.machiaza_id}`);
townPos.srid.forEach((s) => sridAll.add(s));
const towns = []; // {lg, id, pref, oaza, chome, koaza, rsdt, pos}
let townAll = 0;
for (const f of csvFiles("town")) {
  headers.town = await eachRow(f, (r) => {
    townAll++;
    if (!isLive(r)) return;
    towns.push({
      lg: r.lg_code,
      id: r.machiaza_id,
      pref: r.pref,
      oaza: r.oaza_cho,
      chome: r.chome,
      koaza: r.koaza,
      rsdt: r.rsdt_addr_flg === "1" ? 1 : 0,
      pos: townPos.map.get(`${r.lg_code}:${r.machiaza_id}`) ?? null,
    });
  });
}
towns.sort((a, b) => (a.lg + a.id).localeCompare(b.lg + b.id));
console.log(`町字: 全行 ${townAll}・有効 ${towns.length}（座標付き ${towns.filter((t) => t.pos).length}）`);

// ---- 住居表示：街区 ----
const blkPos = await loadPos("rsdtdsp_blk_pos", (r) => `${r.lg_code}:${r.machiaza_id}:${r.blk_id}`);
blkPos.srid.forEach((s) => sridAll.add(s));
const blocks = [];
let blkAll = 0;
for (const f of csvFiles("rsdtdsp_blk")) {
  headers.rsdtdsp_blk = await eachRow(f, (r) => {
    blkAll++;
    if (!isLive(r)) return;
    blocks.push({ lg: r.lg_code, mid: r.machiaza_id, id: r.blk_id, num: r.blk_num, pos: blkPos.map.get(`${r.lg_code}:${r.machiaza_id}:${r.blk_id}`) ?? null });
  });
}
blocks.sort((a, b) => (a.lg + a.mid + a.id).localeCompare(b.lg + b.mid + b.id));
console.log(`街区: 全行 ${blkAll}・有効 ${blocks.length}（座標付き ${blocks.filter((b) => b.pos).length}）`);

// ---- 住居表示：住居 ----
const rsdtKey = (r) => `${r.lg_code}:${r.machiaza_id}:${r.blk_id}:${r.rsdt_id}:${r.rsdt2_id ?? ""}`;
const rsdtPos = await loadPos("rsdtdsp_rsdt_pos", rsdtKey);
rsdtPos.srid.forEach((s) => sridAll.add(s));
const residences = [];
let rsdtAll = 0;
for (const f of csvFiles("rsdtdsp_rsdt")) {
  headers.rsdtdsp_rsdt = await eachRow(f, (r) => {
    rsdtAll++;
    if (!isLive(r)) return;
    residences.push({
      lg: r.lg_code,
      mid: r.machiaza_id,
      bid: r.blk_id,
      num: r.rsdt_num,
      num2: r.rsdt_num2 ?? "",
      key: rsdtKey(r),
      pos: rsdtPos.map.get(rsdtKey(r)) ?? null,
    });
  });
}
residences.sort((a, b) => a.key.localeCompare(b.key));
console.log(`住居: 全行 ${rsdtAll}・有効 ${residences.length}（座標付き ${residences.filter((r) => r.pos).length}）`);

// ---- 地番（市区町村ごと） ----
const parcelStats = new Map(); // lg -> {total, withPos}
const parcels = []; // {lg, mid, num, pos}
const parcelFiles = csvFiles("parcel");
for (const f of parcelFiles) {
  const m = /city(\d{6})/.exec(path.basename(f));
  const code = m ? m[1] : null;
  const posFiles = csvFiles("parcel_pos").filter((p) => (code ? p.includes(`city${code}`) : false));
  const pos = new Map();
  for (const pf of posFiles) {
    await eachRow(pf, (r) => {
      const lat = round6(r.rep_lat);
      const lng = round6(r.rep_lon);
      if (lat === null || lng === null) return;
      if (r.rep_srid) sridAll.add(r.rep_srid);
      const k = `${r.lg_code}:${r.machiaza_id}:${r.prc_id}`;
      if (!pos.has(k)) pos.set(k, [lat, lng]);
    });
  }
  headers.parcel = await eachRow(f, (r) => {
    if (!isLive(r)) return;
    const st = parcelStats.get(r.lg_code) ?? { total: 0, withPos: 0 };
    st.total++;
    const p = pos.get(`${r.lg_code}:${r.machiaza_id}:${r.prc_id}`);
    if (p) {
      st.withPos++;
      const num = [r.prc_num1, r.prc_num2, r.prc_num3].filter((x) => x !== "" && x !== undefined).map((x) => String(Number(x) || x)).join("-");
      parcels.push({ lg: r.lg_code, mid: r.machiaza_id, id: r.prc_id, num, pos: p });
    }
    parcelStats.set(r.lg_code, st);
  });
}
parcels.sort((a, b) => (a.lg + a.mid + a.id).localeCompare(b.lg + b.mid + b.id));
console.log(`地番: 有効 ${[...parcelStats.values()].reduce((s, v) => s + v.total, 0)}（座標付き ${parcels.length}）`);

// ---- 索引の組み立て（都道府県ごと） ----
mkdirSync(args.out, { recursive: true });
for (const f of readdirSync(args.out)) {
  if (/^(index|parcels)-\d+\.json$/.test(f)) rmSync(path.join(args.out, f));
}
const prefCodes = Object.keys(PREF_NAMES).filter((p) => cities.some((c) => prefOfLg(c.lg) === p));
const sourceFiles = manifest.map((m) => ({ category: m.category, url: m.url, lastModified: m.modified }));
const versions = [...new Set(manifest.map((m) => m.modified).filter(Boolean))].sort();
const meta = (pref) => ({
  datasetId: "abr-address",
  source: "アドレス・ベース・レジストリ（デジタル庁）を加工して作成",
  license: "公共データ利用規約（第1.0版）（PDL1.0）",
  feed: args.feed,
  acquiredAt: args.acquired,
  version: versions.length ? `${versions[0]}〜${versions[versions.length - 1]}` : "不明",
  srid: [...sridAll].sort(),
  files: sourceFiles.filter((s) => s.url.includes(`pref${pref}`) || s.url.includes(`city${pref}`)),
});

const written = {}; // file -> bytes
const parcelJson = {};
for (const pref of prefCodes) {
  const pCities = cities.filter((c) => prefOfLg(c.lg) === pref);
  const cityIdx = new Map(pCities.map((c, i) => [c.lg, i]));
  const pTowns = towns.filter((t) => cityIdx.has(t.lg));
  const townIdx = new Map(pTowns.map((t, i) => [`${t.lg}:${t.id}`, i]));
  // 座標のある街区と、座標のある住居が属する街区を残す
  const rsdtWithPos = residences.filter((r) => r.pos && townIdx.has(`${r.lg}:${r.mid}`));
  const neededBlk = new Set(rsdtWithPos.map((r) => `${r.lg}:${r.mid}:${r.bid}`));
  const pBlocks = blocks.filter((b) => townIdx.has(`${b.lg}:${b.mid}`) && (b.pos || neededBlk.has(`${b.lg}:${b.mid}:${b.id}`)));
  const blkIdx = new Map(pBlocks.map((b, i) => [`${b.lg}:${b.mid}:${b.id}`, i]));
  const index = {
    format: 1,
    prefCode: pref,
    pref: PREF_NAMES[pref],
    ...meta(pref),
    // [lg_code, 郡, 市区町村, 区, 緯度, 経度]
    cities: pCities.map((c) => [c.lg, c.county, c.city, c.ward, c.pos?.[0] ?? null, c.pos?.[1] ?? null]),
    // [市区町村の添字, 町字 ID, 大字・町, 丁目, 小字, 緯度, 経度, 住居表示（1/0）]
    towns: pTowns.map((t) => [cityIdx.get(t.lg), t.id, t.oaza, t.chome, t.koaza, t.pos?.[0] ?? null, t.pos?.[1] ?? null, t.rsdt]),
    // [町字の添字, 街区符号, 緯度, 経度]
    blocks: pBlocks.map((b) => [townIdx.get(`${b.lg}:${b.mid}`), b.num, b.pos?.[0] ?? null, b.pos?.[1] ?? null]),
    // [街区の添字, 住居番号, 住居番号2, 緯度, 経度]
    residences: rsdtWithPos
      .filter((r) => blkIdx.has(`${r.lg}:${r.mid}:${r.bid}`))
      .map((r) => [blkIdx.get(`${r.lg}:${r.mid}:${r.bid}`), r.num, r.num2, r.pos[0], r.pos[1]]),
  };
  const file = `index-${pref}.json`;
  const body = JSON.stringify(index);
  writeFileSync(path.join(args.out, file), body);
  written[file] = Buffer.byteLength(body);
  parcelJson[pref] = JSON.stringify({
    format: 1,
    prefCode: pref,
    datasetId: "abr-address",
    acquiredAt: args.acquired,
    // [町字の添字（index-<pref>.json の towns）, 地番（例 "123-4"）, 緯度, 経度]
    parcels: parcels.filter((p) => townIdx.has(`${p.lg}:${p.mid}`)).map((p) => [townIdx.get(`${p.lg}:${p.mid}`), p.num, p.pos[0], p.pos[1]]),
  });
}
const baseBytes = Object.values(written).reduce((s, v) => s + v, 0);
const parcelBytes = Object.values(parcelJson).reduce((s, v) => s + Buffer.byteLength(v), 0);
const RESERVE = 200_000; // stats.json・README.md の分
const includeParcels = parcels.length > 0 && baseBytes + parcelBytes + RESERVE <= LIMIT_BYTES;
if (includeParcels) {
  for (const [pref, body] of Object.entries(parcelJson)) {
    const file = `parcels-${pref}.json`;
    writeFileSync(path.join(args.out, file), body);
    written[file] = Buffer.byteLength(body);
  }
}
console.log(`索引: 町字・住居表示 ${baseBytes} bytes、地番 ${parcelBytes} bytes → 地番を${includeParcels ? "同梱する" : "同梱しない"}`);

// ---- 統計 ----
const cityName = (lg) => {
  const c = cities.find((x) => x.lg === lg);
  return c ? `${c.pref}${c.county}${c.city}${c.ward}` : lg;
};
const byPref = (arr, lgOf = (x) => x.lg) =>
  Object.fromEntries(prefCodes.map((p) => [p, { total: arr.filter((x) => prefOfLg(lgOf(x)) === p).length, withPos: arr.filter((x) => prefOfLg(lgOf(x)) === p && x.pos).length }]));
const stats = {
  datasetId: "abr-address",
  acquiredAt: args.acquired,
  feed: args.feed,
  version: meta("").version,
  srid: [...sridAll].sort(),
  limitBytes: LIMIT_BYTES,
  parcelsBundled: includeParcels,
  counts: {
    city: byPref(cities),
    town: byPref(towns),
    block: byPref(blocks),
    residence: byPref(residences),
    parcel: Object.fromEntries(
      prefCodes.map((p) => {
        const e = [...parcelStats.entries()].filter(([lg]) => prefOfLg(lg) === p);
        return [p, { total: e.reduce((s, [, v]) => s + v.total, 0), withPos: e.reduce((s, [, v]) => s + v.withPos, 0) }];
      }),
    ),
  },
  parcelByCity: [...parcelStats.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([lg, v]) => ({ lgCode: lg, name: cityName(lg), total: v.total, withPos: v.withPos })),
  sourceBytes: Object.fromEntries(
    Object.keys(Object.fromEntries(manifest.map((m) => [m.category, 1]))).map((c) => [c, { zip: zipBytes(c), csv: dirBytes(c) }]),
  ),
  indexBytes: written,
  parcelIndexBytesIfBundled: parcelBytes,
  headers,
  files: sourceFiles,
};
const statsBody = JSON.stringify(stats, null, 2) + "\n";
writeFileSync(path.join(args.out, "stats.json"), statsBody);

// ---- README ----
const fmt = (n) => Number(n).toLocaleString("en-US");
const mb = (n) => `${(n / 1_000_000).toFixed(2)} MB`;
const rows = (label, key) =>
  prefCodes.map((p) => `| ${label} | ${PREF_NAMES[p]} | ${fmt(stats.counts[key][p].total)} | ${fmt(stats.counts[key][p].withPos)} |`).join("\n");
const readme = `# 住所検索の同梱索引（アドレス・ベース・レジストリ、鳥取県・島根県）

> このファイルは \`packages/regulations/scripts/build-address-index.mjs\` が生成する（Sprint 9 A-1 の計測結果）。手で編集しない。
> 取得・変換は GitHub Actions の \`fetch-address-data\` ワークフロー（\`packages/regulations/scripts/fetch-address-data.sh\`）。

## 出典とライセンス

- 出典：アドレス・ベース・レジストリ（デジタル庁）を加工して作成（加工者：そらばん（フューチャーテック株式会社））
- 利用条件：公共データ利用規約（第1.0版）（PDL1.0）— https://www.digital.go.jp/policies/base_registry_address_tos 、https://www.digital.go.jp/resources/open_data/public_data_license_v1.0
- 地番マスターは、上記に加え「登記所備付地図データ利用規約」に同意したものとみなされる（同規約の本文は未確認）
- 加工の内容：廃止された行を除き、町字・住居表示・地番の本体と位置参照（代表点）を ID で結合し、座標を小数 6 桁に丸め、検索用の配列形式にした
- 取得元：DCAT フィード ${args.feed}（このフィードに載っている配布ファイルの URL だけを使用）
- 取得日：${args.acquired}
- 版（配布ファイルの最終更新日の範囲）：${stats.version}
- 測地系（rep_srid）：${stats.srid.join("・") || "不明"}

## 件数（廃止を除く）

| 種類 | 県 | 件数 | 座標付き件数 |
|---|---|---:|---:|
${rows("市区町村", "city")}
${rows("町字", "town")}
${rows("住居表示（街区）", "block")}
${rows("住居表示（住居）", "residence")}
${rows("地番", "parcel")}

## 市区町村ごとの地番の位置付き件数

| 市区町村 | 全件数 | 位置付き件数 | 割合 |
|---|---:|---:|---:|
${stats.parcelByCity.map((c) => `| ${c.name}（${c.lgCode}） | ${fmt(c.total)} | ${fmt(c.withPos)} | ${c.total ? ((c.withPos / c.total) * 100).toFixed(1) : "0.0"}% |`).join("\n") || "| （地番のデータなし） | 0 | 0 | — |"}

## 容量

| 種類 | 取得ファイル（ZIP） | 展開後（CSV） |
|---|---:|---:|
${Object.entries(stats.sourceBytes).map(([c, v]) => `| ${c} | ${fmt(v.zip)} | ${fmt(v.csv)} |`).join("\n")}

| 同梱ファイル | 容量 |
|---|---:|
${Object.entries(written).map(([f, b]) => `| ${f} | ${fmt(b)}（${mb(b)}） |`).join("\n")}

- 地番の索引にした場合の容量：${fmt(parcelBytes)} bytes（${mb(parcelBytes)}）
- 住所データの同梱分の上限：${fmt(LIMIT_BYTES)} bytes（10MB）。町字・住居表示 ${mb(baseBytes)} ＋ 地番 ${mb(parcelBytes)}
- 地番の同梱：**${includeParcels ? "する（上限内に収まる）" : "しない（上限を超えるか、位置付きの地番がない。spec §13.6・Sprint 9 契約 A-2 のとおり収録しない）"}**

## 索引の形式

- \`index-<県コード>.json\`：\`cities\`＝[lg_code, 郡, 市区町村, 区, 緯度, 経度]、\`towns\`＝[市区町村の添字, 町字 ID, 大字・町, 丁目, 小字, 緯度, 経度, 住居表示 1/0]、\`blocks\`＝[町字の添字, 街区符号, 緯度, 経度]、\`residences\`＝[街区の添字, 住居番号, 住居番号2, 緯度, 経度]
- \`parcels-<県コード>.json\`（同梱した場合のみ）：[町字の添字, 地番, 緯度, 経度]
- 位置は各レコードの代表点（rep_lat・rep_lon）。町字の代表点は実際の飛行地点から数百 m 以上離れることがある
`;
writeFileSync(path.join(args.out, "README.md"), readme);

// ---- 静的 import の TypeScript ----
const imports = [];
const entries = [];
for (const pref of prefCodes) {
  imports.push(`import index${pref} from "../../data/address/index-${pref}.json";`);
  if (includeParcels) imports.push(`import parcels${pref} from "../../data/address/parcels-${pref}.json";`);
  entries.push(
    `  "${pref}": { index: index${pref} as unknown as AddressIndexFile, parcels: ${includeParcels ? `parcels${pref} as unknown as AddressParcelFile` : "null"} },`,
  );
}
const bundle = `// このファイルは packages/regulations/scripts/build-address-index.mjs が生成する。手で編集しない。
//
// 鳥取県（31）・島根県（32）の住所検索の索引（アドレス・ベース・レジストリを加工して作成）を静的 import で同梱し、
// 本番（Vercel）でもファイル I/O・外部 API なしで検索できるようにする。地番の同梱：${includeParcels ? "あり" : "なし"}
import type { AddressIndexFile, AddressParcelFile } from "../address/types";
${imports.join("\n")}

export const ADDRESS_BUNDLE: Readonly<
  Record<string, { readonly index: AddressIndexFile; readonly parcels: AddressParcelFile | null }>
> = {
${entries.join("\n")}
};
`;
mkdirSync(path.dirname(args.bundle), { recursive: true });
writeFileSync(args.bundle, bundle);

const total = Object.values(written).reduce((s, v) => s + v, 0) + Buffer.byteLength(statsBody) + Buffer.byteLength(readme);
console.log(`同梱する住所データの合計: ${total} bytes（上限 ${LIMIT_BYTES}）`);
if (total > LIMIT_BYTES) {
  console.error("住所データの合計が 10MB を超えた（町字・住居表示だけで上限超過）。同梱しない判断が必要");
  process.exit(3);
}
if (cities.length === 0 || towns.length === 0) {
  console.error("市区町村または町字が 0 件（入力の不備）");
  process.exit(4);
}
