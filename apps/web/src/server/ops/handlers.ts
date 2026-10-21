// 運航管理の API の処理本体（Sprint 10 設計 F）。route.ts から呼ぶ。
import { availabilityResponse, isSameOrigin, json, opsHandler } from "./http";
import { getOpsAvailability, type OpsEnv } from "./availability";
import { parseTestSignIn, signTestAuthCookie, TEST_AUTH_COOKIE, TEST_AUTH_MAX_AGE } from "./auth/test-auth";
import * as places from "./places";
import * as plans from "./plans";
import * as rec from "./records";
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

// ---- 飛行記録・日常点検記録（Sprint 11） ----
// 作成は 201。同じ clientRequestId の作成が既にあれば、新しい記録を作らずに既存の記録を 200 で返す。
// 応答の warnings は保存を止めない警告（当日の日常点検がない 等）。
const saved = <T>(r: rec.SaveResult<T>, createdStatus = 201): Response =>
  json(r.created ? createdStatus : 200, { ...r.record, warnings: r.warnings });

export const flightList = opsHandler("GET /api/ops/flights", async ({ ctx, req }) =>
  json(200, { flights: await rec.listFlights(ctx, rec.parseRecordFilter(new URL(req.url).searchParams)) }),
);
export const flightCreate = opsHandler(
  "POST /api/ops/flights",
  async ({ ctx, body }) => saved(await rec.createFlight(ctx, await body())),
  { mutating: true },
);
export const flightGet = opsHandler("GET /api/ops/flights/[id]", async ({ ctx, params }) =>
  json(200, await rec.getFlight(ctx, params["id"] ?? "")),
);
export const flightUpdate = opsHandler(
  "PATCH /api/ops/flights/[id]",
  async ({ ctx, params, body }) => saved(await rec.updateFlight(ctx, params["id"] ?? "", await body())),
  { mutating: true },
);
export const flightVoid = opsHandler(
  "POST /api/ops/flights/[id]/void",
  async ({ ctx, params, body }) => json(200, await rec.voidFlight(ctx, params["id"] ?? "", await body())),
  { mutating: true },
);
export const flightVersions = opsHandler("GET /api/ops/flights/[id]/versions", async ({ ctx, params }) =>
  json(200, { versions: await rec.listFlightVersions(ctx, params["id"] ?? "") }),
);

export const inspectionList = opsHandler("GET /api/ops/inspections", async ({ ctx, req }) =>
  json(200, { inspections: await rec.listInspections(ctx, rec.parseRecordFilter(new URL(req.url).searchParams)) }),
);
export const inspectionCreate = opsHandler(
  "POST /api/ops/inspections",
  async ({ ctx, body }) => saved(await rec.createInspection(ctx, await body())),
  { mutating: true },
);
export const inspectionGet = opsHandler("GET /api/ops/inspections/[id]", async ({ ctx, params }) =>
  json(200, await rec.getInspection(ctx, params["id"] ?? "")),
);
export const inspectionUpdate = opsHandler(
  "PATCH /api/ops/inspections/[id]",
  async ({ ctx, params, body }) => json(200, await rec.updateInspection(ctx, params["id"] ?? "", await body())),
  { mutating: true },
);
export const inspectionVoid = opsHandler(
  "POST /api/ops/inspections/[id]/void",
  async ({ ctx, params, body }) => json(200, await rec.voidInspection(ctx, params["id"] ?? "", await body())),
  { mutating: true },
);
export const inspectionVersions = opsHandler("GET /api/ops/inspections/[id]/versions", async ({ ctx, params }) =>
  json(200, { versions: await rec.listInspectionVersions(ctx, params["id"] ?? "") }),
);

// ---- 飛行計画・判定スナップショット・運航管理者の確認（Sprint 12a） ----
// 作成は 201。同じ clientRequestId の作成が既にあれば、新しい計画を作らずに既存の計画を 200 で返す。
// 保存時の判定はサーバーが実行する（本文の verdict・result・snapshot・evidenceId などは読まない）。失敗・時間切れは 503 judgement_failed。
const savedPlan = (r: rec.SaveResult<plans.PlanDto>): Response => json(r.created ? 201 : 200, r.record);

