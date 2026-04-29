# 国土数値情報 N06「都市公園」GeoJSON を、Soraban 内部スキーマ
# {muniCode, muniName, parks: [{id, name, polygon: [{lat,lng}...]}]} に変換する。
#
# 入力: $muni (市町村コード, 例 "31202")
# 出力: 当該市町村の公園のみを抽出した JSON。
#
# N06 のフィールド名は版によって変わる可能性がある。Phase 1 着手時の代表的キー名:
#   N06_001  整備主体コード（市町村コード）
#   N06_005  公園名
#   N06_011  公園の種別
# 不一致の場合は実 GeoJSON の properties を確認して書き換える。

def coordsToLatLng:
  # GeoJSON の座標は [lng, lat] 並び。Polygon は外周リング 1 つを採用する。
  if type == "array" and (.[0] | type) == "array" and (.[0][0] | type) == "array"
  then .[0]
  else .
  end
  | map({ lat: .[1], lng: .[0] });

def featureToPark:
  . as $f
  | {
      id: ($f.properties["N06_005"] // $f.properties.name // "park-\($f.id // "x")") | tostring | gsub("\\s"; "-"),
      name: ($f.properties["N06_005"] // $f.properties.name // "公園"),
      polygon:
        ( if $f.geometry.type == "MultiPolygon"
          then $f.geometry.coordinates[0][0]
          else $f.geometry.coordinates[0]
          end
          | coordsToLatLng
        )
    };

{
  muniCode: $muni,
  # muniName は呼び出し側 (fetch-parks.sh) が必要に応じて差し替える。
  muniName: "",
  prefCode: ($muni[:2]),
  source: "国土数値情報 N06 都市公園 から自動生成",
  verifiedAt: (now | todateiso8601),
  parks: [
    .features[]
    | select(.properties["N06_001"] == $muni)
    | featureToPark
  ]
}
