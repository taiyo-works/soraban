#!/usr/bin/env bash
# 国土数値情報「都市公園」(N06) を取得し、市町村コードごとに分割した
# data/parks/by-muni/{muniCode}.json を生成する。
#
# 出典: 国土数値情報（都市公園データ）（国土交通省）
#       https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N06.html
# ライセンス: 国土数値情報利用約款（出典明記で利用可）
#
# 注意: N06 のリリース年版は時期で変わる（v1.x / v2.x / 年度版）。
# URL 末尾はリリース時点で最新を確認のうえ書き換えること。Phase 1 段階の
# テスト時には N06-20240101 系を想定。
#
# 使い方:
#   bash scripts/fetch-parks.sh
#
# 期待される出力:
#   data/parks/raw/                    ← ダウンロード zip と解凍済 GML/GeoJSON（gitignore）
#   data/parks/by-muni/{muniCode}.json ← 抽出済データ（git 管理）

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
RAW_DIR="$PKG_DIR/data/parks/raw"
OUT_DIR="$PKG_DIR/data/parks/by-muni"

# TODO: N06 の最新リリース URL を入れる。当面は手動で raw/ に配置する運用も可。
URL="${SORABAN_N06_URL:-}"

mkdir -p "$RAW_DIR" "$OUT_DIR"

if [[ -z "$URL" ]]; then
  echo "==> SORABAN_N06_URL が未設定のため、ダウンロードはスキップします。"
  echo "    raw/ に N06 GeoJSON を手動配置してから extract-parks.jq を呼び出してください。"
  echo "    例: jq -f scripts/extract-parks.jq raw/N06.geojson > raw/all-parks.json"
  exit 0
fi

ZIP="$RAW_DIR/$(basename "$URL")"
SRC_DIR="$RAW_DIR/$(basename "$URL" .zip)"

if [[ ! -d "$SRC_DIR" ]]; then
  echo "==> downloading $(basename "$URL") ..."
  curl -fsSL -o "$ZIP" "$URL"
  echo "==> unzipping ..."
  unzip -q -o "$ZIP" -d "$RAW_DIR"
fi

# 想定: 解凍後 1 つの GeoJSON ファイルがある。複数あれば一番大きいものを採用。
SRC="$(find "$SRC_DIR" -name '*.geojson' -print0 | xargs -0 ls -S | head -n1)"

# 市町村コードごとにファイルを分けて出力する。
# Phase 1 では米子(31202)・境港(31204)・出雲(32203) の 3 市のみ。
for code in 31202 31204 32203; do
  echo "==> extracting muni=$code ..."
  jq --arg muni "$code" -f "$SCRIPT_DIR/extract-parks.jq" "$SRC" \
    > "$OUT_DIR/$code.json"
  count=$(jq '.parks | length' "$OUT_DIR/$code.json")
  echo "    -> $count parks written to $OUT_DIR/$code.json"
done

echo "==> done."
