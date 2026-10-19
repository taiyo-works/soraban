import {
  YONAGO_CITY_HALL,
  circlePolygon,
  distanceToPolygonBoundaryMeters,
  distanceToPolygonMeters,
  distanceToRingMeters,
  haversineMeters,
  offsetMeters,
  pointInPolygonWithHoles,
  isValidLatLng,
  parseCombinedLatLng,
  pointInPolygon,
  type Polygon,
} from "./index";

describe("isValidLatLng", () => {
  it("accepts in-range coordinates", () => {
    expect(isValidLatLng({ lat: 35.4283, lng: 133.3306 })).toBe(true);
    expect(isValidLatLng({ lat: -90, lng: -180 })).toBe(true);
    expect(isValidLatLng({ lat: 90, lng: 180 })).toBe(true);
  });
  it("rejects NaN / Infinity / out-of-range", () => {
    expect(isValidLatLng({ lat: NaN, lng: 0 })).toBe(false);
    expect(isValidLatLng({ lat: Infinity, lng: 0 })).toBe(false);
    expect(isValidLatLng({ lat: 90.1, lng: 0 })).toBe(false);
    expect(isValidLatLng({ lat: 0, lng: -180.1 })).toBe(false);
  });
});

describe("parseCombinedLatLng", () => {
  it("parses simple comma-separated form", () => {
    expect(parseCombinedLatLng("35.428303,133.330614")).toEqual({
      lat: 35.428303,
      lng: 133.330614,
    });
    expect(parseCombinedLatLng("35.428303, 133.330614")).toEqual({
      lat: 35.428303,
      lng: 133.330614,
    });
  });
  it("parses space-separated form", () => {
    expect(parseCombinedLatLng("35.428303 133.330614")).toEqual({
      lat: 35.428303,
      lng: 133.330614,
    });
  });
  it("parses fullwidth comma (IME)", () => {
    expect(parseCombinedLatLng("35.428303，133.330614")).toEqual({
      lat: 35.428303,
      lng: 133.330614,
    });
  });
  it("extracts from Google Maps @-pattern URL", () => {
    const got = parseCombinedLatLng(
      "https://www.google.com/maps/place/foo/@35.428303,133.330614,15z",
    );
    expect(got).toEqual({ lat: 35.428303, lng: 133.330614 });
  });
  it("extracts from Google Maps ?q-pattern URL", () => {
    expect(
      parseCombinedLatLng("https://maps.example.com/?q=35.428303,133.330614&z=12"),
    ).toEqual({ lat: 35.428303, lng: 133.330614 });
  });
  it("returns null for unparseable / out-of-range input", () => {
    expect(parseCombinedLatLng("")).toBeNull();
    expect(parseCombinedLatLng("not coords")).toBeNull();
    expect(parseCombinedLatLng("35.4")).toBeNull();
    expect(parseCombinedLatLng("999,999")).toBeNull();
  });
});

describe("haversineMeters", () => {
  it("returns 0 for same point", () => {
    expect(haversineMeters(YONAGO_CITY_HALL, YONAGO_CITY_HALL)).toBe(0);
  });
  it("approximates 1 degree of latitude as ~111 km", () => {
    // 1 度 ≒ 111.32 km。±0.5 km の許容で十分。
    const a = { lat: 35.0, lng: 135.0 };
    const b = { lat: 36.0, lng: 135.0 };
    const d = haversineMeters(a, b);
    expect(d).toBeGreaterThan(110_000);
    expect(d).toBeLessThan(112_000);
  });
  it("matches a known short distance (米子市役所 → 湊山公園 中心)", () => {
    // 35.4283,133.3306 → 35.4267,133.322 はおよそ 850m。
    const d = haversineMeters(YONAGO_CITY_HALL, { lat: 35.4267, lng: 133.322 });
    expect(d).toBeGreaterThan(700);
    expect(d).toBeLessThan(950);
  });
});

