import {
  ALL_HERITAGE_SITES,
  ALL_MUNICIPAL_PARKS,
  ALL_SENSITIVE_FACILITIES,
  COVERAGE_SUMMARY,
  computeOverall,
  computeOverallConfidence,
  evaluateDid,
  evaluateMihoBase,
  evaluateMunicipalHeritage,
  evaluateMunicipalParks,
  evaluatePrefecturalNuisance,
  IZUMO_HERITAGE_SITES,
  IZUMO_PARKS,
  IZUMO_SENSITIVE_FACILITIES,
  KURAYOSHI_HERITAGE_SITES,
  KURAYOSHI_PARKS,
  KURAYOSHI_SENSITIVE_FACILITIES,
  MATSUE_HERITAGE_SITES,
  MATSUE_PARKS,
  MATSUE_SENSITIVE_FACILITIES,
  MIHO_AIRBASE_CENTER,
  SAKAIMINATO_PARKS,
  SAKAIMINATO_SENSITIVE_FACILITIES,
  TOTTORI_HERITAGE_SITES,
  TOTTORI_PARKS,
  TOTTORI_SENSITIVE_FACILITIES,
  YONAGO_HERITAGE_SITES,
  YONAGO_PARKS,
  YONAGO_SENSITIVE_FACILITIES,
  type DidCandidate,
  type FlightContext,
  type RegulationStatus,
  type RegulationWithStatus,
} from "./index";

const tottoriMuni = "31201";
const yonagoMuni = "31202";
const kurayoshiMuni = "31203";
const sakaiminatoMuni = "31204";
const matsueMuni = "32201";
const izumoMuni = "32203";

describe("evaluateMunicipalParks", () => {
  it("returns red when point is inside a 米子市 park polygon", () => {
    // 米子城跡（湊山公園）内部。
    const r = evaluateMunicipalParks({ lat: 35.4267, lng: 133.322 }, yonagoMuni);
    expect(r.status).toBe<RegulationStatus>("red");
    expect(r.note).toContain("湊山公園");
  });
  it("returns red for 出雲市 park (出雲ドーム公園)", () => {
    const r = evaluateMunicipalParks({ lat: 35.3686, lng: 132.7568 }, izumoMuni);
    expect(r.status).toBe<RegulationStatus>("red");
    expect(r.note).toContain("出雲市");
  });
  it("returns red for 境港市 park (夢みなと公園)", () => {
    const r = evaluateMunicipalParks({ lat: 35.5455, lng: 133.2235 }, sakaiminatoMuni);
    expect(r.status).toBe<RegulationStatus>("red");
  });
  it("returns red for 鳥取市 park (久松公園)", () => {
    const r = evaluateMunicipalParks({ lat: 35.5040, lng: 134.2440 }, tottoriMuni);
    expect(r.status).toBe<RegulationStatus>("red");
    expect(r.note).toContain("鳥取市");
  });
  it("returns red for 倉吉市 park (打吹公園)", () => {
    const r = evaluateMunicipalParks({ lat: 35.4264, lng: 133.8230 }, kurayoshiMuni);
    expect(r.status).toBe<RegulationStatus>("red");
    expect(r.note).toContain("倉吉市");
  });
  it("returns red for 松江市 park (城山公園)", () => {
    const r = evaluateMunicipalParks({ lat: 35.4740, lng: 133.0510 }, matsueMuni);
    expect(r.status).toBe<RegulationStatus>("red");
    expect(r.note).toContain("松江市");
  });
  it("returns green when point is outside known park polygons", () => {
    const r = evaluateMunicipalParks({ lat: 35.4283, lng: 133.3306 }, yonagoMuni); // 米子市役所
    expect(r.status).toBe<RegulationStatus>("green");
  });
  it("returns unknown when muniCode is uncovered", () => {
    const r = evaluateMunicipalParks({ lat: 35.5, lng: 133.5 }, "99999");
    expect(r.status).toBe<RegulationStatus>("unknown");
  });
  it("returns unknown when muniCode is missing", () => {
    const r = evaluateMunicipalParks({ lat: 35.5, lng: 133.5 }, undefined);
    expect(r.status).toBe<RegulationStatus>("unknown");
  });
});

