import { describe, expect, it } from "vitest";
import {
  MAX_AREA_VERTICES,
  areaSquareMeters,
  circumscribedRadiusMeters,
  coveringCircle,
  haversineMeters,
  latLngToPosition,
  offsetMeters,
  perimeterMeters,
  pointInPolygon,
  polygonAreaSquareMeters,
  polygonFromPositions,
  polygonPerimeterMeters,
  polygonSelfIntersects,
  positionToLatLng,
  representativePoint,
  selfIntersectingEdgePairs,
  validateFlightArea,
  type FlightArea,
  type LatLng,
  type PolygonArea,
} from "./index";

const rect = (origin: LatLng, eastM: number, northM: number): LatLng[] => [
  origin,
  offsetMeters(origin, eastM, 0),
  offsetMeters(origin, eastM, northM),
  offsetMeters(origin, 0, northM),
];

const polygon = (vertices: LatLng[]): FlightArea => ({ kind: "polygon", vertices });

// 全国の代表地点（経度・緯度）。
const PLACES: Record<string, LatLng> = {
  赤道付近: { lat: 0.5, lng: 120 },
  北緯45度付近: { lat: 45, lng: 141.9 },
  札幌: { lat: 43.0621, lng: 141.3544 },
  米子: { lat: 35.4283, lng: 133.3306 },
  隠岐: { lat: 36.2, lng: 133.3 },
  那覇: { lat: 26.2124, lng: 127.6809 },
  経度179度台: { lat: 24.3, lng: 179.9 },
};

const relErr = (actual: number, expected: number): number => Math.abs(actual - expected) / expected;

