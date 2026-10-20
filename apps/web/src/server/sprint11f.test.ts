// Sprint 11f 契約 1・2・8・11・12・14（単体）：判定の表示の軽微な直し。
// 証跡 ID・evidence_log の値・ENGINE_VERSION は変えない（表示の言葉だけを変える）。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  baseStatusDisplay,
  ENGINE_VERSION,
  evaluateMunicipalHeritage,
  evaluateMunicipalParks,
  evaluatePrefecturalNuisance,
  formatDidDetermination,
  MODEL_AIRCRAFT_EXEMPT_LABEL,
  MODEL_AIRCRAFT_REFERENCES,
  type FlightContext,
  type FlightVerdict,
  type SpecificFlightFlag,
} from "@soraban/regulations";
import { isModelAircraftDidExcluded, regulationNoteDisplay, MODEL_AIRCRAFT_DID_DETAIL_LABEL } from "@/lib/verdict-display";
import { runRegulationCheckWith } from "./check-core";
import { toEvidenceLogInsert } from "./evidence-log";
import { handleDiagnosePost } from "./handlers";
import { BASELINE_LOCATIONS, BASELINE_NOW, baselineProvider } from "./sprint11e-baseline";

type Loc = { readonly lat: number; readonly lng: number };
const LOC = Object.fromEntries(BASELINE_LOCATIONS.map((l) => [l.name, l])) as Record<
  (typeof BASELINE_LOCATIONS)[number]["name"],
  (typeof BASELINE_LOCATIONS)[number]
>;

const diagnose = async (
  l: { loc: Loc; muni: string },
  body: { droneWeightG?: number; flags?: SpecificFlightFlag[] },
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
  return (await res.json()) as { verdict: FlightVerdict; evidenceId: string; didStatus?: string; didDetail?: string };
};
const item = (v: FlightVerdict, id: string) => {
  const it = v.items.find((i) => i.id === id);
  if (!it) throw new Error(`item ${id} がない`);
  return it;
};

describe("契約 1. formatDidDetermination（重量を見る）", () => {
  const IN_DID = ["in_did", "in_did_near_industrial_boundary", "in_did_exclusion_unverified"] as const;
  it("50g で DID 内は「対象外（模型航空機）」", () => {
    for (const d of IN_DID) {
      expect(formatDidDetermination("not_applicable", d, { droneWeightG: 50 })).toBe("対象外（模型航空機）");
    }
    expect(MODEL_AIRCRAFT_EXEMPT_LABEL).toBe("対象外（模型航空機）");
  });
  it("50g でも DID 外・工業専用地域・未確認は今のまま", () => {
    expect(formatDidDetermination("not_applicable", "outside_did", { droneWeightG: 50 })).toBe("非該当");
    expect(formatDidDetermination("not_applicable", "industrial_exclusive", { droneWeightG: 50 })).toBe(
      "非該当（工業専用地域）",
    );
    expect(formatDidDetermination("unverified", undefined, { droneWeightG: 50 })).toBe("未確認");
  });
  it("重量未指定・100g・900g は従来と同じ（0.3.0 以前の許可で下げた行は「非該当」のまま）", () => {
    for (const opts of [undefined, {}, { droneWeightG: undefined }, { droneWeightG: 100 }, { droneWeightG: 900 }]) {
      expect(formatDidDetermination("not_applicable", "in_did", opts)).toBe("非該当");
      expect(formatDidDetermination("not_applicable", "in_did_near_industrial_boundary", opts)).toBe("非該当");
    }
    expect(formatDidDetermination("applicable", "in_did", { droneWeightG: 50 })).toBe("該当");
    expect(formatDidDetermination("applicable", "in_did_exclusion_unverified", { droneWeightG: 900 })).toBe(
      "該当（工業専用地域の除外：未確認）",
    );
  });
});

