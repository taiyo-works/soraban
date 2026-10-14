import { NextResponse } from "next/server";
import { isValidLatLng } from "@soraban/geo";
import {
  buildPrefillFields,
  deriveDiagnosis,
  extractAirspaceFlagsFromRegulations,
  SPECIFIC_FLIGHT_FLAG_LABEL,
  type ApplicationDiagnosis,
  type PrefillField,
  type SpecificFlightFlag,
} from "@soraban/regulations";
import {
  computeDiagnosisEvidenceId,
  runRegulationCheck,
} from "@/server/regulation-check";

// 既存 /api/check を壊さず、診断は新規 /api/diagnose に分離する（spec §10-1 推奨）。
//
// 入力: { lat, lng, droneWeightG?, flags?, plannedDate?, accessControl?, thirdPartyOverflight? }
//   - flags はユーザーが選んだ飛行方法フラグ（夜間・目視外・30m・催し・危険物・投下・150m）。
//   - 空域フラグ（DID・空港）はサーバ側で信号機判定（runRegulationCheck）から自動導出して合流する。
// 出力: ApplicationDiagnosis（procedures 配列を含む）。

const VALID_FLAGS = new Set<SpecificFlightFlag>(
  Object.keys(SPECIFIC_FLIGHT_FLAG_LABEL) as SpecificFlightFlag[],
);

// 信頼境界で flags をサニタイズ。未知の文字列は捨てる。
const parseFlags = (raw: unknown): SpecificFlightFlag[] => {
  if (!Array.isArray(raw)) return [];
  const out: SpecificFlightFlag[] = [];
  for (const v of raw) {
    if (typeof v === "string" && VALID_FLAGS.has(v as SpecificFlightFlag)) {
      out.push(v as SpecificFlightFlag);
    }
  }
  return out;
};

const parseWeight = (raw: unknown): number | undefined => {
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) return raw;
  return undefined;
};

const parseBool = (raw: unknown): boolean | undefined =>
  typeof raw === "boolean" ? raw : undefined;

// ISO 日付（YYYY-MM-DD）の最低限の形式チェック。
const parsePlannedDate = (raw: unknown): string | undefined =>
  typeof raw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : undefined;

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const obj = (body ?? {}) as Record<string, unknown>;
  const lat = Number(obj["lat"]);
  const lng = Number(obj["lng"]);
  if (!isValidLatLng({ lat, lng })) {
    return NextResponse.json({ error: "invalid lat/lng" }, { status: 400 });
  }

  const droneWeightG = parseWeight(obj["droneWeightG"]);
  const userFlags = parseFlags(obj["flags"]);
  const plannedDate = parsePlannedDate(obj["plannedDate"]);
  const accessControl = parseBool(obj["accessControl"]);
  const thirdPartyOverflight = parseBool(obj["thirdPartyOverflight"]);
  const bvlosWithObserver = parseBool(obj["bvlosWithObserver"]);

  // 信号機判定を実行し、空域フラグ（DID・空港 red）を自動導出してユーザー入力に合流。
  // ctx には機体重量だけ渡す（例外節適用と evidenceId の一貫性のため）。
  const checkResult = await runRegulationCheck(
    { lat, lng },
    droneWeightG !== undefined ? { droneWeightG } : undefined,
  );
  const airspaceFlags = extractAirspaceFlagsFromRegulations(checkResult.regulations);
  // 飛行方法フラグ ＋ 判定由来の空域フラグを合流した最終フラグ集合（重複排除）。
  const mergedFlags: readonly SpecificFlightFlag[] = Array.from(
    new Set<SpecificFlightFlag>([...airspaceFlags, ...userFlags]),
  );

  const diagnosis: ApplicationDiagnosis = deriveDiagnosis({
    flags: mergedFlags,
    droneWeightG,
    plannedDate,
    accessControl,
    thirdPartyOverflight,
  });

  // DIPS／DRS 入力プリフィル表（座標・住所・飛行方法・機体重量 等の実値）。
  // evidenceId と同じ判定入力から生成するため、サーバ側で組み立てて返す。
  const prefill: readonly PrefillField[] = buildPrefillFields({
    lat,
    lng,
    resolvedAddress: checkResult.resolvedAddress,
    flags: mergedFlags,
    droneWeightG,
    plannedDate,
    accessControl,
    thirdPartyOverflight,
    bvlosWithObserver,
  });

  // 診断結果も含めた決定論的証跡 ID を採番（spec §6.3）。
  // ベースとなる地点判定の checkEvidenceId も併せて返し、双方を追跡可能にする。
  const diagnosisEvidenceId = computeDiagnosisEvidenceId({
    lat,
    lng,
    checkedAt: checkResult.checkedAt,
    regulationIds: checkResult.regulations.map((r) => r.id),
    droneWeightG,
    flags: mergedFlags,
    plannedDate,
    accessControl,
    thirdPartyOverflight,
    bvlosWithObserver,
    category: diagnosis.category,
    procedureIds: diagnosis.procedures.map((p) => p.id),
  });

  return NextResponse.json({
    ...diagnosis,
    prefill,
    evidenceId: diagnosisEvidenceId,
    checkEvidenceId: checkResult.evidenceId,
    engineVersion: checkResult.engineVersion,
    checkedAt: checkResult.checkedAt,
    resolvedAddress: checkResult.resolvedAddress,
    muniCode: checkResult.muniCode,
    // 判定地点の座標も返す（PDF・プリフィル表の参照用）。
    lat,
    lng,
    // どの空域フラグが判定由来で合流したかを UI が示せるように返す。
    derivedAirspaceFlags: airspaceFlags,
    // どのフラグ集合（空域＋方法）で診断したか（マニュアル骨子・PDF の生成根拠）。
    flags: mergedFlags,
  });
}
