#!/usr/bin/env bash
# 地図データ（DID 令和2年・工業専用地域）を国土数値情報から取得し、同梱形式に変換する。
# GitHub Actions（.github/workflows/fetch-regulation-data.yml）での実行を想定（外部ネットワークが必要）。
#
#   bash packages/regulations/scripts/fetch-regulation-data.sh [--prefs "31 32"] [--skip-industrial]
#
# - ダウンロード URL は推測しない。国土数値情報のダウンロードページ（HTML）を取得し、
#   そこに書かれているファイル名（例：A16-20_31_GML.zip）を含むリンクを抜き出して使う。
#   見つからない・ZIP として壊れている場合はその入手元をスキップしてログに残す（失敗にしない）。
# - 変換は build-did-r2.mjs・build-industrial-from-a29.mjs（→ build-industrial-exclusive.mjs）。
# - 出典・取得日は sources.json・coverage.json に自動で記録する（record-regulation-sources.mjs）。
# - 合計容量が 10MB を超えても失敗にせず、サイズをログに出す（ALLOW_OVERSIZE=1 で build-did-r2 に渡す）。
# 必要なコマンド：curl, unzip, node, ogr2ogr（Shapefile しか無い場合）
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
WORK="${WORK_DIR:-$PKG_DIR/data/.fetch-work}"
TODAY="$(date -u +%Y-%m-%d)"
PREFS="31 32"
SKIP_INDUSTRIAL=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --prefs) PREFS="$2"; shift 2 ;;
    --skip-industrial) SKIP_INDUSTRIAL=1; shift ;;
    *) echo "unknown arg $1"; exit 2 ;;
  esac
done

DID_PAGE="https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-A16-2020.html"
A29_PAGE="https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-A29-v2_1.html"
SUMMARY="$WORK/summary.md"
mkdir -p "$WORK"
: > "$SUMMARY"
log() { echo "$*" >&2; echo "- $*" >> "$SUMMARY"; }

# ページ HTML から、指定ファイル名を含むリンクを抜き出して絶対 URL にする。
find_link() { # $1=page_url $2=html_file $3=filename
  node -e '
    const [page, file, name] = process.argv.slice(1);
    const html = require("fs").readFileSync(file, "utf8");
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`["\x27]([^"\x27\\s]*${esc})["\x27]`, "g");
    const hits = [...html.matchAll(re)].map((m) => m[1]);
    // パス区切りを含むものを優先（ファイル名だけの引数より確実）
    const best = hits.find((h) => h.includes("/")) ?? hits[0];
    if (!best) process.exit(1);
    console.log(new URL(best, page).toString());
  ' "$1" "$2" "$3"
}

# ZIP を取得・検証・展開し、GeoJSON のパスを返す（Shapefile のみなら ogr2ogr で変換）。
fetch_geojson() { # $1=page_url $2=html $3=zipname $4=outdir
  local url
  if ! url="$(find_link "$1" "$2" "$3")"; then
    log "スキップ: $1 に $3 へのリンクが見つからない"
    return 1
  fi
  log "取得: $url"
  mkdir -p "$4"
  if ! curl -fsSL --retry 3 -o "$4/$3" "$url"; then
    log "スキップ: ダウンロード失敗 $url"
    return 1
  fi
  if ! unzip -tq "$4/$3" >/dev/null 2>&1; then
    log "スキップ: ZIP として読めない $url"
    return 1
  fi
  { echo "  - ZIP 内のファイル（$3）:"; unzip -Z1 "$4/$3" | sed 's/^/    - /'; } >> "$SUMMARY"
  unzip -qo "$4/$3" -d "$4/x"
  local gj
  gj="$(find "$4/x" -iname '*.geojson' | head -1)"
  if [[ -n "$gj" ]]; then echo "$gj"; return 0; fi
  local shp
  shp="$(find "$4/x" -iname '*.shp' | head -1)"
  if [[ -z "$shp" ]]; then
    log "スキップ: $3 に GeoJSON も Shapefile も無い"
    return 1
  fi
  local enc=()
  [[ -f "${shp%.*}.cpg" ]] || enc=(-oo ENCODING=CP932)
  if ! ogr2ogr -f GeoJSON -t_srs EPSG:4326 "${enc[@]}" "$4/converted.geojson" "$shp" >&2; then
    log "スキップ: ogr2ogr 変換失敗 $shp"
    return 1
  fi
  echo "$4/converted.geojson"
}