describe("evaluateMunicipalHeritage", () => {
  it("flags 米子城跡 (国指定史跡) as red and cites 文化財保護法第125条", () => {
    const r = evaluateMunicipalHeritage({ lat: 35.4267, lng: 133.322 }, yonagoMuni);
    expect(r.status).toBe<RegulationStatus>("red");
    expect(r.note).toMatch(/国指定史跡/);
    expect(r.note).toContain("文化財保護法第125条");
  });
  it("flags 荒神谷遺跡 as red for 出雲市", () => {
    const r = evaluateMunicipalHeritage({ lat: 35.387, lng: 132.844 }, izumoMuni);
    expect(r.status).toBe<RegulationStatus>("red");
    expect(r.note).toContain("荒神谷");
  });
  it("returns unknown for 境港市 (no heritage data yet)", () => {
    const r = evaluateMunicipalHeritage({ lat: 35.5455, lng: 133.2235 }, sakaiminatoMuni);
    expect(r.status).toBe<RegulationStatus>("unknown");
  });
  it("flags 鳥取城跡 (国指定史跡) as red for 鳥取市", () => {
    const r = evaluateMunicipalHeritage({ lat: 35.5040, lng: 134.2440 }, tottoriMuni);
    expect(r.status).toBe<RegulationStatus>("red");
    expect(r.note).toContain("国指定史跡");
  });
  it("flags 伯耆国分寺跡 (国指定史跡) as red for 倉吉市", () => {
    const r = evaluateMunicipalHeritage({ lat: 35.4304, lng: 133.7900 }, kurayoshiMuni);
    expect(r.status).toBe<RegulationStatus>("red");
    expect(r.note).toContain("伯耆国分寺");
  });
  it("flags 松江城跡 (国指定史跡) as red for 松江市", () => {
    const r = evaluateMunicipalHeritage({ lat: 35.4745, lng: 133.0515 }, matsueMuni);
    expect(r.status).toBe<RegulationStatus>("red");
    expect(r.note).toContain("松江城");
  });
});

describe("evaluatePrefecturalNuisance", () => {
  it("returns yellow within 100m of 米子市役所 (鳥取県)", () => {
    const r = evaluatePrefecturalNuisance({ lat: 35.4283, lng: 133.3306 }, yonagoMuni);
    expect(r.status).toBe<RegulationStatus>("yellow");
    expect(r.note).toContain("鳥取県");
  });
  it("returns yellow within 100m of 出雲市役所 (島根県)", () => {
    const r = evaluatePrefecturalNuisance({ lat: 35.3676, lng: 132.7549 }, izumoMuni);
    expect(r.status).toBe<RegulationStatus>("yellow");
    expect(r.note).toContain("島根県");
  });
  it("returns green when far from any sensitive facility", () => {
    // 大山山頂付近（鳥取県だが密集地から十分離れる）。
    const r = evaluatePrefecturalNuisance({ lat: 35.371, lng: 133.541 }, yonagoMuni);
    expect(r.status).toBe<RegulationStatus>("green");
  });
  it("returns unknown for an out-of-coverage prefecture", () => {
    const r = evaluatePrefecturalNuisance({ lat: 35.0, lng: 135.0 }, "26000"); // 京都府
    expect(r.status).toBe<RegulationStatus>("unknown");
  });
  it("returns unknown when muniCode is missing", () => {
    const r = evaluatePrefecturalNuisance({ lat: 35.0, lng: 135.0 }, undefined);
    expect(r.status).toBe<RegulationStatus>("unknown");
  });
});

