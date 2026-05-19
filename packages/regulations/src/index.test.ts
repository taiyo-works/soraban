import {
  ALL_HERITAGE_SITES,
  ALL_MUNICIPAL_PARKS,
  ALL_SENSITIVE_FACILITIES,
  COVERAGE_SUMMARY,
  computeOverall,
  computeOverallConfidence,
  evaluateAirports,
  evaluateDid,
  evaluateMihoBase,
  evaluateMunicipalHeritage,
  evaluateMunicipalParks,
  evaluatePrefecturalNuisance,
  type AirportCandidate,
  formatMachineCondition,
  LOW_CONFIDENCE_THRESHOLD,
  shouldWarnConfidence,
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
  MISASA_HERITAGE_SITES,
  MISASA_PARKS,
  MISASA_SENSITIVE_FACILITIES,
  OHDA_HERITAGE_SITES,
  OHDA_PARKS,
  OHDA_SENSITIVE_FACILITIES,
  SAKAIMINATO_PARKS,
  SAKAIMINATO_SENSITIVE_FACILITIES,
  TOTTORI_HERITAGE_SITES,
  TOTTORI_PARKS,
  TOTTORI_SENSITIVE_FACILITIES,
  UNNAN_HERITAGE_SITES,
  UNNAN_PARKS,
  UNNAN_SENSITIVE_FACILITIES,
  YASUGI_HERITAGE_SITES,
  YASUGI_PARKS,
  YASUGI_SENSITIVE_FACILITIES,
  YAZU_PARKS,
  YAZU_SENSITIVE_FACILITIES,
  YONAGO_HERITAGE_SITES,
  YONAGO_PARKS,
  YONAGO_SENSITIVE_FACILITIES,
  YURIHAMA_HERITAGE_SITES,
  YURIHAMA_PARKS,
  YURIHAMA_SENSITIVE_FACILITIES,
  type DidCandidate,
  type FlightContext,
  type RegulationStatus,
  type RegulationWithStatus,
} from "./index";

const tottoriMuni = "31201";
const yonagoMuni = "31202";
const kurayoshiMuni = "31203";
const sakaiminatoMuni = "31204";
const yazuMuni = "31329";
const misasaMuni = "31364";
const yurihamaMuni = "31370";
const matsueMuni = "32201";
const izumoMuni = "32203";
const ohdaMuni = "32205";
const yasugiMuni = "32206";
const unnanMuni = "32209";

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
  it("returns red for 三朝町 park (三朝中央公園)", () => {
    const r = evaluateMunicipalParks({ lat: 35.3995, lng: 133.8790 }, misasaMuni);
    expect(r.status).toBe<RegulationStatus>("red");
    expect(r.note).toContain("三朝町");
  });
  it("returns red for 湯梨浜町 park (東郷湖羽合臨海公園)", () => {
    const r = evaluateMunicipalParks({ lat: 35.4855, lng: 133.9020 }, yurihamaMuni);
    expect(r.status).toBe<RegulationStatus>("red");
    expect(r.note).toContain("湯梨浜町");
  });
  it("returns red for 八頭町 park (船岡竹林公園)", () => {
    const r = evaluateMunicipalParks({ lat: 35.4158, lng: 134.2900 }, yazuMuni);
    expect(r.status).toBe<RegulationStatus>("red");
    expect(r.note).toContain("八頭町");
  });
  it("returns red for 安来市 park (月山公園)", () => {
    const r = evaluateMunicipalParks({ lat: 35.3720, lng: 133.1985 }, yasugiMuni);
    expect(r.status).toBe<RegulationStatus>("red");
    expect(r.note).toContain("安来市");
  });
  it("returns red for 雲南市 park (加茂岩倉遺跡ガイダンス公園)", () => {
    const r = evaluateMunicipalParks({ lat: 35.3610, lng: 132.9040 }, unnanMuni);
    expect(r.status).toBe<RegulationStatus>("red");
    expect(r.note).toContain("雲南市");
  });
  it("returns red for 大田市 park (石見銀山公園)", () => {
    const r = evaluateMunicipalParks({ lat: 35.1170, lng: 132.4380 }, ohdaMuni);
    expect(r.status).toBe<RegulationStatus>("red");
    expect(r.note).toContain("大田市");
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
  it("flags 三徳山 (国指定名勝及び史跡) as red for 三朝町", () => {
    const r = evaluateMunicipalHeritage({ lat: 35.3985, lng: 133.9380 }, misasaMuni);
    expect(r.status).toBe<RegulationStatus>("red");
    expect(r.note).toContain("三徳山");
  });
  it("flags 月山富田城跡 (国指定史跡) as red for 安来市", () => {
    const r = evaluateMunicipalHeritage({ lat: 35.3720, lng: 133.1985 }, yasugiMuni);
    expect(r.status).toBe<RegulationStatus>("red");
    expect(r.note).toContain("月山富田城");
  });
  it("flags 加茂岩倉遺跡 (国指定史跡) as red for 雲南市", () => {
    const r = evaluateMunicipalHeritage({ lat: 35.3610, lng: 132.9040 }, unnanMuni);
    expect(r.status).toBe<RegulationStatus>("red");
    expect(r.note).toContain("加茂岩倉");
  });
  it("flags 石見銀山遺跡 (国指定史跡・世界文化遺産) as red for 大田市", () => {
    const r = evaluateMunicipalHeritage({ lat: 35.1170, lng: 132.4380 }, ohdaMuni);
    expect(r.status).toBe<RegulationStatus>("red");
    expect(r.note).toContain("石見銀山");
  });
  it("returns unknown for 八頭町 (no heritage data registered)", () => {
    const r = evaluateMunicipalHeritage({ lat: 35.4395, lng: 134.2950 }, yazuMuni);
    expect(r.status).toBe<RegulationStatus>("unknown");
  });
});

