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
import type { CurrentLocationCandidate } from "@/lib/current-location";
import { createLongPressDetector, type TouchPoint } from "@/lib/long-press";
import { createRightClickPicker } from "@/lib/right-click";
import { BASE_ZONE_COLORS, BASE_ZONE_LAYER_IDS, RED_HATCH_IMAGE_ID, makeHatchImage } from "./regulation-map-zones";
import {
  LAYER_DEFS,
  LAYER_GROUP_ORDER,
  MAP_COLORS,
  NO_LAYER_ROWS,
  type LayerDef,
  type LayerKey,
  type SwatchKind,
} from "./regulation-map-layers";
import {
  ALL_HERITAGE_SITES,
  ALL_MUNICIPAL_PARKS,
  ALL_SENSITIVE_FACILITIES,
  SENSITIVE_FACILITY_BUFFER_M,
  SMALL_DRONE_LAW_FACILITIES,
  type SmallDroneFacility,
} from "@soraban/regulations";

/** 地図での地点指定の方法（表示用。判定の入力・証跡には含めない）。 */
export type MapPickMethod = "click" | "longpress" | "contextmenu";

type Props = {
  readonly center: LatLng;
  readonly prefCode?: string;
  readonly onPick?: (loc: LatLng, method: MapPickMethod) => void;
  /** 現在地の精度の円と印（確認待ちの現在地、または判定した現在地）。表示だけで、判定には使わない。 */
  readonly candidate?: CurrentLocationCandidate | null;
};

// タッチ直後にブラウザが合成する click・contextmenu を無視する時間（ms）。
const TOUCH_GHOST_MS = 1500;

/** 精度（m）に応じた表示ズーム。 */
const zoomForAccuracy = (m: number): number => (m <= 50 ? 16 : m <= 200 ? 15 : m <= 1000 ? 13 : 12);

const isTouchPointer = (ev: Event | undefined): boolean =>
  !!ev && "pointerType" in ev && (ev as PointerEvent).pointerType === "touch";

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
  properties: GeoJSON.GeoJsonProperties = {},
): GeoJSON.FeatureCollection<GeoJSON.Polygon> => ({
  type: "FeatureCollection",
  features: polygons.map((p) => ({ ...polygonToGeoJson(p), properties: { ...properties } })),
});

