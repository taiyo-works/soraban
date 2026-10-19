#!/usr/bin/env bash
# アドレス・ベース・レジストリ（デジタル庁）の鳥取県（31）・島根県（32）分を取得し、住所検索の同梱索引に変換する（Sprint 9）。
# GitHub Actions（.github/workflows/fetch-address-data.yml）での実行を想定（外部ネットワークが必要）。
#
#   bash packages/regulations/scripts/fetch-address-data.sh [--prefs "31 32"]
#
# - ダウンロード URL は推測しない。デジタル庁のデータセットサイトが公開する DCAT フィード
#   （abr-geocoder が使うものと同じ。https://dataset.address-br.digital.go.jp/api/feed/dcat-us/1.1.json）
#   を取得し、そこに載っている配布ファイル（.csv.zip）の URL だけを使う。
# - 取得する種類：市区町村（mt_city）、町字（mt_town_fullset）、住居表示の街区（mt_rsdtdsp_blk）・住居（mt_rsdtdsp_rsdt）、
#   地番（mt_parcel、市区町村ごと）。それぞれ本体（テキスト）と位置参照（_pos）の組。
# - 変換は build-address-index.mjs。件数・容量の計測結果と取得元 URL・最終更新日（版）を
#   data/address/stats.json と data/address/README.md に書く。
# 必要なコマンド：curl, unzip, node
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
WORK="${WORK_DIR:-$PKG_DIR/data/.fetch-work-address}"
TODAY="$(date -u +%Y-%m-%d)"
PREFS="31 32"
FEED_URL="${ABR_FEED_URL:-https://dataset.address-br.digital.go.jp/api/feed/dcat-us/1.1.json}"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --prefs) PREFS="$2"; shift 2 ;;
    *) echo "unknown arg $1"; exit 2 ;;
  esac
done

SUMMARY="$WORK/summary.md"
mkdir -p "$WORK"
: > "$SUMMARY"
log() { echo "$*" >&2; echo "- $*" >> "$SUMMARY"; }

log "DCAT フィード: $FEED_URL（取得日 $TODAY）"
if ! curl -fsSL --retry 3 -o "$WORK/feed.json" "$FEED_URL"; then
  log "失敗: DCAT フィードを取得できない"
  exit 1
fi
log "フィードの容量: $(wc -c < "$WORK/feed.json") bytes"

# フィードから対象の配布ファイルを選ぶ（category<TAB>url<TAB>最終更新日<TAB>ファイル名）。
node "$SCRIPT_DIR/select-address-files.mjs" "$WORK/feed.json" "$PREFS" "$WORK/manifest.tsv" >> "$SUMMARY"
if [[ ! -s "$WORK/manifest.tsv" ]]; then
  log "失敗: 対象の配布ファイルがフィードに見つからない"
  exit 1
fi
log "対象ファイル数: $(wc -l < "$WORK/manifest.tsv")"

# フィードの先頭のデータセット（配布ファイルの記述の確認用）
node -e 'const f=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); const d=(f.dataset||[]).find(x=>JSON.stringify(x).includes("mt_city_pref31")); console.log("\n### フィードの記述の例（mt_city_pref31）\n\n```json\n"+JSON.stringify(d,null,1).slice(0,3000)+"\n```\n"); console.log("フィードの最上位のキー: "+Object.keys(f).join(", ")+"\n");' "$WORK/feed.json" >> "$SUMMARY" || true
{ echo "### フィードの応答ヘッダー"; echo '```'; cat "$WORK/feed.headers" 2>/dev/null; echo '```'; } >> "$SUMMARY"