describe("validateFlightArea: 多角形", () => {
  const ok = [
    { lat: 35.4, lng: 133.3 },
    { lat: 35.4, lng: 133.31 },
    { lat: 35.41, lng: 133.31 },
  ];

  it("正しい三角形は通り、余計なキーは落ちる", () => {
    const r = validateFlightArea({
      kind: "polygon",
      vertices: ok.map((v) => ({ ...v, memo: "x" })),
      note: "free text",
    });
    expect(r).toEqual({ ok: true, area: { kind: "polygon", vertices: ok } });
  });

  it("3 点未満は vertices_too_few", () => {
    expect(validateFlightArea({ kind: "polygon", vertices: ok.slice(0, 2) })).toEqual({
      ok: false,
      reason: "vertices_too_few",
    });
    expect(validateFlightArea({ kind: "polygon", vertices: [] })).toMatchObject({ reason: "vertices_too_few" });
  });

  it("頂点数が上限を超えると vertices_too_many（上限ちょうどは通る）", () => {
    const ring = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        lat: 35 + 0.01 * Math.sin((2 * Math.PI * i) / n),
        lng: 133 + 0.01 * Math.cos((2 * Math.PI * i) / n),
      })).map((v) => ({ lat: Math.round(v.lat * 1e6) / 1e6, lng: Math.round(v.lng * 1e6) / 1e6 }));
    expect(validateFlightArea({ kind: "polygon", vertices: ring(MAX_AREA_VERTICES) }).ok).toBe(true);
    expect(validateFlightArea({ kind: "polygon", vertices: ring(MAX_AREA_VERTICES + 1) })).toMatchObject({
      ok: false,
      reason: "vertices_too_many",
    });
  });

  it("緯度・経度の範囲外を別の理由で返し、頂点の番号を付ける", () => {
    const bad = (i: number, v: Partial<LatLng>) => ok.map((p, k) => (k === i ? { ...p, ...v } : p));
    expect(validateFlightArea({ kind: "polygon", vertices: bad(1, { lat: 90.000001 }) })).toEqual({
      ok: false,
      reason: "lat_out_of_range",
      vertexIndex: 1,
    });
    expect(validateFlightArea({ kind: "polygon", vertices: bad(2, { lng: -180.5 }) })).toEqual({
      ok: false,
      reason: "lng_out_of_range",
      vertexIndex: 2,
    });
  });

  it("NaN・Infinity・数値でない値は coordinate_not_finite", () => {
    for (const lat of [NaN, Infinity, "35.4" as unknown as number]) {
      expect(
        validateFlightArea({ kind: "polygon", vertices: [{ lat, lng: 133 }, ok[1], ok[2]] }),
      ).toMatchObject({ reason: "coordinate_not_finite", vertexIndex: 0 });
    }
  });

  it("小数 7 桁以上は coordinate_too_precise、6 桁は通る", () => {
    const v = (lat: number) => [{ lat, lng: 133.3 }, ok[1], ok[2]];
    expect(validateFlightArea({ kind: "polygon", vertices: v(35.1234567) })).toMatchObject({
      reason: "coordinate_too_precise",
      vertexIndex: 0,
    });
    expect(validateFlightArea({ kind: "polygon", vertices: v(35.123456) }).ok).toBe(true);
    expect(validateFlightArea({ kind: "polygon", vertices: v(35.1) }).ok).toBe(true);
    expect(validateFlightArea({ kind: "polygon", vertices: v(-0.000001) }).ok).toBe(true);
  });

  it("日付変更線をまたぐ辺は antimeridian_crossing", () => {
    const r = validateFlightArea({
      kind: "polygon",
      vertices: [
        { lat: 10, lng: 179.99 },
        { lat: 10, lng: -179.99 },
        { lat: 10.01, lng: -179.99 },
      ],
    });
    expect(r).toMatchObject({ ok: false, reason: "antimeridian_crossing" });
  });

  it("形が違う入力は shape_invalid / kind_unknown", () => {
    expect(validateFlightArea(null)).toEqual({ ok: false, reason: "shape_invalid" });
    expect(validateFlightArea("polygon")).toEqual({ ok: false, reason: "shape_invalid" });
    expect(validateFlightArea({ kind: "polygon", vertices: "x" })).toEqual({ ok: false, reason: "shape_invalid" });
    expect(validateFlightArea({ kind: "polygon", vertices: [1, 2, 3] })).toMatchObject({ reason: "shape_invalid" });
    expect(validateFlightArea({ kind: "line", vertices: ok })).toEqual({ ok: false, reason: "kind_unknown" });
    expect(validateFlightArea({})).toEqual({ ok: false, reason: "kind_unknown" });
  });
});

describe("validateFlightArea: 円", () => {
  const circle = (radiusM: unknown, center: unknown = { lat: 35.4283, lng: 133.3306 }) =>
    validateFlightArea({ kind: "circle", center, radiusM });

  it("半径 1 と 10000 は通り、0・10001・負・非数は radius_out_of_range", () => {
    expect(circle(1).ok).toBe(true);
    expect(circle(10000).ok).toBe(true);
    for (const r of [0, 10001, -5, NaN, Infinity, "100", undefined]) {
      expect(circle(r)).toEqual({ ok: false, reason: "radius_out_of_range" });
    }
  });

  it("整数でない半径は radius_not_integer", () => {
    expect(circle(100.5)).toEqual({ ok: false, reason: "radius_not_integer" });
  });

  it("中心の範囲外・桁数・形を検証する", () => {
    expect(circle(100, { lat: 91, lng: 0 })).toMatchObject({ reason: "lat_out_of_range" });
    expect(circle(100, { lat: 0, lng: 181 })).toMatchObject({ reason: "lng_out_of_range" });
    expect(circle(100, { lat: 35.1234567, lng: 133 })).toMatchObject({ reason: "coordinate_too_precise" });
    expect(circle(100, null)).toMatchObject({ reason: "shape_invalid" });
  });

  it("縁が ±180° を越える円は antimeridian_crossing、離れていれば通る", () => {
    expect(circle(10000, { lat: 0, lng: 179.99 })).toEqual({ ok: false, reason: "antimeridian_crossing" });
    expect(circle(10000, { lat: 0, lng: -179.99 })).toEqual({ ok: false, reason: "antimeridian_crossing" });
    expect(circle(10000, { lat: 24.3, lng: 179.8 }).ok).toBe(true);
  });
});

