// Sprint 11d 契約 1〜5（単体）：判定の 4 段の規則（spec §13.9.3・§13.9.4）、許可の両方必須、
// 並べ方、期限、旧値の読み替え。
import { describe, expect, it } from "vitest";
import {
  ALL_SENSITIVE_FACILITIES,
  buildDiagnosisEvidencePayload,
  createIndustrialSource,
  DIPS_PERMIT_KINDS,
  dipsPermitValue,
  deriveFlightVerdict,
  evaluateAirports,
  evaluateDid,
  evaluateMunicipalHeritage,
  evaluateMunicipalParks,
  evaluatePrefecturalNuisance,
  evaluateSmallDroneLaw,
  extractAirspaceFlagsFromRegulations,
  deriveDidStatusFromRegulations,
  formatMachineCondition,
  MIHO_AIRBASE_CENTER,
  sortVerdictProcedures,
  VERDICT_LABEL,
  BASE_STATUS_LABEL,
  LEGACY_STATUS_LABEL,
  type AirportCandidate,
  type DidCandidate,
  type FlightContext,
  type RegulationStatus,
  type RegulationWithStatus,
  type SpecificFlightFlag,
  type VerdictProcedure,
} from "./index";

const ALL_PERMIT_VALUES: readonly string[] = [
  "mlit",
  ...DIPS_PERMIT_KINDS.map(dipsPermitValue),
  "park_manager",
  "facility_manager",
  "pref_pubsafety_notice",
  "facility_manager_and_pref_pubsafety",
  "bunkacho_or_kyoiku",
];
const PURPOSES = [undefined, "emergency", "public_duty", "city_event"] as const;
const ALL_FLAGS: readonly SpecificFlightFlag[] = [
  "airspace_airport",
  "airspace_150m",
  "airspace_did",
  "airspace_emergency",
  "method_night",
  "method_bvlos",
  "method_30m",
  "method_event",
  "method_dangerous",
  "method_drop",
];

const NO_INDUSTRIAL = { industrial: createIndustrialSource({ coverage: [], zonesByMuni: {} }) };
const yonagoDid: DidCandidate = {
  muniCode: "31202",
  muniName: "米子市",
  polygon: [
    { lat: 35.41, lng: 133.31 },
    { lat: 35.41, lng: 133.36 },
    { lat: 35.46, lng: 133.36 },
    { lat: 35.46, lng: 133.31 },
  ],
};
const yonagoAirport: AirportCandidate = {
  id: "RJOH",
  name: "米子鬼太郎空港",
  polygons: [
    [
      { lat: 35.485, lng: 133.225 },
      { lat: 35.485, lng: 133.25 },
      { lat: 35.5, lng: 133.25 },
      { lat: 35.5, lng: 133.225 },
    ],
  ],
  center: { lat: 35.4925, lng: 133.2364 },
};

/** 地点の全規制（DID はテスト用の多角形）。 */
const evaluateAll = (
  loc: { lat: number; lng: number },
  muni: string | undefined,
  ctx?: FlightContext,
): RegulationWithStatus[] => [
  evaluateDid(loc, [yonagoDid], ctx, NO_INDUSTRIAL),
  evaluateAirports(loc, [yonagoAirport], ctx),
  evaluateSmallDroneLaw(loc, ctx),
  evaluateMunicipalParks(loc, muni, ctx),
  evaluateMunicipalHeritage(loc, muni, ctx),
  evaluatePrefecturalNuisance(loc, muni, ctx),
];

const YONAGO_CITY_HALL = { lat: 35.4278, lng: 133.3314 };
const MINATOYAMA = { lat: 35.4267, lng: 133.322 }; // 公園＋史跡
const AIRPORT_ON_SITE = { lat: 35.4925, lng: 133.2364 };
const MIHO_VICINITY = { lat: 35.4936, lng: 133.26604 };

const LOCATIONS = [
  { name: "米子市役所", loc: YONAGO_CITY_HALL, muni: "31202" },
  { name: "湊山公園", loc: MINATOYAMA, muni: "31202" },
  { name: "空港の敷地内", loc: AIRPORT_ON_SITE, muni: "31204" },
  { name: "美保基地の周辺", loc: MIHO_VICINITY, muni: "31204" },
  { name: "美保基地の中心", loc: MIHO_AIRBASE_CENTER, muni: "31204" },
  { name: "収録外", loc: { lat: 35.434238, lng: 133.380508 }, muni: "31390" },
  ...ALL_SENSITIVE_FACILITIES.slice(0, 12).map((f) => ({
    name: f.name,
    loc: f.center,
    muni: f.id.startsWith("izumo") || f.id.startsWith("matsue") ? "32201" : "31202",
  })),
];

