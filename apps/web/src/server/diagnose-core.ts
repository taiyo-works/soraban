// 申請支援の判定（/api/diagnose）の本体（Sprint 12a 設計 A1）。
// リクエストの解析（handlers.ts の handleDiagnosePost）と判定の組み立てを分け、組み立てをここに置く。
// サーバーの中（計画の保存。ops/plans.ts）からも同じ判定を呼べるようにするため。
// /api/diagnose の応答の JSON は、切り出す前と 1 バイトも変えない（diagnose-core.test.ts が基準と比べる）。
import type { LatLng } from "@soraban/geo";
import {
  ALL_AMENDMENTS,
  buildPrefillFields,
  deriveDiagnosis,
  deriveDidDetailFromRegulations,
  deriveDidStatusFromRegulations,
  deriveFlightVerdict,
  extractAirspaceFlagsFromRegulations,
  isSmallDroneLawTriggered,
  mergeAirspaceFlags,
  type AirspaceDeterminationStatus,
  type AmendmentRef,
  type ApplicationDiagnosis,
  type FlightContext,
  type FlightVerdict,
  type PrefillField,
  type RegulationCheckResult,
  type SpecificFlightFlag,
} from "@soraban/regulations";
import type { DiagnoseResponse } from "@/lib/diagnose";
import { collectDatasets, computeDiagnosisEvidenceId } from "./check-core";

/**
 * 地点判定の実行口。now は判定時刻（省略すると現在時刻）。テストと計画の保存で時計を固定するために渡せる。
 * now が無いときは第 3 引数を渡さない（従来の呼び出しと同じ）。
 */
export type RunCheck = (loc: LatLng, ctx?: FlightContext, now?: () => Date) => Promise<RegulationCheckResult>;

/** 判定の入力（信頼境界で正規化した後の形）。 */
export type DiagnosisRunInput = {
  readonly lat: number;
  readonly lng: number;
  readonly droneWeightG?: number;
  readonly flags: readonly SpecificFlightFlag[];
  readonly plannedDate?: string;
  readonly accessControl?: boolean;
  readonly thirdPartyOverflight?: boolean;
  readonly bvlosWithObserver?: boolean;
  /** ユーザーが「DID 非該当」を確認済みと明示した場合のみ true（自動判定が未確認のときだけ採用）。 */
  readonly didConfirmedNotApplicable: boolean;
  /** 許可・同意（Sprint 11d B2）。空配列は渡さない。 */
  readonly pilotPermits?: readonly string[];
  readonly purpose?: string;
};

/** runDiagnosis の結果。response は /api/diagnose の応答そのもの。check は元の地点判定（証跡の保存に使う）。 */
export type DiagnosisRun = {
  readonly response: DiagnoseResponse;
  readonly check: RegulationCheckResult;
};

// 判定に結びつく反映済み改正（重複除去・施行日順）。
const collectAmendments = (result: RegulationCheckResult): readonly AmendmentRef[] => {
  const ids = new Set(result.regulations.flatMap((r) => r.amendments.map((a) => a.id)));
  return ALL_AMENDMENTS.filter((a) => ids.has(a.id));
};

export const runDiagnosis = async (
  input: DiagnosisRunInput,
  runCheck: RunCheck,
  now?: () => Date,
): Promise<DiagnosisRun> => {
  const { lat, lng, droneWeightG, plannedDate, accessControl, thirdPartyOverflight, bvlosWithObserver } = input;
  const userFlags = input.flags;

  // 許可・目的（Sprint 11d B2）。機体重量と合わせて地点判定と判定（verdict）に当てる。
  // status は元の判定（許可を当てる前）なので、空域フラグ・DID の三値・飛行禁止法の手続きは許可で消えない。
  const permitCtx: FlightContext | undefined =
    (input.pilotPermits !== undefined && input.pilotPermits.length > 0) || input.purpose !== undefined
      ? {
          ...(input.pilotPermits !== undefined && input.pilotPermits.length > 0
            ? { pilotPermits: [...input.pilotPermits] }
            : {}),
          ...(input.purpose !== undefined ? { purpose: input.purpose } : {}),
        }
      : undefined;
  const ctx: FlightContext | undefined =
    droneWeightG !== undefined || permitCtx !== undefined
      ? { ...(droneWeightG !== undefined ? { droneWeightG } : {}), ...(permitCtx ?? {}) }
      : undefined;

  // 地点判定を実行し、空域フラグ（DID の該当、空港等周辺の該当・該当の可能性）を自動導出してユーザー入力に合流。
  const checkResult = now ? await runCheck({ lat, lng }, ctx, now) : await runCheck({ lat, lng }, ctx);
  const airspaceFlags = extractAirspaceFlagsFromRegulations(checkResult.regulations);
  // DID 該当の三値（該当／非該当／未確認）。データ未整備は「未確認」のまま診断へ渡す。
  // 自動判定が「未確認」のときに限り、ユーザーの「非該当を確認済み」を採用する。
  const autoDidStatus: AirspaceDeterminationStatus = deriveDidStatusFromRegulations(
    checkResult.regulations,
  );
  const didStatusInput: AirspaceDeterminationStatus =
    autoDidStatus === "unverified" && input.didConfirmedNotApplicable ? "not_applicable" : autoDidStatus;
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

  const response = {
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
  };
  return { response, check: checkResult };
};
