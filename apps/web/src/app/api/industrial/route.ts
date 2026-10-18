import { NextResponse } from "next/server";
import { getBundledIndustrialFiles } from "@soraban/regulations";

// 地図の工業専用地域（DID 除外）レイヤー用。同梱の収録済み市町村のポリゴンを GeoJSON で返す。
// （ビルド時に静的生成されるため、INDUSTRIAL_DATA_DIR による差し替えは判定にのみ効き、このレイヤーには効かない。）
export async function GET() {
  const fc = {
    type: "FeatureCollection",
    features: getBundledIndustrialFiles().flatMap((file) =>
      file.zones.map((z) => ({
        type: "Feature",
        geometry: { type: "Polygon", coordinates: z.rings },
        properties: { muniCode: file.muniCode, muniName: file.muniName, source: file.source },
      })),
    ),
  };
  return NextResponse.json(fc, { headers: { "cache-control": "public, max-age=86400" } });
}
