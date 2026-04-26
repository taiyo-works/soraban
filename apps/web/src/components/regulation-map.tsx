"use client";

import { useEffect, useRef } from "react";
import maplibregl, {
  type Map as MapLibreMap,
  type Marker,
  type StyleSpecification,
  type GeoJSONSource,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { circlePolygon, type LatLng, type Polygon } from "@soraban/geo";
import {
  MIHO_AIRBASE_CENTER,
  MIHO_AIRBASE_RED_M,
  MIHO_AIRBASE_YELLOW_M,
  YONAGO_PARKS,
} from "@soraban/regulations";

type Props = {
  readonly center: LatLng;
  readonly prefCode?: string;
  readonly onPick?: (loc: LatLng) => void;
};

const STYLE: StyleSpecification = {
  version: 8,
  sources: {
    gsi: {
      type: "raster",
      tiles: ["https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png"],
      tileSize: 256,
      maxzoom: 18,
      attribution:
        '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener noreferrer">国土地理院</a>',
    },
  },
  layers: [{ id: "gsi-pale", type: "raster", source: "gsi" }],
};

const polygonToGeoJson = (
  polygon: Polygon,
): GeoJSON.Feature<GeoJSON.Polygon> => {
  const ring = polygon.map((p) => [p.lng, p.lat] as [number, number]);
  if (ring.length > 0) {
    const first = ring[0]!;
    const last = ring[ring.length - 1]!;
    if (first[0] !== last[0] || first[1] !== last[1]) {
      ring.push([first[0], first[1]]);
    }
  }
  return {
    type: "Feature",
    geometry: { type: "Polygon", coordinates: [ring] },
    properties: {},
  };
};

const polygonsToFeatureCollection = (
  polygons: readonly Polygon[],
): GeoJSON.FeatureCollection<GeoJSON.Polygon> => ({
  type: "FeatureCollection",
  features: polygons.map(polygonToGeoJson),
});

const EMPTY_FC: GeoJSON.FeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

export function RegulationMap({ center, prefCode, onPick }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const onPickRef = useRef<typeof onPick>(onPick);
  onPickRef.current = onPick;
  const loadedPrefRef = useRef<string | null>(null);

  useEffect(() => {
    const node = containerRef.current;
    if (!node || mapRef.current) return;
    const map = new maplibregl.Map({
      container: node,
      style: STYLE,
      center: [center.lng, center.lat],
      zoom: 13,
    });
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
    mapRef.current = map;
    markerRef.current = new maplibregl.Marker({ color: "#dc2626" })
      .setLngLat([center.lng, center.lat])
      .addTo(map);

    const baseRedFc = polygonsToFeatureCollection([
      circlePolygon(MIHO_AIRBASE_CENTER, MIHO_AIRBASE_RED_M),
    ]);
    const baseYellowFc = polygonsToFeatureCollection([
      circlePolygon(MIHO_AIRBASE_CENTER, MIHO_AIRBASE_YELLOW_M),
    ]);
    const parksFc = polygonsToFeatureCollection(YONAGO_PARKS.map((p) => p.polygon));

    map.on("load", () => {
      // DID — populated dynamically from /api/did/[pref]
      map.addSource("did", { type: "geojson", data: EMPTY_FC });
      map.addLayer({
        id: "did-fill",
        type: "fill",
        source: "did",
        paint: { "fill-color": "#dc2626", "fill-opacity": 0.18 },
      });
      map.addLayer({
        id: "did-outline",
        type: "line",
        source: "did",
        paint: { "line-color": "#dc2626", "line-width": 1, "line-dasharray": [2, 2] },
      });

      // 空港 (全国・国土数値情報 C28-20)
      map.addSource("airports", { type: "geojson", data: EMPTY_FC });
      map.addLayer({
        id: "airports-fill",
        type: "fill",
        source: "airports",
        paint: { "fill-color": "#7c3aed", "fill-opacity": 0.30 },
      });
      map.addLayer({
        id: "airports-outline",
        type: "line",
        source: "airports",
        paint: { "line-color": "#5b21b6", "line-width": 1.5 },
      });

      void fetch("/api/airports")
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (!data) return;
          const m = mapRef.current;
          if (!m) return;
          const src = m.getSource("airports") as GeoJSONSource | undefined;
          if (src) src.setData(data as GeoJSON.FeatureCollection);
        })
        .catch(() => {
          /* ignore */
        });

      map.addSource("base-yellow", { type: "geojson", data: baseYellowFc });
      map.addLayer({
        id: "base-yellow-fill",
        type: "fill",
        source: "base-yellow",
        paint: { "fill-color": "#f59e0b", "fill-opacity": 0.18 },
      });
      map.addLayer({
        id: "base-yellow-outline",
        type: "line",
        source: "base-yellow",
        paint: { "line-color": "#d97706", "line-width": 1 },
      });

      map.addSource("base-red", { type: "geojson", data: baseRedFc });
      map.addLayer({
        id: "base-red-fill",
        type: "fill",
        source: "base-red",
        paint: { "fill-color": "#dc2626", "fill-opacity": 0.32 },
      });
      map.addLayer({
        id: "base-red-outline",
        type: "line",
        source: "base-red",
        paint: { "line-color": "#991b1b", "line-width": 1.5 },
      });

      map.addSource("parks", { type: "geojson", data: parksFc });
      map.addLayer({
        id: "parks-fill",
        type: "fill",
        source: "parks",
        paint: { "fill-color": "#10b981", "fill-opacity": 0.25 },
      });
      map.addLayer({
        id: "parks-outline",
        type: "line",
        source: "parks",
        paint: { "line-color": "#047857", "line-width": 1.5 },
      });
    });

    map.on("click", (e) => {
      const cb = onPickRef.current;
      if (!cb) return;
      cb({ lat: e.lngLat.lat, lng: e.lngLat.lng });
    });
    map.getCanvas().style.cursor = "crosshair";

    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const marker = markerRef.current;
    if (!map || !marker) return;
    map.easeTo({ center: [center.lng, center.lat], zoom: 13, duration: 800 });
    marker.setLngLat([center.lng, center.lat]);
  }, [center.lat, center.lng]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !prefCode) return;
    if (loadedPrefRef.current === prefCode) return;

    let cancelled = false;
    const loadDid = async () => {
      try {
        const res = await fetch(`/api/did/${prefCode}`);
        if (!res.ok) return;
        const data = (await res.json()) as GeoJSON.FeatureCollection;
        if (cancelled) return;
        const apply = () => {
          const m = mapRef.current;
          if (!m) return;
          const src = m.getSource("did") as GeoJSONSource | undefined;
          if (!src) return;
          src.setData(data);
          loadedPrefRef.current = prefCode;
        };
        if (map.isStyleLoaded()) apply();
        else map.once("load", apply);
      } catch {
        /* ignore */
      }
    };
    void loadDid();
    return () => {
      cancelled = true;
    };
  }, [prefCode]);

  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-800">
        <div ref={containerRef} className="aspect-[16/9] w-full" />
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-600 dark:text-zinc-400">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-rose-500/40 ring-1 ring-rose-600" />
          DID 平成27年（航空法132条）
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-violet-500/40 ring-1 ring-violet-700" />
          空港等（C28-20）
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-rose-500/50 ring-1 ring-rose-700" />
          美保基地 300m
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-amber-500/40 ring-1 ring-amber-600" />
          美保基地 1.5km
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-emerald-500/40 ring-1 ring-emerald-700" />
          米子市公園
        </span>
        <span className="ml-auto text-zinc-500 dark:text-zinc-500">
          地図クリックで判定地点を選択
        </span>
      </div>
    </div>
  );
}
