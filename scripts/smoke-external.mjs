// 外部サービス（国土地理院の逆ジオコーダ・住所検索）との疎通確認（Sprint 9）。
// E2E は模擬サーバー（e2e/mock-gsi-server.mjs）を使うため、実サービスの形が変わっていないかはここで確かめる。
// CI では continue-on-error のジョブで実行し、失敗しても CI 全体は止めない。
//
//   node scripts/smoke-external.mjs
const checks = [
  {
    name: "国土地理院 逆ジオコーダ（米子市役所 → muniCd 31202）",
    url: "https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress?lon=133.3314&lat=35.4278",
    ok: (j) => j?.results?.muniCd === "31202",
  },
  {
    name: "国土地理院 住所検索（鳥取県米子市加茂町 → 1 件以上）",
    url: `https://msearch.gsi.go.jp/address-search/AddressSearch?q=${encodeURIComponent("鳥取県米子市加茂町")}`,
    ok: (j) => Array.isArray(j) && j.length > 0 && Array.isArray(j[0]?.geometry?.coordinates),
  },
];

let failed = 0;
for (const c of checks) {
  try {
    const res = await fetch(c.url, { signal: AbortSignal.timeout(10_000) });
    const json = await res.json().catch(() => null);
    if (res.ok && c.ok(json)) console.log(`OK   ${c.name}`);
    else {
      failed++;
      console.log(`FAIL ${c.name}：HTTP ${res.status} ${JSON.stringify(json).slice(0, 300)}`);
    }
  } catch (e) {
    failed++;
    console.log(`FAIL ${c.name}：${e?.message ?? e}`);
  }
}
process.exit(failed > 0 ? 1 : 0);
