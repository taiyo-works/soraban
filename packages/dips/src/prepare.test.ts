// Sprint 12b 契約 3：prepare（整形）と指紋。
import { describe, expect, it } from "vitest";
import { MockGateway } from "./adapters/mock";
import { ManualGateway } from "./adapters/manual";
import { computeFingerprint, fingerprintPartsOf } from "./fingerprint";
import { buildCircleGeoJson, contentOf, prepareReport, roundUpTo5, toApiStartTime } from "./prepare";
import { REPORT_FIELDS } from "./fields";
import { AIRCRAFT_ID, basePlan, FULL_INPUTS } from "./test-fixtures";
import type { PlanForReport, PreparedItem, PreparedReport } from "./types";

const item = (p: PreparedReport, key: string): PreparedItem => {
  const i = p.items.find((x) => x.key === key);
  if (!i) throw new Error(`項目がありません: ${key}`);
  return i;
};
const codes = (i: PreparedItem): string[] => i.warnings.map((w) => w.code);

const deepFreeze = <T>(o: T): T => {
  if (o && typeof o === "object") {
    Object.freeze(o);
    for (const v of Object.values(o as Record<string, unknown>)) deepFreeze(v);
  }
  return o;
};

describe("prepare は副作用がなく、アダプターによらず同じ結果", () => {
  it("同じ入力で 2 回呼んでも同じ。入力は書き換えない（凍結した入力でも動く）", () => {
    const plan = deepFreeze(basePlan());
    expect(prepareReport(plan, "new")).toEqual(prepareReport(plan, "new"));
  });

  it("手動・模擬のゲートウェイの prepare が同じ結果（同じ対応表の版）", () => {
    const plan = basePlan();
    for (const kind of ["new", "change", "cancel"] as const) {
      expect(new ManualGateway().prepare(plan, kind)).toEqual(new MockGateway().prepare(plan, kind));
    }
  });

  it("対応表の版（mapRevision・mapVerifiedAt）が結果に付く", () => {
    const p = prepareReport(basePlan(), "new");
    expect(p.mapRevision).toBe(REPORT_FIELDS.revision);
    expect(p.mapVerifiedAt).toBe(REPORT_FIELDS.verifiedAt);
  });

  it("項目は対応表の順に並び、api_only は出さない", () => {
    const p = prepareReport(basePlan(), "new");
    const orders = p.items.map((i) => i.order);
    expect([...orders].sort((a, b) => a - b)).toEqual(orders);
    expect(p.items.every((i) => i.source !== "api_only")).toBe(true);
    expect(p.items.map((i) => i.key)).toEqual(expect.arrayContaining(["name", "purposes", "start_time", "route", "symbol"]));
  });
});

describe("名称（30 文字）", () => {
  it("30 文字までは警告なし、31 文字以上は切り詰めずに警告", () => {
    const t30 = "あ".repeat(30);
    const t31 = "あ".repeat(31);
    expect(item(prepareReport(basePlan({ title: t30 }), "new"), "name").warnings).toEqual([]);
    const i31 = item(prepareReport(basePlan({ title: t31 }), "new"), "name");
    expect(i31.value).toBe(t31);
    expect(i31.apiValue).toBe(t31);
    expect(codes(i31)).toEqual(["name_too_long"]);
  });

  it("コードポイントで数える（絵文字 30 個は 30 文字）", () => {
    expect(item(prepareReport(basePlan({ title: "😀".repeat(30) }), "new"), "name").warnings).toEqual([]);
    expect(codes(item(prepareReport(basePlan({ title: "😀".repeat(31) }), "new"), "name"))).toEqual(["name_too_long"]);
  });

  it("通報用の名称の入力があれば、それを使う", () => {
    const p = prepareReport(basePlan({ title: "あ".repeat(50), inputs: { ...FULL_INPUTS, reportName: "短い名称" } }), "new");
    expect(item(p, "name").value).toBe("短い名称");
    expect(item(p, "name").warnings).toEqual([]);
  });
});

describe("所要時間は 5 分単位に切り上げる", () => {
  const cases: [number, number][] = [
    [1, 5],
    [4, 5],
    [5, 5],
    [6, 10],
    [59, 60],
    [60, 60],
    [61, 65],
    [1438, 1440],
    [1439, 1440],
    [1440, 1440],
  ];
  for (const [input, expected] of cases) {
    it(`${input} 分 → ${expected} 分`, () => {
      expect(roundUpTo5(input)).toBe(expected);
      const i = item(prepareReport(basePlan({ durationMinutes: input }), "new"), "flight_time");
      expect(i.value).toBe(String(expected));
      expect(i.apiValue).toBe(String(expected));
      // 切り上げたときだけ理由を出す
      expect(codes(i)).toEqual(input === expected ? [] : ["duration_rounded_up"]);
    });
  }
});

