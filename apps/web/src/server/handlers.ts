// /api/check・/api/diagnose の処理本体（Sprint 7）。
// 地点判定（runCheck）を引数で受け取り、統合テストでデータの読み込み口を差し替えられるようにする。
// route.ts は本番の runRegulationCheck を渡すだけ。
import { NextResponse } from "next/server";
import { isValidLatLng, type LatLng } from "@soraban/geo";
import {
  ALL_AMENDMENTS,
  buildPrefillFields,
  deriveDiagnosis,
  deriveDidDetailFromRegulations,
  deriveFlightVerdict,
  deriveDidStatusFromRegulations,
  extractAirspaceFlagsFromRegulations,
  isSmallDroneLawTriggered,
  mergeAirspaceFlags,
  SPECIFIC_FLIGHT_FLAG_LABEL,
  type AirspaceDeterminationStatus,
  type AmendmentRef,
  type ApplicationDiagnosis,
  type FlightContext,
  type FlightVerdict,
  type PrefillField,
  type RegulationCheckResult,
  type SpecificFlightFlag,
} from "@soraban/regulations";
import { isEvidenceLogEnabled, type DbEnv } from "@soraban/db";
import { collectDatasets, computeDiagnosisEvidenceId } from "./check-core";
import { runEvidenceWriteSafely, type WriteEvidence } from "./evidence-log";

export type RunCheck = (loc: LatLng, ctx?: FlightContext) => Promise<RegulationCheckResult>;

// FlightContext を信頼境界で正規化する。
// 不正値はサニタイズし、type 安全な形に直してから評価器へ渡す。
const parseFlightContext = (raw: unknown): FlightContext | undefined => {
  if (!raw || typeof raw !== "object") return undefined;
  const obj = raw as Record<string, unknown>;
  const ctx: { -readonly [K in keyof FlightContext]: FlightContext[K] } = {};

  if (typeof obj["droneWeightG"] === "number" && Number.isFinite(obj["droneWeightG"]) && obj["droneWeightG"] >= 0) {
    ctx.droneWeightG = obj["droneWeightG"];
  }
  if (Array.isArray(obj["pilotPermits"])) {
    const permits = obj["pilotPermits"].filter((p): p is string => typeof p === "string");
    if (permits.length > 0) ctx.pilotPermits = permits;
  }
  if (typeof obj["purpose"] === "string" && obj["purpose"].length > 0) {
    ctx.purpose = obj["purpose"];
  }
  if (typeof obj["droneClass"] === "string" && obj["droneClass"].length > 0) {
    ctx.droneClass = obj["droneClass"];
  }
  return Object.keys(ctx).length > 0 ? ctx : undefined;
};

/** 応答後に実行する処理の登録口。route.ts は Next.js の after を渡す。 */
export type ScheduleAfterResponse = (task: () => Promise<void>) => void;

export type CheckPostOptions = {
  /** 証跡の書き込み（Sprint 8）。未指定なら書かない（DB 未設定時は route.ts が渡さない）。 */
  readonly writeEvidence?: WriteEvidence;
  /** 応答後の実行方法。未指定なら待たずに起動するだけ（テスト用）。 */
  readonly schedule?: ScheduleAfterResponse;
  /** EVIDENCE_LOG を読む環境変数（既定は process.env）。 */
  readonly env?: DbEnv;
};

const fireAndForget: ScheduleAfterResponse = (task) => {
  void task();
};

export const handleCheckPost = async (
  req: Request,
  runCheck: RunCheck,
  options: CheckPostOptions = {},
): Promise<Response> => {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const lat = Number((body as { lat?: unknown })?.lat);
  const lng = Number((body as { lng?: unknown })?.lng);
  if (!isValidLatLng({ lat, lng })) {
    return NextResponse.json({ error: "invalid lat/lng" }, { status: 400 });
  }
  const ctx = parseFlightContext((body as { ctx?: unknown })?.ctx);
  const result = await runCheck({ lat, lng }, ctx);

  // 証跡の書き込みは応答を待たせない。失敗しても応答の本文・状態コードは変えない。
  const write = options.writeEvidence;
  if (write && isEvidenceLogEnabled(options.env ?? process.env)) {
    try {
      (options.schedule ?? fireAndForget)(() => runEvidenceWriteSafely(write, result, { lat, lng }));
    } catch (e) {
      console.error(`[evidence_log] schedule failed: ${e instanceof Error ? e.name : "Error"}`);
    }
  }
  return NextResponse.json(result);
};

// 判定結果に含まれる反映済み改正（重複除去・施行日順）。
const collectAmendments = (result: RegulationCheckResult): readonly AmendmentRef[] => {
  const ids = new Set(result.regulations.flatMap((r) => r.amendments.map((a) => a.id)));
  return ALL_AMENDMENTS.filter((a) => ids.has(a.id));
};

