import { NextResponse } from "next/server";

const GSI_ENDPOINT = "https://msearch.gsi.go.jp/address-search/AddressSearch";

type GsiFeature = {
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: { addressCode: string; title: string };
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim() ?? "";
  if (q.length === 0) {
    return NextResponse.json({ error: "missing q" }, { status: 400 });
  }
  const url = `${GSI_ENDPOINT}?q=${encodeURIComponent(q)}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "soraban-geocoder/0.0.0" },
    next: { revalidate: 3600 },
  });
  if (!res.ok) {
    return NextResponse.json({ error: `GSI ${res.status}` }, { status: 502 });
  }
  const data = (await res.json()) as readonly GsiFeature[];
  const results = data.slice(0, 5).map((f) => ({
    title: f.properties.title,
    addressCode: f.properties.addressCode,
    lng: f.geometry.coordinates[0],
    lat: f.geometry.coordinates[1],
  }));
  return NextResponse.json({ results });
}
