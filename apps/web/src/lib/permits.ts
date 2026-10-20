// 「取得済みの許可」のチェックと、地点判定の ctx.pilotPermits の相互変換（Sprint 11c）。
//
// 小型無人機等飛行禁止法の例外（施設管理者の同意を得たうえで、飛行の 48 時間前までに
// 都道府県公安委員会へ通報した場合）は、同意と通報の両方がそろったときだけ当たるようにする。
// エンジンの例外節の値（facility_manager_and_pref_pubsafety）は変えず、ここで両方そろったときだけ
// その値を入れる。エンジン側で両方を必須にする変更は Sprint 11d（ENGINE_VERSION を上げるとき）に行う。

export type PermitChecks = {
  /** 国交省 DIPS（航空法 DID の許可）。 */
  readonly mlit: boolean;
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
  mlit: "mlit",
  park: "park_manager",
  facilityConsent: "facility_manager",
  /** 通報だけの記録用の値。エンジンのどの例外節にも当たらない。 */
  pubsafetyNotice: "pref_pubsafety_notice",
  /** 同意かつ通報のときだけ入れる値。エンジンの飛行禁止法の例外節に当たる。 */
  consentAndNotice: "facility_manager_and_pref_pubsafety",
  bunkacho: "bunkacho_or_kyoiku",
} as const;

export const EMPTY_PERMIT_CHECKS: PermitChecks = {
  mlit: false,
  park: false,
  facilityConsent: false,
  pubsafetyNotice: false,
  bunkacho: false,
};

/** チェックの状態から pilotPermits を組み立てる（並びは従来どおり：DIPS・施設・公園・文化庁）。 */
export const buildPilotPermits = (checks: PermitChecks): string[] => {
  const permits: string[] = [];
  if (checks.mlit) permits.push(PERMIT_VALUES.mlit);
  if (checks.facilityConsent) permits.push(PERMIT_VALUES.facilityConsent);
  if (checks.pubsafetyNotice) permits.push(PERMIT_VALUES.pubsafetyNotice);
  if (checks.facilityConsent && checks.pubsafetyNotice) permits.push(PERMIT_VALUES.consentAndNotice);
  if (checks.park) permits.push(PERMIT_VALUES.park);
  if (checks.bunkacho) permits.push(PERMIT_VALUES.bunkacho);
  return permits;
};

/**
 * pilotPermits からチェックの状態を戻す。
 * 通報は pref_pubsafety_notice があるときだけ済み扱いにする。旧形式の履歴
 * （facility_manager_and_pref_pubsafety だけ、または facility_manager と併記）からは
 * 通報を済み扱いに戻さない（安全側。利用者が通報を済ませていれば改めてチェックする）。
 */
export const permitChecksFromPilotPermits = (
  permits: readonly string[] | undefined,
): PermitChecks => {
  const has = (v: string): boolean => (permits ?? []).includes(v);
  return {
    mlit: has(PERMIT_VALUES.mlit),
    park: has(PERMIT_VALUES.park),
    facilityConsent: has(PERMIT_VALUES.facilityConsent),
    pubsafetyNotice: has(PERMIT_VALUES.pubsafetyNotice),
    bunkacho: has(PERMIT_VALUES.bunkacho),
  };
};

/**
 * 履歴から復元した ctx の pilotPermits を、現在の規則で組み直す（Sprint 11c）。
 * 旧形式（facility_manager_and_pref_pubsafety を含む Sprint 6〜11b の履歴）をそのまま送ると、
 * 通報をしていなくても飛行禁止法の例外が当たってしまうため、チェックの状態に戻してから組み立て直す。
 * 許可が残らなければ pilotPermits を外し、ctx が空になれば undefined を返す。
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