const item = (v: ReturnType<typeof deriveFlightVerdict>, id: string) => {
  const it = v.items.find((i) => i.id === id);
  if (!it) throw new Error(`item ${id} がない`);
  return it;
};

describe("契約 1：規制ごとの判定の規則", () => {
  it("red で満たす例外が当たると手続き済み（条件付き）、当たらないと要手続き。status は変わらない", () => {
    const ctx: FlightContext = { pilotPermits: ["mlit:did"] };
    const regs = evaluateAll(YONAGO_CITY_HALL, "31202", ctx);
    const did = regs.find((r) => r.id === "aviation-law-did")!;
    expect(did.status).toBe<RegulationStatus>("red");
    const v = deriveFlightVerdict({ regulations: regs, ctx });
    expect(item(v, "aviation-law-did").verdict).toBe("procedure_done");
    expect(item(v, "aviation-law-did").baseStatus).toBe("red");
    expect(item(v, "aviation-law-did").appliedPermits[0]?.machine).toBe("permit_holder == mlit:did");

    const none = deriveFlightVerdict({ regulations: evaluateAll(YONAGO_CITY_HALL, "31202"), ctx: undefined });
    expect(item(none, "aviation-law-did").verdict).toBe("needs_procedure");
  });

  it("yellow で満たす例外が当たると手続き済み（条件付き）、当たらないと要手続き（理由に「該当の可能性（要確認）」）", () => {
    const regs = evaluateAll(YONAGO_CITY_HALL, "31202", { pilotPermits: ["facility_manager"] });
    const pref = regs.find((r) => r.id === "31-pref-nuisance-prevention")!;
    expect(pref.status).toBe<RegulationStatus>("yellow");
    const v = deriveFlightVerdict({ regulations: regs, ctx: { pilotPermits: ["facility_manager"] } });
    expect(item(v, pref.id).verdict).toBe("procedure_done");
    const n = deriveFlightVerdict({ regulations: evaluateAll(YONAGO_CITY_HALL, "31202") });
    expect(item(n, pref.id).verdict).toBe("needs_procedure");
    expect(item(n, pref.id).reason).toContain("該当の可能性（要確認）");
  });

  it("green は手続き不要、unknown は判定不能", () => {
    const regs = evaluateAll({ lat: 35.434238, lng: 133.380508 }, "31390");
    const v = deriveFlightVerdict({ regulations: regs });
    for (const r of regs) {
      const it = item(v, r.id);
      if (r.status === "green") expect(it.verdict).toBe("no_procedure");
      if (r.status === "unknown") expect(it.verdict).toBe("unknown");
    }
    expect(v.items.some((i) => i.verdict === "unknown")).toBe(true);
  });

  it("許可・同意・目的で status が変わらない", () => {
    for (const purpose of PURPOSES) {
      const ctx: FlightContext = { pilotPermits: ALL_PERMIT_VALUES, ...(purpose ? { purpose } : {}) };
      for (const l of LOCATIONS) {
        const without = evaluateAll(l.loc, l.muni);
        const withAll = evaluateAll(l.loc, l.muni, ctx);
        expect(withAll.map((r) => r.status)).toEqual(without.map((r) => r.status));
      }
    }
  });

  it("100g 未満では航空法の status が green に、工業専用地域では DID が green になる", () => {
    const regs = evaluateAll(YONAGO_CITY_HALL, "31202", { droneWeightG: 80 });
    expect(regs.find((r) => r.id === "aviation-law-did")!.status).toBe("green");
    // 空港の敷地内は飛行不可の区分のため、100g 未満でも red のまま（差し戻し 1 回目 F1）
    expect(evaluateAirports(AIRPORT_ON_SITE, [yonagoAirport], { droneWeightG: 80 }).status).toBe("red");
    // 工業専用地域（収録済み・内側）
    const zone = {
      muniCode: "31202",
      rings: [
        [
          { lat: 35.42, lng: 133.32 },
          { lat: 35.42, lng: 133.34 },
          { lat: 35.44, lng: 133.34 },
          { lat: 35.44, lng: 133.32 },
        ],
      ],
    };
    const industrial = createIndustrialSource({
      coverage: [
        {
          muniCode: "31202",
          muniName: "米子市",
          status: "recorded",
          didOverlap: "overlaps",
          source: "テスト",
          baseDate: null,
          checkedAt: "2026-10-20",
        } as never,
      ],
      zonesByMuni: { "31202": [zone] },
      insideMarginM: 10,
    });
    const did = evaluateDid(YONAGO_CITY_HALL, [yonagoDid], { droneWeightG: 900 }, { industrial });
    expect(did.status).toBe<RegulationStatus>("green");
    expect(did.didDetail).toBe("industrial_exclusive");
    const v = deriveFlightVerdict({ regulations: [did] });
    expect(item(v, "aviation-law-did").verdict).toBe("no_procedure");
  });
});

