// 各規制レコードに付随する確信度メタデータ（特許①コア）。
//
// LLM抽出やバッファ近似など、不確実性が混入する経路を通ったデータを
// 二値で扱わず、判定出力と一緒に確信度を伝播させる。
// 監査・損保引受時の証跡として用いるため、verifiedAt は必ず保持する。

export type ConfidenceLevel = "high" | "medium" | "low";

export type RegulationConfidence = {
  // 判定に使うジオメトリの精度
  // high   = 公的GISデータをそのまま使用
  // medium = 半径バッファ・公開資料からの近似ポリゴン
  // low    = 文字列住所からの推定
  readonly geometric: ConfidenceLevel;
  // 条文抽出の精度
  // high   = 人手検証済み
  // medium = LLM抽出かつ自動検証パス
  // low    = LLM抽出のみ
  readonly extraction: ConfidenceLevel;
  // 最終検証日時 (ISO 8601)
  readonly verifiedAt: string;
};

export const CONFIDENCE_LABEL: Readonly<Record<ConfidenceLevel, string>> = {
  high: "高",
  medium: "中",
  low: "低",
};

const CONFIDENCE_ORDER: Readonly<Record<ConfidenceLevel, number>> = {
  low: 0,
  medium: 1,
  high: 2,
};

// 2軸の確信度を1軸の表示用ラベルに集約する（より低い方を採用）。
export const summarizeConfidence = (c: RegulationConfidence): ConfidenceLevel =>
  CONFIDENCE_ORDER[c.geometric] <= CONFIDENCE_ORDER[c.extraction]
    ? c.geometric
    : c.extraction;

// 特許①従属項8 の「所定の閾値」を実装上は medium に固定する。
// summarizeConfidence の結果が medium 以下（= medium or low）のとき、
// 判定結果に「現地での再確認を促す警告」を併せて出力する根拠とする。
export const LOW_CONFIDENCE_THRESHOLD: ConfidenceLevel = "medium";

export const shouldWarnConfidence = (level: ConfidenceLevel): boolean =>
  CONFIDENCE_ORDER[level] <= CONFIDENCE_ORDER[LOW_CONFIDENCE_THRESHOLD];
