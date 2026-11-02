// 飛行範囲（多角形／円）の型と幾何の純粋関数（Sprint 19-1a）。
//
// - 座標は {lat, lng} のオブジェクト。GeoJSON の位置（配列）は「経度, 緯度」の順
//   （`positionToLatLng` / `latLngToPosition` / `polygonFromPositions`）。
// - 小さな範囲（半径 10km 程度まで）の利用を前提にする。日付変更線をまたぐ範囲は検証で拒否する。
// - ネットワーク・時刻・乱数を使わない。同じ入力は同じ値を返す。
import { haversineMeters, pointInPolygon, type LatLng } from "./base";

/** 多角形の頂点数の下限・暫定の上限。上限は**そらばんの暫定の設計値で、DIPS の値ではない**（DIPS の上限は記載なし。※要再確認・検証環境）。定数はここ 1 か所。保存・API は超過を拒否、通報の整形も警告 route_too_many_vertices を出す（防御）、画面は上限に近づく前に警告する方針。 */
export const MIN_POLYGON_VERTICES = 3;
export const MAX_AREA_VERTICES = 100;
/** 円の半径の範囲（m、整数）。既存の計画の `radius_m`（1〜10000）に合わせる。 */
export const MIN_AREA_RADIUS_M = 1;
export const MAX_AREA_RADIUS_M = 10000;
/** 座標の小数の桁数の上限（DB の numeric(9,6) に合わせる）。 */
export const AREA_COORD_DECIMALS = 6;

export type PolygonArea = {
  readonly kind: "polygon";
  /** 環を閉じない頂点の並び（先頭と末尾を同じにしない）。 */
  readonly vertices: readonly LatLng[];
};

export type CircleArea = {
  readonly kind: "circle";
  readonly center: LatLng;
  readonly radiusM: number;
};

export type FlightArea = PolygonArea | CircleArea;

export type AreaInvalidReason =
  | "shape_invalid"
  | "kind_unknown"
  | "vertices_too_few"
  | "vertices_too_many"
  | "coordinate_not_finite"
  | "lat_out_of_range"
  | "lng_out_of_range"
  | "coordinate_too_precise"
  | "radius_out_of_range"
  | "radius_not_integer"
  | "antimeridian_crossing"
  | "ring_closed"
  | "vertex_duplicate"
  | "area_degenerate";

export type AreaValidation =
  | { readonly ok: true; readonly area: FlightArea }
  | {
      readonly ok: false;
      readonly reason: AreaInvalidReason;
      /** 頂点に起因するときの 0 始まりの番号（円の中心は付けない）。 */
      readonly vertexIndex?: number;
    };

const EARTH_RADIUS_M = 6371008.8;
const toRad = (deg: number): number => (deg * Math.PI) / 180;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

// ── 検証 ──

type CoordCheck = { ok: true; point: LatLng } | { ok: false; reason: AreaInvalidReason };

// 小数 6 桁に丸めても値が変わらないこと（7 桁以上は拒否）。
const hasTooManyDecimals = (v: number): boolean => Number(v.toFixed(AREA_COORD_DECIMALS)) !== v;

const checkCoordinate = (input: unknown): CoordCheck => {
  if (!isRecord(input)) return { ok: false, reason: "shape_invalid" };
  const { lat, lng } = input;
  if (typeof lat !== "number" || typeof lng !== "number" || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { ok: false, reason: "coordinate_not_finite" };
  }
  if (lat < -90 || lat > 90) return { ok: false, reason: "lat_out_of_range" };
  if (lng < -180 || lng > 180) return { ok: false, reason: "lng_out_of_range" };
  if (hasTooManyDecimals(lat) || hasTooManyDecimals(lng)) {
    return { ok: false, reason: "coordinate_too_precise" };
  }
  return { ok: true, point: { lat, lng } };
};

/** すべての頂点が一直線上（面積 0）か。直線からの距離が 5 cm 未満なら一直線とみなす。 */
const isCollinear = (vertices: readonly LatLng[]): boolean => {
  const o = vertices[0]!;
  const k = Math.cos(toRad(o.lat));
  const mPerDeg = (EARTH_RADIUS_M * Math.PI) / 180;
  const pts = vertices.map((v) => ({ x: (v.lng - o.lng) * k * mPerDeg, y: (v.lat - o.lat) * mPerDeg }));
  let far = pts[1]!;
  for (const p of pts) if (p.x * p.x + p.y * p.y > far.x * far.x + far.y * far.y) far = p;
  const len = Math.hypot(far.x, far.y);
  if (len === 0) return true;
  return pts.every((p) => Math.abs(far.x * p.y - far.y * p.x) / len < 0.05);
};

/**
 * 不明な入力（API の本体など）を範囲として検証し、正規化した値（余計なキーを落とした新しい値）を返す。
 * 不正は理由のコードで返す（例外を投げない）。
 */
