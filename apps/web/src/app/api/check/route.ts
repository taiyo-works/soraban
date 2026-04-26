import { NextResponse } from "next/server";
import { isValidLatLng } from "@soraban/geo";
import { runRegulationCheck } from "@/server/regulation-check";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const lat = Number((body as { lat?: unknown })?.lat);
  const lng = Number((body as { lng?: unknown })?.lng);
  if (!isValidLatLng({ lat, lng })) {
    return NextResponse.json({ error: "invalid lat/lng" }, { status: 400 });
  }
  const result = await runRegulationCheck({ lat, lng });
  return NextResponse.json(result);
}
