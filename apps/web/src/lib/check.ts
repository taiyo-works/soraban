import type { LatLng } from "@soraban/geo";
import type { FlightContext, RegulationCheckResult } from "@soraban/regulations";

export const checkLocation = async (
  loc: LatLng,
  ctx?: FlightContext,
  signal?: AbortSignal,
): Promise<RegulationCheckResult> => {
  const res = await fetch("/api/check", {
    method: "POST",
    headers: { "content-type": "application/json" },
    signal,
    body: JSON.stringify({ lat: loc.lat, lng: loc.lng, ctx }),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? `check failed (${res.status})`);
  }
  return (await res.json()) as RegulationCheckResult;
};
