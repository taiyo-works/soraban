import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import type { LatLng } from "@soraban/geo";
import type { DidDataset, FlightContext, RegulationCheckResult } from "@soraban/regulations";
import {
  computeDiagnosisEvidenceId,
  runRegulationCheckWith,
  type RegulationDataProvider,
  type ReverseGeocode,
} from "./check-core";
import { getIndustrialSource, listDidPrefCodes, readDidDataset } from "./regulation-data-dir";

// 判定エンジンの版・証跡 ID の採番は check-core（@soraban/regulations の ENGINE_VERSION）に集約。
export { computeDiagnosisEvidenceId };

const loadPrefDid = async (prefCode: string): Promise<DidDataset | null> => {
  "use cache";
  cacheLife("days");
  cacheTag("regulation-data:did", `regulation-data:did:pref-${prefCode}`);
  return readDidDataset(prefCode);
};

const reverseGeocode = async (loc: LatLng): Promise<ReverseGeocode> => {
  const url = `https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress?lon=${loc.lng}&lat=${loc.lat}`;
  try {
    const res = await fetch(url, {
      headers: { accept: "application/json" },
      // GSI 推奨: keep small, no body
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return {};
    const data = (await res.json()) as { results?: { muniCd?: string; lv01Nm?: string } };
    const muniCd = data.results?.muniCd;
    const muniCode =
      typeof muniCd === "string" && /^\d{5,6}$/.test(muniCd)
        ? muniCd.padStart(5, "0").slice(-5)
        : undefined;
    return { muniCode, address: data.results?.lv01Nm };
  } catch {
    return {};
  }
};

const defaultProvider = async (): Promise<RegulationDataProvider> => ({
  loadDid: loadPrefDid,
  didPrefCodes: listDidPrefCodes,
  industrial: await getIndustrialSource(),
  reverseGeocode,
});

export const runRegulationCheck = async (
  loc: LatLng,
  ctx?: FlightContext,
): Promise<RegulationCheckResult> => runRegulationCheckWith(await defaultProvider(), loc, ctx);
