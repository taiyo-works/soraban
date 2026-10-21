// dips パッケージのテスト用の入力（テストだけが読む）。
import type { PlanForReport, ReportInputs } from "./types";

export const PLAN_ID = "11111111-1111-4111-8111-111111111111";
export const AIRCRAFT_ID = "22222222-2222-4222-8222-222222222222";
export const PILOT_ID = "33333333-3333-4333-8333-333333333333";
export const ORG_ID = "44444444-4444-4444-8444-444444444444";

export const FULL_INPUTS: ReportInputs = {
  flightPurposes: [1],
  assistantsNumber: 1,
  plannedMaxTime: 30,
  flightSpeed: 10,
  onsiteControlL3: "1",
  onsiteControlL35: "0",
  onsiteControl2: "1",
  mooring: "0",
};

export const basePlan = (over: Partial<PlanForReport> = {}): PlanForReport => ({
  planId: PLAN_ID,
  title: "夜間の橋梁点検",
  startAt: "2027-01-14T09:00",
  durationMinutes: 60,
  placeName: "フューチャーテック株式会社 本社",
  latitude: 35.434238,
  longitude: 133.380508,
  radiusM: 100,
  maxAltitudeM: 50,
  accessControl: true,
  permitNumbers: null,
  aircraftId: AIRCRAFT_ID,
  aircraft: {
    registrationMark: "JU12T0001",
    modelName: "Matrice 350 RTK",
    manufacturer: "DJI",
    airworthinessClass: null,
    airworthinessCertNumber: null,
    maxTakeoffWeightKg: 0.9,
  },
  pilotId: PILOT_ID,
  pilot: { fullName: "操縦 一郎", licenseClass: "second", licenseNumber: "TEST-12345678", licenseNumberMasked: false },
  snapshot: {
    id: "55555555-5555-4555-8555-555555555555",
    checkEvidenceId: "chk-evidence-0001",
    diagnosisEvidenceId: "diag-evidence-0001",
    flags: ["method_night"],
    permitProcedureIds: [],
  },
  inputs: FULL_INPUTS,
  ...over,
});
