// Sprint 12a（単体）：飛行計画・よく使う地点の入力検査。
import { describe, expect, it } from "vitest";
import { PLAN_PERMIT_VALUES, validatePlace, validatePlan, type PlanInputData } from "./validate-plan";

const A = "11111111-1111-4111-8111-111111111111";
const P = "22222222-2222-4222-8222-222222222222";
const valid = {
  title: "本社の周辺の空撮",
  aircraftId: A,
  pilotId: P,
  plannedStartAt: "2027-01-14T09:00",
  durationMinutes: 45,
  purpose: "空撮",
  placeName: "フューチャーテック株式会社 本社",
  latitude: 35.434238,
  longitude: 133.380508,
};

const ok = (extra: object = {}): PlanInputData => {
  const v = validatePlan({ ...valid, ...extra });
  if (!v.ok) throw new Error(JSON.stringify(v.codes));
  return v.data;
};
const codes = (extra: object, drop: readonly string[] = []): Record<string, string> => {
  const input: Record<string, unknown> = { ...valid, ...extra };
  for (const k of drop) delete input[k];
  const v = validatePlan(input);
  return v.ok ? {} : { ...v.codes };
};

describe("validatePlan", () => {
  it("最小の入力で通り、任意の項目は null・空の配列になる", () => {
    expect(ok()).toEqual({
      title: "本社の周辺の空撮",
      aircraft_id: A,
      pilot_id: P,
      planned_start_at: "2027-01-14T09:00",
      duration_minutes: 45,
      purpose: "空撮",
      place_name: "フューチャーテック株式会社 本社",
      latitude: 35.434238,
      longitude: 133.380508,
      radius_m: null,
      saved_place_id: null,
      max_altitude_m: null,
      flags: [],
      pilot_permits: [],
      judgement_purpose: null,
      access_control: null,
      third_party_overflight: null,
      bvlos_with_observer: null,
      permit_numbers: null,
      notes: null,
    });
  });

  it("必須の項目が無いと required", () => {
    for (const k of ["title", "aircraftId", "pilotId", "plannedStartAt", "durationMinutes", "purpose", "placeName", "latitude", "longitude"]) {
      expect(codes({}, [k])[k], k).toBe("required");
    }
  });

  it("文字の長さ・UUID・時刻・所要時間・座標の検査", () => {
    expect(codes({ title: "あ".repeat(101) })["title"]).toBe("too_long");
    expect(codes({ purpose: "あ".repeat(101) })["purpose"]).toBe("too_long");
    expect(codes({ placeName: "あ".repeat(101) })["placeName"]).toBe("too_long");
    expect(codes({ permitNumbers: "A".repeat(201) })["permitNumbers"]).toBe("too_long");
    expect(codes({ notes: "あ".repeat(501) })["notes"]).toBe("too_long");
    expect(ok({ notes: "あ".repeat(500), permitNumbers: "A".repeat(200) }).notes).toHaveLength(500);
    expect(codes({ aircraftId: "x" })["aircraftId"]).toBe("invalid");
    expect(codes({ plannedStartAt: "2027-01-14 09:00" })["plannedStartAt"]).toBe("time_format");
    expect(codes({ plannedStartAt: "2027-02-30T09:00" })["plannedStartAt"]).toBe("time_format");
    expect(codes({ plannedStartAt: "2027-01-14T09:00:30" })["plannedStartAt"]).toBe("time_format");
    expect(codes({ durationMinutes: 0 })["durationMinutes"]).toBe("out_of_range");
    expect(codes({ durationMinutes: 1441 })["durationMinutes"]).toBe("out_of_range");
    expect(codes({ durationMinutes: 1.5 })["durationMinutes"]).toBe("invalid");
    expect(ok({ durationMinutes: 1440 }).duration_minutes).toBe(1440);
    expect(ok({ durationMinutes: "30" }).duration_minutes).toBe(30);
    expect(codes({ latitude: 91 })["latitude"]).toBe("coordinate_range");
    expect(codes({ longitude: 133.1234567 })["longitude"]).toBe("coordinate_precision");
    expect(codes({ latitude: "abc" })["latitude"]).toBe("coordinate_format");
  });

  it("半径 1〜10000、最大高度 0〜2000、地点は UUID", () => {
    expect(codes({ radiusM: 0 })["radiusM"]).toBe("out_of_range");
    expect(codes({ radiusM: 10001 })["radiusM"]).toBe("out_of_range");
    expect(ok({ radiusM: 10_000 }).radius_m).toBe(10_000);
    expect(codes({ maxAltitudeM: -1 })["maxAltitudeM"]).toBe("out_of_range");
    expect(codes({ maxAltitudeM: 2001 })["maxAltitudeM"]).toBe("out_of_range");
    expect(ok({ maxAltitudeM: 0 }).max_altitude_m).toBe(0);
    expect(ok({ maxAltitudeM: 2000 }).max_altitude_m).toBe(2000);
    expect(codes({ savedPlaceId: "x" })["savedPlaceId"]).toBe("invalid");
    expect(ok({ savedPlaceId: A.toUpperCase() }).saved_place_id).toBe(A);
  });

  it("フラグは重複を除き定義の順に並べる。未知の値は unknown_value", () => {
    expect(ok({ flags: ["method_drop", "method_night", "method_night", "airspace_150m"] }).flags).toEqual([
      "airspace_150m",
      "method_night",
      "method_drop",
    ]);
    expect(codes({ flags: ["method_flying"] })["flags"]).toBe("unknown_value");
    expect(codes({ flags: "method_night" })["flags"]).toBe("invalid");
    expect(codes({ flags: [1] })["flags"]).toBe("invalid");
  });

  it("手入力できる許可・同意は重複を除いて並べ替える。未知の値は unknown_value（Sprint 12d：DIPS の値は別の検査）", () => {
    expect(ok({ pilotPermits: ["park_manager", "facility_manager", "park_manager"] }).pilot_permits).toEqual(["facility_manager", "park_manager"]);
    expect(codes({ pilotPermits: ["facility_manager_and_pref_pubsafety"] })["pilotPermits"]).toBe("unknown_value");
    // Sprint 12d：DIPS の許可・承認（mlit・mlit:<種類>）は手入力できない。登録の照合から判定に入る
    expect(PLAN_PERMIT_VALUES).not.toContain("mlit:night");
    expect(PLAN_PERMIT_VALUES).not.toContain("mlit");
  });

  it("Sprint 12d：DIPS の許可・承認の値は 400 dips_permit_from_registry（理由に「登録から照合します」）", () => {
    for (const v of ["mlit", "mlit:did", "mlit:night", "mlit:150m", "mlit:unknown"]) {
      const r = validatePlan({ ...valid, pilotPermits: ["park_manager", v] });
      expect(r.ok, v).toBe(false);
      if (!r.ok) {
        expect(r.codes["pilotPermits"], v).toBe("dips_permit_from_registry");
        expect(r.errors["pilotPermits"], v).toContain("登録から照合します");
      }
    }
  });

  it("目的の例外・立入管理措置など", () => {
    expect(ok({ judgementPurpose: "emergency" }).judgement_purpose).toBe("emergency");
    expect(ok({ judgementPurpose: "" }).judgement_purpose).toBeNull();
    expect(codes({ judgementPurpose: "general" })["judgementPurpose"]).toBe("unknown_value");
    expect(ok({ accessControl: true, thirdPartyOverflight: false, bvlosWithObserver: true })).toMatchObject({
      access_control: true,
      third_party_overflight: false,
      bvlos_with_observer: true,
    });
    expect(codes({ accessControl: "yes" })["accessControl"]).toBe("invalid");
  });

  it("判定の結果らしき値は読まない（data に現れない）", () => {
    const d = ok({
      verdict: { level: "no_procedure" },
      result: { verdict: { level: "no_procedure" } },
      snapshot: { id: "x" },
      snapshotId: "x",
      evidenceId: "ev_x",
      status: "active",
      plannedDate: "2000-01-01",
      droneWeightG: 1,
    });
    expect(JSON.stringify(d)).not.toMatch(/verdict|snapshot|evidence|no_procedure|2000-01-01/);
    expect(Object.keys(d)).not.toContain("status");
    expect(Object.keys(d)).not.toContain("drone_weight_g");
  });
});

