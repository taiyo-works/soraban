import {
  buildDiagnosisEvidencePayload,
  deriveDiagnosis,
  deriveDidStatusFromRegulations,
  extractAirspaceFlagsFromRegulations,
  getCategoryDefinition,
  ALL_PROCEDURES,
  ALL_CATEGORY_DEFINITIONS,
  FLIGHT_METHOD_FLAGS,
  PROCEDURES_VERIFIED_AT,
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

  it("DRS と DIPS 2.0 が別 URL で案内される（混同防止）", () => {
    const drs = ALL_PROCEDURES.find((p) => p.id === "drone-registration");
    const did = ALL_PROCEDURES.find((p) => p.id === "flight-permission-did");
    expect(drs?.system).toBe("DRS");
    expect(drs?.systemUrl).toContain("dips-reg");
    expect(did?.system).toBe("DIPS 2.0");
    expect(did?.systemUrl).toContain("ossportal");
    expect(drs?.systemUrl).not.toBe(did?.systemUrl);
  });

  // sprint-4 契約: 各手続きレコードに改正レビュー用の検証日メタ verifiedAt が入っている。
  it("全手続きレコードが検証日メタ verifiedAt を持つ（ISO 日付）", () => {
    expect(ALL_PROCEDURES.length).toBeGreaterThan(0);
    for (const p of ALL_PROCEDURES) {
      expect(p.verifiedAt).toBeDefined();
      expect(typeof p.verifiedAt).toBe("string");
      // YYYY-MM-DD で始まる ISO 日付であること。
      expect(p.verifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}/);
    }
  });

  it("データセット全体の検証日（PROCEDURES_VERIFIED_AT）は、条・項・号を確認し直した 2026-10-19", () => {
    expect(PROCEDURES_VERIFIED_AT).toMatch(/^2026-10-19/);
  });

  it("確定事実として表示する手続きには法的根拠と出典 URL が必ず併記されている", () => {
    // 25kg 保険義務化は国交省（koku_fr10_000042, R7.10.1〜）で確認済みのため手続き化（Sprint 6）。
    // Sprint 11a で出典を制度改正の資料（001909323.pdf。レベル3.5飛行も必須の記載あり）に替えた。
    const ins = ALL_PROCEDURES.find((p) => p.kind === "insurance");
    expect(ins?.id).toBe("insurance-third-party-25kg");
    expect(ins?.sourceUrl).toBe("https://www.mlit.go.jp/common/001909323.pdf");
    for (const p of ALL_PROCEDURES) {
      expect(p.legalBasis.length).toBeGreaterThan(0);
      expect(p.sourceUrl.length).toBeGreaterThan(0);
    }
  });
});

describe("カテゴリー定義（categories.json）— 検証日メタ", () => {
  it("全カテゴリー定義が sourceUrl と検証日メタ verifiedAt を持つ", () => {
    expect(ALL_CATEGORY_DEFINITIONS.length).toBeGreaterThan(0);
    for (const c of ALL_CATEGORY_DEFINITIONS) {
      expect(c.sourceUrl.length).toBeGreaterThan(0);
      expect(c.verifiedAt).toBeDefined();
      expect(c.verifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}/);
    }
  });
});

describe("25kg 境界と第三者賠償責任保険（Sprint 6）", () => {
  const iibFlags: SpecificFlightFlag[] = ["airspace_did", "method_night"];
  it("24.99kg（24,990g）は IIB 相当のまま・保険手続きなし", () => {
    const r = deriveDiagnosis({ flags: iibFlags, droneWeightG: 24_990, didStatus: "applicable" });
    expect(r.category).toBe("II_B_eligible");
    expect(r.procedures.some((p) => p.kind === "insurance")).toBe(false);
  });
  it("25kg（25,000g）ちょうどは IIA 相当（許可・承認が必要）＋ 保険必須", () => {
    const r = deriveDiagnosis({ flags: iibFlags, droneWeightG: 25_000, didStatus: "applicable" });
    expect(r.category).toBe("II_A");
    expect(idsOf(r.procedures)).toContain("insurance-third-party-25kg");
    expect(r.verificationNotes.some((n) => n.includes("25kg"))).toBe(true);
  });
  it("30kg でも 'may be unnecessary'（IIB）にはならない", () => {
    const r = deriveDiagnosis({ flags: ["method_bvlos"], droneWeightG: 30_000 });
    expect(r.category).not.toBe("II_B_eligible");
    expect(r.category).toBe("II_A");
  });
  it("25kg 以上でも特定飛行に非該当（DID 非該当確認済み）なら保険手続きは出さない", () => {
    const r = deriveDiagnosis({ flags: [], droneWeightG: 30_000, didStatus: "not_applicable" });
    expect(r.category).toBe("I");
    expect(r.procedures.some((p) => p.kind === "insurance")).toBe(false);
  });
});

