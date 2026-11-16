// /api/diagnose の応答の整形（Sprint 18-1 A16）。
// 応答の `prefill`（許可・承認の申請フォームの値）は、申請支援のフラグ APPLICATION_SUPPORT_ENABLED が無効なら取り除く。
// handleDiagnosePost（server/handlers.ts）とその応答の基準のテストは変えず、ルートの層でだけ取り除く。
import { isApplicationSupportEnabled } from "@/lib/boundary";

export const APPLICATION_SUPPORT_KEYS = ["prefill", "deadlines", "categoryNote"] as const;

/**
 * オブジェクトから申請支援の項目（APPLICATION_SUPPORT_KEYS）を除いた浅い写しを返す（元は変えない）。
 * /api/diagnose の応答（stripPrefillFromResponse）と、運航管理の判定スナップショットの保存・読み出し（server/ops/plans.ts。Sprint 18-2 L8）で共通に使う。
 */
export const omitApplicationSupport = <T extends object>(o: T): T => {
  const rest = { ...o } as Record<string, unknown>;
  for (const k of APPLICATION_SUPPORT_KEYS) delete rest[k];
  return rest as T;
};

/** 応答の JSON から申請支援の項目（APPLICATION_SUPPORT_KEYS）を除く。状態コード・ヘッダーは保つ（本文が変わるので content-length は外す）。JSON でない・失敗の応答はそのまま返す。 */
export const stripPrefillFromResponse = async (res: Response): Promise<Response> => {
  if (!res.ok) return res;
  const type = res.headers.get("content-type") ?? "";
  if (!type.includes("application/json")) return res;
  let body: unknown;
  try {
    body = await res.clone().json();
  } catch {
    return res;
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) return res;
  // 申請支援の出力だけを除く：prefill（申請フォームの値）、deadlines（申請の提出期限の逆算）、categoryNote（申請が必要という診断の説明）。
  // 結論（verdict）・手続きの一覧（procedures）・category（判定履歴の保存値）・evidenceId は残す。
  const rest = omitApplicationSupport(body as Record<string, unknown>);
  const headers = new Headers(res.headers);
  headers.delete("content-length");
  return new Response(JSON.stringify(rest), { status: res.status, statusText: res.statusText, headers });
};

/** フラグが有効なら応答をそのまま、無効なら prefill を除いて返す。 */
export const applyApplicationSupportFlag = async (
  res: Response,
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<Response> => (isApplicationSupportEnabled(env) ? res : stripPrefillFromResponse(res));
