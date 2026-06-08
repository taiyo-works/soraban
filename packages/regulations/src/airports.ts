// 山陰 + 但馬の空港 seed (GeoJSON / 「供用中」のみ)。
// Vercel serverless では fs.readFile によるランタイム読み込みだと関数バンドルに
// 同梱されない (Turbopack ビルドは outputFileTracingIncludes を適用しないため)。
// parks (zones.ts) と同様に静的 import することで、ビルド時に確実にバンドルへ含める。
import airportsJson from "../data/airports/airports.json";

export type AirportFeature = {
  readonly type: "Feature";
  readonly geometry:
    | { readonly type: "Polygon"; readonly coordinates: number[][][] }
    | { readonly type: "MultiPolygon"; readonly coordinates: number[][][][] };
  readonly properties: {
    readonly id: string;
    readonly name: string;
    readonly status: string;
    readonly centerLat: number;
    readonly centerLng: number;
  };
};

export type AirportFeatureCollection = {
  readonly type: "FeatureCollection";
  readonly features: readonly AirportFeature[];
};

export const AIRPORTS_GEOJSON =
  airportsJson as unknown as AirportFeatureCollection;
