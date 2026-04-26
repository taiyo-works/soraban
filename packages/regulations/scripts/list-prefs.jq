[.features[].properties["行政コード"] | select(. != null) | .[0:2]] | unique | .[]
