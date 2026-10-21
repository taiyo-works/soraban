// Sprint 12d 契約 4（単体）：許可・承認の登録の入力検査（validatePermitRegistration）と失効日。項目ごとの理由コードで確かめる。
import { describe, expect, it } from "vitest";
import { FORBIDDEN_PHRASES, PERMIT_FIELDS, validatePermitRegistration, validateRevokedOn, type PermitInputData } from "./validate-permit";

const ID1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ID2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const valid = {
  permitNumber: "R8-DIPS-0001",
  coverage: "blanket",
  kinds: ["night", "did"],
  issuedOn: "2026-09-25",
  validFrom: "2026-10-01",
  validTo: "2027-09-30",
  placeScope: { type: "nationwide" },
  aircraftScope: { type: "any" },
  pilotScope: { type: "any" },
};

const ok = (extra: object = {}): PermitInputData => {
  const v = validatePermitRegistration({ ...valid, ...extra });
  if (!v.ok) throw new Error(JSON.stringify(v.codes));
  return v.data;
};
const codes = (extra: object = {}): Record<string, string> => {
  const v = validatePermitRegistration({ ...valid, ...extra });
  return v.ok ? {} : { ...v.codes };
};

describe("validatePermitRegistration", () => {
  it("正常：版の data（snake_case）を作る。種類は定義の順に並べ、鍵は正規化して入れる。状態・取得元は決まった値", () => {
    const d = ok({ permitNumber: " ｒ８-dips-0001 ", conditionsText: "飛行マニュアルに従う", maxAltitudeM: "150", maxWeightKg: 25.5, requiresObserver: true });
    expect(d).toMatchObject({
      permit_number: "ｒ８-dips-0001",
      permit_number_key: "R8-DIPS-0001",
      coverage: "blanket",
      kinds: ["did", "night"],
      airport_names: [],
      issued_on: "2026-09-25",
      valid_from: "2026-10-01",
      valid_to: "2027-09-30",
      status: "active",
      revoked_on: null,
      place_scope: { type: "nationwide" },
      aircraft_scope: { type: "any" },
      pilot_scope: { type: "any" },
      max_altitude_m: 150,
      max_weight_kg: 25.5,
      requires_observer: true,
      requires_access_control: false,
      conditions_text: "飛行マニュアルに従う",
      source: "manual",
      external_ref: {},
    });
    // 状態・失効日・取得元は本文から読まない
    expect(ok({ status: "revoked", revokedOn: "2027-01-01", source: "dips_fpa" })).toMatchObject({ status: "active", revoked_on: null, source: "manual" });
    expect(Object.values(PERMIT_FIELDS)).not.toContain("status");
  });

  it("番号：空・長すぎ・区切り文字・禁止語・型", () => {
    expect(codes({ permitNumber: "" })["permitNumber"]).toBe("required");
    expect(codes({ permitNumber: "   " })["permitNumber"]).toBe("required");
    expect(codes({ permitNumber: undefined })["permitNumber"]).toBe("required");
    expect(codes({ permitNumber: "x".repeat(61) })["permitNumber"]).toBe("too_long");
    expect(ok({ permitNumber: "x".repeat(60) }).permit_number).toHaveLength(60);
    for (const bad of ["A,B", "A，B", "A、B", "A;B", "A；B", "A\nB"]) expect(codes({ permitNumber: bad })["permitNumber"], bad).toBe("invalid_char");
    expect(codes({ permitNumber: 12 })["permitNumber"]).toBe("invalid");
    for (const w of FORBIDDEN_PHRASES) expect(codes({ permitNumber: `X${w}` })["permitNumber"], w).toBe("forbidden_phrase");
  });

  it("包括・個別", () => {
    expect(codes({ coverage: undefined })["coverage"]).toBe("required");
    expect(codes({ coverage: "other" })["coverage"]).toBe("unknown_value");
    expect(ok({ coverage: "individual", placeScope: { type: "text", text: "x" } }).coverage).toBe("individual");
  });

  it("種類：空・未知・重複（除く）。包括 × airport は airport_not_blanket", () => {
    expect(codes({ kinds: [] })["kinds"]).toBe("required");
    expect(codes({ kinds: undefined })["kinds"]).toBe("required");
    expect(codes({ kinds: "did" })["kinds"]).toBe("invalid");
    expect(codes({ kinds: ["did", "mlit:did"] })["kinds"]).toBe("unknown_value");
    expect(ok({ kinds: ["did", "did", "drop"] }).kinds).toEqual(["did", "drop"]);
    expect(codes({ kinds: ["airport"], airportNames: ["A"] })["kinds"]).toBe("airport_not_blanket");
    const airport = { coverage: "individual", kinds: ["airport"], airportNames: ["出雲縁結び空港"], placeScope: { type: "circles", circles: [{ lat: 35.4, lng: 132.9, radiusM: 3000 }] } };
    expect(ok(airport)).toMatchObject({ kinds: ["airport"], airport_names: ["出雲縁結び空港"] });
    // 空港名は 1 件以上（空白だけは数えない）
    expect(codes({ ...airport, airportNames: [] })["airportNames"]).toBe("required");
    expect(codes({ ...airport, airportNames: ["  "] })["airportNames"]).toBe("required");
    expect(codes({ ...airport, airportNames: undefined })["airportNames"]).toBe("required");
    expect(codes({ ...airport, airportNames: ["a", "b", "c", "d", "e", "f"] })["airportNames"]).toBe("too_many");
    expect(codes({ ...airport, airportNames: ["x".repeat(51)] })["airportNames"]).toBe("too_long");
    // 空港等周辺の許可の場所は円か文章
    expect(codes({ ...airport, placeScope: { type: "nationwide" } })["placeScope"]).toBe("individual_not_nationwide");
    // 空港を含まない登録の空港名は持たない
    expect(ok({ airportNames: ["A"] }).airport_names).toEqual([]);
  });

  it("日付：形・存在しない日付・大小。許可書発行日は許可期間の自より後でもよい", () => {
    expect(codes({ issuedOn: "" })["issuedOn"]).toBe("required");
    expect(codes({ issuedOn: "2026/09/25" })["issuedOn"]).toBe("date_format");
    expect(codes({ validFrom: "2026-02-30" })["validFrom"]).toBe("date_format");
    expect(codes({ validTo: "20270930" })["validTo"]).toBe("date_format");
    expect(codes({ validTo: undefined })["validTo"]).toBe("required");
    expect(codes({ validFrom: "2027-10-01", validTo: "2027-09-30" })["validTo"]).toBe("period_order");
    expect(ok({ validFrom: "2027-09-30", validTo: "2027-09-30" }).valid_from).toBe("2027-09-30");
    expect(ok({ issuedOn: "2027-12-31" }).issued_on).toBe("2027-12-31");
  });

  it("場所：全国（包括のみ）・円（1〜10 件、緯度経度・半径の値域）・文章のみ（0〜300 文字）", () => {
    expect(codes({ placeScope: undefined })["placeScope"]).toBe("required");
    expect(codes({ placeScope: { type: "prefecture" } })["placeScope"]).toBe("unknown_value");
    expect(codes({ coverage: "individual", placeScope: { type: "nationwide" } })["placeScope"]).toBe("individual_not_nationwide");
    const c = (circle: object) => codes({ placeScope: { type: "circles", circles: [circle] } })["placeScope"];
    expect(ok({ placeScope: { type: "circles", circles: [{ name: "本社", lat: 35.434238, lng: 133.380508, radiusM: 1000 }] } }).place_scope).toEqual({
      type: "circles",
      circles: [{ name: "本社", lat: 35.434238, lng: 133.380508, radiusM: 1000 }],
    });
    expect(c({ lat: 91, lng: 133, radiusM: 10 })).toBe("coordinate_range");
    expect(c({ lat: 35, lng: 181, radiusM: 10 })).toBe("coordinate_range");
    expect(c({ lat: 35.1234567, lng: 133, radiusM: 10 })).toBe("coordinate_precision");
    expect(c({ lat: "abc", lng: 133, radiusM: 10 })).toBe("coordinate_format");
    expect(c({ lat: 35, lng: 133, radiusM: 0 })).toBe("radius_out_of_range");
    expect(c({ lat: 35, lng: 133, radiusM: 100001 })).toBe("radius_out_of_range");
    expect(c({ lat: 35, lng: 133, radiusM: 1.5 })).toBe("radius_out_of_range");
    expect(ok({ placeScope: { type: "circles", circles: [{ lat: 35, lng: 133, radiusM: 100000 }] } }).place_scope.type).toBe("circles");
    expect(c({ lat: 35, lng: 133, radiusM: 10, name: "x".repeat(51) })).toBe("name_too_long");
    expect(codes({ placeScope: { type: "circles", circles: [] } })["placeScope"]).toBe("required");
    const eleven = Array.from({ length: 11 }, () => ({ lat: 35, lng: 133, radiusM: 10 }));
    expect(codes({ placeScope: { type: "circles", circles: eleven } })["placeScope"]).toBe("too_many");
    expect(ok({ placeScope: { type: "circles", circles: eleven.slice(0, 10) } }).place_scope.type).toBe("circles");
    expect(ok({ placeScope: { type: "text", text: "許可書の別紙の区域" } }).place_scope).toEqual({ type: "text", text: "許可書の別紙の区域" });
    expect(ok({ placeScope: { type: "text", text: "" } }).place_scope).toEqual({ type: "text", text: "" });
    expect(ok({ placeScope: { type: "text", text: "x".repeat(300) } }).place_scope.type).toBe("text");
    expect(codes({ placeScope: { type: "text", text: "x".repeat(301) } })["placeScope"]).toBe("too_long");
    expect(codes({ placeScope: { type: "text", text: 1 } })["placeScope"]).toBe("invalid");
  });

  it("機体・操縦者：any／listed（1〜50 件の UUID。重複は除く）", () => {
    expect(ok({ aircraftScope: { type: "listed", ids: [ID1, ID1.toUpperCase(), ID2] } }).aircraft_scope).toEqual({ type: "listed", ids: [ID1, ID2] });
    expect(codes({ aircraftScope: { type: "listed", ids: [] } })["aircraftScope"]).toBe("required");
    expect(codes({ aircraftScope: { type: "listed" } })["aircraftScope"]).toBe("required");
    expect(codes({ pilotScope: { type: "listed", ids: ["not-uuid"] } })["pilotScope"]).toBe("invalid");
    expect(codes({ pilotScope: { type: "all" } })["pilotScope"]).toBe("unknown_value");
    expect(codes({ pilotScope: undefined })["pilotScope"]).toBe("required");
    const many = Array.from({ length: 51 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    expect(codes({ pilotScope: { type: "listed", ids: many } })["pilotScope"]).toBe("too_many");
    expect(ok({ pilotScope: { type: "listed", ids: many.slice(0, 50) } }).pilot_scope.type).toBe("listed");
  });

  it("条件：高度・重量の値域、補助者・立入管理措置（boolean）、条件の文章（1000 文字・禁止語）", () => {
    expect(ok({ maxAltitudeM: 0 }).max_altitude_m).toBe(0);
    expect(ok({ maxAltitudeM: 2000 }).max_altitude_m).toBe(2000);
    expect(codes({ maxAltitudeM: 2001 })["maxAltitudeM"]).toBe("out_of_range");
    expect(codes({ maxAltitudeM: -1 })["maxAltitudeM"]).toBe("out_of_range");
    expect(codes({ maxAltitudeM: 1.5 })["maxAltitudeM"]).toBe("invalid");
    expect(ok({ maxWeightKg: 999.99 }).max_weight_kg).toBe(999.99);
    expect(ok({ maxWeightKg: 0 }).max_weight_kg).toBe(0);
    expect(codes({ maxWeightKg: 1000 })["maxWeightKg"]).toBe("out_of_range");
    expect(codes({ maxWeightKg: -0.01 })["maxWeightKg"]).toBe("out_of_range");
    expect(codes({ maxWeightKg: 1.234 })["maxWeightKg"]).toBe("precision");
    expect(codes({ maxWeightKg: "abc" })["maxWeightKg"]).toBe("invalid");
    expect(ok({ maxAltitudeM: "", maxWeightKg: null })).toMatchObject({ max_altitude_m: null, max_weight_kg: null });
    expect(codes({ requiresObserver: "yes" })["requiresObserver"]).toBe("invalid");
    expect(codes({ requiresAccessControl: 1 })["requiresAccessControl"]).toBe("invalid");
    expect(ok({ conditionsText: "x".repeat(1000) }).conditions_text).toHaveLength(1000);
    expect(codes({ conditionsText: "x".repeat(1001) })["conditionsText"]).toBe("too_long");
    for (const w of FORBIDDEN_PHRASES) expect(codes({ conditionsText: `前${w}後` })["conditionsText"], w).toBe("forbidden_phrase");
    for (const w of FORBIDDEN_PHRASES) expect(codes({ placeScope: { type: "text", text: w } })["placeScope"], w).toBe("forbidden_phrase");
  });

  it("禁止語は 4 つ（通報の不要を断言する言い方）", () => {
    expect(FORBIDDEN_PHRASES).toEqual(["通報不要", "通報は不要", "通報の必要はありません", "通報しなくて"]);
  });

  it("複数の誤りは項目ごとに全部返す", () => {
    const v = validatePermitRegistration({});
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(Object.keys(v.codes).sort()).toEqual(["aircraftScope", "coverage", "issuedOn", "kinds", "permitNumber", "pilotScope", "placeScope", "validFrom", "validTo"]);
    }
  });
});

describe("validateRevokedOn", () => {
  it("失効日は YYYY-MM-DD", () => {
    const v = validateRevokedOn({ revokedOn: "2027-01-15" });
    expect(v.ok && v.data).toEqual({ revoked_on: "2027-01-15" });
    for (const bad of [{}, { revokedOn: "" }]) {
      const r = validateRevokedOn(bad);
      expect(!r.ok && r.codes["revokedOn"]).toBe("required");
    }
    const f = validateRevokedOn({ revokedOn: "2027-13-01" });
    expect(!f.ok && f.codes["revokedOn"]).toBe("date_format");
  });
});