describe("小数 6 桁の判定と形の検査", () => {
  const r6 = (x: number) => Math.round(x * 1e6) / 1e6;
  const tri = (lat: number, lng: number) => [
    { lat, lng },
    { lat: r6(lat > 0 ? lat - 0.01 : lat + 0.01), lng },
    { lat, lng: r6(lng > 0 ? lng - 0.01 : lng + 0.01) },
  ];
  const v = (vertices: unknown) => validateFlightArea({ kind: "polygon", vertices });

  it("7 桁以上を拒否する（微小な桁も）", () => {
    expect(v(tri(35.123456000001, 133.3))).toMatchObject({ reason: "coordinate_too_precise" });
    expect(v(tri(35, 168.12345600049))).toMatchObject({ reason: "coordinate_too_precise" });
  });

  it("6 桁ちょうどの値は拒否しない（全国）", () => {
    const pts: Array<[number, number]> = [
      [45.123456, 141.654321],
      [43.062096, 141.354376],
      [26.212401, 127.680932],
      [36.200001, 133.300007],
      [24.300001, 179.123457],
      [0.000001, 179.999989],
      [-33.123459, -179.123459],
    ];
    for (const [lat, lng] of pts) expect(v(tri(lat, lng)).ok).toBe(true);
  });

  it("先頭＝末尾の閉じた環は ring_closed、隣り合う重複頂点は vertex_duplicate", () => {
    const t = tri(35, 133);
    expect(v([...t, t[0]])).toEqual({ ok: false, reason: "ring_closed", vertexIndex: 3 });
    expect(v([t[0], t[1], t[1], t[2]])).toEqual({ ok: false, reason: "vertex_duplicate", vertexIndex: 2 });
  });

  it("面積 0（一直線）は area_degenerate", () => {
    expect(v([{ lat: 35, lng: 133 }, { lat: 35, lng: 133.01 }, { lat: 35, lng: 133.02 }])).toEqual({
      ok: false,
      reason: "area_degenerate",
    });
    expect(v([{ lat: 35, lng: 133 }, { lat: 35.01, lng: 133.01 }, { lat: 35.02, lng: 133.02 }])).toMatchObject({
      reason: "area_degenerate",
    });
  });

  it("polygonFromPositions は全件を回す前に件数の上限を見る", () => {
    const huge = new Proxy(new Array(MAX_AREA_VERTICES + 2).fill(0), {
      get(t, p, r) {
        if (typeof p === "string" && /^\d+$/.test(p)) throw new Error("要素を読んだ");
        return Reflect.get(t, p, r);
      },
    });
    expect(polygonFromPositions(huge)).toEqual({ ok: false, reason: "vertices_too_many" });
  });
});

describe("座標の順は 経度, 緯度（GeoJSON の位置）", () => {
  it("positionToLatLng / latLngToPosition は経度が先", () => {
    expect(positionToLatLng([133.3306, 35.4283])).toEqual({ lat: 35.4283, lng: 133.3306 });
    expect(latLngToPosition({ lat: 35.4283, lng: 133.3306 })).toEqual([133.3306, 35.4283]);
    expect(positionToLatLng("x")).toBeNull();
    expect(positionToLatLng([1])).toBeNull();
    expect(positionToLatLng(["1", "2"])).toBeNull();
  });

  it("正しい順（経度, 緯度）の位置から多角形ができ、閉じた環は開いた形にする", () => {
    const ring = [
      [133.3, 35.4],
      [133.31, 35.4],
      [133.31, 35.41],
      [133.3, 35.4],
    ];
    const r = polygonFromPositions(ring);
    expect(r.ok).toBe(true);
    if (r.ok && r.area.kind === "polygon") expect(r.area.vertices).toHaveLength(3);
  });

  it("緯度と経度を取り違えた位置（[35.4, 133.3] など）は拒否される", () => {
    const swapped = [
      [35.4, 133.3],
      [35.4, 133.31],
      [35.41, 133.31],
    ];
    expect(polygonFromPositions(swapped)).toMatchObject({ ok: false, reason: "lat_out_of_range", vertexIndex: 0 });
  });

  it("位置の形が違えば shape_invalid", () => {
    expect(polygonFromPositions("x")).toEqual({ ok: false, reason: "shape_invalid" });
    expect(polygonFromPositions([[1], [2], [3]])).toEqual({ ok: false, reason: "shape_invalid" });
  });
});

