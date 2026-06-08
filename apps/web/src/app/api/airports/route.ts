import { NextResponse } from "next/server";
import { AIRPORTS_GEOJSON } from "@soraban/regulations";

// 空港 GeoJSON は @soraban/regulations が静的 import で同梱しているため、
// ランタイムのファイル読み込みは不要 (Vercel serverless でも確実に配信できる)。
export async function GET() {
  return NextResponse.json(AIRPORTS_GEOJSON, {
    status: 200,
    headers: {
      "content-type": "application/geo+json",
      "cache-control": "public, max-age=86400",
    },
  });
}