describe("高度（1〜999 m）", () => {
  it("未入力・0・1000 以上は値を変えずに警告する。1 と 999 は警告なし", () => {
    const at = (a: number | null) => item(prepareReport(basePlan({ maxAltitudeM: a }), "new"), "altitude");
    expect(at(null).value).toBeNull();
    expect(at(null).missing).toBe(true);
    expect(codes(at(null))).toEqual(["altitude_missing"]);
    expect(at(0).value).toBe("0");
    expect(codes(at(0))).toEqual(["altitude_out_of_range"]);
    expect(at(1000).value).toBe("1000");
    expect(codes(at(1000))).toEqual(["altitude_out_of_range"]);
    expect(at(2000).value).toBe("2000");
    for (const ok of [1, 50, 999]) {
      expect(at(ok).value).toBe(String(ok));
      expect(at(ok).warnings).toEqual([]);
    }
  });
});

describe("飛行空域・飛行方法のコード", () => {
  it("フラグを設計 C のコードに変換する", () => {
    const p = prepareReport(
      basePlan({
        snapshot: {
          ...basePlan().snapshot,
          flags: ["airspace_did", "airspace_150m", "airspace_airport", "method_30m", "method_event", "method_night", "method_bvlos", "method_dangerous", "method_drop"],
        },
      }),
      "new",
    );
    expect(item(p, "airspace").apiValue).toBe("[1,2,3]");
    expect(item(p, "flight_type").apiValue).toBe("[1,2,3,4,5,6]");
    expect(item(p, "airspace").value).toContain("1 人・家屋の密集地域の上空");
  });

  it("該当がなければ「なし」と空の配列", () => {
    const p = prepareReport(basePlan({ snapshot: { ...basePlan().snapshot, flags: [] } }), "new");
    expect(item(p, "airspace").value).toBe("なし");
    expect(item(p, "airspace").apiValue).toBe("[]");
    expect(item(p, "flight_type").apiValue).toBe("[]");
  });

  it("緊急用務空域は通報の項目にないため警告する（飛行できない判定の旨を併記）", () => {
    const p = prepareReport(basePlan({ snapshot: { ...basePlan().snapshot, flags: ["airspace_emergency", "method_night"] } }), "new");
    const i = item(p, "airspace");
    expect(codes(i)).toEqual(["emergency_airspace"]);
    expect(i.warnings[0]!.message).toContain("飛行できない判定");
    expect(i.apiValue).toBe("[]");
    expect(p.warnings.map((w) => w.code)).toContain("emergency_airspace");
  });
});

describe("経路は円の GeoJSON 文字列（コピー対象でない）", () => {
  it("中心 [経度, 緯度] と半径 m", () => {
    const i = item(prepareReport(basePlan({ latitude: 35.1, longitude: 133.2, radiusM: 150 }), "new"), "route");
    expect(i.status).toBe("route");
    expect(i.copyable).toBe(false);
    expect(i.copyText).toBeNull();
    const g = JSON.parse(i.apiValue!);
    expect(g.type).toBe("FeatureCollection");
    expect(g.features[0].geometry.type).toBe("Circle");
    expect(g.features[0].geometry.center).toEqual([133.2, 35.1]);
    expect(g.features[0].properties.radius).toBe(150);
    // 座標を表示する
    expect(i.value).toContain("経度 133.2");
    expect(i.value).toContain("緯度 35.1");
    expect(i.value).toContain("半径 150 m");
    expect(typeof i.apiValue).toBe("string");
  });

  it("半径が無ければ経路を作れないと警告する", () => {
    const i = item(prepareReport(basePlan({ radiusM: null }), "new"), "route");
    expect(i.apiValue).toBeNull();
    expect(codes(i)).toEqual(["radius_missing"]);
  });

  it("半径の置き場所は対応表のデータで決める（原本の不一致。properties／geometry／both）", () => {
    expect(JSON.parse(buildCircleGeoJson(35, 133, 10, "geometry")).features[0].geometry.radius).toBe(10);
    expect(JSON.parse(buildCircleGeoJson(35, 133, 10, "geometry")).features[0].properties).toEqual({});
    const both = JSON.parse(buildCircleGeoJson(35, 133, 10, "both")).features[0];
    expect(both.geometry.radius).toBe(10);
    expect(both.properties.radius).toBe(10);
  });
});

