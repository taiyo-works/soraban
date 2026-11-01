// 運航管理の PWA（Sprint 15 設計 5・10）の定数と、Service Worker の本体を作る純粋な関数。
// Service Worker は /ops/sw.js（ルートハンドラ）が配る。scope は /ops（/ops と /ops/… だけ。公開の判定画面 / には効かない）。
//
// キャッシュの規則（許可リスト方式。契約 A-3）：
//   - 圏外用の画面の枠（/ops/offline/*）：利用者のデータを含まない。Service Worker が Cookie なし（credentials: "omit"）で取得して入れる。
//     ここで現場の画面・点検・日誌・今日・圏外の案内を、端末の先読みの束（IndexedDB）と送信待ち（localStorage）から描く。
//   - 静的ファイル（/_next/static/*・/fonts/*・/pwa/*・/icon.svg・/favicon.ico）。
//   - 入れないもの：/api/** の応答、/api/auth・/ops/sign-in、利用者のデータを含む画面（/ops/plans/… などの本体の HTML）。
// 画面の移動（navigate）は、まず通信で取りに行き、通信できないときだけ、行き先に応じた圏外用の枠を返す。
// 新しい版（ビルド）を配ったとき：新しい Service Worker は待機し、入力中の画面を勝手に再読み込みしない。利用者が「更新する」を
// 押したとき（SKIP_WAITING）か、すべての画面を閉じて次に開いたときに切り替わる（契約 A-4）。背景同期（Background Sync）は使わない。

import { PROVIDER } from "./provider-info";

export const SW_URL = "/ops/sw.js";
export const SW_SCOPE = "/ops";
export const SW_CACHE_PREFIX = "soraban-ops-";
export const MANIFEST_URL = "/ops/manifest.webmanifest";

/** 圏外用の画面の枠。 */
export const OFFLINE_SHELLS = {
  field: "/ops/offline/field",
  inspection: "/ops/offline/inspection",
  journal: "/ops/offline/journal",
  today: "/ops/offline/today",
  unavailable: "/ops/offline/unavailable",
} as const;
export type OfflineShell = keyof typeof OFFLINE_SHELLS;

/** 行き先の経路 → 圏外のときに返す枠（Service Worker の本体と同じ規則。単体テストで固定する）。 */
export const SHELL_ROUTES: readonly (readonly [RegExp, OfflineShell])[] = [
  [/^\/ops\/plans\/[0-9a-fA-F-]{36}\/field\/?$/, "field"],
  [/^\/ops\/inspections\/new\/?$/, "inspection"],
  [/^\/ops\/flights\/new\/?$/, "journal"],
  [/^\/ops\/?$/, "today"],
];

export const shellForPath = (pathname: string): OfflineShell => {
  for (const [re, shell] of SHELL_ROUTES) if (re.test(pathname)) return shell;
  return "unavailable";
};

