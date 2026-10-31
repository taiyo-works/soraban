// 運航管理の API の処理本体（Sprint 10 設計 F）。route.ts から呼ぶ。
import { availabilityResponse, isSameOrigin, json, opsHandler } from "./http";
import { getOpsAvailability, type OpsEnv } from "./availability";
import { parseTestSignIn, signTestAuthCookie, TEST_AUTH_COOKIE, TEST_AUTH_MAX_AGE } from "./auth/test-auth";
import * as permits from "./permits";
import { PERMIT_DECLARATION_NOTE, PERMIT_NO_DIPS_NOTE } from "./permit-logic";
import * as places from "./places";
import * as field from "./field";
import * as incidents from "./incidents";
import * as plans from "./plans";
import * as procedureRecords from "./procedure-records";
import * as rec from "./records";
import * as reports from "./reports";
import * as svc from "./service";
import * as today from "./today";

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

// ---- 通報の記録・手続きの「済み」の記録（Sprint 12b） ----
// そらばんは DIPS に送信しない。記録は利用者の申告（手動）か、開発用の模擬の送信。記録が無いうちは「通報済み」にならない。
// サーバーが決めるもの（指紋・冪等性キー・対応表の版・状態・計画の版・スナップショット・送信元）は本文から読まない。
// 設定（DIPS_REPORT_ADAPTER）が誤りなら 503 adapter_unavailable。

const reportKindParam = (req: Request): reports.PlanReportViewKind => {
  const k = new URL(req.url).searchParams.get("kind");
  if (k === null) return undefined;
  if (k !== "new" && k !== "change" && k !== "cancel") {
    throw new svc.OpsError(400, "invalid_input", { kind: "種別は new・change・cancel のいずれかです" }, { kind: "invalid" });
  }
  return k;
};

export const planReportGet = opsHandler("GET /api/ops/plans/[id]/report", async ({ ctx, params, req }) => {
  const kind = reportKindParam(req);
  return json(200, await reports.getPlanReport(ctx, params["id"] ?? "", kind ? { kind } : {}));
});
export const planReportPreview = opsHandler("POST /api/ops/plans/[id]/report", async ({ ctx, params, body }) =>
  json(200, await reports.previewPlanReport(ctx, params["id"] ?? "", await body())),
);
export const reportCreate = opsHandler(
  "POST /api/ops/plans/[id]/reports",
  async ({ ctx, params, body }) => {
    const r = await reports.createReport(ctx, params["id"] ?? "", await body());
    return json(r.created ? 201 : 200, r);
  },
  { mutating: true },
);
export const reportCorrect = opsHandler(
  "PATCH /api/ops/plans/[id]/reports/[rid]",
  async ({ ctx, params, body }) => json(200, await reports.correctReport(ctx, params["id"] ?? "", params["rid"] ?? "", await body())),
  { mutating: true },
);
export const reportRetract = opsHandler(
  "POST /api/ops/plans/[id]/reports/[rid]/retract",
  async ({ ctx, params, body }) => json(200, await reports.retractReport(ctx, params["id"] ?? "", params["rid"] ?? "", await body())),
  { mutating: true },
);
export const reportResolve = opsHandler(
  "POST /api/ops/plans/[id]/reports/[rid]/resolve",
  async ({ ctx, params, body }) => json(200, await reports.resolveReport(ctx, params["id"] ?? "", params["rid"] ?? "", await body())),
  { mutating: true },
);
export const reportRetry = opsHandler(
  "POST /api/ops/plans/[id]/reports/[rid]/retry",
  async ({ ctx, params, body }) => json(200, await reports.retryReport(ctx, params["id"] ?? "", params["rid"] ?? "", await body())),
  { mutating: true },
);
export const reportVersions = opsHandler("GET /api/ops/plans/[id]/reports/[rid]/versions", async ({ ctx, params }) =>
  json(200, { versions: await reports.listReportVersions(ctx, params["id"] ?? "", params["rid"] ?? "") }),
);
export const reportCopyAudit = opsHandler(
  "POST /api/ops/plans/[id]/reports/audit",
  async ({ ctx, params, body }) => json(201, await reports.recordCopyAudit(ctx, params["id"] ?? "", await body())),
  { mutating: true },
);
export const procedureRecordList = opsHandler("GET /api/ops/plans/[id]/procedure-records", async ({ ctx, params }) =>
  json(200, await procedureRecords.listProcedureRecords(ctx, params["id"] ?? "")),
);
export const procedureRecordCreate = opsHandler(
  "POST /api/ops/plans/[id]/procedure-records",
  async ({ ctx, params, body }) => json(201, await procedureRecords.createProcedureRecord(ctx, params["id"] ?? "", await body())),
  { mutating: true },
);

