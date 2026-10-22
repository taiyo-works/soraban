// Sprint 12e 契約 1〜3・6〜8（DB）の DB テスト（pnpm test:db）。
// 使い捨てのデータベースにマイグレーションを適用し、アプリ用ロール soraban_app に切り替えた接続でサービス層を動かす。
// 判定は本物の runDiagnosis（同梱の規制データ・市町村コード固定）。国・DIPS・外部には接続しない。
import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { MemberRow, PilotRow } from "@soraban/db";
import { incidentFactsFingerprint, OPS_TEST_INCIDENTS, OPS_TEST_ORGS, seedOpsTestData } from "../../../../../packages/db/src/ops-seed";
import { createTempDatabase, runCli, withClient, type TempDatabase } from "../../../../../packages/db/src/test-db-helpers";
import { resolveTestDatabaseUrl } from "../../../../../packages/db/src/test-db-env";
import { runRegulationCheckWith } from "../check-core";
import { runDiagnosis } from "../diagnose-core";
import { baselineProvider } from "../sprint11e-baseline";
import { incidentFactsSource } from "./incident-logic";
import * as incidents from "./incidents";
import { incidentFingerprint } from "./incidents";
import type { Judge } from "./judge";
import { toDiagnosisRunInput } from "./plan-logic";
import * as plans from "./plans";
import * as rec from "./records";
import * as svc from "./service";
import { OpsError, type OpsContext } from "./service";
import * as store from "./store";
import type { OpsDb } from "./store";
import * as today from "./today";

const ADMIN_URL = resolveTestDatabaseUrl();
/** サーバーの現在時刻（JST 2027-01-05 12:00）。 */
const NOW = new Date("2027-01-05T03:00:00Z");
const MIN = 60_000;
const DAY = 86_400_000;

const judge: Judge = (input, now) =>
  runDiagnosis(
    toDiagnosisRunInput(input),
    (loc, ctx, n) => runRegulationCheckWith({ ...baselineProvider("31202"), reverseGeocode: async () => ({ muniCode: "31202" }) }, loc, ctx, n),
    now,
  );

const HQ = { latitude: 35.434238, longitude: 133.380508 };

