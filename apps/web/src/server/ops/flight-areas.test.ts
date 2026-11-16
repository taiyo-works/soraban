// 飛行範囲の API 入力の検査と保存の形（Sprint 19-1b B1-2・B1-3・B1-5・B1-7）。
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { haversineMeters, MAX_AREA_VERTICES } from "@soraban/geo";
import {
  areasOfPlanRow,
  JUDGEMENT_AREA_NOTE,
  MAX_FLIGHT_AREAS,
  parseAreasInput,
  storedToInput,
  type StoredArea,
} from "./flight-areas";
import { validatePlan } from "./validate-plan";
import { checkRegistration, type PermitRegistration, type PlanPermitInput } from "./permit-logic";

const tri = [
  [133.33, 35.42],
  [133.34, 35.42],
  [133.335, 35.43],
];
const planBody = {
  title: "t",
  aircraftId: "11111111-1111-4111-8111-111111111111",
  pilotId: "22222222-2222-4222-8222-222222222222",
  plannedStartAt: "2026-11-02T10:00",
  durationMinutes: 30,
  purpose: "p",
  placeName: "n",
};

describe("parseAreasInput", () => {
  it("多角形 1 つ：覆う円の中心は代表点（小数 6 桁）、半径は全頂点を覆う", () => {
    const r = parseAreasInput([{ kind: "polygon", vertices: tri }]);
    if (!r.ok) throw new Error(r.reason);
    expect(r.stored).toEqual([{ id: "a1", kind: "polygon", vertices: tri }]);
    expect(Number(r.latitude.toFixed(6))).toBe(r.latitude);
    expect(Number(r.longitude.toFixed(6))).toBe(r.longitude);
    for (const [lng, lat] of tri) expect(haversineMeters({ lat: r.latitude, lng: r.longitude }, { lat: lat!, lng: lng! })).toBeLessThanOrEqual(r.radiusM);
  });

  it("複数の範囲：半径は 1 つ目だけでなく全範囲を覆う（遠い 2 つ目の円の縁まで）", () => {
    const far = { kind: "circle", center: [133.36, 35.44], radiusM: 300 };
    const r = parseAreasInput([{ kind: "polygon", vertices: tri }, far]);
    if (!r.ok) throw new Error(r.reason);
    const c = { lat: r.latitude, lng: r.longitude };
    expect(r.radiusM).toBeGreaterThanOrEqual(haversineMeters(c, { lat: 35.44, lng: 133.36 }) + 300);
    const first = parseAreasInput([{ kind: "polygon", vertices: tri }]);
    if (!first.ok) throw new Error();
    expect(r.latitude).toBe(first.latitude);
    expect(r.radiusM).toBeGreaterThan(first.radiusM);
  });

  it("許可の照合（B1-7）：許可の円が実際の範囲を覆わなければ place_out_of_scope。範囲を覆う円なら通る", () => {
    const far = { kind: "circle", center: [133.36, 35.44], radiusM: 300 };
    const r = parseAreasInput([{ kind: "polygon", vertices: tri }, far]);
    if (!r.ok) throw new Error(r.reason);
    const plan: PlanPermitInput = {
      startAt: "2026-11-02T10:00", durationMinutes: 30, lat: r.latitude, lng: r.longitude, radiusM: r.radiusM, maxAltitudeM: null,
      flags: [], accessControl: null, observer: null, aircraftId: "a", aircraftWeightG: null, pilotId: "p", permitNumbers: null,
    };
    const reg = (radiusM: number): PermitRegistration => ({
      id: "r", versionNo: 1, versionHash: "h", permitNumber: "X", permitNumberKey: "X", coverage: "blanket", kinds: ["did"], airportNames: [],
      issuedOn: "2026-01-01", validFrom: "2026-01-01", validTo: "2027-12-31", status: "active", revokedOn: null, voided: false,
      placeScope: { type: "circles", circles: [{ lat: r.latitude, lng: r.longitude, radiusM }] },
      aircraftScope: { type: "any" }, pilotScope: { type: "any" }, maxAltitudeM: null, maxWeightKg: null,
      requiresObserver: false, requiresAccessControl: false, conditionsText: null,
    });
    const win = { from: "2026-11-02", to: "2026-11-02" };
    expect(checkRegistration(reg(r.radiusM * 2), plan, win)).not.toContain("place_out_of_scope");
    // 1 つ目の範囲だけの半径（狭い）の円では、遠い範囲を覆えない
    const firstOnly = parseAreasInput([{ kind: "polygon", vertices: tri }]);
    if (!firstOnly.ok) throw new Error();
    expect(checkRegistration(reg(firstOnly.radiusM * 2), plan, win)).toContain("place_out_of_scope");
  });

  it("円 1 つ：緯度・経度・半径は円そのもの", () => {
    const r = parseAreasInput([{ kind: "circle", center: [133.331, 35.428], radiusM: 150 }]);
    if (!r.ok) throw new Error(r.reason);
    expect([r.latitude, r.longitude, r.radiusM]).toEqual([35.428, 133.331, 150]);
  });

  it("座標の順は [経度, 緯度]：緯度と経度の取り違え（[35.4, 133.3]）は拒否", () => {
    const r = parseAreasInput([{ kind: "circle", center: [35.4, 133.3], radiusM: 100 }]);
    expect(r).toMatchObject({ ok: false, reason: "lat_out_of_range" });
  });

  it("拒否の理由コード", () => {
    const reason = (v: unknown) => {
      const r = parseAreasInput(v);
      return r.ok ? "ok" : r.reason;
    };
    expect(reason("x")).toBe("areas_not_array");
    expect(reason([])).toBe("areas_empty");
    expect(reason(Array.from({ length: MAX_FLIGHT_AREAS + 1 }, () => ({ kind: "circle", center: [133.3, 35.4], radiusM: 10 })))).toBe("areas_too_many");
    expect(reason([{ kind: "polygon", vertices: tri.slice(0, 2) }])).toBe("vertices_too_few");
    const many = Array.from({ length: MAX_AREA_VERTICES + 1 }, (_, i) => [133 + i * 0.0001, 35 + (i % 2) * 0.0001]);
    expect(reason([{ kind: "polygon", vertices: many }])).toBe("vertices_too_many");
    expect(reason([{ kind: "polygon", vertices: [[133.3, 35.4], [133.3, 35.4], [133.31, 35.41]] }])).toBe("vertex_duplicate");
    expect(reason([{ kind: "polygon", vertices: [[133.3, 35.4], [133.31, 35.4], [133.32, 35.4]] }])).toBe("area_degenerate");
    expect(reason([{ kind: "polygon", vertices: [[133.3, 35.4], [133.31, 35.4], [133.31, 35.41], [133.3, 35.4]] }])).toBe("ring_closed");
    expect(reason([{ kind: "polygon", vertices: [[133.3, 35.4, 10], [133.31, 35.4], [133.31, 35.41]] }])).toBe("shape_invalid");
    expect(reason([{ kind: "square" }])).toBe("kind_unknown");
    expect(reason([{ kind: "circle", center: [133.3, 35.4], radiusM: 0 }])).toBe("radius_out_of_range");
    expect(reason([{ kind: "circle", center: [133.3, 35.4], radiusM: 10.5 }])).toBe("radius_not_integer");
    expect(reason([{ kind: "circle", center: [133.3123456, 35.4], radiusM: 10 }])).toBe("coordinate_too_precise");
    expect(reason([{ id: "x", kind: "circle", center: [133.3, 35.4], radiusM: 10 }, { id: "x", kind: "circle", center: [133.3, 35.4], radiusM: 10 }])).toBe("area_id_duplicate");
    expect(reason([{ name: "a\nb", kind: "circle", center: [133.3, 35.4], radiusM: 10 }])).toBe("area_name_invalid");
    expect(reason([{ id: "bad id!", kind: "circle", center: [133.3, 35.4], radiusM: 10 }])).toBe("area_id_invalid");
  });

  it("area_too_large：覆う円の半径が 10000 m を超える（個々は 10000 m 以下）", () => {
    const r = parseAreasInput([
      { kind: "circle", center: [133.3, 35.4], radiusM: 6000 },
      { kind: "circle", center: [133.5, 35.4], radiusM: 6000 },
    ]);
    expect(r).toMatchObject({ ok: false, reason: "area_too_large" });
  });
});

