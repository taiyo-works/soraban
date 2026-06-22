import type { LatLng } from "@soraban/geo";
import type {
  ApplicationDiagnosis,
  PrefillField,
  SpecificFlightFlag,
} from "@soraban/regulations";

// /api/diagnose のレスポンス。診断本体 + プリフィル表 + 証跡メタ + 判定由来の空域フラグ。
export type DiagnoseResponse = ApplicationDiagnosis & {
  /** DIPS／DRS 入力プリフィル表（座標・住所・飛行方法・機体重量 等の実値） */
  readonly prefill: readonly PrefillField[];
  readonly evidenceId: string;
  readonly engineVersion: string;
  readonly checkedAt: string;
  readonly resolvedAddress?: string;
  readonly muniCode?: string;
  /** 判定地点の座標（PDF・プリフィル表の参照用） */
  readonly lat: number;
  readonly lng: number;
  readonly derivedAirspaceFlags: readonly SpecificFlightFlag[];
  /** 診断に使った最終フラグ集合（空域＋方法）。マニュアル骨子の生成根拠。 */
  readonly flags: readonly SpecificFlightFlag[];
};

export type DiagnoseInput = {
  readonly droneWeightG?: number;
  readonly flags: readonly SpecificFlightFlag[];
  readonly plannedDate?: string;
  readonly accessControl?: boolean;
  readonly thirdPartyOverflight?: boolean;
  readonly bvlosWithObserver?: boolean;
};

// 新規 /api/diagnose を叩く。既存 checkLocation（/api/check）とは独立。
export const diagnoseLocation = async (
  loc: LatLng,
  input: DiagnoseInput,
): Promise<DiagnoseResponse> => {
  const res = await fetch("/api/diagnose", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      lat: loc.lat,
      lng: loc.lng,
      droneWeightG: input.droneWeightG,
      flags: input.flags,
      plannedDate: input.plannedDate,
      accessControl: input.accessControl,
      thirdPartyOverflight: input.thirdPartyOverflight,
      bvlosWithObserver: input.bvlosWithObserver,
    }),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? `diagnose failed (${res.status})`);
  }
  return (await res.json()) as DiagnoseResponse;
};
