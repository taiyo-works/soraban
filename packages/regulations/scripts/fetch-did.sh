#!/usr/bin/env bash
# 国土数値情報「人口集中地区」(A16-15, 平成27年国勢調査) の全国データを取得し、
# 都道府県別の GeoJSON に分割する。
#
# 出典: 国土数値情報（人口集中地区データ）（国土交通省）
#       https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-A16.html
# ライセンス: 国土数値情報利用約款（出典明記で利用可）

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
RAW_DIR="$PKG_DIR/data/did/raw"
OUT_DIR="$PKG_DIR/data/did/by-pref"

URL="https://nlftp.mlit.go.jp/ksj/gml/data/A16/A16-15/A16-15_GML.zip"
ZIP="$RAW_DIR/A16-15_GML.zip"
SRC="$RAW_DIR/A16-15_GML/A16-15_00_DID.geojson"

mkdir -p "$RAW_DIR" "$OUT_DIR"

if [[ ! -f "$SRC" ]]; then
  echo "==> downloading $(basename "$URL") ..."
  curl -fsSL -o "$ZIP" "$URL"
  echo "==> unzipping ..."
  unzip -q -o "$ZIP" -d "$RAW_DIR"
fi

echo "==> splitting per prefecture ..."
for code in $(jq -r -f "$SCRIPT_DIR/list-prefs.jq" "$SRC"); do
  jq --arg c "$code" -f "$SCRIPT_DIR/split-by-pref.jq" "$SRC" > "$OUT_DIR/pref-$code.geojson"
done

count=$(ls "$OUT_DIR"/*.geojson | wc -l | tr -d ' ')
total=$(du -sh "$OUT_DIR" | awk '{print $1}')
echo "==> done. $count files, $total"
