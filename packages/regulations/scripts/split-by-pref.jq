{
  type: "FeatureCollection",
  features: [
    .features[]
    | select(.properties["行政コード"] != null and (.properties["行政コード"][0:2] == $c))
    | {
        type,
        geometry,
        properties: {
          DIDid: .properties.DIDid,
          muniCode: .properties["行政コード"],
          muniName: .properties["市町村名称"],
          population: .properties["人口"],
          area: .properties["面積"],
          year: .properties["調査年度"]
        }
      }
  ]
}
