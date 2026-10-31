// Sprint 15 契約 A-1・A-3（単体）：マニフェストの項目、Service Worker のキャッシュの許可リストと、圏外の行き先の枠。
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEVICE_STORAGE_NOTES, OFFLINE_SHELLS, isCacheableStatic, isNeverCache, pwaManifest, serviceWorkerSource, shellForPath, staticAssetsIn } from "./pwa";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** PNG の幅・高さ（IHDR）。 */
const pngSize = (file: string): [number, number] => {
  const b = readFileSync(file);
  expect(b.subarray(1, 4).toString("ascii")).toBe("PNG");
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
};

describe("A-1 マニフェスト", () => {
  it("名称・アイコン（192・512）・display・開始 URL（/ops）・theme_color が揃う。scope は /ops（公開の / を含めない）", () => {
    const m = pwaManifest();
    expect(m.name).toContain("そらばん");
    expect(m.short_name.length).toBeGreaterThan(0);
    expect(m.display).toBe("standalone");
    expect(m.start_url).toBe("/ops");
    expect(m.scope).toBe("/ops");
    expect(m.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(m.icons.map((i) => i.sizes)).toEqual(expect.arrayContaining(["192x192", "512x512"]));
  });
  it("アイコンの PNG は public/pwa にあり、寸法が名前どおり。既存のロゴ（app/icon.svg）から作る手順がある", () => {
    for (const i of pwaManifest().icons.filter((x) => x.type === "image/png")) {
      const [w, h] = pngSize(path.join(WEB, "public", i.src));
      expect(`${w}x${h}`).toBe(i.sizes);
    }
    // ロゴの SVG もマニフェストに入れ、PNG は scripts/gen-pwa-icons.mjs が app/icon.svg から描く
    expect(pwaManifest().icons.some((i) => i.src === "/icon.svg")).toBe(true);
    const script = readFileSync(path.join(WEB, "..", "..", "scripts", "gen-pwa-icons.mjs"), "utf8");
    expect(script).toContain("apps/web/src/app/icon.svg");
  });
});

describe("A-3 キャッシュは許可リストだけ", () => {
  it("/api/**・/api/auth・/ops/sign-in はキャッシュしない。静的ファイルだけを入れる", () => {
    for (const p of ["/api/ops/field-bundle", "/api/auth/get-session", "/api/ops/plans/x/field", "/ops/sign-in", "/ops/sw.js"]) expect(isNeverCache(p), p).toBe(true);
    for (const p of ["/_next/static/chunks/a.js", "/fonts/x.woff2", "/pwa/icon-192.png", "/icon.svg"]) expect(isCacheableStatic(p), p).toBe(true);
    for (const p of ["/ops", "/ops/plans/abc/field", "/api/ops/today", "/", "/ops/sign-in"]) expect(isCacheableStatic(p), p).toBe(false);
  });
  it("圏外の行き先の枠：現場・点検・日誌・今日。それ以外（計画の作成・通報・登録）は圏外の案内", () => {
    const id = "22222222-2222-4222-8222-222222222222";
    expect(shellForPath(`/ops/plans/${id}/field`)).toBe("field");
    expect(shellForPath("/ops/inspections/new")).toBe("inspection");
    expect(shellForPath("/ops/flights/new")).toBe("journal");
    expect(shellForPath("/ops")).toBe("today");
    for (const p of ["/ops/plans/new", `/ops/plans/${id}/report`, "/ops/permits", "/ops/aircraft/new", `/ops/plans/${id}/field/incident`]) expect(shellForPath(p), p).toBe("unavailable");
    expect(Object.values(OFFLINE_SHELLS).every((u) => u.startsWith("/ops/offline/"))).toBe(true);
  });
  it("Service Worker の本体に同じ規則が入り、skipWaiting は利用者の操作（SKIP_WAITING）のときだけ。背景同期を使わない", () => {
    const src = serviceWorkerSource({ version: "v1", shells: OFFLINE_SHELLS, cachePrefix: "soraban-ops-" });
    expect(src).toContain('credentials: "omit"');
    expect(src).toContain("/^\\/api\\//");
    expect(src).toContain("sign-in");
    expect(src.match(/skipWaiting\(\)/g)).toHaveLength(1);
    expect(src).toContain("SKIP_WAITING");
    expect(src).not.toMatch(/addEventListener\("(?:sync|periodicsync)"|SyncManager|\.sync\./);
    // 構文として読める
    expect(() => new Function(src)).not.toThrow();
  });
  it("HTML から静的ファイルを拾う", () => {
    expect(staticAssetsIn('<script src="/_next/static/chunks/abc-123.js" async></script><link href="/_next/static/chunks/x.css">"static/chunks/y.js"')).toEqual([
      "/_next/static/chunks/abc-123.js",
      "/_next/static/chunks/x.css",
    ]);
  });
});

describe("F-3 端末に保存する内容の説明", () => {
  it("先読み・送信待ち・下書き・キャッシュと、消えるタイミングを書く。消去の条件は要再確認と書く", () => {
    const t = DEVICE_STORAGE_NOTES.join("");
    for (const w of ["先読み", "送信待ち", "下書き", "キャッシュ", "ログアウト", "※要再確認"]) expect(t).toContain(w);
    expect(t).not.toMatch(/代行|代理|通報不要/);
  });
});
