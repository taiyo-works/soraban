// 通報ゲートウェイの設定（Sprint 12b 設計 B）。純粋関数。
// 環境変数 DIPS_REPORT_ADAPTER ∈ manual（既定）・mock。api と未知の値は設定の誤りとして 503 adapter_unavailable
// （手動へ自動で落とさない。二重通報を避けるため）。API アダプターは 12b では作らない。
// mock は VERCEL_ENV が production または preview のとき拒否する。E2E は next start で動き NODE_ENV が production になるため、
// NODE_ENV では判断しない。
export type DipsEnv = Readonly<Record<string, string | undefined>>;

export type DipsConfigErrorReason =
  /** api が指定された。API アダプターは未実装。 */
  | "api_not_implemented"
  /** manual・mock 以外の値。 */
  | "unknown_adapter"
  /** 本番・プレビューで mock が指定された。 */
  | "mock_forbidden_on_vercel";

export type DipsAdapterConfig =
  | { readonly ok: true; readonly adapter: "manual" | "mock" }
  | { readonly ok: false; readonly reason: DipsConfigErrorReason };

/** 設定の誤りの説明（理由コードだけを示す。値は示さない）。 */
export const DIPS_CONFIG_ERROR_MESSAGE: Readonly<Record<DipsConfigErrorReason, string>> = {
  api_not_implemented: "API アダプターは未実装のため使えません。DIPS_REPORT_ADAPTER を確かめてください。",
  unknown_adapter: "DIPS_REPORT_ADAPTER の値が正しくありません。",
  mock_forbidden_on_vercel: "模擬アダプターは本番・プレビューでは使えません。",
};

const nonEmpty = (v: string | undefined): string | undefined => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined);

export const resolveDipsAdapterConfig = (env: DipsEnv = {}): DipsAdapterConfig => {
  const raw = nonEmpty(env["DIPS_REPORT_ADAPTER"])?.toLowerCase();
  if (raw === undefined || raw === "manual") return { ok: true, adapter: "manual" };
  if (raw === "mock") {
    const vercel = nonEmpty(env["VERCEL_ENV"])?.toLowerCase();
    if (vercel === "production" || vercel === "preview") return { ok: false, reason: "mock_forbidden_on_vercel" };
    return { ok: true, adapter: "mock" };
  }
  if (raw === "api") return { ok: false, reason: "api_not_implemented" };
  return { ok: false, reason: "unknown_adapter" };
};