/** キャッシュしてよい静的ファイルか（許可リスト）。 */
export const STATIC_ROUTES: readonly RegExp[] = [/^\/_next\/static\//, /^\/fonts\//, /^\/pwa\//, /^\/icon\.svg$/, /^\/favicon\.ico$/];
export const isCacheableStatic = (pathname: string): boolean => STATIC_ROUTES.some((re) => re.test(pathname));

/** 決してキャッシュしない経路（Service Worker が手を出さない）。 */
export const NEVER_CACHE: readonly RegExp[] = [/^\/api\//, /^\/ops\/sign-in(\/|$)/, /^\/ops\/sw\.js$/];
export const isNeverCache = (pathname: string): boolean => NEVER_CACHE.some((re) => re.test(pathname));

/** HTML・CSS から、キャッシュに入れる静的ファイルの経路を拾う（Service Worker の本体と同じ規則）。 */
export const staticAssetsIn = (text: string): string[] => {
  const out = new Set<string>();
  for (const m of text.matchAll(/\/_next\/static\/[A-Za-z0-9_\-./~%]+?\.(?:js|css|woff2?)/g)) out.add(m[0]);
  return [...out];
};

/** Service Worker の本体（ブラウザで動く JavaScript）。規則は上の定数と同じものを埋め込む。 */
export const serviceWorkerSource = (o: { readonly version: string; readonly shells: Readonly<Record<string, string>>; readonly cachePrefix: string }): string => {
  const routes = SHELL_ROUTES.map(([re, shell]) => `[${re.toString()}, ${JSON.stringify(shell)}]`).join(", ");
  const statics = STATIC_ROUTES.map((re) => re.toString()).join(", ");
  const never = NEVER_CACHE.map((re) => re.toString()).join(", ");
  return `// そらばん 運航管理の Service Worker（Sprint 15）。版：${o.version}
"use strict";
const VERSION = ${JSON.stringify(o.version)};
const CACHE = ${JSON.stringify(o.cachePrefix)} + VERSION;
const SHELLS = ${JSON.stringify(o.shells)};
const SHELL_ROUTES = [${routes}];
const STATIC_ROUTES = [${statics}];
const NEVER_CACHE = [${never}];
const shellFor = (p) => { for (const [re, s] of SHELL_ROUTES) if (re.test(p)) return s; return "unavailable"; };
const isStatic = (p) => STATIC_ROUTES.some((re) => re.test(p));
const isNever = (p) => NEVER_CACHE.some((re) => re.test(p));
const assetsIn = (text) => { const out = new Set(); for (const m of text.matchAll(/\\/_next\\/static\\/[A-Za-z0-9_\\-./~%]+?\\.(?:js|css|woff2?)/g)) out.add(m[0]); return [...out]; };

// 利用者のデータを含まない枠を、Cookie なしで取得してキャッシュに入れる。枠が要る静的ファイル（JS・CSS）も入れる。
const precache = async () => {
  const cache = await caches.open(CACHE);
  const assets = new Set();
  for (const url of Object.values(SHELLS)) {
    try {
      const res = await fetch(url, { credentials: "omit", cache: "no-store", redirect: "error" });
      if (!res.ok) continue;
      const text = await res.clone().text();
      await cache.put(url, res);
      for (const a of assetsIn(text)) assets.add(a);
    } catch (e) {
      // 1 つ取れなくても、ほかは入れる（次の版で取り直す）
    }
  }
  for (const a of assets) {
    try {
      if (await cache.match(a)) continue;
      const res = await fetch(a, { credentials: "omit" });
      if (res.ok) await cache.put(a, res);
    } catch (e) {}
  }
};

self.addEventListener("install", (event) => {
  // 待機する（入力中の画面を勝手に新しい版に切り替えない）。skipWaiting は利用者の操作（SKIP_WAITING）のときだけ
  event.waitUntil(precache());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith(${JSON.stringify(o.cachePrefix)}) && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (isNever(url.pathname)) return;
  if (req.mode === "navigate") {
    event.respondWith((async () => {
      try {
        return await fetch(req);
      } catch (e) {
        const cache = await caches.open(CACHE);
        const shell = SHELLS[shellFor(url.pathname)];
        const hit = (await cache.match(shell)) || (await cache.match(SHELLS.unavailable));
        if (hit) return hit;
        return new Response("<!doctype html><meta charset=utf-8><title>接続なし</title><p>接続なし（圏外）です。電波のある場所で開き直してください。</p>", { status: 503, headers: { "content-type": "text/html; charset=utf-8" } });
      }
    })());
    return;
  }
  if (isStatic(url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(req, { ignoreSearch: false });
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok && res.type === "basic") await cache.put(req, res.clone());
      return res;
    })());
  }
  // それ以外（RSC の取得・マニフェストなど）は通信のまま。キャッシュに入れない
});
`;
};

/** テーマの色（ロゴの藍。icon.svg の背景と同じ）。 */
export const PWA_THEME_COLOR = "#1d3557";
export const PWA_BACKGROUND_COLOR = "#f5f2ea";

/**
 * Web アプリマニフェスト（契約 A-1）。開始 URL は /ops（ホームの「今日」）、scope は /ops（公開の判定画面 / は含めない）。
 * アイコンは既存のロゴ（app/icon.svg）から scripts/gen-pwa-icons.mjs で作った PNG（192・512・maskable 512）と、元の SVG。
 */
export const pwaManifest = () => ({
  id: "/ops",
  name: "そらばん 運航管理",
  short_name: "そらばん",
  // Sprint 18-3 §5.4（§12.3 で変更）：圏外で使えるのは点検と飛行日誌（OFFLINE_SHELLS）。通報の作業台は圏外では使えないので、
  // 「通報の記録をまとめる」と「点検と日誌は圏外でも記録できる」を分けて書く。提供元の名称は lib/provider-info.ts の定数から。
  description: `ドローンの飛行計画の通報の記録、飛行前・飛行後の点検、飛行日誌をまとめます。点検と飛行日誌は、電波の弱い現場でも記録できます。提供元：${PROVIDER.name}`,
  lang: "ja",
  start_url: "/ops",
  scope: "/ops",
  display: "standalone" as const,
  orientation: "portrait" as const,
  background_color: PWA_BACKGROUND_COLOR,
  theme_color: PWA_THEME_COLOR,
  icons: [
    { src: "/pwa/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "/pwa/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    { src: "/pwa/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
  ],
});

/** 端末に保存するものと消えるタイミング（契約 F-3。現場画面の「端末に保存されている内容」）。 */
export const DEVICE_STORAGE_NOTES: readonly string[] = [
  "先読み（IndexedDB）：今日と明日の、あなたが操縦者の計画の要約（日時・場所名・機体・操縦者・特定飛行の形態）、書類・手続きの判定に使う登録内容の要約（許可の番号・期間、通報の受付番号・日時、機体の登録記号、技能証明の有効期限）、現場の記録、直近の点検の結果。技能証明書の番号・座標・備考などの自由記述は入れません。ログアウト・別の人のログインで消えます。",
  "送信待ち（この端末のブラウザの保存領域）：まだ送れていない確認・離陸・着陸・点検・日誌。点検の「異常」の備考と、日誌の「安全に影響のあった事項」の内容だけは、送るまで残ります。送れたとき・破棄したときに消えます。72 時間を過ぎると送れません。",
  "入力中の下書き：保存したとき・ログアウトしたときに消えます。",
  "画面の枠と表示用のファイル（Service Worker のキャッシュ）：利用者のデータは入りません。",
  "端末の設定やブラウザの都合で保存が消えることがあります（※要再確認：ホーム画面に追加していない場合や長く開かなかった場合など）。電波のある場所で、送信待ちが 0 件になってから帰ってください。",
];
