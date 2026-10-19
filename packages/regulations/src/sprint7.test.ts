// Sprint 7 契約（docs/sprints/sprint-7.md）の単体テスト：
//   A. 小型無人機等飛行禁止法（敷地境界から 1,000m）
//   B. DID データ台帳（令和2年）・curated DID フラグの扱い
//   C. DID から工業専用地域を除く 5 分岐
//   D. データ出典と確認日
//   E. 証跡 ID とエンジン版
import { haversineMeters, offsetMeters, type LatLng, type Polygon } from "@soraban/geo";
import {
  ALL_AMENDMENTS,
  ALL_DATASETS,
  buildCheckEvidencePayload,
  buildDiagnosisEvidencePayload,
  createIndustrialSource,
  DATASET_IDS,
  DEFAULT_INDUSTRIAL_SOURCE,
  deriveDiagnosis,
  deriveDidStatusFromRegulations,
  ENGINE_VERSION,
  evaluateAirports,
  evaluateDid,
  evaluateMunicipalHeritage,
  evaluateMunicipalParks,
  evaluatePrefecturalNuisance,
  evaluateSmallDroneLaw,
  extractAirspaceFlagsFromRegulations,
  formatDidDetermination,
  getDataset,
  INDUSTRIAL_COVERAGE,
  isSmallDroneLawTriggered,
  mergeAirspaceFlags,
  MIHO_AIRBASE_CENTER,
  parseSmallDroneFacility,
  SMALL_DRONE_LAW_FACILITIES,
  SMALL_DRONE_LAW_PROCEDURE_ID,
  ALL_PROCEDURES,
  type DidCandidate,
  type IndustrialCoverageEntry,
  type RegulationWithStatus,
  type SmallDroneFacility,
} from "./index";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// ============================================================
// A. 小型無人機等飛行禁止法
// ============================================================

// 美保基地の敷地を模したテスト用ポリゴン（東西 3,000m × 南北 800m の長方形）。
// 実データではない（実データは中心点のみ。data/small-drone-law/README.md）。
// 境界からの距離で判定していることを、東西に長い敷地で確かめるための形状。
const MIHO_TEST_RING: Polygon = [
  offsetMeters(MIHO_AIRBASE_CENTER, -1500, -400),
  offsetMeters(MIHO_AIRBASE_CENTER, 1500, -400),
  offsetMeters(MIHO_AIRBASE_CENTER, 1500, 400),
  offsetMeters(MIHO_AIRBASE_CENTER, -1500, 400),
];

const mihoReal = SMALL_DRONE_LAW_FACILITIES.find((f) => f.id === "jasdf-miho");
if (!mihoReal) throw new Error("facilities.json に美保基地がない");

const MIHO_POLYGON_FIXTURE: SmallDroneFacility = {
  ...mihoReal,
  geometry: { type: "polygon", rings: [MIHO_TEST_RING] },
  geometrySource: "テスト用の長方形（実データではない）",
};