# ── DID（A16-20）──
DID_HTML="$WORK/a16-2020.html"
DID_INPUTS=()
DID_DONE=""
if curl -fsSL --retry 3 -o "$DID_HTML" "$DID_PAGE"; then
  for p in $PREFS; do
    if gj="$(fetch_geojson "$DID_PAGE" "$DID_HTML" "A16-20_${p}_GML.zip" "$WORK/did-$p")"; then
      node -e 'const f=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log("DID 属性（先頭地物）:",JSON.stringify(f.features[0]?.properties))' "$gj" | tee -a "$SUMMARY"
      DID_INPUTS+=("$gj")
      DID_DONE="$DID_DONE $p"
    fi
  done
else
  log "スキップ: DID のダウンロードページを取得できない $DID_PAGE"
fi
if [[ ${#DID_INPUTS[@]} -gt 0 ]]; then
  MERGED="$WORK/did-merged.geojson"
  node -e '
    const fs=require("fs"); const files=process.argv.slice(2);
    const features=files.flatMap(f=>JSON.parse(fs.readFileSync(f,"utf8")).features);
    fs.writeFileSync(process.argv[1], JSON.stringify({type:"FeatureCollection",features}));
  ' "$MERGED" "${DID_INPUTS[@]}"
  if ALLOW_OVERSIZE=1 node "$SCRIPT_DIR/build-did-r2.mjs" --in "$MERGED" --prefs "$(echo $DID_DONE | tr ' ' ',')" 2>&1 | tee -a "$SUMMARY"; then
    node "$SCRIPT_DIR/record-regulation-sources.mjs" did --date "$TODAY" --prefs "$(echo $DID_DONE | tr ' ' ',')" --page "$DID_PAGE" | tee -a "$SUMMARY"
  else
    log "DID の変換に失敗（上のログを参照）"
  fi
fi

# ── 工業専用地域（A29 用途地域 令和元年度）──
if [[ $SKIP_INDUSTRIAL -eq 0 ]]; then
  A29_HTML="$WORK/a29.html"
  if curl -fsSL --retry 3 -o "$A29_HTML" "$A29_PAGE"; then
    for p in $PREFS; do
      if gj="$(fetch_geojson "$A29_PAGE" "$A29_HTML" "A29-19_${p}_GML.zip" "$WORK/a29-$p")"; then
        node "$SCRIPT_DIR/build-industrial-from-a29.mjs" --in "$gj" --pref "$p" --date "$TODAY" --page "$A29_PAGE" 2>&1 | tee -a "$SUMMARY"
      fi
    done
  else
    log "スキップ: 用途地域（A29）のダウンロードページを取得できない $A29_PAGE"
  fi
fi

# ── 容量 ──
du -sh "$PKG_DIR/data/did/r2" "$PKG_DIR/data/industrial-exclusive/by-muni" 2>/dev/null | tee -a "$SUMMARY"
total=$(du -cb "$PKG_DIR"/data/did/r2/*.json "$PKG_DIR"/data/industrial-exclusive/by-muni/*.json 2>/dev/null | tail -1 | cut -f1)
log "同梱データ合計: ${total:-0} bytes（目安 10MB = 10485760 bytes）"
if [[ "${total:-0}" -gt 10485760 ]]; then
  log "警告: 合計が 10MB を超えている。同梱の可否をオーケストレーターに確認すること"
fi
echo "summary: $SUMMARY"
exit 0
