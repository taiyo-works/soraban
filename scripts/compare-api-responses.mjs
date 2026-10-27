// 判定の応答が、2 つのビルド（main と作業ブランチ）で完全に一致するかを確かめる（Sprint 12h PR ② の Q-3）。
// 使い方: node scripts/compare-api-responses.mjs http://127.0.0.1:3300 http://127.0.0.1:3301
// 入力は、画面の「地点の例」16 地点（既存 E2E が使う地点を含む）・各段階の地点・許可と条件を変えた入力。
// /api/check と /api/diagnose の応答を JSON 全体で比べる。時刻（checkedAt）と、それから採番される evidenceId（同じサーバーへの連続呼び出しでも毎回変わる）だけ除く。engineVersion は含める。
// 終了コード 0=すべて一致、1=不一致あり。外部サービスには触れない（2 台とも同じ模擬の逆ジオコーダ）。

const [a, b] = process.argv.slice(2);
if (!a || !b) {
  console.error("使い方: node scripts/compare-api-responses.mjs <baseA> <baseB>");
  process.exit(2);
}

const LOCS = [
  ["米子市役所", 35.4283, 133.3306],
  ["米子市役所（例の座標）", 35.4278, 133.3314],
  ["美保基地の周辺", 35.4936, 133.26604],
  ["鳥取市の工業専用地域", 35.474926, 134.222963],
  ["湊山公園", 35.4267, 133.322],
  ["皆生温泉", 35.4538, 133.3333],
  ["鳥取大学医学部附属病院", 35.4495, 133.343],
  ["境港駅", 35.5447, 133.2269],
  ["米子鬼太郎空港", 35.4925, 133.2364],
  ["夢みなと公園", 35.5455, 133.2235],
  ["鳥取城跡", 35.504, 134.244],
  ["打吹公園", 35.425, 133.8235],
  ["松江城", 35.4753, 133.0506],
  ["出雲大社", 35.4019, 132.6852],
  ["荒神谷史跡公園", 35.387, 132.844],
  ["出雲市役所", 35.3683, 132.7567],
  ["出雲縁結び空港", 35.4133, 132.8897],
  ["現在地の例（小数 6 桁）", 35.440012, 133.350046],
  ["山間（手続き不要になりやすい地点）", 35.3958, 133.3721],
  ["海上", 35.6, 133.0],
  ["範囲外（山口県）", 34.2, 131.4],
];

const CTXS = [
  ["許可なし", undefined, {}],
  ["100g 未満", { droneWeightG: 80 }, { droneWeightG: 80 }],
  ["900g", { droneWeightG: 900 }, { droneWeightG: 900 }],
  ["DIPS：DID の許可あり", { pilotPermits: ["mlit:did"], droneWeightG: 900 }, { pilotPermits: ["mlit:did"], droneWeightG: 900 }],
  ["公園管理者・施設管理者の同意・通報あり", { pilotPermits: ["park_manager", "facility_manager", "pref_pubsafety_notice", "bunkacho_or_kyoiku"], droneWeightG: 900 }, { pilotPermits: ["park_manager", "facility_manager", "pref_pubsafety_notice", "bunkacho_or_kyoiku"], droneWeightG: 900 }],
  ["緊急", { purpose: "emergency", droneWeightG: 900 }, { purpose: "emergency", droneWeightG: 900 }],
];

const FLAG_SETS = [
  ["飛行方法なし", []],
  ["夜間・目視外", ["method_night", "method_bvlos"]],
  ["DID 手動＋30m 未満", ["airspace_did", "method_30m"]],
];

const post = async (base, path, body) => {
  const res = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { _raw: text.slice(0, 200) };
  }
  return { status: res.status, json };
};

// checkedAt はリクエストごとの時刻。入れ子の中も除く
const strip = (v) => {
  if (Array.isArray(v)) return v.map(strip);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).filter(([k]) => k !== "checkedAt" && k !== "evidenceId" && k !== "checkEvidenceId").map(([k, x]) => [k, strip(x)]));
  return v;
};

let total = 0;
let mismatches = 0;
const levels = new Set();
const mismatchLog = [];

for (const [name, lat, lng] of LOCS) {
  for (const [cname, ctx, extra] of CTXS) {
    // 地点判定（/api/check）
    const [ra, rb] = await Promise.all([post(a, "/api/check", { lat, lng, ctx }), post(b, "/api/check", { lat, lng, ctx })]);
    total++;
    if (JSON.stringify(strip(ra)) !== JSON.stringify(strip(rb))) {
      mismatches++;
      mismatchLog.push(`check ${name} / ${cname}`);
    }
    for (const [fname, flags] of FLAG_SETS) {
      // 申請支援の診断（/api/diagnose）
      const body = { lat, lng, flags, ...extra };
      const [da, db] = await Promise.all([post(a, "/api/diagnose", body), post(b, "/api/diagnose", body)]);
      total++;
      if (da.json?.verdict?.level) levels.add(da.json.verdict.level);
      if (JSON.stringify(strip(da)) !== JSON.stringify(strip(db))) {
        mismatches++;
        mismatchLog.push(`diagnose ${name} / ${cname} / ${fname}`);
      }
    }
  }
}
console.log(`比べた応答: ${total} 組（/api/check と /api/diagnose）。不一致: ${mismatches}。出た判定の段: ${[...levels].sort().join(", ")}`);
if (mismatches) {
  console.log(mismatchLog.slice(0, 20).join("\n"));
  process.exit(1);
}
