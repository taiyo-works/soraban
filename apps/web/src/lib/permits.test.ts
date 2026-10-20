// Sprint 11c 契約 1・2（単体）：取得済みの許可のチェックと pilotPermits の相互変換。
import { describe, expect, it } from "vitest";
import {
  buildPilotPermits,
  EMPTY_PERMIT_CHECKS,
  normalizeRestoredCtx,
  permitChecksFromPilotPermits,
  type PermitChecks,
} from "./permits";

const checks = (over: Partial<PermitChecks>): PermitChecks => ({ ...EMPTY_PERMIT_CHECKS, ...over });

describe("buildPilotPermits（契約 1）", () => {
  it("何もチェックしなければ空", () => {
    expect(buildPilotPermits(EMPTY_PERMIT_CHECKS)).toEqual([]);
  });

  it("同意だけ → facility_manager だけ（飛行禁止法の例外の値を入れない）", () => {
    expect(buildPilotPermits(checks({ facilityConsent: true }))).toEqual(["facility_manager"]);
  });

  it("通報だけ → pref_pubsafety_notice だけ", () => {
    expect(buildPilotPermits(checks({ pubsafetyNotice: true }))).toEqual(["pref_pubsafety_notice"]);
  });

  it("同意と通報の両方 → 3 つの値を含む", () => {
    const v = buildPilotPermits(checks({ facilityConsent: true, pubsafetyNotice: true }));
    expect(v).toHaveLength(3);
    expect(v).toEqual(
      expect.arrayContaining([
        "facility_manager",
        "pref_pubsafety_notice",
        "facility_manager_and_pref_pubsafety",
      ]),
    );
  });

  it("DIPS・公園・文化庁の値は従来どおり", () => {
    expect(buildPilotPermits(checks({ mlit: true }))).toEqual(["mlit"]);
    expect(buildPilotPermits(checks({ park: true }))).toEqual(["park_manager"]);
    expect(buildPilotPermits(checks({ bunkacho: true }))).toEqual(["bunkacho_or_kyoiku"]);
    expect(
      buildPilotPermits(checks({ mlit: true, park: true, bunkacho: true })),
    ).toEqual(["mlit", "park_manager", "bunkacho_or_kyoiku"]);
  });
});

describe("permitChecksFromPilotPermits（契約 2）", () => {
  it("Sprint 6 形式（facility_manager_and_pref_pubsafety だけ）→ 同意・通報とも未チェック", () => {
    const c = permitChecksFromPilotPermits(["facility_manager_and_pref_pubsafety"]);
    expect(c.facilityConsent).toBe(false);
    expect(c.pubsafetyNotice).toBe(false);
  });

  it("Sprint 11b までの形式（facility_manager と併記）→ 同意だけチェック済み、通報は未チェック", () => {
    const c = permitChecksFromPilotPermits(["facility_manager", "facility_manager_and_pref_pubsafety"]);
    expect(c.facilityConsent).toBe(true);
    expect(c.pubsafetyNotice).toBe(false);
  });

  it("新形式の値はそのまま戻る（往復で変わらない）", () => {
    const all: PermitChecks = {
      mlit: true,
      park: true,
      facilityConsent: true,
      pubsafetyNotice: true,
      bunkacho: true,
    };
    expect(permitChecksFromPilotPermits(buildPilotPermits(all))).toEqual(all);
    const onlyNotice = checks({ pubsafetyNotice: true });
    expect(permitChecksFromPilotPermits(buildPilotPermits(onlyNotice))).toEqual(onlyNotice);
  });

  it("undefined・未知の値 → すべて未チェック", () => {
    expect(permitChecksFromPilotPermits(undefined)).toEqual(EMPTY_PERMIT_CHECKS);
    expect(permitChecksFromPilotPermits(["unknown_value"])).toEqual(EMPTY_PERMIT_CHECKS);
  });
});

describe("normalizeRestoredCtx（旧形式の履歴の復元。evaluator 差し戻し 1 回目）", () => {
  it("Sprint 6 形式 → facility_manager_and_pref_pubsafety を含まず、許可が残らなければ pilotPermits を外す", () => {
    const ctx = normalizeRestoredCtx({
      droneWeightG: 900,
      pilotPermits: ["facility_manager_and_pref_pubsafety"],
    });
    expect(ctx).toEqual({ droneWeightG: 900 });
    expect(ctx?.pilotPermits ?? []).not.toContain("facility_manager_and_pref_pubsafety");
  });

  it("Sprint 11b までの形式 → 同意だけ（facility_manager）になり、両方の値を含まない", () => {
    const ctx = normalizeRestoredCtx({
      droneWeightG: 900,
      pilotPermits: ["facility_manager", "facility_manager_and_pref_pubsafety"],
    });
    expect(ctx).toEqual({ droneWeightG: 900, pilotPermits: ["facility_manager"] });
  });

  it("新形式の同意＋通報はそのまま 3 つの値に組み直す", () => {
    const ctx = normalizeRestoredCtx({
      pilotPermits: ["facility_manager", "pref_pubsafety_notice", "facility_manager_and_pref_pubsafety"],
    });
    expect(ctx?.pilotPermits).toEqual([
      "facility_manager",
      "pref_pubsafety_notice",
      "facility_manager_and_pref_pubsafety",
    ]);
  });

  it("許可以外の項目は残し、空になれば undefined", () => {
    expect(normalizeRestoredCtx({ purpose: "public_duty", pilotPermits: ["mlit"] })).toEqual({
      purpose: "public_duty",
      pilotPermits: ["mlit"],
    });
    expect(normalizeRestoredCtx({ pilotPermits: ["facility_manager_and_pref_pubsafety"] })).toBeUndefined();
    expect(normalizeRestoredCtx(undefined)).toBeUndefined();
  });
});
