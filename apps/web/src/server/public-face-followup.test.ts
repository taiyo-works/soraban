import { describe, expect, it, vi } from "vitest";
// 公開面の残り指摘（空港の dataYear・DIPS 2.0 の表記・条番号・プリフィルの要確認）の回帰。
// - 地点判定の証跡 ID は表示の文言を直しても変わらない（期待値は修正前 origin/main 3a1f4ae の値）。
// - 申請支援診断の証跡 ID は、手続きデータの確認日（PROCEDURES_VERIFIED_AT）を 2026-06-22 → 2026-10-19 に
//   更新したため、これ以降の診断では変わる（データの版が変わったことを表す）。変わる理由が確認日だけで
//   あることを、確認日を旧値に戻したペイロードが修正前の証跡 ID と一致することで確かめる。
//   Sprint 11a（制度データ revision 2）で証跡ペイロードに d.rev が加わった。確認日（2026-10-19）は同じなので、
//   変わる理由は revision と確認日だけであることを、rev を除き確認日を旧値に戻したペイロードで確かめる
//   （このテストの入力は Sprint 11a でカテゴリー・手続きが変わらない夜間・目視外）。
// - 履歴（localStorage）に保存済みの証跡 ID は文字列として保存・表示され、再計算しないので変わらない。
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildDiagnosisEvidencePayload,
  createIndustrialSource,
  deriveDiagnosis,
  didBundleToDataset,
  ENGINE_VERSION,
  industrialBundleToZones,
  PROCEDURES_REVISION,
  PROCEDURES_VERIFIED_AT,
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
import { loadHistory } from "@/lib/history";

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

  it("申請支援診断の証跡 ID は手続きデータの確認日の更新でだけ変わる（夜間・目視外・DID 未確認）", async () => {
    const r = await runRegulationCheckWith(provider("31204"), AIRPORT_NEAR, { droneWeightG: 900 }, FIXED_NOW);
    const flags = ["method_night", "method_bvlos"] as const;
    const d = deriveDiagnosis({ flags, droneWeightG: 900, didStatus: "unverified" });
    const input = {
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
    };
    const id = computeDiagnosisEvidenceId(input);
    // 修正前（確認日 2026-06-22）に同じ入力から求めた証跡 ID
    const BEFORE = "ev_2ec971405bc30043";
    expect(PROCEDURES_VERIFIED_AT).toBe("2026-10-19T00:00:00+09:00");
    expect(id).not.toBe(BEFORE);

    // 制度データの revision（Sprint 11a で追加した d.rev）を除き、確認日を旧値に戻したペイロードは、
    // 修正前の証跡 ID と一致する（ほかの入力は変わっていない）
    const payload = buildDiagnosisEvidencePayload({ ...input, engineVersion: ENGINE_VERSION });
    const ver = JSON.stringify(PROCEDURES_VERIFIED_AT);
    expect(payload.split(ver)).toHaveLength(2);
    expect(payload.split(`,"rev":${PROCEDURES_REVISION}`)).toHaveLength(2);
    const oldPayload = payload
      .replace(`,"rev":${PROCEDURES_REVISION}`, "")
      .replace(ver, JSON.stringify("2026-06-22T00:00:00+09:00"));
    const sha16 = (s: string) => `ev_${createHash("sha256").update(s).digest("hex").slice(0, 16)}`;
    expect(sha16(oldPayload)).toBe(BEFORE);
    expect(sha16(payload)).toBe(id);
  });

  it("履歴に保存済みの申請支援の証跡 ID（旧形式を含む）は読み込みで変わらない", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
      },
      dispatchEvent: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    try {
      store.set(
        "soraban:history:v1",
        JSON.stringify([
          {
            evidenceId: "ev_5722337c7b5f785e",
            savedAt: "2026-10-18T00:00:00.000Z",
            loc: AIRPORT_NEAR,
            overall: "unknown",
            engineVersion: ENGINE_VERSION,
            checkedAt: "2026-10-18T00:00:00.000Z",
            diagnosisSummary: {
              diagnosisEvidenceId: "ev_2ec971405bc30043",
              category: "II_A",
              isSpecificFlight: true,
              procedureCount: 4,
            },
          },
          {
            evidenceId: "ev_legacy0000000001",
            savedAt: "2026-06-01T00:00:00.000Z",
            loc: { lat: 35.4278, lng: 133.3314 },
            overall: "red",
            engineVersion: "soraban-0.2.0-clausegraph",
            checkedAt: "2026-06-01T00:00:00.000Z",
          },
        ]),
      );
      const h = loadHistory();
      expect(h).toHaveLength(2);
      const ids = new Map(h.map((e) => [e.evidenceId, e]));
      expect(ids.get("ev_5722337c7b5f785e")?.diagnosisSummary?.diagnosisEvidenceId).toBe("ev_2ec971405bc30043");
      expect(ids.get("ev_legacy0000000001")?.diagnosisSummary).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
