// Sprint 11e 契約 1〜8・15（単体）：100g 未満の機体（模型航空機）の手続きと、100g 以上・未指定の結果の不変。
// 地点判定と申請支援の診断は、同梱データ（DID・工業専用地域・空港・飛行禁止法の対象施設）で求める。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DIPS_PERMIT_KINDS,
  dipsPermitValue,
  ENGINE_VERSION,
  MODEL_AIRCRAFT_DEADLINE_LABEL,
  MODEL_AIRCRAFT_REFERENCES,
  type FlightContext,
  type FlightVerdict,
  type SpecificFlightFlag,
} from "@soraban/regulations";
import { runRegulationCheckWith } from "./check-core";
import { handleDiagnosePost } from "./handlers";
import {
  BASELINE_FLAGS,
  BASELINE_LOCATIONS,
  BASELINE_NOW,
  BASELINE_WEIGHTS,
  baselineCtx,
  baselineKey,
  baselineProvider,
} from "./sprint11e-baseline";

type Loc = { readonly lat: number; readonly lng: number };
const LOC = Object.fromEntries(BASELINE_LOCATIONS.map((l) => [l.name, l])) as Record<
  (typeof BASELINE_LOCATIONS)[number]["name"],
  (typeof BASELINE_LOCATIONS)[number]
>;

const diagnose = async (
  l: { loc: Loc; muni: string },
  body: { droneWeightG?: number; flags?: SpecificFlightFlag[]; plannedDate?: string; pilotPermits?: string[] },
) => {
  const p = baselineProvider(l.muni);
  const run = (loc: Loc, ctx?: FlightContext) => runRegulationCheckWith(p, loc, ctx, BASELINE_NOW);
  const res = await handleDiagnosePost(
    new Request("http://x/api/diagnose", {
      method: "POST",
      body: JSON.stringify({ lat: l.loc.lat, lng: l.loc.lng, ...body }),
    }),
    run,
  );
  return (await res.json()) as { verdict: FlightVerdict; evidenceId: string; category: string };
};

const item = (v: FlightVerdict, id: string) => {
  const it = v.items.find((i) => i.id === id);
  if (!it) throw new Error(`item ${id} がない`);
  return it;
};
const EGOV = MODEL_AIRCRAFT_REFERENCES[0]!.url;
const ALL_DIPS = DIPS_PERMIT_KINDS.map(dipsPermitValue);

