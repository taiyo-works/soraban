import { describe, expect, it } from "vitest";
// 公開面の残り指摘（空港の dataYear・DIPS 2.0 の表記・条番号・プリフィルの要確認）の回帰。
// 表示の文言を直しても、地点判定・申請支援診断の証跡 ID は変わらない。
// 期待値は修正前のコード（origin/main 3a1f4ae）で同じ入力から求めた値。
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createIndustrialSource,
  deriveDiagnosis,
  didBundleToDataset,
  ENGINE_VERSION,
  industrialBundleToZones,
  type DidBundleFile,
  type IndustrialBundleFile,
  type IndustrialCoverageEntry,
} from "@soraban/regulations";
import {
  collectDatasets,
  computeDiagnosisEvidenceId,
  runRegulationCheckWith,
  type RegulationDataProvider,
} from "./check-core";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../../e2e/fixtures");
const readJson = <T,>(rel: string): T => JSON.parse(readFileSync(path.join(FIXTURES, rel), "utf8")) as T;

const didFile = readJson<DidBundleFile>("did/pref-31.json");
const coverage = readJson<{ municipalities: IndustrialCoverageEntry[] }>("industrial/coverage.json");
const sakaiZones = readJson<IndustrialBundleFile>("industrial/by-muni/31204.json");

const provider = (muniCode: string): RegulationDataProvider => ({
  loadDid: async (pref) => (pref === "31" ? didBundleToDataset(didFile) : null),
  didPrefCodes: async () => ["31"],
  industrial: createIndustrialSource({
    coverage: coverage.municipalities,
    zonesByMuni: { "31204": industrialBundleToZones(sakaiZones) },
    insideMarginM: 10,
  }),
  reverseGeocode: async () => ({ muniCode }),
});

const FIXED_NOW = () => new Date("2026-10-19T00:00:00.000Z");
const AIRPORT_NEAR = { lat: 35.4936, lng: 133.2361 };

describe("公開面の残り指摘：証跡 ID の回帰", () => {
  it("空港のカードに基準年（dataYear）を付けない。DID は基準年 2020 のまま", async () => {
    const r = await runRegulationCheckWith(provider("31204"), AIRPORT_NEAR, { droneWeightG: 900 }, FIXED_NOW);
    expect(r.regulations.find((x) => x.id === "aviation-law-airport")?.dataYear).toBeUndefined();
    expect(r.regulations.find((x) => x.id === "aviation-law-did")?.dataYear).toBe(2020);
  });

  it("地点判定の証跡 ID が変わらない（空港の近傍）", async () => {
    const r = await runRegulationCheckWith(provider("31204"), AIRPORT_NEAR, { droneWeightG: 900 }, FIXED_NOW);
    expect(r.engineVersion).toBe(ENGINE_VERSION);
    expect(r.evidenceId).toBe("ev_5722337c7b5f785e");
  });

  it("申請支援診断の証跡 ID が変わらない（夜間・目視外・DID 未確認）", async () => {
    const r = await runRegulationCheckWith(provider("31204"), AIRPORT_NEAR, { droneWeightG: 900 }, FIXED_NOW);
    const flags = ["method_night", "method_bvlos"] as const;
    const d = deriveDiagnosis({ flags, droneWeightG: 900, didStatus: "unverified" });
    const id = computeDiagnosisEvidenceId({
      lat: AIRPORT_NEAR.lat,
      lng: AIRPORT_NEAR.lng,
      checkedAt: r.checkedAt,
      regulationIds: r.regulations.map((x) => x.id),
      droneWeightG: 900,
      flags,
      category: d.category,
      procedureIds: d.procedures.map((p) => p.id),
      didStatus: d.didStatus,
      datasets: collectDatasets(r.regulations),
    });
    expect(id).toBe("ev_2ec971405bc30043");
  });
});
