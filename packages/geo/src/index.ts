export type LatLng = {
  readonly lat: number;
  readonly lng: number;
};

export type Polygon = readonly LatLng[];

export const isValidLatLng = ({ lat, lng }: LatLng): boolean =>
  Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;

// 結合形式の座標文字列を {lat, lng} に解する。
// 想定入力:
//   "35.428303,133.330614"     ← Google Maps の「座標をコピー」
//   "35.428303, 133.330614"    ← 上の空白入り
//   "35.428303 133.330614"     ← 空白区切り
//   "35.428303，133.330614"    ← 全角カンマ（日本語IME経由）
//   "https://...maps...@35.428303,133.330614,15z" ← Google Maps URL（@パターン）
//   "https://...?q=35.428303,133.330614"          ← Google Maps URL（?qパターン）
// パース不能・範囲外は null を返す（呼び出し側で「形式が違う」と表示）。
export const parseCombinedLatLng = (input: string): LatLng | null => {
  const text = input.trim();
  if (text.length === 0) return null;

  const tryFinalize = (latStr: string, lngStr: string): LatLng | null => {
    const lat = Number(latStr);
    const lng = Number(lngStr);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    const candidate: LatLng = { lat, lng };
    return isValidLatLng(candidate) ? candidate : null;
  };

  const atMatch = text.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (atMatch?.[1] && atMatch[2]) {
    const got = tryFinalize(atMatch[1], atMatch[2]);
    if (got) return got;
  }

  const qMatch = text.match(/[?&]q=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (qMatch?.[1] && qMatch[2]) {
    const got = tryFinalize(qMatch[1], qMatch[2]);
    if (got) return got;
  }

  // 全角カンマ・空白を半角に正規化してから素朴に2値抽出
  const normalized = text.replace(/[，、]/g, ",").replace(/\s+/g, " ");
  const pairMatch = normalized.match(/^(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)$/);
  if (pairMatch?.[1] && pairMatch[2]) {
    return tryFinalize(pairMatch[1], pairMatch[2]);
  }

  return null;
};

// 米子市役所（米子市加茂町一丁目1番地）。公式: 35°25′40″N 133°19′53″E。
export const YONAGO_CITY_HALL: LatLng = {
  lat: 35.4278,
  lng: 133.3314,
};

const EARTH_RADIUS_M = 6371008.8;
const toRad = (deg: number): number => (deg * Math.PI) / 180;

export const haversineMeters = (a: LatLng, b: LatLng): number => {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
};

// Ray-casting point-in-polygon. Polygon is treated as a closed ring;
// first/last vertices need not match. Suitable at city scale where
// lat/lng can be approximated as a planar coordinate system.
export const pointInPolygon = (point: LatLng, polygon: Polygon): boolean => {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const pi = polygon[i]!;
    const pj = polygon[j]!;
    const intersects =
      pi.lat > point.lat !== pj.lat > point.lat &&
      point.lng < ((pj.lng - pi.lng) * (point.lat - pi.lat)) / (pj.lat - pi.lat) + pi.lng;
    if (intersects) inside = !inside;
  }
  return inside;
};

// ── 境界までの距離（Sprint 7: 飛行禁止法の敷地境界 1,000m・工業専用地域の内側余裕）──
//
// 判定地点を原点とする局所正距円筒図法（equirectangular）で平面に写し、
// 各辺（線分）までの最短距離をメートルで返す。数 km 規模では誤差は 0.1% 未満。

// haversineMeters と同じ球（半径 EARTH_RADIUS_M）に揃える（距離の基準を一致させるため）。
const M_PER_DEG_LAT = (EARTH_RADIUS_M * Math.PI) / 180;

const toLocalXY = (origin: LatLng, p: LatLng): { x: number; y: number } => ({
  x: (p.lng - origin.lng) * M_PER_DEG_LAT * Math.cos(toRad(origin.lat)),
  y: (p.lat - origin.lat) * M_PER_DEG_LAT,
});

const distanceToSegmentOrigin = (
  a: { x: number; y: number },
  b: { x: number; y: number },
): number => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(a.x * dx + a.y * dy) / len2));
  const px = a.x + t * dx;
  const py = a.y + t * dy;
  return Math.sqrt(px * px + py * py);
};

/** 地点からリング（閉じた多角形の外周）の辺までの最短距離（m）。内外は問わない。 */
export const distanceToRingMeters = (point: LatLng, ring: Polygon): number => {
  if (ring.length === 0) return Number.POSITIVE_INFINITY;
  if (ring.length === 1) return haversineMeters(point, ring[0]!);
  let min = Number.POSITIVE_INFINITY;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = toLocalXY(point, ring[j]!);
    const b = toLocalXY(point, ring[i]!);
    const d = distanceToSegmentOrigin(a, b);
    if (d < min) min = d;
  }
  return min;
};

/**
 * 穴あき多角形（rings[0] が外周、rings[1..] が穴）の内外判定。
 * 外周の内側かつどの穴の内側でもなければ内側。
 */
export const pointInPolygonWithHoles = (
  point: LatLng,
  rings: readonly Polygon[],
): boolean => {
  const outer = rings[0];
  if (!outer || !pointInPolygon(point, outer)) return false;
  for (let i = 1; i < rings.length; i++) {
    if (pointInPolygon(point, rings[i]!)) return false;
  }
  return true;
};

/** 穴あき多角形の境界（外周・穴のすべての辺）までの最短距離（m）。 */
export const distanceToPolygonBoundaryMeters = (
  point: LatLng,
  rings: readonly Polygon[],
): number => {
  let min = Number.POSITIVE_INFINITY;
  for (const r of rings) {
    const d = distanceToRingMeters(point, r);
    if (d < min) min = d;
  }
  return min;
};

/**
 * 多角形（穴あり可）までの距離（m）。内側なら 0、外側なら境界までの最短距離。
 */
export const distanceToPolygonMeters = (
  point: LatLng,
  rings: readonly Polygon[],
): number =>
  pointInPolygonWithHoles(point, rings) ? 0 : distanceToPolygonBoundaryMeters(point, rings);

/**
 * 基準点から東西・南北にメートル単位でずらした点（局所正距円筒近似）。
 * テストやバッファ描画用。距離 1〜2km 程度での誤差は数 cm。
 */
export const offsetMeters = (origin: LatLng, eastM: number, northM: number): LatLng => ({
  lat: origin.lat + northM / M_PER_DEG_LAT,
  lng: origin.lng + eastM / (M_PER_DEG_LAT * Math.cos(toRad(origin.lat))),
});

// Approximate circle as a polygon ring of `segments` points.
// Uses local equirectangular projection — accurate enough for buffers
// of a few km at mid-latitudes.
export const circlePolygon = (
  center: LatLng,
  radiusMeters: number,
  segments = 64,
): Polygon => {
  const latRadius = radiusMeters / 111320;
  const lngRadius = radiusMeters / (111320 * Math.cos(toRad(center.lat)));
  const ring: LatLng[] = [];
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * 2 * Math.PI;
    ring.push({
      lat: center.lat + latRadius * Math.sin(angle),
      lng: center.lng + lngRadius * Math.cos(angle),
    });
  }
  return ring;
};

export * from "./area";