describe("日時は JST 分で、API 形式を併記する", () => {
  it("人が読む形と yyyyMMdd HHmm", () => {
    const i = item(prepareReport(basePlan({ startAt: "2027-01-14T09:05" }), "new"), "start_time");
    expect(i.value).toBe("2027-01-14 09:05 JST");
    expect(i.apiValue).toBe("20270114 0905");
    expect(i.copyText).toBe("2027-01-14 09:05");
    expect(toApiStartTime("2027-12-31T23:59")).toBe("20271231 2359");
  });
});

describe("そらばんが持たない項目（dips_only）", () => {
  it("「そらばんは保持しません」と出し、FPR の項目名を併記する。コピーできない", () => {
    const p = prepareReport(basePlan(), "new");
    const only = p.items.filter((i) => i.source === "dips_only");
    expect(only.length).toBeGreaterThan(20);
    for (const i of only) {
      expect(i.status).toBe("dips_only");
      expect(i.value).toContain("そらばんは保持しません");
      expect(i.copyable).toBe(false);
      expect(i.copyText).toBeNull();
      if (i.apiField) expect(i.value).toContain(i.apiField);
    }
    // 通報者の連絡先・保険・その他特記事項・連絡先フラグ・privateLicense
    for (const k of ["insurance_company", "reporter_email", "other_information", "contact_reporter_flag", "private_license", "aircraft_type"]) {
      expect(item(p, k).status).toBe("dips_only");
    }
    // 未入力の必須項目の件数には、dips_only を数えない
    expect(p.missingRequiredCount).toBe(0);
  });
});

describe("未入力の必須項目", () => {
  it("通報の画面の入力がなければ、必須の入力項目が未入力になり、記録はできる旨の警告が出る", () => {
    const p = prepareReport(basePlan({ inputs: {} }), "new");
    for (const k of ["purposes", "assistants", "max_time", "speed", "onsite_control_l3", "onsite_control_l35", "onsite_control2", "mooring"]) {
      expect(item(p, k).missing, k).toBe(true);
      expect(item(p, k).value, k).toBeNull();
    }
    expect(p.missingRequiredCount).toBe(8);
    expect(p.warnings.find((w) => w.code === "missing_required")!.message).toContain("8 件");
    // 出発地・目的地は計画の場所の名称が初期値
    expect(item(p, "departure").value).toBe("フューチャーテック株式会社 本社");
    expect(item(p, "destination").value).toBe("フューチャーテック株式会社 本社");
  });

  it("入力が揃えば 0 件", () => {
    expect(prepareReport(basePlan(), "new").missingRequiredCount).toBe(0);
  });

  it("その他の理由は、13・16 を選んだときだけ必須", () => {
    const none = prepareReport(basePlan(), "new");
    expect(item(none, "other_business_text").status).toBe("not_applicable");
    const p13 = prepareReport(basePlan({ inputs: { ...FULL_INPUTS, flightPurposes: [13] } }), "new");
    expect(item(p13, "other_business_text").missing).toBe(true);
    expect(p13.missingRequiredCount).toBe(1);
    const p13ok = prepareReport(basePlan({ inputs: { ...FULL_INPUTS, flightPurposes: [13], otherBusinessText: "鳥獣被害の調査" } }), "new");
    expect(item(p13ok, "other_business_text").value).toBe("鳥獣被害の調査");
    const p16 = prepareReport(basePlan({ inputs: { ...FULL_INPUTS, flightPurposes: [16] } }), "new");
    expect(item(p16, "other_non_business_text").missing).toBe(true);
  });

  it("立入管理措置は計画の値（講じる／講じない）。未選択は未入力として警告", () => {
    expect(item(prepareReport(basePlan({ accessControl: true }), "new"), "onsite_control").apiValue).toBe("1");
    expect(item(prepareReport(basePlan({ accessControl: false }), "new"), "onsite_control").apiValue).toBe("0");
    const n = item(prepareReport(basePlan({ accessControl: null }), "new"), "onsite_control");
    expect(n.missing).toBe(true);
    expect(codes(n)).toEqual(["onsite_control_missing"]);
  });

  it("許可・承認の手続きがあるのに許可番号が空なら警告する。手続きがなければ該当なし", () => {
    const withProc = basePlan({ snapshot: { ...basePlan().snapshot, permitProcedureIds: ["flight-approval-night"] } });
    const i = item(prepareReport(withProc, "new"), "permit_number");
    expect(i.missing).toBe(true);
    expect(codes(i)).toEqual(["permit_number_missing"]);
    expect(item(prepareReport(basePlan(), "new"), "permit_number").status).toBe("not_applicable");
    expect(item(prepareReport({ ...withProc, permitNumbers: "国空無機第123号" }, "new"), "permit_number").value).toBe("国空無機第123号");
  });
});