describe("evaluatePrefecturalNuisance", () => {
  it("returns yellow within 100m of 米子市役所 (鳥取県)", () => {
    const r = evaluatePrefecturalNuisance({ lat: 35.4278, lng: 133.3314 }, yonagoMuni);
    expect(r.status).toBe<RegulationStatus>("yellow");
    expect(r.note).toContain("鳥取県");
  });
  it("returns yellow within 100m of 出雲市役所 (島根県)", () => {
    const r = evaluatePrefecturalNuisance({ lat: 35.3683, lng: 132.7567 }, izumoMuni);
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

// evaluateAirports: seed airports.geojson の山陰圏空港について、
// 敷地内 red / 6km 圏 yellow / 圏外 green / データ無し unknown の
// 4 区分が正しく決まるかを確認する。出雲空港バグの回帰防止。
describe("evaluateAirports", () => {
  const izumoAirport: AirportCandidate = {
    id: "RJOC",
    name: "出雲縁結び空港",
    polygons: [
      [
        { lat: 35.405, lng: 132.880 },
        { lat: 35.405, lng: 132.900 },
        { lat: 35.420, lng: 132.900 },
        { lat: 35.420, lng: 132.880 },
      ],
    ],
    center: { lat: 35.4133, lng: 132.8897 },
  };
  const yonagoAirport: AirportCandidate = {
    id: "RJOH",
    name: "米子鬼太郎空港",
    polygons: [
      [
        { lat: 35.485, lng: 133.225 },
        { lat: 35.485, lng: 133.250 },
        { lat: 35.500, lng: 133.250 },
        { lat: 35.500, lng: 133.225 },
      ],
    ],
    center: { lat: 35.4925, lng: 133.2364 },
  };
  const airports = [izumoAirport, yonagoAirport];

  it("flags red for 出雲空港 center (on-airport polygon)", () => {
    const r = evaluateAirports({ lat: 35.4133, lng: 132.8897 }, airports);
    expect(r.status).toBe<RegulationStatus>("red");
    expect(r.note).toContain("出雲縁結び空港");
    expect(r.note).toContain("敷地内");
  });

  it("flags yellow within 6km of 出雲空港", () => {
    // 約 3km 北 (0.027° ≒ 3km)。on-polygon ではない。
    const r = evaluateAirports({ lat: 35.440, lng: 132.8897 }, airports);
    expect(r.status).toBe<RegulationStatus>("yellow");
    expect(r.note).toContain("出雲縁結び空港");
  });

  it("flags green well outside 6km", () => {
    // 出雲市役所 (35.3676, 132.7549) は出雲空港から ~13km。
    const r = evaluateAirports({ lat: 35.3676, lng: 132.7549 }, airports);
    expect(r.status).toBe<RegulationStatus>("green");
  });

  it("returns unknown when airport dataset is empty (data gap)", () => {
    const r = evaluateAirports({ lat: 35.4133, lng: 132.8897 }, []);
    expect(r.status).toBe<RegulationStatus>("unknown");
    expect(r.note).toContain("空港データを読み込めませんでした");
  });

  it("drops red on airport to green with <100g weight exception", () => {
    const r = evaluateAirports(
      { lat: 35.4133, lng: 132.8897 },
      airports,
      { droneWeightG: 50 },
    );
    expect(r.status).toBe<RegulationStatus>("green");
    expect(r.appliedExceptions?.[0]?.machine?.value).toBe(100);
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
  // 「データ欠落のサイレント緑化」防止: unknown が混在していれば全体は
  // green に降格しない。red/yellow はそれ自体が確定的なので unknown を勝つ。
  it("unknown alongside green degrades overall to unknown (no silent gaps)", () => {
    expect(computeOverall([make("unknown"), make("green")])).toBe<RegulationStatus>("unknown");
  });
  it("red still dominates unknown", () => {
    expect(computeOverall([make("unknown"), make("red")])).toBe<RegulationStatus>("red");
  });
  it("yellow still dominates unknown", () => {
    expect(computeOverall([make("unknown"), make("yellow")])).toBe<RegulationStatus>("yellow");
  });
  it("empty items returns unknown", () => {
    expect(computeOverall([])).toBe<RegulationStatus>("unknown");
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
  it("totalParks matches sum of all municipal park lists (12 munis)", () => {
    expect(COVERAGE_SUMMARY.totalParks).toBe(
      TOTTORI_PARKS.length +
        YONAGO_PARKS.length +
        KURAYOSHI_PARKS.length +
        SAKAIMINATO_PARKS.length +
        YAZU_PARKS.length +
        MISASA_PARKS.length +
        YURIHAMA_PARKS.length +
        MATSUE_PARKS.length +
        IZUMO_PARKS.length +
        OHDA_PARKS.length +
        YASUGI_PARKS.length +
        UNNAN_PARKS.length,
    );
    expect(COVERAGE_SUMMARY.totalParks).toBe(ALL_MUNICIPAL_PARKS.length);
  });
  it("totalHeritage matches sum of all municipal heritage lists", () => {
    expect(COVERAGE_SUMMARY.totalHeritage).toBe(
      TOTTORI_HERITAGE_SITES.length +
        YONAGO_HERITAGE_SITES.length +
        KURAYOSHI_HERITAGE_SITES.length +
        MISASA_HERITAGE_SITES.length +
        YURIHAMA_HERITAGE_SITES.length +
        MATSUE_HERITAGE_SITES.length +
        IZUMO_HERITAGE_SITES.length +
        OHDA_HERITAGE_SITES.length +
        YASUGI_HERITAGE_SITES.length +
        UNNAN_HERITAGE_SITES.length,
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
    // 各市町村の sensitive facilities 数が手書きカウントと一致すること
    expect(sum).toBe(
      TOTTORI_SENSITIVE_FACILITIES.length +
        YONAGO_SENSITIVE_FACILITIES.length +
        KURAYOSHI_SENSITIVE_FACILITIES.length +
        SAKAIMINATO_SENSITIVE_FACILITIES.length +
        YAZU_SENSITIVE_FACILITIES.length +
        MISASA_SENSITIVE_FACILITIES.length +
        YURIHAMA_SENSITIVE_FACILITIES.length +
        MATSUE_SENSITIVE_FACILITIES.length +
        IZUMO_SENSITIVE_FACILITIES.length +
        OHDA_SENSITIVE_FACILITIES.length +
        YASUGI_SENSITIVE_FACILITIES.length +
        UNNAN_SENSITIVE_FACILITIES.length,
    );
  });
  it("includes 鳥取県 and 島根県 in prefecture coverage", () => {
    expect(COVERAGE_SUMMARY.prefectureNuisanceNames).toContain("鳥取県");
    expect(COVERAGE_SUMMARY.prefectureNuisanceNames).toContain("島根県");
  });
  it("covers 12 munis (6 per prefecture × 2 prefectures)", () => {
    expect(COVERAGE_SUMMARY.municipalParkNames).toHaveLength(12);
    expect(COVERAGE_SUMMARY.municipalParkNames).toEqual(
      expect.arrayContaining([
        "鳥取市",
        "米子市",
        "倉吉市",
        "境港市",
        "三朝町",
        "湯梨浜町",
        "八頭町",
        "松江市",
        "出雲市",
        "安来市",
        "雲南市",
        "大田市",
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
      { lat: 35.4278, lng: 133.3314 }, // 米子市役所 0m
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
      loc: { lat: 35.4278, lng: 133.3314 },
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
      loc: { lat: 35.5447, lng: 133.2269 },
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
      loc: { lat: 35.3683, lng: 132.7567 },
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

// 特許①従属項8 の実施例: overallConfidence が閾値以下なら警告を出すフラグを返す。
describe("shouldWarnConfidence (特許①従属項8)", () => {
  it("threshold is fixed at medium", () => {
    expect(LOW_CONFIDENCE_THRESHOLD).toBe("medium");
  });
  it("high → no warning", () => {
    expect(shouldWarnConfidence("high")).toBe(false);
  });
  it("medium → warn (= threshold)", () => {
    expect(shouldWarnConfidence("medium")).toBe(true);
  });
  it("low → warn", () => {
    expect(shouldWarnConfidence("low")).toBe(true);
  });
});

// 特許①従属項10 の実施例: 適用例外節を自然言語+機械可読併出力する整形ヘルパ。
describe("formatMachineCondition (特許①従属項10)", () => {
  it("weight_below_g shows numeric inequality with unit", () => {
    expect(formatMachineCondition({ type: "weight_below_g", value: 100 })).toBe(
      "weight_below_g < 100g",
    );
  });
  it("weight_above_g shows ≥ with unit", () => {
    expect(formatMachineCondition({ type: "weight_above_g", value: 25_000 })).toBe(
      "weight_above_g ≥ 25000g",
    );
  });
  it("permit_holder uses equality", () => {
    expect(formatMachineCondition({ type: "permit_holder", value: "mlit" })).toBe(
      "permit_holder == mlit",
    );
  });
  it("purpose uses equality", () => {
    expect(formatMachineCondition({ type: "purpose", value: "emergency" })).toBe(
      "purpose == emergency",
    );
  });
  it("in_zone uses equality with zone id", () => {
    expect(formatMachineCondition({ type: "in_zone", value: "municipal_park_polygon" })).toBe(
      "in_zone == municipal_park_polygon",
    );
  });
  it("time_window uses colon notation", () => {
    expect(formatMachineCondition({ type: "time_window", value: "22:00-04:00" })).toBe(
      "time_window: 22:00-04:00",
    );
  });
  it("other with value uses colon notation", () => {
    expect(formatMachineCondition({ type: "other", value: "see clause" })).toBe(
      "other: see clause",
    );
  });
  it("value-less conditions degrade gracefully", () => {
    expect(formatMachineCondition({ type: "weight_below_g" })).toBe("weight_below_g");
    expect(formatMachineCondition({ type: "permit_holder" })).toBe("permit_holder");
    expect(formatMachineCondition({ type: "time_window" })).toBe("time_window");
    expect(formatMachineCondition({ type: "other" })).toBe("other");
  });
});