describe.skipIf(!ADMIN_URL)("事故・ヒヤリハットの記録・報告の記録の DB（Sprint 12e）", () => {
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
  let pilotA: PilotRow;
  let pilotOrgB: PilotRow;
  let aircraftW: string;
  let aircraftOrgB: string;
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
      license_number: "TEST-12345678",
      license_expires_on: null,
      member_id: memberId,
    });
    return (await owner.query<PilotRow>("select * from pilots where id = $1", [id])).rows[0]!;
  };

  const ctxOf = (member: MemberRow, over: Partial<OpsContext> = {}): OpsContext => ({
    db: app as unknown as OpsDb,
    member,
    now: () => NOW,
    judge,
    ...over,
  });
  const mgr = (over: Partial<OpsContext> = {}) => ctxOf(manager, over);

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
  const sqlError = async (p: Promise<unknown>): Promise<{ code?: string; detail?: string; constraint?: string }> => {
    const e = await p.then(
      () => null,
      (x: unknown) => x,
    );
    expect(e, "DB の例外が出ていない").not.toBeNull();
    return e as { code?: string; detail?: string; constraint?: string };
  };
  const verifyChain = async (id: string) =>
    (await owner.query("select * from verify_record_chain('incident_record', $1)", [id])).rows as { version_no: number; problem: string }[];
  const verifyReports = async (id: string) =>
    (await owner.query("select * from verify_incident_report_records($1)", [id])).rows as { record_id: string; problem: string }[];

  const FULL = {
    kind: "accident",
    occurredAt: "2027-01-05T11:30",
    summary: "着陸のときにプロペラが手に当たった",
    eventTypes: ["minor_injury"],
    peopleInjury: "yes",
    aircraftDamage: "no",
  };
  const newIncident = async (over: Record<string, unknown> = {}, ctx: OpsContext = mgr()) => (await incidents.createIncident(ctx, { ...FULL, ...over })).record;
  const quick = (over: Record<string, unknown> = {}) => ({ mode: "quick", kind: "near_miss", occurredAt: "2027-01-05T11:58", peopleInjury: "no", clientRequestId: randomUUID(), ...over });

  const planBody = (extra: Record<string, unknown> = {}) => ({
    title: `計画 ${++seq}`,
    aircraftId: aircraftW,
    pilotId: pilotA.id,
    plannedStartAt: "2027-01-14T09:00",
    durationMinutes: 60,
    purpose: "空撮",
    placeName: "フューチャーテック株式会社 本社",
    ...HQ,
    radiusM: 100,
    ...extra,
  });
  const newPlan = async (extra: Record<string, unknown> = {}, ctx: OpsContext = mgr()) => (await plans.createPlan(ctx, planBody(extra))).record;

  /** 版の data の既定値（owner で record_versions に直接入れて、DB の CHECK・トリガーを確かめる）。 */
  const rawData = (over: Record<string, unknown> = {}) => ({
    kind: "accident",
    occurred_at: "2027-01-05T10:00",
    phase: null,
    place_name: null,
    latitude: null,
    longitude: null,
    plan_id: null,
    snapshot_id: null,
    flight_record_id: null,
    aircraft_id: null,
    pilot_id: null,
    event_types: ["minor_injury"],
    people_injury: "yes",
    aircraft_damage: "no",
    injured_count: null,
    contacts_made: [],
    summary: "直接の追加",
    details: null,
    factors_note: null,
    actions_taken: null,
    prevention_note: null,
    detail_pending: false,
    source: "office",
    follow_up_status: "open",
    follow_up_on: null,
    guidance_level: "possible",
    guidance_revision: 1,
    client_request_id: null,
    ...over,
  });
  const rawInsert = (orgId: string, data: Record<string, unknown>, id = randomUUID()) =>
    owner.query(`insert into record_versions (org_id, entity_type, entity_id, op, data, actor_kind) values ($1, 'incident_record', $2, 'create', $3::jsonb, 'system')`, [
      orgId,
      id,
      JSON.stringify(data),
    ]);

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
    manager = await addMember(orgA, "manager", "s12e-mgr");
    pilotMember = await addMember(orgA, "pilot", "s12e-pilot");
    pilotMember2 = await addMember(orgA, "pilot", "s12e-pilot2");
    viewer = await addMember(orgA, "viewer", "s12e-viewer");
    managerB = await addMember(orgB, "manager", "s12e-mgr-b");
    pilotA = await addPilot(orgA, "操縦 一郎", pilotMember.id);
    // pilotMember2 に結び付いた操縦者（「自分の分」の判定で、別の操縦者として使う）
    await addPilot(orgA, "操縦 二郎", pilotMember2.id);
    pilotOrgB = await addPilot(orgB, "組織B 操縦者", null);
    const mk = async (ctx: OpsContext) =>
      (
        await svc.createAircraft(ctx, {
          registrationMark: `JU12E${(seq++).toString().padStart(4, "0")}`,
          modelName: "Matrice 350 RTK",
          manufacturer: "DJI",
          serialNumber: `SN-${seq}`,
          typeCertified: false,
          initialFlightMinutes: 0,
          maxTakeoffWeightKg: 0.9,
        })
      ).id;
    aircraftW = await mk(mgr());
    aircraftOrgB = await mk(ctxOf(managerB));
  });

  afterAll(async () => {
    await app?.end();
    await owner?.end();
    await db?.drop();
    if (createdRole) await withClient(ADMIN_URL!, (c) => c.query("drop role if exists soraban_app"));
  });

  // ================================================================
  // 契約 1：ヘッド表・権限・CHECK・トリガー・verify_record_chain
  // ================================================================
  describe("契約 1：事故・ヒヤリハットの記録（版の履歴）", () => {
    it("作成・訂正・取消がすべて record_versions への版として追記され、連鎖の検証が通る。物理削除はない", async () => {
      const a = await newIncident();
      expect(a.version).toBe(1);
      expect(await verifyChain(a.id)).toEqual([]);
      const u = await incidents.updateIncident(mgr(), a.id, { expectedVersion: 1, reason: "訂正", details: "経過を足した" });
      expect(u.version).toBe(2);
      const v = await incidents.voidIncident(mgr(), a.id, { expectedVersion: 2, reason: "誤登録" });
      expect(v).toMatchObject({ version: 3, voided: true });
      const ops = (await owner.query("select op from record_versions where entity_type = 'incident_record' and entity_id = $1 order by version_no", [a.id])).rows.map((x) => x.op);
      expect(ops).toEqual(["create", "update", "void"]);
      expect(await verifyChain(a.id)).toEqual([]);
      expect((await owner.query("select count(*)::int as n from incident_records where id = $1", [a.id])).rows[0].n).toBe(1);
    });

    it("soraban_app はヘッド表を参照だけできる（INSERT・UPDATE・DELETE・TRUNCATE は 42501）。record_versions への追加で作れる", async () => {
      const a = await newIncident();
      expect((await sqlError(app.query("update incident_records set summary = 'x' where id = $1", [a.id]))).code).toBe("42501");
      expect((await sqlError(app.query("delete from incident_records where id = $1", [a.id]))).code).toBe("42501");
      expect((await sqlError(app.query("truncate incident_records"))).code).toBe("42501");
      expect(
        (
          await sqlError(
            app.query(
              `insert into incident_records (id, org_id, kind, occurred_at, event_types, people_injury, aircraft_damage, summary, source, guidance_level, guidance_revision, current_version, created_at, updated_at)
               values ($1, $2, 'accident', now(), '["none"]', 'no', 'no', 'x', 'office', 'none_selected', 1, 1, now(), now())`,
              [randomUUID(), orgA],
            ),
          )
        ).code,
      ).toBe("42501");
      for (const priv of ["INSERT", "UPDATE", "DELETE", "TRUNCATE"]) {
        expect((await owner.query("select has_table_privilege('soraban_app', 'incident_records', $1) as h", [priv])).rows[0].h, priv).toBe(false);
      }
      expect((await owner.query("select has_table_privilege('soraban_app', 'incident_records', 'SELECT') as h")).rows[0].h).toBe(true);
    });

    it("ヘッド表の CHECK：区分・けがの有無と機体の損傷の値・event_types が空でない配列・detail_pending のときだけ summary が NULL・done は日付が必須・人数はけががあるときだけ・座標は対", async () => {
      const bad: Record<string, Record<string, unknown>> = {
        kind: { kind: "serious" },
        people_injury: { people_injury: "maybe" },
        aircraft_damage: { aircraft_damage: "broken" },
        event_types_empty: { event_types: [] },
        event_types_object: { event_types: { a: 1 } },
        summary_null: { summary: null },
        follow_up_done_without_date: { follow_up_status: "done" },
        follow_up_open_with_date: { follow_up_on: "2027-01-05" },
        injured_count_without_injury: { people_injury: "no", injured_count: 1 },
        injured_count_range: { injured_count: 1000 },
        latitude_only: { latitude: 35.4 },
        contacts_unknown: { contacts_made: ["friend"] },
        guidance_level: { guidance_level: "required" },
        source: { source: "api" },
        summary_too_long: { summary: "あ".repeat(201) },
      };
      for (const [name, over] of Object.entries(bad)) {
        const e = await sqlError(rawInsert(orgA, rawData(over)));
        expect(["23514", "23502"], name).toContain(e.code);
      }
      // 詳細が未記入の簡易記録は summary が NULL でよい
      await rawInsert(orgA, rawData({ summary: null, detail_pending: true, source: "field_quick" }));
      await rawInsert(orgA, rawData({ follow_up_status: "done", follow_up_on: "2027-01-06", people_injury: "yes", injured_count: 2, latitude: 35.4, longitude: 133.3 }));
      // 取消・訂正の版は理由が必須（record_versions の CHECK）
      const id = randomUUID();
      await rawInsert(orgA, rawData(), id);
      const e = await sqlError(
        owner.query(`insert into record_versions (org_id, entity_type, entity_id, op, data, actor_kind) values ($1, 'incident_record', $2, 'void', $3::jsonb, 'system')`, [
          orgA,
          id,
          JSON.stringify(rawData()),
        ]),
      );
      expect(e.code).toBe("23514");
    });

    it("別の組織の計画・飛行記録・機体・操縦者を指せない（SB404）。計画と飛行記録が違う計画なら SB404。スナップショットは DB が計画の現在の値を入れる", async () => {
      const planB = await newPlan({ aircraftId: aircraftOrgB, pilotId: pilotOrgB.id }, ctxOf(managerB));
      const planA = await newPlan();
      const planA2 = await newPlan();
      const frA = await rec.createFlight(mgr(), {
        aircraftId: aircraftW,
        pilotId: pilotA.id,
        purpose: "空撮",
        takeoffPlace: "本社",
        landingPlace: "本社",
        takeoffAt: "2027-01-04T10:00",
        landingAt: "2027-01-04T10:20",
        safetyIssue: false,
        flightPlanId: planA.id,
      });
      for (const [name, over] of Object.entries({
        plan: { plan_id: planB.id },
        aircraft: { aircraft_id: aircraftOrgB },
        pilot: { pilot_id: pilotOrgB.id },
        flight_of_other_plan: { plan_id: planA2.id, flight_record_id: frA.record.id },
      })) {
        expect((await sqlError(rawInsert(orgA, rawData(over)))).code, name).toBe("SB404");
      }
      expect((await sqlError(rawInsert(orgB, rawData({ flight_record_id: frA.record.id })))).code).toBe("SB404");
      // 送った snapshot_id は使われない（計画の現在のスナップショットになる）
      const id = randomUUID();
      await rawInsert(orgA, rawData({ plan_id: planA.id, snapshot_id: randomUUID(), flight_record_id: frA.record.id }), id);
      const head = (await owner.query("select snapshot_id from incident_records where id = $1", [id])).rows[0];
      const plan = (await owner.query("select current_snapshot_id from flight_plans where id = $1", [planA.id])).rows[0];
      expect(head.snapshot_id).toBe(plan.current_snapshot_id);
      expect(await verifyChain(id)).toEqual([]);
    });

    it("(org_id, client_request_id) は NULL でないものの中で一意（別の組織なら同じ値でよい）", async () => {
      const cr = randomUUID();
      await rawInsert(orgA, rawData({ client_request_id: cr }));
      const e = await sqlError(rawInsert(orgA, rawData({ client_request_id: cr })));
      expect(e.code).toBe("23505");
      expect(e.constraint).toBe("uq_incident_records_request");
      await rawInsert(orgB, rawData({ client_request_id: cr }));
      await rawInsert(orgA, rawData({ client_request_id: null }));
      await rawInsert(orgA, rawData({ client_request_id: null }));
    });

    it("verify_record_chain が incident_record を検査し、版の改変・ヘッド表だけの書き換えを検出する", async () => {
      const a = await newIncident({ latitude: 35.434238, longitude: 133.380508, contactsMade: ["emergency_119"], followUpStatus: "done", followUpOn: "2027-01-05", injuredCount: 1 });
      await incidents.updateIncident(mgr(), a.id, { expectedVersion: 1, reason: "訂正", eventTypes: ["minor_injury", "fire_in_flight"] });
      const clean = await newIncident();
      expect(await verifyChain(a.id)).toEqual([]);
      expect(await verifyChain(clean.id)).toEqual([]);
      await owner.query(`update record_versions set data = data || '{"summary": "書き換え"}'::jsonb where entity_type = 'incident_record' and entity_id = $1 and version_no = 2`, [a.id]);
      expect(await verifyChain(a.id)).toEqual(expect.arrayContaining([{ version_no: 2, problem: "content_hash_mismatch" }]));
      await owner.query("update incident_records set occurred_at = occurred_at + interval '1 minute' where id = $1", [clean.id]);
      expect(await verifyChain(clean.id)).toEqual([{ version_no: 1, problem: "head_data_mismatch" }]);
    });
  });

  // ================================================================
  // 契約 2：国への報告の記録（追記専用）
  // ================================================================
  describe("契約 2：国への報告の記録（追記専用）", () => {
    const reportedBody = { action: "reported", doneAt: "2027-01-05T11:40", channel: "dips", reference: "R-0001", checks: { reportCompleted: true } };
    const rawReport = (incidentId: string, over: Record<string, unknown> = {}, orgId = orgA) => {
      const row: Record<string, unknown> = {
        org_id: orgId,
        incident_id: incidentId,
        action: "reported",
        done_at: new Date("2027-01-05T02:40:00Z"),
        channel: "dips",
        channel_note: null,
        reference: "R-1",
        reference_absent: false,
        note: null,
        checks: JSON.stringify({ reportCompleted: true }),
        target_record_id: null,
        incident_version: 99,
        facts_fingerprint: "0".repeat(64),
        reason: null,
        recorded_by_member_id: manager.id,
        recorded_by_name: "偽の名前",
        recorded_by_role: "viewer",
        created_at: new Date("2000-01-01T00:00:00Z"),
        content_hash: "偽",
        ...over,
      };
      const cols = Object.keys(row);
      return owner.query(
        `insert into incident_report_records (${cols.join(",")}) values (${cols.map((_, i) => `$${i + 1}`).join(",")}) returning *`,
        cols.map((c) => row[c]),
      );
    };

    it("soraban_app は参照と追加だけ（UPDATE・DELETE・TRUNCATE は 42501）。オーナーロールでもトリガーが拒む（SB409 immutable）", async () => {
      const a = await newIncident();
      const r = await incidents.createIncidentReport(mgr(), a.id, reportedBody);
      expect(r.record.action).toBe("reported");
      for (const stmt of ["update incident_report_records set note = 'x'", "delete from incident_report_records", "truncate incident_report_records"]) {
        expect((await sqlError(app.query(stmt))).code, stmt).toBe("42501");
        const e = await sqlError(owner.query(stmt));
        expect(e.code, stmt).toBe("SB409");
        expect(e.detail, stmt).toBe("immutable");
      }
      for (const [priv, h] of [
        ["SELECT", true],
        ["INSERT", true],
        ["UPDATE", false],
        ["DELETE", false],
        ["TRUNCATE", false],
      ] as const) {
        expect((await owner.query("select has_table_privilege('soraban_app', 'incident_report_records', $1) as h", [priv])).rows[0].h, priv).toBe(h);
      }
    });

    it("recorded_by_name・recorded_by_role・incident_version・created_at・content_hash は DB が決める（偽の値は上書きされる）", async () => {
      const a = await newIncident();
      await incidents.updateIncident(mgr(), a.id, { expectedVersion: 1, reason: "訂正", details: "x" });
      const row = (await rawReport(a.id)).rows[0];
      expect(row.recorded_by_name).toBe("s12e-mgr");
      expect(row.recorded_by_role).toBe("manager");
      expect(row.incident_version).toBe(2);
      expect(new Date(row.created_at).getUTCFullYear()).toBeGreaterThan(2020);
      expect(row.content_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(await verifyReports(a.id)).toEqual([]);
    });

    it("action ごとの CHECK：番号か「表示されなかった」の一方・その他は補足が必須・consulted は note 必須・retract は理由と対象が必須・確認が欠けると保存できない", async () => {
      const a = await newIncident();
      const bad: Record<string, Record<string, unknown>> = {
        reported_both: { reference_absent: true },
        reported_neither: { reference: null },
        reported_other_without_note: { channel: "other" },
        reported_dips_with_note: { channel_note: "x" },
        reported_no_done_at: { done_at: null },
        reported_checks_missing: { checks: "{}" },
        reported_checks_false: { checks: JSON.stringify({ reportCompleted: false }) },
        consulted_no_note: { action: "consulted", channel: null, reference: null, checks: JSON.stringify({ consultationDone: true }) },
        consulted_wrong_checks: { action: "consulted", channel: null, reference: null, note: "x", checks: JSON.stringify({ reportCompleted: true }) },
        retract_no_reason: { action: "retract", done_at: null, channel: null, reference: null, checks: "{}", target_record_id: randomUUID() },
        retract_no_target: { action: "retract", done_at: null, channel: null, reference: null, checks: "{}", reason: "x" },
        bad_action: { action: "submitted" },
        bad_fingerprint: { facts_fingerprint: "xyz" },
      };
      for (const [name, over] of Object.entries(bad)) {
        const e = await sqlError(rawReport(a.id, over));
        expect(["23514", "23502", "23503", "SB404"], name).toContain(e.code);
      }
      await rawReport(a.id, { channel: "other", channel_note: "電子メール", reference: null, reference_absent: true });
      await rawReport(a.id, { action: "consulted", channel: null, reference: null, note: "窓口に確かめた", checks: JSON.stringify({ consultationDone: true }) });
    });

    it("別の組織・別の記録の行を指せない。retract は reported・consulted だけを指せる。同じ行の二重の取り下げは一意索引で拒む", async () => {
      const a = await newIncident();
      const b = await newIncident();
      const ra = (await rawReport(a.id)).rows[0];
      // 別の組織の行として入れる（記録は組織 A）→ SB404
      expect((await sqlError(rawReport(a.id, {}, orgB))).code).toBe("SB404");
      // 別の記録の行を取り下げられない
      const crossTarget = await sqlError(rawReport(b.id, { action: "retract", done_at: null, channel: null, reference: null, checks: "{}", target_record_id: ra.id, reason: "x" }));
      expect(["SB404", "23503"]).toContain(crossTarget.code);
      const retract = (await rawReport(a.id, { action: "retract", done_at: null, channel: null, reference: null, checks: "{}", target_record_id: ra.id, reason: "誤り" })).rows[0];
      const twice = await sqlError(rawReport(a.id, { action: "retract", done_at: null, channel: null, reference: null, checks: "{}", target_record_id: ra.id, reason: "二重" }));
      expect(twice.code).toBe("23505");
      const ofRetract = await sqlError(rawReport(a.id, { action: "retract", done_at: null, channel: null, reference: null, checks: "{}", target_record_id: retract.id, reason: "x" }));
      expect(ofRetract.code).toBe("SB409");
      expect(ofRetract.detail).toBe("invalid_target");
      // サービス層でも同じ（409）
      await expectOpsError(incidents.createIncidentReport(mgr(), a.id, { action: "retract", targetRecordId: ra.id, reason: "二重" }), 409, "already_retracted");
      await expectOpsError(incidents.createIncidentReport(mgr(), a.id, { action: "retract", targetRecordId: retract.id, reason: "x" }), 409, "invalid_target");
      await expectOpsError(incidents.createIncidentReport(mgr(), b.id, { action: "retract", targetRecordId: ra.id, reason: "x" }), 404, "not_found");
    });

    it("verify_incident_report_records が改変を検出し、soraban_app は実行できない", async () => {
      const a = await newIncident();
      await incidents.createIncidentReport(mgr(), a.id, reportedBody);
      await incidents.createIncidentReport(mgr(), a.id, { action: "consulted", doneAt: "2027-01-05T11:50", note: "窓口に確かめた", checks: { consultationDone: true } });
      expect(await verifyReports(a.id)).toEqual([]);
      expect((await sqlError(app.query("select * from verify_incident_report_records($1)", [a.id]))).code).toBe("42501");
      expect((await owner.query("select has_function_privilege('soraban_app', 'verify_incident_report_records(uuid)', 'EXECUTE') as h")).rows[0].h).toBe(false);
      await owner.query("alter table incident_report_records disable trigger incident_report_records_no_update_delete");
      try {
        const target = (await owner.query("select id from incident_report_records where incident_id = $1 and action = 'reported'", [a.id])).rows[0].id;
        await owner.query("update incident_report_records set reference = 'R-9999' where id = $1", [target]);
        expect(await verifyReports(a.id)).toEqual([{ record_id: target, problem: "content_hash_mismatch" }]);
      } finally {
        await owner.query("alter table incident_report_records enable trigger incident_report_records_no_update_delete");
      }
    });
  });

  // ================================================================
  // 契約 6：作成・訂正・取消・版の履歴・時刻
  // ================================================================
  describe("契約 6：作成・訂正・取消・版の履歴（サービス層）", () => {
    it("full で作成（created=true → 201）、quick で作成（detail_pending・field_quick・類型は unknown・機体の損傷は unknown）", async () => {
      const r = await incidents.createIncident(mgr(), FULL);
      expect(r.created).toBe(true);
      expect(r.record).toMatchObject({ source: "office", detailPending: false, guidance: { level: "possible", revision: 1, status: "confirmed" }, reportState: { code: "none" } });
      expect(r.record.notices.safetyFirst.startsWith("まず、飛行を中止し")).toBe(true);
      const q = await incidents.createIncident(ctxOf(pilotMember), quick({ summary: "読まれない", latitude: 35, longitude: 133 }));
      expect(q.created).toBe(true);
      expect(q.record).toMatchObject({
        source: "field_quick",
        detailPending: true,
        detailPendingLabel: "詳細は未記入（現場の簡易記録）",
        eventTypes: [{ key: "unknown", label: "まだ分からない" }],
        aircraftDamage: "unknown",
        summary: null,
        latitude: null,
        guidance: { level: "possible" },
      });
    });

    it("同じ clientRequestId の再送は新しい行を作らず既存を返す（逐次・並行）。内容が違えば 409 request_conflict。別の利用者でも 409", async () => {
      const body = quick();
      const first = await incidents.createIncident(mgr(), body);
      const again = await incidents.createIncident(mgr(), { ...body, queued: true });
      expect(again.created).toBe(false);
      expect(again.record.id).toBe(first.record.id);
      await expectOpsError(incidents.createIncident(mgr(), { ...body, peopleInjury: "yes" }), 409, "request_conflict");
      await expectOpsError(incidents.createIncident(ctxOf(pilotMember), body), 409, "request_conflict");
      // 並行の 2 リクエスト
      const par = { ...FULL, clientRequestId: randomUUID() };
      const results = await Promise.all([incidents.createIncident(mgr(), par), incidents.createIncident(mgr(), par)]);
      expect(results.map((x) => x.created).sort()).toEqual([false, true]);
      expect(results[0].record.id).toBe(results[1].record.id);
      expect((await owner.query("select count(*)::int as n from incident_records where client_request_id = $1", [par.clientRequestId])).rows[0].n).toBe(1);
      // 送信待ちの再送は、古くなっても（72 時間を超えても）記録済みなら成功として返す
      const late = await incidents.createIncident(mgr({ now: () => new Date(NOW.getTime() + 80 * 60 * MIN) }), { ...body, queued: true });
      expect(late.created).toBe(false);
    });

    it("再送で、最初の要求が明示した引き継ぎの項目を null・空で消すと 409 request_conflict。省略（引き継ぎ待ち）は比べない。最初も空で引き継いだ値なら同じ要求", async () => {
      const p = await newPlan();
      const body = { ...FULL, planId: p.id, placeName: "倉庫の前", clientRequestId: randomUUID() };
      const first = (await incidents.createIncident(mgr(), body)).record;
      expect(first).toMatchObject({ placeName: "倉庫の前", planId: p.id, aircraftId: aircraftW });
      await expectOpsError(incidents.createIncident(mgr(), { ...body, placeName: null }), 409, "request_conflict");
      await expectOpsError(incidents.createIncident(mgr(), { ...body, placeName: "" }), 409, "request_conflict");
      await expectOpsError(incidents.createIncident(mgr(), { ...body, planId: null }), 409, "request_conflict");
      // 省略（undefined）は引き継ぎ待ちとして比べない
      const { placeName: _p, ...omitted } = body;
      void _p;
      const again = await incidents.createIncident(mgr(), omitted);
      expect(again).toMatchObject({ created: false, record: { id: first.id, placeName: "倉庫の前" } });
      // 事務所の入力画面の形（空の項目を null で送る）：最初も空で計画から引き継いだので、同じ本文の再送は同じ要求（200）
      const form = { ...FULL, planId: p.id, aircraftId: null, pilotId: null, placeName: null, latitude: null, longitude: null, clientRequestId: randomUUID() };
      const f1 = (await incidents.createIncident(mgr(), form)).record;
      expect(f1).toMatchObject({ placeName: "フューチャーテック株式会社 本社", aircraftId: aircraftW, pilotId: pilotA.id, latitude: HQ.latitude });
      expect(await incidents.createIncident(mgr(), form)).toMatchObject({ created: false, record: { id: f1.id } });
      // 最初に明示した機体を再送が null で消すと、計画から引き継ぐ機体と違えば 409
      const aircraft2 = (
        await svc.createAircraft(mgr(), {
          registrationMark: `JU12E${(seq++).toString().padStart(4, "0")}`,
          modelName: "Mavic 3",
          manufacturer: "DJI",
          serialNumber: `SN-${seq}`,
          typeCertified: false,
          initialFlightMinutes: 0,
          maxTakeoffWeightKg: 0.9,
        })
      ).id;
      const withAircraft = { ...form, aircraftId: aircraft2, clientRequestId: randomUUID() };
      expect((await incidents.createIncident(mgr(), withAircraft)).record.aircraftId).toBe(aircraft2);
      await expectOpsError(incidents.createIncident(mgr(), { ...withAircraft, aircraftId: null }), 409, "request_conflict");
      // 簡易記録：計画の ID を null で消すと 409。読まない項目（場所・座標など）は比べない
      const q = quick({ planId: p.id });
      const q1 = (await incidents.createIncident(mgr(), q)).record;
      expect(q1.placeName).toBe("フューチャーテック株式会社 本社");
      expect(await incidents.createIncident(mgr(), { ...q, placeName: null, latitude: null, longitude: null })).toMatchObject({ created: false, record: { id: q1.id } });
      await expectOpsError(incidents.createIncident(mgr(), { ...q, planId: null }), 409, "request_conflict");
    });

    it("最初の応答が失われたあとに計画が更新されても、同じ clientRequestId・同じ本文（空の項目を null）の再送は 200。最初に残すのは要求の意図で、引き継いだ現在の値は比べない", async () => {
      const p = await newPlan();
      const form = { ...FULL, planId: p.id, aircraftId: null, pilotId: null, placeName: null, latitude: null, longitude: null, clientRequestId: randomUUID() };
      const first = (await incidents.createIncident(mgr(), form)).record;
      expect(first).toMatchObject({ placeName: "フューチャーテック株式会社 本社", aircraftId: aircraftW, pilotId: pilotA.id });
      // 最初の版に残る要求の意図（省略・null・値を区別する。引き継ぎの結果とは別）
      const v1 = (await owner.query("select data from record_versions where entity_type = 'incident_record' and entity_id = $1 and version_no = 1", [first.id])).rows[0].data;
      expect(v1.client_request_intent).toEqual({ plan_id: "value", aircraft_id: "null", pilot_id: "null", place_name: "null", latitude: "null", longitude: "null" });
      // 計画が更新される（場所・時間が変わる）。引き継いだ現在の値は変わるが、再送の本文は同じ
      await plans.updatePlan(mgr(), p.id, { expectedVersion: p.version, reason: "場所と時間の変更", placeName: "別の場所", durationMinutes: 45 });
      expect((await plans.getPlan(mgr(), p.id)).placeName).toBe("別の場所");
      const again = await incidents.createIncident(mgr(), { ...form, queued: true });
      expect(again).toMatchObject({ created: false, record: { id: first.id, placeName: "フューチャーテック株式会社 本社" } });
      // 訂正のあとの再送も 200（最初の版の意図で比べる）。版の履歴の「変わった項目」に意図の欄は出ない
      await incidents.updateIncident(mgr(), first.id, { expectedVersion: 1, reason: "訂正", details: "経過" });
      expect(await incidents.createIncident(mgr(), form)).toMatchObject({ created: false, record: { id: first.id } });
      const vs = await incidents.listIncidentVersions(mgr(), first.id);
      expect(vs[1]!.changedFields).toContain("経過");
      expect(vs[1]!.changedFields.some((x) => x.includes("intent") || x.includes("意図"))).toBe(false);
      // 明示した値を消す再送・内容の違う再送は、計画が更新されたあとでも 409
      await expectOpsError(incidents.createIncident(mgr(), { ...form, planId: null }), 409, "request_conflict");
      await expectOpsError(incidents.createIncident(mgr(), { ...form, summary: "別の要約" }), 409, "request_conflict");
      // 最初に場所を省略（undefined）した要求の、null で送る再送は同じ要求として扱う（どちらも引き継ぎを任せている）
      const omitted = { ...FULL, planId: p.id, clientRequestId: randomUUID() };
      const o1 = (await incidents.createIncident(mgr(), omitted)).record;
      expect(await incidents.createIncident(mgr(), { ...omitted, placeName: null, aircraftId: null })).toMatchObject({ created: false, record: { id: o1.id } });
    });

    it("訂正は reason と expectedVersion が必須（違えば 409 version_conflict）。訂正前の値は版の履歴に残り、類型・区分の変更で目安が再計算される（本文の目安は読まない）", async () => {
      const a = await newIncident();
      await expectOpsError(incidents.updateIncident(mgr(), a.id, { details: "x" }), 400, "invalid_input");
      await expectOpsError(incidents.updateIncident(mgr(), a.id, { expectedVersion: 5, reason: "訂正", details: "x" }), 409, "version_conflict");
      const u = await incidents.updateIncident(mgr(), a.id, {
        expectedVersion: 1,
        reason: "けがはなかった",
        kind: "near_miss",
        peopleInjury: "no",
        eventTypes: ["none"],
        guidanceLevel: "possible",
        guidance_level: "possible",
      });
      expect(u.guidance.level).toBe("none_selected");
      expect(u.kind).toBe("near_miss");
      const versions = await incidents.listIncidentVersions(mgr(), a.id);
      expect(versions.map((v) => v.op)).toEqual(["create", "update"]);
      expect(versions[0]!.content).toMatchObject({ kind: "accident", guidanceLevel: "possible", eventTypes: [{ key: "minor_injury", label: "人の負傷（軽傷）" }] });
      expect(versions[1]!.content).toMatchObject({ kind: "near_miss", guidanceLevel: "none_selected" });
      expect(versions[1]!.changedFields).toEqual(expect.arrayContaining(["区分", "事象の類型", "けがをした人", "目安"]));
      expect(versions[1]!.prevHash).toBe(versions[0]!.contentHash);
      // 事実の類型だけ（操縦ミスなど）に訂正すると none_selected のまま、possible の類型を足すと possible
      const u2 = await incidents.updateIncident(mgr(), a.id, { expectedVersion: 2, reason: "訂正", eventTypes: ["loss_by_operation"] });
      expect(u2.guidance.level).toBe("none_selected");
      const u3 = await incidents.updateIncident(mgr(), a.id, { expectedVersion: 3, reason: "訂正", eventTypes: ["loss_by_operation", "property_damage"] });
      expect(u3.guidance.level).toBe("possible");
      expect(u3.guidance.reasons.map((r) => r.key)).toEqual(["property_damage"]);
    });

    it("簡易記録の詳細の記入：detailPending を外すには summary が要る。外すまでは summary なしで訂正できる", async () => {
      const q = (await incidents.createIncident(mgr(), quick())).record;
      const keep = await incidents.updateIncident(mgr(), q.id, { expectedVersion: 1, reason: "時刻の訂正", occurredAt: "2027-01-05T11:50" });
      expect(keep).toMatchObject({ detailPending: true, summary: null, source: "field_quick" });
      await expectOpsError(incidents.updateIncident(mgr(), q.id, { expectedVersion: 2, reason: "詳細", detailPending: false }), 400, "invalid_input");
      const done = await incidents.updateIncident(mgr(), q.id, {
        expectedVersion: 2,
        reason: "詳細を記入",
        detailPending: false,
        summary: "鳥が近づいた",
        eventTypes: ["none"],
        aircraftDamage: "no",
      });
      expect(done).toMatchObject({ detailPending: false, summary: "鳥が近づいた", source: "field_quick", guidance: { level: "none_selected" } });
    });

    it("取消は reason が必須で、取消した記録の訂正・報告の記録は拒否される（409 voided）。行は残る", async () => {
      const a = await newIncident();
      await expectOpsError(incidents.voidIncident(mgr(), a.id, { expectedVersion: 1 }), 400, "invalid_input");
      await incidents.voidIncident(mgr(), a.id, { expectedVersion: 1, reason: "誤登録" });
      await expectOpsError(incidents.updateIncident(mgr(), a.id, { expectedVersion: 2, reason: "訂正", details: "x" }), 409, "voided");
      await expectOpsError(incidents.voidIncident(mgr(), a.id, { expectedVersion: 2, reason: "二重" }), 409, "voided");
      await expectOpsError(
        incidents.createIncidentReport(mgr(), a.id, { action: "reported", doneAt: "2027-01-05T11:40", channel: "dips", reference: "R", checks: { reportCompleted: true } }),
        409,
        "voided",
      );
      expect((await incidents.listIncidents(mgr())).some((x) => x.id === a.id)).toBe(false);
      expect((await incidents.listIncidents(mgr(), { includeVoided: true })).find((x) => x.id === a.id)).toMatchObject({ voided: true, voidedLabel: "取消済み" });
    });

    it("計画を結ぶと現在のスナップショットの ID が入り、機体・操縦者・場所が計画から引き継がれる。他の組織の記録・計画は 404", async () => {
      const p = await newPlan();
      const a = await newIncident({ planId: p.id });
      const planRow = (await owner.query("select current_snapshot_id from flight_plans where id = $1", [p.id])).rows[0];
      expect(a).toMatchObject({ planId: p.id, snapshotId: planRow.current_snapshot_id, aircraftId: aircraftW, pilotId: pilotA.id, pilotName: "操縦 一郎", placeName: "フューチャーテック株式会社 本社", latitude: HQ.latitude });
      // 同じ計画のままの訂正では、スナップショットは記録した時点の値を引き継ぐ
      await plans.updatePlan(mgr(), p.id, { expectedVersion: p.version, reason: "時間の変更", durationMinutes: 45 });
      const u = await incidents.updateIncident(mgr(), a.id, { expectedVersion: 1, reason: "訂正", details: "x" });
      expect(u.snapshotId).toBe(planRow.current_snapshot_id);
      const planB = await newPlan({ aircraftId: aircraftOrgB, pilotId: pilotOrgB.id }, ctxOf(managerB));
      await expectOpsError(newIncident({ planId: planB.id }), 404, "not_found");
      await expectOpsError(incidents.getIncident(ctxOf(managerB), a.id), 404, "not_found");
      await expectOpsError(incidents.updateIncident(ctxOf(managerB), a.id, { expectedVersion: 2, reason: "x", details: "y" }), 404, "not_found");
      await expectOpsError(newIncident({ aircraftId: aircraftOrgB }), 404, "not_found");
      await expectOpsError(newIncident({ pilotId: pilotOrgB.id }), 404, "not_found");
    });

    it("時刻の検査：未来 5 分超は future_time。quick のその場の送信で ±5 分超は clock_skew、送信待ちは 72 時間まで（超えると too_old）。full は過去の上限なし", async () => {
      await expectOpsError(newIncident({ occurredAt: "2027-01-05T12:06" }), 400, "future_time");
      expect((await newIncident({ occurredAt: "2027-01-05T12:05" })).occurredAt).toBe("2027-01-05T12:05");
      expect((await newIncident({ occurredAt: "2024-04-01T09:00" })).occurredAt).toBe("2024-04-01T09:00");
      await expectOpsError(incidents.createIncident(mgr(), quick({ occurredAt: "2027-01-05T11:54" })), 400, "clock_skew");
      await expectOpsError(incidents.createIncident(mgr(), quick({ occurredAt: "2027-01-05T12:06" })), 400, "future_time");
      expect((await incidents.createIncident(mgr(), quick({ occurredAt: "2027-01-05T11:55" }))).created).toBe(true);
      expect((await incidents.createIncident(mgr(), quick({ occurredAt: "2027-01-02T12:00", queued: true }))).created).toBe(true);
      await expectOpsError(incidents.createIncident(mgr(), quick({ occurredAt: "2027-01-02T11:59", queued: true })), 400, "too_old");
      await expectOpsError(incidents.createIncident(mgr(), quick({ clientRequestId: undefined })), 400, "invalid_input");
    });
  });

  // ================================================================
  // 契約 7：報告の記録
  // ================================================================
  describe("契約 7：国への報告の記録（利用者の申告）", () => {
    it("reported・consulted・retract が追記され、有効な報告の記録が導出される。確認のチェックが欠けると 400。版と指紋が入り、事実が変わると「内容が変わった」", async () => {
      const a = await newIncident();
      await expectOpsError(incidents.createIncidentReport(mgr(), a.id, { action: "reported", doneAt: "2027-01-05T11:40", channel: "dips", reference: "R" }), 400, "invalid_input");
      await expectOpsError(
        incidents.createIncidentReport(mgr(), a.id, { action: "consulted", doneAt: "2027-01-05T11:40", note: "x", checks: { consultationDone: false } }),
        400,
        "invalid_input",
      );
      await expectOpsError(
        incidents.createIncidentReport(mgr(), a.id, { action: "reported", doneAt: "2027-01-05T12:30", channel: "dips", reference: "R", checks: { reportCompleted: true } }),
        400,
        "future_time",
      );
      const consulted = await incidents.createIncidentReport(mgr(), a.id, { action: "consulted", doneAt: "2027-01-05T11:35", note: "航空局の窓口に確かめた", checks: { consultationDone: true } });
      expect(consulted.reportState).toMatchObject({ code: "consulted", label: "要否を確かめた記録あり（利用者の申告）", changedSinceReport: false });
      const reported = await incidents.createIncidentReport(mgr(), a.id, {
        action: "reported",
        doneAt: "2027-01-05T11:40",
        channel: "other",
        channelNote: "電話",
        referenceAbsent: true,
        checks: { reportCompleted: true },
        incidentVersion: 99,
        factsFingerprint: "x",
        recordedByName: "偽",
      });
      expect(reported.reportState).toMatchObject({ code: "reported", label: "報告の記録あり（利用者の申告）" });
      expect(reported.record).toMatchObject({ incidentVersion: 1, recordedByName: "s12e-mgr", recordedByRole: "manager", referenceAbsent: true, channelLabel: "その他", active: true });
      expect(reported.record.declaration).toBe("報告の記録は、利用者の申告です。そらばんが報告の完了を確認したものではありません。");
      const row = (await owner.query("select * from incident_records where id = $1", [a.id])).rows[0];
      expect(reported.record.factsFingerprint).toBe(incidentFingerprint({ kind: row.kind, event_types: row.event_types, people_injury: row.people_injury, injured_count: row.injured_count }));
      // 事実（類型）を変えると「内容が変わった」
      await incidents.updateIncident(mgr(), a.id, { expectedVersion: 1, reason: "発火もあった", eventTypes: ["minor_injury", "fire_in_flight"] });
      const changed = await incidents.getIncident(mgr(), a.id);
      expect(changed.reportState).toMatchObject({ code: "reported", changedSinceReport: true, changedLabel: "内容が変わりました。追加の報告の要否を確認してください" });
      // 事実以外（経過）の訂正では変わらない
      const b = await newIncident();
      await incidents.createIncidentReport(mgr(), b.id, { action: "reported", doneAt: "2027-01-05T11:40", channel: "dips", reference: "R-2", checks: { reportCompleted: true } });
      await incidents.updateIncident(mgr(), b.id, { expectedVersion: 1, reason: "経過を足した", details: "x" });
      expect((await incidents.getIncident(mgr(), b.id)).reportState.changedSinceReport).toBe(false);
      // 取り下げると有効から外れ、元の行は残る
      const r = await incidents.createIncidentReport(mgr(), a.id, { action: "retract", targetRecordId: reported.record.id, reason: "番号を取り違えた" });
      expect(r.reportState.code).toBe("consulted");
      const detail = await incidents.getIncident(mgr(), a.id);
      expect(detail.reportRecords.map((x) => [x.action, x.retracted, x.active])).toEqual([
        ["consulted", false, true],
        ["reported", true, false],
        ["retract", false, false],
      ]);
      expect(await verifyReports(a.id)).toEqual([]);
    });
  });

  // ================================================================
  // 契約 8：認可・組織の分離・一覧のクエリ数
  // ================================================================
  describe("契約 8：認可と組織の分離", () => {
    it("閲覧者は書けない（403）。操縦者は誰の飛行でも作成でき、訂正・報告の記録は自分の分だけ。取消は運航管理者のみ", async () => {
      const v = ctxOf(viewer);
      await expectOpsError(incidents.createIncident(v, FULL), 403, "forbidden");
      const a = await newIncident({ pilotId: pilotA.id });
      expect((await incidents.getIncident(v, a.id)).id).toBe(a.id);
      await expectOpsError(incidents.updateIncident(v, a.id, { expectedVersion: 1, reason: "x", details: "y" }), 403, "forbidden");
      await expectOpsError(
        incidents.createIncidentReport(v, a.id, { action: "consulted", doneAt: "2027-01-05T11:40", note: "x", checks: { consultationDone: true } }),
        403,
        "forbidden",
      );
      await expectOpsError(incidents.voidIncident(v, a.id, { expectedVersion: 1, reason: "x" }), 403, "forbidden");
      // 記録の操縦者が自分（pilotMember）→ 訂正・報告の記録ができる。取消はできない
      const p1 = ctxOf(pilotMember);
      expect((await incidents.getIncident(p1, a.id)).canUpdate).toBe(true);
      await incidents.updateIncident(p1, a.id, { expectedVersion: 1, reason: "自分の分の訂正", details: "x" });
      await incidents.createIncidentReport(p1, a.id, { action: "consulted", doneAt: "2027-01-05T11:40", note: "x", checks: { consultationDone: true } });
      await expectOpsError(incidents.voidIncident(p1, a.id, { expectedVersion: 2, reason: "x" }), 403, "forbidden");
      // 別の操縦者（作った本人でも記録の操縦者でもない）→ 403
      const p2 = ctxOf(pilotMember2);
      expect((await incidents.getIncident(p2, a.id)).canUpdate).toBe(false);
      await expectOpsError(incidents.updateIncident(p2, a.id, { expectedVersion: 2, reason: "x", details: "y" }), 403, "forbidden");
      // 操縦者は誰の飛行でも作成でき、作った本人なら訂正できる
      const mine = (await incidents.createIncident(p2, { ...FULL, pilotId: pilotA.id })).record;
      expect(mine).toMatchObject({ createdByMemberId: pilotMember2.id, isSelf: true, canUpdate: true, canVoid: false });
      await incidents.updateIncident(p2, mine.id, { expectedVersion: 1, reason: "作った本人の訂正", details: "x" });
      // 組織の分離：一覧に他の組織の記録は出ない
      const bList = await incidents.listIncidents(ctxOf(managerB));
      expect(bList.some((x) => x.id === a.id)).toBe(false);
      await expectOpsError(incidents.listIncidentVersions(ctxOf(managerB), a.id), 404, "not_found");
      await expectOpsError(incidents.createIncidentReport(ctxOf(managerB), a.id, { action: "consulted", doneAt: "2027-01-05T11:40", note: "x", checks: { consultationDone: true } }), 404);
    });

    it("認可のやり直し：最初の認可のあと、ロックを取る前に運航管理者が担当の操縦者を付け替えると、追記・訂正は拒否される（403）。記録は増えない。取消との競合は 409 voided", async () => {
      const pilot2 = (await owner.query<PilotRow>("select * from pilots where member_id = $1", [pilotMember2.id])).rows[0]!;
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
      /**
       * 2 つの接続で競合させる。接続 1 が記録のロックを持ったまま、要求（接続 2）を始め、要求が最初の認可を済ませてロック待ちになるのを確かめてから、
       * 接続 1 で mutate（担当の付け替え・取消）を確定する。そのあとで要求が再開する。
       */
      const race = async (id: string, mutate: (c: store.OpsTx) => Promise<void>, request: () => Promise<unknown>): Promise<unknown> => {
        const c1 = await app.connect();
        try {
          await c1.query("begin");
          await store.lockIncidentOn(c1 as unknown as store.OpsTx, id);
          const pending = request().then(
            () => null,
            (e: unknown) => e,
          );
          for (let i = 0; ; i++) {
            const n = (await owner.query("select count(*)::int as n from pg_locks where locktype = 'advisory' and not granted")).rows[0].n;
            if (n >= 1) break;
            if (i > 250) throw new Error("要求がロック待ちにならなかった");
            await sleep(20);
          }
          await mutate(c1 as unknown as store.OpsTx);
          await c1.query("commit");
          return await pending;
        } catch (e) {
          await c1.query("rollback").catch(() => undefined);
          throw e;
        } finally {
          c1.release();
        }
      };
      const reassign = (id: string) => async (c: store.OpsTx) => {
        const base = (await store.latestVersionData(c as unknown as OpsDb, orgA, "incident_record", id))!;
        await store.appendVersionOn(c, {
          orgId: orgA,
          entityType: "incident_record",
          entityId: id,
          op: "update",
          data: { ...base, pilot_id: pilot2.id },
          reason: "担当の操縦者の付け替え",
          actorMemberId: manager.id,
          expectedVersion: 1,
        });
      };
      const reportCount = async (id: string) => (await owner.query("select count(*)::int as n from incident_report_records where incident_id = $1", [id])).rows[0].n as number;
      const versionCount = async (id: string) => (await owner.query("select count(*)::int as n from record_versions where entity_type = 'incident_record' and entity_id = $1", [id])).rows[0].n as number;
      const p1 = ctxOf(pilotMember);
      const consult = { action: "consulted", doneAt: "2027-01-05T11:40", note: "x", checks: { consultationDone: true } };

      // (1) 担当の操縦者が報告（要否の確認）を追記する要求と、運航管理者の付け替えが競合：付け替えが先に確定 → 403・記録は増えない
      const a = await newIncident({ pilotId: pilotA.id });
      expect((await incidents.getIncident(p1, a.id)).canReport).toBe(true);
      const e1 = await race(a.id, reassign(a.id), () => incidents.createIncidentReport(p1, a.id, consult));
      expect(e1).toBeInstanceOf(OpsError);
      expect((e1 as OpsError).status).toBe(403);
      expect(await reportCount(a.id)).toBe(0);
      expect((await incidents.getIncident(mgr(), a.id)).pilotId).toBe(pilot2.id);
      // 付け替えのあとは、最初の認可の段階でも 403（従来どおり）。運航管理者は追記できる
      await expectOpsError(incidents.createIncidentReport(p1, a.id, consult), 403, "forbidden");
      await incidents.createIncidentReport(mgr(), a.id, consult);
      expect(await reportCount(a.id)).toBe(1);

      // (2) 訂正（対応状況の更新を含む）も同じ。付け替えの後の版を指定しても（最初の認可は通っているため）ロックの後で 403
      const b = await newIncident({ pilotId: pilotA.id });
      const e2 = await race(b.id, reassign(b.id), () => incidents.updateIncident(p1, b.id, { expectedVersion: 2, reason: "対応済み", followUpStatus: "done", followUpOn: "2027-01-05" }));
      expect((e2 as OpsError).status).toBe(403);
      expect(await versionCount(b.id)).toBe(2);
      expect((await incidents.getIncident(mgr(), b.id)).followUpStatus).toBe("open");

      // (3) 取り下げ（retract）も同じ：自分の分の追記が付いた記録で、付け替えのあとに取り下げを送ると 403
      const c = await newIncident({ pilotId: pilotA.id });
      const rec = (await incidents.createIncidentReport(p1, c.id, consult)).record;
      const e3 = await race(c.id, reassign(c.id), () => incidents.createIncidentReport(p1, c.id, { action: "retract", targetRecordId: rec.id, reason: "取り下げ" }));
      expect((e3 as OpsError).status).toBe(403);
      expect(await reportCount(c.id)).toBe(1);

      // (4) 取消との競合：報告の追記は 409 voided（記録は増えない）。取り下げは取消済みの記録にもできる（従来どおり）
      const d = await newIncident({ pilotId: pilotA.id });
      const voidIt = (id: string) => async (cc: store.OpsTx) => {
        const base = (await store.latestVersionData(cc as unknown as OpsDb, orgA, "incident_record", id))!;
        await store.appendVersionOn(cc, { orgId: orgA, entityType: "incident_record", entityId: id, op: "void", data: base, reason: "誤登録", actorMemberId: manager.id, expectedVersion: 1 });
      };
      const e4 = await race(d.id, voidIt(d.id), () => incidents.createIncidentReport(p1, d.id, consult));
      expect((e4 as OpsError).status).toBe(409);
      expect((e4 as OpsError).code).toBe("voided");
      expect(await reportCount(d.id)).toBe(0);

      // (5) 訂正の途中で別の訂正が入ったとき（ロックの前に読んだ記録をもとにした内容を、新しい版へ上書きしない）：409 version_conflict
      const f = await newIncident({ pilotId: pilotA.id });
      const touch = (id: string) => async (cc: store.OpsTx) => {
        const base = (await store.latestVersionData(cc as unknown as OpsDb, orgA, "incident_record", id))!;
        await store.appendVersionOn(cc, { orgId: orgA, entityType: "incident_record", entityId: id, op: "update", data: { ...base, details: "別の訂正" }, reason: "別の訂正", actorMemberId: manager.id, expectedVersion: 1 });
      };
      const e5 = await race(f.id, touch(f.id), () => incidents.updateIncident(p1, f.id, { expectedVersion: 2, reason: "訂正", summary: "上書きされる内容" }));
      expect((e5 as OpsError).status).toBe(409);
      expect((e5 as OpsError).code).toBe("version_conflict");
      expect((await incidents.getIncident(mgr(), f.id)).details).toBe("別の訂正");

      // (6) 取消の競合：二重の取消は 409 voided（既存）。運航管理者の取消は付け替えとは無関係に通る
      const g = await newIncident({ pilotId: pilotA.id });
      const e6 = await race(g.id, voidIt(g.id), () => incidents.voidIncident(mgr(), g.id, { expectedVersion: 1, reason: "二重" }));
      expect((e6 as OpsError).status).toBe(409);
      expect((e6 as OpsError).code).toBe("voided");
    });

    it("一覧の取得に必要なクエリ数が、記録の件数に比例しない（5 件と 50 件で同じ）。絞り込みが効く", async () => {
      const countFor = async (ctx: OpsContext, fn: (c: OpsContext) => Promise<unknown>) => {
        let n = 0;
        const counting = {
          query: (sql: string, params?: unknown[]) => {
            n++;
            return app.query(sql, params as unknown[]);
          },
          connect: () => app.connect(),
        } as unknown as OpsDb;
        await fn({ ...ctx, db: counting });
        return n;
      };
      const org = (await owner.query("insert into organizations (name) values ('組織C') returning id")).rows[0].id;
      const m = await addMember(org, "manager", "s12e-mgr-c");
      const c = ctxOf(m);
      for (let i = 0; i < 5; i++) {
        const x = (await incidents.createIncident(c, { ...FULL, summary: `記録 ${i}` })).record;
        if (i % 2 === 0) await incidents.createIncidentReport(c, x.id, { action: "consulted", doneAt: "2027-01-05T11:40", note: "x", checks: { consultationDone: true } });
      }
      const n5 = await countFor(c, (cc) => incidents.listIncidents(cc));
      for (let i = 5; i < 50; i++) {
        const x = (await incidents.createIncident(c, { ...FULL, summary: `記録 ${i}`, ...(i % 3 === 0 ? { kind: "near_miss", peopleInjury: "no", eventTypes: ["none"] } : {}) })).record;
        if (i % 2 === 0) await incidents.createIncidentReport(c, x.id, { action: "consulted", doneAt: "2027-01-05T11:40", note: "x", checks: { consultationDone: true } });
      }
      const n50 = await countFor(c, (cc) => incidents.listIncidents(cc));
      expect(n50).toBe(n5);
      expect(n5).toBeLessThanOrEqual(2);
      expect(await incidents.listIncidents(c)).toHaveLength(50);
      expect((await incidents.listIncidents(c, { kind: "near_miss" })).every((x) => x.kind === "near_miss")).toBe(true);
      expect((await incidents.listIncidents(c, { reportState: "consulted" })).every((x) => x.reportState.code === "consulted")).toBe(true);
      expect((await incidents.listIncidents(c, { reportState: "none" })).every((x) => x.reportState.code === "none")).toBe(true);
      expect(incidents.parseIncidentFilter(new URLSearchParams("kind=accident&followUp=open&reportState=changed&includeVoided=1&detailPending=1"))).toEqual({
        kind: "accident",
        followUp: "open",
        reportState: "changed",
        includeVoided: true,
        detailPending: true,
      });
      expect(() => incidents.parseIncidentFilter(new URLSearchParams("reportState=done"))).toThrow(OpsError);
      // 「今日」の次にやることの追加分も件数に比例しない
      const t5 = await countFor(c, (cc) => incidents.incidentTodayActions(cc));
      expect(t5).toBeLessThanOrEqual(2);
    });
  });

  // ================================================================
  // 次にやること（今日）・計画と日誌の要約
  // ================================================================
  describe("「今日」の次にやることと、計画・日誌に結び付いた記録", () => {
    it("目安が possible で報告・確認の記録がない記録に「報告の要否を確認する」が出て、日数が経っても消えない。記録を足すと消える。簡易記録は「詳細を記入する」", async () => {
      const org = (await owner.query("insert into organizations (name) values ('組織D') returning id")).rows[0].id;
      const m = await addMember(org, "manager", "s12e-mgr-d");
      const v = await addMember(org, "viewer", "s12e-viewer-d");
      const c = ctxOf(m);
      const a = (await incidents.createIncident(c, FULL)).record;
      const q = (await incidents.createIncident(c, quick())).record;
      const n = (await incidents.createIncident(c, { ...FULL, kind: "near_miss", peopleInjury: "no", eventTypes: ["none"] })).record;
      const ids = async (cc: OpsContext) => (await today.getToday(cc, { limit: 100 })).nextActions.filter((x) => x.id.includes("incident")).map((x) => [x.id, x.href]);
      expect(await ids(c)).toEqual([
        ["confirm_incident_report", `/ops/incidents/${a.id}#report`],
        ["confirm_incident_report", `/ops/incidents/${q.id}#report`],
        ["complete_incident_detail", `/ops/incidents/${q.id}#correct`],
      ]);
      expect((await ids(c)).some(([, href]) => href!.includes(n.id))).toBe(false);
      // 30 日後も報告の要否の確認は出続ける（詳細の記入は 14 日目を過ぎると出ない）
      const later = ctxOf(m, { now: () => new Date(NOW.getTime() + 30 * DAY) });
      expect(await ids(later)).toEqual([
        ["confirm_incident_report", `/ops/incidents/${a.id}#report`],
        ["confirm_incident_report", `/ops/incidents/${q.id}#report`],
      ]);
      // 閲覧者には canAct=false（リンクにせず「運航管理者に依頼」）
      expect((await today.getToday(ctxOf(v), { limit: 100 })).nextActions.filter((x) => x.id === "confirm_incident_report").every((x) => !x.canAct)).toBe(true);
      // 要否を確かめた記録を足すと消える
      await incidents.createIncidentReport(c, a.id, { action: "consulted", doneAt: "2027-01-05T11:40", note: "x", checks: { consultationDone: true } });
      expect((await ids(c)).map(([id, href]) => `${id} ${href}`)).not.toContain(`confirm_incident_report /ops/incidents/${a.id}#report`);
      // 取消すと消える
      await incidents.voidIncident(c, q.id, { expectedVersion: 1, reason: "誤登録" });
      expect(await ids(c)).toEqual([]);
    });

    it("一覧の上限（500 件）を超える組織でも、最も古い未解決の記録に「報告の要否を確認する」が出る。候補は未解決のものだけ（報告済みで事実が同じものは引かない）", async () => {
      const org = (await owner.query("insert into organizations (name) values ('組織E') returning id")).rows[0].id;
      const m = await addMember(org, "manager", "s12e-mgr-e");
      const c = ctxOf(m);
      const oldest = (await incidents.createIncident(c, { ...FULL, occurredAt: "2024-04-01T09:00", summary: "最も古い未解決の記録" })).record;
      // 報告の要否を確かめた記録（事実が同じ）→ 候補に入らない。対応状況だけの訂正（版は上がる・事実は同じ）でも入らない
      const consulted = (await incidents.createIncident(c, { ...FULL, occurredAt: "2024-05-01T09:00", summary: "確かめ済み" })).record;
      await incidents.createIncidentReport(c, consulted.id, { action: "consulted", doneAt: "2027-01-05T11:40", note: "x", checks: { consultationDone: true } });
      await incidents.updateIncident(c, consulted.id, { expectedVersion: 1, reason: "対応済み", followUpStatus: "done", followUpOn: "2027-01-05" });
      // 報告の記録のあとで事実が変わった記録 → 候補に入る（「内容が変わりました」）
      const changed = (await incidents.createIncident(c, { ...FULL, occurredAt: "2024-06-01T09:00", summary: "あとで変わった" })).record;
      await incidents.createIncidentReport(c, changed.id, { action: "consulted", doneAt: "2027-01-05T11:40", note: "x", checks: { consultationDone: true } });
      await incidents.updateIncident(c, changed.id, { expectedVersion: 1, reason: "類型の追加", eventTypes: ["minor_injury", "property_damage"] });
      // それより新しい記録を SQL でまとめて 520 件入れる（目安が none_selected。一覧の上限を超える）
      await owner.query(
        `insert into record_versions (org_id, entity_type, entity_id, op, data, actor_kind)
         select $1, 'incident_record', gen_random_uuid(), 'create', $2::jsonb || jsonb_build_object('summary', '一括 ' || g), 'system'
           from generate_series(1, 520) g`,
        [org, JSON.stringify(rawData({ kind: "near_miss", occurred_at: "2026-12-01T10:00", event_types: ["none"], people_injury: "no", guidance_level: "none_selected" }))],
      );
      const list = await incidents.listIncidents(c);
      expect(list).toHaveLength(500);
      expect(list.some((x) => x.id === oldest.id)).toBe(false);
      const actions = await incidents.incidentTodayActions(c);
      expect(actions.filter((x) => x.id === "confirm_incident_report").map((x) => x.href).sort()).toEqual(
        [`/ops/incidents/${oldest.id}#report`, `/ops/incidents/${changed.id}#report`].sort(),
      );
      expect(actions.find((x) => x.href === `/ops/incidents/${changed.id}#report`)!.reason).toContain("内容が変わりました");
      expect((await store.listIncidentTodayCandidates(app as unknown as OpsDb, org, "2026-12-22")).map((r) => r.id).sort()).toEqual([oldest.id, changed.id].sort());
      // 「今日」の画面（上位の件数の中）にも出る
      expect((await today.getToday(c, { limit: 100 })).nextActions.some((x) => x.href === `/ops/incidents/${oldest.id}#report`)).toBe(true);

      // 派生の絞り込み（報告の状態・詳細の未記入）は上限（500 件）の前にかかる。古い一致する記録が漏れない
      const oldPending = (
        await owner.query(
          `insert into record_versions (org_id, entity_type, entity_id, op, data, actor_kind) values ($1, 'incident_record', gen_random_uuid(), 'create', $2::jsonb, 'system') returning entity_id`,
          [org, JSON.stringify(rawData({ occurred_at: "2024-03-01T09:00", summary: null, detail_pending: true, source: "field_quick", event_types: ["unknown"], people_injury: "no", kind: "near_miss" }))],
        )
      ).rows[0].entity_id as string;
      const idsOf = async (f: incidents.IncidentListFilter) => (await incidents.listIncidents(c, f)).map((x) => x.id);
      expect(await idsOf({ detailPending: true })).toEqual([oldPending]);
      expect(await idsOf({ reportState: "changed" })).toEqual([changed.id]);
      expect((await idsOf({ reportState: "consulted" })).sort()).toEqual([consulted.id, changed.id].sort());
      expect(await idsOf({ reportState: "reported" })).toEqual([]);
      const none = await idsOf({ reportState: "none" });
      expect(none).toHaveLength(500);
      expect(none).not.toContain(consulted.id);
      expect(await idsOf({ reportState: "none", detailPending: true })).toEqual([oldPending]);
      // 区分・対応の状況の絞り込みも、上限の前（古い記録に届く）
      expect(await idsOf({ kind: "accident" })).toEqual([oldest.id, consulted.id, changed.id].reverse());
      expect(await idsOf({ followUp: "done" })).toEqual([consulted.id]);
      // クエリの数は件数に比例しない（絞り込みの有無で同じ）
      let n = 0;
      const counting = { query: (sql: string, params?: unknown[]) => (n++, app.query(sql, params as unknown[])), connect: () => app.connect() } as unknown as OpsDb;
      await incidents.listIncidents({ ...c, db: counting }, { reportState: "changed" });
      expect(n).toBeLessThanOrEqual(2);
      // 確かめた記録を取り下げると、再び候補に入る
      const rec1 = (await incidents.getIncident(c, consulted.id)).reportRecords[0]!;
      await incidents.createIncidentReport(c, consulted.id, { action: "retract", targetRecordId: rec1.id, reason: "誤り" });
      expect((await incidents.incidentTodayActions(c)).some((x) => x.href === `/ops/incidents/${consulted.id}#report`)).toBe(true);
      // 詳細の記入待ちは、起きた日から 14 日目までの分だけを候補に引く（報告の要否を確かめたあとでも詳細の記入は出る）
      const q10 = (await incidents.createIncident(ctxOf(m, { now: () => new Date(NOW.getTime() - 10 * DAY) }), quick({ occurredAt: "2026-12-26T11:58" }))).record;
      const q20 = (await incidents.createIncident(ctxOf(m, { now: () => new Date(NOW.getTime() - 20 * DAY) }), quick({ occurredAt: "2026-12-16T11:58" }))).record;
      for (const q of [q10, q20]) {
        await incidents.createIncidentReport(c, q.id, { action: "consulted", doneAt: "2027-01-05T11:40", note: "x", checks: { consultationDone: true } });
      }
      const ids = (await store.listIncidentTodayCandidates(app as unknown as OpsDb, org, "2026-12-22")).map((r) => r.id);
      expect(ids).toContain(q10.id);
      expect(ids).not.toContain(q20.id);
      const after = await incidents.incidentTodayActions(c);
      expect(after.some((x) => x.id === "complete_incident_detail" && x.href === `/ops/incidents/${q10.id}#correct`)).toBe(true);
      expect(after.some((x) => x.href.includes(q20.id))).toBe(false);
    });

    it("計画・日誌に結び付いた記録の要約。日誌の「安全に影響のあった事項」は記録を自動で作らず、入力画面への経路だけを返す", async () => {
      const p = await newPlan({ plannedStartAt: "2027-01-03T09:00" });
      const f = await rec.createFlight(mgr(), {
        aircraftId: aircraftW,
        pilotId: pilotA.id,
        purpose: "空撮",
        takeoffPlace: "本社",
        landingPlace: "本社",
        takeoffAt: "2027-01-03T09:00",
        landingAt: "2027-01-03T09:20",
        safetyIssue: true,
        safetyIssueDetail: "着陸のときに機体が傾いた",
        flightPlanId: p.id,
      });
      const before = await incidents.listFlightIncidents(mgr(), f.record.id);
      expect(before).toMatchObject({ count: 0, safetyIssue: true, safetyIssueDetail: "着陸のときに機体が傾いた", planId: p.id });
      expect(before.safetyIssueHref).toBe(`/ops/incidents/new?planId=${p.id}&flightRecordId=${f.record.id}&summary=${encodeURIComponent("着陸のときに機体が傾いた")}`);
      expect((await owner.query("select count(*)::int as n from incident_records where flight_record_id = $1", [f.record.id])).rows[0].n).toBe(0);
      // 日誌から記録すると、計画・機体・操縦者を引き継ぐ
      const a = await newIncident({ flightRecordId: f.record.id });
      expect(a).toMatchObject({ planId: p.id, flightRecordId: f.record.id, aircraftId: aircraftW, pilotId: pilotA.id });
      await expectOpsError(newIncident({ flightRecordId: f.record.id, planId: (await newPlan()).id }), 400, "invalid_input");
      expect((await incidents.listFlightIncidents(mgr(), f.record.id)).count).toBe(1);
      const pl = await incidents.listPlanIncidents(ctxOf(viewer), p.id);
      expect(pl).toMatchObject({ planId: p.id, count: 1, newHref: `/ops/incidents/new?planId=${p.id}`, quickHref: `/ops/plans/${p.id}/field/incident`, canCreate: false });
      await expectOpsError(incidents.listPlanIncidents(ctxOf(managerB), p.id), 404, "not_found");
      await expectOpsError(incidents.listFlightIncidents(ctxOf(managerB), f.record.id), 404, "not_found");
      // 飛行記録の列・保存の挙動は変わらない（日誌側に列を足していない）
      const cols = (await owner.query("select column_name from information_schema.columns where table_name = 'flight_records'")).rows.map((x) => x.column_name);
      expect(cols.some((c: string) => c.includes("incident"))).toBe(false);
    });
  });

  // ================================================================
  // 契約 3：テスト用の初期データ（seed）
  // ================================================================
  describe("契約 3：テスト用の初期データ", () => {
    it("組織 A に 7 件・組織 B に 1 件の記録ができ、版の連鎖・報告の記録のハッシュが通る。指紋の規則はアプリと同じ", async () => {
      const r = await seedOpsTestData(owner);
      expect(r.created).toBe(true);
      const rows = (
        await owner.query(
          `select i.*, o.name as org_name from incident_records i join organizations o on o.id = i.org_id where o.name = any($1) order by i.occurred_at`,
          [Object.values(OPS_TEST_ORGS)],
        )
      ).rows;
      expect(rows.filter((x) => x.org_name === OPS_TEST_ORGS.a)).toHaveLength(7);
      expect(rows.filter((x) => x.org_name === OPS_TEST_ORGS.b)).toHaveLength(1);
      for (const x of rows) expect(await verifyChain(x.id), x.summary ?? "quick").toEqual([]);
      const by = (s: string | null) => rows.find((x) => x.summary === s)!;
      expect(rows.filter((x) => x.detail_pending && x.source === "field_quick")).toHaveLength(1);
      expect(by(OPS_TEST_INCIDENTS.voided).voided_at).not.toBeNull();
      expect(by(OPS_TEST_INCIDENTS.journalLinked).flight_record_id).not.toBeNull();
      expect(by(OPS_TEST_INCIDENTS.nearMissDone)).toMatchObject({ follow_up_status: "done", guidance_level: "none_selected" });
      // サービス層で読むと、④は報告の記録あり、⑤は内容が変わった、①は報告の記録なし
      const managerA = (await owner.query<MemberRow>("select * from members where email = 'a-manager@example.test'")).rows[0]!;
      const list = await incidents.listIncidents(ctxOf(managerA), { includeVoided: true });
      const dto = (s: string) => list.find((x) => x.summary === s)!;
      expect(dto(OPS_TEST_INCIDENTS.reported).reportState).toMatchObject({ code: "reported", changedSinceReport: false });
      expect(dto(OPS_TEST_INCIDENTS.changedAfterReport).reportState).toMatchObject({ code: "reported", changedSinceReport: true });
      expect(dto(OPS_TEST_INCIDENTS.accidentNoReport).reportState.code).toBe("none");
      for (const x of rows) expect(await verifyReports(x.id)).toEqual([]);
      // 保存した目安は、版 1 のデータで計算し直した値と一致する
      const managerBSeed = (await owner.query<MemberRow>("select * from members where email = 'b-manager@example.test'")).rows[0]!;
      const all = [...list, ...(await incidents.listIncidents(ctxOf(managerBSeed)))];
      expect(all).toHaveLength(8);
      for (const d of all) {
        const x = rows.find((y) => y.id === d.id)!;
        expect(d.guidance.level, d.summary ?? "quick").toBe(x.guidance_level);
        // 版 1 のデータで類型から計算し直しても同じ
        expect((await import("@/lib/ops-incident")).incidentGuidance(x.event_types, x.guidance_revision).level).toBe(x.guidance_level);
      }
      // 指紋の規則（seed とアプリ）が同じ
      const facts = { kind: "accident", event_types: ["property_damage", "minor_injury"], people_injury: "yes", injured_count: 1 };
      expect(incidentFactsFingerprint(facts)).toBe(incidentFingerprint(facts));
      expect(incidentFactsSource(facts)).toContain("soraban-incident-facts-v1");
    });
  });
});