describe("許可書発行日・許可期間（Sprint 12d。結びついた登録があるときだけ）", () => {
  const reg = { permitNumber: "国空無機第123号", issuedOn: "2026-10-01", validFrom: "2026-10-05", validTo: "2027-10-04" };
  const DATE_KEYS = ["permit_date", "permit_start", "permit_finish"];

  it("結びついた登録がなければ、従来どおり「そらばんは保持しません」（DIPS で入力）", () => {
    for (const p of [basePlan(), basePlan({ permitRegistration: null })]) {
      const r = prepareReport(p, "new");
      for (const k of DATE_KEYS) {
        expect(item(r, k).status, k).toBe("dips_only");
        expect(item(r, k).value, k).toContain("そらばんは保持しません");
        expect(item(r, k).copyable, k).toBe(false);
      }
    }
  });

  it("結びついた登録があれば、発行日と期間（自・至）が項目として出る。形式は未確認（※要確認）の警告つき。必須の未入力には数えない", () => {
    const r = prepareReport(basePlan({ permitRegistration: reg }), "new");
    expect(item(r, "permit_date")).toMatchObject({ status: "filled", value: "2026-10-01", apiValue: "20261001", copyable: true });
    expect(item(r, "permit_start")).toMatchObject({ status: "filled", value: "2026-10-05", apiValue: "20261005" });
    expect(item(r, "permit_finish")).toMatchObject({ status: "filled", value: "2027-10-04", apiValue: "20271004" });
    for (const k of DATE_KEYS) {
      expect(codes(item(r, k)), k).toEqual(["permit_dates_format_unconfirmed"]);
      expect(item(r, k).warnings[0]!.message, k).toContain("※要確認");
      expect(item(r, k).screenStatus, k).toBe("unconfirmed");
    }
    expect(r.missingRequiredCount).toBe(0);
    // 通報の許可・承認の番号は計画の欄の文字のまま（変えない）
    expect(item(prepareReport(basePlan({ permitRegistration: reg, permitNumbers: "国空無機第123号" }), "new"), "permit_number").value).toBe("国空無機第123号");
  });

  it("対応表の版を上げた（2）。確認していない行は unconfirmed のまま", () => {
    expect(REPORT_FIELDS.revision).toBe(2);
    expect(prepareReport(basePlan(), "new").mapRevision).toBe(2);
  });
});

describe("操縦者・機体", () => {
  it("技能証明の区分は 1／0、機体認証は機体の区分から", () => {
    const first = prepareReport(
      basePlan({
        pilot: { ...basePlan().pilot, licenseClass: "first" },
        aircraft: { ...basePlan().aircraft, airworthinessClass: "second", airworthinessCertNumber: "第二種-001" },
      }),
      "new",
    );
    expect(item(first, "first_class").apiValue).toBe("1");
    expect(item(first, "second_class").apiValue).toBe("0");
    expect(item(first, "certification1").apiValue).toBe("0");
    expect(item(first, "certification2").apiValue).toBe("1");
    expect(item(first, "certification_number").value).toBe("第二種-001");
    expect(item(first, "symbol").value).toBe("JU12T0001");
    expect(item(first, "maker").value).toBe("DJI");
    expect(item(first, "pilot_maker").value).toBe("DJI");
    expect(item(first, "max_weight").value).toBe("0.9");
  });

  it("技能証明書番号：全桁は本人・運航管理者だけ。伏せ字のときはコピー対象にしない", () => {
    const full = item(prepareReport(basePlan(), "new"), "skill_number");
    expect(full.value).toBe("TEST-12345678");
    expect(full.copyable).toBe(true);
    expect(full.personal).toBe(true);
    const masked = item(
      prepareReport(basePlan({ pilot: { ...basePlan().pilot, licenseNumber: "****5678", licenseNumberMasked: true } }), "new"),
      "skill_number",
    );
    expect(masked.value).toBe("****5678");
    expect(masked.copyable).toBe(false);
    expect(masked.copyText).toBeNull();
    expect(codes(masked)).toEqual(["license_masked"]);
  });

  it("最大離陸重量が未登録なら未入力（警告）", () => {
    const i = item(prepareReport(basePlan({ aircraft: { ...basePlan().aircraft, maxTakeoffWeightKg: null } }), "new"), "max_weight");
    expect(i.missing).toBe(true);
    expect(codes(i)).toEqual(["weight_missing"]);
  });
});

