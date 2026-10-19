#!/bin/sh
# 住所検索の同梱索引（アドレス・ベース・レジストリ、鳥取県・島根県）を取得・生成する入口（Sprint 9）。
# 処理本体は fetch-address-data.mjs（Node.js 22 以上と unzip が必要。bash の版には依存しない）。
#   sh packages/regulations/scripts/fetch-address-data.sh [--prefs "31 32"]
# 配布元は日本国外からの接続を拒否するため、日本国内のネットワークで実行する。
exec node "$(dirname "$0")/fetch-address-data.mjs" "$@"