describe("evaluateMihoBase", () => {
  it("flags red at the airbase center", () => {
    expect(evaluateMihoBase(MIHO_AIRBASE_CENTER).status).toBe<RegulationStatus>("red");
  });
  it("flags yellow within 1.5 km", () => {
    // 中心から 0.5°/3600 ≒ 14m 程度では red のままなので 1km ほど東へずらす。
    const east1km = { lat: MIHO_AIRBASE_CENTER.lat, lng: MIHO_AIRBASE_CENTER.lng + 0.011 };
    expect(evaluateMihoBase(east1km).status).toBe<RegulationStatus>("yellow");
  });
  it("flags green far away", () => {
    const r = evaluateMihoBase({ lat: 35.0, lng: 135.0 });
    expect(r.status).toBe<RegulationStatus>("green");
  });
});

describe("computeOverall", () => {
  const make = (status: RegulationStatus): RegulationWithStatus => ({
    id: "x",
    source: "国",
    authority: "テスト",
    title: "t",
    summary: "s",
    clauseGraph: { main: { text: "", effect: "permit" }, exceptions: [], conditions: [] },
    confidence: { geometric: "low", extraction: "low", verifiedAt: "2026-01-01" },
    status,
    note: "",
  });
  it("any red wins", () => {
    expect(computeOverall([make("green"), make("yellow"), make("red")])).toBe<RegulationStatus>("red");
  });
  it("yellow > green", () => {
    expect(computeOverall([make("green"), make("yellow"), make("green")])).toBe<RegulationStatus>("yellow");
  });
  it("all green = green", () => {
    expect(computeOverall([make("green"), make("green")])).toBe<RegulationStatus>("green");
  });
  it("unknown alone returns unknown", () => {
    expect(computeOverall([make("unknown")])).toBe<RegulationStatus>("unknown");
  });
  it("ignores unknown when other statuses are present", () => {
    expect(computeOverall([make("unknown"), make("green")])).toBe<RegulationStatus>("green");
  });

  it("computeOverallConfidence picks the worst rung", () => {
    const rec = make("green");
    const a = { ...rec, confidence: { ...rec.confidence, geometric: "high" as const, extraction: "high" as const } };
    const b = { ...rec, confidence: { ...rec.confidence, geometric: "medium" as const, extraction: "high" as const } };
    const c = { ...rec, confidence: { ...rec.confidence, geometric: "low" as const, extraction: "high" as const } };
    expect(computeOverallConfidence([a, b])).toBe("medium");
    expect(computeOverallConfidence([a, b, c])).toBe("low");
  });
});

describe("COVERAGE_SUMMARY", () => {
  it("totalParks matches sum of all municipal park lists (6 cities)", () => {
    expect(COVERAGE_SUMMARY.totalParks).toBe(
      TOTTORI_PARKS.length +
        YONAGO_PARKS.length +
        KURAYOSHI_PARKS.length +
        SAKAIMINATO_PARKS.length +
        MATSUE_PARKS.length +
        IZUMO_PARKS.length,
    );
    expect(COVERAGE_SUMMARY.totalParks).toBe(ALL_MUNICIPAL_PARKS.length);
  });
  it("totalHeritage matches sum of all municipal heritage lists (5 cities × 1+ sites)", () => {
    expect(COVERAGE_SUMMARY.totalHeritage).toBe(
      TOTTORI_HERITAGE_SITES.length +
        YONAGO_HERITAGE_SITES.length +
        KURAYOSHI_HERITAGE_SITES.length +
        MATSUE_HERITAGE_SITES.length +
        IZUMO_HERITAGE_SITES.length,
    );
    expect(COVERAGE_SUMMARY.totalHeritage).toBe(ALL_HERITAGE_SITES.length);
  });
  it("totalSensitive matches ALL_SENSITIVE_FACILITIES length", () => {
    expect(COVERAGE_SUMMARY.totalSensitive).toBe(ALL_SENSITIVE_FACILITIES.length);
  });
  it("municipalSensitiveCounts sum equals totalSensitive (auto-calculated)", () => {
    const sum = COVERAGE_SUMMARY.municipalSensitiveCounts.reduce(
      (acc, [, n]) => acc + n,
      0,
    );
    expect(sum).toBe(COVERAGE_SUMMARY.totalSensitive);
    // 各市の sensitive facilities 数が手書きカウントと一致すること
    expect(sum).toBe(
      TOTTORI_SENSITIVE_FACILITIES.length +
        YONAGO_SENSITIVE_FACILITIES.length +
        KURAYOSHI_SENSITIVE_FACILITIES.length +
        SAKAIMINATO_SENSITIVE_FACILITIES.length +
        MATSUE_SENSITIVE_FACILITIES.length +
        IZUMO_SENSITIVE_FACILITIES.length,
    );
  });
  it("includes 鳥取県 and 島根県 in prefecture coverage", () => {
    expect(COVERAGE_SUMMARY.prefectureNuisanceNames).toContain("鳥取県");
    expect(COVERAGE_SUMMARY.prefectureNuisanceNames).toContain("島根県");
  });
  it("covers 6 cities (3 per prefecture × 2 prefectures)", () => {
    expect(COVERAGE_SUMMARY.municipalParkNames).toHaveLength(6);
    expect(COVERAGE_SUMMARY.municipalParkNames).toEqual(
      expect.arrayContaining([
        "鳥取市",
        "米子市",
        "倉吉市",
        "境港市",
        "松江市",
        "出雲市",
      ]),
    );
  });
});

