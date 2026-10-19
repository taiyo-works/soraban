// Sprint 11 契約 4・5（単体）：飛行記録・日常点検記録の入力検査。
import { describe, expect, it } from "vitest";
import { INSPECTION_ITEMS } from "@/lib/ops-records";
import { validateFlight, validateInspection } from "./validate-records";

const A = "11111111-1111-4111-8111-111111111111";
const P = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2027-01-05T03:00:00Z"); // JST 12:00

const FLIGHT = {
  aircraftId: A,
  pilotId: P,
  purpose: "空撮",
  takeoffPlace: "米子市日吉津 本社",
  landingPlace: "米子市日吉津 本社",
  takeoffAt: "2027-01-05T09:30",
  landingAt: "2027-01-05T09:45",
  safetyIssue: false,
};

const codesOf = (r: ReturnType<typeof validateFlight> | ReturnType<typeof validateInspection>) => (r.ok ? {} : r.codes);

describe("4. 飛行記録の入力検査", () => {
  it("正しい入力は通り、data の列名に写る", () => {
    const r = validateFlight({ ...FLIGHT, specificFlightTypes: ["did", "bvlos", "did"], takeoffLat: 35.4, takeoffLng: "133.38" }, NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toMatchObject({
      aircraft_id: A,
      pilot_id: P,
      purpose: "空撮",
      takeoff_at: "2027-01-05T09:30",
      landing_at: "2027-01-05T09:45",
      specific_flight_types: ["did", "bvlos"],
      takeoff_lat: 35.4,
      takeoff_lng: 133.38,
      safety_issue: false,
      safety_issue_detail: null,
      defects: [],
    });
    // 飛行時間・氏名の写しは入力検査では作らない（DB とサービス層が決める）
    expect(r.data).not.toHaveProperty("flight_minutes");
    expect(r.data).not.toHaveProperty("pilot_name");
  });

  it.each([
    ["aircraftId", "required"],
    ["pilotId", "required"],
    ["purpose", "required"],
    ["takeoffPlace", "required"],
    ["landingPlace", "required"],
    ["takeoffAt", "required"],
    ["landingAt", "required"],
    ["safetyIssue", "required"],
  ])("必須項目 %s の欠落は %s", (key, code) => {
    const input: Record<string, unknown> = { ...FLIGHT };
    delete input[key];
    expect(codesOf(validateFlight(input, NOW))[key]).toBe(code);
  });

  it("「あり」で内容なし → detail_required。「あり」で内容ありは通る", () => {
    expect(codesOf(validateFlight({ ...FLIGHT, safetyIssue: true }, NOW))["safetyIssueDetail"]).toBe("detail_required");
    expect(codesOf(validateFlight({ ...FLIGHT, safetyIssue: true, safetyIssueDetail: " " }, NOW))["safetyIssueDetail"]).toBe(
      "detail_required",
    );
    const ok = validateFlight({ ...FLIGHT, safetyIssue: true, safetyIssueDetail: "突風で姿勢が乱れた" }, NOW);
    expect(ok.ok && ok.data.safety_issue_detail).toBe("突風で姿勢が乱れた");
  });

  it("不具合の発生日・不具合事項の欠落、日付の形の誤り", () => {
    const r = validateFlight(
      { ...FLIGHT, defects: [{ description: "プロペラの欠け" }, { occurredOn: "2027-01-05" }, { occurredOn: "2027/01/05", description: "x" }] },
      NOW,
    );
    expect(codesOf(r)).toMatchObject({
      "defects.0.occurredOn": "required",
      "defects.1.description": "required",
      "defects.2.occurredOn": "date_format",
    });
    const ok = validateFlight({ ...FLIGHT, defects: [{ occurredOn: "2027-01-05", description: "プロペラの欠け", confirmerName: "運航 管理子" }] }, NOW);
    expect(ok.ok && ok.data.defects).toEqual([
      { occurred_on: "2027-01-05", description: "プロペラの欠け", action_on: null, action: null, confirmer_name: "運航 管理子" },
    ]);
  });

  it("緯度経度の範囲外・小数 7 桁以上・片方だけ", () => {
    expect(codesOf(validateFlight({ ...FLIGHT, takeoffLat: 91, takeoffLng: 133 }, NOW))["takeoffLat"]).toBe("coordinate_range");
    expect(codesOf(validateFlight({ ...FLIGHT, landingLat: 35, landingLng: 181 }, NOW))["landingLng"]).toBe("coordinate_range");
    expect(codesOf(validateFlight({ ...FLIGHT, takeoffLat: 35.1234567, takeoffLng: 133 }, NOW))["takeoffLat"]).toBe(
      "coordinate_precision",
    );
    expect(codesOf(validateFlight({ ...FLIGHT, takeoffLat: 35.1 }, NOW))["takeoffLng"]).toBe("coordinate_pair");
  });

  it("特定飛行の形態の未知の値 → unknown_value", () => {
    expect(codesOf(validateFlight({ ...FLIGHT, specificFlightTypes: ["did", "rooftop"] }, NOW))["specificFlightTypes"]).toBe("unknown_value");
    expect(validateFlight({ ...FLIGHT, specificFlightTypes: [] }, NOW).ok).toBe(true);
  });

  it("時刻の誤りは理由コード付き（秒付き・順序・長さ・未来）", () => {
    expect(codesOf(validateFlight({ ...FLIGHT, takeoffAt: "2027-01-05T09:30:15" }, NOW))["takeoffAt"]).toBe("time_format");
    expect(codesOf(validateFlight({ ...FLIGHT, landingAt: "2027-01-05T09:29" }, NOW))["landingAt"]).toBe("landing_before_takeoff");
    expect(codesOf(validateFlight({ ...FLIGHT, landingAt: "2027-01-06T09:30" }, NOW))["landingAt"]).toBe("flight_too_long");
    expect(codesOf(validateFlight({ ...FLIGHT, takeoffAt: "2027-01-05T12:01", landingAt: "2027-01-05T12:10" }, NOW))["takeoffAt"]).toBe(
      "takeoff_in_future",
    );
  });

  it("文字数の上限", () => {
    expect(codesOf(validateFlight({ ...FLIGHT, purpose: "あ".repeat(101) }, NOW))["purpose"]).toBe("too_long");
    expect(codesOf(validateFlight({ ...FLIGHT, takeoffPlace: "あ".repeat(101) }, NOW))["takeoffPlace"]).toBe("too_long");
  });
});

const allNormal = () => Object.fromEntries(INSPECTION_ITEMS.map((it) => [it.key, { result: "normal" }]));
const INSPECTION = { aircraftId: A, pilotId: P, inspectedAt: "2027-01-05T09:00", placeName: "本社 駐車場", items: allNormal() };

describe("5. 日常点検の入力検査", () => {
  it("項目の一覧は要領の様式2 の 9 項目と同じ順・同じ名前", () => {
    expect(INSPECTION_ITEMS.map((it) => it.label)).toEqual([
      "機体全般",
      "プロペラ",
      "フレーム",
      "通信系統",
      "推進系統",
      "電源系統",
      "自動制御系統",
      "操縦装置",
      "バッテリー・燃料",
    ]);
  });

  it("9 項目すべて正常なら通る。区分の既定は飛行前", () => {
    const r = validateInspection(INSPECTION, NOW);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.timing).toBe("pre_flight");
      expect(Object.keys(r.data.items)).toHaveLength(9);
    }
  });

  for (const item of INSPECTION_ITEMS) {
    it(`${item.label}（${item.key}）の欠落は拒否`, () => {
      const items: Record<string, unknown> = allNormal();
      delete items[item.key];
      expect(codesOf(validateInspection({ ...INSPECTION, items }, NOW))[`items.${item.key}`]).toBe("required");
    });
  }

  it("normal・abnormal 以外の値は拒否", () => {
    for (const bad of ["ok", "〇", true, 1]) {
      const r = validateInspection({ ...INSPECTION, items: { ...allNormal(), propeller: { result: bad } } }, NOW);
      expect(codesOf(r)["items.propeller"]).toBe("invalid_result");
    }
  });

  it("abnormal で備考なしは拒否。備考ありは通る", () => {
    expect(codesOf(validateInspection({ ...INSPECTION, items: { ...allNormal(), frame: { result: "abnormal" } } }, NOW))["items.frame.note"]).toBe(
      "note_required",
    );
    expect(validateInspection({ ...INSPECTION, items: { ...allNormal(), frame: { result: "abnormal", note: "アームに亀裂" } } }, NOW).ok).toBe(true);
  });

  it("必須（機体・実施者・実施日時・場所）と時刻の形", () => {
    expect(codesOf(validateInspection({ ...INSPECTION, aircraftId: undefined, placeName: "" }, NOW))).toMatchObject({
      aircraftId: "required",
      placeName: "required",
    });
    expect(codesOf(validateInspection({ ...INSPECTION, inspectedAt: "2027-01-05T09:00:00" }, NOW))["inspectedAt"]).toBe("time_format");
    expect(codesOf(validateInspection({ ...INSPECTION, inspectedAt: "2027-01-05T12:01" }, NOW))["inspectedAt"]).toBe("in_future");
  });
});