describe("通報の記録の写し（content）に個人情報を入れない", () => {
  it("技能証明書番号・操縦者の氏名・dips_only の項目は入らない", () => {
    const p = prepareReport(basePlan(), "new");
    const c = contentOf(p);
    const text = JSON.stringify(c);
    expect(text).not.toContain("TEST-12345678");
    expect(text).not.toContain("操縦 一郎");
    expect(c.items.map((i) => i.key)).not.toContain("skill_number");
    expect(c.items.map((i) => i.key)).not.toContain("pilot_name");
    expect(c.items.map((i) => i.key)).not.toContain("insurance_company");
    expect(c.mapRevision).toBe(REPORT_FIELDS.revision);
    expect(c.inputs).toMatchObject({ flightSpeed: 10 });
  });
});

describe("通報の指紋", () => {
  const fp = (plan: PlanForReport) => prepareReport(plan, "new").fingerprint;
  const base = basePlan();

  it("64 桁の 16 進で、元の値（fingerprintParts）が付き、同じ入力なら一致する", () => {
    const p = prepareReport(base, "new");
    expect(p.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(p.fingerprint).toBe(computeFingerprint(p.fingerprintParts));
    expect(p.fingerprintParts).toEqual({
      startAt: "2027-01-14T09:00",
      durationMinutes: 60,
      lat: 35.434238,
      lng: 133.380508,
      radiusM: 100,
      maxAltitudeM: 50,
      aircraftId: AIRCRAFT_ID,
      pilotId: base.pilotId,
      flags: ["method_night"],
    });
    expect(fp(basePlan())).toBe(fp(basePlan()));
  });

  it("元の値（日時・所要時間・座標・半径・高度・機体・操縦者・最終のフラグ）が変わると変わる", () => {
    const changed: [string, PlanForReport][] = [
      ["予定開始", basePlan({ startAt: "2027-01-14T10:00" })],
      ["所要時間", basePlan({ durationMinutes: 61 })],
      ["緯度", basePlan({ latitude: 35.434239 })],
      ["経度", basePlan({ longitude: 133.380509 })],
      ["半径", basePlan({ radiusM: 101 })],
      ["半径 null", basePlan({ radiusM: null })],
      ["高度", basePlan({ maxAltitudeM: 51 })],
      ["高度 null", basePlan({ maxAltitudeM: null })],
      ["機体", basePlan({ aircraftId: "99999999-9999-4999-8999-999999999999" })],
      ["操縦者", basePlan({ pilotId: "88888888-8888-4888-8888-888888888888" })],
      ["フラグ追加", basePlan({ snapshot: { ...base.snapshot, flags: ["method_night", "airspace_did"] } })],
      ["フラグ削除", basePlan({ snapshot: { ...base.snapshot, flags: [] } })],
    ];
    const seen = new Set([fp(base)]);
    for (const [name, plan] of changed) {
      const f = fp(plan);
      expect(f, name).not.toBe(fp(base));
      seen.add(f);
    }
    expect(seen.size).toBe(changed.length + 1);
  });

  it("通報の画面の入力（速度など）・名称・許可番号・場所の名称・スナップショット ID では変わらない", () => {
    expect(fp(basePlan({ inputs: { ...FULL_INPUTS, flightSpeed: 99, assistantsNumber: 3, flightPurposes: [2] } }))).toBe(fp(base));
    expect(fp(basePlan({ title: "別の名称", permitNumbers: "X", placeName: "別の場所" }))).toBe(fp(base));
    expect(fp(basePlan({ snapshot: { ...base.snapshot, id: "66666666-6666-4666-8666-666666666666" } }))).toBe(fp(base));
  });

  it("フラグの並びや重複に依らない（固定の順）", () => {
    const a = basePlan({ snapshot: { ...base.snapshot, flags: ["method_night", "airspace_did", "method_night"] } });
    const b = basePlan({ snapshot: { ...base.snapshot, flags: ["airspace_did", "method_night"] } });
    expect(fp(a)).toBe(fp(b));
    expect(fingerprintPartsOf(a).flags).toEqual(["airspace_did", "method_night"]);
  });

  it("座標は小数 6 桁に丸めて比べる（浮動小数の誤差で変わらない）", () => {
    expect(fp(basePlan({ latitude: 35.434238000000004 }))).toBe(fp(base));
  });
});
