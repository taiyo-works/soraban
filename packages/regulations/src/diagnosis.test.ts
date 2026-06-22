import {
  deriveDiagnosis,
  extractAirspaceFlagsFromRegulations,
  getCategoryDefinition,
  ALL_PROCEDURES,
  FLIGHT_METHOD_FLAGS,
  type RequiredProcedure,
  type SpecificFlightFlag,
} from "./diagnosis";

const idsOf = (procedures: readonly RequiredProcedure[]): readonly string[] =>
  procedures.map((p) => p.id);

describe("制度データ（procedures.json）", () => {
  it("全手続きレコードが legalBasis と sourceUrl を空でなく持つ", () => {
    expect(ALL_PROCEDURES.length).toBeGreaterThan(0);
    for (const p of ALL_PROCEDURES) {
      expect(p.legalBasis.length).toBeGreaterThan(0);
      expect(p.sourceUrl.length).toBeGreaterThan(0);
      expect(p.systemUrl.length).toBeGreaterThan(0);
    }
  });

  it("DRS と DIPS2.0 が別 URL で案内される（混同防止）", () => {
    const drs = ALL_PROCEDURES.find((p) => p.id === "drone-registration");
    const did = ALL_PROCEDURES.find((p) => p.id === "flight-permission-did");
    expect(drs?.system).toBe("DRS");
    expect(drs?.systemUrl).toContain("dips-reg");
    expect(did?.system).toBe("DIPS2.0");
    expect(did?.systemUrl).toContain("ossportal");
    expect(drs?.systemUrl).not.toBe(did?.systemUrl);
  });
});

describe("deriveDiagnosis — 米子市役所＋夜間＋目視外（DID 内 + 100g 以上）", () => {
  // 米子市役所は DID 内なので、判定由来の airspace_did + ユーザー選択 night/bvlos。
  const flags: SpecificFlightFlag[] = ["airspace_did", "method_night", "method_bvlos"];
  const result = deriveDiagnosis({ flags, droneWeightG: 900 });
  const ids = idsOf(result.procedures);

  it("飛行許可（DID）相当が含まれる", () => {
    expect(ids).toContain("flight-permission-did");
  });
  it("飛行承認（夜間）相当が含まれる", () => {
    expect(ids).toContain("flight-approval-night");
  });
  it("飛行承認（目視外）相当が含まれる", () => {
    expect(ids).toContain("flight-approval-bvlos");
  });
  it("機体登録（DRS）相当が含まれる", () => {
    expect(ids).toContain("drone-registration");
  });
  it("横断手続き（飛行計画通報・飛行日誌）が常に付与される", () => {
    expect(result.isSpecificFlight).toBe(true);
    expect(ids).toContain("flight-plan-report");
    expect(ids).toContain("flight-logbook");
  });
  it("該当区分がすべて IIB 不要化可なのでカテゴリーは IIB 相当", () => {
    expect(result.category).toBe("II_B_eligible");
  });
});

describe("deriveDiagnosis — 80g（< 100g）のフェイルセーフ解除", () => {
  const flags: SpecificFlightFlag[] = ["airspace_did", "method_night", "method_bvlos"];
  const result = deriveDiagnosis({ flags, droneWeightG: 80 });
  const ids = idsOf(result.procedures);

  it("航空法系の手続き（許可・承認・登録）がすべて消える", () => {
    expect(ids).not.toContain("flight-permission-did");
    expect(ids).not.toContain("flight-approval-night");
    expect(ids).not.toContain("flight-approval-bvlos");
    expect(ids).not.toContain("drone-registration");
  });
  it("横断手続きも付与されない（特定飛行に非該当）", () => {
    expect(result.isSpecificFlight).toBe(false);
    expect(ids).not.toContain("flight-plan-report");
    expect(ids).not.toContain("flight-logbook");
  });
  it("カテゴリーは I（特定飛行に非該当）", () => {
    expect(result.category).toBe("I");
  });
});

describe("deriveDiagnosis — 機体重量 未指定のフェイルセーフ（厳しい側）", () => {
  const flags: SpecificFlightFlag[] = ["airspace_did", "method_night"];
  const result = deriveDiagnosis({ flags }); // droneWeightG 未指定
  const ids = idsOf(result.procedures);

  it("100g 以上前提の航空法系手続きが表示される", () => {
    expect(ids).toContain("flight-permission-did");
    expect(ids).toContain("flight-approval-night");
    expect(ids).toContain("drone-registration");
  });
  it("特定飛行として横断手続きも付与される", () => {
    expect(result.isSpecificFlight).toBe(true);
    expect(ids).toContain("flight-plan-report");
    expect(ids).toContain("flight-logbook");
  });
});

