import { NextResponse } from "next/server";
import { readDidBundleFile } from "@/server/regulation-data-dir";

// 地図の DID レイヤー用。同梱データ（鳥取県・島根県の令和2年 DID）を GeoJSON で返す。
// DID_DATA_DIR があればそちらを優先する。未整備の都道府県は 404。
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ pref: string }> },
) {
  const { pref } = await ctx.params;
  if (!/^\d{2}$/.test(pref)) {
    return NextResponse.json({ error: "invalid pref code" }, { status: 400 });
  }
  const file = await readDidBundleFile(pref);
  if (!file) return NextResponse.json({ error: "not found" }, { status: 404 });
  const fc = {
    type: "FeatureCollection",
    features: file.features.map((f) => ({
      type: "Feature",
      geometry: { type: "Polygon", coordinates: f.rings },
      properties: { muniCode: f.muniCode, muniName: f.muniName, baseYear: file.baseYear },
    })),
  };
  return new NextResponse(JSON.stringify(fc), {
    status: 200,
    headers: {
      "content-type": "application/geo+json",
      "cache-control": "public, max-age=86400",
    },
  });
}
