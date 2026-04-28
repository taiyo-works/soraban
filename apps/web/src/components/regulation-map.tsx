"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl, {
  type Map as MapLibreMap,
  type Marker,
  type StyleSpecification,
  type GeoJSONSource,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { circlePolygon, type LatLng, type Polygon } from "@soraban/geo";
import {
  ALL_MUNICIPAL_PARKS,
  ALL_SENSITIVE_FACILITIES,
  MIHO_AIRBASE_CENTER,
  MIHO_AIRBASE_RED_M,
  MIHO_AIRBASE_YELLOW_M,
  SENSITIVE_FACILITY_BUFFER_M,
  YONAGO_HERITAGE_SITES,
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

type LayerKey = "did" | "airports" | "base" | "parks" | "heritage" | "sensitive";

const LAYER_GROUPS: ReadonlyArray<{
  readonly key: LayerKey;
  readonly label: string;
  readonly source: string;
  readonly swatch: string;
  readonly layerIds: readonly string[];
}> = [
  {
    key: "did",
    label: "DID（航空法132条）",
    source: "国 / 国土数値情報 A16-15",
    swatch: "bg-rose-500/40 ring-rose-600 rounded-sm",
    layerIds: ["did-fill", "did-outline"],
  },
  {
    key: "airports",
    label: "空港等周辺",
    source: "国 / 国土数値情報 C28-20",
    swatch: "bg-violet-500/40 ring-violet-700 rounded-sm",
    layerIds: ["airports-fill", "airports-outline"],
  },
  {
    key: "base",
    label: "美保基地 300m / 1.5km",
    source: "小型無人機等飛行禁止法",
    swatch: "bg-rose-500/50 ring-rose-700 rounded-full",
    layerIds: ["base-yellow-fill", "base-yellow-outline", "base-red-fill", "base-red-outline"],
  },
  {
    key: "parks",
    label: "都市公園（米子8 + 境港4 件）",
    source: "米子市・境港市 都市公園条例",
    swatch: "bg-emerald-500/40 ring-emerald-700 rounded-sm",
    layerIds: ["parks-fill", "parks-outline"],
  },
  {
    key: "heritage",
    label: "指定史跡 (2件)",
    source: "文化財保護法125条 / 米子市文化財条例",
    swatch: "bg-orange-500/40 ring-orange-700 rounded-sm",
    layerIds: ["heritage-fill", "heritage-outline"],
  },
  {
    key: "sensitive",
    label: "公衆密集地 100m（米子4 + 境港3 件）",
    source: "鳥取県迷惑行為等防止条例",
    swatch: "bg-yellow-500/40 ring-yellow-700 rounded-full",
    layerIds: ["sensitive-fill", "sensitive-outline"],
  },
];

export function RegulationMap({ center, prefCode, onPick }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const onPickRef = useRef<typeof onPick>(onPick);
  onPickRef.current = onPick;
  const loadedPrefRef = useRef<string | null>(null);
  const [layerVisibility, setLayerVisibility] = useState<Record<LayerKey, boolean>>({
    did: true,
    airports: true,
    base: true,
    parks: true,
    heritage: true,
    sensitive: true,
  });

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
    const parksFc = polygonsToFeatureCollection(ALL_MUNICIPAL_PARKS.map((p) => p.polygon));
    const heritageFc = polygonsToFeatureCollection(
      YONAGO_HERITAGE_SITES.map((s) => s.polygon),
    );
    const sensitiveFc = polygonsToFeatureCollection(
      ALL_SENSITIVE_FACILITIES.map((f) =>
        circlePolygon(f.center, SENSITIVE_FACILITY_BUFFER_M, 48),
      ),
    );

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

      map.addSource("heritage", { type: "geojson", data: heritageFc });
      map.addLayer({
        id: "heritage-fill",
        type: "fill",
        source: "heritage",
        paint: { "fill-color": "#f97316", "fill-opacity": 0.30 },
      });
      map.addLayer({
        id: "heritage-outline",
        type: "line",
        source: "heritage",
        paint: { "line-color": "#c2410c", "line-width": 1.5, "line-dasharray": [3, 1] },
      });

      map.addSource("sensitive", { type: "geojson", data: sensitiveFc });
      map.addLayer({
        id: "sensitive-fill",
        type: "fill",
        source: "sensitive",
        paint: { "fill-color": "#eab308", "fill-opacity": 0.18 },
      });
      map.addLayer({
        id: "sensitive-outline",
        type: "line",
        source: "sensitive",
        paint: { "line-color": "#a16207", "line-width": 1, "line-dasharray": [1, 1] },
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
    if (!map) return;
    const apply = () => {
      for (const group of LAYER_GROUPS) {
        const visible = layerVisibility[group.key];
        for (const id of group.layerIds) {
          if (map.getLayer(id)) {
            map.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
          }
        }
      }
    };
    if (map.isStyleLoaded()) apply();
    else map.once("load", apply);
  }, [layerVisibility]);

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

  const visibleCount = Object.values(layerVisibility).filter(Boolean).length;

  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-800">
        <div ref={containerRef} className="aspect-[16/9] w-full" />
      </div>
      <div className="flex flex-col gap-2 rounded-xl border border-zinc-200 bg-white/60 p-3 text-xs dark:border-zinc-800 dark:bg-zinc-950/60">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-medium text-zinc-700 dark:text-zinc-200">
            規制レイヤー（{visibleCount}/{LAYER_GROUPS.length} 表示）
          </span>
          <span className="text-[11px] text-zinc-500 dark:text-zinc-500">
            ・チェックで地図表示を切替 ・地図クリックで判定地点を選択
          </span>
        </div>
        <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
          {LAYER_GROUPS.map((group) => {
            const checked = layerVisibility[group.key];
            return (
              <li key={group.key}>
                <label
                  className={`flex cursor-pointer items-start gap-2 rounded-md border px-2 py-1.5 transition-colors ${
                    checked
                      ? "border-zinc-300 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900"
                      : "border-transparent text-zinc-400 hover:bg-zinc-50 dark:text-zinc-500 dark:hover:bg-zinc-900/40"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) =>
                      setLayerVisibility((prev) => ({
                        ...prev,
                        [group.key]: e.target.checked,
                      }))
                    }
                    className="mt-0.5 h-3.5 w-3.5 cursor-pointer accent-zinc-700 dark:accent-zinc-300"
                  />
                  <span
                    className={`mt-0.5 inline-block h-2.5 w-2.5 ring-1 ${group.swatch}`}
                    aria-hidden
                  />
                  <span className="flex flex-1 flex-col leading-tight">
                    <span className="font-medium text-zinc-800 dark:text-zinc-200">
                      {group.label}
                    </span>
                    <span className="text-[10px] text-zinc-500 dark:text-zinc-500">
                      {group.source}
                    </span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