export const validateFlightArea = (input: unknown): AreaValidation => {
  if (!isRecord(input)) return { ok: false, reason: "shape_invalid" };

  if (input.kind === "polygon") {
    const raw = input.vertices;
    if (!Array.isArray(raw)) return { ok: false, reason: "shape_invalid" };
    if (raw.length < MIN_POLYGON_VERTICES) return { ok: false, reason: "vertices_too_few" };
    if (raw.length > MAX_AREA_VERTICES) return { ok: false, reason: "vertices_too_many" };
    const vertices: LatLng[] = [];
    for (let i = 0; i < raw.length; i++) {
      const c = checkCoordinate(raw[i]);
      if (!c.ok) return { ok: false, reason: c.reason, vertexIndex: i };
      vertices.push(c.point);
    }
    const first = vertices[0]!;
    const last = vertices[vertices.length - 1]!;
    if (first.lat === last.lat && first.lng === last.lng) {
      return { ok: false, reason: "ring_closed", vertexIndex: vertices.length - 1 };
    }
    for (let i = 0; i + 1 < vertices.length; i++) {
      const b = vertices[i + 1]!;
      if (b.lat === vertices[i]!.lat && b.lng === vertices[i]!.lng) {
        return { ok: false, reason: "vertex_duplicate", vertexIndex: i + 1 };
      }
    }
    for (let i = 0; i < vertices.length; i++) {
      const next = vertices[(i + 1) % vertices.length]!;
      if (Math.abs(next.lng - vertices[i]!.lng) > 180) {
        return { ok: false, reason: "antimeridian_crossing", vertexIndex: i };
      }
    }
    if (isCollinear(vertices)) return { ok: false, reason: "area_degenerate" };
    return { ok: true, area: { kind: "polygon", vertices } };
  }

  if (input.kind === "circle") {
    const c = checkCoordinate(input.center);
    if (!c.ok) return { ok: false, reason: c.reason };
    const r = input.radiusM;
    if (typeof r !== "number" || !Number.isFinite(r)) return { ok: false, reason: "radius_out_of_range" };
    if (r < MIN_AREA_RADIUS_M || r > MAX_AREA_RADIUS_M) return { ok: false, reason: "radius_out_of_range" };
    if (!Number.isInteger(r)) return { ok: false, reason: "radius_not_integer" };
    // 円の東西の端が ±180° を越える（日付変更線をまたぐ）ものは扱わない。
    const lngReach = r / (((EARTH_RADIUS_M * Math.PI) / 180) * Math.max(Math.cos(toRad(c.point.lat)), 1e-9));
    if (c.point.lng + lngReach > 180 || c.point.lng - lngReach < -180) {
      return { ok: false, reason: "antimeridian_crossing" };
    }
    return { ok: true, area: { kind: "circle", center: c.point, radiusM: r } };
  }

  return { ok: false, reason: "kind_unknown" };
};

// ── GeoJSON の位置（経度, 緯度）との変換 ──

/** GeoJSON の位置 `[経度, 緯度]` を {lat, lng} へ。形が違えば null。範囲の検査はしない。 */
export const positionToLatLng = (pos: unknown): LatLng | null => {
  if (!Array.isArray(pos) || pos.length < 2) return null;
  const [lng, lat] = pos as unknown[];
  if (typeof lng !== "number" || typeof lat !== "number") return null;
  return { lat, lng };
};

/** {lat, lng} を GeoJSON の位置 `[経度, 緯度]` へ。 */
export const latLngToPosition = (p: LatLng): [number, number] => [p.lng, p.lat];

/**
 * GeoJSON の位置の並び（`[経度, 緯度]`）から多角形を作って検証する。
 * 末尾が先頭と同じ（閉じた環）なら、末尾を落として開いた形にする。
 * 緯度と経度を取り違えた入力は範囲の検査（`lat_out_of_range` など）で拒否される。
 */
export const polygonFromPositions = (positions: unknown): AreaValidation => {
  if (!Array.isArray(positions)) return { ok: false, reason: "shape_invalid" };
  // 閉じた環は末尾が 1 つ多い。全件を回す前に件数を見る。
  if (positions.length > MAX_AREA_VERTICES + 1) return { ok: false, reason: "vertices_too_many" };
  const vertices: unknown[] = [];
  for (const pos of positions) {
    const p = positionToLatLng(pos);
    if (!p) return { ok: false, reason: "shape_invalid" };
    vertices.push(p);
  }
  if (vertices.length >= 2) {
    const first = vertices[0] as LatLng;
    const last = vertices[vertices.length - 1] as LatLng;
    if (first.lat === last.lat && first.lng === last.lng) vertices.pop();
  }
  return validateFlightArea({ kind: "polygon", vertices });
};

