// 通報の指紋と冪等性キー（Sprint 12b 設計 C）。
// 指紋：計画から次の値を取り出して正規化し、SHA-256（soraban-report-fp-v1）にした値。
//   { startAt（JST 分）, durationMinutes, lat, lng, radiusM, maxAltitudeM, aircraftId, pilotId, flags（最終の flags・固定の順） }
// 通報の画面で入力する項目（速度など）は指紋に含めない（変えたときは利用者が「通報を変更する」を選ぶ）。
// 含める項目を足すときは、指紋の版（FINGERPRINT_VERSION）を上げる。
import { sha256Hex } from "./sha256";
import type { FingerprintArea, FingerprintParts, PlanForReport, ReportKind } from "./types";

export const FINGERPRINT_VERSION = "soraban-report-fp-v1";
export const IDEMPOTENCY_VERSION = "soraban-report-idem-v1";

/** 指紋に入れる flags の固定の順（SpecificFlightFlag の定義順。未知の値は最後に辞書順）。 */
export const FINGERPRINT_FLAG_ORDER: readonly string[] = [
  "airspace_emergency",
  "airspace_airport",
  "airspace_150m",
  "airspace_did",
  "method_night",
  "method_bvlos",
  "method_30m",
  "method_event",
  "method_dangerous",
  "method_drop",
];

const round6 = (n: number): number => Number(n.toFixed(6));

export const normalizeFlags = (flags: readonly string[]): string[] => {
  const uniq = [...new Set(flags)];
  const known = FINGERPRINT_FLAG_ORDER.filter((f) => uniq.includes(f));
  const unknown = uniq.filter((f) => !FINGERPRINT_FLAG_ORDER.includes(f)).sort();
  return [...known, ...unknown];
};

/**
 * 指紋に入れる範囲。多角形が 1 つでもあるか、2 件以上のときだけ返す（円 1 つ・無しは undefined ＝ 従来の指紋のまま）。
 * 座標は小数 6 桁に丸める。並びは入力の順（順を変える編集も変更として検知する）。識別子・名前は入れない。
 */
export const fingerprintAreasOf = (areas: readonly FingerprintArea[] | null | undefined): FingerprintArea[] | undefined => {
  if (!areas || areas.length === 0) return undefined;
  if (areas.length < 2 && areas.every((a) => a.kind === "circle")) return undefined;
  const pos = (p: readonly [number, number]): [number, number] => [round6(p[0]), round6(p[1])];
  return areas.map((a) =>
    a.kind === "polygon"
      ? { kind: "polygon", vertices: a.vertices.map(pos) }
      : { kind: "circle", center: pos(a.center), radiusM: a.radiusM },
  );
};

/** 指紋の元の値を取り出して正規化する。 */
export const fingerprintPartsOf = (
  plan: Pick<
    PlanForReport,
    "startAt" | "durationMinutes" | "latitude" | "longitude" | "radiusM" | "maxAltitudeM" | "aircraftId" | "pilotId"
  > & {
    readonly areas?: PlanForReport["areas"];
    readonly snapshot: { readonly flags: readonly string[] };
    readonly permitRegistration?: Pick<
      NonNullable<PlanForReport["permitRegistration"]>,
      "registrationId" | "versionNo" | "issuedOn" | "validFrom" | "validTo"
    > | null;
  },
): FingerprintParts => {
  const areas = fingerprintAreasOf(plan.areas);
  return {
  startAt: plan.startAt,
  durationMinutes: plan.durationMinutes,
  lat: round6(plan.latitude),
  lng: round6(plan.longitude),
  radiusM: plan.radiusM,
  maxAltitudeM: plan.maxAltitudeM,
  aircraftId: plan.aircraftId.toLowerCase(),
  pilotId: plan.pilotId.toLowerCase(),
  flags: normalizeFlags(plan.snapshot.flags),
  // 範囲があるときだけ足す（円 1 つ・点だけの計画の指紋・冪等性キーは従来と一致する）
  ...(areas ? { areas } : {}),
  // 登録があるときだけ足す（無い通報の指紋・冪等性キーは従来と一致する）
  ...(plan.permitRegistration
    ? {
        permit: {
          registrationId: plan.permitRegistration.registrationId.toLowerCase(),
          versionNo: plan.permitRegistration.versionNo,
          issuedOn: plan.permitRegistration.issuedOn,
          validFrom: plan.permitRegistration.validFrom,
          validTo: plan.permitRegistration.validTo,
        },
      }
    : {}),
  };
};

/** 元の値から指紋（SHA-256、16 進小文字 64 桁）を求める。 */
export const computeFingerprint = (p: FingerprintParts): string =>
  sha256Hex(
    JSON.stringify([
      FINGERPRINT_VERSION,
      p.startAt,
      p.durationMinutes,
      p.lat,
      p.lng,
      p.radiusM,
      p.maxAltitudeM,
      p.aircraftId,
      p.pilotId,
      normalizeFlags(p.flags),
      // 登録があるときだけ末尾に足す（FINGERPRINT_VERSION は上げない：登録の無い指紋は従来の値のまま）
      ...(p.permit ? [[p.permit.registrationId.toLowerCase(), p.permit.versionNo, p.permit.issuedOn, p.permit.validFrom, p.permit.validTo]] : []),
      // 範囲があるときだけ、先頭の "areas" で見分けて末尾に足す（FINGERPRINT_VERSION は上げない：範囲の無い指紋は従来の値のまま）
      ...(p.areas ? [["areas", ...p.areas.map((a) => (a.kind === "polygon" ? ["p", a.vertices] : ["c", a.center, a.radiusM]))]] : []),
    ]),
  );