describe("面積・周長（長方形との差 1% 以内）", () => {
  for (const [name, origin] of Object.entries(PLACES)) {
    it(`${name}: 約 0.01° 四方（1km × 1km）`, () => {
      const v = rect(origin, 1000, 1000);
      expect(relErr(polygonAreaSquareMeters(v), 1000 * 1000)).toBeLessThan(0.01);
      expect(relErr(polygonPerimeterMeters(v), 4000)).toBeLessThan(0.01);
    });
    it(`${name}: 5km × 3km`, () => {
      const v = rect(origin, 5000, 3000);
      expect(relErr(polygonAreaSquareMeters(v), 5000 * 3000)).toBeLessThan(0.01);
      expect(relErr(polygonPerimeterMeters(v), 16000)).toBeLessThan(0.01);
    });
  }

  it("向きに依らず正の値（時計回りでも同じ）", () => {
    const v = rect(PLACES["米子"]!, 800, 600);
    expect(polygonAreaSquareMeters([...v].reverse())).toBeCloseTo(polygonAreaSquareMeters(v), 3);
  });

  it("0.01° 四方（緯度経度の度で指定）", () => {
    const o = PLACES["赤道付近"]!;
    const v = [o, { lat: o.lat, lng: o.lng + 0.01 }, { lat: o.lat + 0.01, lng: o.lng + 0.01 }, { lat: o.lat + 0.01, lng: o.lng }];
    const side = haversineMeters(o, { lat: o.lat, lng: o.lng + 0.01 });
    expect(relErr(polygonAreaSquareMeters(v), side * side)).toBeLessThan(0.01);
  });

  it("円は πr² / 2πr との差 0.5% 以内", () => {
    for (const r of [1, 50, 1000, 10000]) {
      const c: FlightArea = { kind: "circle", center: PLACES["那覇"]!, radiusM: r };
      expect(relErr(areaSquareMeters(c), Math.PI * r * r)).toBeLessThan(0.005);
      expect(relErr(perimeterMeters(c), 2 * Math.PI * r)).toBeLessThan(0.005);
    }
  });

  it("多角形化した円の面積と円の面積は 0.5% 以内で一致する（全国）", () => {
    for (const origin of Object.values(PLACES)) {
      const r = 2000;
      const ring: LatLng[] = Array.from({ length: 360 }, (_, i) => {
        const a = (i / 360) * 2 * Math.PI;
        const p = offsetMeters(origin, r * Math.cos(a), r * Math.sin(a));
        return p;
      });
      expect(relErr(polygonAreaSquareMeters(ring), Math.PI * r * r)).toBeLessThan(0.005);
    }
  });

  it("area / perimeter は種類に応じて委譲する", () => {
    const v = rect(PLACES["札幌"]!, 400, 300);
    expect(areaSquareMeters(polygon(v))).toBe(polygonAreaSquareMeters(v));
    expect(perimeterMeters(polygon(v))).toBe(polygonPerimeterMeters(v));
    expect(polygonAreaSquareMeters(v.slice(0, 2))).toBe(0);
    expect(polygonPerimeterMeters([])).toBe(0);
  });
});