export const planList = opsHandler("GET /api/ops/plans", async ({ ctx, req }) =>
  json(200, { plans: await plans.listPlans(ctx, plans.parsePlanFilter(new URL(req.url).searchParams)) }),
);
export const planCreate = opsHandler(
  "POST /api/ops/plans",
  async ({ ctx, body }) => savedPlan(await plans.createPlan(ctx, await body())),
  { mutating: true },
);
export const planGet = opsHandler("GET /api/ops/plans/[id]", async ({ ctx, params }) =>
  json(200, await plans.getPlan(ctx, params["id"] ?? "")),
);
export const planUpdate = opsHandler(
  "PATCH /api/ops/plans/[id]",
  async ({ ctx, params, body }) => json(200, (await plans.updatePlan(ctx, params["id"] ?? "", await body())).record),
  { mutating: true },
);
export const planVoid = opsHandler(
  "POST /api/ops/plans/[id]/void",
  async ({ ctx, params, body }) => json(200, await plans.voidPlan(ctx, params["id"] ?? "", await body())),
  { mutating: true },
);
export const planRequestConfirmation = opsHandler(
  "POST /api/ops/plans/[id]/request-confirmation",
  async ({ ctx, params, body }) => json(200, await plans.requestConfirmation(ctx, params["id"] ?? "", await body())),
  { mutating: true },
);
export const planRejudge = opsHandler(
  "POST /api/ops/plans/[id]/rejudge",
  async ({ ctx, params, body }) => json(200, await plans.rejudgePlan(ctx, params["id"] ?? "", await body())),
  { mutating: true },
);
export const planConfirmations = opsHandler("GET /api/ops/plans/[id]/confirmations", async ({ ctx, params }) =>
  json(200, { confirmations: await plans.listPlanConfirmations(ctx, params["id"] ?? "") }),
);
export const planConfirm = opsHandler(
  "POST /api/ops/plans/[id]/confirmations",
  async ({ ctx, params, body }) => json(201, await plans.confirmPlan(ctx, params["id"] ?? "", await body())),
  { mutating: true },
);
export const planSnapshots = opsHandler("GET /api/ops/plans/[id]/snapshots", async ({ ctx, params }) =>
  json(200, { snapshots: await plans.listSnapshots(ctx, params["id"] ?? "") }),
);
export const planSnapshotGet = opsHandler("GET /api/ops/plans/[id]/snapshots/[sid]", async ({ ctx, params }) =>
  json(200, await plans.getSnapshot(ctx, params["id"] ?? "", params["sid"] ?? "")),
);
export const planVersions = opsHandler("GET /api/ops/plans/[id]/versions", async ({ ctx, params }) =>
  json(200, { versions: await plans.listPlanVersions(ctx, params["id"] ?? "") }),
);

// ---- よく使う地点（Sprint 12a） ----
export const placeList = opsHandler("GET /api/ops/places", async ({ ctx, req }) =>
  json(200, { places: await places.listPlaces(ctx, includeVoided(req)) }),
);
export const placeCreate = opsHandler(
  "POST /api/ops/places",
  async ({ ctx, body }) => json(201, await places.createPlace(ctx, await body())),
  { mutating: true },
);
export const placeGet = opsHandler("GET /api/ops/places/[id]", async ({ ctx, params }) =>
  json(200, await places.getPlace(ctx, params["id"] ?? "")),
);
export const placeUpdate = opsHandler(
  "PATCH /api/ops/places/[id]",
  async ({ ctx, params, body }) => json(200, await places.updatePlace(ctx, params["id"] ?? "", await body())),
  { mutating: true },
);
export const placeVoid = opsHandler(
  "POST /api/ops/places/[id]/void",
  async ({ ctx, params, body }) => json(200, await places.voidPlace(ctx, params["id"] ?? "", await body())),
  { mutating: true },
);
export const placeVersions = opsHandler("GET /api/ops/places/[id]/versions", async ({ ctx, params }) =>
  json(200, { versions: await places.listPlaceVersions(ctx, params["id"] ?? "") }),
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
