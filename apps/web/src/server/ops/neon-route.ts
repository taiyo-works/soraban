// /api/auth/[...path]（Neon Auth の中継）の処理本体（Sprint 10 設計 A）。
// OPS_ENABLED=1 かつ AUTH_PROVIDER=neon のときだけ SDK の handler に渡す。それ以外は 404。
import { getOpsAvailability, type OpsEnv } from "./availability";
import { getNeonAuth } from "./auth/neon";
import { json } from "./http";

export const handleNeonAuth = async (
  method: "GET" | "POST",
  req: Request,
  ctx: { params: Promise<{ path: string[] }> },
  env: OpsEnv = process.env,
): Promise<Response> => {
  const a = getOpsAvailability(env);
  if (a.state === "misconfigured") return json(503, { error: "ops_unavailable", reason: a.reason });
  if (a.state !== "enabled" || a.provider !== "neon") return json(404, { error: "not_found" });
  const h = (await getNeonAuth(env)).handler();
  return method === "GET" ? h.GET(req, ctx) : h.POST(req, ctx);
};
