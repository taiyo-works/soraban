#!/usr/bin/env bash
# 国土数値情報「空港」(C28-20, 令和2年度) を取得し、
# 「供用中」のみ抽出した GeoJSON を生成する。
#
# 出典: 国土数値情報（空港データ）（国土交通省）
#       https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-C28-v2_4.html
# ライセンス: 国土数値情報利用約款（出典明記で利用可）

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
RAW_DIR="$PKG_DIR/data/airports/raw"
OUT="$PKG_DIR/data/airports/airports.geojson"

URL="https://nlftp.mlit.go.jp/ksj/gml/data/C28/C28-20/C28-20_GML.zip"
ZIP="$RAW_DIR/C28-20_GML.zip"
SRC="$RAW_DIR/C28-20_GML/C28-20_Airport.geojson"

mkdir -p "$RAW_DIR"

if [[ ! -f "$SRC" ]]; then
  echo "==> downloading $(basename "$URL") ..."
  curl -fsSL -o "$ZIP" "$URL"
  echo "==> unzipping ..."
  unzip -q -o "$ZIP" -d "$RAW_DIR"
fi

echo "==> extracting operational airports ..."
jq -f "$SCRIPT_DIR/extract-airports.jq" "$SRC" > "$OUT"
count=$(jq '.features|length' "$OUT")
size=$(du -h "$OUT" | awk '{print $1}')
echo "==> done. $count airports, $size"
