import type { LatLng, Polygon } from "@soraban/geo";

// 自衛隊美保基地（米子鬼太郎空港共用） — 滑走路中央付近。
// 35°29′37″N 133°14′10″E
export const MIHO_AIRBASE_CENTER: LatLng = {
  lat: 35.4936,
  lng: 133.2361,
};

// 小型無人機等飛行禁止法の対象範囲（おおむね 300m）。
export const MIHO_AIRBASE_RED_M = 300;

// 空港周辺の進入表面・要確認エリアの簡易バッファ（1.5km）。
export const MIHO_AIRBASE_YELLOW_M = 1500;

export type Park = {
  readonly id: string;
  readonly name: string;
  readonly polygon: Polygon;
};

// 米子市内の主要都市公園（簡易ポリゴン）。
// Phase 1 で米子市公園台帳の正規ポリゴンに置換予定。
export const YONAGO_PARKS: readonly Park[] = [
  {
    id: "minatoyama-park",
    name: "湊山公園（米子城跡）",
    polygon: [
      { lat: 35.4287, lng: 133.3194 },
      { lat: 35.4287, lng: 133.3245 },
      { lat: 35.4248, lng: 133.3245 },
      { lat: 35.4248, lng: 133.3194 },
    ],
  },
  {
    id: "higashiyama-park",
    name: "東山公園（どらドラパーク米子）",
    polygon: [
      { lat: 35.4180, lng: 133.3500 },
      { lat: 35.4180, lng: 133.3580 },
      { lat: 35.4130, lng: 133.3580 },
      { lat: 35.4130, lng: 133.3500 },
    ],
  },
];