export const fingerprintOf = (plan: Parameters<typeof fingerprintPartsOf>[0]): string => computeFingerprint(fingerprintPartsOf(plan));

export type FingerprintChange = {
  readonly key: keyof FingerprintParts;
  readonly label: string;
  readonly before: string;
  readonly after: string;
};

export const FINGERPRINT_PART_LABEL: Readonly<Record<keyof FingerprintParts, string>> = {
  startAt: "予定開始",
  durationMinutes: "所要時間",
  lat: "緯度",
  lng: "経度",
  radiusM: "範囲の半径",
  maxAltitudeM: "最大高度",
  aircraftId: "機体",
  pilotId: "操縦者",
  flags: "飛行の方法・空域",
  areas: "飛行範囲",
  permit: "許可・承認の登録",
};

const PART_KEYS: readonly (keyof FingerprintParts)[] = [
  "startAt",
  "durationMinutes",
  "lat",
  "lng",
  "radiusM",
  "maxAltitudeM",
  "aircraftId",
  "pilotId",
  "flags",
  "areas",
  "permit",
];

const show = (key: keyof FingerprintParts, p: FingerprintParts, flagLabel: (f: string) => string): string => {
  switch (key) {
    case "startAt":
      return p.startAt.replace("T", " ");
    case "durationMinutes":
      return `${p.durationMinutes} 分`;
    case "lat":
      return String(p.lat);
    case "lng":
      return String(p.lng);
    case "radiusM":
      return p.radiusM === null ? "未入力" : `${p.radiusM} m`;
    case "maxAltitudeM":
      return p.maxAltitudeM === null ? "未入力" : `${p.maxAltitudeM} m`;
    case "aircraftId":
      return "（変更前の機体）";
    case "pilotId":
      return "（変更前の操縦者）";
    case "areas": {
      const a = p.areas;
      if (!a) return "円・点（範囲の指定なし）";
      const poly = a.filter((x) => x.kind === "polygon").length;
      return `${a.length} 件（多角形 ${poly}・円 ${a.length - poly}）`;
    }
    case "permit":
      return p.permit ? `登録の版 ${p.permit.versionNo}（発行日 ${p.permit.issuedOn}・期間 ${p.permit.validFrom}〜${p.permit.validTo}）` : "なし";
    case "flags":
      return p.flags.length === 0 ? "なし" : p.flags.map(flagLabel).join("・");
  }
};

/** 比べる値（flags は順を揃え、permit は jsonb でキーの順が変わっても同じになるよう固定の並びにする）。 */
const comparable = (key: keyof FingerprintParts, p: FingerprintParts): string => {
  if (key === "flags") return JSON.stringify(normalizeFlags(p.flags));
  if (key === "areas") {
    // 固定の配列で比べる（オブジェクトの鍵の順に左右されない）
    return JSON.stringify(
      p.areas ? p.areas.map((a) => (a.kind === "polygon" ? ["p", a.vertices] : ["c", a.center, a.radiusM])) : null,
    );
  }
  if (key === "permit") {
    const q = p.permit;
    return JSON.stringify(q ? [q.registrationId.toLowerCase(), q.versionNo, q.issuedOn, q.validFrom, q.validTo] : null);
  }
  return JSON.stringify(p[key]);
};

/**
 * 通報時の元の値と現在の元の値を比べ、どの項目がどう変わったかを返す（変更点の表示）。
 * 機体・操縦者は ID を見せず「変更前の…」「変更後の…」とする（名前の解決は呼び出し側）。
 */
export const diffFingerprintParts = (
  before: FingerprintParts,
  after: FingerprintParts,
  opts: { readonly flagLabel?: (flag: string) => string } = {},
): FingerprintChange[] => {
  const flagLabel = opts.flagLabel ?? ((f: string) => f);
  const out: FingerprintChange[] = [];
  for (const key of PART_KEYS) {
    const a = comparable(key, before);
    const b = comparable(key, after);
    if (a === b) continue;
    const afterText =
      key === "areas" && before.areas && after.areas && before.areas.length === after.areas.length && before.areas.every((x, i) => x.kind === after.areas![i]!.kind)
        ? `${show(key, after, flagLabel)}・${after.areas!.some((x) => x.kind === "polygon") ? "頂点の位置が変わりました" : "円の中心・半径が変わりました"}`
        : key === "aircraftId" ? "（変更後の機体）" : key === "pilotId" ? "（変更後の操縦者）" : show(key, after, flagLabel);
    out.push({ key, label: FINGERPRINT_PART_LABEL[key], before: show(key, before, flagLabel), after: afterText });
  }
  return out;
};

// ---- 冪等性キー -----------------------------------------------------

export type IdempotencyInput = {
  readonly orgId: string;
  readonly planId: string;
  readonly kind: ReportKind;
  readonly fingerprint: string;
  /**
   * 新規：その計画の完了した取消の件数（世代）。変更・取消：元の通報の ID。
   * サービス層は、取り下げた行の件数を世代に足す（取り下げのあと、同じ内容を記録し直せるように）。
   */
  readonly basis: number | string;
};

/**
 * 冪等性キー：SHA-256 で (組織 ID, 計画 ID, 種別, 指紋, 基準)。画面の再読み込み・二度押しでも同じキーになり、
 * 取消のあとの再度の新規は世代が増えるため別のキーになる。
 */
export const computeIdempotencyKey = (i: IdempotencyInput): string =>
  sha256Hex(
    JSON.stringify([
      IDEMPOTENCY_VERSION,
      i.orgId.toLowerCase(),
      i.planId.toLowerCase(),
      i.kind,
      i.fingerprint,
      typeof i.basis === "string" ? i.basis.toLowerCase() : i.basis,
    ]),
  );
