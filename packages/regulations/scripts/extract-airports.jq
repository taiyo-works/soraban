{
  type: "FeatureCollection",
  features: [
    .features[]
    | select(.properties["C28_004"] == "供用中")
    | . as $f
    | (.geometry.coordinates[0] // []) as $ring
    | ([$ring[][0]] | (min as $x1 | max as $x2 | ($x1 + $x2) / 2)) as $cx
    | ([$ring[][1]] | (min as $y1 | max as $y2 | ($y1 + $y2) / 2)) as $cy
    | {
        type: "Feature",
        geometry: .geometry,
        properties: {
          id: .properties["C28_001"],
          name: .properties["C28_005"],
          status: .properties["C28_004"],
          centerLng: $cx,
          centerLat: $cy
        }
      }
  ]
}
