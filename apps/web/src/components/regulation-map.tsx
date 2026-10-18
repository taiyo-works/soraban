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
  ALL_HERITAGE_SITES,
  ALL_MUNICIPAL_PARKS,
  ALL_SENSITIVE_FACILITIES,
  COVERAGE_SUMMARY,
  DATASET_IDS,
  getDataset,
  SENSITIVE_FACILITY_BUFFER_M,
  SMALL_DRONE_LAW_FACILITIES,
  type SmallDroneFacility,
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

type LayerKey =
  | "did"
  | "industrial"
  | "airports"
  | "base"
  | "parks"
  | "heritage"
  | "sensitive";

// 凡例の出典表記（データセット台帳から組み立てる）。
const datasetLegend = (id: string): string => {
  const d = getDataset(id);
  const year = d.baseYear !== null ? `・基準年 ${d.baseYear}` : "";
  const bundled = d.bundled ? "" : "・本体データ未同梱";
  return `${d.name}${year}・確認日 ${d.verifiedAt}${bundled}`;
};

// 飛行禁止法の対象施設：敷地（ポリゴン、または中心点＋推定半径）と、その外側 1,000m・
// 1,000m＋yellow 幅の帯を描く。中心点のみの施設は円で近似（概算）。
const facilitySiteRings = (f: SmallDroneFacility, extraM: number): Polygon[] => {
  const g = f.geometry;
  if (g.type === "center") {
    return [circlePolygon(g.center, g.estimatedSiteRadiusM + extraM, 96)];
  }
  // ポリゴン敷地の外側バッファは描画上の近似として外周の各頂点を中心とする円で表す。
  if (extraM === 0) return g.rings.slice(0, 1);
  return g.rings[0]!.map((p) => circlePolygon(p, extraM, 48));
};

// 自治体別の件数を「米子8 + 境港4 + 出雲5」のような短い列に整形する。
// レジストリ追加だけで自動的に表記が伸びる。
const formatMuniBreakdown = (
  entries: ReadonlyArray<readonly [string, number]>,
): string =>
  entries
    .filter(([, n]) => n > 0)
    .map(([name, n]) => `${name.replace(/[市区町村]$/, "")}${n}`)
    .join(" + ");

const PARK_BREAKDOWN = formatMuniBreakdown(COVERAGE_SUMMARY.municipalParkCounts);
const HERITAGE_BREAKDOWN = formatMuniBreakdown(COVERAGE_SUMMARY.municipalHeritageCounts);
const SENSITIVE_BREAKDOWN = formatMuniBreakdown(COVERAGE_SUMMARY.municipalSensitiveCounts);
const PARK_MUNI_LABEL = COVERAGE_SUMMARY.municipalParkNames.join("・");
const HERITAGE_MUNI_LABEL = COVERAGE_SUMMARY.municipalHeritageCounts
  .map(([name]) => name)
  .join("・");
const PREF_NUISANCE_LABEL = COVERAGE_SUMMARY.prefectureNuisanceNames.join("・");

const LAYER_GROUPS: ReadonlyArray<{
  readonly key: LayerKey;
  readonly label: string;
  readonly source: string;
  /** 色の意味など、ラベルだけでは伝わらない補足（任意） */
  readonly detail?: string;
  readonly swatch: string;
  readonly layerIds: readonly string[];
}> = [
  {
    key: "did",
    label: "DID（航空法132条）",
    source: datasetLegend(DATASET_IDS.did),
    swatch: "bg-rose-500/40 ring-rose-600 rounded-sm",
    layerIds: ["did-fill", "did-outline"],
  },
  {
    key: "industrial",
    label: "工業専用地域（DID から除外・告示第435号）",
    source: datasetLegend(DATASET_IDS.industrialExclusive),
    detail: "収録済みの市町村のみ表示",
    swatch: "bg-sky-500/40 ring-sky-700 rounded-sm",
    layerIds: ["industrial-fill", "industrial-outline"],
  },
  {
    key: "airports",
    label: "空港等周辺",
    source: datasetLegend(DATASET_IDS.airports),
    swatch: "bg-violet-500/40 ring-violet-700 rounded-sm",
    layerIds: ["airports-fill", "airports-outline"],
  },
  {
    key: "base",
    label: `小型無人機等飛行禁止法 対象施設 ${SMALL_DRONE_LAW_FACILITIES.length} 件（赤＝敷地＋おおむね 1,000m の周辺地域〔いわゆるイエローゾーン〕／黄＝外側の要確認帯）`,
    source: `${datasetLegend(DATASET_IDS.smallDroneLawFacilities)}・敷地形状は概算`,
    detail: "赤：敷地とその周囲おおむね 1,000m／黄：その外側の要確認帯（告示の区域図で確認）",
    swatch: "bg-rose-500/50 ring-2 ring-amber-500 rounded-full",
    layerIds: ["base-yellow-fill", "base-yellow-outline", "base-red-fill", "base-red-outline"],
  },
  {
    key: "parks",
    label: `都市公園（${PARK_BREAKDOWN} / 計 ${COVERAGE_SUMMARY.totalParks} 件）`,
    source: `${PARK_MUNI_LABEL} 都市公園条例`,
    swatch: "bg-emerald-500/40 ring-emerald-700 rounded-sm",
    layerIds: ["parks-fill", "parks-outline"],
  },
  {
    key: "heritage",
    label: `指定史跡（${HERITAGE_BREAKDOWN} / 計 ${COVERAGE_SUMMARY.totalHeritage} 件）`,
    source: `文化財保護法125条 / ${HERITAGE_MUNI_LABEL} 文化財条例`,
    swatch: "bg-orange-500/40 ring-orange-700 rounded-sm",
    layerIds: ["heritage-fill", "heritage-outline"],
  },
  {
    key: "sensitive",
    label: `公衆密集地 ${SENSITIVE_FACILITY_BUFFER_M}m（${SENSITIVE_BREAKDOWN} / 計 ${COVERAGE_SUMMARY.totalSensitive} 件）`,
    source: `${PREF_NUISANCE_LABEL} 迷惑行為等防止条例`,
    swatch: "bg-yellow-500/40 ring-yellow-700 rounded-full",
    layerIds: ["sensitive-fill", "sensitive-outline"],
  },
];

