import { describe, expect, it, vi } from "vitest";
import {
  GEO_PERMISSION_DENIED,
  GEO_POSITION_UNAVAILABLE,
  GEO_TIMEOUT,
  GEOLOCATION_OPTIONS,
  formatAccuracy,
  geolocationAvailability,
  geolocationErrorMessage,
  isLowAccuracy,
  LOW_ACCURACY_MESSAGE,
  requestCurrentLocation,
} from "./current-location";

// Sprint 9 契約 9：POSITION_UNAVAILABLE・TIMEOUT のそれぞれで所定の文言になり、自動で再試行しない。
// 精度 150m で低精度の表示になる。watchPosition を呼ばず、ボタンを押す前に getCurrentPosition を呼ばない。

type Geo = Pick<Geolocation, "getCurrentPosition" | "watchPosition" | "clearWatch">;

const failingGeo = (code: number) => {
  const geo = {
    getCurrentPosition: vi.fn((_ok: PositionCallback, err?: PositionErrorCallback | null) => {
      err?.({ code, message: "x", PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 } as GeolocationPositionError);
    }),
    watchPosition: vi.fn(() => 0),
    clearWatch: vi.fn(),
  };
  return geo as typeof geo & Geo;
};

describe("現在地の取得（requestCurrentLocation）", () => {
  it("POSITION_UNAVAILABLE は取得できない旨と案内の文言になり、1 回しか呼ばない（再試行しない）", async () => {
    const geo = failingGeo(GEO_POSITION_UNAVAILABLE);
    const out = await requestCurrentLocation(geo);
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.message).toBe(geolocationErrorMessage(GEO_POSITION_UNAVAILABLE));
      expect(out.message).toContain("取得できませんでした");
      expect(out.message).toContain("住所検索・地図の長押し");
    }
    await new Promise((r) => setTimeout(r, 50));
    expect(geo.getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(geo.watchPosition).not.toHaveBeenCalled();
  });

  it("TIMEOUT は時間切れの文言になり、再試行しない", async () => {
    const geo = failingGeo(GEO_TIMEOUT);
    const out = await requestCurrentLocation(geo);
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.message).toContain("時間切れ");
      expect(out.message).toContain("住所検索・地図の長押し");
    }
    await new Promise((r) => setTimeout(r, 50));
    expect(geo.getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(geo.watchPosition).not.toHaveBeenCalled();
  });

  it("PERMISSION_DENIED は許可されていない旨の文言", () => {
    expect(geolocationErrorMessage(GEO_PERMISSION_DENIED)).toBe(
      "位置情報の利用が許可されていません。ブラウザの設定で許可するか、住所検索・地図の長押しで指定してください",
    );
  });

  it("高精度・タイムアウト 10 秒・キャッシュ不使用で 1 回だけ呼ぶ", async () => {
    const getCurrentPosition = vi.fn((...args: Parameters<Geolocation["getCurrentPosition"]>) =>
      args[0]({ coords: { latitude: 35.5, longitude: 133.3, accuracy: 150 } } as GeolocationPosition),
    );
    const watchPosition = vi.fn();
    const out = await requestCurrentLocation({ getCurrentPosition });
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(getCurrentPosition.mock.calls[0]?.[2]).toEqual({ enableHighAccuracy: true, timeout: 10000, maximumAge: 0 });
    expect(GEOLOCATION_OPTIONS.maximumAge).toBe(0);
    expect(watchPosition).not.toHaveBeenCalled();
    expect(out).toEqual({ ok: true, candidate: { lat: 35.5, lng: 133.3, accuracyM: 150 } });
  });

  it("精度 150m は低精度、80m は低精度でない。表示は「現在地（精度 約 N m）」", () => {
    expect(isLowAccuracy(150)).toBe(true);
    expect(isLowAccuracy(80)).toBe(false);
    expect(LOW_ACCURACY_MESSAGE).toBe("位置の精度が低い。地図で位置を確かめ、長押し（右クリック）で直してください");
    expect(formatAccuracy(150.4)).toBe("現在地（精度 約 150 m）");
  });

  it("モジュールを読み込んだだけでは getCurrentPosition・watchPosition を呼ばない（ボタンを押す前は要求しない）", async () => {
    const geo = failingGeo(GEO_TIMEOUT);
    vi.stubGlobal("navigator", { geolocation: geo });
    vi.resetModules();
    await import("./current-location");
    await import("../components/current-location-control");
    expect(geo.getCurrentPosition).not.toHaveBeenCalled();
    expect(geo.watchPosition).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("位置情報が使えない環境では理由を返す", () => {
    expect(geolocationAvailability({ geolocation: undefined, isSecureContext: true }).available).toBe(false);
    expect(geolocationAvailability({ geolocation: {}, isSecureContext: false }).available).toBe(false);
    expect(geolocationAvailability({ geolocation: {}, isSecureContext: true }).available).toBe(true);
  });
});