// 既存 /api/check を壊さず、診断は /api/diagnose に分離する（spec §10-1 推奨）。
//
// 入力: { lat, lng, droneWeightG?, flags?, plannedDate?, accessControl?, thirdPartyOverflight?,
//        pilotPermits?, purpose? }
//   - pilotPermits・purpose（Sprint 11d B2）は地点判定と判定（verdict）に当てる。手続きの一覧は消さない。
//   - flags はユーザーが選んだ飛行方法フラグ（夜間・目視外・30m・催し・危険物・投下・150m）と、
//     ユーザー指定（プリセットの curated 値を含む）の空域フラグ。
//   - 空域フラグ（DID・空港）はサーバ側で信号機判定から自動導出して合流する。
//     エンジンの DID 判定が「該当」「非該当」のときは、ユーザー指定の airspace_did を使わない（Sprint 7）。
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

export const handleDiagnosePost = async (req: Request, runCheck: RunCheck): Promise<Response> => {
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
  // ユーザーが地理院地図等で「DID 非該当」を確認済みと明示した場合のみ true。
  const didConfirmedNotApplicable = obj["didConfirmedNotApplicable"] === true;

  // 許可・目的（Sprint 11d B2）。機体重量と合わせて地点判定と判定（verdict）に当てる。
  // status は元の判定（許可を当てる前）なので、空域フラグ・DID の三値・飛行禁止法の手続きは許可で消えない。
  const permitCtx = parseFlightContext({
    pilotPermits: obj["pilotPermits"],
    purpose: obj["purpose"],
  });
  const ctx: FlightContext | undefined =
    droneWeightG !== undefined || permitCtx !== undefined
      ? { ...(droneWeightG !== undefined ? { droneWeightG } : {}), ...(permitCtx ?? {}) }
      : undefined;

  // 地点判定を実行し、空域フラグ（DID の該当、空港等周辺の該当・該当の可能性）を自動導出してユーザー入力に合流。
  const checkResult = await runCheck({ lat, lng }, ctx);
  const airspaceFlags = extractAirspaceFlagsFromRegulations(checkResult.regulations);
  // DID 該当の三値（該当／非該当／未確認）。データ未整備は「未確認」のまま診断へ渡す。
  // 自動判定が「未確認」のときに限り、ユーザーの「非該当を確認済み」を採用する。
  const autoDidStatus: AirspaceDeterminationStatus = deriveDidStatusFromRegulations(
    checkResult.regulations,
  );
  const didStatusInput: AirspaceDeterminationStatus =
    autoDidStatus === "unverified" && didConfirmedNotApplicable ? "not_applicable" : autoDidStatus;
  // 飛行方法フラグ ＋ 判定由来の空域フラグを合流した最終フラグ集合（重複排除）。
  // エンジンの DID 判定が確定（該当・非該当）しているときは、ユーザー指定の airspace_did を使わない。
  const mergedFlags: readonly SpecificFlightFlag[] = mergeAirspaceFlags({
    derivedFlags: airspaceFlags,
    userFlags,
    autoDidStatus,
  });
  const didDetail = deriveDidDetailFromRegulations(checkResult.regulations);
  // 小型無人機等飛行禁止法の周辺地域（red／yellow）なら同意＋事前通報の手続きを加える。
  const smallDroneLawTriggered = isSmallDroneLawTriggered(checkResult.regulations);
  const datasets = collectDatasets(checkResult.regulations);

  const diagnosis: ApplicationDiagnosis = deriveDiagnosis({
    flags: mergedFlags,
    droneWeightG,
    plannedDate,
    accessControl,
    thirdPartyOverflight,
    didStatus: didStatusInput,
    // 自動判定が未確認でユーザーが非該当を確認した場合は、自動判定の詳細（no_data）を付けない。
    ...(didDetail !== undefined && didStatusInput === autoDidStatus ? { didDetail } : {}),
    smallDroneLawTriggered,
    ...(bvlosWithObserver !== undefined ? { bvlosWithObserver } : {}),
  });

  // 判定（4 段。Sprint 11d）：地点の規制と飛行の条件（方法・空域）の両方から求める。
  const verdict: FlightVerdict = deriveFlightVerdict({
    regulations: checkResult.regulations,
    flags: mergedFlags,
    ctx,
    plannedDate,
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
    // 診断と同じ DID の三値（未確認なら「飛行の種類」を要確認にする）
    didStatus: diagnosis.didStatus,
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
    didStatus: diagnosis.didStatus,
    datasets,
    // 判定に当てた許可・目的（Sprint 11d C2。新しいキーで証跡に入れる）
    permits: verdict.permits,
    ...(verdict.purpose !== undefined ? { purpose: verdict.purpose } : {}),
  });

  return NextResponse.json({
    ...diagnosis,
    verdict,
    // 機体重量（Sprint 11e：100g 未満のときカテゴリーの表示を「対象外（模型航空機）」にするため。証跡には入れない）
    ...(droneWeightG !== undefined ? { droneWeightG } : {}),
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
    // 地点判定（自動）の DID 三値。UI はユーザー確認前の状態として表示する。
    autoDidStatus,
    // どのフラグ集合（空域＋方法）で診断したか（マニュアル骨子・PDF の生成根拠）。
    flags: mergedFlags,
    // 判定に使ったデータセットと反映済みの改正（画面・申請支援 PDF に表示）。
    datasets,
    amendments: collectAmendments(checkResult),
    smallDroneLawTriggered,
  });
};
