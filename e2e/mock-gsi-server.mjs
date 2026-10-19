// E2E 用の国土地理院 逆ジオコーダの模擬サーバー（Sprint 9）。
//
// 本番の逆ジオコーダ（https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress）と同じ形
// （{"results":{"muniCd":"31202","lv01Nm":"…"}}）で、E2E が使う地点の市町村コードを返す。
// 外部サービスの応答に E2E の結果が左右されないようにするためのもの（page.route はサーバー側の fetch を横取りできない）。
// 市町村は下の参照点のうち最も近いもの（30km 以内）で決める。参照点はプリセット・E2E の地点と市役所等で、
// 境界の判定はしない（境界付近の地点を E2E で使うときは参照点を足す）。
//
//   node e2e/mock-gsi-server.mjs [port]   （既定 3199。GET /health で 200）
import http from "node:http";

const PORT = Number(process.argv[2] ?? process.env.MOCK_GSI_PORT ?? 3199);

// [緯度, 経度, 市町村コード, 町字名（表示用の目安）]
const REFS = [
  [35.434238, 133.380508, "31386", "日吉津"], // 日吉津村（条例未収録の地点の試験用）
  [35.4278, 133.3314, "31202", "加茂町"], // 米子市役所
  [35.4267, 133.322, "31202", "久米町"], // 湊山公園
  [35.4538, 133.3333, "31202", "皆生温泉"], // 皆生温泉
  [35.4495, 133.343, "31202", "西町"], // 鳥取大学医学部附属病院
  [35.44, 133.35, "31202", "皆生"], // E2E の現在地（米子市内）
  [35.5447, 133.2269, "31204", "大正町"], // 境港駅
  [35.5455, 133.2235, "31204", "竹内町"], // 夢みなと公園
  [35.541296, 133.250208, "31204", "昭和町"], // 境港市の工業専用地域内
  [35.5447, 133.237953, "31204", "京町"], // 境港市の DID 内
  [35.4925, 133.2364, "31204", "佐斐神町"], // 米子鬼太郎空港（境港市）
  [35.4936, 133.2361, "31204", "小篠津町"], // 美保基地（境港市）
  [35.4936, 133.26604, "31204", "小篠津町"], // 美保基地の周辺（境港市。地点の例）
  [35.504, 134.244, "31201", "東町"], // 鳥取城跡
  [35.474926, 134.222963, "31201", "古海"], // 鳥取市の工業専用地域内（地点の例）
  [35.425, 133.8235, "31203", "仲ノ町"], // 打吹公園（倉吉市）
  [35.4753, 133.0506, "32201", "殿町"], // 松江城
  [35.4019, 132.6852, "32203", "大社町杵築東"], // 出雲大社（出雲市）
  [35.387, 132.844, "32203", "斐川町神庭"], // 荒神谷史跡公園（出雲市）
  [35.3683, 132.7567, "32203", "今市町"], // 出雲市役所
  [35.4133, 132.8897, "32203", "斐川町沖洲"], // 出雲縁結び空港（出雲市）
];

const M_PER_DEG = (6371008.8 * Math.PI) / 180;
const distM = (lat1, lng1, lat2, lng2) => {
  const x = (lng2 - lng1) * Math.cos(((lat1 + lat2) / 2) * (Math.PI / 180));
  return Math.hypot(lat2 - lat1, x) * M_PER_DEG;
};

const lookup = (lat, lng) => {
  let best = null;
  for (const r of REFS) {
    const d = distM(lat, lng, r[0], r[1]);
    if (!best || d < best.d) best = { d, r };
  }
  return best && best.d <= 30_000 ? best.r : null;
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
  if (url.pathname === "/health") {
    res.writeHead(200, { "content-type": "text/plain" }).end("ok");
    return;
  }
  if (url.pathname.endsWith("/LonLatToAddress")) {
    const lat = Number(url.searchParams.get("lat"));
    const lng = Number(url.searchParams.get("lon"));
    const hit = Number.isFinite(lat) && Number.isFinite(lng) ? lookup(lat, lng) : null;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(hit ? { results: { muniCd: hit[2], lv01Nm: hit[3] } } : {}));
    return;
  }
  res.writeHead(404).end();
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`mock GSI reverse geocoder on http://127.0.0.1:${PORT}`);
});
