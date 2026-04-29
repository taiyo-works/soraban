import { NextResponse } from "next/server";
import { isValidLatLng } from "@soraban/geo";
import type { FlightContext } from "@soraban/regulations";
import { runRegulationCheck } from "@/server/regulation-check";

// FlightContext を信頼境界で正規化する。
// 不正値はサニタイズし、type 安全な形に直してから評価器へ渡す。
const parseFlightContext = (raw: unknown): FlightContext | undefined => {
  if (!raw || typeof raw !== "object") return undefined;
  const obj = raw as Record<string, unknown>;
  const ctx: { -readonly [K in keyof FlightContext]: FlightContext[K] } = {};

  if (typeof obj["droneWeightG"] === "number" && Number.isFinite(obj["droneWeightG"]) && obj["droneWeightG"] >= 0) {
    ctx.droneWeightG = obj["droneWeightG"];
  }
  if (Array.isArray(obj["pilotPermits"])) {
    const permits = obj["pilotPermits"].filter((p): p is string => typeof p === "string");
    if (permits.length > 0) ctx.pilotPermits = permits;
  }
  if (typeof obj["purpose"] === "string" && obj["purpose"].length > 0) {
    ctx.purpose = obj["purpose"];
  }
  if (typeof obj["droneClass"] === "string" && obj["droneClass"].length > 0) {
    ctx.droneClass = obj["droneClass"];
  }
  return Object.keys(ctx).length > 0 ? ctx : undefined;
};

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
  const ctx = parseFlightContext((body as { ctx?: unknown })?.ctx);
  const result = await runRegulationCheck({ lat, lng }, ctx);
  return NextResponse.json(result);
}
