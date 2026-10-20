import type { LatLng } from "@soraban/geo";
import { DIAGNOSE_TIMEOUT_MS } from "./verdict-display";
import type {
  AirspaceDeterminationStatus,
  AmendmentRef,
  ApplicationDiagnosis,
  DatasetRef,
  FlightVerdict,
  PrefillField,
  SpecificFlightFlag,
} from "@soraban/regulations";

// /api/diagnose のレスポンス。診断本体 + プリフィル表 + 証跡メタ + 判定由来の空域フラグ。
export type DiagnoseResponse = ApplicationDiagnosis & {
  /** 判定（4 段。地点の規制と飛行の条件の両方から。Sprint 11d）。画面の結論に使う。 */
  readonly verdict?: FlightVerdict;
  /** DIPS／DRS 入力プリフィル表（座標・住所・飛行方法・機体重量 等の実値） */
  readonly prefill: readonly PrefillField[];
  /** 申請支援診断（入力条件＋導出結果）を含む決定論的証跡 ID */
  readonly evidenceId: string;
  /** ベースとなる地点規制判定の証跡 ID */
  readonly checkEvidenceId?: string;
  readonly engineVersion: string;
  readonly checkedAt: string;
  readonly resolvedAddress?: string;
  readonly muniCode?: string;
  /** 判定地点の座標（PDF・プリフィル表の参照用） */
  readonly lat: number;
  readonly lng: number;
  readonly derivedAirspaceFlags: readonly SpecificFlightFlag[];
  /** 地点判定（自動）による DID 該当の三値。 */
  readonly autoDidStatus: AirspaceDeterminationStatus;
  /** 診断に使った最終フラグ集合（空域＋方法）。マニュアル骨子の生成根拠。 */
  readonly flags: readonly SpecificFlightFlag[];
  /** 判定に使ったデータセット（名称・基準年・確認日）。Sprint 7 より前の応答には無い。 */
  readonly datasets?: readonly DatasetRef[];
  /** 反映済みの法令改正。 */
  readonly amendments?: readonly AmendmentRef[];
  /** 小型無人機等飛行禁止法の周辺地域（red／yellow）に該当するか。 */
  readonly smallDroneLawTriggered?: boolean;
};

export type DiagnoseInput = {
  readonly droneWeightG?: number;
  readonly flags: readonly SpecificFlightFlag[];
  readonly plannedDate?: string;
  readonly accessControl?: boolean;
  readonly thirdPartyOverflight?: boolean;
  readonly bvlosWithObserver?: boolean;
  /** DID 非該当をユーザーが確認済み（自動判定が未確認のときのみ有効）。 */
  readonly didConfirmedNotApplicable?: boolean;
  /** 取得済みの許可・同意（Sprint 11d B2）。判定に当てる。手続きの一覧は消さない。 */
  readonly pilotPermits?: readonly string[];
  /** 運航の目的（通常運航は送らない）。 */
  readonly purpose?: string;
};

// 新規 /api/diagnose を叩く。既存 checkLocation（/api/check）とは独立。
export const diagnoseLocation = async (
  loc: LatLng,
  input: DiagnoseInput,
  signal?: AbortSignal,
): Promise<DiagnoseResponse> => {
  // 応答しないまま「判定中」が続かないよう、時間の上限で打ち切る（TimeoutError として呼び出し元で失敗扱い）。
  const timeout = AbortSignal.timeout(DIAGNOSE_TIMEOUT_MS);
  const res = await fetch("/api/diagnose", {
    method: "POST",
    headers: { "content-type": "application/json" },
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    body: JSON.stringify({
      lat: loc.lat,
      lng: loc.lng,
      droneWeightG: input.droneWeightG,
      flags: input.flags,
      plannedDate: input.plannedDate,
      accessControl: input.accessControl,
      thirdPartyOverflight: input.thirdPartyOverflight,
      bvlosWithObserver: input.bvlosWithObserver,
      didConfirmedNotApplicable: input.didConfirmedNotApplicable === true ? true : undefined,
      pilotPermits: input.pilotPermits && input.pilotPermits.length > 0 ? input.pilotPermits : undefined,
      purpose: input.purpose,
    }),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? `diagnose failed (${res.status})`);
  }
  return (await res.json()) as DiagnoseResponse;
};