describe("pointInPolygon", () => {
  const square: Polygon = [
    { lat: 35.0, lng: 133.0 },
    { lat: 35.0, lng: 134.0 },
    { lat: 36.0, lng: 134.0 },
    { lat: 36.0, lng: 133.0 },
  ];
  it("detects point inside a square", () => {
    expect(pointInPolygon({ lat: 35.5, lng: 133.5 }, square)).toBe(true);
  });
  it("detects point outside a square", () => {
    expect(pointInPolygon({ lat: 34.0, lng: 133.5 }, square)).toBe(false);
    expect(pointInPolygon({ lat: 35.5, lng: 132.0 }, square)).toBe(false);
  });
  it("returns false for degenerate polygons (< 3 vertices)", () => {
    expect(pointInPolygon({ lat: 35.5, lng: 133.5 }, [])).toBe(false);
    expect(pointInPolygon({ lat: 35.5, lng: 133.5 }, [{ lat: 35, lng: 133 }])).toBe(false);
  });
});

describe("circlePolygon", () => {
  it("returns a ring with `segments` vertices", () => {
    const ring = circlePolygon({ lat: 35.5, lng: 133.5 }, 100, 32);
    expect(ring).toHaveLength(32);
  });
  it("encloses the center", () => {
    const center = { lat: 35.5, lng: 133.5 };
    const ring = circlePolygon(center, 500, 64);
    expect(pointInPolygon(center, ring)).toBe(true);
  });
  it("vertices land approximately on the requested radius", () => {
    const center = { lat: 35.5, lng: 133.5 };
    const radiusM = 500;
    const ring = circlePolygon(center, radiusM, 32);
    const distances = ring.map((p) => haversineMeters(center, p));
    for (const d of distances) {
      // 等距離長方形近似なので緯度方向と経度方向で僅かに差が出る。± 5% の許容で OK。
      expect(d).toBeGreaterThan(radiusM * 0.95);
      expect(d).toBeLessThan(radiusM * 1.05);
    }
  });
});

describe("境界までの距離（Sprint 7）", () => {
  const o = { lat: 35.49, lng: 133.23 };
  // 東西 2,000m × 南北 1,000m の長方形
  const rect: Polygon = [
    offsetMeters(o, -1000, -500),
    offsetMeters(o, 1000, -500),
    offsetMeters(o, 1000, 500),
    offsetMeters(o, -1000, 500),
  ];

  it("外側の点は境界までの最短距離を返す（辺の垂線方向）", () => {
    const p = offsetMeters(o, 0, 500 + 700);
    expect(distanceToPolygonMeters(p, [rect])).toBeCloseTo(700, 0);
  });

  it("角の外側は頂点までの距離になる", () => {
    const p = offsetMeters(o, 1000 + 300, 500 + 400);
    expect(distanceToPolygonMeters(p, [rect])).toBeCloseTo(500, 0);
  });

  it("内側の点は 0、境界距離は別関数で取れる", () => {
    const p = offsetMeters(o, 0, 490);
    expect(distanceToPolygonMeters(p, [rect])).toBe(0);
    expect(distanceToPolygonBoundaryMeters(p, [rect])).toBeCloseTo(10, 0);
    expect(distanceToRingMeters(p, rect)).toBeCloseTo(10, 0);
  });

  it("haversine と 1m 未満で一致する（1km 規模）", () => {
    const p = offsetMeters(o, 0, 1000);
    expect(Math.abs(haversineMeters(o, p) - 1000)).toBeLessThan(1);
  });

  it("穴の内側は多角形の外側として扱う", () => {
    const hole: Polygon = [
      offsetMeters(o, -100, -100),
      offsetMeters(o, 100, -100),
      offsetMeters(o, 100, 100),
      offsetMeters(o, -100, 100),
    ];
    expect(pointInPolygonWithHoles(o, [rect, hole])).toBe(false);
    expect(pointInPolygonWithHoles(offsetMeters(o, 500, 0), [rect, hole])).toBe(true);
    expect(distanceToPolygonMeters(o, [rect, hole])).toBeCloseTo(100, 0);
  });
});
