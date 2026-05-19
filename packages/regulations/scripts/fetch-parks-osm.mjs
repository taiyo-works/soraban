// OpenStreetMap Overpass API から 12 市町村の都市公園を fetch して
// Soraban 内部スキーマ {muniCode, muniName, prefCode, parks: [{id, name, polygon}]}
// に変換、data/parks/by-muni-osm/{muniCode}.json として書き出す。
//
// 既存の by-muni/*.json には触らない（差分比較してから差し替え判断するため）。
//
// 出典: © OpenStreetMap contributors — ODbL ライセンス。商用利用可、出典表示必須。
//       https://www.openstreetmap.org/copyright
//
// 使い方:
//   node packages/regulations/scripts/fetch-parks-osm.mjs            # 全 12 市町村
//   node packages/regulations/scripts/fetch-parks-osm.mjs 31202      # 単一市町村
//
// 設計判断:
//   - admin_level=7 の area 内で leisure=park の way + relation を抽出
//   - relation (multipolygon) は外周 (role=outer) の最初のリングのみ採用 (現状スキーマが
//     単一 polygon しか持たないため。Phase 1 後半で MultiPolygon 対応は別タスク)
//   - 名前なし公園は除外 (id 生成・UI 表示の両方で名前必須)
//   - 連続リクエスト間に 2 秒スリープを入れ Overpass server に礼儀を尽くす

import { writeFile, mkdir, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_DIR = path.resolve(__dirname, "..");
const OUT_DIR = path.join(PKG_DIR, "data", "parks", "by-muni-osm");

// 12 市町村: コード / 公式名 (OSM の name タグと一致させる) / 都道府県コード
const MUNIS = [
  { code: "31201", name: "鳥取市", prefCode: "31" },
  { code: "31202", name: "米子市", prefCode: "31" },
  { code: "31203", name: "倉吉市", prefCode: "31" },
  { code: "31204", name: "境港市", prefCode: "31" },
  { code: "31329", name: "八頭町", prefCode: "31" },
  { code: "31364", name: "三朝町", prefCode: "31" },
  { code: "31370", name: "湯梨浜町", prefCode: "31" },
  { code: "32201", name: "松江市", prefCode: "32" },
  { code: "32203", name: "出雲市", prefCode: "32" },
  { code: "32205", name: "大田市", prefCode: "32" },
  { code: "32206", name: "安来市", prefCode: "32" },
  { code: "32209", name: "雲南市", prefCode: "32" },
];

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

const buildQuery = (muniName) => `
[out:json][timeout:90];
area["admin_level"="7"]["name"="${muniName}"]->.a;
(
  way["leisure"="park"](area.a);
  relation["leisure"="park"](area.a);
);
out geom;
`.trim();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// way 1 つから polygon (lat/lng 配列) を作る。閉じていなければ最後の点で閉じる。
const wayToPolygon = (geometry) => {
  if (!Array.isArray(geometry) || geometry.length < 3) return null;
  const pts = geometry.map((p) => ({ lat: p.lat, lng: p.lon }));
  return pts;
};

// relation (multipolygon) から外周の最初のリングのみ採用。
const relationToPolygon = (members) => {
  if (!Array.isArray(members)) return null;
  const outer = members.find(
    (m) => m.type === "way" && (m.role === "outer" || m.role === ""),
  );
  if (!outer || !outer.geometry) return null;
  return wayToPolygon(outer.geometry);
};

// 名前から URL/JSON 安全な ID を作る。重複は -2, -3... を付けて回避。
const seenIds = new Map();
const makeId = (name) => {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9぀-ヿ一-鿿]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  const safe = base || "park";
  const n = (seenIds.get(safe) ?? 0) + 1;
  seenIds.set(safe, n);
  return n === 1 ? safe : `${safe}-${n}`;
};

const fetchMuni = async (muni) => {
  console.log(`==> fetching ${muni.code} ${muni.name} ...`);
  const body = `data=${encodeURIComponent(buildQuery(muni.name))}`;
  // 429 (rate limit) は exponential backoff で 3 回までリトライ
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(OVERPASS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        // Overpass は User-Agent なしを 406 で弾く。連絡先を含めるのが規約推奨。
        "User-Agent": "soraban-regulations-fetcher/0.1 (https://github.com/carta-lab/soraban)",
      },
      body,
    });
    if (res.ok) {
      const json = await res.json();
      return json.elements ?? [];
    }
    // 429 rate-limit と 504 (server busy) はリトライ対象
    if ((res.status === 429 || res.status === 504) && attempt < 3) {
      const wait = (attempt + 1) * 30000;
      console.log(`    ${res.status} retryable, waiting ${wait / 1000}s before retry ${attempt + 1}/3 ...`);
      await sleep(wait);
      continue;
    }
    throw new Error(`Overpass HTTP ${res.status} for ${muni.name}: ${await res.text()}`);
  }
  throw new Error(`Overpass exhausted retries for ${muni.name}`);
};

const fileExists = async (p) => {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
};

const toInternalSchema = (muni, elements) => {
  seenIds.clear();
  const parks = [];
  for (const el of elements) {
    const tags = el.tags ?? {};
    const name = tags.name ?? tags["name:ja"];
    if (!name) continue; // 名前なし公園は除外
    let polygon = null;
    if (el.type === "way") polygon = wayToPolygon(el.geometry);
    else if (el.type === "relation") polygon = relationToPolygon(el.members);
    if (!polygon || polygon.length < 3) continue;
    parks.push({
      id: makeId(name),
      name,
      polygon,
    });
  }
  return {
    muniCode: muni.code,
    muniName: muni.name,
    prefCode: muni.prefCode,
    source: "OpenStreetMap (Overpass API) — © OpenStreetMap contributors, ODbL",
    verifiedAt: new Date().toISOString(),
    parks,
  };
};

const main = async () => {
  await mkdir(OUT_DIR, { recursive: true });
  const arg = process.argv[2];
  const targets = arg ? MUNIS.filter((m) => m.code === arg) : MUNIS;
  if (targets.length === 0) {
    console.error(`unknown muni code: ${arg}`);
    process.exit(1);
  }
  const force = process.argv.includes("--force");
  let i = 0;
  for (const muni of targets) {
    const file = path.join(OUT_DIR, `${muni.code}.json`);
    if (!force && (await fileExists(file))) {
      console.log(`==> skip ${muni.code} ${muni.name} (already fetched, use --force to refetch)`);
      continue;
    }
    if (i > 0) await sleep(5000); // 連続リクエストの間隔を 5 秒に延長して rate-limit 回避
    const elements = await fetchMuni(muni);
    const data = toInternalSchema(muni, elements);
    await writeFile(file, JSON.stringify(data, null, 2) + "\n");
    console.log(`    -> ${data.parks.length} parks written to ${path.relative(PKG_DIR, file)}`);
    i++;
  }
  console.log("==> done.");
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
