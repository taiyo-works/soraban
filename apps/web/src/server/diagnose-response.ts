// /api/diagnose の応答の整形（Sprint 18-1 A16）。
// 応答の `prefill`（許可・承認の申請フォームの値）は、申請支援のフラグ APPLICATION_SUPPORT_ENABLED が無効なら取り除く。
// handleDiagnosePost（server/handlers.ts）とその応答の基準のテストは変えず、ルートの層でだけ取り除く。
import { isApplicationSupportEnabled } from "@/lib/boundary";

/** 応答の JSON から prefill を除く。状態コード・ヘッダーは保つ（本文が変わるので content-length は外す）。JSON でない・失敗の応答はそのまま返す。 */
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
  if (body === null || typeof body !== "object" || Array.isArray(body) || !("prefill" in body)) return res;
  const { prefill: _removed, ...rest } = body as Record<string, unknown>;
  void _removed;
  const headers = new Headers(res.headers);
  headers.delete("content-length");
  return new Response(JSON.stringify(rest), { status: res.status, statusText: res.statusText, headers });
};

/** フラグが有効なら応答をそのまま、無効なら prefill を除いて返す。 */
export const applyApplicationSupportFlag = async (
  res: Response,
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<Response> => (isApplicationSupportEnabled(env) ? res : stripPrefillFromResponse(res));