describe("validatePlan と areas", () => {
  it("areas があるとき、リクエストの緯度・経度・半径は使わない（サーバーの計算値）", () => {
    const v = validatePlan({ ...planBody, areas: [{ kind: "polygon", vertices: tri }], latitude: 1, longitude: 2, radiusM: 3 });
    if (!v.ok) throw new Error(JSON.stringify(v));
    expect(v.data.latitude).not.toBe(1);
    expect(v.data.radius_m).not.toBe(3);
    expect(v.data.flight_areas).toHaveLength(1);
    const same = validatePlan({ ...planBody, areas: [{ kind: "polygon", vertices: tri }] });
    if (!same.ok) throw new Error();
    expect([v.data.latitude, v.data.longitude, v.data.radius_m]).toEqual([same.data.latitude, same.data.longitude, same.data.radius_m]);
  });

  it("areas が無いと従来どおり（緯度・経度が必須、flight_areas の鍵が無い）", () => {
    const v = validatePlan({ ...planBody, latitude: 35.4, longitude: 133.3, radiusM: 100 });
    if (!v.ok) throw new Error();
    expect("flight_areas" in v.data).toBe(false);
    const ng = validatePlan({ ...planBody });
    expect(ng.ok).toBe(false);
    // areas: null も従来どおり
    expect(validatePlan({ ...planBody, areas: null, latitude: 35.4, longitude: 133.3 }).ok).toBe(true);
  });

  it("不正な areas は項目 areas に理由のコードで出る", () => {
    const v = validatePlan({ ...planBody, areas: [{ kind: "polygon", vertices: tri.slice(0, 2) }] });
    expect(v).toMatchObject({ ok: false, codes: { areas: "vertices_too_few" } });
  });
});

