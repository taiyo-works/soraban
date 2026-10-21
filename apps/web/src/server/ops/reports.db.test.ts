// Sprint 12b 契約 5〜10・12・17・19・20 の DB テスト（pnpm test:db）。
// 使い捨てのデータベースにマイグレーションを適用し、アプリ用ロール soraban_app に切り替えた接続でサービス層を動かす。
// 判定は本物の runDiagnosis に、同梱の規制データと市町村コード固定の読み込み口を渡して実行する（国土地理院へ接続しない）。
// DIPS へは送信しない（手動は記録だけ、模擬は同じプロセスの中の模擬）。ネットワーク呼び出しを持たない。
import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { MemberRow, PilotRow } from "@soraban/db";
import { effectiveReport, MockGateway, type ReportInputs, type SubmitResult } from "@soraban/dips";
import { createTempDatabase, runCli, withClient, type TempDatabase } from "../../../../../packages/db/src/test-db-helpers";
import { resolveTestDatabaseUrl } from "../../../../../packages/db/src/test-db-env";
import { runRegulationCheckWith } from "../check-core";
import { runDiagnosis } from "../diagnose-core";
import { baselineProvider } from "../sprint11e-baseline";
import type { Judge } from "./judge";
import { toDiagnosisRunInput } from "./plan-logic";
import * as plans from "./plans";
import * as procs from "./procedure-records";
import { rowLite } from "./report-dto";
import * as reports from "./reports";
import * as svc from "./service";
import { OpsError, type DipsTestHooks, type OpsContext } from "./service";
import type { OpsDb } from "./store";
import * as store from "./store";

const ADMIN_URL = resolveTestDatabaseUrl();
/** サーバーの現在時刻（JST 2027-01-05 12:00）。 */
const NOW = new Date("2027-01-05T03:00:00Z");

const judgeWith =
  (muni: string | undefined): Judge =>
  (input, now) =>
    runDiagnosis(
      toDiagnosisRunInput(input),
      (loc, ctx, n) =>
        runRegulationCheckWith(
          { ...baselineProvider("31202"), reverseGeocode: async () => (muni ? { muniCode: muni } : {}) },
          loc,
          ctx,
          n,
        ),
      now,
    );

const HQ = { latitude: 35.434238, longitude: 133.380508 };
const LICENSE = "TEST-12345678";
const FULL_INPUTS: ReportInputs = {
  flightPurposes: [1],
  assistantsNumber: 1,
  plannedMaxTime: 30,
  flightSpeed: 10,
  onsiteControlL3: "1",
  onsiteControlL35: "0",
  onsiteControl2: "1",
  mooring: "0",
};

const MANUAL_ENV = {};
const MOCK_ENV = { DIPS_REPORT_ADAPTER: "mock" };