// ── 面積・周長 ──

/**
 * 多角形の面積（m²）。球面上の閉じた経路の面積（Chamberlain–Duquette）。
 * 環の向きに依らず正の値。自己交差する形では符号付きの面積の和になるので参考値。
 */
export const polygonAreaSquareMeters = (vertices: readonly LatLng[]): number => {
  if (vertices.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i]!;
    const b = vertices[(i + 1) % vertices.length]!;
    let dLng = toRad(b.lng - a.lng);
    if (dLng > Math.PI) dLng -= 2 * Math.PI;
    else if (dLng < -Math.PI) dLng += 2 * Math.PI;
    sum += dLng * (2 + Math.sin(toRad(a.lat)) + Math.sin(toRad(b.lat)));
  }
  return Math.abs((sum * EARTH_RADIUS_M * EARTH_RADIUS_M) / 2);
};

/** 多角形の周長（m）。各辺の大圏距離の和。 */
export const polygonPerimeterMeters = (vertices: readonly LatLng[]): number => {
  if (vertices.length < 2) return 0;
  let sum = 0;
  for (let i = 0; i < vertices.length; i++) {
    sum += haversineMeters(vertices[i]!, vertices[(i + 1) % vertices.length]!);
  }
  return sum;
};

/** 範囲の面積（m²）。円は πr²。 */
export const areaSquareMeters = (area: FlightArea): number =>
  area.kind === "circle" ? Math.PI * area.radiusM * area.radiusM : polygonAreaSquareMeters(area.vertices);

/** 範囲の周長（m）。円は 2πr。 */
export const perimeterMeters = (area: FlightArea): number =>
  area.kind === "circle" ? 2 * Math.PI * area.radiusM : polygonPerimeterMeters(area.vertices);

// ── 代表点・外接半径 ──

const roundCoord = (v: number): number => {
  const f = 10 ** AREA_COORD_DECIMALS;
  return Math.round(v * f) / f;
};
const roundPoint = (p: LatLng): LatLng => ({ lat: roundCoord(p.lat), lng: roundCoord(p.lng) });

const vertexMean = (vertices: readonly LatLng[]): LatLng => {
  let lat = 0;
  let lng = 0;
  for (const v of vertices) {
    lat += v.lat;
    lng += v.lng;
  }
  return { lat: lat / vertices.length, lng: lng / vertices.length };
};

/** 面積の重心（局所の平面で計算）。面積がほぼ 0 のときは null。 */
const areaCentroid = (vertices: readonly LatLng[]): LatLng | null => {
  const origin = vertexMean(vertices);
  const k = Math.cos(toRad(origin.lat));
  const pts = vertices.map((v) => ({ x: (v.lng - origin.lng) * k, y: v.lat - origin.lat }));
  let a2 = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    const q = pts[(i + 1) % pts.length]!;
    const cross = p.x * q.y - q.x * p.y;
    a2 += cross;
    cx += (p.x + q.x) * cross;
    cy += (p.y + q.y) * cross;
  }
  if (Math.abs(a2) < 1e-18) return null;
  return { lat: origin.lat + cy / (3 * a2), lng: origin.lng + cx / (3 * a2) / k };
};

/** 水平線（lat 一定）が多角形に入る区間のうち最も長いものの中点。見つからなければ null。 */
const widestScanlineMidpoint = (vertices: readonly LatLng[], lat: number): LatLng | null => {
  const xs: number[] = [];
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const pi = vertices[i]!;
    const pj = vertices[j]!;
    if (pi.lat > lat !== pj.lat > lat) {
      xs.push(((pj.lng - pi.lng) * (lat - pi.lat)) / (pj.lat - pi.lat) + pi.lng);
    }
  }
  xs.sort((a, b) => a - b);
  let best: LatLng | null = null;
  let bestWidth = 0;
  for (let i = 0; i + 1 < xs.length; i += 2) {
    const width = xs[i + 1]! - xs[i]!;
    if (width > bestWidth) {
      bestWidth = width;
      best = { lat, lng: (xs[i]! + xs[i + 1]!) / 2 };
    }
  }
  return best;
};

/**
 * 代表点。円は中心。多角形は重心（凸なら必ず内側）。重心が外にある凹の多角形は、
 * 重心の緯度の水平線が多角形に入る最も長い区間の中点（内側）。小数 6 桁に丸める。
 * 入力の頂点の並びが同じなら同じ値を返す。
 */
