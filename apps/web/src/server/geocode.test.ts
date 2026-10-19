import { describe, expect, it, vi } from "vitest";
import type { GeocodeHit } from "@soraban/regulations";
import { geocode, needsGsi, searchGsi } from "./geocode";

// Sprint 9 契約 3：国土地理院への fetch を失敗させても、同梱索引の結果が返る。
// 同梱索引で街区以上の一致がある入力では国土地理院を呼ばない。

const hit = (level: GeocodeHit["level"]): GeocodeHit => ({
  source: "abr",
  level,
  title: `テスト ${level}`,
  lat: 35.43,
  lng: 133.33,
});

const gsiOk = () =>
  vi.fn(async () =>
    Response.json([
      { geometry: { coordinates: [133.4, 35.5] }, properties: { title: "鳥取県米子市テスト" } },
    ]),
  );

describe("/api/geocode の検索順序（geocode）", () => {
  it("国土地理院の fetch が失敗しても同梱索引の結果を返す", async () => {
    const fetch = vi.fn(async () => {
      throw new Error("network down");
    });
    const out = await geocode("米子市加茂町", {
      fetch: fetch as unknown as typeof globalThis.fetch,
      searchBundled: () => [hit("machiaza")],
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(out.results).toEqual([hit("machiaza")]);
    expect(out.gsiError).toBe(true);
  });

  it("国土地理院が成功して 0 件なら gsiError を付けない（該当なしと接続失敗を区別する）", async () => {
    const fetch = vi.fn(async () => Response.json([]));
    const out = await geocode("x", { fetch: fetch as unknown as typeof globalThis.fetch, searchBundled: () => [] });
    expect(out).toEqual({ results: [] });
    const failed = await geocode("x", {
      fetch: vi.fn(async () => new Response("x", { status: 503 })) as unknown as typeof globalThis.fetch,
      searchBundled: () => [],
    });
    expect(failed).toEqual({ results: [], gsiError: true });
  });

  it("国土地理院が 500 を返しても同梱索引の結果を返す", async () => {
    const fetch = vi.fn(async () => new Response("x", { status: 500 }));
    const out = await geocode("x", {
      fetch: fetch as unknown as typeof globalThis.fetch,
      searchBundled: () => [hit("city")],
    });
    expect(out.results).toEqual([hit("city")]);
  });

  it.each(["block", "residence", "parcel"] as const)(
    "同梱索引で %s まで一致したら国土地理院を呼ばない",
    async (level) => {
      const fetch = gsiOk();
      const out = await geocode("x", {
        fetch: fetch as unknown as typeof globalThis.fetch,
        searchBundled: () => [hit(level)],
      });
      expect(fetch).not.toHaveBeenCalled();
      expect(out.results).toEqual([hit(level)]);
    },
  );

  it("町字止まり・一致なしのときは国土地理院を呼び、同梱索引の結果を先に並べる", async () => {
    const fetch = gsiOk();
    const out = await geocode("x", {
      fetch: fetch as unknown as typeof globalThis.fetch,
      searchBundled: () => [hit("machiaza")],
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(out.results.map((r) => r.source)).toEqual(["abr", "gsi"]);
    expect(out.results[1]).toMatchObject({ level: "unknown", title: "鳥取県米子市テスト", lat: 35.5, lng: 133.4 });

    const none = await geocode("x", {
      fetch: gsiOk() as unknown as typeof globalThis.fetch,
      searchBundled: () => [],
    });
    expect(none.results.map((r) => r.source)).toEqual(["gsi"]);
  });

  it("国土地理院が 3 秒で応答しなければ打ち切り、同梱索引の結果を返す（全体 4 秒以内）", async () => {
    const fetch = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    const t0 = Date.now();
    const out = await geocode("x", {
      fetch: fetch as unknown as typeof globalThis.fetch,
      gsiTimeoutMs: 300,
      searchBundled: () => [hit("machiaza")],
    });
    expect(Date.now() - t0).toBeLessThan(4000);
    expect(out.results).toEqual([hit("machiaza")]);
  });

  it("needsGsi：街区以上があれば false", () => {
    expect(needsGsi([])).toBe(true);
    expect(needsGsi([hit("machiaza")])).toBe(true);
    expect(needsGsi([hit("block")])).toBe(false);
  });

  it("searchGsi は差し替えた呼び出し先に q を付けて呼ぶ", async () => {
    const fetch = gsiOk();
    await searchGsi("米子 市", { fetch: fetch as unknown as typeof globalThis.fetch, gsiEndpoint: "https://example.test/s" });
    expect((fetch.mock.calls[0] as unknown as [string])[0]).toBe(
      "https://example.test/s?q=%E7%B1%B3%E5%AD%90%20%E5%B8%82",
    );
  });
});
