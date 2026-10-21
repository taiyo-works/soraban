// 通報の指紋と冪等性キー（Sprint 12b 設計 C）。
// 指紋：計画から次の値を取り出して正規化し、SHA-256（soraban-report-fp-v1）にした値。
//   { startAt（JST 分）, durationMinutes, lat, lng, radiusM, maxAltitudeM, aircraftId, pilotId, flags（最終の flags・固定の順） }
// 通報の画面で入力する項目（速度など）は指紋に含めない（変えたときは利用者が「通報を変更する」を選ぶ）。
// 含める項目を足すときは、指紋の版（FINGERPRINT_VERSION）を上げる。
import { sha256Hex } from "./sha256";
import type { FingerprintParts, PlanForReport, ReportKind } from "./types";

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

/** 指紋の元の値を取り出して正規化する。 */
export const fingerprintPartsOf = (
  plan: Pick<
    PlanForReport,
    "startAt" | "durationMinutes" | "latitude" | "longitude" | "radiusM" | "maxAltitudeM" | "aircraftId" | "pilotId"
  > & { readonly snapshot: { readonly flags: readonly string[] } },
): FingerprintParts => ({
  startAt: plan.startAt,
  durationMinutes: plan.durationMinutes,
  lat: round6(plan.latitude),
  lng: round6(plan.longitude),
  radiusM: plan.radiusM,
  maxAltitudeM: plan.maxAltitudeM,
  aircraftId: plan.aircraftId.toLowerCase(),
  pilotId: plan.pilotId.toLowerCase(),
  flags: normalizeFlags(plan.snapshot.flags),
});

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
    case "flags":
      return p.flags.length === 0 ? "なし" : p.flags.map(flagLabel).join("・");
  }
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
    const a = key === "flags" ? JSON.stringify(normalizeFlags(before.flags)) : JSON.stringify(before[key]);
    const b = key === "flags" ? JSON.stringify(normalizeFlags(after.flags)) : JSON.stringify(after[key]);
    if (a === b) continue;
    const afterText =
      key === "aircraftId" ? "（変更後の機体）" : key === "pilotId" ? "（変更後の操縦者）" : show(key, after, flagLabel);
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
  /** 新規：その計画の完了した取消の件数（世代）。変更・取消：元の通報の ID。 */
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
