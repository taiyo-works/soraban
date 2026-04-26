import type { LatLng } from "@soraban/geo";
import type { RegulationCheckResult } from "@soraban/regulations";

export const checkLocation = async (loc: LatLng): Promise<RegulationCheckResult> => {
  const res = await fetch("/api/check", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(loc),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? `check failed (${res.status})`);
  }
  return (await res.json()) as RegulationCheckResult;
};