const EMPTY_FC: GeoJSON.FeatureCollection = {
  type: "FeatureCollection",
  features: [],
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

/** 地図の印（判定地点・現在地）は表示だけ。操作する部品ではないので、読み上げ・Tab の対象にしない（押す部品の 44px の検査の対象外）。 */
const makeMarkerDecorative = (marker: Marker): void => {
  const el = marker.getElement();
  el.setAttribute("aria-hidden", "true");
  el.removeAttribute("tabindex");
  el.removeAttribute("role");
  el.removeAttribute("aria-label");
  el.style.pointerEvents = "none";
};

// 層の定義（一覧・地図の層 ID・判定の規則・出典）は regulation-map-layers.ts にある（単体テストで対応を固定）。
const LAYER_GROUPS = LAYER_DEFS;

/** 凡例の見本（地図と同じ明るい下地の上に、形・線種・模様で区別できる印を描く。色は地図の固定色）。 */
function LayerSwatch({ kind }: { readonly kind: SwatchKind }) {
  const C = MAP_COLORS;
  return (
    <svg viewBox="0 0 20 20" width={22} height={22} aria-hidden="true" className="sb-swatch" data-swatch={kind}>
      {kind === "did" ? (
        <>
          <rect x="2" y="3" width="16" height="14" rx="2" fill="var(--sb-map-did-tint)" stroke={C.didLine} strokeWidth="2" />
          <path d="M5 15 L15 5 M9 16 L17 8 M3 11 L9 5" stroke={C.didLine} strokeWidth="1.6" />
        </>
      ) : null}
      {kind === "industrial" ? <rect x="2" y="3" width="16" height="14" rx="2" fill="var(--sb-map-industrial-fill)" stroke={C.industrialLine} strokeWidth="1.6" /> : null}
      {kind === "airport" ? <circle cx="10" cy="10" r="7.5" fill="none" stroke={C.airportLine} strokeWidth="2.2" strokeDasharray="3.4 2.4" /> : null}
      {kind === "base" ? (
        <>
          <circle cx="10" cy="10" r="7.5" fill="none" stroke={BASE_ZONE_COLORS.yellowLine} strokeWidth="2" />
          <circle cx="10" cy="10" r="3.6" fill={BASE_ZONE_COLORS.red} stroke={BASE_ZONE_COLORS.redLine} strokeWidth="1.6" />
        </>
      ) : null}
      {kind === "park" ? (
        <>
          <rect x="2" y="3" width="16" height="14" rx="5" fill="none" stroke={C.parkLine} strokeWidth="2" strokeDasharray="1.5 3.2" strokeLinecap="round" />
          <circle cx="7" cy="10" r="1.4" fill={C.parkLine} />
          <circle cx="13" cy="10" r="1.4" fill={C.parkLine} />
        </>
      ) : null}
      {kind === "heritage" ? <path d="M10 2.5 L17.5 10 L10 17.5 L2.5 10 Z" fill="none" stroke={C.heritageLine} strokeWidth="2" /> : null}
      {kind === "sensitive" ? <circle cx="10" cy="10" r="7.5" fill="none" stroke={C.sensitiveLine} strokeWidth="2.2" strokeDasharray="1.2 3.2" strokeLinecap="round" /> : null}
    </svg>
  );
}

export function RegulationMap({
  center,
  prefCode,
  onPick,
  candidate = null,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const candidateMarkerRef = useRef<Marker | null>(null);
  // 地図の load 後に実行する処理（isStyleLoaded はタイル読み込み中に false になるため自前で管理する）
  const loadedRef = useRef<boolean>(false);
  const pendingRef = useRef<(() => void)[]>([]);
  const runWhenLoaded = (fn: () => void): void => {
    if (loadedRef.current) fn();
    else pendingRef.current.push(fn);
  };
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
    markerRef.current = new maplibregl.Marker({ color: MAP_COLORS.pin })
      .setLngLat([center.lng, center.lat])
      .addTo(map);
    makeMarkerDecorative(markerRef.current);

    // 赤＝敷地・区域、黄＝周辺地域（敷地境界から aroundM）、灰の点線＝要確認帯（独自・法定ではない）。
    // 敷地形状が中心点＋推定半径の施設は approx=true（斜線＋破線で「敷地は概算」を示す）。
    const siteRings = (approx: boolean): Polygon[] =>
      SMALL_DRONE_LAW_FACILITIES.filter((f) => (f.geometry.type === "center") === approx).flatMap(
        (f) => facilitySiteRings(f, 0),
      );
    const baseRedFc: GeoJSON.FeatureCollection<GeoJSON.Polygon> = {
      type: "FeatureCollection",
      features: [
        ...polygonsToFeatureCollection(siteRings(true), { approx: true }).features,
        ...polygonsToFeatureCollection(siteRings(false), { approx: false }).features,
      ],
    };
    const baseYellowFc = polygonsToFeatureCollection(
      SMALL_DRONE_LAW_FACILITIES.flatMap((f) => facilitySiteRings(f, f.aroundM)),
    );
    const baseCheckFc = polygonsToFeatureCollection(
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
      loadedRef.current = true;
      queueMicrotask(() => pendingRef.current.splice(0).forEach((fn) => fn()));
      // DID — populated dynamically from /api/did/[pref]
      map.addSource("did", { type: "geojson", data: EMPTY_FC });
      map.addLayer({
        id: "did-fill",
        type: "fill",
        source: "did",
        paint: { "fill-color": MAP_COLORS.didLine, "fill-opacity": 0.2 },
      });
      map.addLayer({
        id: "did-outline",
        type: "line",
        source: "did",
        paint: { "line-color": MAP_COLORS.didLine, "line-width": 1.4, "line-dasharray": [2, 2] },
      });

      // 工業専用地域（DID 除外）— /api/industrial から（収録済み市町村のみ）
      map.addSource("industrial", { type: "geojson", data: EMPTY_FC });
      map.addLayer({
        id: "industrial-fill",
        type: "fill",
        source: "industrial",
        paint: { "fill-color": MAP_COLORS.industrial, "fill-opacity": 0.3 },
      });
      map.addLayer({
        id: "industrial-outline",
        type: "line",
        source: "industrial",
        paint: { "line-color": MAP_COLORS.industrialLine, "line-width": 1.2 },
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
        paint: { "fill-color": MAP_COLORS.airportFill, "fill-opacity": 0.2 },
      });
      map.addLayer({
        id: "airports-outline",
        type: "line",
        source: "airports",
        paint: { "line-color": MAP_COLORS.airportLine, "line-width": 2, "line-dasharray": [3, 2] },
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

      // そらばん独自の要確認帯：灰の点線の輪郭のみ（塗りなし）。黄・赤とは別の見た目。
      map.addSource("base-check", { type: "geojson", data: baseCheckFc });
      map.addLayer({
        id: "base-check-outline",
        type: "line",
        source: "base-check",
        paint: {
          "line-color": BASE_ZONE_COLORS.check,
          "line-width": 1.5,
          "line-dasharray": [1, 2],
        },
      });

      // 黄（イエローゾーン）＝周辺地域。飛行禁止の領域なので、塗りと実線の輪郭ではっきり示す。
      map.addSource("base-yellow", { type: "geojson", data: baseYellowFc });
      map.addLayer({
        id: "base-yellow-fill",
        type: "fill",
        source: "base-yellow",
        paint: { "fill-color": BASE_ZONE_COLORS.yellow, "fill-opacity": 0.3 },
      });
      map.addLayer({
        id: "base-yellow-outline",
        type: "line",
        source: "base-yellow",
        paint: { "line-color": BASE_ZONE_COLORS.yellowLine, "line-width": 2 },
      });

      // 赤（レッドゾーン）＝敷地・区域。敷地形状が概算の施設は斜線＋破線の輪郭。
      map.addSource("base-red", { type: "geojson", data: baseRedFc });
      map.addLayer({
        id: "base-red-fill",
        type: "fill",
        source: "base-red",
        paint: { "fill-color": BASE_ZONE_COLORS.red, "fill-opacity": 0.3 },
      });
      try {
        if (!map.hasImage(RED_HATCH_IMAGE_ID)) map.addImage(RED_HATCH_IMAGE_ID, makeHatchImage());
        map.addLayer({
          id: "base-red-hatch",
          type: "fill",
          source: "base-red",
          filter: ["==", ["get", "approx"], true],
          paint: { "fill-pattern": RED_HATCH_IMAGE_ID },
        });
      } catch {
        /* 斜線が使えなくても、破線の輪郭で「概算」は分かる */
      }
      map.addLayer({
        id: "base-red-outline-approx",
        type: "line",
        source: "base-red",
        filter: ["==", ["get", "approx"], true],
        paint: {
          "line-color": BASE_ZONE_COLORS.redLine,
          "line-width": 2,
          "line-dasharray": [3, 2],
        },
      });
      map.addLayer({
        id: "base-red-outline",
        type: "line",
        source: "base-red",
        filter: ["!=", ["get", "approx"], true],
        paint: { "line-color": BASE_ZONE_COLORS.redLine, "line-width": 2 },
      });
      if (containerRef.current) {
        containerRef.current.dataset["baseLayers"] = BASE_ZONE_LAYER_IDS.filter((id) =>
          map.getLayer(id),
        ).join(",");
      }

      map.addSource("parks", { type: "geojson", data: parksFc });
      map.addLayer({
        id: "parks-fill",
        type: "fill",
        source: "parks",
        paint: { "fill-color": MAP_COLORS.parkFill, "fill-opacity": 0.25 },
      });
      map.addLayer({
        id: "parks-outline",
        type: "line",
        source: "parks",
        paint: { "line-color": MAP_COLORS.parkLine, "line-width": 1.5 },
      });

      map.addSource("heritage", { type: "geojson", data: heritageFc });
      map.addLayer({
        id: "heritage-fill",
        type: "fill",
        source: "heritage",
        paint: { "fill-color": MAP_COLORS.heritageFill, "fill-opacity": 0.22 },
      });
      map.addLayer({
        id: "heritage-outline",
        type: "line",
        source: "heritage",
        paint: { "line-color": MAP_COLORS.heritageLine, "line-width": 1.5, "line-dasharray": [3, 1] },
      });

      map.addSource("sensitive", { type: "geojson", data: sensitiveFc });
      map.addLayer({
        id: "sensitive-fill",
        type: "fill",
        source: "sensitive",
        paint: { "fill-color": MAP_COLORS.sensitiveFill, "fill-opacity": 0.16 },
      });
      map.addLayer({
        id: "sensitive-outline",
        type: "line",
        source: "sensitive",
        paint: { "line-color": MAP_COLORS.sensitiveLine, "line-width": 1.2, "line-dasharray": [1, 1] },
      });
    });

    // ── 地点指定 ──
    // マウス：左クリック（従来どおり）・右クリック（contextmenu）。
    // タッチ：長押し（500ms 以上・移動 10px 以内）に一本化し、単タップでは指定しない（Sprint 9 未決 1）。
    let lastTouchAt = -Infinity;
    const recentlyTouched = () => performance.now() - lastTouchAt < TOUCH_GHOST_MS;
    const pickAt = (lngLat: { lat: number; lng: number }, method: MapPickMethod) => {
      const cb = onPickRef.current;
      if (cb) cb({ lat: lngLat.lat, lng: lngLat.lng }, method);
    };
    map.on("click", (e) => {
      if (isTouchPointer(e.originalEvent) || recentlyTouched()) return;
      pickAt(e.lngLat, "click");
    });
    // 右クリック：地図のライブラリの contextmenu は右ボタンでの回転操作と競合して発火しないことがあるため、
    // DOM の contextmenu で扱う。地図上ではブラウザの右クリックメニューを出さない。
    // 右ドラッグ（押した位置から 4px 以上の移動）で地図を回したときは地点にしない（createRightClickPicker）。
    const toCanvas = (ev: MouseEvent) => {
      const rect = map.getCanvas().getBoundingClientRect();
      return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
    };
    const rightClick = createRightClickPicker({
      onPick: (p) => pickAt(map.unproject([p.x, p.y]), "contextmenu"),
    });
    const onRightDown = (ev: MouseEvent) => {
      if (ev.button === 2) rightClick.down(toCanvas(ev));
    };
    const onRightMove = (ev: MouseEvent) => rightClick.move(toCanvas(ev));
    const onRightUp = (ev: MouseEvent) => {
      if (ev.button === 2) rightClick.up(toCanvas(ev));
    };
    const onContextMenu = (ev: MouseEvent) => {
      ev.preventDefault();
      // タッチの長押しでブラウザが出す contextmenu は、長押しの判定で扱う
      if (isTouchPointer(ev) || recentlyTouched()) return;
      rightClick.contextmenu(toCanvas(ev));
    };
    node.addEventListener("mousedown", onRightDown, true);
    // ドラッグ中に地図の外へ出ても追えるよう、移動と離す操作は window で受ける
    window.addEventListener("mousemove", onRightMove, true);
    window.addEventListener("mouseup", onRightUp, true);
    node.addEventListener("contextmenu", onContextMenu);

    const longPress = createLongPressDetector({
      onLongPress: (p) => pickAt(map.unproject([p.x, p.y]), "longpress"),
    });
    const toPoints = (points: readonly { x: number; y: number }[]): TouchPoint[] =>
      points.map((pt) => ({ x: pt.x, y: pt.y }));
    map.on("touchstart", (e) => {
      lastTouchAt = performance.now();
      longPress.start(toPoints(e.points));
    });
    map.on("touchmove", (e) => {
      lastTouchAt = performance.now();
      longPress.move(toPoints(e.points));
    });
    map.on("touchend", () => {
      lastTouchAt = performance.now();
      longPress.end();
    });
    map.on("touchcancel", () => longPress.cancel());
    map.on("movestart", (e) => {
      // 利用者の操作による移動（パン・ズーム）だけで取り消す（プログラムの easeTo は除く）
      if ((e as { originalEvent?: Event }).originalEvent) longPress.mapMoved();
    });
    map.on("moveend", () => {
      const c = map.getCenter();
      node.dataset["centerLat"] = c.lat.toFixed(6);
      node.dataset["centerLng"] = c.lng.toFixed(6);
    });
    map.getCanvas().style.cursor = "crosshair";

    return () => {
      longPress.cancel();
      node.removeEventListener("contextmenu", onContextMenu);
      node.removeEventListener("mousedown", onRightDown, true);
      window.removeEventListener("mousemove", onRightMove, true);
      window.removeEventListener("mouseup", onRightUp, true);
      candidateMarkerRef.current?.remove();
      candidateMarkerRef.current = null;
      map.remove();
      loadedRef.current = false;
      pendingRef.current = [];
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

  // 現在地の候補：精度の円と印を表示し、地図をその位置に移す（判定はしない）。
  useEffect(() => {
    const map = mapRef.current;
    const node = containerRef.current;
    if (!map || !node) return;
    const apply = () => {
      const m = mapRef.current;
      if (!m) return;
      const fc: GeoJSON.FeatureCollection = candidate
        ? polygonsToFeatureCollection([
            circlePolygon({ lat: candidate.lat, lng: candidate.lng }, candidate.accuracyM, 64),
          ])
        : EMPTY_FC;
      const src = m.getSource("current-location") as GeoJSONSource | undefined;
      if (src) src.setData(fc);
      else {
        m.addSource("current-location", { type: "geojson", data: fc });
        m.addLayer({
          id: "current-location-fill",
          type: "fill",
          source: "current-location",
          paint: { "fill-color": MAP_COLORS.candidate, "fill-opacity": 0.14 },
        });
        m.addLayer({
          id: "current-location-outline",
          type: "line",
          source: "current-location",
          paint: { "line-color": MAP_COLORS.candidate, "line-width": 2 },
        });
      }
      if (candidate) {
        node.dataset["accuracyRadiusM"] = String(Math.round(candidate.accuracyM));
      } else {
        delete node.dataset["accuracyRadiusM"];
      }
    };
    candidateMarkerRef.current?.remove();
    candidateMarkerRef.current = null;
    if (candidate) {
      candidateMarkerRef.current = new maplibregl.Marker({ color: MAP_COLORS.candidate })
        .setLngLat([candidate.lng, candidate.lat])
        .addTo(map);
      makeMarkerDecorative(candidateMarkerRef.current);
      map.easeTo({
        center: [candidate.lng, candidate.lat],
        zoom: zoomForAccuracy(candidate.accuracyM),
        duration: 600,
      });
    }
    runWhenLoaded(apply);
  }, [candidate]);

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
      // 地図に実際に反映した状態（E2E が確かめる）。非表示にしたグループ名のカンマ区切り。
      const node = containerRef.current;
      if (node) {
        node.dataset["hiddenLayers"] = LAYER_GROUPS.filter((g) => !layerVisibility[g.key])
          .map((g) => g.key)
          .join(",");
        // MapLibre から読み戻した実際の表示状態（層ごと：visible／none／mixed／missing）。data-hidden-layers と食い違わないことを E2E が確かめる。
        node.dataset["layerVisibility"] = LAYER_GROUPS.map((g) => {
          const states = g.layerIds.map((id) => (map.getLayer(id) ? ((map.getLayoutProperty(id, "visibility") as string | undefined) ?? "visible") : "missing"));
          const state = states.every((v) => v === "visible") ? "visible" : states.every((v) => v === "none") ? "none" : states.includes("missing") ? "missing" : "mixed";
          return `${g.key}:${state}`;
        }).join(",");
      }
    };
    // isStyleLoaded() は背景タイルの読み込み中に false になり、load は一度しか発火しない。
    // そこで once("load") に頼ると、地図の移動直後の切替が地図に反映されず取りこぼされる。
    runWhenLoaded(apply);
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
          // 地図に実際に反映した DID の都道府県コード（E2E が確かめる）。
          const node = containerRef.current;
          if (node) node.dataset["didPref"] = prefCode;
        };
        // 背景タイルの読み込み中（isStyleLoaded() が false）でも取りこぼさないよう、load 済みかを自前で管理する。
        runWhenLoaded(apply);
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

  // 地図の枠：スマホは画面の高さの 40%（260〜380px。操作しやすく、縦を伸ばしすぎない）、PC は 4:3。
  const canvas = (
    <div
      ref={containerRef}
      data-testid="regulation-map"
      className="sb-map-canvas w-full"
      style={{ touchAction: "pan-x pan-y" }}
    />
  );

  const rowsByGroup = LAYER_GROUP_ORDER.map((name) => ({
    name,
    layers: LAYER_GROUPS.filter((g) => g.group === name),
    notes: NO_LAYER_ROWS.filter((g) => g.group === name),
  })).filter((g) => g.layers.length + g.notes.length > 0);

  // 層のチップ（押す部品は 44px 以上。ON は 2px の墨の枠、OFF は破線）。読み上げの名前は正式な名前（短い名前は装飾）。
  // 小型無人機等飛行禁止法だけは、色分けの凡例（文字ラベルつき）をチップの中に出す（幅いっぱいの行）。
  const renderLayer = (group: LayerDef) => {
    const checked = layerVisibility[group.key];
    const wide = group.zones !== undefined;
    return (
      <li key={group.key} className={wide ? "col-span-2 lg:col-span-3" : undefined}>
        <label className={`sb-layer ${checked ? "is-on" : "is-off"} ${wide ? "is-wide" : ""}`}>
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) =>
              setLayerVisibility((prev) => ({
                ...prev,
                [group.key]: e.target.checked,
              }))
            }
            className="sb-check"
          />
          <LayerSwatch kind={group.swatch} />
          <span className="flex min-w-0 flex-1 flex-col gap-1 text-[13px] leading-snug">
            <span aria-hidden="true" className="font-bold">
              {group.shortLabel}
            </span>
            {wide ? null : <span className="sb-sr">{group.label}</span>}
            {wide ? (
              <>
                <span className="text-xs text-sb-ink-2">{group.label}</span>
                {group.detail ? <span className="sb-sr">{group.detail}</span> : null}
              </>
            ) : null}
            {group.zones ? (
              <ul className="flex flex-col gap-1" data-testid="legend-zones">
                {group.zones.map((z) => (
                  <li key={z.key} className="flex items-start gap-1.5 text-xs text-sb-ink">
                    <span
                      className="mt-0.5 inline-block h-3 w-3 shrink-0 rounded-sb-s border-2"
                      style={{
                        background: z.key === "site" ? BASE_ZONE_COLORS.red : z.key === "around" ? BASE_ZONE_COLORS.yellow : "transparent",
                        borderColor: z.key === "site" ? BASE_ZONE_COLORS.redLine : z.key === "around" ? BASE_ZONE_COLORS.yellowLine : BASE_ZONE_COLORS.check,
                        borderStyle: z.key === "check" ? "dashed" : "solid",
                      }}
                      aria-hidden
                    />
                    <span>
                      <strong className="font-bold">{z.label}</strong>
                      <span className="text-sb-ink-2">：{z.note}</span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </span>
        </label>
      </li>
    );
  };

  return (
    <div className="sb-block sb-map-block flex flex-col gap-3" data-testid="map-block">
      <div className="sb-map-frame">
        {/* 地点指定の操作の手がかり。タッチ端末では単タップで指定しないため、長押しを常に見える位置で示す。
            主な入力方式が精密なポインタ（pointer: fine）ならクリック・右クリック、それ以外は長押しを示す。 */}
        <p
          className="flex items-start gap-2 border-b border-sb-rule bg-sb-surface px-3 py-1.5 text-xs leading-snug text-sb-ink"
          data-testid="map-pick-hint"
        >
          <span aria-hidden className="mt-[0.4em] inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: MAP_COLORS.pin }} />
          <span>
            <span className="pointer-fine:hidden">
              地図を<strong className="font-bold">長押し</strong>すると、その位置を判定地点（赤い印）にします。指を動かすと地図の移動になります。
            </span>
            <span className="hidden pointer-fine:inline">
              地図を<strong className="font-bold">クリック</strong>または<strong className="font-bold">右クリック</strong>すると、その位置を判定地点（赤い印）にします。
            </span>
          </span>
        </p>
        {canvas}
      </div>
      {/* 規制レイヤー（チップ。押すと地図の表示を切り替える。出典・状態は下の「出典と状態」） */}
      <section aria-label="規制レイヤー" className="flex flex-col gap-2" data-testid="layer-list">
        <h3 className="text-sm font-bold">
          規制レイヤー（{visibleCount}/{LAYER_GROUPS.length} 表示）
        </h3>
        <ul className="sb-layer-list">
          {/* 幅いっぱいの行（小型無人機等飛行禁止法。色分けの凡例つき）は最後に置き、短いチップを 2 列で詰める */}
          {[...LAYER_GROUPS.filter((g) => !g.zones), ...LAYER_GROUPS.filter((g) => g.zones)].map(renderLayer)}
        </ul>
        <details className="sb-layer-sources">
          <summary>各層の出典と状態（公式データ・概算）</summary>
          {rowsByGroup.map((g) => (
            <div key={g.name} data-group={g.name} className="flex flex-col gap-1.5">
              <p className="sb-layer-group">{g.name}</p>
              <ul className="flex flex-col gap-2">
                {g.layers.map((l) => (
                  <li key={l.key} className="text-xs leading-relaxed text-sb-ink-2" data-layer-row={l.key}>
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-bold text-sb-ink">{l.label}</span>
                      <span className="sb-status" data-status={l.status}>
                        {l.status}
                      </span>
                    </span>
                    <span className="block text-sb-ink-3">{l.source}</span>
                    {l.detail ? <span className="block text-sb-ink-2">{l.detail}</span> : null}
                  </li>
                ))}
                {g.notes.map((n) => (
                  <li key={n.label} className="text-xs leading-relaxed text-sb-ink-2" data-testid="layer-no-map-row">
                    <span className="font-bold text-sb-ink">{n.label}</span>：{n.note}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </details>
      </section>
    </div>
  );
}