// FlightContext: 例外節の自動適用（特許①の機械可読 ClauseGraph がここで効く）
describe("FlightContext exemption application", () => {
  // 米子市役所は DID 内 + 県条例 yellow + park green の典型ケース。
  // dummy DID polygon を使って evaluateDid のみで例外マッチを検証する。
  const yonagoDid: DidCandidate = {
    muniCode: yonagoMuni,
    muniName: "米子市",
    polygon: [
      { lat: 35.41, lng: 133.31 },
      { lat: 35.41, lng: 133.36 },
      { lat: 35.46, lng: 133.36 },
      { lat: 35.46, lng: 133.31 },
    ],
  };
  const yonagoCityHall = { lat: 35.4283, lng: 133.3306 }; // DID 内

  it("DID red without ctx (default = strict)", () => {
    const r = evaluateDid(yonagoCityHall, [yonagoDid]);
    expect(r.status).toBe<RegulationStatus>("red");
    expect(r.appliedExceptions).toBeUndefined();
  });

  it("DID drops to green when drone is < 100g (weight_below_g exception)", () => {
    const ctx: FlightContext = { droneWeightG: 50 };
    const r = evaluateDid(yonagoCityHall, [yonagoDid], ctx);
    expect(r.status).toBe<RegulationStatus>("green");
    expect(r.appliedExceptions).toBeDefined();
    expect(r.appliedExceptions?.[0]?.condition).toMatch(/100g/);
  });

  it("DID stays red when drone is >= 100g", () => {
    const ctx: FlightContext = { droneWeightG: 900 }; // DJI Mavic 級
    const r = evaluateDid(yonagoCityHall, [yonagoDid], ctx);
    expect(r.status).toBe<RegulationStatus>("red");
    expect(r.appliedExceptions).toBeUndefined();
  });

  it("DID drops to green when MLIT permit holder", () => {
    const ctx: FlightContext = { pilotPermits: ["mlit"] };
    const r = evaluateDid(yonagoCityHall, [yonagoDid], ctx);
    expect(r.status).toBe<RegulationStatus>("green");
    expect(r.appliedExceptions?.[0]?.machine?.value).toBe("mlit");
  });

  it("DID does NOT drop on irrelevant permit", () => {
    const ctx: FlightContext = { pilotPermits: ["park_manager"] };
    const r = evaluateDid(yonagoCityHall, [yonagoDid], ctx);
    expect(r.status).toBe<RegulationStatus>("red");
  });

  it("park ordinance drops to green with park_manager permit", () => {
    const r = evaluateMunicipalParks(
      { lat: 35.4267, lng: 133.322 }, // 湊山公園内
      yonagoMuni,
      { pilotPermits: ["park_manager"] },
    );
    expect(r.status).toBe<RegulationStatus>("green");
    expect(r.appliedExceptions?.[0]?.machine?.value).toBe("park_manager");
  });

  it("heritage drops to green with emergency purpose", () => {
    const r = evaluateMunicipalHeritage(
      { lat: 35.4267, lng: 133.322 }, // 米子城跡
      yonagoMuni,
      { purpose: "emergency" },
    );
    expect(r.status).toBe<RegulationStatus>("green");
    expect(r.appliedExceptions?.[0]?.machine?.value).toBe("emergency");
  });

  it("prefectural nuisance drops to green with facility_manager permit", () => {
    const r = evaluatePrefecturalNuisance(
      { lat: 35.4283, lng: 133.3306 }, // 米子市役所 0m
      yonagoMuni,
      { pilotPermits: ["facility_manager"] },
    );
    expect(r.status).toBe<RegulationStatus>("green");
  });

  it("MihoBase drops to green for facility_manager + pref_pubsafety", () => {
    const r = evaluateMihoBase(MIHO_AIRBASE_CENTER, {
      pilotPermits: ["facility_manager_and_pref_pubsafety"],
    });
    expect(r.status).toBe<RegulationStatus>("green");
  });

  it("note string includes the exempted reason", () => {
    const ctx: FlightContext = { droneWeightG: 50 };
    const r = evaluateDid(yonagoCityHall, [yonagoDid], ctx);
    expect(r.note).toContain("適用例外");
    expect(r.note).toContain("100g");
  });
});