describe("100g 境界（Sprint 6）", () => {
  it("99g は航空法上の無人航空機に非該当（カテゴリー I・手続きなし）", () => {
    const r = deriveDiagnosis({ flags: ["airspace_did"], droneWeightG: 99, didStatus: "applicable" });
    expect(r.category).toBe("I");
    expect(r.procedures).toHaveLength(0);
  });
  it("100g ちょうどは規制対象（DID 許可・登録が必要）", () => {
    const r = deriveDiagnosis({ flags: ["airspace_did"], droneWeightG: 100, didStatus: "applicable" });
    expect(r.isSpecificFlight).toBe(true);
    expect(idsOf(r.procedures)).toContain("flight-permission-did");
    expect(idsOf(r.procedures)).toContain("drone-registration");
  });
});

describe("DID 三値（該当／非該当／未確認）— Sprint 6", () => {
  it("DID 未確認＋他フラグなしは カテゴリー I（申請不要）にならず needs_verification", () => {
    const r = deriveDiagnosis({ flags: [], droneWeightG: 900, didStatus: "unverified" });
    expect(r.category).toBe("needs_verification");
    expect(r.category).not.toBe("I");
    expect(r.didStatus).toBe("unverified");
    expect(r.verificationNotes.some((n) => n.includes("要確認"))).toBe(true);
    expect(getCategoryDefinition(r.category).description).toContain("要確認");
  });
  it("DID 未確認でも airspace_did をユーザーが指定すれば 該当 扱い", () => {
    const r = deriveDiagnosis({ flags: ["airspace_did"], droneWeightG: 900, didStatus: "unverified" });
    expect(r.didStatus).toBe("applicable");
    expect(r.category).toBe("II_B_eligible");
  });
  it("DID 非該当（確認済み）なら カテゴリー I", () => {
    const r = deriveDiagnosis({ flags: [], droneWeightG: 900, didStatus: "not_applicable" });
    expect(r.category).toBe("I");
    expect(r.verificationNotes).toHaveLength(0);
  });
  it("重量未指定（フェイルセーフ）＋DID 未確認も needs_verification", () => {
    const r = deriveDiagnosis({ flags: [], didStatus: "unverified" });
    expect(r.category).toBe("needs_verification");
  });
  it("100g 未満は DID 未確認でも航空法の対象外（カテゴリー I）", () => {
    const r = deriveDiagnosis({ flags: [], droneWeightG: 80, didStatus: "unverified" });
    expect(r.category).toBe("I");
  });
  it("deriveDidStatusFromRegulations: red=該当 / green=非該当 / unknown・yellow・欠落=未確認", () => {
    expect(deriveDidStatusFromRegulations([{ id: "aviation-law-did", status: "red" }])).toBe("applicable");
    expect(deriveDidStatusFromRegulations([{ id: "aviation-law-did", status: "green" }])).toBe("not_applicable");
    expect(deriveDidStatusFromRegulations([{ id: "aviation-law-did", status: "unknown" }])).toBe("unverified");
    expect(deriveDidStatusFromRegulations([{ id: "aviation-law-did", status: "yellow" }])).toBe("unverified");
    expect(deriveDidStatusFromRegulations([])).toBe("unverified");
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

describe("deriveDiagnosis — deadlines basis / submitBy（提出期限の逆算）", () => {
  it("飛行予定日 未入力時は submitBy が無く、basis に逆算開庁日数を含む案内が入る", () => {
    const r = deriveDiagnosis({ flags: ["method_night"], droneWeightG: 900 });
    const d = r.deadlines.find((x) => x.procedureId === "flight-approval-night");
    expect(d?.submitBy).toBeUndefined();
    expect(d?.basis).toContain("10 開庁日");
    expect(d?.basis).toContain("飛行予定日を入力");
  });
  it("飛行予定日 入力時は basis に飛行日が反映される", () => {
    const r = deriveDiagnosis({
      flags: ["method_night"],
      droneWeightG: 900,
      plannedDate: "2026-07-15",
    });
    const d = r.deadlines.find((x) => x.procedureId === "flight-approval-night");
    expect(d?.basis).toContain("2026-07-15");
  });

  // ★ 契約の中核ケース ★ 2026-07-31（金）起点で 10 開庁日前 = 2026-07-16（海の日除外）。
  it("2026-07-31 起点で submitBy が 2026-07-16（海の日を跨ぐ手計算と一致）", () => {
    const r = deriveDiagnosis({
      flags: ["method_night"],
      droneWeightG: 900,
      plannedDate: "2026-07-31",
    });
    const d = r.deadlines.find((x) => x.procedureId === "flight-approval-night");
    expect(d?.submitBy).toBe("2026-07-16");
    expect(d?.basis).toContain("2026-07-16");
  });

  it("leadTime 0 の手続き（登録・通報・日誌）は deadlines から除外される", () => {
    const r = deriveDiagnosis({
      flags: ["method_night"],
      droneWeightG: 900,
      plannedDate: "2026-07-31",
    });
    const ids = r.deadlines.map((d) => d.procedureId);
    expect(ids).not.toContain("drone-registration");
    expect(ids).not.toContain("flight-plan-report");
    expect(ids).not.toContain("flight-logbook");
  });

  it("飛行許可（DID）も同じ起点で submitBy が 2026-07-16", () => {
    const r = deriveDiagnosis({
      flags: ["airspace_did", "method_night"],
      droneWeightG: 900,
      plannedDate: "2026-07-31",
    });
    const d = r.deadlines.find((x) => x.procedureId === "flight-permission-did");
    expect(d?.submitBy).toBe("2026-07-16");
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

describe("buildDiagnosisEvidencePayload — 申請支援診断の決定論的証跡ペイロード", () => {
  const baseInput = {
    engineVersion: "soraban-0.2.0-clausegraph",
    lat: 35.4278,
    lng: 133.3314,
    checkedAt: "2026-10-14T00:00:00.000Z",
    regulationIds: ["31202-park-ordinance", "aviation-law-did"],
    droneWeightG: 900,
    flags: ["method_bvlos", "airspace_did", "method_night"] as const,
    plannedDate: "2026-11-10",
    accessControl: true,
    thirdPartyOverflight: false,
    bvlosWithObserver: true,
    category: "II_B_eligible" as const,
    procedureIds: ["flight-approval-night", "flight-permission-did", "drone-registration"],
  };

  it("フラグ・手続きID・規制IDの入力順序が異なっても正規化され同一のペイロード文字列を返す", () => {
    const p1 = buildDiagnosisEvidencePayload(baseInput);
    const p2 = buildDiagnosisEvidencePayload({
      ...baseInput,
      regulationIds: ["aviation-law-did", "31202-park-ordinance"],
      flags: ["method_night", "method_bvlos", "airspace_did", "method_night"],
      procedureIds: ["drone-registration", "flight-permission-did", "flight-approval-night"],
    });
    expect(p1).toBe(p2);
  });

  it("飛行方法・予定日・立入管理措置・目視外補助者・カテゴリーが変われば異なるペイロードになる", () => {
    const base = buildDiagnosisEvidencePayload(baseInput);
    const diffFlag = buildDiagnosisEvidencePayload({
      ...baseInput,
      flags: ["airspace_did", "method_night"],
    });
    const diffDate = buildDiagnosisEvidencePayload({
      ...baseInput,
      plannedDate: "2026-11-11",
    });
    const diffCategory = buildDiagnosisEvidencePayload({
      ...baseInput,
      thirdPartyOverflight: true,
      category: "III_level4",
    });
    const diffObserver = buildDiagnosisEvidencePayload({
      ...baseInput,
      bvlosWithObserver: false,
    });
    expect(diffFlag).not.toBe(base);
    expect(diffDate).not.toBe(base);
    expect(diffCategory).not.toBe(base);
    expect(diffObserver).not.toBe(base);
  });
});