export function RegulationMap({ center, prefCode, onPick }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  // 地図クリックハンドラから常に最新の onPick を読めるよう ref に保持。
  // React のルール上、ref の更新は effect で行う（render 中の代入は禁止）。
  const onPickRef = useRef<typeof onPick>(onPick);
  useEffect(() => {
    onPickRef.current = onPick;
  }, [onPick]);
  const loadedPrefRef = useRef<string | null>(null);
  const [layerVisibility, setLayerVisibility] = useState<Record<LayerKey, boolean>>({
    did: true,
    industrial: true,
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

    // 敷地＋1,000m（red）と、その外側の yellow 幅（告示の区域図で要確認）。
    const baseRedFc = polygonsToFeatureCollection(
      SMALL_DRONE_LAW_FACILITIES.flatMap((f) => facilitySiteRings(f, f.aroundM)),
    );
    const baseYellowFc = polygonsToFeatureCollection(
      SMALL_DRONE_LAW_FACILITIES.flatMap((f) => facilitySiteRings(f, f.aroundM + f.yellowWidthM)),
    );
    const parksFc = polygonsToFeatureCollection(ALL_MUNICIPAL_PARKS.map((p) => p.polygon));
    const heritageFc = polygonsToFeatureCollection(
      ALL_HERITAGE_SITES.map((s) => s.polygon),
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

      // 工業専用地域（DID 除外）— /api/industrial から（収録済み市町村のみ）
      map.addSource("industrial", { type: "geojson", data: EMPTY_FC });
      map.addLayer({
        id: "industrial-fill",
        type: "fill",
        source: "industrial",
        paint: { "fill-color": "#0284c7", "fill-opacity": 0.22 },
      });
      map.addLayer({
        id: "industrial-outline",
        type: "line",
        source: "industrial",
        paint: { "line-color": "#0369a1", "line-width": 1.2 },
      });
      void fetch("/api/industrial")
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (!data) return;
          const src = mapRef.current?.getSource("industrial") as GeoJSONSource | undefined;
          if (src) src.setData(data as GeoJSON.FeatureCollection);
        })
        .catch(() => {
          /* ignore */
        });

      // 空港（山陰・但馬の供用中空港 seed）
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
      {/* 地図: モバイルでは aspect 4:5 (縦長) で画面の主役に近づける。
          touch-action で縦スクロールとピンチを両立させる */}
      <div className="overflow-hidden border border-rule">
        <div
          ref={containerRef}
          className="aspect-[4/5] w-full sm:aspect-[16/9]"
          style={{ touchAction: "pan-x pan-y" }}
        />
      </div>
      {/* レイヤーレジェンド: モバイルではデフォルト折りたたみ */}
      <details
        className="flex flex-col gap-2 border border-rule bg-paper/60 p-3 text-xs sm:[&>summary]:hidden sm:[&>div]:!flex"
        open
      >
        <summary className="flex cursor-pointer list-none items-center justify-between font-medium text-ink select-none [&::-webkit-details-marker]:hidden">
          <span>規制レイヤー（{visibleCount}/{LAYER_GROUPS.length} 表示）</span>
          <span aria-hidden className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink-mute">
            ▾ tap
          </span>
        </summary>
        <div className="flex flex-col gap-2 sm:!flex">
          <span className="text-[11px] text-ink-mute hidden sm:block">
            ・チェックで地図表示を切替 ・地図クリックで判定地点を選択
          </span>
          <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
            {LAYER_GROUPS.map((group) => {
              const checked = layerVisibility[group.key];
              return (
                <li key={group.key}>
                  <label
                    className={`flex min-h-[44px] cursor-pointer items-start gap-2 border px-2 py-2 transition-colors ${
                      checked
                        ? "border-rule bg-paper-soft"
                        : "border-transparent text-ink-mute"
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
                      className="mt-0.5 h-4 w-4 cursor-pointer accent-brand-700"
                    />
                    <span
                      className={`mt-0.5 inline-block h-2.5 w-2.5 ring-1 ${group.swatch}`}
                      aria-hidden
                    />
                    <span className="flex flex-1 flex-col leading-tight">
                      <span className="font-medium text-ink">{group.label}</span>
                      {group.detail ? (
                        <span className="mt-0.5 text-[10px] text-ink-soft">
                          {group.detail}
                        </span>
                      ) : null}
                      <span className="mt-0.5 text-[10px] text-ink-mute">
                        {group.source}
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      </details>
    </div>
  );
}