describe("契約 2. 判定の項目の表示用の印（値は変えない）", () => {
  it("米子市役所 50g：DID は no_procedure・baseStatus green のまま、印があり、元の判定の表示は対象外（模型航空機）", async () => {
    const { verdict } = await diagnose(LOC["米子市役所"], { droneWeightG: 50 });
    const did = item(verdict, "aviation-law-did");
    expect(did.verdict).toBe("no_procedure");
    expect(did.baseStatus).toBe("green");
    expect(did.baseExcludedAs).toBe("model_aircraft");
    expect(baseStatusDisplay(did)).toBe("対象外（模型航空機）");
  });
  it("50g＋夜間の飛行の方法の項目も同じ", async () => {
    const { verdict } = await diagnose(LOC["米子市役所"], { droneWeightG: 50, flags: ["method_night"] });
    const night = item(verdict, "method_night");
    expect(night.verdict).toBe("no_procedure");
    expect(night.baseStatus).toBe("green");
    expect(night.baseExcludedAs).toBe("model_aircraft");
    expect(baseStatusDisplay(night)).toBe("対象外（模型航空機）");
  });
  it("900g・重量未指定は印がなく、元の判定の表示は 11e までと同じ", async () => {
    for (const w of [900, undefined]) {
      const { verdict } = await diagnose(LOC["米子市役所"], {
        ...(w !== undefined ? { droneWeightG: w } : {}),
        flags: ["method_night"],
      });
      for (const it of verdict.items) {
        expect(it.baseExcludedAs).toBeUndefined();
      }
      expect(baseStatusDisplay(item(verdict, "aviation-law-did"))).toBe("該当");
      expect(baseStatusDisplay(item(verdict, "method_night"))).toBe("該当");
    }
  });
  it("空港等周辺（50g）の模型航空機の許可の項目は「該当の可能性（要確認）」のまま（対象外ではない）", async () => {
    const { verdict } = await diagnose(LOC["出雲縁結び空港の周辺"], { droneWeightG: 50 });
    const m = item(verdict, "model-aircraft-airport");
    expect(m.baseExcludedAs).toBeUndefined();
    expect(baseStatusDisplay(m)).toBe("該当の可能性（要確認）");
    expect(baseStatusDisplay(item(verdict, "aviation-law-airport"))).toBe("対象外（模型航空機）");
  });
});

describe("契約 8. 参照先（6 件＋Sprint 11g で 3 件）", () => {
  it("題名と URL", () => {
    expect(MODEL_AIRCRAFT_REFERENCES).toHaveLength(9);
    expect(MODEL_AIRCRAFT_REFERENCES[0]!.title).toBe("e-Gov 法令検索 航空法（航空法第134条の3）");
    expect(MODEL_AIRCRAFT_REFERENCES[0]!.url).toBe("https://laws.e-gov.go.jp/law/327AC0000000231");
    expect(MODEL_AIRCRAFT_REFERENCES[1]!.title).toContain("航空法施行規則第239条の2");
    expect(MODEL_AIRCRAFT_REFERENCES[1]!.url).toBe("https://laws.e-gov.go.jp/law/327M50000800056");
    expect(new Set(MODEL_AIRCRAFT_REFERENCES.map((r) => r.title)).size).toBe(9);
    const src = readFileSync(
      new URL("../../../../packages/regulations/src/model-aircraft.ts", import.meta.url),
      "utf8",
    );
    expect(src).not.toContain(["は", "航空法施行規則"].join(""));
    expect(src).toContain("※要確認：一次資料未取得");
  });
});