describe("deriveDiagnosis — カテゴリー切り分け", () => {
  it("特定飛行に非該当（フラグなし）→ カテゴリー I", () => {
    const r = deriveDiagnosis({ flags: [], droneWeightG: 900 });
    expect(r.category).toBe("I");
    expect(r.procedures.filter((p) => p.kind !== "drone_registration")).toHaveLength(0);
  });
  it("IIB 不可の区分（催し上空）を含む → IIA 相当", () => {
    const r = deriveDiagnosis({ flags: ["method_event"], droneWeightG: 900 });
    expect(r.category).toBe("II_A");
    expect(idsOf(r.procedures)).toContain("flight-approval-event");
  });
  it("第三者上空を選ぶと III＝レベル4 に切り分けられる", () => {
    const r = deriveDiagnosis({
      flags: ["method_night"],
      droneWeightG: 900,
      thirdPartyOverflight: true,
    });
    expect(r.category).toBe("III_level4");
  });
  it("立入管理措置なし（accessControl=false）も III＝レベル4", () => {
    const r = deriveDiagnosis({
      flags: ["method_night"],
      droneWeightG: 900,
      accessControl: false,
    });
    expect(r.category).toBe("III_level4");
  });
});

describe("deriveDiagnosis — 100g 以上では空港等周辺の飛行許可が IIA（不要化不可）", () => {
  it("空港フラグ単独 → IIA 相当（waivableByIIB=false）", () => {
    const r = deriveDiagnosis({ flags: ["airspace_airport"], droneWeightG: 900 });
    expect(r.category).toBe("II_A");
    const airport = r.procedures.find((p) => p.id === "flight-permission-airport");
    expect(airport?.waivableByIIB).toBe(false);
  });
});

describe("deriveDiagnosis — 重複フラグ・未知フラグの正規化", () => {
  it("同一フラグが重複しても手続きは一意化される", () => {
    const r = deriveDiagnosis({
      flags: ["method_night", "method_night"],
      droneWeightG: 900,
    });
    const nightCount = r.procedures.filter((p) => p.id === "flight-approval-night").length;
    expect(nightCount).toBe(1);
  });
});

describe("deriveDiagnosis — deadlines basis", () => {
  it("飛行予定日 未入力時は basis に逆算開庁日数を含む案内が入る", () => {
    const r = deriveDiagnosis({ flags: ["method_night"], droneWeightG: 900 });
    const d = r.deadlines.find((x) => x.procedureId === "flight-approval-night");
    expect(d?.basis).toContain("10 開庁日");
  });
  it("飛行予定日 入力時は basis に日付が反映される", () => {
    const r = deriveDiagnosis({
      flags: ["method_night"],
      droneWeightG: 900,
      plannedDate: "2026-07-15",
    });
    const d = r.deadlines.find((x) => x.procedureId === "flight-approval-night");
    expect(d?.basis).toContain("2026-07-15");
  });
});

describe("extractAirspaceFlagsFromRegulations", () => {
  it("DID red → airspace_did を抽出", () => {
    const flags = extractAirspaceFlagsFromRegulations([
      { id: "aviation-law-did", status: "red" },
      { id: "aviation-law-airport", status: "green" },
    ]);
    expect(flags).toContain("airspace_did");
    expect(flags).not.toContain("airspace_airport");
  });
  it("空港 red → airspace_airport を抽出", () => {
    const flags = extractAirspaceFlagsFromRegulations([
      { id: "aviation-law-airport", status: "red" },
    ]);
    expect(flags).toContain("airspace_airport");
  });
  it("美保基地（小型無人機等飛行禁止法）は航空法フラグ化しない", () => {
    const flags = extractAirspaceFlagsFromRegulations([
      { id: "miho-airbase-no-fly", status: "red" },
    ]);
    expect(flags).toHaveLength(0);
  });
});

describe("メタ — FLIGHT_METHOD_FLAGS とカテゴリー定義の健全性", () => {
  it("UI に出す飛行方法フラグは 7 種（方法6種 + 150m）", () => {
    expect(FLIGHT_METHOD_FLAGS).toHaveLength(7);
  });
  it("カテゴリー定義はすべて参照可能で sourceUrl を持つ", () => {
    for (const id of ["I", "II_A", "II_B_eligible", "III_level4"] as const) {
      const def = getCategoryDefinition(id);
      expect(def.sourceUrl.length).toBeGreaterThan(0);
      expect(def.label.length).toBeGreaterThan(0);
    }
  });
});
