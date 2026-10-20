import { describe, expect, it } from "vitest";
// Sprint 10a（公開面の整備）の回帰：判定の注記の文言を変えても証跡 ID とエンジン版は変わらない。
//
// 期待値の証跡 ID は、注記の文言を変える前のコード（origin/main e133d52）で同じ入力から求めた値。
// 証跡 ID の入力は版・座標・時刻・規制 ID・データセットの確認日だけで、注記（note・description）は含まない。
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildCheckEvidencePayload,
  createIndustrialSource,
  didBundleToDataset,
  ENGINE_VERSION,
  PREVIOUS_ENGINE_VERSIONS,
  industrialBundleToZones,
  type DidBundleFile,
  type IndustrialBundleFile,
  type IndustrialCoverageEntry,
} from "@soraban/regulations";
import { collectDatasets, runRegulationCheckWith, type RegulationDataProvider } from "./check-core";

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

// 注記の文言を変えた箇所（収録範囲外・公園区域外・史跡区域外・空港の簡易バッファ）を通る地点。
// expected：0.3.0（soraban-0.3.0-regulations-2026-07）で求めた証跡 ID（origin/main e133d52 の値）。
// current：Sprint 11d で ENGINE_VERSION を soraban-0.4.0-verdict-2026-10 に上げた後の値。
//   証跡 ID の正規化（buildCheckEvidencePayload）は変えておらず、版の文字列だけが変わったため ID が変わる
//   （docs/sprints/sprint-11d.md C2・C3）。0.3.0 の値は、旧版の文字列を渡したペイロードで再現できることを下で確かめる。
const CASES = [
  { name: "米子市役所（米子市・公園区域外）", loc: { lat: 35.4278, lng: 133.3314 }, muni: "31202", expected: "ev_cf443e9936ac39c3", current: "ev_5d3361a568bbccda" },
  { name: "本社（日吉津村・収録範囲外）", loc: { lat: 35.434238, lng: 133.380508 }, muni: "31390", expected: "ev_69cfc597d64dbf4f", current: "ev_d10a64e866e43753" },
  { name: "米子空港の近傍（境港市）", loc: { lat: 35.4936, lng: 133.2361 }, muni: "31204", expected: "ev_5722337c7b5f785e", current: "ev_b1b3638077844afd" },
  { name: "出雲大社の近傍（出雲市）", loc: { lat: 35.4019, lng: 132.6855 }, muni: "32203", expected: "ev_cd776d39f6cfd29a", current: "ev_13907119ecc9371c" },
] as const;

const OLD_ENGINE_VERSION = "soraban-0.3.0-regulations-2026-07";
const sha16 = (payload: string): string =>
  `ev_${createHash("sha256").update(payload).digest("hex").slice(0, 16)}`;

describe("Sprint 10a 回帰：証跡 ID とエンジン版（Sprint 11d で版を上げた）", () => {
  it("ENGINE_VERSION は soraban-0.4.0-verdict- で始まり、0.3.0 は過去の版に含まれる", () => {
    expect(ENGINE_VERSION).toMatch(/^soraban-0\.4\.0-verdict-/);
    expect(PREVIOUS_ENGINE_VERSIONS).toContain(OLD_ENGINE_VERSION);
  });

  for (const c of CASES) {
    it(`旧版の文字列を渡したペイロードから 0.3.0 の証跡 ID を再現できる：${c.name}`, async () => {
      const r = await runRegulationCheckWith(provider(c.muni), c.loc, { droneWeightG: 900 }, FIXED_NOW);
      const payload = buildCheckEvidencePayload({
        engineVersion: OLD_ENGINE_VERSION,
        lat: c.loc.lat,
        lng: c.loc.lng,
        checkedAt: r.checkedAt,
        regulationIds: r.regulations.map((x) => x.id),
        ctx: { droneWeightG: 900 },
        datasets: collectDatasets(r.regulations),
      });
      expect(sha16(payload)).toBe(c.expected);
    });

    it(`同じ座標・同じ条件・同じ時刻の現行版の証跡 ID：${c.name}`, async () => {
      const r = await runRegulationCheckWith(provider(c.muni), c.loc, { droneWeightG: 900 }, FIXED_NOW);
      expect(r.engineVersion).toBe(ENGINE_VERSION);
      expect(r.evidenceId).toBe(c.current);
      expect(r.evidenceId).not.toBe(c.expected);
    });
  }

  it("判定の注記・説明に社内の段階名が出ない", async () => {
    for (const c of CASES) {
      const r = await runRegulationCheckWith(provider(c.muni), c.loc, { droneWeightG: 900 }, FIXED_NOW);
      const text = JSON.stringify(r.regulations);
      expect(text).not.toMatch(/PoC|Phase/);
    }
  });
});