export const representativePoint = (area: FlightArea): LatLng => {
  if (area.kind === "circle") return roundPoint(area.center);
  const vs = area.vertices;
  const centroid = areaCentroid(vs);
  if (!centroid) return roundPoint(vertexMean(vs));
  const rounded = roundPoint(centroid);
  if (pointInPolygon(rounded, vs)) return rounded;

  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const v of vs) {
    minLat = Math.min(minLat, v.lat);
    maxLat = Math.max(maxLat, v.lat);
  }
  const lats = [centroid.lat];
  const steps = 16;
  for (let s = 1; s <= steps; s++) lats.push(minLat + ((maxLat - minLat) * s) / (steps + 1));
  for (const lat of lats) {
    const mid = widestScanlineMidpoint(vs, lat);
    if (!mid) continue;
    const r = roundPoint(mid);
    if (pointInPolygon(r, vs)) return r;
  }
  return rounded;
};

/**
 * 外接半径（m、整数に切り上げ）。代表点から全頂点（円は縁）への大圏距離の最大。
 * 「代表点＋この半径の円」が範囲を覆う（`haversineMeters` ≤ 半径）。
 */
export const circumscribedRadiusMeters = (area: FlightArea, center: LatLng = representativePoint(area)): number => {
  if (area.kind === "circle") return Math.ceil(haversineMeters(center, area.center) + area.radiusM);
  let max = 0;
  for (const v of area.vertices) max = Math.max(max, haversineMeters(center, v));
  return Math.ceil(max);
};

/**
 * 複数の範囲を覆う 1 つの円。中心は 1 つ目の範囲の代表点、半径は全範囲について
 * 同じ中心から `circumscribedRadiusMeters` を求めた最大値。範囲が空なら null。
 */
export const coveringCircle = (
  areas: readonly FlightArea[],
): { readonly center: LatLng; readonly radiusM: number } | null => {
  const first = areas[0];
  if (!first) return null;
  const center = representativePoint(first);
  let radiusM = 0;
  for (const a of areas) radiusM = Math.max(radiusM, circumscribedRadiusMeters(a, center));
  return { center, radiusM };
};

// ── 自己交差 ──

type XY = { x: number; y: number };

const cross = (o: XY, a: XY, b: XY): number => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

const onSegment = (a: XY, b: XY, p: XY): boolean =>
  Math.min(a.x, b.x) <= p.x && p.x <= Math.max(a.x, b.x) && Math.min(a.y, b.y) <= p.y && p.y <= Math.max(a.y, b.y);

/** 2 線分が共有点を持つか（端点で接する場合を含む）。 */
const segmentsTouch = (p1: XY, p2: XY, p3: XY, p4: XY): boolean => {
  const d1 = cross(p3, p4, p1);
  const d2 = cross(p3, p4, p2);
  const d3 = cross(p1, p2, p3);
  const d4 = cross(p1, p2, p4);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  if (d1 === 0 && onSegment(p3, p4, p1)) return true;
  if (d2 === 0 && onSegment(p3, p4, p2)) return true;
  if (d3 === 0 && onSegment(p1, p2, p3)) return true;
  if (d4 === 0 && onSegment(p1, p2, p4)) return true;
  return false;
};

/**
 * 交差する辺の組（辺 i は頂点 i から i+1 への線分。i < j）を返す。
 * 隣り合う辺が共有する端点は交差としない。隣り合う辺が重なって折り返す場合は交差とする。
 */
export const selfIntersectingEdgePairs = (vertices: readonly LatLng[]): ReadonlyArray<readonly [number, number]> => {
  const n = vertices.length;
  if (n < 3) return [];
  const origin = vertexMean(vertices);
  const k = Math.cos(toRad(origin.lat));
  const pts: XY[] = vertices.map((v) => ({ x: (v.lng - origin.lng) * k, y: v.lat - origin.lat }));
  const out: Array<readonly [number, number]> = [];
  for (let i = 0; i < n; i++) {
    const a1 = pts[i]!;
    const a2 = pts[(i + 1) % n]!;
    for (let j = i + 1; j < n; j++) {
      const b1 = pts[j]!;
      const b2 = pts[(j + 1) % n]!;
      const adjacentForward = j === i + 1;
      const adjacentWrap = i === 0 && j === n - 1;
      if (adjacentForward || adjacentWrap) {
        // 共有する端点以外で触れる（= 一直線に重なる）ときだけ交差。
        const shared = adjacentForward ? a2 : a1;
        const farA = adjacentForward ? a1 : a2;
        const farB = adjacentForward ? b2 : b1;
        if (cross(shared, farA, farB) === 0) {
          const dot = (farA.x - shared.x) * (farB.x - shared.x) + (farA.y - shared.y) * (farB.y - shared.y);
          if (dot > 0) out.push([i, j]);
        }
        continue;
      }
      if (segmentsTouch(a1, a2, b1, b2)) out.push([i, j]);
    }
  }
  return out;
};

/** 辺が互いに交差する（8 の字など）か。 */
export const polygonSelfIntersects = (vertices: readonly LatLng[]): boolean =>
  selfIntersectingEdgePairs(vertices).length > 0;