describe("代表点", () => {
  it("円は中心（小数 6 桁）", () => {
    expect(representativePoint({ kind: "circle", center: { lat: 35.4283, lng: 133.3306 }, radiusM: 100 })).toEqual({
      lat: 35.4283,
      lng: 133.3306,
    });
  });

  it("凸の多角形は重心（長方形は中央）", () => {
    const o = PLACES["米子"]!;
    const p = representativePoint(polygon(rect(o, 1000, 600)));
    const mid = offsetMeters(o, 500, 300);
    expect(haversineMeters(p, mid)).toBeLessThan(1);
  });

  it("三角形は頂点の平均に等しい重心", () => {
    const t = [
      { lat: 35.0, lng: 133.0 },
      { lat: 35.0, lng: 133.03 },
      { lat: 35.03, lng: 133.0 },
    ];
    const p = representativePoint(polygon(t));
    expect(p.lat).toBeCloseTo(35.01, 4);
    expect(p.lng).toBeCloseTo(133.01, 4);
  });

  it("凹（コの字）でも代表点が内側にある", () => {
    // 重心が切り欠きの中に落ちるコの字。
    for (const o of Object.values(PLACES)) {
      const u = [
        offsetMeters(o, 0, 0),
        offsetMeters(o, 3000, 0),
        offsetMeters(o, 3000, 3000),
        offsetMeters(o, 2500, 3000),
        offsetMeters(o, 2500, 500),
        offsetMeters(o, 500, 500),
        offsetMeters(o, 500, 3000),
        offsetMeters(o, 0, 3000),
      ].map((v) => ({ lat: Math.round(v.lat * 1e6) / 1e6, lng: Math.round(v.lng * 1e6) / 1e6 }));
      const p = representativePoint(polygon(u));
      expect(pointInPolygon(p, u)).toBe(true);
    }
  });

  it("重心が外に出るコの字（開口が大きい）でも内側", () => {
    const o = PLACES["隠岐"]!;
    const u = [
      offsetMeters(o, 0, 0),
      offsetMeters(o, 4000, 0),
      offsetMeters(o, 4000, 4000),
      offsetMeters(o, 3900, 4000),
      offsetMeters(o, 3900, 100),
      offsetMeters(o, 100, 100),
      offsetMeters(o, 100, 4000),
      offsetMeters(o, 0, 4000),
    ];
    const c = { lat: u.reduce((s, v) => s + v.lat, 0) / u.length, lng: u.reduce((s, v) => s + v.lng, 0) / u.length };
    // 前提: 単純な平均（重心に近い点）は切り欠きの中にあり、外側になる。
    expect(pointInPolygon(c, u)).toBe(false);
    const p = representativePoint(polygon(u));
    expect(pointInPolygon(p, u)).toBe(true);
  });

  it("同じ入力は同じ値。頂点の開始位置・向きを変えてもほぼ同じ（1 m 以内）", () => {
    const v = rect(PLACES["那覇"]!, 1500, 700);
    const a = representativePoint(polygon(v));
    expect(representativePoint(polygon(v))).toEqual(a);
    const rotated = [...v.slice(2), ...v.slice(0, 2)];
    const reversed = [...v].reverse();
    expect(haversineMeters(representativePoint(polygon(rotated)), a)).toBeLessThan(1);
    expect(haversineMeters(representativePoint(polygon(reversed)), a)).toBeLessThan(1);
  });

  it("面積が 0 の退化した形でも有限の値を返す", () => {
    const o = PLACES["米子"]!;
    const p = representativePoint(polygon([o, offsetMeters(o, 100, 0), offsetMeters(o, 200, 0)]));
    expect(Number.isFinite(p.lat) && Number.isFinite(p.lng)).toBe(true);
  });

  it("経度 179.9° 付近でも経度が巻き戻らない", () => {
    const o = PLACES["経度179度台"]!;
    const p = representativePoint(polygon(rect(o, 1000, 1000)));
    expect(p.lng).toBeGreaterThan(179.9);
    expect(p.lng).toBeLessThan(180);
  });
});