# 取得と展開（ZIP の中に ZIP がある場合も展開する）
fail=0
UA="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
# 1 つの URL を取得する。成功なら 0。最初の失敗だけ応答ヘッダーと本文をレポートに残す。
try_get() { # $1=url $2=out $3=label
  local code
  code="$(curl -sSL --retry 2 -A "$UA" -D "$WORK/dl.headers" -o "$2" -w '%{http_code}' "$1" 2>"$WORK/curl.err")"
  if [[ "$code" == "200" ]] && unzip -tq "$2" >/dev/null 2>&1; then return 0; fi
  if [[ -z "${logged[$3]:-}" ]]; then
    logged[$3]=1
    { echo "  - 取得できない（HTTP ${code}、経路=$3）$1"; echo '```'; grep -iE '^(HTTP|server|content-type|content-length|location|x-amz-cf-pop|x-cache)' "$WORK/dl.headers" 2>/dev/null; sed -e 's/<[^>]*>/ /g' "$2" 2>/dev/null | tr -s ' \n' ' ' | head -c 600; echo; echo '```'; } >> "$SUMMARY"
  fi
  return 1
}
declare -A logged
declare -A used
while IFS=$'\t' read -r category url modified file item; do
  zdir="$WORK/zip/$category"; cdir="$WORK/csv/$category"
  mkdir -p "$zdir" "$cdir"
  ok=0
  # ① 配布元（data.address-br.digital.go.jp）② ArcGIS のアイテムのデータ（配布元が接続元の国で制限される場合）
  if try_get "$url" "$zdir/$file" "配布元"; then ok=1; used["配布元"]=$(( ${used["配布元"]:-0} + 1 ))
  elif [[ -n "$item" ]] && try_get "https://www.arcgis.com/sharing/rest/content/items/$item/data" "$zdir/$file" "ArcGIS"; then
    ok=1; used["ArcGIS"]=$(( ${used["ArcGIS"]:-0} + 1 ))
    echo "$category	$url	https://www.arcgis.com/sharing/rest/content/items/$item/data" >> "$WORK/alt-sources.tsv"
  fi
  if [[ $ok -ne 1 && -n "$item" && -z "${logged[item]:-}" ]]; then
    logged[item]=1
    { echo "  - ArcGIS アイテムの情報（$item）"; echo '```'; curl -sS -A "$UA" "https://www.arcgis.com/sharing/rest/content/items/$item?f=json" | head -c 1500; echo; echo '```'; } >> "$SUMMARY"
  fi
  if [[ $ok -ne 1 ]]; then
    log "失敗: ダウンロード $url"; fail=1; continue
  fi
  if ! unzip -tq "$zdir/$file" >/dev/null 2>&1; then
    log "失敗: ZIP として読めない $url"; fail=1; continue
  fi
  tmp="$WORK/x/$category/${file%.zip}"
  mkdir -p "$tmp"
  unzip -qo "$zdir/$file" -d "$tmp"
  for _ in 1 2 3; do
    mapfile -t inner < <(find "$tmp" -iname '*.zip')
    [[ ${#inner[@]} -eq 0 ]] && break
    for z in "${inner[@]}"; do unzip -qo "$z" -d "$(dirname "$z")" && rm -f "$z"; done
  done
  find "$tmp" -iname '*.csv' -exec mv -f {} "$cdir/" \;
  rm -rf "$tmp"
done < "$WORK/manifest.tsv"

{
  echo
  echo "### 取得経路ごとのファイル数"
  echo
  for k in "${!used[@]}"; do echo "- $k: ${used[$k]}"; done
  echo
  echo "### 展開した CSV（種類ごとのファイル数・容量）"
  echo
  echo '```'
  for d in "$WORK"/csv/*/; do
    printf '%s\t%s files\t%s\n' "$(basename "$d")" "$(find "$d" -name '*.csv' | wc -l)" "$(du -sb "$d" | cut -f1) bytes"
  done
  echo '```'
  echo
  echo "### 各種類の先頭ファイルの先頭 3 行（列の確認用）"
  echo
  for d in "$WORK"/csv/*/; do
    f="$(find "$d" -name '*.csv' | sort | head -1)"
    [[ -z "$f" ]] && continue
    echo "- $(basename "$d")/$(basename "$f")"
    echo '```'
    head -3 "$f" | cut -c1-600
    echo '```'
  done
} >> "$SUMMARY"

node "$SCRIPT_DIR/build-address-index.mjs" \
  --work "$WORK" --manifest "$WORK/manifest.tsv" \
  --out "$PKG_DIR/data/address" --bundle "$PKG_DIR/src/data-bundle/address-bundle.ts" \
  --acquired "$TODAY" --feed "$FEED_URL" >> "$SUMMARY" 2>&1
status=$?
if [[ $status -ne 0 ]]; then log "失敗: build-address-index.mjs（終了コード $status）"; exit $status; fi
[[ $fail -ne 0 ]] && log "注意: 一部のファイルを取得できなかった（上記）"
exit 0