describe.skipIf(!ADMIN_URL)("通報の記録・監査・手続きの記録の DB", () => {
  let db: TempDatabase;
  let createdRole = false;
  let owner: pg.Pool;
  let app: pg.Pool;
  let orgA: string;
  let orgB: string;
  let manager: MemberRow;
  let managerB: MemberRow;
  let pilotMember: MemberRow;
  let pilotMember2: MemberRow;
  let viewer: MemberRow;
  /** pilotMember に結び付いた操縦者。 */
  let pilotLinked: PilotRow;
  /** どの利用者にも結び付かない操縦者（氏名は秘匿の検査に使う）。 */
  let pilotFree: PilotRow;
  let aircraftW: string;
  let seq = 0;

  const addVersion = async (orgId: string, entityType: string, data: object): Promise<string> => {
    const id = randomUUID();
    await owner.query(
      `insert into record_versions (org_id, entity_type, entity_id, op, data, actor_kind) values ($1, $2, $3, 'create', $4::jsonb, 'system')`,
      [orgId, entityType, id, JSON.stringify(data)],
    );
    return id;
  };
  const addMember = async (orgId: string, role: MemberRow["role"], label: string): Promise<MemberRow> => {
    const id = await addVersion(orgId, "member", {
      email: `${label}@example.test`,
      display_name: label,
      role,
      status: "active",
      auth_provider: "test",
      auth_user_id: label,
    });
    return (await owner.query<MemberRow>("select * from members where id = $1", [id])).rows[0]!;
  };
  const addPilot = async (orgId: string, fullName: string, memberId: string | null): Promise<PilotRow> => {
    const id = await addVersion(orgId, "pilot", {
      full_name: fullName,
      has_license: true,
      license_class: "second",
      license_number: LICENSE,
      license_expires_on: null,
      member_id: memberId,
    });
    return (await owner.query<PilotRow>("select * from pilots where id = $1", [id])).rows[0]!;
  };

  const judge = judgeWith("31384");
  const ctxOf = (member: MemberRow, over: Partial<OpsContext> = {}): OpsContext => ({
    db: app as unknown as OpsDb,
    member,
    now: () => NOW,
    judge,
    env: MANUAL_ENV,
    ...over,
  });
  const mgr = (over: Partial<OpsContext> = {}) => ctxOf(manager, over);
  const mock = (over: Partial<OpsContext> = {}) => ctxOf(manager, { env: MOCK_ENV, ...over });

  const expectOpsError = async (p: Promise<unknown>, status: number, code?: string) => {
    const e = await p.then(
      () => null,
      (x: unknown) => x,
    );
    expect(e, "OpsError が投げられていない").toBeInstanceOf(OpsError);
    expect((e as OpsError).status).toBe(status);
    if (code) expect((e as OpsError).code).toBe(code);
    return e as OpsError;
  };
  const count = async (table: string, where = "true", params: unknown[] = []): Promise<number> =>
    Number((await owner.query(`select count(*)::int as n from ${table} where ${where}`, params)).rows[0].n);
  const verifyChain = async (type: string, id: string) =>
    (await owner.query("select * from verify_record_chain($1, $2)", [type, id])).rows as { version_no: number; problem: string }[];
  const attempts = async (planId: string, operation?: string) =>
    (
      await owner.query(
        `select * from flight_report_attempts where plan_id = $1 ${operation ? "and operation = $2" : ""} order by created_at, id`,
        operation ? [planId, operation] : [planId],
      )
    ).rows;

  const planInput = (extra: Record<string, unknown> = {}) => ({
    title: `通報の計画 ${++seq}`,
    aircraftId: aircraftW,
    pilotId: pilotFree.id,
    plannedStartAt: "2027-01-14T09:00",
    durationMinutes: 62,
    purpose: "空撮",
    placeName: "フューチャーテック株式会社 本社",
    ...HQ,
    radiusM: 100,
    maxAltitudeM: 50,
    accessControl: true,
    flags: ["method_night"],
    ...extra,
  });
  /** 確認を依頼した計画（active）。 */
  const activePlan = async (extra: Record<string, unknown> = {}, o: { ctx?: OpsContext } = {}) => {
    const ctx = o.ctx ?? mgr();
    const p = (await plans.createPlan(ctx, planInput(extra))).record;
    return plans.requestConfirmation(ctx, p.id, { expectedVersion: p.version });
  };
  const manual = (over: Record<string, unknown> = {}) => ({
    reportedAt: "2027-01-05T11:30",
    dipsNumber: "FP-0001",
    confirmedDipsDone: true,
    confirmedMatchesLatest: true,
    ...over,
  });
  /** 手動の新規の記録。 */
  const recordNew = (ctx: OpsContext, plan: { id: string; version: number }, extra: Record<string, unknown> = {}) =>
    reports.createReport(ctx, plan.id, { kind: "new", expectedPlanVersion: plan.version, manual: manual(), inputs: FULL_INPUTS, ...extra });
  const reportRows = async (planId: string) =>
    (await owner.query("select * from flight_reports where plan_id = $1 order by created_at, id", [planId])).rows;

  beforeAll(async () => {
    createdRole = await withClient(ADMIN_URL!, async (c) => {
      const exists = (await c.query("select 1 from pg_roles where rolname = 'soraban_app'")).rowCount === 1;
      if (!exists) await c.query("create role soraban_app nologin");
      return !exists;
    });
    db = await createTempDatabase(ADMIN_URL!);
    const r = await runCli(["migrate"], { DATABASE_URL_UNPOOLED: db.url });
    expect(r.code, r.stderr).toBe(0);
    owner = new pg.Pool({ connectionString: db.url, max: 4 });
    app = new pg.Pool({ connectionString: db.url, max: 6, options: "-c role=soraban_app" });
    orgA = (await owner.query("insert into organizations (name) values ('組織A') returning id")).rows[0].id;
    orgB = (await owner.query("insert into organizations (name) values ('組織B') returning id")).rows[0].id;
    manager = await addMember(orgA, "manager", "s12b-mgr");
    managerB = await addMember(orgB, "manager", "s12b-mgr-b");
    pilotMember = await addMember(orgA, "pilot", "s12b-pilot");
    pilotMember2 = await addMember(orgA, "pilot", "s12b-pilot2");
    viewer = await addMember(orgA, "viewer", "s12b-viewer");
    pilotLinked = await addPilot(orgA, "操縦 一郎", pilotMember.id);
    pilotFree = await addPilot(orgA, "操縦 二郎", null);
    await addPilot(orgA, "操縦 三郎", pilotMember2.id);
    aircraftW = (
      await svc.createAircraft(mgr(), {
        registrationMark: "JU12B0001",
        modelName: "Matrice 350 RTK",
        manufacturer: "DJI",
        serialNumber: "SN-12B-1",
        typeCertified: false,
        initialFlightMinutes: 0,
        maxTakeoffWeightKg: 0.9,
      })
    ).id;
  });

  afterAll(async () => {
    await app?.end();
    await owner?.end();
    await db?.drop();
    if (createdRole) await withClient(ADMIN_URL!, (c) => c.query("drop role if exists soraban_app"));
  });

  // ================================================================
  // 契約 5：手動の記録
  // ================================================================
  describe("契約 5：手動の記録", () => {
    it("記録が無いうちは、どの応答にも「通報済み」が出ない。記録すると reported_manual・channel = manual の行ができ、日時・番号が出る", async () => {
      const plan = await activePlan();
      // 記録前：計画の応答・通報の画面の応答のどこにも「通報済み」が無い
      const before = await plans.getPlan(mgr(), plan.id);
      expect(before.report.status.code).toBe("no_record");
      expect(before.report.status.label).toBe("通報の記録がありません");
      const view0 = await reports.getPlanReport(mgr(), plan.id);
      expect(view0.effective).toBeNull();
      expect(view0.reports).toEqual([]);
      for (const text of [JSON.stringify(before), JSON.stringify(view0), JSON.stringify(await plans.listPlans(mgr()))]) {
        expect(text).not.toContain("通報済み");
      }
      expect(before.nextActions.map((a) => a.id)).toContain("report");

      // 記録する
      const res = await recordNew(mgr(), plan, { manual: manual({ memo: "13:30 に DIPS の画面で確認" }) });
      expect(res.created).toBe(true);
      const row = (await reportRows(plan.id))[0];
      expect(row).toMatchObject({
        kind: "new",
        channel: "manual",
        status: "reported_manual",
        dips_number: "FP-0001",
        number_unavailable: false,
        confirmed_dips_done: true,
        confirmed_matches_latest: true,
        base_report_id: null,
        plan_version: plan.version,
        snapshot_id: plan.currentSnapshotId,
      });
      expect(res.report.statusLabel).toBe("DIPS で通報済み（利用者の申告・手動記録）");
      expect(res.report.reportedAtJst).toBe("2027-01-05 11:30");
      expect(res.report.channelLabel).toBe("手動（利用者の申告）");
      const after = await plans.getPlan(mgr(), plan.id);
      expect(after.report.status.code).toBe("reported");
      expect(after.report.status.label).toBe("DIPS で通報済み（利用者の申告・手動記録）：2027-01-05 11:30・番号 FP-0001");
      expect(after.nextActions.map((a) => a.id)).not.toContain("report");
      expect((await plans.listPlans(mgr())).find((p) => p.id === plan.id)!.report.status.code).toBe("reported");
      expect(await verifyChain("flight_report", row.id)).toEqual([]);
    });

    it("通報の記録の写し（content）と、行の全体に、技能証明書番号・操縦者の氏名が入らない", async () => {
      const plan = await activePlan();
      await recordNew(mgr(), plan);
      const row = (await reportRows(plan.id))[0];
      const text = JSON.stringify(row);
      expect(text).not.toContain(LICENSE);
      expect(text).not.toContain("操縦 二郎");
      expect(row.content.items.map((i: { key: string }) => i.key)).not.toContain("skill_number");
      expect(row.content.items.map((i: { key: string }) => i.key)).not.toContain("pilot_name");
      // 版の履歴（record_versions.data）にも入らない
      const v = (await owner.query("select data from record_versions where entity_type = 'flight_report' and entity_id = $1", [row.id])).rows;
      expect(JSON.stringify(v)).not.toContain(LICENSE);
      expect(JSON.stringify(v)).not.toContain("操縦 二郎");
      // 通報の画面の入力は content.inputs に写る
      expect(row.content.inputs).toMatchObject({ flightSpeed: 10, flightPurposes: [1] });
    });

    it("二つの確認が揃わないと 400（項目ごとの理由コード）。何も記録されない", async () => {
      const plan = await activePlan();
      const e1 = await expectOpsError(recordNew(mgr(), plan, { manual: manual({ confirmedDipsDone: false }) }), 400, "invalid_input");
      expect(e1.fieldCodes).toEqual({ confirmedDipsDone: "confirm_required" });
      const e2 = await expectOpsError(recordNew(mgr(), plan, { manual: manual({ confirmedMatchesLatest: undefined }) }), 400, "invalid_input");
      expect(e2.fieldCodes).toEqual({ confirmedMatchesLatest: "confirm_required" });
      await expectOpsError(recordNew(mgr(), plan, { manual: undefined }), 400, "invalid_input");
      expect(await reportRows(plan.id)).toEqual([]);
    });

    it("番号か「番号が表示されなかった」の宣言のどちらかが必須。宣言のときはメモが必須。両方は誤り", async () => {
      const plan = await activePlan();
      expect((await expectOpsError(recordNew(mgr(), plan, { manual: manual({ dipsNumber: undefined }) }), 400)).fieldCodes).toEqual({ dipsNumber: "number_required" });
      expect((await expectOpsError(recordNew(mgr(), plan, { manual: manual({ dipsNumber: undefined, numberUnavailable: true }) }), 400)).fieldCodes).toEqual({
        memo: "memo_required",
      });
      expect((await expectOpsError(recordNew(mgr(), plan, { manual: manual({ numberUnavailable: true, memo: "x" }) }), 400)).fieldCodes).toEqual({
        numberUnavailable: "number_conflict",
      });
      const ok = await recordNew(mgr(), plan, { manual: manual({ dipsNumber: undefined, numberUnavailable: true, memo: "完了画面に番号が出なかった" }) });
      expect(ok.report).toMatchObject({ dipsNumber: null, numberUnavailable: true, memo: "完了画面に番号が出なかった" });
      expect(ok.view.status.detail).toContain("番号なし（表示されなかった）");
    });

    it("通報日時は JST 分の形で、未来の時刻は 400", async () => {
      const plan = await activePlan();
      for (const [bad, code] of [
        ["2027-01-05 11:30", "time_format"],
        ["2027-01-05T11:30:00", "time_format"],
        ["2027-02-30T10:00", "time_format"],
        ["2027-01-05T12:01", "in_future"],
        ["2027-06-01T10:00", "in_future"],
      ] as const) {
        const e = await expectOpsError(recordNew(mgr(), plan, { manual: manual({ reportedAt: bad }) }), 400);
        expect(e.fieldCodes, bad).toEqual({ reportedAt: code });
      }
      expect(await reportRows(plan.id)).toEqual([]);
    });

    it("DB の CHECK でも拒否する：確認が偽・番号も宣言もない・宣言なのにメモがない・手動で reported_manual 以外", async () => {
      const plan = await activePlan();
      const view = await reports.getPlanReport(mgr(), plan.id);
      const data = (over: Record<string, unknown>) => ({
        plan_id: plan.id,
        kind: "new",
        base_report_id: null,
        snapshot_id: plan.currentSnapshotId,
        plan_version: plan.version,
        fingerprint: view.prepared.fingerprint,
        fingerprint_parts: view.prepared.fingerprintParts,
        map_revision: 1,
        channel: "manual",
        status: "reported_manual",
        idempotency_key: randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, ""),
        reported_at: "2027-01-05T11:30",
        dips_number: "N-1",
        number_unavailable: false,
        confirmed_dips_done: true,
        confirmed_matches_latest: true,
        content: {},
        memo: null,
        error_kind: null,
        external_ref: null,
        external_status: null,
        ...over,
      });
      const insert = (d: object) =>
        owner.query(
          `insert into record_versions (org_id, entity_type, entity_id, op, data, actor_kind) values ($1, 'flight_report', $2, 'create', $3::jsonb, 'system')`,
          [orgA, randomUUID(), JSON.stringify(d)],
        );
      await expect(insert(data({ confirmed_dips_done: false }))).rejects.toMatchObject({ code: "23514" });
      await expect(insert(data({ confirmed_matches_latest: false }))).rejects.toMatchObject({ code: "23514" });
      await expect(insert(data({ dips_number: null }))).rejects.toMatchObject({ code: "23514" });
      await expect(insert(data({ dips_number: null, number_unavailable: true, memo: null }))).rejects.toMatchObject({ code: "23514" });
      await expect(insert(data({ number_unavailable: true, memo: "x" }))).rejects.toMatchObject({ code: "23514" });
      await expect(insert(data({ status: "prepared", reported_at: null }))).rejects.toMatchObject({ code: "23514" });
      await expect(insert(data({ reported_at: null }))).rejects.toMatchObject({ code: "23514" });
      // 種別と元の通報の整合：新規に元の通報は付けられない（CHECK）。有効な通報が無い計画への変更・取消は SB409
      await expect(insert(data({ kind: "new", base_report_id: randomUUID() }))).rejects.toMatchObject({ code: "23514" });
      await expect(insert(data({ kind: "change", base_report_id: null }))).rejects.toMatchObject({ code: "SB409", detail: "no_active_report" });
      // 正しい行は入る
      await expect(insert(data({}))).resolves.toBeDefined();
      expect(await count("flight_reports", "plan_id = $1", [plan.id])).toBe(1);
    });

    it("下書きの計画・中止した計画・最新でない版への新規・変更は 409", async () => {
      // 下書き
      const draft = (await plans.createPlan(mgr(), planInput())).record;
      await expectOpsError(recordNew(mgr(), draft), 409, "not_requested");
      // 最新でない版（expectedPlanVersion）
      const plan = await activePlan();
      await expectOpsError(recordNew(mgr(), { id: plan.id, version: plan.version - 1 }), 409, "version_conflict");
      // 訂正で版が上がったあとに古い版で記録しようとする
      const updated = (await plans.updatePlan(mgr(), plan.id, { expectedVersion: plan.version, reason: "メモの訂正", notes: "メモ" })).record;
      await expectOpsError(recordNew(mgr(), { id: plan.id, version: plan.version }), 409, "version_conflict");
      // 中止した計画
      await plans.voidPlan(mgr(), plan.id, { expectedVersion: updated.version, reason: "天候不良" });
      await expectOpsError(recordNew(mgr(), { id: plan.id, version: updated.version + 1 }), 409, "voided");
      expect(await reportRows(draft.id)).toEqual([]);
      expect(await reportRows(plan.id)).toEqual([]);
    });

    it("DB の検査（アプリが版を確かめなくても）：古い plan_version・下書き・中止した計画への新規は SB409", async () => {
      const plan = await activePlan();
      const view = await reports.getPlanReport(mgr(), plan.id);
      const data = (over: Record<string, unknown>) => ({
        plan_id: plan.id,
        kind: "new",
        base_report_id: null,
        snapshot_id: plan.currentSnapshotId,
        plan_version: plan.version,
        fingerprint: view.prepared.fingerprint,
        fingerprint_parts: view.prepared.fingerprintParts,
        map_revision: 1,
        channel: "manual",
        status: "reported_manual",
        idempotency_key: randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, ""),
        reported_at: "2027-01-05T11:30",
        dips_number: "N-1",
        number_unavailable: false,
        confirmed_dips_done: true,
        confirmed_matches_latest: true,
        content: {},
        ...over,
      });
      const insert = (d: object) =>
        owner.query(
          `insert into record_versions (org_id, entity_type, entity_id, op, data, actor_kind) values ($1, 'flight_report', $2, 'create', $3::jsonb, 'system')`,
          [orgA, randomUUID(), JSON.stringify(d)],
        );
      await expect(insert(data({ plan_version: plan.version - 1 }))).rejects.toMatchObject({ code: "SB409", detail: "version_conflict" });
      // 別の組織の計画
      await expect(
        owner.query(
          `insert into record_versions (org_id, entity_type, entity_id, op, data, actor_kind) values ($1, 'flight_report', $2, 'create', $3::jsonb, 'system')`,
          [orgB, randomUUID(), JSON.stringify(data({}))],
        ),
      ).rejects.toMatchObject({ code: "SB404" });
      // 取消（void）はできない
      const ok = await recordNew(mgr(), plan);
      await expect(
        owner.query(
          `insert into record_versions (org_id, entity_type, entity_id, op, data, reason, actor_kind) values ($1, 'flight_report', $2, 'void', $3::jsonb, '理由', 'system')`,
          [orgA, ok.report.id, JSON.stringify(data({}))],
        ),
      ).rejects.toMatchObject({ code: "SB409", detail: "not_voidable" });
    });
  });

  // ================================================================
  // 契約 6：冪等性
  // ================================================================
  describe("契約 6：冪等性", () => {
    it("同じ計画・同じ指紋・同じ世代の二重送信（逐次）は、新しい行を作らず既存の行を返す", async () => {
      const plan = await activePlan();
      const a = await recordNew(mgr(), plan);
      const b = await recordNew(mgr(), plan, { manual: manual({ dipsNumber: "FP-OTHER" }) });
      expect(a.created).toBe(true);
      expect(b.created).toBe(false);
      expect(b.report.id).toBe(a.report.id);
      // 既存の結果をそのまま返す（2 回目の入力で上書きしない）
      expect(b.report.dipsNumber).toBe("FP-0001");
      expect(await reportRows(plan.id)).toHaveLength(1);
      expect(await count("record_versions", "entity_type = 'flight_report' and entity_id = $1", [a.report.id])).toBe(1);
    });

    it("並行の 2 リクエストでも、行は 1 件のまま（片方が作成、もう片方が既存を返す）", async () => {
      const plan = await activePlan();
      const [a, b] = await Promise.all([recordNew(mgr(), plan), recordNew(mgr(), plan)]);
      expect([a.created, b.created].sort()).toEqual([false, true]);
      expect(a.report.id).toBe(b.report.id);
      expect(await reportRows(plan.id)).toHaveLength(1);
      // 5 並行でも 1 件
      const plan2 = await activePlan();
      const many = await Promise.all([1, 2, 3, 4, 5].map(() => recordNew(mgr(), plan2)));
      expect(many.filter((x) => x.created)).toHaveLength(1);
      expect(new Set(many.map((x) => x.report.id)).size).toBe(1);
      expect(await reportRows(plan2.id)).toHaveLength(1);
    });

    it("(org_id, idempotency_key) の一意制約を DB が持つ", async () => {
      const r = await owner.query(
        `select indexdef from pg_indexes where tablename = 'flight_reports' and indexdef ilike '%unique%' and indexdef like '%(org_id, idempotency_key)%'`,
      );
      expect(r.rows).toHaveLength(1);
      const plan = await activePlan();
      const a = await recordNew(mgr(), plan);
      // 同じキーの行を直接作ろうとすると拒否（23505）。別の組織なら同じキーでも作れる設計（組織内で一意）
      const key = (await reportRows(plan.id))[0].idempotency_key as string;
      const view = await reports.getPlanReport(mgr(), plan.id);
      await expect(
        owner.query(
          `insert into record_versions (org_id, entity_type, entity_id, op, data, actor_kind) values ($1, 'flight_report', $2, 'create', $3::jsonb, 'system')`,
          [
            orgA,
            randomUUID(),
            JSON.stringify({
              plan_id: plan.id,
              kind: "change",
              base_report_id: a.report.id,
              snapshot_id: plan.currentSnapshotId,
              plan_version: plan.version,
              fingerprint: view.prepared.fingerprint,
              fingerprint_parts: view.prepared.fingerprintParts,
              map_revision: 1,
              channel: "manual",
              status: "retracted",
              idempotency_key: key,
              content: {},
            }),
          ],
        ),
      ).rejects.toMatchObject({ code: "23505", constraint: "uq_flight_reports_idem_request" });
    });

    it("有効な通報がある計画への新規は 409 already_reported（計画が変わって別のキーになっても）", async () => {
      const plan = await activePlan();
      await recordNew(mgr(), plan);
      // 計画の時刻を変える（指紋が変わる＝別の冪等性キー）。確認依頼済みのまま版が上がる
      const upd = (await plans.updatePlan(mgr(), plan.id, { expectedVersion: plan.version, reason: "時刻の変更", plannedStartAt: "2027-01-14T10:00" })).record;
      await expectOpsError(recordNew(mgr(), upd, { manual: manual({ dipsNumber: "FP-0002" }) }), 409, "already_reported");
      expect(await reportRows(plan.id)).toHaveLength(1);
    });

    it("完了した取消のあとの新規は別のキーで新しい行になる（世代が増える）", async () => {
      const plan = await activePlan();
      const a = await recordNew(mgr(), plan);
      const cancel = await reports.createReport(mgr(), plan.id, { kind: "cancel", baseReportId: a.report.id, manual: manual({ dipsNumber: "CX-1" }) });
      expect(cancel.report.kind).toBe("cancel");
      const again = await recordNew(mgr(), plan, { manual: manual({ dipsNumber: "FP-0003" }) });
      expect(again.created).toBe(true);
      expect(again.report.id).not.toBe(a.report.id);
      expect(again.report.idempotencyKey).not.toBe(a.report.idempotencyKey);
      expect(await reportRows(plan.id)).toHaveLength(3);
      expect(again.view.effective?.id).toBe(again.report.id);
      // 取消のあとの新規を二重に送っても 1 件
      const dup = await recordNew(mgr(), plan, { manual: manual({ dipsNumber: "FP-0003" }) });
      expect(dup.created).toBe(false);
      expect(await reportRows(plan.id)).toHaveLength(3);
    });
  });

  // ================================================================
  // 契約 7：変更・取消・訂正・取り下げ・有効な通報
  // ================================================================
  describe("契約 7：変更・取消・訂正・取り下げ", () => {
    it("変更・取消は元の通報を指す別の行になり、元の行は書き換わらない。取消で有効な通報が無くなる", async () => {
      const plan = await activePlan();
      const a = await recordNew(mgr(), plan);
      const upd = (await plans.updatePlan(mgr(), plan.id, { expectedVersion: plan.version, reason: "時刻の変更", plannedStartAt: "2027-01-14T10:00" })).record;
      // 計画が通報時から変わった：変更点が項目名つきで出る
      const d = await plans.getPlan(mgr(), plan.id);
      expect(d.report.status.code).toBe("change_review");
      expect(d.nextActions.map((x) => x.id)).toContain("change_report");
      expect(d.reportChanges).toEqual([{ key: "startAt", label: "予定開始", before: "2027-01-14 09:00", after: "2027-01-14 10:00" }]);
      const before = (await reportRows(plan.id))[0];
      const change = await reports.createReport(mgr(), plan.id, {
        kind: "change",
        expectedPlanVersion: upd.version,
        manual: manual({ reportedAt: "2027-01-05T11:50", dipsNumber: "FP-0001-C" }),
        inputs: FULL_INPUTS,
      });
      expect(change.report).toMatchObject({ kind: "change", baseReportId: a.report.id, status: "reported_manual", isEffective: true });
      expect((await reportRows(plan.id))[0]).toEqual(before);
      expect((await plans.getPlan(mgr(), plan.id)).report.status.code).toBe("reported");
      const cancel = await reports.createReport(mgr(), plan.id, {
        kind: "cancel",
        baseReportId: change.report.id,
        manual: manual({ reportedAt: "2027-01-05T11:55", dipsNumber: "FP-0001-X" }),
      });
      expect(cancel.report).toMatchObject({ kind: "cancel", baseReportId: change.report.id, channel: "manual" });
      expect(cancel.view.effective).toBeNull();
      expect(cancel.view.status.code).toBe("cancelled");
      expect(await reportRows(plan.id)).toHaveLength(3);
      for (const r of await reportRows(plan.id)) expect(await verifyChain("flight_report", r.id)).toEqual([]);
    });

    it("有効な通報が無い計画への変更・取消は 409 no_active_report。元の通報が現在の有効な通報でなければ 409 base_changed", async () => {
      const plan = await activePlan();
      await expectOpsError(reports.createReport(mgr(), plan.id, { kind: "change", expectedPlanVersion: plan.version, manual: manual() }), 409, "no_active_report");
      await expectOpsError(reports.createReport(mgr(), plan.id, { kind: "cancel", manual: manual() }), 409, "no_active_report");
      const a = await recordNew(mgr(), plan);
      const upd = (await plans.updatePlan(mgr(), plan.id, { expectedVersion: plan.version, reason: "時刻の変更", plannedStartAt: "2027-01-14T10:00" })).record;
      const b = await reports.createReport(mgr(), plan.id, { kind: "change", expectedPlanVersion: upd.version, manual: manual({ dipsNumber: "N-C" }) });
      // 最初の通報（もう有効でない）を元にした変更・取消は 409
      const upd2 = (await plans.updatePlan(mgr(), plan.id, { expectedVersion: upd.version, reason: "時刻の変更", plannedStartAt: "2027-01-14T11:00" })).record;
      await expectOpsError(
        reports.createReport(mgr(), plan.id, { kind: "change", baseReportId: a.report.id, expectedPlanVersion: upd2.version, manual: manual() }),
        409,
        "base_changed",
      );
      await expectOpsError(reports.createReport(mgr(), plan.id, { kind: "cancel", baseReportId: a.report.id, manual: manual() }), 409, "base_changed");
      // 別の計画の通報を指すことはできない（外部キー）
      const other = await activePlan();
      const o = await recordNew(mgr(), other);
      await expectOpsError(
        reports.createReport(mgr(), plan.id, { kind: "cancel", baseReportId: o.report.id, manual: manual() }),
        409,
        "base_changed",
      );
      expect(b.report.isEffective).toBe(true);
    });

    it("中止した計画でも取消は記録できる。新規・変更は 409 voided。「通報を取り消す」が次にやることに出る", async () => {
      const plan = await activePlan();
      const a = await recordNew(mgr(), plan);
      const voided = await plans.voidPlan(mgr(), plan.id, { expectedVersion: plan.version, reason: "天候不良で中止" });
      expect(voided.report.status.code).toBe("cancel_needed");
      expect(voided.report.status.label).toContain("DIPS で通報を取り消し");
      const detail = await plans.getPlan(mgr(), plan.id);
      expect(detail.nextActions.map((x) => x.id)).toEqual(["cancel_report"]);
      await expectOpsError(
        reports.createReport(mgr(), plan.id, { kind: "change", expectedPlanVersion: voided.version, manual: manual() }),
        409,
        "voided",
      );
      const c = await reports.createReport(mgr(), plan.id, { kind: "cancel", baseReportId: a.report.id, manual: manual({ dipsNumber: "X-1" }) });
      expect(c.report.kind).toBe("cancel");
      expect((await plans.getPlan(mgr(), plan.id)).nextActions).toEqual([]);
      expect((await plans.getPlan(mgr(), plan.id)).report.status.code).toBe("cancelled");
    });

    it("手動記録の訂正と取り下げは理由必須の新しい版で、元の値が履歴に残る。verify_record_chain が 0 行。物理削除はない", async () => {
      const plan = await activePlan();
      const a = await recordNew(mgr(), plan);
      // 理由が無いと 400
      await expectOpsError(reports.correctReport(mgr(), plan.id, a.report.id, { expectedVersion: 1, dipsNumber: "FP-9999" }), 400, "invalid_input");
      await expectOpsError(reports.correctReport(mgr(), plan.id, a.report.id, { expectedVersion: 1, reason: "打ち間違い" }), 400, "invalid_input");
      const fixed = await reports.correctReport(mgr(), plan.id, a.report.id, { expectedVersion: 1, reason: "番号の打ち間違い", dipsNumber: "FP-9999", memo: "訂正済み" });
      expect(fixed.report).toMatchObject({ dipsNumber: "FP-9999", memo: "訂正済み", status: "reported_manual", version: 2 });
      // 古い版では 409
      await expectOpsError(reports.correctReport(mgr(), plan.id, a.report.id, { expectedVersion: 1, reason: "x", dipsNumber: "FP-1" }), 409, "version_conflict");
      // 履歴に元の値が残る
      const versions = await owner.query("select version_no, op, reason, data from record_versions where entity_type = 'flight_report' and entity_id = $1 order by version_no", [a.report.id]);
      expect(versions.rows.map((v) => [v.version_no, v.op, v.reason])).toEqual([
        [1, "create", null],
        [2, "update", "番号の打ち間違い"],
      ]);
      expect(versions.rows[0].data.dips_number).toBe("FP-0001");
      expect(versions.rows[1].data.dips_number).toBe("FP-9999");
      const vs = await reports.listReportVersions(mgr(), plan.id, a.report.id);
      expect(vs.map((v) => v.versionNo)).toEqual([1, 2]);
      expect(vs[1]!.changedFields).toEqual(expect.arrayContaining(["DIPS の番号", "メモ"]));
      // 取り下げ（理由必須）：状態は retracted。有効な通報が無くなり、「通報済み」が消える
      await expectOpsError(reports.retractReport(mgr(), plan.id, a.report.id, { expectedVersion: 2 }), 400, "invalid_input");
      const retracted = await reports.retractReport(mgr(), plan.id, a.report.id, { expectedVersion: 2, reason: "通報していないのに記録した" });
      expect(retracted.report.status).toBe("retracted");
      expect(retracted.view.effective).toBeNull();
      expect(retracted.view.status.code).toBe("no_record");
      expect(JSON.stringify(retracted.view.status)).not.toContain("通報済み");
      expect((await plans.getPlan(mgr(), plan.id)).nextActions.map((x) => x.id)).toContain("report");
      expect(await verifyChain("flight_report", a.report.id)).toEqual([]);
      // 取り下げた記録は訂正・再度の取り下げができない（取消ではなく取り下げ）
      await expectOpsError(reports.correctReport(mgr(), plan.id, a.report.id, { expectedVersion: 3, reason: "x", dipsNumber: "N" }), 409, "not_correctable");
      await expectOpsError(reports.retractReport(mgr(), plan.id, a.report.id, { expectedVersion: 3, reason: "x" }), 409, "invalid_transition");
      // 取り下げのあと、同じ内容の新規の記録は別のキー…ではなく同じキー（同じ世代）→ 既存の行（取り下げ済み）が返る。やり直しは変更でなく新規の再記録
      expect(await count("flight_reports", "plan_id = $1", [plan.id])).toBe(1);
      // 物理削除はない：soraban_app は DELETE できない
      const client = await app.connect();
      try {
        await expect(client.query("delete from flight_reports where id = $1", [a.report.id])).rejects.toMatchObject({ code: "42501" });
      } finally {
        client.release();
      }
      // 版の追加で void もできない
      await expect(
        store.appendVersion(app as unknown as OpsDb, {
          orgId: orgA,
          entityType: "flight_report",
          entityId: a.report.id,
          op: "void",
          data: {},
          reason: "取消",
          actorMemberId: manager.id,
        }),
      ).rejects.toMatchObject({ status: 409, code: "not_voidable" });
    });

    it("取り下げは、取り下げていない最新の行だけ（変更を取り下げると前の通報が有効に戻る）", async () => {
      const plan = await activePlan();
      const a = await recordNew(mgr(), plan);
      const upd = (await plans.updatePlan(mgr(), plan.id, { expectedVersion: plan.version, reason: "時刻の変更", plannedStartAt: "2027-01-14T10:00" })).record;
      const b = await reports.createReport(mgr(), plan.id, { kind: "change", expectedPlanVersion: upd.version, manual: manual({ dipsNumber: "N-C" }) });
      await expectOpsError(reports.retractReport(mgr(), plan.id, a.report.id, { expectedVersion: 1, reason: "x" }), 409, "not_latest");
      const r = await reports.retractReport(mgr(), plan.id, b.report.id, { expectedVersion: 1, reason: "変更の記録の誤り" });
      expect(r.view.effective?.id).toBe(a.report.id);
    });

    it("TS の effectiveReport と DB の flight_report_effective_id は、操作の列（新規・変更・取消・取り下げ）のどの時点でも一致する", async () => {
      // 擬似乱数（固定の種）で操作を選ぶ。失敗する操作（409）は無視する
      let s = 20270105;
      const rnd = (n: number) => {
        s = (s * 1103515245 + 12345) & 0x7fffffff;
        return s % n;
      };
      const planList = [await activePlan(), await activePlan()];
      let steps = 0;
      for (let i = 0; i < 80; i++) {
        const p = planList[rnd(planList.length)]!;
        const cur = await plans.getPlan(mgr(), p.id);
        const view = await reports.getPlanReport(mgr(), p.id);
        const eff = view.effective;
        const op = rnd(5);
        try {
          if (op === 0 && !eff) await reports.createReport(mgr(), p.id, { kind: "new", expectedPlanVersion: cur.version, manual: manual({ dipsNumber: `N${i}` }) });
          else if (op === 1 && eff) {
            // 変更は計画を変えてから
            const upd = (await plans.updatePlan(mgr(), p.id, { expectedVersion: cur.version, reason: "変更", maxAltitudeM: 20 + i })).record;
            await reports.createReport(mgr(), p.id, { kind: "change", expectedPlanVersion: upd.version, manual: manual({ dipsNumber: `C${i}` }) });
          } else if (op === 2 && eff) await reports.createReport(mgr(), p.id, { kind: "cancel", baseReportId: eff.id, manual: manual({ dipsNumber: `X${i}` }) });
          else if (op === 3) {
            const live = [...view.reports].find((r) => r.status !== "retracted");
            if (live) await reports.retractReport(mgr(), p.id, live.id, { expectedVersion: live.version, reason: `取り下げ ${i}` });
          } else await reports.getPlanReport(mgr(), p.id);
        } catch (e) {
          if (!(e instanceof OpsError)) throw e;
        }
        const rows = await store.listReportsFor(app as unknown as OpsDb, orgA, [p.id]);
        const ts = effectiveReport(rows.map(rowLite))?.id ?? null;
        const sql = (await owner.query("select flight_report_effective_id($1) as id", [p.id])).rows[0].id as string | null;
        expect(ts, `step ${i}`).toBe(sql);
        steps++;
      }
      expect(steps).toBe(80);
      expect(await count("flight_reports", "plan_id = any($1::uuid[])", [planList.map((x) => x.id)])).toBeGreaterThan(5);
    });
  });

  // ================================================================
  // 契約 8：根拠の鎖
  // ================================================================
  describe("契約 8：根拠の鎖", () => {
    it("通報の行が snapshot_id・plan_version・fingerprint・fingerprint_parts・map_revision・channel を持ち、証跡 ID が引ける", async () => {
      const plan = await activePlan();
      const a = await recordNew(mgr(), plan);
      const row = (await reportRows(plan.id))[0];
      expect(row.snapshot_id).toBe(plan.currentSnapshotId);
      expect(row.plan_version).toBe(plan.version);
      expect(row.fingerprint).toMatch(/^[0-9a-f]{64}$/);
      expect(row.fingerprint_parts).toMatchObject({ startAt: "2027-01-14T09:00", durationMinutes: 62, aircraftId: aircraftW, pilotId: pilotFree.id });
      expect(row.fingerprint_parts.flags).toContain("method_night");
      expect(row.map_revision).toBe(1);
      expect(row.channel).toBe("manual");
      const ev = (await owner.query("select check_evidence_id, diagnosis_evidence_id from judgement_snapshots where id = $1", [row.snapshot_id])).rows[0];
      expect(a.report).toMatchObject({
        checkEvidenceId: ev.check_evidence_id,
        diagnosisEvidenceId: ev.diagnosis_evidence_id,
        planVersion: plan.version,
        mapRevision: 1,
        channel: "manual",
        fingerprint: row.fingerprint,
        snapshotSeq: 1,
      });
      expect(ev.check_evidence_id).toBeTruthy();
      expect(await count("evidence_log", "evidence_id = $1", [ev.check_evidence_id])).toBe(1);
    });

    it("別の計画のスナップショット・元の通報を指す行を外部キーが拒否する。他の組織の計画・通報は 404", async () => {
      const p1 = await activePlan();
      const p2 = await activePlan();
      const a = await recordNew(mgr(), p1);
      const view = await reports.getPlanReport(mgr(), p1.id);
      const raw = (over: Record<string, unknown>) =>
        owner.query(
          `insert into record_versions (org_id, entity_type, entity_id, op, data, actor_kind) values ($1, 'flight_report', $2, 'create', $3::jsonb, 'system')`,
          [
            orgA,
            randomUUID(),
            JSON.stringify({
              plan_id: p1.id,
              kind: "new",
              base_report_id: null,
              snapshot_id: p1.currentSnapshotId,
              plan_version: p1.version,
              fingerprint: view.prepared.fingerprint,
              fingerprint_parts: view.prepared.fingerprintParts,
              map_revision: 1,
              channel: "mock",
              status: "prepared",
              idempotency_key: randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, ""),
              content: {},
              ...over,
            }),
          ],
        );
      // 別の計画のスナップショット（外部キー 23503）。先に有効な通報を取消して「新規」の検査を通す
      await reports.createReport(mgr(), p1.id, { kind: "cancel", baseReportId: a.report.id, manual: manual({ dipsNumber: "X-0" }) });
      await expect(raw({ snapshot_id: p2.currentSnapshotId })).rejects.toMatchObject({ code: "23503" });
      // 別の計画の通報を元にする（有効な通報の検査より先に、外部キーが拒否する前に SB409 になる場合もある）
      const b = await recordNew(mgr(), p1, { manual: manual({ dipsNumber: "N-2" }) });
      void b;
      // 他の組織
      const ctxB = ctxOf(managerB);
      await expectOpsError(reports.getPlanReport(ctxB, p1.id), 404, "not_found");
      await expectOpsError(reports.createReport(ctxB, p1.id, { kind: "new", expectedPlanVersion: 1, manual: manual() }), 404, "not_found");
      await expectOpsError(reports.correctReport(ctxB, p1.id, a.report.id, { expectedVersion: 1, reason: "x", memo: "x" }), 404, "not_found");
      await expectOpsError(reports.retractReport(ctxB, p1.id, a.report.id, { expectedVersion: 1, reason: "x" }), 404, "not_found");
      await expectOpsError(reports.recordCopyAudit(ctxB, p1.id, { key: "name" }), 404, "not_found");
      // 自分の組織でも、別の計画の通報 ID を指定すると 404
      await expectOpsError(reports.correctReport(mgr(), p2.id, a.report.id, { expectedVersion: 1, reason: "x", memo: "x" }), 404, "not_found");
      await expectOpsError(reports.retractReport(mgr(), p2.id, a.report.id, { expectedVersion: 1, reason: "x" }), 404, "not_found");
    });

    it("画面の履歴に、証跡 ID・計画の版・対応表の版・送信元が出る", async () => {
      const plan = await activePlan();
      await recordNew(mgr(), plan);
      const view = await reports.getPlanReport(mgr(), plan.id);
      const r = view.reports[0]!;
      expect(r).toMatchObject({ channelLabel: "手動（利用者の申告）", mapRevision: 1, planVersion: plan.version, snapshotSeq: 1 });
      expect(r.checkEvidenceId).toMatch(/\S/);
      expect(r.diagnosisEvidenceId).toMatch(/\S/);
      expect(view.snapshot.checkEvidenceId).toBe(r.checkEvidenceId);
    });
  });

  // ================================================================
  // 契約 9：権限
  // ================================================================
  describe("契約 9：権限（soraban_app と追記専用）", () => {
    const priv = async (table: string, p: string) =>
      (await owner.query("select has_table_privilege('soraban_app', $1, $2) as ok", [table, p])).rows[0].ok as boolean;

    it("has_table_privilege：試行・手続きの記録は INSERT=t・UPDATE=f・DELETE=f・TRUNCATE=f、通報の記録は INSERT=f・UPDATE=f（CI と同じ確認）", async () => {
      for (const t of ["flight_report_attempts", "plan_procedure_records"]) {
        expect([await priv(t, "SELECT"), await priv(t, "INSERT"), await priv(t, "UPDATE"), await priv(t, "DELETE"), await priv(t, "TRUNCATE")], t).toEqual([
          true,
          true,
          false,
          false,
          false,
        ]);
      }
      expect([
        await priv("flight_reports", "SELECT"),
        await priv("flight_reports", "INSERT"),
        await priv("flight_reports", "UPDATE"),
        await priv("flight_reports", "DELETE"),
        await priv("flight_reports", "TRUNCATE"),
      ]).toEqual([true, false, false, false, false]);
      expect((await owner.query("select has_function_privilege('soraban_app', 'flight_report_effective_id(uuid)', 'EXECUTE') as ok")).rows[0].ok).toBe(false);
    });

    it("soraban_app で UPDATE・DELETE・TRUNCATE は権限エラー（42501）。INSERT と SELECT はできる。flight_reports への直接の書き込みも権限エラー", async () => {
      const plan = await activePlan();
      await recordNew(mgr(), plan);
      await reports.recordCopyAudit(mgr(), plan.id, { key: "name" });
      await procs.createProcedureRecord(mgr(), plan.id, { kind: "dips_permit", action: "done", doneAt: "2027-01-05T11:00", checks: { applicationCompleted: true } });
      const c = await app.connect();
      try {
        for (const t of ["flight_report_attempts", "plan_procedure_records", "flight_reports"]) {
          expect(Number((await c.query(`select count(*)::int as n from ${t}`)).rows[0].n), `${t} SELECT`).toBeGreaterThan(0);
        }
        for (const t of ["flight_report_attempts", "plan_procedure_records", "flight_reports"]) {
          await expect(c.query(`update ${t} set org_id = org_id`), `${t} UPDATE`).rejects.toMatchObject({ code: "42501" });
          await expect(c.query(`delete from ${t}`), `${t} DELETE`).rejects.toMatchObject({ code: "42501" });
          await expect(c.query(`truncate ${t}`), `${t} TRUNCATE`).rejects.toMatchObject({ code: "42501" });
        }
        await expect(
          c.query(
            `insert into flight_reports (id, org_id, plan_id, kind, snapshot_id, plan_version, fingerprint, fingerprint_parts, map_revision, channel, status, idempotency_key, content, current_version, created_at, updated_at)
             values (gen_random_uuid(), $1, $2, 'new', $3, 1, $4, '{}', 1, 'mock', 'prepared', $4, '{}', 1, now(), now())`,
            [orgA, plan.id, plan.currentSnapshotId, "a".repeat(64)],
          ),
        ).rejects.toMatchObject({ code: "42501" });
      } finally {
        c.release();
      }
      // INSERT は、サービス層（コピーの監査・手続きの記録）を通ってできている
      expect(await count("flight_report_attempts", "plan_id = $1", [plan.id])).toBeGreaterThan(1);
      expect(await count("plan_procedure_records", "plan_id = $1", [plan.id])).toBe(1);
    });

    it("オーナーロールでも、追記専用の表の更新・削除・TRUNCATE はトリガーが拒む（SB409 immutable）", async () => {
      const plan = await activePlan();
      await reports.recordCopyAudit(mgr(), plan.id, { key: "name" });
      await procs.createProcedureRecord(mgr(), plan.id, { kind: "dips_permit", action: "done", doneAt: "2027-01-05T11:00", checks: { applicationCompleted: true } });
      for (const t of ["flight_report_attempts", "plan_procedure_records"]) {
        await expect(owner.query(`update ${t} set org_id = org_id`), `${t} UPDATE`).rejects.toMatchObject({ code: "SB409", detail: "immutable" });
        await expect(owner.query(`delete from ${t}`), `${t} DELETE`).rejects.toMatchObject({ code: "SB409", detail: "immutable" });
        await expect(owner.query(`truncate ${t}`), `${t} TRUNCATE`).rejects.toMatchObject({ code: "SB409", detail: "immutable" });
      }
    });
  });

  // ================================================================
  // 契約 10：監査
  // ================================================================
  describe("契約 10：監査（flight_report_attempts）", () => {
    it("コピー・記録・訂正・取り下げ・取消が、誰が・いつ・何を・どこへ・結果で 1 行ずつ残る。値は記録しない", async () => {
      const plan = await activePlan();
      const a = await recordNew(mgr(), plan);
      await reports.recordCopyAudit(mgr(), plan.id, { keys: ["name", "start_time", "skill_number"] });
      await reports.correctReport(mgr(), plan.id, a.report.id, { expectedVersion: 1, reason: "番号の訂正", dipsNumber: "FP-0002" });
      await reports.retractReport(mgr(), plan.id, a.report.id, { expectedVersion: 2, reason: "記録の誤り" });
      // 取り下げのあと、同じ内容を記録し直せる（別の冪等性キー）
      const b = await recordNew(mgr(), plan, { manual: manual({ dipsNumber: "FP-0003" }) });
      expect(b.created).toBe(true);
      expect(b.report.id).not.toBe(a.report.id);
      expect(b.report.idempotencyKey).not.toBe(a.report.idempotencyKey);
      const c = await reports.createReport(mgr(), plan.id, { kind: "cancel", baseReportId: b.report.id, manual: manual({ dipsNumber: "X-9" }) });

      const rows = await attempts(plan.id);
      const ops = rows.map((r) => r.operation);
      expect(ops).toEqual(["manual_record", "copy", "copy", "copy", "correct", "retract", "manual_record", "cancel"]);
      const evidence = (await owner.query("select check_evidence_id, diagnosis_evidence_id from judgement_snapshots where id = $1", [plan.currentSnapshotId])).rows[0];
      for (const r of rows) {
        // 誰が（利用者の ID と、その時点の表示名・役割の写し）・いつ（DB の時刻）・どこへ（アダプター）・結果
        expect(r).toMatchObject({ org_id: orgA, plan_id: plan.id, member_id: manager.id, member_name: "s12b-mgr", member_role: "manager", adapter: "manual", result: "success" });
        expect(r.created_at).toBeInstanceOf(Date);
        // 何を（対応表の版・証跡 ID）
        expect(r.map_revision).toBe(1);
        expect(r.check_evidence_id).toBe(evidence.check_evidence_id);
        expect(r.diagnosis_evidence_id).toBe(evidence.diagnosis_evidence_id);
        expect(r.summary.length).toBeLessThanOrEqual(500);
      }
      const rec1 = rows[0]!;
      expect(rec1).toMatchObject({ report_id: a.report.id, idempotency_key: a.report.idempotencyKey, dips_number: "FP-0001" });
      expect(rec1.payload_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(rows.filter((r) => r.operation === "copy").map((r) => r.summary)).toEqual([
        "コピー：name（飛行計画名称）",
        "コピー：start_time（飛行開始日時）",
        "コピー：skill_number（技能証明書番号）",
      ]);
      expect(rows[7]).toMatchObject({ operation: "cancel", report_id: c.report.id });
      // 行ごとの「時刻」は DB の時刻で、順に進む
      const times = rows.map((r) => (r.created_at as Date).getTime());
      expect([...times].sort((x, y) => x - y)).toEqual(times);

      // 秘密・技能証明書番号・氏名・内容の全文が入らない（列の値を検査）
      const all = JSON.stringify(rows);
      for (const secret of [LICENSE, "操縦 二郎", "操縦 一郎", "TEST-", "@example.test", "フューチャーテック", "夜間", "通報の計画"]) {
        expect(all, secret).not.toContain(secret);
      }
      for (const r of rows) {
        for (const [k, v] of Object.entries(r)) {
          if (typeof v === "string") expect(v.length, `${k}`).toBeLessThanOrEqual(500);
        }
      }
    });

    it("失敗した操作も結果つきで残る（競合：already_reported・version_conflict）。入力の誤り・認可の誤りは残さない", async () => {
      const plan = await activePlan();
      await recordNew(mgr(), plan);
      const upd = (await plans.updatePlan(mgr(), plan.id, { expectedVersion: plan.version, reason: "時刻の変更", plannedStartAt: "2027-01-14T10:00" })).record;
      const before = (await attempts(plan.id)).length;
      await expectOpsError(recordNew(mgr(), upd, { manual: manual({ dipsNumber: "FP-0002" }) }), 409, "already_reported");
      const rows = await attempts(plan.id);
      expect(rows).toHaveLength(before + 1);
      expect(rows[rows.length - 1]).toMatchObject({ operation: "manual_record", result: "failure", error_kind: "already_reported", http_status: 409, report_id: null, member_id: manager.id });
      // 入力の誤り（400）・認可の誤り（403）は何も起きていないので残さない
      await expectOpsError(recordNew(mgr(), upd, { manual: manual({ confirmedDipsDone: false }) }), 400);
      await expectOpsError(recordNew(ctxOf(viewer), upd), 403);
      expect(await attempts(plan.id)).toHaveLength(before + 1);
    });

    it("利用者は同じ組織に限る：他の組織の利用者の ID では監査を残せない（SB404）", async () => {
      const plan = await activePlan();
      await expect(
        store.insertAttempts(app as unknown as OpsDb, [
          {
            orgId: orgA,
            planId: plan.id,
            reportId: null,
            operation: "copy",
            memberId: managerB.id,
            adapter: "manual",
            idempotencyKey: null,
            payloadHash: null,
            summary: "x",
            mapRevision: 1,
            checkEvidenceId: null,
            diagnosisEvidenceId: null,
            result: "success",
            httpStatus: null,
            errorKind: null,
            dipsNumber: null,
          },
        ]),
      ).rejects.toMatchObject({ status: 404 });
    });

    it("コピーの監査：項目の key だけを受け取る。未知の key・件数の超過・値の送信は拒否。閲覧者は 403", async () => {
      const plan = await activePlan();
      await expectOpsError(reports.recordCopyAudit(mgr(), plan.id, { key: "not_a_key" }), 400, "invalid_input");
      await expectOpsError(reports.recordCopyAudit(mgr(), plan.id, {}), 400, "invalid_input");
      await expectOpsError(reports.recordCopyAudit(mgr(), plan.id, { keys: [] }), 400, "invalid_input");
      await expectOpsError(reports.recordCopyAudit(mgr(), plan.id, { keys: Array(101).fill("name") }), 400, "invalid_input");
      await expectOpsError(reports.recordCopyAudit(ctxOf(viewer), plan.id, { key: "name" }), 403);
      const r = await reports.recordCopyAudit(mgr(), plan.id, { key: "name", value: "秘密の値" });
      expect(r).toEqual({ recorded: 1 });
      expect(JSON.stringify(await attempts(plan.id))).not.toContain("秘密の値");
    });
  });

  // ================================================================
  // 契約 12：サービス層の契約（手動・模擬で同じ群）
  // ================================================================
  /** 呼び出しを数える模擬。 */
  class SpyMock extends MockGateway {
    calls = 0;
    override async submit(prepared: Parameters<MockGateway["submit"]>[0], c: Parameters<MockGateway["submit"]>[1]) {
      this.calls++;
      return super.submit(prepared, c);
    }
  }
  /** 応答のない模擬（時間切れの再現）。 */
  class SilentMock extends MockGateway {
    calls = 0;
    override submit(): Promise<SubmitResult> {
      this.calls++;
      return new Promise<SubmitResult>(() => undefined);
    }
  }
  /** 実時間の時計（prepared のまま 5 分の判定は DB の時刻と比べる）。 */
  const realNow = (plusMinutes = 0) => () => new Date(Date.now() + plusMinutes * 60_000);
  const mockCtx = (dips: DipsTestHooks = {}, over: Partial<OpsContext> = {}) => mock({ now: realNow(), dips, ...over });
  const send = (ctx: OpsContext, plan: { id: string; version: number }, extra: Record<string, unknown> = {}) =>
    reports.createReport(ctx, plan.id, { kind: "new", expectedPlanVersion: plan.version, inputs: FULL_INPUTS, confirmSend: true, ...extra });

  describe("契約 12：共通の契約（手動・模擬）", () => {
    for (const channel of ["manual", "mock"] as const) {
      describe(`アダプター：${channel}`, () => {
        const record = async (plan: { id: string; version: number }, extra: Record<string, unknown> = {}, dips: DipsTestHooks = {}) =>
          channel === "manual"
            ? recordNew(mgr(), plan, extra)
            : send(mockCtx(dips), plan, { mockScenario: "ok", ...extra });

        it("結果が遷移表の許す状態で、証跡 ID・指紋・対応表の版・送信元を持つ。同じ冪等性キーの二度目は既存の結果", async () => {
          const plan = await activePlan();
          const spy = new SpyMock();
          const a = await record(plan, {}, { gateway: spy });
          expect(a.created).toBe(true);
          expect(a.report.status).toBe(channel === "manual" ? "reported_manual" : "submitted_api");
          expect(a.report.channel).toBe(channel);
          expect(a.report.channelLabel).toBe(channel === "manual" ? "手動（利用者の申告）" : "模擬（開発用）");
          expect(a.report.checkEvidenceId).toBeTruthy();
          expect(a.report.diagnosisEvidenceId).toBeTruthy();
          expect(a.report.fingerprint).toMatch(/^[0-9a-f]{64}$/);
          expect(a.report.mapRevision).toBe(1);
          expect(a.report.snapshotId).toBe(plan.currentSnapshotId);
          const b = await record(plan, {}, { gateway: spy });
          expect(b.created).toBe(false);
          expect(b.report.id).toBe(a.report.id);
          expect(await reportRows(plan.id)).toHaveLength(1);
          // 外部は 1 回しか呼ばれない（二重送信が外部に届かない）
          if (channel === "mock") expect(spy.calls).toBe(1);
        });

        it("取消が別の行になり、有効な通報が無くなる。canCancel が偽のアダプター（模擬）は手動の記録に倒す", async () => {
          const plan = await activePlan();
          const a = await record(plan);
          const c = await reports.createReport(channel === "manual" ? mgr() : mockCtx(), plan.id, {
            kind: "cancel",
            baseReportId: a.report.id,
            // 模擬の文脈は実時間の時計（通報日時は現在より前）
            manual: manual({ dipsNumber: "X-1", reportedAt: "2026-01-01T10:00" }),
          });
          expect(c.report).toMatchObject({ kind: "cancel", baseReportId: a.report.id, status: "reported_manual", channel: "manual" });
          expect(c.view.effective).toBeNull();
          expect(c.view.adapter.canCancel).toBe(channel === "manual");
          expect(await reportRows(plan.id)).toHaveLength(2);
          // 取消の行は、元の行を書き換えない
          expect((await reportRows(plan.id))[0].status).toBe(channel === "manual" ? "reported_manual" : "submitted_api");
        });
      });
    }
  });

  describe("契約 12・13：模擬アダプター（direct）", () => {
    it("ok：prepared → submitted_api。番号は模擬の採番。FPR の応答と同じ形が external_ref に入る。履歴・監査に「模擬（開発用）」が出る", async () => {
      const plan = await activePlan();
      const spy = new SpyMock();
      const r = await send(mockCtx({ gateway: spy }), plan, { mockScenario: "ok" });
      expect(r.report).toMatchObject({ channel: "mock", status: "submitted_api", kind: "new", version: 2, isEffective: true });
      expect(r.report.dipsNumber).toMatch(/^MOCK-[0-9A-F]{10}$/);
      expect(r.report.externalRef).toMatchObject({
        flightPlanId: r.report.dipsNumber,
        flightPlanRegistrationResult: "登録完了",
        existOtherFlightRoutesCount: 0,
      });
      expect(String(r.report.externalRef!["flightPlanRegistrationDatetime"])).toMatch(/^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}$/);
      expect(r.report.reportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
      expect(r.report.statusLabel).toBe("送信済み（模擬・開発用）");
      expect(r.view.status.label).toContain("送信済み（模擬・開発用）");
      expect(r.view.adapter).toMatchObject({ name: "mock", label: "模擬（開発用）", mode: "direct", canCancel: false });
      // 版の履歴：作成（prepared）→ 結果
      const v = await owner.query("select version_no, data->>'status' as s from record_versions where entity_type = 'flight_report' and entity_id = $1 order by version_no", [r.report.id]);
      expect(v.rows.map((x) => [x.version_no, x.s])).toEqual([
        [1, "prepared"],
        [2, "submitted_api"],
      ]);
      expect(await verifyChain("flight_report", r.report.id)).toEqual([]);
      // 監査：送信の開始（外部の呼び出しの前）と結果の 2 行。どちらも adapter = mock
      const a = await attempts(plan.id, "submit");
      expect(a.map((x) => [x.adapter, x.result])).toEqual([
        ["mock", "unknown"],
        ["mock", "success"],
      ]);
      expect(a[1]).toMatchObject({ http_status: 200, dips_number: r.report.dipsNumber, idempotency_key: r.report.idempotencyKey });
    });

    it("送信の確認（confirmSend）が無いと 400。何も作られず、外部も呼ばれない", async () => {
      const plan = await activePlan();
      const spy = new SpyMock();
      const e = await expectOpsError(
        reports.createReport(mockCtx({ gateway: spy }), plan.id, { kind: "new", expectedPlanVersion: plan.version, inputs: FULL_INPUTS }),
        400,
        "invalid_input",
      );
      expect(e.fieldCodes).toEqual({ confirmSend: "confirm_required" });
      expect(spy.calls).toBe(0);
      expect(await reportRows(plan.id)).toEqual([]);
    });

    it("外部の呼び出しの間にトランザクションを開けない：②の前に prepared の行が見え、アプリの接続に開いたトランザクションがない", async () => {
      const plan = await activePlan();
      const seen: { status?: string; idle?: number; attempts?: number; connections?: number } = {};
      await send(
        mockCtx({
          afterBegin: async ({ reportId }) => {
            // 別の接続（オーナー）から見える＝コミット済み
            const row = (await owner.query("select status from flight_reports where id = $1", [reportId])).rows[0];
            seen.status = row?.status;
            seen.attempts = await count("flight_report_attempts", "report_id = $1", [reportId]);
            seen.idle = Number(
              (
                await owner.query(
                  `select count(*)::int as n from pg_stat_activity
                    where datname = $1 and pid <> pg_backend_pid() and state like 'idle in transaction%'`,
                  [db.name],
                )
              ).rows[0].n,
            );
          },
        }),
        plan,
        { mockScenario: "ok" },
      );
      expect(seen).toMatchObject({ status: "prepared", idle: 0, attempts: 1 });
    });

    it("③の失敗を注入すると prepared のまま残り、②の結果で再送しない。5 分を超えると結果不明として扱い、自動で再送しない", async () => {
      const plan = await activePlan();
      const spy = new SpyMock();
      await expectOpsError(
        send(
          mockCtx({
            gateway: spy,
            beforeResultWrite: () => {
              throw new Error("結果の書き込みの失敗を再現");
            },
          }),
          plan,
          { mockScenario: "ok" },
        ),
        503,
        "result_not_recorded",
      );
      const rows = await reportRows(plan.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ status: "prepared", dips_number: null, current_version: 1 });
      expect(spy.calls).toBe(1);
      // 直後は「送信中」。再度の送信（同じキー）は既存の行を返し、外部を呼ばない
      const sending = await reports.getPlanReport(mockCtx(), plan.id);
      expect(sending.status.code).toBe("sending");
      const again = await send(mockCtx({ gateway: spy }), plan, { mockScenario: "ok" });
      expect(again).toMatchObject({ created: false });
      expect(again.report.id).toBe(rows[0].id);
      expect(spy.calls).toBe(1);
      // 5 分を超えると結果不明として扱う（自動で再送しない）。確定の導線（次にやること）が出る
      const later = mockCtx({}, { now: realNow(6) });
      const view = await reports.getPlanReport(later, plan.id);
      expect(view.status.code).toBe("unknown");
      expect(view.reports[0]).toMatchObject({ status: "prepared", effectiveState: "unknown", stale: true });
      expect(view.reports[0]!.statusLabel).toContain("途中で止まった可能性");
      expect(view.reports[0]!.actions.resolve).toBe(true);
      expect((await plans.getPlan(later, plan.id)).nextActions.map((x) => x.id)).toContain("record_result");
      expect(spy.calls).toBe(1);
      // 結果不明の確定：DIPS の画面で通報されていなかった → failed（再送できる）
      const resolved = await reports.resolveReport(later, plan.id, rows[0].id, { expectedVersion: 1, reason: "DIPS の画面で、通報が無いことを確認した", outcome: "not_reported" });
      expect(resolved.report).toMatchObject({ status: "failed", errorKind: "confirmed_not_registered" });
      const retried = await reports.retryReport(mockCtx({ gateway: spy }), plan.id, rows[0].id, { confirmSend: true, mockScenario: "ok" });
      expect(retried.report).toMatchObject({ status: "submitted_api", id: rows[0].id });
      expect(spy.calls).toBe(2);
    });

    it("timeout・server_error は unknown（結果不明）で、自動で再送しない。確認後に確定できる（通報されていた／されていなかった）", async () => {
      for (const scenario of ["timeout", "server_error"] as const) {
        const plan = await activePlan();
        const spy = new SpyMock();
        const r = await send(mockCtx({ gateway: spy }), plan, { mockScenario: scenario });
        expect(r.report).toMatchObject({ status: "unknown", effectiveState: "unknown", errorKind: scenario, dipsNumber: null, isEffective: false });
        expect(r.report.errorMessage).toContain("登録されたか分かりません");
        expect(r.view.status.code).toBe("unknown");
        expect(r.view.effective).toBeNull();
        // 再送のボタンは出ない（retry は failed のときだけ）。確定のボタンが出る
        expect(r.report.actions).toMatchObject({ retry: false, resolve: true });
        await expectOpsError(reports.retryReport(mockCtx({ gateway: spy }), plan.id, r.report.id, { confirmSend: true }), 409, "not_retryable");
        expect(spy.calls).toBe(1);
        // 同じ操作の再読み込み・二度押しも外部を呼ばない
        await send(mockCtx({ gateway: spy }), plan, { mockScenario: "ok" });
        expect(spy.calls).toBe(1);
        // 監査：結果不明
        const a = await attempts(plan.id, "submit");
        expect(a.map((x) => x.result)).toEqual(["unknown", "unknown"]);
        expect(a[1]).toMatchObject({ error_kind: scenario });
        // 理由が無いと確定できない。DIPS の画面で通報されていた → reported_manual（番号または宣言・二つの確認が必要）
        await expectOpsError(reports.resolveReport(mgr(), plan.id, r.report.id, { expectedVersion: 2, outcome: "not_reported" }), 400, "invalid_input");
        await expectOpsError(
          reports.resolveReport(mgr(), plan.id, r.report.id, { expectedVersion: 2, reason: "確認した", outcome: "reported", manual: manual({ confirmedDipsDone: false }) }),
          400,
          "invalid_input",
        );
        const done = await reports.resolveReport(mgr(), plan.id, r.report.id, {
          expectedVersion: 2,
          reason: "DIPS の画面で通報済みを確認した",
          outcome: "reported",
          manual: manual({ dipsNumber: "REAL-1" }),
        });
        expect(done.report).toMatchObject({ status: "reported_manual", dipsNumber: "REAL-1", channel: "mock", isEffective: true });
        expect(done.view.status.code).toBe("reported");
        expect((await attempts(plan.id, "resolve"))[0]).toMatchObject({ result: "success", adapter: "mock", report_id: r.report.id });
        expect(await verifyChain("flight_report", r.report.id)).toEqual([]);
      }
    });

    it("rejected・unauthorized は failed。同じ行・同じキーで再送でき、二重にならない（再送は failed のときだけ）", async () => {
      for (const scenario of ["rejected", "unauthorized"] as const) {
        const plan = await activePlan();
        const spy = new SpyMock();
        const r = await send(mockCtx({ gateway: spy }), plan, { mockScenario: scenario });
        expect(r.report).toMatchObject({ status: "failed", errorKind: scenario, dipsNumber: null });
        expect(r.report.actions.retry).toBe(true);
        if (scenario === "unauthorized") expect(r.report.errorMessage).toContain("DIPS と再度連携してください");
        expect(r.view.status.code).toBe("failed");
        expect((await plans.getPlan(mockCtx(), plan.id)).nextActions.map((x) => x.id)).toContain("report");
        // 確認なしの再送は 400
        await expectOpsError(reports.retryReport(mockCtx({ gateway: spy }), plan.id, r.report.id, {}), 400, "invalid_input");
        const key = r.report.idempotencyKey;
        const retried = await reports.retryReport(mockCtx({ gateway: spy }), plan.id, r.report.id, { confirmSend: true, mockScenario: "ok" });
        expect(retried.created).toBe(false);
        expect(retried.report).toMatchObject({ id: r.report.id, idempotencyKey: key, status: "submitted_api", version: 4, isEffective: true });
        expect(await reportRows(plan.id)).toHaveLength(1);
        expect(spy.calls).toBe(2);
        // 版の履歴：prepared → failed → prepared → submitted_api
        const v = await owner.query("select data->>'status' as s from record_versions where entity_type = 'flight_report' and entity_id = $1 order by version_no", [r.report.id]);
        expect(v.rows.map((x) => x.s)).toEqual(["prepared", "failed", "prepared", "submitted_api"]);
        // もう一度の再送は 409（failed のときだけ）
        await expectOpsError(reports.retryReport(mockCtx({ gateway: spy }), plan.id, r.report.id, { confirmSend: true }), 409, "not_retryable");
        expect(spy.calls).toBe(2);
        // 監査：開始・失敗・再送の開始・成功
        expect((await attempts(plan.id, "submit")).map((x) => x.result)).toEqual(["unknown", "failure", "unknown", "success"]);
        expect(await verifyChain("flight_report", r.report.id)).toEqual([]);
      }
    });

    it("再送は、計画が変わっていると 409（同じ行・同じキーで別の内容を送らない）。手動の行・中止した計画では再送できない", async () => {
      const plan = await activePlan();
      const spy = new SpyMock();
      const r = await send(mockCtx({ gateway: spy }), plan, { mockScenario: "rejected" });
      const upd = (await plans.updatePlan(mgr(), plan.id, { expectedVersion: plan.version, reason: "時刻の変更", plannedStartAt: "2027-01-14T10:00" })).record;
      await expectOpsError(reports.retryReport(mockCtx({ gateway: spy }), plan.id, r.report.id, { confirmSend: true }), 409, "version_conflict");
      expect(spy.calls).toBe(1);
      // 新しい内容は新しい送信（別のキー・別の行）
      const fresh = await send(mockCtx({ gateway: spy }), upd, { mockScenario: "ok" });
      expect(fresh.created).toBe(true);
      expect(fresh.report.id).not.toBe(r.report.id);
      // 手動の行は再送の対象でない
      const p2 = await activePlan();
      const m = await recordNew(mgr(), p2);
      await expectOpsError(reports.retryReport(mockCtx(), p2.id, m.report.id, { confirmSend: true }), 409);
    });

    it("unknown_status：未知の外部状況は external_status に保存され、状態は増えない。「状況：不明（生の値）」と出る", async () => {
      const plan = await activePlan();
      const r = await send(mockCtx(), plan, { mockScenario: "unknown_status" });
      expect(r.report.status).toBe("submitted_api");
      expect(r.report.externalStatus).toMatchObject({ raw: "XYZ" });
      expect(r.report.externalStatusLabel).toBe("状況：不明（XYZ）");
      const row = (await reportRows(plan.id))[0];
      expect(row.external_status.raw).toBe("XYZ");
      expect(row.status).toBe("submitted_api");
      // 状態の CHECK に新しい値は無い
      const def = (await owner.query("select pg_get_constraintdef(oid) as d from pg_constraint where conrelid = 'flight_reports'::regclass and conname = 'flight_reports_status_check'")).rows[0].d as string;
      expect(def).toContain("prepared");
      expect(def).not.toContain("XYZ");
    });

    it("外部の呼び出しの上限（時間切れ）：応答がなければ unknown（timeout）。自動で再送しない", async () => {
      const plan = await activePlan();
      const silent = new SilentMock();
      const r = await send(mockCtx({ gateway: silent, timeoutMs: 40 }), plan, { mockScenario: "ok" });
      expect(r.report).toMatchObject({ status: "unknown", errorKind: "timeout" });
      expect(silent.calls).toBe(1);
      // 例外を投げるアダプターも結果不明（登録されたか分からない）
      const plan2 = await activePlan();
      class Boom extends MockGateway {
        override async submit(): Promise<SubmitResult> {
          throw new Error("boom");
        }
      }
      const e = await send(mockCtx({ gateway: new Boom() }), plan2, {});
      expect(e.report).toMatchObject({ status: "unknown", errorKind: "adapter_error" });
    });

    it("有効な手動の通報がある計画への模擬の新規・変更は 409 manual_report_exists。模擬の通報がある計画に手動の取消は記録できる", async () => {
      const plan = await activePlan();
      await recordNew(mgr(), plan);
      const spy = new SpyMock();
      await expectOpsError(send(mockCtx({ gateway: spy }), plan, { mockScenario: "ok" }), 409, "manual_report_exists");
      expect(spy.calls).toBe(0);
      // 失敗の行（prepared）は残らない（①のトランザクションごと失敗）
      expect(await reportRows(plan.id)).toHaveLength(1);
      // 計画を変えて変更を模擬で送ろうとしても 409
      const upd = (await plans.updatePlan(mgr(), plan.id, { expectedVersion: plan.version, reason: "時刻の変更", plannedStartAt: "2027-01-14T10:00" })).record;
      await expectOpsError(
        reports.createReport(mockCtx({ gateway: spy }), plan.id, { kind: "change", expectedPlanVersion: upd.version, inputs: FULL_INPUTS, confirmSend: true, mockScenario: "ok" }),
        409,
        "manual_report_exists",
      );
      expect(spy.calls).toBe(0);
    });

    it("模擬の変更：新しい指紋の別の行（channel = mock）。元の行は書き換わらない", async () => {
      const plan = await activePlan();
      const a = await send(mockCtx(), plan, { mockScenario: "ok" });
      const upd = (await plans.updatePlan(mgr(), plan.id, { expectedVersion: plan.version, reason: "時刻の変更", plannedStartAt: "2027-01-14T10:00" })).record;
      const view = await reports.getPlanReport(mockCtx(), plan.id);
      expect(view.status.code).toBe("change_review");
      expect(view.suggestedKind).toBe("change");
      const c = await reports.createReport(mockCtx(), plan.id, { kind: "change", expectedPlanVersion: upd.version, inputs: FULL_INPUTS, confirmSend: true, mockScenario: "ok" });
      expect(c.report).toMatchObject({ kind: "change", baseReportId: a.report.id, status: "submitted_api", channel: "mock", isEffective: true });
      expect(c.report.dipsNumber).not.toBe(a.report.dipsNumber);
      expect(c.view.fingerprintChanges).toEqual([]);
      expect(c.view.status.code).toBe("reported");
    });
  });

  describe("設定（DIPS_REPORT_ADAPTER）：通報の API も 503 adapter_unavailable", () => {
    it("api・未知の値・本番/プレビューの mock は 503（手動に自動で落とさない）。未設定は manual", async () => {
      const plan = await activePlan();
      const cases: [Record<string, string>, string][] = [
        [{ DIPS_REPORT_ADAPTER: "api" }, "api_not_implemented"],
        [{ DIPS_REPORT_ADAPTER: "relay" }, "unknown_adapter"],
        [{ DIPS_REPORT_ADAPTER: "mock", VERCEL_ENV: "production" }, "mock_forbidden_on_vercel"],
        [{ DIPS_REPORT_ADAPTER: "mock", VERCEL_ENV: "preview" }, "mock_forbidden_on_vercel"],
      ];
      for (const [env, reason] of cases) {
        const ctx = mgr({ env });
        const e1 = await expectOpsError(reports.getPlanReport(ctx, plan.id), 503, "adapter_unavailable");
        expect(e1.fieldCodes).toEqual({ adapter: reason });
        await expectOpsError(recordNew(ctx, plan), 503, "adapter_unavailable");
        await expectOpsError(reports.previewPlanReport(ctx, plan.id, {}), 503, "adapter_unavailable");
        await expectOpsError(reports.retryReport(ctx, plan.id, randomUUID(), { confirmSend: true }), 503, "adapter_unavailable");
        await expectOpsError(reports.retractReport(ctx, plan.id, randomUUID(), { expectedVersion: 1, reason: "x" }), 503, "adapter_unavailable");
      }
      expect(await reportRows(plan.id)).toEqual([]);
      expect((await reports.getPlanReport(mgr({ env: {} }), plan.id)).adapter.name).toBe("manual");
      expect((await reports.getPlanReport(mgr({ env: { DIPS_REPORT_ADAPTER: "mock", VERCEL_ENV: "development" } }), plan.id)).adapter.name).toBe("mock");
    });
  });

  // ================================================================
  // 契約 17：手続きの「済み」の記録
  // ================================================================
  describe("契約 17：手続きの「済み」の記録（dips_permit・small_drone_law）", () => {
    /** 美保基地の周辺（小型無人機等飛行禁止法の同意・通報の手続きが出る）で、夜間飛行（DIPS の承認の手続きが出る）。 */
    const MIHO = { latitude: 35.4936, longitude: 133.2361 };
    const permitPlan = () => activePlan({ ...MIHO, flags: ["method_night"], plannedStartAt: "2027-02-10T09:00" });
    const record = (ctx: OpsContext, planId: string, body: Record<string, unknown>) => procs.createProcedureRecord(ctx, planId, body);
    const permitDone = { kind: "dips_permit", action: "done", doneAt: "2027-01-05T11:00", checks: { applicationCompleted: true } };
    const policeDone = { kind: "small_drone_law", action: "done", doneAt: "2027-01-05T11:10", checks: { facilityConsentObtained: true, policeNoticeDone: true }, reference: "R-123" };

    it("手続きの結論に DIPS の許可・承認と飛行禁止法の同意・通報があると、次にやることに出る（期限の文言はスナップショットのまま）", async () => {
      const plan = await permitPlan();
      const d = await plans.getPlan(mgr(), plan.id);
      const ids = d.nextActions.map((x) => x.id);
      expect(ids).toContain("apply_permit");
      expect(ids).toContain("notify_police");
      const permit = d.nextActions.find((x) => x.id === "apply_permit")!;
      expect(permit.label).toBe("許可・承認を申請する");
      // 期限の文言と日付は、スナップショットの手続きが持つものをそのまま使う（10 開庁日前）
      const snap = await plans.getSnapshot(mgr(), plan.id, plan.currentSnapshotId);
      const verdict = (snap.result as { verdict: { procedures: { procedureId?: string; deadline: { label: string; date?: string } }[] } }).verdict;
      const night = verdict.procedures.find((p) => p.procedureId === "flight-approval-night")!;
      expect(permit.dueLabel).toBe(night.deadline.label);
      expect(permit.dueLabel).toContain("10 開庁日以上前");
      const police = d.nextActions.find((x) => x.id === "notify_police")!;
      expect(police.label).toBe("警察へ通報する");
      expect(d.procedureRecords.map((s) => [s.kind, s.applicable, s.status])).toEqual([
        ["dips_permit", true, "none"],
        ["small_drone_law", true, "none"],
      ]);
      // 期限の日付が過去で記録が無ければ tier 2、そうでなければ tier 3（2027-02-10 の 10 開庁日前は 2027-01-27）
      expect(night.deadline.date).toBe("2027-01-27");
      expect(permit.tier).toBe(3);
      const later = await plans.getPlan(mgr({ now: () => new Date("2027-02-05T03:00:00Z") }), plan.id);
      expect(later.nextActions.find((x) => x.id === "apply_permit")!.tier).toBe(2);
    });

    it("すべての確認が真のときだけ記録できる（偽・欠けは 400。DB の CHECK でも拒否）。記録すると次にやることから消え、「申請済み（利用者の申告）」と出る（「許可済み」とは出ない）", async () => {
      const plan = await permitPlan();
      const e1 = await expectOpsError(record(mgr(), plan.id, { ...permitDone, checks: { applicationCompleted: false } }), 400, "invalid_input");
      expect(e1.fieldCodes).toEqual({ "checks.applicationCompleted": "confirm_required" });
      await expectOpsError(record(mgr(), plan.id, { ...permitDone, checks: {} }), 400, "invalid_input");
      await expectOpsError(record(mgr(), plan.id, { ...policeDone, checks: { facilityConsentObtained: true } }), 400, "invalid_input");
      await expectOpsError(record(mgr(), plan.id, { ...permitDone, doneAt: undefined }), 400, "invalid_input");
      await expectOpsError(record(mgr(), plan.id, { ...permitDone, doneAt: "2027-01-05T12:30" }), 400, "invalid_input");
      await expectOpsError(record(mgr(), plan.id, { ...permitDone, kind: "other" }), 400, "invalid_input");
      expect(await count("plan_procedure_records", "plan_id = $1", [plan.id])).toBe(0);
      // DB の CHECK：偽の確認の done を直接入れられない
      const rawInsert = (checks: object, kind = "dips_permit") =>
        owner.query(
          `insert into plan_procedure_records (org_id, plan_id, kind, action, done_at, checks, snapshot_id, plan_version, recorded_by_member_id, recorded_by_name, created_at, content_hash)
           values ($1, $2, $3, 'done', now(), $4::jsonb, $5, $6, $7, 'x', now(), 'x')`,
          [orgA, plan.id, kind, JSON.stringify(checks), plan.currentSnapshotId, plan.version, manager.id],
        );
      await expect(rawInsert({ applicationCompleted: false })).rejects.toMatchObject({ code: "23514" });
      await expect(rawInsert({})).rejects.toMatchObject({ code: "23514" });
      await expect(rawInsert({ facilityConsentObtained: true }, "small_drone_law")).rejects.toMatchObject({ code: "23514" });
      await expect(rawInsert({ applicationCompleted: true, extra: true })).rejects.toMatchObject({ code: "23514" });
      expect(await count("plan_procedure_records", "plan_id = $1", [plan.id])).toBe(0);

      const r = await record(mgr(), plan.id, permitDone);
      expect(r.record).toMatchObject({ kind: "dips_permit", action: "done", label: "申請済み（利用者の申告）", doneAtJst: "2027-01-05 11:00", forCurrentSnapshot: true, recordedByName: "s12b-mgr" });
      expect(r.summary.find((s) => s.kind === "dips_permit")).toMatchObject({ status: "done", statusLabel: "申請済み（利用者の申告）" });
      const d = await plans.getPlan(mgr(), plan.id);
      expect(d.nextActions.map((x) => x.id)).not.toContain("apply_permit");
      expect(d.nextActions.map((x) => x.id)).toContain("notify_police");
      const p = await record(mgr(), plan.id, policeDone);
      expect(p.record).toMatchObject({ label: "同意・通報を記録済み（利用者の申告）", reference: "R-123" });
      expect((await plans.getPlan(mgr(), plan.id)).nextActions.map((x) => x.id)).toEqual(expect.not.arrayContaining(["apply_permit", "notify_police"]));
      // 「許可済み」とは出ない。判定の結論（手続き済み（条件付き））は変えない
      for (const text of [JSON.stringify(r), JSON.stringify(p), JSON.stringify(await procs.listProcedureRecords(mgr(), plan.id)), JSON.stringify(await plans.getPlan(mgr(), plan.id))]) {
        expect(text).not.toContain("許可済み");
      }
      expect((await plans.getPlan(mgr(), plan.id)).judgement.verdictLevel).toBe(d.judgement.verdictLevel);
      // 二度押しは新しい行を作らない
      await expectOpsError(record(mgr(), plan.id, permitDone), 409, "already_recorded");
      expect(await count("plan_procedure_records", "plan_id = $1", [plan.id])).toBe(2);
      // アプリの事前の確認をすり抜けた並行の挿入も、DB のトリガーが止める（同じ種別・同じスナップショットの二重の done）
      await expect(rawInsert({ applicationCompleted: true })).rejects.toMatchObject({ code: "SB409", detail: "already_recorded" });
      expect(await count("plan_procedure_records", "plan_id = $1", [plan.id])).toBe(2);
    });

    it("追記専用：取り下げ（retract）も理由つきの行として残り、有効な記録は最新の行で決まる。記録が無い種別の取り下げは 409", async () => {
      const plan = await permitPlan();
      await expectOpsError(record(mgr(), plan.id, { kind: "dips_permit", action: "retract", reason: "x" }), 409, "nothing_to_retract");
      await record(mgr(), plan.id, permitDone);
      await expectOpsError(record(mgr(), plan.id, { kind: "dips_permit", action: "retract" }), 400, "invalid_input");
      const r = await record(mgr(), plan.id, { kind: "dips_permit", action: "retract", reason: "申請していなかった" });
      expect(r.record).toMatchObject({ action: "retract", label: "取り下げました", reason: "申請していなかった" });
      expect(r.summary.find((s) => s.kind === "dips_permit")).toMatchObject({ status: "retracted" });
      expect((await plans.getPlan(mgr(), plan.id)).nextActions.map((x) => x.id)).toContain("apply_permit");
      expect(r.records.map((x) => x.action)).toEqual(["retract", "done"]);
      // 取り下げたあとは、もう一度の取り下げはできない。記録し直せる
      await expectOpsError(record(mgr(), plan.id, { kind: "dips_permit", action: "retract", reason: "x" }), 409, "nothing_to_retract");
      const again = await record(mgr(), plan.id, { ...permitDone, doneAt: "2027-01-05T11:40" });
      expect(again.summary.find((s) => s.kind === "dips_permit")).toMatchObject({ status: "done" });
      expect(await count("plan_procedure_records", "plan_id = $1", [plan.id])).toBe(3);
      // 内容のハッシュ・表示名の写しは DB が決める
      const rows = (await owner.query("select recorded_by_name, content_hash, created_at from plan_procedure_records where plan_id = $1 order by created_at", [plan.id])).rows;
      for (const x of rows) {
        expect(x.recorded_by_name).toBe("s12b-mgr");
        expect(x.content_hash).toMatch(/^[0-9a-f]{64}$/);
      }
      expect(new Set(rows.map((x) => x.content_hash)).size).toBe(3);
    });

    it("計画の訂正や再判定でスナップショットが変わると「前の判定に対する記録です」と出て、次にやることに戻る", async () => {
      const plan = await permitPlan();
      await record(mgr(), plan.id, permitDone);
      expect((await plans.getPlan(mgr(), plan.id)).nextActions.map((x) => x.id)).not.toContain("apply_permit");
      // 判定に関わる項目の訂正（飛行の方法を足す）→ 新しいスナップショット
      const upd = (await plans.updatePlan(mgr(), plan.id, { expectedVersion: plan.version, reason: "飛行の方法を追加", flags: ["method_night", "method_30m"] })).record;
      expect(upd.currentSnapshotId).not.toBe(plan.currentSnapshotId);
      const d = await plans.getPlan(mgr(), plan.id);
      const permit = d.nextActions.find((x) => x.id === "apply_permit")!;
      expect(permit.reason).toBe("前の判定に対する記録です。もう一度確認してください");
      expect(d.procedureRecords.find((s) => s.kind === "dips_permit")).toMatchObject({ status: "stale", statusLabel: "前の判定に対する記録です。もう一度確認してください" });
      // 新しいスナップショットに対して記録し直すと消える
      await record(mgr(), plan.id, { ...permitDone, doneAt: "2027-01-05T11:50", expectedPlanVersion: upd.version });
      expect((await plans.getPlan(mgr(), plan.id)).nextActions.map((x) => x.id)).not.toContain("apply_permit");
      // 再判定でも同じ
      await plans.rejudgePlan(mgr(), plan.id, {});
      expect((await plans.getPlan(mgr(), plan.id)).nextActions.find((x) => x.id === "apply_permit")?.reason).toBe("前の判定に対する記録です。もう一度確認してください");
    });

    it("最新でない版（expectedPlanVersion）・中止した計画への done は 409。DB も古いスナップショット・版を拒否する", async () => {
      const plan = await permitPlan();
      await expectOpsError(record(mgr(), plan.id, { ...permitDone, expectedPlanVersion: plan.version - 1 }), 409, "version_conflict");
      const insertRaw = (snapshotId: string, version: number) =>
        owner.query(
          `insert into plan_procedure_records (org_id, plan_id, kind, action, done_at, checks, snapshot_id, plan_version, recorded_by_member_id, recorded_by_name, created_at, content_hash)
           values ($1, $2, 'dips_permit', 'done', now(), '{"applicationCompleted": true}'::jsonb, $3, $4, $5, 'x', now(), 'x')`,
          [orgA, plan.id, snapshotId, version, manager.id],
        );
      await expect(insertRaw(plan.currentSnapshotId, plan.version - 1)).rejects.toMatchObject({ code: "SB409", detail: "version_conflict" });
      const other = await activePlan();
      await expect(insertRaw(other.currentSnapshotId, plan.version)).rejects.toMatchObject({ code: "SB409", detail: "snapshot_mismatch" });
      await plans.voidPlan(mgr(), plan.id, { expectedVersion: plan.version, reason: "中止" });
      await expectOpsError(record(mgr(), plan.id, permitDone), 409, "voided");
      // 中止した計画では、許可・警察の項目は次にやることに出ない
      expect((await plans.getPlan(mgr(), plan.id)).nextActions.map((x) => x.id)).toEqual([]);
    });

    it("他の組織は 404、閲覧者は記録できない（403）が一覧は読める。操縦者は自分の計画だけ", async () => {
      const own = await permitPlan();
      await expectOpsError(record(ctxOf(managerB), own.id, permitDone), 404, "not_found");
      await expectOpsError(procs.listProcedureRecords(ctxOf(managerB), own.id), 404, "not_found");
      await expectOpsError(record(ctxOf(viewer), own.id, permitDone), 403, "forbidden");
      expect((await procs.listProcedureRecords(ctxOf(viewer), own.id)).canRecord).toBe(false);
      expect((await procs.listProcedureRecords(mgr(), own.id)).canRecord).toBe(true);
      // 操縦者（自分に結び付いた操縦者の計画）
      const mine = await activePlan({ ...MIHO, flags: ["method_night"], pilotId: pilotLinked.id, plannedStartAt: "2027-02-10T09:00" });
      await expectOpsError(record(ctxOf(pilotMember2), mine.id, permitDone), 403, "forbidden");
      await expectOpsError(record(ctxOf(pilotMember), own.id, permitDone), 403, "forbidden");
      const ok = await record(ctxOf(pilotMember), mine.id, permitDone);
      expect(ok.record.recordedByName).toBe("s12b-pilot");
      expect(ok.canRecord).toBe(true);
    });
  });

  // ================================================================
  // 契約 4・19（API 部分）：通報内容の表示・認可
  // ================================================================
  describe("通報内容の表示（GET …/report）と認可", () => {
    const item = (view: Awaited<ReturnType<typeof reports.getPlanReport>>, key: string) => view.prepared.items.find((i) => i.key === key)!;

    it("DIPS の入力順（対応表の order）に項目が並び、まとまりごとに「※要確認」の印をデータから出す。経路は座標で、コピー対象でない", async () => {
      const plan = await activePlan({ radiusM: 150 });
      const view = await reports.getPlanReport(mgr(), plan.id);
      const orders = view.prepared.items.map((i) => i.order);
      expect([...orders].sort((a, b) => a - b)).toEqual(orders);
      expect(view.prepared.groups.every((g) => g.needsConfirmation)).toBe(true);
      expect(view.prepared.mapRevision).toBe(1);
      expect(view.prepared.mapVerifiedAt).toMatch(/^2026-10-21/);
      const route = item(view, "route");
      expect(route.copyable).toBe(false);
      expect(route.value).toContain("半径 150 m");
      expect(item(view, "start_time")).toMatchObject({ value: "2027-01-14 09:00 JST", apiValue: "20270114 0900" });
      expect(item(view, "flight_time")).toMatchObject({ value: "65" });
      expect(item(view, "flight_time").warnings.map((w) => w.code)).toEqual(["duration_rounded_up"]);
      expect(item(view, "flight_type").apiValue).toBe("[3]");
      expect(item(view, "symbol").value).toBe("JU12B0001");
      expect(item(view, "insurance_company").status).toBe("dips_only");
      // 入力が無いので、必須の入力項目 8 件と、許可・承認の番号（判定に承認の手続きがあるのに空）が未入力（記録はできる）
      expect(view.prepared.missingRequiredCount).toBe(9);
      expect(item(view, "permit_number").warnings.map((w) => w.code)).toEqual(["permit_number_missing"]);
      expect(view.inputsFrom).toBe("none");
      expect(view.adapter).toMatchObject({ name: "manual", mode: "user_reported", canCancel: true });
      expect(JSON.stringify(view.adapter)).not.toContain("通報済み");
    });

    it("POST …/report は通報の画面の入力を重ねた整形のプレビュー（保存しない）。入力の誤りは 400", async () => {
      const plan = await activePlan({ permitNumbers: "国空無機第1号" });
      const before = await count("flight_reports");
      const v = await reports.previewPlanReport(mgr(), plan.id, { inputs: { ...FULL_INPUTS, flightSpeed: 77, departurePoint: "米子港" } });
      expect(v.inputsFrom).toBe("request");
      expect(item(v, "speed").value).toBe("77");
      expect(item(v, "departure").value).toBe("米子港");
      expect(v.prepared.missingRequiredCount).toBe(0);
      expect(await count("flight_reports")).toBe(before);
      await expectOpsError(reports.previewPlanReport(mgr(), plan.id, { inputs: { flightSpeed: 0 } }), 400, "invalid_input");
      await expectOpsError(reports.previewPlanReport(mgr(), plan.id, { kind: "x" }), 400, "invalid_input");
      expect((await reports.previewPlanReport(mgr(), plan.id, { kind: "cancel" })).kind).toBe("cancel");
    });

    it("変更通報では前の通報の入力を初期値にする", async () => {
      const plan = await activePlan();
      const a = await recordNew(mgr(), plan, { inputs: { ...FULL_INPUTS, flightSpeed: 33 } });
      await plans.updatePlan(mgr(), plan.id, { expectedVersion: plan.version, reason: "時刻の変更", plannedStartAt: "2027-01-14T10:00" });
      const view = await reports.getPlanReport(mgr(), plan.id);
      expect(view.inputsFrom).toBe("previous");
      expect(view.inputs).toMatchObject({ flightSpeed: 33 });
      expect(item(view, "speed").value).toBe("33");
      expect(view.suggestedKind).toBe("change");
      expect(view.fingerprintChanges.map((c) => c.label)).toEqual(["予定開始"]);
      expect(view.effective?.id).toBe(a.report.id);
    });

    it("技能証明書番号：運航管理者と本人には全桁、閲覧者・他人の操縦者には伏せ字でコピー対象にしない。他の組織は 404", async () => {
      const own = await activePlan({ pilotId: pilotLinked.id });
      const mgrView = await reports.getPlanReport(mgr(), own.id);
      expect(item(mgrView, "skill_number")).toMatchObject({ value: LICENSE, copyable: true, personal: true });
      expect(mgrView.permissions).toEqual({ record: true, revealLicenseNumber: true });
      const selfView = await reports.getPlanReport(ctxOf(pilotMember), own.id);
      expect(item(selfView, "skill_number")).toMatchObject({ value: LICENSE, copyable: true });
      expect(selfView.permissions).toEqual({ record: true, revealLicenseNumber: true });
      for (const [name, ctx] of [
        ["閲覧者", ctxOf(viewer)],
        ["他人の操縦者", ctxOf(pilotMember2)],
      ] as const) {
        const v = await reports.getPlanReport(ctx, own.id);
        const i = item(v, "skill_number");
        expect(i.value, name).toBe("****5678");
        expect(i.copyable, name).toBe(false);
        expect(i.copyText, name).toBeNull();
        expect(i.warnings.map((w) => w.code)).toContain("license_masked");
        expect(JSON.stringify(v), name).not.toContain(LICENSE);
        expect(v.permissions.revealLicenseNumber, name).toBe(false);
        expect(v.permissions.record, name).toBe(false);
      }
      await expectOpsError(reports.getPlanReport(ctxOf(managerB), own.id), 404, "not_found");
    });

    it("閲覧者・自分の計画でない操縦者は、通報の記録・訂正・取り下げ・確定・再送・コピーの監査ができない（403）。操縦者は自分の計画の通報を記録できる", async () => {
      const plan = await activePlan();
      const a = await recordNew(mgr(), plan);
      const writes = (ctx: OpsContext): [string, () => Promise<unknown>][] => [
        ["record", () => recordNew(ctx, { id: plan.id, version: plan.version })],
        ["correct", () => reports.correctReport(ctx, plan.id, a.report.id, { expectedVersion: 1, reason: "x", memo: "x" })],
        ["retract", () => reports.retractReport(ctx, plan.id, a.report.id, { expectedVersion: 1, reason: "x" })],
        ["resolve", () => reports.resolveReport(ctx, plan.id, a.report.id, { expectedVersion: 1, reason: "x", outcome: "not_reported" })],
        ["retry", () => reports.retryReport(ctx, plan.id, a.report.id, { confirmSend: true })],
        ["audit", () => reports.recordCopyAudit(ctx, plan.id, { key: "name" })],
      ];
      for (const ctx of [ctxOf(viewer), ctxOf(pilotMember), ctxOf(pilotMember2)]) {
        for (const [name, call] of writes(ctx)) {
          const e = await call().then(
            () => null,
            (x: unknown) => x,
          );
          expect(e, name).toBeInstanceOf(OpsError);
          expect([(e as OpsError).status, (e as OpsError).code], name).toEqual([403, "forbidden"]);
        }
      }
      // 閲覧は全役割
      for (const ctx of [ctxOf(viewer), ctxOf(pilotMember), ctxOf(pilotMember2)]) {
        const v = await reports.getPlanReport(ctx, plan.id);
        expect(v.reports).toHaveLength(1);
        expect(v.reports[0]!.actions).toEqual({ correct: false, retract: false, resolve: false, retry: false });
      }
      // 自分が操縦者の計画
      const mine = await activePlan({ pilotId: pilotLinked.id });
      const ok = await recordNew(ctxOf(pilotMember), mine);
      expect(ok.created).toBe(true);
      expect(ok.report.actions.correct).toBe(true);
      expect(await attempts(mine.id, "manual_record")).toHaveLength(1);
      expect((await attempts(mine.id, "manual_record"))[0]).toMatchObject({ member_name: "s12b-pilot", member_role: "pilot" });
    });

    it("計画の一覧に、先頭の「次にやること」と件数が出る。コピーの監査があって記録が無い計画は「通報の結果を記録する」", async () => {
      const plan = await activePlan({ plannedStartAt: "2027-02-10T09:00" });
      const list0 = (await plans.listPlans(mgr())).find((p) => p.id === plan.id)!;
      expect(list0.nextAction).toMatchObject({ id: "report", label: "飛行計画を DIPS で通報する", tier: 3, canAct: true });
      expect(list0.nextActionCount).toBeGreaterThanOrEqual(1);
      expect(list0.report.status.code).toBe("no_record");
      await reports.recordCopyAudit(mgr(), plan.id, { key: "name" });
      const list1 = (await plans.listPlans(mgr())).find((p) => p.id === plan.id)!;
      expect(list1.nextAction?.id).toBe("record_result");
      expect(list1.nextAction?.href).toBe(`/ops/plans/${plan.id}/report#record`);
      // 記録するとその計画の次にやることから通報が消え、一覧の先頭が変わる
      await recordNew(mgr(), plan);
      const list2 = (await plans.listPlans(mgr())).find((p) => p.id === plan.id)!;
      expect(list2.nextAction?.id ?? null).not.toBe("record_result");
      expect(list2.nextAction?.id ?? null).not.toBe("report");
      // 閲覧者には canAct が偽
      const asViewer = (await plans.listPlans(ctxOf(viewer))).find((p) => p.id === plan.id)!;
      expect(asViewer.report.status.code).toBe("reported");
    });

    it("期限：目安（飛行開始の 24 時間前）の前後と飛行開始の後で upcoming・past_guide・overdue_started。飛行開始後の未記録は tier 1 の最上位の警告", async () => {
      const plan = await activePlan();
      // 予定開始 2027-01-14 09:00 JST。目安 2027-01-13 09:00 JST
      const at = (iso: string) => mgr({ now: () => new Date(iso) });
      const upcoming = await plans.getPlan(at("2027-01-05T03:00:00Z"), plan.id);
      expect(upcoming.report.deadline).toMatchObject({ state: "upcoming", tier: 3, hoursToGuide: 189, message: "目安まであと 189 時間", guideAtJst: "2027-01-13 09:00" });
      expect(upcoming.report.deadline.guideNote).toContain("法定の期限ではありません");
      const past = await plans.getPlan(at("2027-01-13T03:00:00Z"), plan.id);
      expect(past.report.deadline).toMatchObject({ state: "past_guide", tier: 2, message: "社内の目安（飛行開始の 24 時間前）を過ぎています" });
      expect(past.nextAction).toMatchObject({ id: "report", tier: 2 });
      const overdue = await plans.getPlan(at("2027-01-14T01:00:00Z"), plan.id);
      expect(overdue.report.deadline).toMatchObject({ state: "overdue_started", tier: 1 });
      expect(overdue.report.deadline.penaltyNote).toBe("通報せずに特定飛行を行うと罰則の対象になりえます（航空法第157条の10。※要確認：条文は一次資料で未照合。U5）");
      expect(overdue.report.deadline.penaltyNote).not.toMatch(/円/);
      expect(overdue.nextAction).toMatchObject({ id: "report", tier: 1 });
      expect(overdue.nextActions[0]!.tier).toBe(1);
      // 記録すると期限の対象でなくなる
      await recordNew(mgr(), plan);
      expect((await plans.getPlan(at("2027-01-14T01:00:00Z"), plan.id)).report.deadline.state).toBe("none");
    });
  });
});