describe("A. 小型無人機等飛行禁止法（敷地境界から 1,000m）", () => {
  const facilities = [MIHO_POLYGON_FIXTURE];
  const north = (fromBoundaryM: number): LatLng =>
    offsetMeters(MIHO_AIRBASE_CENTER, 0, 400 + fromBoundaryM);

  it("敷地ポリゴンの外側で、境界から 999m は red、1,001m は yellow、1,000m＋yellow 幅＋1m は green", () => {
    expect(evaluateSmallDroneLaw(north(999), undefined, facilities).status).toBe("red");
    expect(evaluateSmallDroneLaw(north(1001), undefined, facilities).status).toBe("yellow");
    const yellowWidth = MIHO_POLYGON_FIXTURE.yellowWidthM;
    expect(yellowWidth).toBe(300);
    expect(
      evaluateSmallDroneLaw(north(1000 + yellowWidth + 1), undefined, facilities).status,
    ).toBe("green");
  });

  it("yellow の note は『告示の区域図で要確認』で、空港の進入表面には触れない", () => {
    const r = evaluateSmallDroneLaw(north(1100), undefined, facilities);
    expect(r.status).toBe("yellow");
    expect(r.note).toContain("おおむね 1,000m");
    expect(r.note).toContain("告示の区域図で要確認");
    expect(r.note).not.toContain("進入表面");
  });

  it("境界から 700m かつ中心から 1,500m 超の地点は red（中心点ではなく境界からの距離で判定）", () => {
    const p = offsetMeters(MIHO_AIRBASE_CENTER, 1500 + 700, 0);
    expect(haversineMeters(p, MIHO_AIRBASE_CENTER)).toBeGreaterThan(1500);
    const r = evaluateSmallDroneLaw(p, undefined, facilities);
    expect(r.status).toBe("red");
    expect(r.facilityHits?.[0]?.distanceFromBoundaryM).toBe(700);
    expect(r.note).toContain("1,000m");
  });

  it("敷地内は red", () => {
    expect(evaluateSmallDroneLaw(MIHO_AIRBASE_CENTER, undefined, facilities).status).toBe("red");
  });

  it("中心点のみの施設は推定敷地半径を足した距離で判定し、note に『概算』が入る", () => {
    const f = SMALL_DRONE_LAW_FACILITIES.find((x) => x.geometry.type === "center");
    if (!f || f.geometry.type !== "center") throw new Error("中心点のみの施設がない");
    const r0 = f.geometry.estimatedSiteRadiusM;
    // 中心から（推定半径＋999m）→ red、（推定半径＋1,001m）→ yellow
    const red = evaluateSmallDroneLaw(offsetMeters(f.geometry.center, 0, r0 + 999), undefined, [f]);
    expect(red.status).toBe("red");
    expect(red.note).toContain("概算");
    expect(red.facilityHits?.[0]?.approximate).toBe(true);
    const yellow = evaluateSmallDroneLaw(
      offsetMeters(f.geometry.center, 0, r0 + 1001),
      undefined,
      [f],
    );
    expect(yellow.status).toBe("yellow");
    expect(yellow.note).toContain("概算");
  });

  it("対象施設データの全件に、根拠告示の URL・敷地形状の出典・確認日（ISO 日付）が入っている", () => {
    expect(SMALL_DRONE_LAW_FACILITIES.length).toBeGreaterThan(0);
    for (const f of SMALL_DRONE_LAW_FACILITIES) {
      expect(f.designation.url).toMatch(/^https:\/\//);
      expect(f.geometrySource.length).toBeGreaterThan(0);
      expect(f.verifiedAt).toMatch(ISO_DATE);
      expect(f.verifiedBy.length).toBeGreaterThan(0);
      expect(f.aroundM).toBe(1000);
      expect(f.yellowWidthM).toBe(300);
    }
  });

  it("根拠告示の URL が欠けた施設データはデータ不備として例外になる", () => {
    expect(() =>
      parseSmallDroneFacility(
        { ...MIHO_POLYGON_FIXTURE, designation: { title: "x", url: "" } } as unknown as Record<
          string,
          unknown
        >,
        { aroundM: 1000, yellowWidthM: 300 },
      ),
    ).toThrow();
  });

  it("規制の要約・本文に『おおむね 1,000m』と罰則があり、『300m』『1.5km』は残っていない", () => {
    const r = evaluateSmallDroneLaw(MIHO_AIRBASE_CENTER);
    const text = [r.summary, r.clauseGraph.main.text, ...r.clauseGraph.conditions.map((c) => c.description)].join(
      "\n",
    );
    expect(text).toContain("おおむね 1,000m");
    expect(r.summary).toContain("罰則");
    expect(text).not.toMatch(/(^|[^0-9,])300m/);
    expect(text).not.toContain("1.5km");
    expect(r.amendments.map((a) => a.effectiveDate)).toContain("2026-07-14");
  });

  it("小型無人機等には 100g 未満の除外がない（機体重量 50g でも red）", () => {
    expect(evaluateSmallDroneLaw(MIHO_AIRBASE_CENTER, { droneWeightG: 50 }).status).toBe("red");
  });

  it("red／yellow のときだけ申請支援に『施設管理者の同意＋公安委員会への事前通報』が出る", () => {
    const proc = ALL_PROCEDURES.find((p) => p.id === SMALL_DRONE_LAW_PROCEDURE_ID);
    expect(proc?.title).toBe(
      "施設管理者の同意 ＋ 都道府県公安委員会への事前通報（飛行の 48 時間前まで）",
    );
    expect(proc?.sourceUrl).toMatch(/^https:\/\//);
    expect(proc?.legalBasis.length).toBeGreaterThan(0);
    expect(proc?.verifiedAt).toBeTruthy();
    expect(proc?.leadTimeBusinessDays).toBe(0); // 開庁日計算の対象外

    const red = evaluateSmallDroneLaw(MIHO_AIRBASE_CENTER);
    const green = evaluateSmallDroneLaw({ lat: 35.0, lng: 135.0 });
    expect(isSmallDroneLawTriggered([red])).toBe(true);
    expect(isSmallDroneLawTriggered([green])).toBe(false);

    const withProc = deriveDiagnosis({ flags: [], droneWeightG: 50, smallDroneLawTriggered: true });
    expect(withProc.procedures.map((p) => p.id)).toContain(SMALL_DRONE_LAW_PROCEDURE_ID);
    expect(withProc.deadlines.map((d) => d.procedureId)).not.toContain(
      SMALL_DRONE_LAW_PROCEDURE_ID,
    );
    const without = deriveDiagnosis({ flags: [], droneWeightG: 900, smallDroneLawTriggered: false });
    expect(without.procedures.map((p) => p.id)).not.toContain(SMALL_DRONE_LAW_PROCEDURE_ID);
  });
});

// ============================================================
// B. DID データ台帳・curated フラグ
// ============================================================

describe("B. DID データ（令和2年）", () => {
  it("DID データの台帳の基準年が令和2年（2020）で、出典 URL と確認日が入っている", () => {
    const did = getDataset(DATASET_IDS.did);
    expect(did.baseYear).toBe(2020);
    expect(did.url).toMatch(/^https:\/\/nlftp\.mlit\.go\.jp\//);
    expect(did.verifiedAt).toMatch(ISO_DATE);
  });

  it("エンジンの DID 判定が『非該当』の地点では、curated DID フラグがあっても airspace_did が付かない", () => {
    const merged = mergeAirspaceFlags({
      derivedFlags: [],
      userFlags: ["airspace_did"],
      autoDidStatus: "not_applicable",
    });
    expect(merged).not.toContain("airspace_did");
    const diag = deriveDiagnosis({ flags: merged, droneWeightG: 900, didStatus: "not_applicable" });
    expect(diag.didStatus).toBe("not_applicable");
    expect(diag.procedures.map((p) => p.id)).not.toContain("flight-permission-did");
  });

  it("エンジンが『未確認』のときだけ curated DID フラグを使う", () => {
    expect(
      mergeAirspaceFlags({ derivedFlags: [], userFlags: ["airspace_did"], autoDidStatus: "unverified" }),
    ).toContain("airspace_did");
    // 「該当」のときはエンジン由来で既に付く（重複しない）
    expect(
      mergeAirspaceFlags({
        derivedFlags: ["airspace_did"],
        userFlags: ["airspace_did"],
        autoDidStatus: "applicable",
      }),
    ).toEqual(["airspace_did"]);
  });
});

// ============================================================
// C. 工業専用地域の除外
// ============================================================

describe("C. DID から工業専用地域を除く（告示第435号）", () => {
  const o: LatLng = { lat: 35.43, lng: 133.33 };
  const didRing: Polygon = [
    offsetMeters(o, -2000, -2000),
    offsetMeters(o, 2000, -2000),
    offsetMeters(o, 2000, 2000),
    offsetMeters(o, -2000, 2000),
  ];
  // 工業専用地域：地点 o を中心とする 1,000m 四方
  const indRing: Polygon = [
    offsetMeters(o, -500, -500),
    offsetMeters(o, 500, -500),
    offsetMeters(o, 500, 500),
    offsetMeters(o, -500, 500),
  ];
  const RECORDED = "99901";
  const NOT_RECORDED = "99902";
  const did = (muniCode: string): DidCandidate[] => [
    { muniCode, muniName: muniCode === RECORDED ? "収録市" : "未収録町", polygon: didRing },
  ];
  const coverage: IndustrialCoverageEntry[] = [
    {
      muniCode: RECORDED,
      muniName: "収録市",
      status: "recorded",
      didOverlap: "overlap",
      source: "テスト",
      baseDate: "2026-04-01",
      checkedAt: "2026-10-19",
    },
    {
      muniCode: NOT_RECORDED,
      muniName: "未収録町",
      status: "not_recorded",
      didOverlap: "unverified",
      source: null,
      baseDate: null,
      checkedAt: "2026-10-19",
    },
  ];
  const industrial = createIndustrialSource({
    coverage,
    zonesByMuni: { [RECORDED]: [{ muniCode: RECORDED, rings: [indRing] }] },
    insideMarginM: 10,
  });
  const opts = { industrial };
  const outsideDid = offsetMeters(o, 5000, 0);
  const inDidOutsideInd = offsetMeters(o, 1000, 0);

  it("5 分岐が unknown／green／green／red／red を返す", () => {
    expect(evaluateDid(o, null, undefined, opts).status).toBe("unknown");
    expect(evaluateDid(outsideDid, did(RECORDED), undefined, opts).status).toBe("green");
    const b3 = evaluateDid(o, did(RECORDED), undefined, opts);
    expect(b3.status).toBe("green");
    expect(b3.didDetail).toBe("industrial_exclusive");
    expect(evaluateDid(inDidOutsideInd, did(RECORDED), undefined, opts).status).toBe("red");
    // 分岐 5 は、どの収録済み工専にも含まれない地点で確かめる（工専は市町村境をまたいで探すため）
    const b5 = evaluateDid(inDidOutsideInd, did(NOT_RECORDED), undefined, opts);
    expect(b5.status).toBe("red");
    expect(b5.didDetail).toBe("in_did_exclusion_unverified");
  });

  it("工専の境界から内側 9m は red（境界付近の note あり）、内側 11m は green", () => {
    const in9 = evaluateDid(offsetMeters(o, 0, 500 - 9), did(RECORDED), undefined, opts);
    expect(in9.status).toBe("red");
    expect(in9.didDetail).toBe("in_did_near_industrial_boundary");
    expect(in9.note).toContain("境界付近");
    const in11 = evaluateDid(offsetMeters(o, 0, 500 - 11), did(RECORDED), undefined, opts);
    expect(in11.status).toBe("green");
  });

  it("分岐 3 の note に告示第435号・別途必要な許可承認・地点単位の注意が入る", () => {
    const r = evaluateDid(o, did(RECORDED), undefined, opts);
    expect(r.note).toContain("告示第435号");
    expect(r.note).toContain("空港等周辺");
    expect(r.note).toContain("150m");
    expect(r.note).toContain("飛行の方法");
    expect(r.note).toContain("地点単位");
    expect(r.amendments.map((a) => a.id)).toContain("mlit-kokuji-435");
    expect(r.amendments[0]?.url).toMatch(/^https:\/\//);
  });

  it("工専内（分岐 3）で他の特定飛行フラグがなければ、カテゴリー I・DID の三値は『非該当』", () => {
    const r = evaluateDid(o, did(RECORDED), undefined, opts);
    const flags = extractAirspaceFlagsFromRegulations([r]);
    expect(flags).not.toContain("airspace_did");
    const didStatus = deriveDidStatusFromRegulations([r]);
    expect(didStatus).toBe("not_applicable");
    const diag = deriveDiagnosis({
      flags,
      droneWeightG: 900,
      didStatus,
      didDetail: r.didDetail,
    });
    expect(diag.category).toBe("I");
    expect(diag.didStatus).toBe("not_applicable");
    expect(formatDidDetermination(diag.didStatus, diag.didDetail)).toBe("非該当（工業専用地域）");
  });

  it("未収録（分岐 5）の note に『工業専用地域の除外：未確認』が入る", () => {
    const r = evaluateDid(inDidOutsideInd, did(NOT_RECORDED), undefined, opts);
    expect(r.note).toContain("工業専用地域の除外：未確認");
    expect(r.note).toContain("市の用途地域図で確認");
    // 台帳に無い市町村も未収録として扱う
    const unknownMuni = evaluateDid(inDidOutsideInd, did("99999"), undefined, opts);
    expect(unknownMuni.status).toBe("red");
    expect(unknownMuni.note).toContain("工業専用地域の除外：未確認");
  });

  it("台帳が recorded でもポリゴンが無ければ未収録として扱う（安全側）", () => {
    const src = createIndustrialSource({ coverage, zonesByMuni: {} });
    expect(src.coverage(RECORDED)?.status).toBe("not_recorded");
    expect(evaluateDid(o, did(RECORDED), undefined, { industrial: src }).didDetail).toBe(
      "in_did_exclusion_unverified",
    );
  });

  // 日吉津村の工専が米子市の DID に重なる帯（実データ）の構図を、架空のデータで再現する。
  describe("工専の参照を DID の市町村コードに頼らない（市町村境をまたぐ重なり）", () => {
    const DID_MUNI = "99911"; // DID を持つ市（収録済み）
    const NEIGHBOR = "99912"; // 隣の村（収録済み）。その工専が市の DID にはみ出している
    const UNRECORDED_DID = "99913"; // 工専未収録の市の DID
    // 隣村の工専：幅 12m の細い帯と、内側に十分な広さのある区画
    const strip: Polygon = [
      offsetMeters(o, -300, -6),
      offsetMeters(o, 300, -6),
      offsetMeters(o, 300, 6),
      offsetMeters(o, -300, 6),
    ];
    const wide: Polygon = [
      offsetMeters(o, 700, -300),
      offsetMeters(o, 1300, -300),
      offsetMeters(o, 1300, 300),
      offsetMeters(o, 700, 300),
    ];
    const src = createIndustrialSource({
      coverage: [
        { muniCode: DID_MUNI, muniName: "DID市", status: "recorded", didOverlap: "overlap", source: "テスト", baseDate: null, checkedAt: "2026-10-19" },
        { muniCode: NEIGHBOR, muniName: "隣村", status: "recorded", didOverlap: "overlap", source: "テスト", baseDate: null, checkedAt: "2026-10-19" },
      ],
      zonesByMuni: {
        [DID_MUNI]: [{ muniCode: DID_MUNI, rings: [indRing.map((p) => offsetMeters(p, -5000, -5000))] }],
        [NEIGHBOR]: [
          { muniCode: NEIGHBOR, rings: [strip] },
          { muniCode: NEIGHBOR, rings: [wide] },
        ],
      },
      insideMarginM: 10,
    });
    const didOf = (muniCode: string, muniName: string): DidCandidate[] => [
      { muniCode, muniName, polygon: didRing },
    ];

    it("隣村の工専の細い帯（内側 10m 未満）にある地点は red・境界付近で、隣村の工専と書き、『工業専用地域外』と言い切らない", () => {
      const r = evaluateDid(o, didOf(DID_MUNI, "DID市"), undefined, { industrial: src });
      expect(r.status).toBe("red");
      expect(r.didDetail).toBe("in_did_near_industrial_boundary");
      expect(r.note).toContain("隣村 の工業専用地域の境界");
      expect(r.note).not.toContain("工業専用地域外です");
    });

    it("隣村の工専の十分内側にある地点は green（非該当（工業専用地域））で、隣村の工専と書く", () => {
      const p = offsetMeters(o, 1000, 0);
      const r = evaluateDid(p, didOf(DID_MUNI, "DID市"), undefined, { industrial: src });
      expect(r.status).toBe("green");
      expect(r.didDetail).toBe("industrial_exclusive");
      expect(r.note).toContain("隣村 の工業専用地域内");
    });

    it("DID の市町村が未収録でも、収録済みの隣村の工専内なら除外できる", () => {
      const p = offsetMeters(o, 1000, 0);
      const r = evaluateDid(p, didOf(UNRECORDED_DID, "未収録市"), undefined, { industrial: src });
      expect(r.status).toBe("green");
      expect(r.didDetail).toBe("industrial_exclusive");
    });

    it("どの工専にも含まれない地点は red。収録済みなら『収録済みの工業専用地域のいずれにも含まれません』", () => {
      const p = offsetMeters(o, -1000, 1000);
      const r = evaluateDid(p, didOf(DID_MUNI, "DID市"), undefined, { industrial: src });
      expect(r.status).toBe("red");
      expect(r.didDetail).toBe("in_did");
      expect(r.note).toContain("収録済みの工業専用地域");
      const u = evaluateDid(p, didOf(UNRECORDED_DID, "未収録市"), undefined, { industrial: src });
      expect(u.didDetail).toBe("in_did_exclusion_unverified");
    });
  });

  // 同梱データ（収録済み市町村の有無）に依存しない形で、既定の読み込み口の整合を確かめる。
  it("既定の読み込み口：台帳にない市町村は除外未確認、収録済みの市町村はポリゴンを持つ", () => {
    const r = evaluateDid(o, did("99999"), undefined, { industrial: DEFAULT_INDUSTRIAL_SOURCE });
    expect(r.didDetail).toBe("in_did_exclusion_unverified");
    for (const e of INDUSTRIAL_COVERAGE) {
      const c = DEFAULT_INDUSTRIAL_SOURCE.coverage(e.muniCode);
      if (c?.status === "recorded") {
        expect(DEFAULT_INDUSTRIAL_SOURCE.zones(e.muniCode).length, e.muniCode).toBeGreaterThan(0);
      } else {
        expect(DEFAULT_INDUSTRIAL_SOURCE.zones(e.muniCode)).toEqual([]);
      }
    }
  });

  it("収録範囲台帳の didOverlap は全件が確定している（unverified がない）", () => {
    // 同梱の DID と工専の重なりは scripts/compute-did-overlap.mjs で計算して確定する。
    for (const e of INDUSTRIAL_COVERAGE) {
      expect(e.didOverlap, `${e.muniCode} ${e.muniName}`).not.toBe("unverified");
    }
  });

  it("収録範囲台帳の全件に市町村コード・収録状況・確認日・DID 重複の確認結果がある", () => {
    expect(INDUSTRIAL_COVERAGE.length).toBeGreaterThan(0);
    for (const e of INDUSTRIAL_COVERAGE) {
      expect(e.muniCode).toMatch(/^3[12]\d{3}$/);
      expect(["recorded", "not_recorded"]).toContain(e.status);
      expect(["overlap", "no_overlap", "unverified"]).toContain(e.didOverlap);
      expect(e.checkedAt).toMatch(ISO_DATE);
      if (e.status === "recorded") expect(e.source).toBeTruthy();
    }
  });
});

// ============================================================
// D. データ出典と確認日
// ============================================================

describe("D. データ出典と確認日", () => {
  const loc: LatLng = { lat: 35.4278, lng: 133.3314 };
  const all = (): RegulationWithStatus[] => [
    evaluateDid(loc, null),
    evaluateDid(loc, []),
    evaluateAirports(loc, []),
    evaluateSmallDroneLaw(loc),
    evaluateSmallDroneLaw(loc, undefined, []),
    evaluateMunicipalParks(loc, "31202"),
    evaluateMunicipalParks(loc, undefined),
    evaluateMunicipalHeritage(loc, "31202"),
    evaluateMunicipalHeritage(loc, undefined),
    evaluatePrefecturalNuisance(loc, "31202"),
    evaluatePrefecturalNuisance(loc, undefined),
  ];

  it("すべての規制評価器の返り値に 1 件以上のデータセット参照があり、参照 ID はすべて台帳に存在する", () => {
    const ids = new Set(ALL_DATASETS.map((d) => d.id));
    for (const r of all()) {
      expect(r.datasets.length, r.id).toBeGreaterThan(0);
      for (const d of r.datasets) {
        expect(ids.has(d.id), `${r.id} → ${d.id}`).toBe(true);
        expect(d.verifiedAt).toMatch(ISO_DATE);
      }
    }
  });

  it("台帳の全件に URL・ライセンス・確認日がある", () => {
    for (const d of ALL_DATASETS) {
      expect(d.url, d.id).toMatch(/^https:\/\//);
      expect(d.license.length, d.id).toBeGreaterThan(0);
      expect(d.verifiedAt, d.id).toMatch(ISO_DATE);
      expect(d.verifiedBy.length, d.id).toBeGreaterThan(0);
    }
  });

  it("反映済みの改正は告示第435号（2026-07-01）と改正飛行禁止法（2026-07-14）", () => {
    const dates = Object.fromEntries(ALL_AMENDMENTS.map((a) => [a.id, a.effectiveDate]));
    expect(dates["mlit-kokuji-435"]).toBe("2026-07-01");
    expect(dates["small-drone-law-2026"]).toBe("2026-07-14");
  });
});

// ============================================================
// E. 証跡とエンジン版
// ============================================================

describe("E. 証跡 ID", () => {
  // 証跡 ID はこのペイロードの SHA-256（apps/web/src/server/check-core.ts）。ペイロードが変われば ID も変わる。
  // ハッシュ込みの確認は apps/web/src/server/handlers.test.ts で行う。
  const sha = (s: string): string => s;
  const base = {
    engineVersion: ENGINE_VERSION,
    lat: 35.4278,
    lng: 133.3314,
    checkedAt: "2026-11-02T00:00:00.000Z",
    regulationIds: ["aviation-law-did", "small-drone-law"],
    ctx: { droneWeightG: 900 },
  };

  it("ENGINE_VERSION が Sprint 6 時点の soraban-0.2.0-clausegraph から変わっている", () => {
    expect(ENGINE_VERSION).not.toBe("soraban-0.2.0-clausegraph");
  });

  it("同じ地点・同じ条件でも、データセットの確認日を変えると証跡 ID が変わる", () => {
    const a = sha(
      buildCheckEvidencePayload({
        ...base,
        datasets: [{ id: "did-r2", verifiedAt: "2026-10-19" }],
      }),
    );
    const b = sha(
      buildCheckEvidencePayload({
        ...base,
        datasets: [{ id: "did-r2", verifiedAt: "2026-12-01" }],
      }),
    );
    const a2 = sha(
      buildCheckEvidencePayload({
        ...base,
        datasets: [{ id: "did-r2", verifiedAt: "2026-10-19" }],
      }),
    );
    expect(a).not.toBe(b);
    expect(a).toBe(a2);
  });

  it("申請支援診断の証跡もデータセットの確認日で変わる", () => {
    const common = {
      engineVersion: ENGINE_VERSION,
      lat: 35.4278,
      lng: 133.3314,
      checkedAt: "2026-11-02T00:00:00.000Z",
      regulationIds: ["aviation-law-did"],
      flags: [],
      category: "I" as const,
      procedureIds: [],
    };
    expect(
      buildDiagnosisEvidencePayload({ ...common, datasets: [{ id: "x", verifiedAt: "2026-10-19" }] }),
    ).not.toBe(
      buildDiagnosisEvidencePayload({ ...common, datasets: [{ id: "x", verifiedAt: "2026-10-20" }] }),
    );
  });
});