// デモ台本上の固定 9 地点を回帰テスト化。
// プリセットボタンの hint と評価結果がズレたら fail させる。
describe("demo preset regressions", () => {
  type Case = {
    label: string;
    loc: { lat: number; lng: number };
    muni: string;
    expectedParks?: RegulationStatus;
    expectedHeritage?: RegulationStatus;
    expectedPref?: RegulationStatus;
  };
  const cases: readonly Case[] = [
    {
      label: "米子市役所",
      loc: { lat: 35.4283, lng: 133.3306 },
      muni: yonagoMuni,
      expectedParks: "green",
      expectedPref: "yellow",
    },
    {
      label: "湊山公園(米子城跡)",
      loc: { lat: 35.4267, lng: 133.322 },
      muni: yonagoMuni,
      expectedParks: "red",
      expectedHeritage: "red",
    },
    {
      label: "皆生温泉",
      loc: { lat: 35.4538, lng: 133.3333 },
      muni: yonagoMuni,
      expectedPref: "yellow",
    },
    {
      label: "境港駅",
      loc: { lat: 35.543, lng: 133.228 },
      muni: sakaiminatoMuni,
      expectedPref: "yellow",
    },
    {
      label: "夢みなと公園(境港)",
      loc: { lat: 35.5455, lng: 133.2235 },
      muni: sakaiminatoMuni,
      expectedParks: "red",
      expectedHeritage: "unknown",
    },
    {
      label: "出雲大社",
      loc: { lat: 35.4019, lng: 132.6852 },
      muni: izumoMuni,
      expectedHeritage: "red",
      expectedPref: "yellow",
    },
    {
      label: "荒神谷史跡公園(出雲)",
      loc: { lat: 35.387, lng: 132.844 },
      muni: izumoMuni,
      expectedParks: "red",
      expectedHeritage: "red",
    },
    {
      label: "出雲市役所",
      loc: { lat: 35.3676, lng: 132.7549 },
      muni: izumoMuni,
      expectedPref: "yellow",
    },
  ];

  for (const c of cases) {
    it(`${c.label} matches expected layer statuses`, () => {
      if (c.expectedParks !== undefined) {
        expect(evaluateMunicipalParks(c.loc, c.muni).status).toBe(c.expectedParks);
      }
      if (c.expectedHeritage !== undefined) {
        expect(evaluateMunicipalHeritage(c.loc, c.muni).status).toBe(c.expectedHeritage);
      }
      if (c.expectedPref !== undefined) {
        expect(evaluatePrefecturalNuisance(c.loc, c.muni).status).toBe(c.expectedPref);
      }
    });
  }
});