describe("契約 2：どの許可の組み合わせでも、該当・該当の可能性の規制は手続き不要にならない", () => {
  it("全ての許可の値・各目的・全ての飛行の条件で、全地点の全規制を確かめる", () => {
    for (const purpose of PURPOSES) {
      const ctx: FlightContext = {
        droneWeightG: 900,
        pilotPermits: ALL_PERMIT_VALUES,
        ...(purpose ? { purpose } : {}),
      };
      for (const l of LOCATIONS) {
        const regs = evaluateAll(l.loc, l.muni, ctx);
        const v = deriveFlightVerdict({ regulations: regs, ctx, flags: ALL_FLAGS });
        for (const it of v.items) {
          if (it.baseStatus === "red" || it.baseStatus === "yellow") {
            expect(it.verdict, `${l.name} ${it.id}`).not.toBe("no_procedure");
          }
        }
        expect(v.level).not.toBe("no_procedure");
      }
    }
  });

  it("許可の部分集合（各 1 つ）でも同じ", () => {
    for (const p of ALL_PERMIT_VALUES) {
      const ctx: FlightContext = { pilotPermits: [p] };
      for (const l of LOCATIONS) {
        const v = deriveFlightVerdict({ regulations: evaluateAll(l.loc, l.muni, ctx), ctx, flags: ALL_FLAGS });
        for (const it of v.items) {
          if (it.baseStatus === "red" || it.baseStatus === "yellow") expect(it.verdict).not.toBe("no_procedure");
        }
      }
    }
  });
});

describe("契約 3：空港の敷地内と緊急用務空域は、全ての許可を入れても飛行不可", () => {
  it("空港の敷地内", () => {
    const ctx: FlightContext = { droneWeightG: 900, pilotPermits: ALL_PERMIT_VALUES, purpose: "emergency" };
    const regs = evaluateAll(AIRPORT_ON_SITE, "31204", ctx);
    const ap = regs.find((r) => r.id === "aviation-law-airport")!;
    expect(ap.noFlyCategory).toBe(true);
    expect(ap.satisfiedBy).toBeUndefined();
    const v = deriveFlightVerdict({ regulations: regs, ctx });
    expect(item(v, "aviation-law-airport").verdict).toBe("no_fly");
    expect(v.level).toBe("no_fly");
    expect(v.noFly.map((n) => n.itemId)).toContain("aviation-law-airport");
  });

  it("空港の敷地内は 100g 未満・全許可・全目的・150m 以上でも飛行不可（差し戻し 1 回目 F1）", () => {
    for (const purpose of PURPOSES) {
      for (const w of [50, 80, 900, undefined]) {
        const ctx: FlightContext = {
          ...(w !== undefined ? { droneWeightG: w } : {}),
          pilotPermits: ALL_PERMIT_VALUES,
          ...(purpose ? { purpose } : {}),
        };
        const regs = evaluateAll(AIRPORT_ON_SITE, "31204", ctx);
        const v = deriveFlightVerdict({ regulations: regs, ctx, flags: ["airspace_150m"] });
        expect(item(v, "aviation-law-airport").verdict, `${w} ${purpose}`).toBe("no_fly");
        expect(v.level).toBe("no_fly");
      }
    }
  });

  it("緊急用務空域（100g 未満の機体でも）", () => {
    for (const w of [900, 50, undefined]) {
      const ctx: FlightContext = {
        ...(w !== undefined ? { droneWeightG: w } : {}),
        pilotPermits: ALL_PERMIT_VALUES,
      };
      const v = deriveFlightVerdict({
        regulations: evaluateAll({ lat: 35.434238, lng: 133.380508 }, "31390", ctx),
        ctx,
        flags: ["airspace_emergency"],
      });
      expect(item(v, "airspace_emergency").verdict).toBe("no_fly");
      expect(v.level).toBe("no_fly");
    }
  });
});