describe("既存の計画の読み替え", () => {
  it("半径ありは円 1 つ、半径なしは点だけ（円ではない）、範囲ありはそのまま", () => {
    expect(areasOfPlanRow({ flight_areas: null, latitude: "35.428000", longitude: "133.331000", radius_m: 150 })).toEqual({
      state: "circle",
      areas: [{ id: "plan-circle", kind: "circle", name: null, center: [133.331, 35.428], radiusM: 150 }],
    });
    expect(areasOfPlanRow({ flight_areas: null, latitude: "35.4", longitude: "133.3", radius_m: null })).toEqual({ state: "point", areas: [] });
    const stored: StoredArea[] = [{ id: "a1", kind: "polygon", vertices: tri as never }];
    expect(areasOfPlanRow({ flight_areas: stored, latitude: "35.4", longitude: "133.3", radius_m: 900 }).state).toBe("areas");
  });

  it("保存の形と入力の形の往復で変わらない（訂正の合成）", () => {
    const r = parseAreasInput([{ id: "k1", name: "北", kind: "polygon", vertices: tri }, { id: "k2", kind: "circle", center: [133.33, 35.42], radiusM: 20 }]);
    if (!r.ok) throw new Error();
    const again = parseAreasInput(storedToInput(r.stored));
    expect(again).toEqual(r);
  });
});

describe("定数と 0018 の一致", () => {
  it("DB の上限（範囲 20・頂点 100）は TypeScript の定数と同じ", () => {
    const sql = readFileSync(path.resolve(__dirname, "../../../../../packages/db/migrations/0018_flight_areas.sql"), "utf8");
    expect(sql).toContain(`jsonb_array_length(p_areas) > ${MAX_FLIGHT_AREAS}`);
    expect(sql).toContain(`jsonb_array_length(a->'vertices') > ${MAX_AREA_VERTICES}`);
  });
  it("判定の範囲の注記の文言", () => {
    expect(JUDGEMENT_AREA_NOTE).toBe("判定は範囲の中の 1 か所（代表点）で行っています。範囲の全体は確認していません。");
  });
});