// ---- 今日・現場モード（Sprint 12c） ----
// 「今日」は一覧の要約の値だけを使う（判定の result 全体は読まない）。現場の記録は DIPS へ送信しない（自分の DB だけ）。
// 離陸は未了事項があっても 201（応答の gaps に未了事項）。同じ clientEventId の再送は 200 で既存の行を返す。
// サーバーが決めるもの（snapshotId・planVersion・gaps・記録者・記録時刻・ハッシュ）は本文から読まない。
export const todayGet = opsHandler("GET /api/ops/today", async ({ ctx }) => json(200, await today.getToday(ctx)));
export const planFieldGet = opsHandler("GET /api/ops/plans/[id]/field", async ({ ctx, params }) =>
  json(200, await field.getFieldView(ctx, params["id"] ?? "")),
);
// Sprint 15：先読みの束。build はビルドの識別子（古い画面と新しい API の食い違いを画面が検出する）。
export const fieldBundleGet = opsHandler("GET /api/ops/field-bundle", async ({ ctx, req }) => {
  const raw = new URL(req.url).searchParams.get("planId");
  if (raw !== null && !svc.isUuid(raw)) return json(404, { error: "not_found" });
  const r = await field.getFieldBundles(ctx, raw === null ? null : raw.toLowerCase());
  return json(200, { ...r, build: process.env.SORABAN_BUILD_ID ?? null });
});
export const planFieldEventsList = opsHandler("GET /api/ops/plans/[id]/field-events", async ({ ctx, params }) =>
  json(200, await field.listFieldEvents(ctx, params["id"] ?? "")),
);
export const planFieldEventCreate = opsHandler(
  "POST /api/ops/plans/[id]/field-events",
  async ({ ctx, params, body }) => {
    const r = await field.recordFieldEvent(ctx, params["id"] ?? "", await body());
    return json(r.created ? 201 : 200, r.event);
  },
  { mutating: true },
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

// ---- 許可・承認の登録（Sprint 12d） ----
// 登録は利用者の申告。そらばんは許可書そのものを確認できず、DIPS にも接続しない。書き込みは運航管理者のみ。
// 同じ clientRequestId の登録が既にあれば、新しい登録を作らずに既存の登録を 200 で返す。
// 番号の重複（正規化後）は 409 duplicate_number、取消・失効した登録の訂正は 409 voided・revoked。
export const permitList = opsHandler("GET /api/ops/permits", async ({ ctx, req }) =>
  json(200, {
    permits: await permits.listPermits(ctx, permits.parsePermitFilter(new URL(req.url).searchParams)),
    declaration: PERMIT_DECLARATION_NOTE,
    noDipsNote: PERMIT_NO_DIPS_NOTE,
  }),
);
export const permitCreate = opsHandler(
  "POST /api/ops/permits",
  async ({ ctx, body }) => {
    const r = await permits.createPermit(ctx, await body());
    return json(r.created ? 201 : 200, r.record);
  },
  { mutating: true },
);
export const permitGet = opsHandler("GET /api/ops/permits/[id]", async ({ ctx, params }) =>
  json(200, await permits.getPermit(ctx, params["id"] ?? "")),
);
export const permitUpdate = opsHandler(
  "PATCH /api/ops/permits/[id]",
  async ({ ctx, params, body }) => json(200, await permits.updatePermit(ctx, params["id"] ?? "", await body())),
  { mutating: true },
);
export const permitRevoke = opsHandler(
  "POST /api/ops/permits/[id]/revoke",
  async ({ ctx, params, body }) => json(200, await permits.revokePermit(ctx, params["id"] ?? "", await body())),
  { mutating: true },
);
export const permitVoid = opsHandler(
  "POST /api/ops/permits/[id]/void",
  async ({ ctx, params, body }) => json(200, await permits.voidPermit(ctx, params["id"] ?? "", await body())),
  { mutating: true },
);
export const permitVersions = opsHandler("GET /api/ops/permits/[id]/versions", async ({ ctx, params }) =>
  json(200, { versions: await permits.listPermitVersions(ctx, params["id"] ?? "") }),
);
export const planPermits = opsHandler("GET /api/ops/plans/[id]/permits", async ({ ctx, params }) =>
  json(200, await permits.getPlanPermits(ctx, params["id"] ?? "")),
);

// ---- 事故・ヒヤリハット（Sprint 12e） ----
// 記録は事実の記録で、法的な報告の完了も責任の判断も意味しない。そらばんは国・DIPS へ何も送信しない。
// 同じ clientRequestId の作成が既にあれば、内容が同じなら新しい記録を作らずに既存の記録を 200 で返す（違えば 409 request_conflict）。
// サーバーが決めるもの（目安・スナップショット・detail_pending・source・記録者・指紋・記録した時点の版）は本文から読まない。
export const incidentList = opsHandler("GET /api/ops/incidents", async ({ ctx, req }) =>
  json(200, {
    incidents: await incidents.listIncidents(ctx, incidents.parseIncidentFilter(new URL(req.url).searchParams)),
    notices: incidents.incidentNotices(),
  }),
);
export const incidentCreate = opsHandler(
  "POST /api/ops/incidents",
  async ({ ctx, body }) => {
    const r = await incidents.createIncident(ctx, await body());
    return json(r.created ? 201 : 200, r.record);
  },
  { mutating: true },
);
export const incidentGet = opsHandler("GET /api/ops/incidents/[id]", async ({ ctx, params }) =>
  json(200, await incidents.getIncident(ctx, params["id"] ?? "")),
);
export const incidentUpdate = opsHandler(
  "PATCH /api/ops/incidents/[id]",
  async ({ ctx, params, body }) => json(200, await incidents.updateIncident(ctx, params["id"] ?? "", await body())),
  { mutating: true },
);
export const incidentVoid = opsHandler(
  "POST /api/ops/incidents/[id]/void",
  async ({ ctx, params, body }) => json(200, await incidents.voidIncident(ctx, params["id"] ?? "", await body())),
  { mutating: true },
);
export const incidentVersions = opsHandler("GET /api/ops/incidents/[id]/versions", async ({ ctx, params }) =>
  json(200, { versions: await incidents.listIncidentVersions(ctx, params["id"] ?? "") }),
);
export const incidentReportCreate = opsHandler(
  "POST /api/ops/incidents/[id]/reports",
  async ({ ctx, params, body }) => json(201, await incidents.createIncidentReport(ctx, params["id"] ?? "", await body())),
  { mutating: true },
);
export const planIncidents = opsHandler("GET /api/ops/plans/[id]/incidents", async ({ ctx, params }) =>
  json(200, await incidents.listPlanIncidents(ctx, params["id"] ?? "")),
);
export const flightIncidents = opsHandler("GET /api/ops/flights/[id]/incidents", async ({ ctx, params }) =>
  json(200, await incidents.listFlightIncidents(ctx, params["id"] ?? "")),
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
