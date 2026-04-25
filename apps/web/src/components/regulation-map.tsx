"use client";

import { useEffect, useRef } from "react";
import maplibregl, {
  type Map as MapLibreMap,
  type Marker,
  type StyleSpecification,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { LatLng } from "@soraban/geo";

type Props = {
  readonly center: LatLng;
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

export function RegulationMap({ center }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerRef = useRef<Marker | null>(null);

  useEffect(() => {
    const node = containerRef.current;
    if (!node || mapRef.current) return;
    const map = new maplibregl.Map({
      container: node,
      style: STYLE,
      center: [center.lng, center.lat],
      zoom: 14,
    });
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
    mapRef.current = map;
    markerRef.current = new maplibregl.Marker({ color: "#dc2626" })
      .setLngLat([center.lng, center.lat])
      .addTo(map);
    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // center props are handled in the second effect to avoid re-init
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const marker = markerRef.current;
    if (!map || !marker) return;
    map.easeTo({ center: [center.lng, center.lat], zoom: 14, duration: 800 });
    marker.setLngLat([center.lng, center.lat]);
  }, [center.lat, center.lng]);

  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-800">
      <div ref={containerRef} className="aspect-[16/9] w-full" />
    </div>
  );
}