describe("A. 規則（100g 未満＝模型航空機）", () => {
  it("1. 米子市役所 50g：DID は手続き不要・対象外（模型航空機）と参照先。機体登録・飛行計画の通報・飛行日誌は出さない", async () => {
    const { verdict } = await diagnose(LOC["米子市役所"], { droneWeightG: 50 });
    const did = item(verdict, "aviation-law-did");
    expect(did.verdict).toBe("no_procedure");
    expect(did.reason).toContain("対象外（模型航空機）");
    expect(did.reason).toContain(EGOV);
    const duties = verdict.perFlightDuties.map((d) => d.id);
    expect(duties).not.toContain("drone-registration");
    expect(duties).not.toContain("flight-plan-report");
    expect(duties).not.toContain("flight-logbook");
    expect(duties).toContain("model-aircraft-control-zone-check");
    expect(duties).toContain("emergency-airspace-check");
  });

  it("2・3. 出雲縁結び空港の周辺 50g：空港等周辺は green のまま例外前 yellow が残り、第134条の3 の許可が要手続き（期限は文言のまま、日付のある手続きより後）", async () => {
    const l = LOC["出雲縁結び空港の周辺"];
    const check = await runRegulationCheckWith(baselineProvider(l.muni), l.loc, { droneWeightG: 50 }, BASELINE_NOW);
    const ap = check.regulations.find((r) => r.id === "aviation-law-airport")!;
    expect(ap.status).toBe("green");
    expect(ap.statusBeforeExclusion).toBe("yellow");

    const { verdict } = await diagnose(l, { droneWeightG: 50, plannedDate: "2026-12-10" });
    const m = item(verdict, "model-aircraft-airport");
    expect(m.verdict).toBe("needs_procedure");
    expect(m.baseStatus).toBe("yellow");
    expect(m.legalTier).toBe(1);
    expect(["needs_procedure", "no_fly"]).toContain(verdict.level);
    const proc = verdict.procedures.find((p) => p.itemId === "model-aircraft-airport")!;
    expect(proc.title).toContain("航空法第134条の3 に基づく飛行の許可");
    expect(proc.submitTo).toContain("国土交通大臣");
    expect(proc.deadline.label).toBe(MODEL_AIRCRAFT_DEADLINE_LABEL);
    expect(proc.deadline.date).toBeUndefined();
    expect(proc.legalTier).toBe(1);
    expect(proc.reason).toContain("該当の可能性（要確認）");
    expect(proc.reason).toContain("管制圏・情報圏を収録していない");
    expect(proc.reason).toContain(EGOV);
  });

  it("3. 日付のある手続きより後に並ぶ（50g・夜間は対象外なので、飛行禁止法の通報の日付と比べる：美保基地の周辺）", async () => {
    const { verdict } = await diagnose(LOC["美保基地の周辺"], {
      droneWeightG: 50,
      plannedDate: "2026-12-10",
      flags: ["airspace_150m"],
    });
    const ids = verdict.procedures.map((p) => p.id);
    const notice = ids.indexOf("verdict-small-drone-notice");
    expect(notice).toBeGreaterThanOrEqual(0);
    for (const id of ["verdict-model-aircraft-airport", "verdict-model-aircraft-high"]) {
      expect(ids).toContain(id);
      expect(ids.indexOf(id)).toBeGreaterThan(notice);
    }
    for (const p of verdict.procedures.filter((x) => x.itemId.startsWith("model-") || x.itemId === "airspace_150m")) {
      expect(p.deadline.date).toBeUndefined();
    }
  });

  it("4. 50g＋150m 以上：通報が要手続き（150m・250m・航空路のデータなし・参照先）。夜間などは対象外（模型航空機）", async () => {
    const { verdict } = await diagnose(LOC["米子市役所"], {
      droneWeightG: 50,
      flags: ["airspace_150m", "method_night", "method_bvlos"],
    });
    const high = item(verdict, "airspace_150m");
    expect(high.verdict).toBe("needs_procedure");
    for (const w of ["150m", "250m", "航空路の地理データを持たない", EGOV]) expect(high.reason).toContain(w);
    const proc = verdict.procedures.find((p) => p.itemId === "airspace_150m")!;
    expect(proc.title).toContain("航空法第134条の3 に基づく飛行の通報");
    for (const id of ["method_night", "method_bvlos"]) {
      expect(item(verdict, id).verdict).toBe("no_procedure");
      expect(item(verdict, id).reason).toContain("対象外（模型航空機）");
    }
  });

  it("5. 50g で利用者が空域「空港等周辺」を選ぶと、同じ許可の手続きが 1 件だけ出る", async () => {
    const near = await diagnose(LOC["出雲縁結び空港の周辺"], { droneWeightG: 50, flags: ["airspace_airport"] });
    expect(near.verdict.procedures.filter((p) => p.id === "verdict-model-aircraft-airport")).toHaveLength(1);
    expect(near.verdict.items.filter((i) => i.id === "airspace_airport")).toHaveLength(0);
    const far = await diagnose(LOC["米子市役所"], { droneWeightG: 50, flags: ["airspace_airport"] });
    expect(far.verdict.procedures.filter((p) => p.id === "verdict-model-aircraft-airport")).toHaveLength(1);
    expect(item(far.verdict, "model-aircraft-airport").verdict).toBe("needs_procedure");
  });

  it("6. 50g で DIPS の全種類を入れても、模型航空機の許可・通報は要手続きのまま", async () => {
    const { verdict } = await diagnose(LOC["出雲縁結び空港の周辺"], {
      droneWeightG: 50,
      flags: ["airspace_150m", "airspace_airport"],
      pilotPermits: ALL_DIPS,
    });
    expect(item(verdict, "model-aircraft-airport").verdict).toBe("needs_procedure");
    expect(item(verdict, "airspace_150m").verdict).toBe("needs_procedure");
    expect(verdict.level).not.toBe("no_procedure");
  });

  it("7. 50g でも空港の敷地内・緊急用務空域は飛行不可。飛行禁止法は 100g 以上と同じ。weight_below_g を持つのは DID と空港等周辺だけ", async () => {
    const onSite = await diagnose(LOC["出雲縁結び空港の敷地内"], { droneWeightG: 50, flags: ["airspace_150m"] });
    expect(onSite.verdict.level).toBe("no_fly");
    expect(onSite.verdict.items.find((i) => i.id === "model-aircraft-airport")).toBeUndefined();
    const emg = await diagnose(LOC["米子市役所"], { droneWeightG: 50, flags: ["airspace_emergency"] });
    expect(emg.verdict.level).toBe("no_fly");
    const sdl50 = await diagnose(LOC["美保基地の周辺"], { droneWeightG: 50 });
    const sdl900 = await diagnose(LOC["美保基地の周辺"], { droneWeightG: 900 });
    expect(item(sdl50.verdict, "small-drone-law")).toEqual(item(sdl900.verdict, "small-drone-law"));

    const withWeight = new Set<string>();
    for (const muni of ["31201", "31202", "31203", "31204", "31329", "31364", "31370", "32201", "32203", "32205", "32206", "32209", "99999"]) {
      const r = await runRegulationCheckWith(baselineProvider(muni), LOC["米子市役所"].loc, undefined, BASELINE_NOW);
      for (const reg of r.regulations) {
        if (reg.clauseGraph.exceptions.some((e) => e.machine?.type === "weight_below_g")) withWeight.add(reg.id);
      }
    }
    expect([...withWeight].sort()).toEqual(["aviation-law-airport", "aviation-law-did"]);
  });
});