describe("契約 11・12. 未収録の市町村・都道府県の題名", () => {
  const loc = { lat: 35.5, lng: 133.4 };
  it("境港市：史跡が未収録。市町村名を出さない。ID は d08dc6f と同じ", () => {
    const r = evaluateMunicipalHeritage(loc, "31204");
    expect(r.id).toBe("31202-heritage-protection");
    expect(r.status).toBe("unknown");
    expect(r.title).toBe("文化財保護法第125条 / 市町村の文化財保護条例（データ未整備）— 史跡内の現状変更");
    for (const t of [r.title, r.authority, r.summary, r.url ?? ""]) expect(t).not.toContain("米子市");
    expect(r.url).toBe("https://www.bunka.go.jp/seisaku/bunkazai/shokai/shiseki/index.html");
  });
  it("日吉津村（31390）：都市公園が未収録。名前も URL も出さない", () => {
    const r = evaluateMunicipalParks(loc, "31390");
    expect(r.id).toBe("31202-park-ordinance");
    expect(r.status).toBe("unknown");
    expect(r.title).toBe("市町村の都市公園条例（データ未整備）— 都市公園内での無人航空機の使用");
    for (const t of [r.title, r.authority, r.summary]) expect(t).not.toContain("米子市");
    expect(r.url).toBeUndefined();
  });
  it("岡山県内（33101）：県条例が未収録。名前も URL も出さない", () => {
    const r = evaluatePrefecturalNuisance(loc, "33101");
    expect(r.id).toBe("31-pref-nuisance-prevention");
    expect(r.status).toBe("unknown");
    expect(r.title).toBe("都道府県の迷惑行為等防止条例（データ未整備）— 公衆密集地周辺での迷惑行為");
    for (const t of [r.title, r.authority, r.summary]) expect(t).not.toMatch(/鳥取県|米子市/);
    expect(r.url).toBeUndefined();
  });
  it("収録済み（米子市の史跡・境港市の都市公園・鳥取県・島根県の県条例）は題名・出す先・URL が従来どおり", () => {
    const h = evaluateMunicipalHeritage(loc, "31202");
    expect(h.title).toBe("文化財保護法第125条 / 米子市文化財保護条例 — 史跡内の現状変更");
    expect(h.authority).toBe("米子市教育委員会・文化庁");
    const h2 = evaluateMunicipalHeritage(loc, "32201");
    expect(h2.title).toBe("文化財保護法第125条 / 松江市文化財保護条例 — 史跡内の現状変更");
    const p = evaluateMunicipalParks(loc, "31204");
    expect(p.title).toBe("境港市都市公園条例 — 都市公園内での無人航空機の使用");
    expect(p.url).toBe("https://www.city.sakaiminato.lg.jp/");
    const t = evaluatePrefecturalNuisance(loc, "31202");
    expect(t.title).toBe("鳥取県迷惑行為等防止条例 — 公衆密集地周辺での迷惑行為");
    expect(t.url).toBe("https://www1.g-reiki.net/tottori/");
    const s = evaluatePrefecturalNuisance(loc, "32201");
    expect(s.title).toBe("島根県迷惑行為等防止条例 — 公衆密集地周辺での迷惑行為");
    expect(s.url).toBe("https://www1.g-reiki.net/pref-shimane/");
  });
});

describe("契約 14. 証跡", () => {
  it("ENGINE_VERSION は 0.4.0 のまま", () => {
    expect(ENGINE_VERSION).toBe("soraban-0.4.0-verdict-2026-10");
  });
  it("evidence_log の値に表示の言葉が入らない（50g 米子市役所）", async () => {
    const l = LOC["米子市役所"];
    const check = await runRegulationCheckWith(baselineProvider(l.muni), l.loc, { droneWeightG: 50 }, BASELINE_NOW);
    const ins = toEvidenceLogInsert(check, l.loc);
    expect(ins.perRegulationStatus["aviation-law-did"]).toBe("green");
    expect(ins.perRegulationVerdict?.["aviation-law-did"]).toBe("no_procedure");
    expect(JSON.stringify(ins)).not.toContain("模型航空機");
    const d = await diagnose(l, { droneWeightG: 50 });
    expect(d.didStatus).toBe("not_applicable");
    expect(d.didDetail).toBe("in_did");
  });
});

describe("カード・PDF の DID の行と本文（100g 未満は対象外の言葉、それ以外は従来どおり）", () => {
  const didOf = async (w: number | undefined) => {
    const l = LOC["米子市役所"];
    const check = await runRegulationCheckWith(
      baselineProvider(l.muni),
      l.loc,
      w !== undefined ? { droneWeightG: w } : undefined,
      BASELINE_NOW,
    );
    return check.regulations.find((r) => r.id === "aviation-law-did")!;
  };
  it("50g：本文の「許可・承認なく飛行できません」を置き換え、DID の行は模型航空機のため対象外。値は変えない", async () => {
    const r = await didOf(50);
    expect(isModelAircraftDidExcluded(r)).toBe(true);
    expect(r.didDetail).toBe("in_did");
    expect(r.note).toContain("許可・承認なく飛行できません");
    expect(regulationNoteDisplay(r)).not.toContain("許可・承認なく飛行できません");
    expect(regulationNoteDisplay(r)).toContain("対象外です");
    expect(MODEL_AIRCRAFT_DID_DETAIL_LABEL).toBe("DID：該当（模型航空機のため対象外）");
  });
  it("900g・未指定は従来どおり", async () => {
    for (const w of [900, undefined]) {
      const r = await didOf(w);
      expect(isModelAircraftDidExcluded(r)).toBe(false);
      expect(regulationNoteDisplay(r)).toBe(r.note);
      expect(r.note).toContain("許可・承認なく飛行できません");
    }
  });
});
