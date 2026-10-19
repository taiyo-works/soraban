import { afterEach, describe, expect, it, vi } from "vitest";
// Sprint 9 契約 15：同じ座標について、住所検索・現在地・長押し・座標入力のどれで指定しても証跡 ID の計算入力が同じ。
//
// 画面はどの方法でも goToLocation(loc) を呼び、/api/check・/api/diagnose には緯度経度（と機体条件）だけを送る。
// ここでは各方法から得た loc で、ブラウザが送る要求本文と、サーバーが計算する証跡 ID が一致することを確かめる。
import { parseCombinedLatLng, type LatLng } from "@soraban/geo";
import { createIndustrialSource, type GeocodeHit, type RegulationCheckResult } from "@soraban/regulations";
import { checkLocation } from "@/lib/check";
import { candidateToLocation } from "@/lib/current-location";
import { runRegulationCheckWith, type RegulationDataProvider } from "./check-core";
import { handleCheckPost } from "./handlers";

const P = { lat: 35.434238, lng: 133.380508 };

const provider: RegulationDataProvider = {
  loadDid: async () => null,
  didPrefCodes: async () => [],
  industrial: createIndustrialSource({ coverage: [], zonesByMuni: {}, insideMarginM: 10 }),
  reverseGeocode: async () => ({ muniCode: "31386" }),
};

const locByMethod = (): Record<string, LatLng> => {
  const geocodeHit: GeocodeHit = { source: "abr", level: "machiaza", title: "x", lat: P.lat, lng: P.lng };
  const parsed = parseCombinedLatLng(`${P.lat}, ${P.lng}`)!;
  return {
    geocode: { lat: geocodeHit.lat, lng: geocodeHit.lng },
    // 端末の位置は小数 7 桁以上・精度付きで得られるが、判定には小数 6 桁の緯度経度だけを渡す
    currentLocation: candidateToLocation({ lat: 35.4342381, lng: 133.3805079, accuracyM: 23 }),
    longPress: { lat: P.lat, lng: P.lng },
    contextMenu: { lat: P.lat, lng: P.lng },
    coordinateInput: parsed,
  };
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("指定方法によらず証跡 ID の計算入力が同じ", () => {
  it("ブラウザが送る要求本文は緯度経度と機体条件だけで、方法によらず同一", async () => {
    const bodies: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        bodies.push(String(init?.body));
        return Response.json({});
      }),
    );
    for (const loc of Object.values(locByMethod())) await checkLocation(loc, undefined);
    expect(new Set(bodies).size).toBe(1);
    expect(Object.keys(JSON.parse(bodies[0]!) as object).sort()).toEqual(["lat", "lng"]);
  });

  it("サーバーが計算する証跡 ID が方法によらず同一", async () => {
    const ids = new Set<string>();
    for (const loc of Object.values(locByMethod())) {
      const res = await handleCheckPost(
        new Request("http://localhost/api/check", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ lat: loc.lat, lng: loc.lng }),
        }),
        // 判定時刻は証跡 ID の入力だが指定方法とは無関係なので固定する
        (l, ctx) => runRegulationCheckWith(provider, l, ctx, () => new Date("2026-10-19T00:00:00Z")),
      );
      ids.add(((await res.json()) as RegulationCheckResult).evidenceId);
    }
    expect(ids.size).toBe(1);
  });
});
