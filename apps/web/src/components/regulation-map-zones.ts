// 飛行禁止法 対象施設レイヤーの塗り分け（地図の見た目の定義）。
//
// 警察庁・防衛省の呼び方にそろえる（packages/regulations/data/small-drone-law/README.md の確認範囲）。
//   - 赤（レッドゾーン）   ＝ 対象施設の敷地・区域
//   - 黄（イエローゾーン） ＝ 周辺地域（敷地・区域の周囲おおむね 1,000m）。どちらも原則飛行禁止
//   - 灰の点線             ＝ そらばん独自の要確認帯（法定の範囲ではない）
// 地図の黄は「ゾーンの呼び名」であり、判定結果の色（レッド/イエロー/グリーンの結論）ではない。
// 敷地形状が未収録（中心点＋推定半径）の施設は、赤を斜線と破線の輪郭にして「敷地は概算」を示す。

/** 描画順（下から上）。凡例の表示切替はこの全部を一括で切り替える。 */
export const BASE_ZONE_LAYER_IDS = [
  "base-check-outline",
  "base-yellow-fill",
  "base-yellow-outline",
  "base-red-fill",
  "base-red-hatch",
  "base-red-outline-approx",
  "base-red-outline",
] as const;

/** 斜線パターン画像の登録名（map.addImage）。 */
export const RED_HATCH_IMAGE_ID = "base-red-hatch-pattern";

export const BASE_ZONE_COLORS = {
  red: "#dc2626",
  redLine: "#991b1b",
  yellow: "#f59e0b",
  yellowLine: "#b45309",
  check: "#4b5563",
} as const;

/** 凡例に付ける文字ラベル（色だけに頼らない）。 */
export const BASE_ZONE_LEGEND = [
  {
    key: "site",
    label: "敷地・区域",
    note: "レッドゾーン・原則飛行禁止（敷地は概算）",
    swatch: "bg-red-600/35 ring-red-800 rounded-sm",
  },
  {
    key: "around",
    label: "周辺地域",
    note: "イエローゾーン・おおむね 1,000m・原則飛行禁止",
    swatch: "bg-amber-500/40 ring-amber-700 rounded-sm",
  },
  {
    key: "check",
    label: "要確認帯",
    note: "法定の範囲ではありません",
    swatch: "bg-transparent ring-gray-600 rounded-sm",
  },
] as const;

/** 斜線の画像（透明地に濃赤の斜線）。size px 四方の RGBA。 */
export const makeHatchImage = (size = 8): { width: number; height: number; data: Uint8Array } => {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if ((x + y) % size <= 1) {
        const i = (y * size + x) * 4;
        data[i] = 153;
        data[i + 1] = 27;
        data[i + 2] = 27;
        data[i + 3] = 190;
      }
    }
  }
  return { width: size, height: size, data };
};