describe("契約 4：全体の集約", () => {
  const reg = (id: string, status: RegulationStatus): RegulationWithStatus =>
    ({
      ...evaluateDid(YONAGO_CITY_HALL, [yonagoDid], undefined, NO_INDUSTRIAL),
      id,
      status,
    }) as RegulationWithStatus;

  it("飛行不可 ＞ 要手続き ＞ 手続き済み（条件付き） ＞ 手続き不要", () => {
    const green = reg("g", "green");
    expect(deriveFlightVerdict({ regulations: [green] }).level).toBe("no_procedure");
    const didDone = evaluateDid(YONAGO_CITY_HALL, [yonagoDid], { pilotPermits: ["mlit:did"] }, NO_INDUSTRIAL);
    expect(
      deriveFlightVerdict({ regulations: [green, didDone], ctx: { pilotPermits: ["mlit:did"] } }).level,
    ).toBe("procedure_done");
    const did = evaluateDid(YONAGO_CITY_HALL, [yonagoDid], undefined, NO_INDUSTRIAL);
    expect(deriveFlightVerdict({ regulations: [green, did] }).level).toBe("needs_procedure");
    expect(
      deriveFlightVerdict({ regulations: [green, did], flags: ["airspace_emergency"] }).level,
    ).toBe("no_fly");
  });

  it("判定不能が 1 件でもあれば要手続き以上。unknownCount が正しい", () => {
    const v = deriveFlightVerdict({ regulations: [reg("a", "green"), reg("b", "unknown"), reg("c", "unknown")] });
    expect(v.level).toBe("needs_procedure");
    expect(v.unknownCount).toBe(2);
    const done = evaluateDid(YONAGO_CITY_HALL, [yonagoDid], { pilotPermits: ["mlit:did"] }, NO_INDUSTRIAL);
    const v2 = deriveFlightVerdict({ regulations: [done, reg("b", "unknown")], ctx: { pilotPermits: ["mlit:did"] } });
    expect(v2.level).toBe("needs_procedure");
    expect(v2.unknownCount).toBe(1);
    // 判定不能は確認の手続きとして並ぶ
    expect(v2.procedures.some((p) => p.itemId === "b")).toBe(true);
  });

  it("規制が 0 件なら要手続き扱い", () => {
    expect(deriveFlightVerdict({ regulations: [] }).level).toBe("needs_procedure");
  });
});

describe("契約 5：飛行禁止法は同意と通報の両方で当たる", () => {
  const sdl = (permits: readonly string[]) => {
    const ctx: FlightContext = { pilotPermits: permits };
    const r = evaluateSmallDroneLaw(MIHO_VICINITY, ctx);
    return item(deriveFlightVerdict({ regulations: [r], ctx }), "small-drone-law").verdict;
  };
  it("両方 → 手続き済み（条件付き）", () => {
    expect(sdl(["facility_manager", "pref_pubsafety_notice"])).toBe("procedure_done");
    expect(sdl(["pref_pubsafety_notice", "facility_manager", "facility_manager_and_pref_pubsafety"])).toBe(
      "procedure_done",
    );
  });
  it("同意だけのときは段取りに通報だけが残る", () => {
    const ctx: FlightContext = { pilotPermits: ["facility_manager"] };
    const v = deriveFlightVerdict({ regulations: [evaluateSmallDroneLaw(MIHO_VICINITY, ctx)], ctx });
    expect(v.procedures.map((p) => p.id)).toEqual(["verdict-small-drone-notice"]);
  });
  it("どちらか一方、旧値だけでは要手続き", () => {
    expect(sdl(["facility_manager"])).toBe("needs_procedure");
    expect(sdl(["pref_pubsafety_notice"])).toBe("needs_procedure");
    expect(sdl(["facility_manager_and_pref_pubsafety"])).toBe("needs_procedure");
    expect(sdl([])).toBe("needs_procedure");
  });
  it("formatMachineCondition が permit_holder_all を表す", () => {
    expect(
      formatMachineCondition({ type: "permit_holder_all", values: ["facility_manager", "pref_pubsafety_notice"] }),
    ).toBe("permit_holder_all == facility_manager + pref_pubsafety_notice");
  });
});