describe("外接半径", () => {
  const cases: Array<[string, FlightArea]> = [
    ["長方形（米子）", polygon(rect(PLACES["米子"]!, 3000, 1000))],
    ["長方形（経度 179.9°）", polygon(rect(PLACES["経度179度台"]!, 4000, 2500))],
    ["三角形（札幌）", polygon([
      PLACES["札幌"]!,
      offsetMeters(PLACES["札幌"]!, 5000, 0),
      offsetMeters(PLACES["札幌"]!, 0, 5000),
    ])],
    ["コの字（隠岐）", polygon([
      offsetMeters(PLACES["隠岐"]!, 0, 0),
      offsetMeters(PLACES["隠岐"]!, 3000, 0),
      offsetMeters(PLACES["隠岐"]!, 3000, 3000),
      offsetMeters(PLACES["隠岐"]!, 2500, 3000),
      offsetMeters(PLACES["隠岐"]!, 2500, 500),
      offsetMeters(PLACES["隠岐"]!, 500, 500),
      offsetMeters(PLACES["隠岐"]!, 500, 3000),
      offsetMeters(PLACES["隠岐"]!, 0, 3000),
    ])],
    ["円（那覇）", { kind: "circle", center: PLACES["那覇"]!, radiusM: 1234 }],
  ];

  for (const [name, area] of cases) {
    it(`${name}: どの頂点（円は縁）も 代表点＋外接半径 の内側`, () => {
      const c = representativePoint(area);
      const r = circumscribedRadiusMeters(area);
      expect(Number.isInteger(r)).toBe(true);
      if (area.kind === "polygon") {
        for (const v of area.vertices) expect(haversineMeters(c, v)).toBeLessThanOrEqual(r);
        // 切り上げなので、最も遠い頂点との差は 1 m 未満。
        const far = Math.max(...area.vertices.map((v) => haversineMeters(c, v)));
        expect(r - far).toBeLessThan(1);
      } else {
        expect(r).toBe(Math.ceil(area.radiusM + haversineMeters(c, area.center)));
        // 三角不等式により 代表点から中心まで＋半径 以上なら縁のどの点も覆う。
        expect(r).toBeGreaterThanOrEqual(haversineMeters(c, area.center) + area.radiusM);
      }
    });
  }

  it("円の外接半径は半径以上（中心が代表点のとき半径そのもの）", () => {
    expect(circumscribedRadiusMeters({ kind: "circle", center: PLACES["米子"]!, radiusM: 500 })).toBe(500);
  });

  it("代表点を指定して呼べる", () => {
    const area = polygon(rect(PLACES["米子"]!, 1000, 1000));
    const other = offsetMeters(PLACES["米子"]!, -2000, 0);
    expect(circumscribedRadiusMeters(area, other)).toBeGreaterThan(circumscribedRadiusMeters(area));
    if (area.kind === "polygon") {
      const r = circumscribedRadiusMeters(area, other);
      for (const v of area.vertices) expect(haversineMeters(other, v)).toBeLessThanOrEqual(r);
    }
  });
});

