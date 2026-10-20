// 「取得済みの許可」のチェックと、地点判定の ctx.pilotPermits の相互変換（Sprint 11c・11d）。
//
// Sprint 11c：小型無人機等飛行禁止法の例外（施設管理者の同意を得たうえで、飛行の 48 時間前までに
// 都道府県公安委員会へ通報した場合）は、同意と通報の両方がそろったときだけ当たるよう入力を分けた。
// Sprint 11d：エンジンの例外節が同意（facility_manager）と通報（pref_pubsafety_notice）の両方を要する
// （permit_holder_all）ようになったため、両方そろったときの合成値（facility_manager_and_pref_pubsafety）は
// 入れない。DIPS の許可・承認は種類ごとに入力する（mlit:did 等）。旧値 mlit は DID 上空の許可として戻す。
import {
  DIPS_PERMIT_KINDS,
  dipsPermitValue,
  LEGACY_PERMIT_ALIASES,
  type DipsPermitKind,
} from "@soraban/regulations";

export type DipsPermitChecks = Readonly<Record<DipsPermitKind, boolean>>;

export type PermitChecks = {
  /** 国交省 DIPS の許可・承認（種類ごと。空港等周辺は含めない）。 */
  readonly dips: DipsPermitChecks;
  /** 公園管理者（都市公園条例）。 */
  readonly park: boolean;
  /** 施設管理者の同意（県条例の事前調整・飛行禁止法の対象施設の同意）。 */
  readonly facilityConsent: boolean;
  /** 公安委員会への通報（飛行禁止法。飛行の 48 時間前までに通報済み）。 */
  readonly pubsafetyNotice: boolean;
  /** 文化庁・教育委員会（文化財保護法 125 条）。 */
  readonly bunkacho: boolean;
};

export const PERMIT_VALUES = {
  park: "park_manager",
  facilityConsent: "facility_manager",
  /** 通報の値。同意（facility_manager）とそろったときだけ飛行禁止法の例外節に当たる（Sprint 11d）。 */
  pubsafetyNotice: "pref_pubsafety_notice",
  /** Sprint 6〜11c の合成値。Sprint 11d からはどの例外節にも当たらず、組み立てでも入れない。 */
  legacyConsentAndNotice: "facility_manager_and_pref_pubsafety",
  bunkacho: "bunkacho_or_kyoiku",
} as const;

export const EMPTY_DIPS_CHECKS: DipsPermitChecks = Object.fromEntries(
  DIPS_PERMIT_KINDS.map((k) => [k, false]),
) as Record<DipsPermitKind, boolean>;

export const EMPTY_PERMIT_CHECKS: PermitChecks = {
  dips: EMPTY_DIPS_CHECKS,
  park: false,
  facilityConsent: false,
  pubsafetyNotice: false,
  bunkacho: false,
};

/** チェックの状態から pilotPermits を組み立てる（並び：DIPS（種類の順）・施設・通報・公園・文化庁）。 */
export const buildPilotPermits = (checks: PermitChecks): string[] => {
  const permits: string[] = [];
  for (const k of DIPS_PERMIT_KINDS) if (checks.dips[k]) permits.push(dipsPermitValue(k));
  if (checks.facilityConsent) permits.push(PERMIT_VALUES.facilityConsent);
  if (checks.pubsafetyNotice) permits.push(PERMIT_VALUES.pubsafetyNotice);
  if (checks.park) permits.push(PERMIT_VALUES.park);
  if (checks.bunkacho) permits.push(PERMIT_VALUES.bunkacho);
  return permits;
};

/**
 * pilotPermits からチェックの状態を戻す。
 * - 旧値 mlit（0.3.0 まで）は DID 上空の許可（mlit:did）として戻す（Sprint 11d 未決 2）。
 * - 通報は pref_pubsafety_notice があるときだけ済み扱いにする。旧形式の合成値
 *   （facility_manager_and_pref_pubsafety）からは通報を済み扱いに戻さない（安全側。Sprint 11c）。
 */
export const permitChecksFromPilotPermits = (
  permits: readonly string[] | undefined,
): PermitChecks => {
  const values = (permits ?? []).map((p) => LEGACY_PERMIT_ALIASES[p] ?? p);
  const has = (v: string): boolean => values.includes(v);
  return {
    dips: Object.fromEntries(
      DIPS_PERMIT_KINDS.map((k) => [k, has(dipsPermitValue(k))]),
    ) as Record<DipsPermitKind, boolean>,
    park: has(PERMIT_VALUES.park),
    facilityConsent: has(PERMIT_VALUES.facilityConsent),
    pubsafetyNotice: has(PERMIT_VALUES.pubsafetyNotice),
    bunkacho: has(PERMIT_VALUES.bunkacho),
  };
};

/**
 * 履歴から復元した ctx の pilotPermits を、現在の規則で組み直す（Sprint 11c・11d）。
 * 旧形式（facility_manager_and_pref_pubsafety・mlit を含む履歴）をそのまま送らず、チェックの状態に戻してから
 * 組み立て直す。許可が残らなければ pilotPermits を外し、ctx が空になれば undefined を返す。
 */
export const normalizeRestoredCtx = <T extends { readonly pilotPermits?: readonly string[] }>(
  ctx: T | undefined,
): T | undefined => {
  if (!ctx) return undefined;
  const { pilotPermits, ...rest } = ctx;
  const rebuilt =
    pilotPermits !== undefined
      ? buildPilotPermits(permitChecksFromPilotPermits(pilotPermits))
      : [];
  const next = (rebuilt.length > 0 ? { ...rest, pilotPermits: rebuilt } : rest) as T;
  return Object.keys(next).length > 0 ? next : undefined;
};