describe("期限と並べ方（spec §13.9.6）", () => {
  it("DIPS は 10 開庁日前、通報は飛行予定日の 2 日前、同意は通報より前、条例は期限なし", () => {
    const regs = evaluateAll(MIHO_VICINITY, "31204");
    const v = deriveFlightVerdict({ regulations: regs, flags: ["method_night"], plannedDate: "2026-11-20" });
    const notice = v.procedures.find((p) => p.id === "verdict-small-drone-notice")!;
    expect(notice.deadline.date).toBe("2026-11-18");
    expect(notice.deadline.label).toContain("飛行予定日 2026-11-20 の 2 日前");
    expect(notice.deadline.label).toContain("飛行開始と同じ時刻まで");
    const night = v.procedures.find((p) => p.id === "verdict-method_night")!;
    expect(night.deadline.date).toBe("2026-11-06"); // 11/20 から 10 開庁日前（祝日 11/3・11/23 の扱いを含む）
    const consent = v.procedures.find((p) => p.id === "verdict-small-drone-consent")!;
    expect(consent.deadline.label).toContain("通報より前");
    const ids = v.procedures.map((p) => p.id);
    expect(ids.indexOf("verdict-small-drone-consent")).toBeLessThan(ids.indexOf("verdict-small-drone-notice"));
    expect(ids.indexOf("verdict-method_night")).toBeLessThan(ids.indexOf("verdict-small-drone-consent"));
  });

  it("飛行予定日がなければ文言だけ", () => {
    const v = deriveFlightVerdict({ regulations: evaluateAll(MIHO_VICINITY, "31204") });
    const notice = v.procedures.find((p) => p.id === "verdict-small-drone-notice")!;
    expect(notice.deadline.date).toBeUndefined();
    expect(notice.deadline.label).toContain("48 時間前");
  });

  it("法的な重さ → 期限の早い順 → 期限なしは最後", () => {
    const p = (id: string, tier: 1 | 2 | 3, lead: number | null): VerdictProcedure => ({
      id,
      title: id,
      submitTo: "",
      deadline: { label: "", leadDays: lead },
      legalTier: tier,
      reason: "",
      itemId: id,
    });
    const sorted = sortVerdictProcedures([
      p("ordinance", 2, null),
      p("heritage", 1, null),
      p("notice", 1, 2),
      p("dips", 1, 14),
      p("park", 2, null),
      p("t3", 3, 5),
    ]);
    expect(sorted.map((x) => x.id)).toEqual(["dips", "notice", "heritage", "ordinance", "park", "t3"]);
  });

  it("湊山公園（公園＋史跡＋DID）で国の法律 → 条例の順", () => {
    const v = deriveFlightVerdict({ regulations: evaluateAll(MINATOYAMA, "31202") });
    const tiers = v.procedures.map((x) => x.legalTier);
    expect([...tiers].sort()).toEqual(tiers);
    expect(v.procedures[0]?.id).toBe("verdict-did-permit");
  });
});

