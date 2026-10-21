// 計画への許可・承認の登録の適用（Sprint 12d 設計 D）。DB から登録を読み、permit-logic の照合に渡す。
// 照合に使う登録は、計画の許可番号の欄の番号に結びついたものだけを**一括で**取得する（計画の件数に比例してクエリが増えない）。
// 照合に外部通信は使わない（DB の読み取りだけ）。
import { toJstInput } from "@/lib/ops-time";
import {
  EMPTY_PERMIT_MATCH,
  matchPlanPermits,
  splitPermitNumbers,
  type PermitMatchResult,
  type PermitRegistration,
  type PlanPermitInput,
} from "./permit-logic";
import { judgementFlagsOf, weightGramsFromKg } from "./plan-logic";
import * as store from "./store";
import type { PermitRow, PlanWithJoins, Queryable } from "./store";
import type { PlanInputData } from "./validate-plan";

const asDateValue = (v: string | Date): Date => (v instanceof Date ? v : new Date(v));

/** 登録の行 → 照合に使う登録。 */
export const permitRegistrationOf = (r: PermitRow): PermitRegistration => ({
  id: r.id,
  versionNo: r.current_version,
  versionHash: r.version_hash,
  permitNumber: r.permit_number,
  permitNumberKey: r.permit_number_key,
  coverage: r.coverage,
  kinds: r.kinds,
  airportNames: r.airport_names,
  issuedOn: r.issued_on,
  validFrom: r.valid_from,
  validTo: r.valid_to,
  status: r.status,
  revokedOn: r.revoked_on,
  voided: r.voided_at !== null,
  placeScope: r.place_scope,
  aircraftScope: r.aircraft_scope,
  pilotScope: r.pilot_scope,
  maxAltitudeM: r.max_altitude_m,
  maxWeightKg: r.max_weight_kg === null ? null : Number(r.max_weight_kg),
  requiresObserver: r.requires_observer,
  requiresAccessControl: r.requires_access_control,
  conditionsText: r.conditions_text,
});

/** 保存済みの計画の行 → 照合の入力。 */
export const planPermitInputOfRow = (r: PlanWithJoins): PlanPermitInput => ({
  startAt: toJstInput(asDateValue(r.planned_start_at)),
  durationMinutes: r.duration_minutes,
  lat: Number(r.latitude),
  lng: Number(r.longitude),
  radiusM: r.radius_m,
  maxAltitudeM: r.max_altitude_m,
  flags: judgementFlagsOf({ flags: r.flags, maxAltitudeM: r.max_altitude_m }),
  accessControl: r.access_control,
  observer: r.bvlos_with_observer,
  aircraftId: r.aircraft_id,
  aircraftWeightG: weightGramsFromKg(r.aircraft_max_takeoff_weight_kg === null ? null : Number(r.aircraft_max_takeoff_weight_kg)),
  pilotId: r.pilot_id,
  permitNumbers: r.permit_numbers,
});

/** 保存前の（検査済みの）計画の項目 → 照合の入力。 */
export const planPermitInputOfData = (d: PlanInputData, aircraftMaxTakeoffWeightKg: number | null): PlanPermitInput => ({
  startAt: d.planned_start_at,
  durationMinutes: d.duration_minutes,
  lat: d.latitude,
  lng: d.longitude,
  radiusM: d.radius_m,
  maxAltitudeM: d.max_altitude_m,
  flags: judgementFlagsOf({ flags: d.flags, maxAltitudeM: d.max_altitude_m }),
  accessControl: d.access_control,
  observer: d.bvlos_with_observer,
  aircraftId: d.aircraft_id,
  aircraftWeightG: weightGramsFromKg(aircraftMaxTakeoffWeightKg),
  pilotId: d.pilot_id,
  permitNumbers: d.permit_numbers,
});

/** 計画ごとの照合の結果（キーは計画の ID）。許可番号のある計画があるときだけ、登録を 1 回のクエリでまとめて引く。 */
export const loadPermitMatches = async (
  db: Queryable,
  orgId: string,
  rows: readonly PlanWithJoins[],
): Promise<Map<string, PermitMatchResult>> => {
  const out = new Map<string, PermitMatchResult>();
  const keys = new Set<string>();
  for (const r of rows) for (const t of splitPermitNumbers(r.permit_numbers)) keys.add(t.key);
  const regs = keys.size === 0 ? [] : (await store.listPermitsByKeys(db, orgId, [...keys])).map(permitRegistrationOf);
  for (const r of rows) {
    out.set(r.id, keys.size === 0 || splitPermitNumbers(r.permit_numbers).length === 0 ? EMPTY_PERMIT_MATCH : matchPlanPermits(planPermitInputOfRow(r), regs));
  }
  return out;
};

/** 1 件の計画の入力に対する照合（保存前）。 */
export const matchInput = async (db: Queryable, orgId: string, input: PlanPermitInput): Promise<PermitMatchResult> => {
  const tokens = splitPermitNumbers(input.permitNumbers);
  if (tokens.length === 0) return matchPlanPermits(input, []);
  const regs = (await store.listPermitsByKeys(db, orgId, tokens.map((t) => t.key))).map(permitRegistrationOf);
  return matchPlanPermits(input, regs);
};

/** 計画の照合の結果と、組織の取消していない登録すべて（候補の提案用）に対する照合。 */
export const matchWithCandidates = async (db: Queryable, orgId: string, input: PlanPermitInput): Promise<PermitMatchResult> => {
  const regs = (await store.listPermits(db, orgId, false)).map(permitRegistrationOf);
  const tokens = splitPermitNumbers(input.permitNumbers);
  // 取消した登録の番号が欄にあるときは、取消済みの行も照合に渡す（理由 voided を出すため）
  const voided = tokens.length === 0 ? [] : (await store.listPermitsByKeys(db, orgId, tokens.map((t) => t.key))).filter((r) => r.voided_at !== null).map(permitRegistrationOf);
  return matchPlanPermits(input, [...regs, ...voided]);
};