describe("coveringCircle", () => {
  const o = PLACES["米子"]!;

  it("空は null", () => {
    expect(coveringCircle([])).toBeNull();
  });

  it("1 つの範囲は代表点と外接半径", () => {
    const a = polygon(rect(o, 1000, 600));
    expect(coveringCircle([a])).toEqual({ center: representativePoint(a), radiusM: circumscribedRadiusMeters(a) });
  });

  it("複数の範囲（多角形と円）をすべて覆う。中心は 1 つ目の代表点", () => {
    const a = polygon(rect(o, 500, 500));
    const b = polygon(rect(offsetMeters(o, 3000, 2000), 800, 400));
    const c: FlightArea = { kind: "circle", center: offsetMeters(o, -2500, 1000), radiusM: 700 };
    const cov = coveringCircle([a, b, c])!;
    expect(cov.center).toEqual(representativePoint(a));
    for (const v of (b as PolygonArea).vertices) {
      expect(haversineMeters(cov.center, v)).toBeLessThanOrEqual(cov.radiusM);
    }
    for (let deg = 0; deg < 360; deg += 10) {
      const t = (deg * Math.PI) / 180;
      const edge = offsetMeters(c.center, 700 * Math.cos(t), 700 * Math.sin(t));
      expect(haversineMeters(cov.center, edge)).toBeLessThanOrEqual(cov.radiusM);
    }
  });

  it("辺を細かく分けた点も覆う", () => {
    const a = polygon(rect(o, 4000, 1500));
    const b = polygon(rect(offsetMeters(o, 2000, 1000), 1200, 900));
    const cov = coveringCircle([a, b])!;
    for (const area of [a, b]) {
      const vs = (area as PolygonArea).vertices;
      for (let i = 0; i < vs.length; i++) {
        const p = vs[i]!;
        const q = vs[(i + 1) % vs.length]!;
        for (let t = 0; t <= 1; t += 0.05) {
          const pt = { lat: p.lat + (q.lat - p.lat) * t, lng: p.lng + (q.lng - p.lng) * t };
          expect(haversineMeters(cov.center, pt)).toBeLessThanOrEqual(cov.radiusM);
        }
      }
    }
  });
});

describe("自己交差", () => {
  const o = PLACES["米子"]!;

  it("8 の字は真", () => {
    const fig8 = [offsetMeters(o, 0, 0), offsetMeters(o, 100, 100), offsetMeters(o, 100, 0), offsetMeters(o, 0, 100)];
    expect(polygonSelfIntersects(fig8)).toBe(true);
    expect(selfIntersectingEdgePairs(fig8)).toEqual([[0, 2]]);
  });

  it("四角形・三角形・凹の多角形は偽（隣り合う辺の端点の共有は交差でない）", () => {
    expect(polygonSelfIntersects(rect(o, 100, 100))).toBe(false);
    expect(polygonSelfIntersects([o, offsetMeters(o, 100, 0), offsetMeters(o, 0, 100)])).toBe(false);
    const u = [
      offsetMeters(o, 0, 0),
      offsetMeters(o, 3000, 0),
      offsetMeters(o, 3000, 3000),
      offsetMeters(o, 2500, 3000),
      offsetMeters(o, 2500, 500),
      offsetMeters(o, 500, 500),
      offsetMeters(o, 500, 3000),
      offsetMeters(o, 0, 3000),
    ];
    expect(polygonSelfIntersects(u)).toBe(false);
  });

  it("離れた辺が頂点で接する（蝶ネクタイ状の接触）は真", () => {
    const touch = [
      offsetMeters(o, 0, 0),
      offsetMeters(o, 200, 0),
      offsetMeters(o, 100, 100),
      offsetMeters(o, 200, 200),
      offsetMeters(o, 0, 200),
      offsetMeters(o, 100, 100),
    ];
    expect(polygonSelfIntersects(touch)).toBe(true);
  });

  it("隣り合う辺が重なって折り返すと真", () => {
    expect(polygonSelfIntersects([o, offsetMeters(o, 200, 0), offsetMeters(o, 100, 0)])).toBe(true);
  });

  it("先頭と末尾の辺（閉じる辺）の交差も見つける", () => {
    const v = [
      offsetMeters(o, 0, 0),
      offsetMeters(o, 200, 0),
      offsetMeters(o, 200, 200),
      offsetMeters(o, 100, -100),
    ];
    expect(polygonSelfIntersects(v)).toBe(true);
  });

  it("2 点以下は偽", () => {
    expect(polygonSelfIntersects([o, offsetMeters(o, 1, 1)])).toBe(false);
  });
});

describe("既存の関数が変わらない", () => {
  it("haversineMeters は従来どおり（赤道 1° ≒ 111.195km）", () => {
    expect(haversineMeters({ lat: 0, lng: 0 }, { lat: 0, lng: 1 })).toBeCloseTo(111195.1, 0);
  });
});