describe("見落としの修正（A8）・飛行の条件・目的", () => {
  it("空港等周辺が yellow でも空域フラグに入り、空港等周辺の飛行許可が手続きに出る", () => {
    const near = { lat: 35.4936, lng: 133.26604 }; // 空港から 6km 以内・敷地外
    const regs = evaluateAll(near, "31204");
    const ap = regs.find((r) => r.id === "aviation-law-airport")!;
    expect(ap.status).toBe("yellow");
    expect(extractAirspaceFlagsFromRegulations(regs)).toContain("airspace_airport");
    const ctx: FlightContext = { pilotPermits: DIPS_PERMIT_KINDS.map(dipsPermitValue) };
    const v = deriveFlightVerdict({ regulations: evaluateAll(near, "31204", ctx), ctx });
    expect(item(v, "aviation-law-airport").verdict).toBe("needs_procedure");
    const proc = v.procedures.find((p) => p.id === "verdict-airport-permit")!;
    expect(proc.reason).toContain("該当の可能性（要確認）");
    expect(proc.reason).toContain("空港の設置管理者等との調整");
  });

  it("deriveDidStatusFromRegulations は許可で該当が非該当にならない", () => {
    const regs = evaluateAll(YONAGO_CITY_HALL, "31202", { pilotPermits: ["mlit:did"] });
    expect(deriveDidStatusFromRegulations(regs)).toBe("applicable");
  });

  it("夜間：承認なし → 要手続き、承認あり → 手続き済み（条件付き）。特定飛行では飛行計画の通報と飛行日誌", () => {
    const quiet = [evaluateAirports({ lat: 35.3, lng: 133.6 }, [yonagoAirport])];
    expect(deriveFlightVerdict({ regulations: quiet }).level).toBe("no_procedure");
    const none = deriveFlightVerdict({ regulations: quiet });
    expect(none.perFlightDuties.map((d) => d.id)).toContain("drone-registration");
    expect(none.perFlightDuties.map((d) => d.id)).not.toContain("flight-plan-report");
    const n = deriveFlightVerdict({ regulations: quiet, flags: ["method_night"] });
    expect(n.level).toBe("needs_procedure");
    expect(n.procedures[0]?.title).toContain("夜間");
    const ctx: FlightContext = { pilotPermits: ["mlit:night"] };
    const d = deriveFlightVerdict({ regulations: quiet, flags: ["method_night"], ctx });
    expect(d.level).toBe("procedure_done");
    expect(d.done[0]?.conditions.join()).toContain("許可の範囲と有効期間は照合していません");
    expect(d.perFlightDuties.map((x) => x.id)).toEqual(
      expect.arrayContaining(["flight-plan-report", "flight-logbook", "emergency-airspace-check"]),
    );
    // 旧値 mlit は夜間には当てない
    expect(
      deriveFlightVerdict({ regulations: quiet, flags: ["method_night"], ctx: { pilotPermits: ["mlit"] } }).level,
    ).toBe("needs_procedure");
  });

  it("目的の例外は手続き済み（条件付き）で、書面で確かめる条件が付く（未決 3）", () => {
    const ctx: FlightContext = { purpose: "emergency" };
    const v = deriveFlightVerdict({ regulations: evaluateAll(MINATOYAMA, "31202", ctx), ctx });
    const h = item(v, "31202-heritage-protection");
    expect(h.verdict).toBe("procedure_done");
    const done = v.done.find((x) => x.itemId === "31202-heritage-protection")!;
    expect(done.conditions.join()).toContain("書面で確かめて");
  });
});

describe("表示の文言", () => {
  // 禁止語は契約 12 の grep に掛からないよう、部品をつないで作る。
  const FORBIDDEN = new RegExp([["飛行", "可能"].join(""), ["要確認", "要許可"].join("・")].join("|"));
  it("新旧とも旧版の緑・黄の表示の言葉を使わない", () => {
    const all = [
      ...Object.values(VERDICT_LABEL),
      ...Object.values(BASE_STATUS_LABEL),
      ...Object.values(LEGACY_STATUS_LABEL),
    ].join("\n");
    expect(all).not.toMatch(FORBIDDEN);
    expect(LEGACY_STATUS_LABEL.green).toBe("適用外（旧版の判定）");
  });
});

describe("申請支援の証跡に許可を新しいキーで入れる（C2）", () => {
  const base = {
    engineVersion: "soraban-0.3.0-regulations-2026-07",
    lat: 35.4,
    lng: 133.3,
    checkedAt: "2026-10-20T00:00:00.000Z",
    regulationIds: ["b", "a"],
    flags: [] as SpecificFlightFlag[],
    category: "I" as const,
    procedureIds: [],
  };
  it("許可を渡さないペイロードは 0.3.0 までと同じ形（旧版の証跡 ID を再現できる）", () => {
    const p = buildDiagnosisEvidencePayload(base);
    expect(p).not.toContain('"pp"');
    expect(p).not.toContain('"pu"');
  });
  it("許可は並べ替えて d.pp、目的は d.pu に入る", () => {
    const p = buildDiagnosisEvidencePayload({ ...base, permits: ["park_manager", "mlit:did"], purpose: "emergency" });
    expect(p).toContain('"pp":["mlit:did","park_manager"]');
    expect(p).toContain('"pu":"emergency"');
  });
});
