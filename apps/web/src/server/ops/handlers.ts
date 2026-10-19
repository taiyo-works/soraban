// 運航管理の API の処理本体（Sprint 10 設計 F）。route.ts から呼ぶ。
import { availabilityResponse, isSameOrigin, json, opsHandler } from "./http";
import { getOpsAvailability, type OpsEnv } from "./availability";
import { parseTestSignIn, signTestAuthCookie, TEST_AUTH_COOKIE, TEST_AUTH_MAX_AGE } from "./auth/test-auth";
import * as svc from "./service";

const includeVoided = (req: Request): boolean => new URL(req.url).searchParams.get("includeVoided") === "1";

export const meGet = opsHandler("GET /api/ops/me", async ({ ctx }) => json(200, await svc.getMe(ctx)));

// ---- 機体 ----
export const aircraftList = opsHandler("GET /api/ops/aircraft", async ({ ctx, req }) =>
  json(200, { aircraft: await svc.listAircraft(ctx, includeVoided(req)) }),
);
export const aircraftCreate = opsHandler(
  "POST /api/ops/aircraft",
  async ({ ctx, body }) => json(201, await svc.createAircraft(ctx, await body())),
  { mutating: true },
);
export const aircraftGet = opsHandler("GET /api/ops/aircraft/[id]", async ({ ctx, params }) =>
  json(200, await svc.getAircraft(ctx, params["id"] ?? "")),
);
export const aircraftUpdate = opsHandler(
  "PATCH /api/ops/aircraft/[id]",
  async ({ ctx, params, body }) => json(200, await svc.updateAircraft(ctx, params["id"] ?? "", await body())),
  { mutating: true },
);
export const aircraftVoid = opsHandler(
  "POST /api/ops/aircraft/[id]/void",
  async ({ ctx, params, body }) => json(200, await svc.voidAircraft(ctx, params["id"] ?? "", await body())),
  { mutating: true },
);
export const aircraftVersions = opsHandler("GET /api/ops/aircraft/[id]/versions", async ({ ctx, params }) =>
  json(200, { versions: await svc.listAircraftVersions(ctx, params["id"] ?? "") }),
);

// ---- 操縦者 ----
export const pilotList = opsHandler("GET /api/ops/pilots", async ({ ctx, req }) =>
  json(200, { pilots: await svc.listPilots(ctx, includeVoided(req)) }),
);
export const pilotCreate = opsHandler(
  "POST /api/ops/pilots",
  async ({ ctx, body }) => json(201, await svc.createPilot(ctx, await body())),
  { mutating: true },
);
export const pilotGet = opsHandler("GET /api/ops/pilots/[id]", async ({ ctx, params }) =>
  json(200, await svc.getPilot(ctx, params["id"] ?? "")),
);
export const pilotUpdate = opsHandler(
  "PATCH /api/ops/pilots/[id]",
  async ({ ctx, params, body }) => json(200, await svc.updatePilot(ctx, params["id"] ?? "", await body())),
  { mutating: true },
);
export const pilotVoid = opsHandler(
  "POST /api/ops/pilots/[id]/void",
  async ({ ctx, params, body }) => json(200, await svc.voidPilot(ctx, params["id"] ?? "", await body())),
  { mutating: true },
);
export const pilotVersions = opsHandler("GET /api/ops/pilots/[id]/versions", async ({ ctx, params }) =>
  json(200, { versions: await svc.listPilotVersions(ctx, params["id"] ?? "") }),
);

// ---- 利用者 ----
export const memberList = opsHandler("GET /api/ops/members", async ({ ctx }) =>
  json(200, { members: await svc.listMembers(ctx) }),
);
export const memberInvite = opsHandler(
  "POST /api/ops/members",
  async ({ ctx, body }) => json(201, await svc.inviteMember(ctx, await body())),
  { mutating: true },
);
export const memberGet = opsHandler("GET /api/ops/members/[id]", async ({ ctx, params }) =>
  json(200, await svc.getMemberDto(ctx, params["id"] ?? "")),
);
export const memberUpdate = opsHandler(
  "PATCH /api/ops/members/[id]",
  async ({ ctx, params, body }) => json(200, await svc.updateMember(ctx, params["id"] ?? "", await body())),
  { mutating: true },
);
export const memberVersions = opsHandler("GET /api/ops/members/[id]/versions", async ({ ctx, params }) =>
  json(200, { versions: await svc.listMemberVersions(ctx, params["id"] ?? "") }),
);

// ---- テスト用の本人確認（AUTH_PROVIDER=test のときだけ。本番では 404） ----

/** テスト用ログインが使えるか。使えなければ 404（または 503）の応答を返す。 */
const testAuthUnavailable = (env: OpsEnv): Response | null => {
  const r = availabilityResponse(env);
  if (r) return r.status === 404 ? r : json(404, { error: "not_found" });
  const a = getOpsAvailability(env);
  if (a.state !== "enabled" || a.provider !== "test") return json(404, { error: "not_found" });
  return null;
};

export const handleTestSignIn = async (req: Request, env: OpsEnv = process.env): Promise<Response> => {
  const unavailable = testAuthUnavailable(env);
  if (unavailable) return unavailable;
  // テスト用でも、他サイトからのログイン（ログイン CSRF）は拒否する。
  if (!isSameOrigin(req)) return json(403, { error: "forbidden_origin" });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "invalid_json" });
  }
  const input = parseTestSignIn(body);
  if (!input) return json(400, { error: "invalid_input" });
  const value = signTestAuthCookie(input, env["AUTH_TEST_SECRET"]!.trim());
  const res = json(200, { ok: true });
  const secure = new URL(req.url).protocol === "https:";
  res.headers.append(
    "set-cookie",
    `${TEST_AUTH_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${TEST_AUTH_MAX_AGE}${secure ? "; Secure" : ""}`,
  );
  return res;
};

export const handleTestSignOut = async (req: Request, env: OpsEnv = process.env): Promise<Response> => {
  const unavailable = testAuthUnavailable(env);
  if (unavailable) return unavailable;
  if (!isSameOrigin(req)) return json(403, { error: "forbidden_origin" });
  const res = json(200, { ok: true });
  res.headers.append("set-cookie", `${TEST_AUTH_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  return res;
};