// 契約 8・15：900g・未指定・100g ちょうどの判定と、全重量の証跡 ID が Sprint 11d と同じ。
describe("8・15. 100g 以上・重量未指定の判定と証跡 ID が Sprint 11d と同じ", () => {
  const baseline = JSON.parse(
    readFileSync(new URL("./__fixtures__/sprint11d-verdict-baseline.json", import.meta.url), "utf8"),
  ) as Record<string, { checkEvidenceId: string; diagnosisEvidenceId: string; category: string; verdict?: unknown }>;

  it("ENGINE_VERSION は 0.4.0 のまま", () => {
    expect(ENGINE_VERSION).toBe("soraban-0.4.0-verdict-2026-10");
  });

  for (const l of BASELINE_LOCATIONS) {
    for (const w of BASELINE_WEIGHTS) {
      for (const f of BASELINE_FLAGS) {
        const key = baselineKey(l.name, w, f);
        it(key, async () => {
          const expected = baseline[key]!;
          const p = baselineProvider(l.muni);
          const run = (loc: Loc, ctx?: FlightContext) => runRegulationCheckWith(p, loc, ctx, BASELINE_NOW);
          const check = await run(l.loc, baselineCtx(w));
          const d = await diagnose(l, {
            ...(w !== undefined ? { droneWeightG: w } : {}),
            flags: [...f],
            plannedDate: "2026-12-10",
          });
          expect(check.evidenceId).toBe(expected.checkEvidenceId);
          expect(d.evidenceId).toBe(expected.diagnosisEvidenceId);
          expect(d.category).toBe(expected.category);
          if (w === undefined || w >= 100) {
            expect(d.verdict).toEqual(expected.verdict);
          }
        });
      }
    }
  }
});
