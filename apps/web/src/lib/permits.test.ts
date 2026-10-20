// Sprint 11c 契約 1・2、Sprint 11d B1・契約 14（単体）：取得済みの許可のチェックと pilotPermits の相互変換。
// Sprint 11d で、DIPS の許可・承認を種類ごとに入力し（mlit:did 等）、同意＋通報の合成値
// （facility_manager_and_pref_pubsafety）を入れなくなった（エンジンが両方の値を要するため）。
import { describe, expect, it } from "vitest";
import {
  buildPilotPermits,
  EMPTY_DIPS_CHECKS,
  EMPTY_PERMIT_CHECKS,
  normalizeRestoredCtx,
  permitChecksFromPilotPermits,
  type PermitChecks,
} from "./permits";

const checks = (over: Partial<PermitChecks>): PermitChecks => ({ ...EMPTY_PERMIT_CHECKS, ...over });
const dips = (over: Partial<Record<keyof typeof EMPTY_DIPS_CHECKS, boolean>>) => ({ ...EMPTY_DIPS_CHECKS, ...over });

describe("buildPilotPermits", () => {
  it("何もチェックしなければ空", () => {
    expect(buildPilotPermits(EMPTY_PERMIT_CHECKS)).toEqual([]);
  });

  it("同意だけ → facility_manager だけ", () => {
    expect(buildPilotPermits(checks({ facilityConsent: true }))).toEqual(["facility_manager"]);
  });

  it("通報だけ → pref_pubsafety_notice だけ", () => {
    expect(buildPilotPermits(checks({ pubsafetyNotice: true }))).toEqual(["pref_pubsafety_notice"]);
  });

  it("同意と通報の両方 → 2 つの値（合成値は入れない。Sprint 11d）", () => {
    expect(buildPilotPermits(checks({ facilityConsent: true, pubsafetyNotice: true }))).toEqual([
      "facility_manager",
      "pref_pubsafety_notice",
    ]);
  });

  it("DIPS は種類ごとの値、公園・文化庁は従来どおり", () => {
    expect(buildPilotPermits(checks({ dips: dips({ did: true }) }))).toEqual(["mlit:did"]);
    expect(buildPilotPermits(checks({ dips: dips({ night: true, bvlos: true }) }))).toEqual([
      "mlit:night",
      "mlit:bvlos",
    ]);
    expect(buildPilotPermits(checks({ park: true }))).toEqual(["park_manager"]);
    expect(buildPilotPermits(checks({ bunkacho: true }))).toEqual(["bunkacho_or_kyoiku"]);
    expect(
      buildPilotPermits(checks({ dips: dips({ did: true }), park: true, bunkacho: true })),
    ).toEqual(["mlit:did", "park_manager", "bunkacho_or_kyoiku"]);
  });
});

describe("permitChecksFromPilotPermits", () => {
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

  it("旧値 mlit は DID 上空の許可として戻し、夜間などには当てない（Sprint 11d 契約 14）", () => {
    const c = permitChecksFromPilotPermits(["mlit"]);
    expect(c.dips).toEqual(dips({ did: true }));
  });

  it("新形式の値はそのまま戻る（往復で変わらない）", () => {
    const all: PermitChecks = {
      dips: dips({ did: true, "150m": true, night: true, bvlos: true, "30m": true, event: true, dangerous: true, drop: true }),
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

describe("normalizeRestoredCtx（旧形式の履歴の復元）", () => {
  it("Sprint 6 形式 → facility_manager_and_pref_pubsafety を含まず、許可が残らなければ pilotPermits を外す", () => {
    const ctx = normalizeRestoredCtx({
      droneWeightG: 900,
      pilotPermits: ["facility_manager_and_pref_pubsafety"],
    });
    expect(ctx).toEqual({ droneWeightG: 900 });
  });

  it("Sprint 11b までの形式 → 同意だけ（facility_manager）になる", () => {
    const ctx = normalizeRestoredCtx({
      droneWeightG: 900,
      pilotPermits: ["facility_manager", "facility_manager_and_pref_pubsafety"],
    });
    expect(ctx).toEqual({ droneWeightG: 900, pilotPermits: ["facility_manager"] });
  });

  it("Sprint 11c の同意＋通報（合成値つき）→ 同意と通報の 2 つの値に組み直す", () => {
    const ctx = normalizeRestoredCtx({
      pilotPermits: ["facility_manager", "pref_pubsafety_notice", "facility_manager_and_pref_pubsafety"],
    });
    expect(ctx?.pilotPermits).toEqual(["facility_manager", "pref_pubsafety_notice"]);
  });

  it("旧値 mlit は mlit:did に組み直す。許可以外の項目は残し、空になれば undefined", () => {
    expect(normalizeRestoredCtx({ purpose: "public_duty", pilotPermits: ["mlit"] })).toEqual({
      purpose: "public_duty",
      pilotPermits: ["mlit:did"],
    });
    expect(normalizeRestoredCtx({ pilotPermits: ["facility_manager_and_pref_pubsafety"] })).toBeUndefined();
    expect(normalizeRestoredCtx(undefined)).toBeUndefined();
  });
});
