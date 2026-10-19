// Sprint 10 契約 15・16（単体）：機体・操縦者の入力検査。
import { describe, expect, it } from "vitest";
import { maskLicenseNumber, validateAircraft, validateChangeMeta, validatePilot } from "./validate";

const AIRCRAFT = {
  registrationMark: "JU0123456789",
  modelName: "Matrice 350 RTK",
  manufacturer: "DJI",
  serialNumber: "SN-001",
  typeCertified: false,
  initialFlightMinutes: 125,
};

const errorsOf = (r: ReturnType<typeof validateAircraft> | ReturnType<typeof validatePilot>) => (r.ok ? {} : r.errors);

describe("validateAircraft", () => {
  it("正しい入力を data（列名）にし、登録記号を英大文字に正規化する", () => {
    const r = validateAircraft({ ...AIRCRAFT, registrationMark: " ju0123-abc " });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.registration_mark).toBe("JU0123ABC");
      expect(r.data).toMatchObject({ model_name: "Matrice 350 RTK", initial_flight_minutes: 125, status: "active", type_certified: false });
    }
  });

  it.each(["registrationMark", "modelName", "manufacturer", "serialNumber", "typeCertified"])(
    "必須項目 %s の欠落は項目ごとの理由付きで拒否",
    (key) => {
      const input: Record<string, unknown> = { ...AIRCRAFT };
      delete input[key];
      const e = errorsOf(validateAircraft(input));
      expect(Object.keys(e)).toEqual([key]);
      expect(e[key]).toMatch(/./);
    },
  );

  it("JU で始まらない登録記号は拒否", () => {
    expect(errorsOf(validateAircraft({ ...AIRCRAFT, registrationMark: "JA1234" }))["registrationMark"]).toMatch(/JU/);
    expect(errorsOf(validateAircraft({ ...AIRCRAFT, registrationMark: "JU12_3" }))["registrationMark"]).toBeDefined();
  });

  it("負または小数の既存飛行時間は拒否", () => {
    expect(errorsOf(validateAircraft({ ...AIRCRAFT, initialFlightMinutes: -1 }))["initialFlightMinutes"]).toBeDefined();
    expect(errorsOf(validateAircraft({ ...AIRCRAFT, initialFlightMinutes: 1.5 }))["initialFlightMinutes"]).toBeDefined();
    expect(errorsOf(validateAircraft({ ...AIRCRAFT, initialFlightMinutes: "30" }))["initialFlightMinutes"]).toBeDefined();
    const ok = validateAircraft({ ...AIRCRAFT, initialFlightMinutes: undefined });
    expect(ok.ok && ok.data.initial_flight_minutes).toBe(0);
  });

  it("型式認証ありで型式認証書番号なしは拒否（ありの場合は種類・型式・番号が必須）", () => {
    const e = errorsOf(validateAircraft({ ...AIRCRAFT, typeCertified: true, typeCertCategory: "第二種", typeCertModel: "X1" }));
    expect(Object.keys(e)).toEqual(["typeCertNumber"]);
    const ok = validateAircraft({ ...AIRCRAFT, typeCertified: true, typeCertCategory: "第二種", typeCertModel: "X1", typeCertNumber: "TC-1" });
    expect(ok.ok).toBe(true);
  });

  it("型式認証なしなら型式認証の項目は保存しない", () => {
    const r = validateAircraft({ ...AIRCRAFT, typeCertNumber: "TC-1" });
    expect(r.ok && r.data.type_cert_number).toBeNull();
  });

  it("機体認証の区分と番号、最大離陸重量（小数第 1 位まで）", () => {
    expect(errorsOf(validateAircraft({ ...AIRCRAFT, airworthinessClass: "third" }))["airworthinessClass"]).toBeDefined();
    expect(errorsOf(validateAircraft({ ...AIRCRAFT, airworthinessClass: "second" }))["airworthinessCertNumber"]).toBeDefined();
    expect(errorsOf(validateAircraft({ ...AIRCRAFT, maxTakeoffWeightKg: 6.47 }))["maxTakeoffWeightKg"]).toBeDefined();
    const ok = validateAircraft({ ...AIRCRAFT, airworthinessClass: "second", airworthinessCertNumber: "AW-1", maxTakeoffWeightKg: 6.4 });
    expect(ok.ok && ok.data).toMatchObject({ airworthiness_class: "second", max_takeoff_weight_kg: 6.4 });
  });
});

const PILOT = { fullName: "山田 太郎", hasLicense: true, licenseClass: "second", licenseNumber: "AB-12345678" };

describe("validatePilot", () => {
  it("正しい入力を data にする", () => {
    const r = validatePilot({ ...PILOT, licenseExpiresOn: "2029-03-31", limitationVlos: true });
    expect(r.ok && r.data).toMatchObject({
      full_name: "山田 太郎",
      has_license: true,
      license_class: "second",
      license_number: "AB-12345678",
      license_expires_on: "2029-03-31",
      limitation_vlos: true,
      limitation_type: false,
      member_id: null,
    });
  });

  it("技能証明ありで区分がないと拒否", () => {
    expect(Object.keys(errorsOf(validatePilot({ ...PILOT, licenseClass: undefined })))).toEqual(["licenseClass"]);
  });

  it("技能証明ありで番号がないと拒否", () => {
    expect(Object.keys(errorsOf(validatePilot({ ...PILOT, licenseNumber: "" })))).toEqual(["licenseNumber"]);
  });

  it("技能証明なしで番号があると拒否", () => {
    const e = errorsOf(validatePilot({ fullName: "A", hasLicense: false, licenseNumber: "X1" }));
    expect(Object.keys(e)).toEqual(["licenseNumber"]);
    expect(validatePilot({ fullName: "A", hasLicense: false }).ok).toBe(true);
  });

  it("番号の形式（英数字と - の 30 文字以内）、日付、氏名", () => {
    expect(errorsOf(validatePilot({ ...PILOT, licenseNumber: "AB 12" }))["licenseNumber"]).toBeDefined();
    expect(errorsOf(validatePilot({ ...PILOT, licenseNumber: "A".repeat(31) }))["licenseNumber"]).toBeDefined();
    expect(errorsOf(validatePilot({ ...PILOT, licenseExpiresOn: "2029-02-30" }))["licenseExpiresOn"]).toBeDefined();
    expect(errorsOf(validatePilot({ ...PILOT, fullName: " " }))["fullName"]).toBeDefined();
  });
});

describe("validateChangeMeta・maskLicenseNumber", () => {
  it("訂正・取消は expectedVersion と理由が必須", () => {
    expect(validateChangeMeta({ expectedVersion: 2, reason: "誤記" }).ok).toBe(true);
    const r = validateChangeMeta({ expectedVersion: 0, reason: " " });
    expect(r.ok ? [] : Object.keys(r.errors).sort()).toEqual(["expectedVersion", "reason"]);
  });

  it("技能証明書番号は末尾 4 桁以外を伏せる（4 桁以下はすべて伏せる）", () => {
    expect(maskLicenseNumber("AB-12345678")).toBe("*******5678");
    expect(maskLicenseNumber("1234")).toBe("****");
    expect(maskLicenseNumber(null)).toBeNull();
  });
});
