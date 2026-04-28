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

export const YONAGO_CITY_HALL: LatLng = {
  lat: 35.4283,
  lng: 133.3306,
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