describe("validatePlace", () => {
  it("本社を登録できる", () => {
    const v = validatePlace({ name: "フューチャーテック株式会社 本社", addressText: "鳥取県西伯郡日吉津村日吉津45番地3", latitude: 35.434238, longitude: 133.380508 });
    expect(v).toEqual({
      ok: true,
      data: {
        name: "フューチャーテック株式会社 本社",
        address_text: "鳥取県西伯郡日吉津村日吉津45番地3",
        latitude: 35.434238,
        longitude: 133.380508,
        note: null,
      },
    });
  });
  it("名称・座標は必須。長さ・桁数の検査", () => {
    const e = (b: Record<string, unknown>) => {
      const v = validatePlace(b);
      return v.ok ? {} : v.codes;
    };
    expect(e({ latitude: 1, longitude: 1 })).toEqual({ name: "required" });
    expect(e({ name: "x" })).toEqual({ latitude: "required", longitude: "required" });
    expect(e({ name: "あ".repeat(101), latitude: 1, longitude: 1 })).toEqual({ name: "too_long" });
    expect(e({ name: "x", addressText: "あ".repeat(201), latitude: 1, longitude: 1 })).toEqual({ addressText: "too_long" });
    expect(e({ name: "x", note: "あ".repeat(201), latitude: 1, longitude: 1 })).toEqual({ note: "too_long" });
    expect(e({ name: "x", latitude: 1.1234567, longitude: 1 })).toEqual({ latitude: "coordinate_precision" });
  });
});
