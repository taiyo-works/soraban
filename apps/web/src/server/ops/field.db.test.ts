// Sprint 12c 契約 1・3・4・5・6 の DB テスト（pnpm test:db）。
// 使い捨てのデータベースにマイグレーションを適用し、アプリ用ロール soraban_app に切り替えた接続でサービス層を動かす。
// 判定は本物の runDiagnosis に、同梱の規制データと市町村コード固定の読み込み口を渡して実行する（国土地理院へ接続しない）。
// DIPS へは送信しない（ネットワーク呼び出しを持たない）。
import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { MemberRow, PilotRow } from "@soraban/db";
import { INSPECTION_ITEMS } from "@/lib/ops-records";
import { createTempDatabase, runCli, withClient, type TempDatabase } from "../../../../../packages/db/src/test-db-helpers";
import { resolveTestDatabaseUrl } from "../../../../../packages/db/src/test-db-env";
import { runRegulationCheckWith } from "../check-core";
import { runDiagnosis } from "../diagnose-core";
import { baselineProvider } from "../sprint11e-baseline";
import * as field from "./field";
import { journalPreInspectionId } from "./field-logic";
import type { Judge } from "./judge";
import { toDiagnosisRunInput } from "./plan-logic";
import * as plans from "./plans";
import * as rec from "./records";
import * as reports from "./reports";
import * as svc from "./service";
import { OpsError, type OpsContext } from "./service";
import type { OpsDb } from "./store";
import * as store from "./store";
import * as today from "./today";

const ADMIN_URL = resolveTestDatabaseUrl();
/** サーバーの現在時刻（JST 2027-01-05 12:00）。 */
const NOW = new Date("2027-01-05T03:00:00Z");
const SRC = "mlit-emergency-airspace-qa";
const LICENSE = "TEST-12345678";
const PILOT_NAME = "秘匿 太郎";

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
const ITEMS = Object.fromEntries(INSPECTION_ITEMS.map((it) => [it.key, { result: "normal" }]));

type Org = {
  readonly id: string;
  readonly manager: MemberRow;
  readonly pilotMember: MemberRow;
  readonly pilotMember2: MemberRow;
  readonly viewer: MemberRow;
  /** pilotMember に結び付いた操縦者。 */
  readonly pilotLinked: PilotRow;
  /** どの利用者にも結び付かない操縦者（氏名・技能証明書番号の秘匿の検査に使う）。 */
  readonly pilotFree: PilotRow;
  readonly aircraft: string;
};

describe.skipIf(!ADMIN_URL)("現場の事実の記録（flight_field_events）の DB", () => {
  let db: TempDatabase;
  let createdRole = false;
  let owner: pg.Pool;
  let app: pg.Pool;
  let A: Org;
  let B: Org;
  let seq = 0;
  /** 発行した SQL を数える・記録する口（アプリ用ロールの接続）。 */
  const log: { sql: string[] } = { sql: [] };
  const countingDb = (): OpsDb => ({
    query: ((sql: string, params?: unknown[]) => {
      log.sql.push(sql);
      return app.query(sql, params);
    }) as OpsDb["query"],
    connect: (async () => {
      const c = await app.connect();
      const q = c.query.bind(c) as unknown as OpsDb["query"];
      return {
        query: ((sql: string, params?: unknown[]) => {
          log.sql.push(sql);
          return q(sql, params);
        }) as OpsDb["query"],
        release: () => c.release(),
      };
    }) as OpsDb["connect"],
  });

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
      email: `${label.toLowerCase()}@example.test`,
      display_name: label,
      role,
      status: "active",
      auth_provider: "test",
      auth_user_id: label,
    });
    return (await owner.query<MemberRow>("select * from members where id = $1", [id])).rows[0]!;
  };
  const addPilot = async (orgId: string, fullName: string, memberId: string | null, expires: string | null = null): Promise<PilotRow> => {
    const id = await addVersion(orgId, "pilot", {
      full_name: fullName,
      has_license: true,
      license_class: "second",
      license_number: LICENSE,
      license_expires_on: expires,
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
    env: {},
    ...over,
  });
  const mgr = (o: Org = A, over: Partial<OpsContext> = {}) => ctxOf(o.manager, over);

  const makeOrg = async (label: string, weightKg = 0.9, licenseExpires: string | null = null): Promise<Org> => {
    const id = (await owner.query("insert into organizations (name) values ($1) returning id", [`組織 ${label}`])).rows[0].id as string;
    const manager = await addMember(id, "manager", `${label}-mgr`);
    const pilotMember = await addMember(id, "pilot", `${label}-pilot`);
    const pilotMember2 = await addMember(id, "pilot", `${label}-pilot2`);
    const viewer = await addMember(id, "viewer", `${label}-viewer`);
    const pilotLinked = await addPilot(id, `${label} 一郎`, pilotMember.id, licenseExpires);
    const pilotFree = await addPilot(id, `${PILOT_NAME}${label}`, null);
    await addPilot(id, `${label} 三郎`, pilotMember2.id);
    const aircraft = (
      await svc.createAircraft(ctxOf(manager), {
        registrationMark: `JU12C${(seq++).toString().padStart(4, "0")}`,
        modelName: "Matrice 350 RTK",
        manufacturer: "DJI",
        serialNumber: `SN-${seq}`,
        typeCertified: false,
        initialFlightMinutes: 0,
        maxTakeoffWeightKg: weightKg,
      })
    ).id;
    return { id, manager, pilotMember, pilotMember2, viewer, pilotLinked, pilotFree, aircraft };
  };

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
  const eventRows = async (planId: string) =>
    (await owner.query("select * from flight_field_events where plan_id = $1 order by recorded_at, id", [planId])).rows;

  /** 夜間飛行の計画（通報は要）。既定は今日 13:00〜14:00、操縦者は利用者に結び付かない操縦者。 */
  const planInput = (o: Org, extra: Record<string, unknown> = {}) => ({
    title: `現場の計画 ${++seq}`,
    aircraftId: o.aircraft,
    pilotId: o.pilotFree.id,
    plannedStartAt: "2027-01-05T13:00",
    durationMinutes: 60,
    purpose: "空撮",
    placeName: "フューチャーテック株式会社 本社",
    ...HQ,
    radiusM: 100,
    maxAltitudeM: 50,
    accessControl: true,
    flags: ["method_night"],
    ...extra,
  });
  const newPlan = async (o: Org = A, extra: Record<string, unknown> = {}, ctx?: OpsContext) =>
    (await plans.createPlan(ctx ?? mgr(o), planInput(o, extra))).record;
  /** 確認を依頼して確認した計画（確認済み）。 */
  const approvedPlan = async (o: Org = A, extra: Record<string, unknown> = {}) => {
    const p = await newPlan(o, extra);
    const r = await plans.requestConfirmation(mgr(o), p.id, { expectedVersion: p.version });
    return (await plans.confirmPlan(mgr(o), p.id, { decision: "approved", expectedVersion: r.version })).plan;
  };
  const cid = () => randomUUID();
  const body = (kind: string, extra: Record<string, unknown> = {}) => ({ kind, clientEventId: cid(), occurredAt: "2027-01-05T12:00", ...extra });
  const post = (o: Org, planId: string, b: Record<string, unknown>, ctx?: OpsContext) => field.recordFieldEvent(ctx ?? mgr(o), planId, b);
  const checkBody = (item: string, extra: Record<string, unknown> = {}) =>
    body("check", { item, ...(item === "emergency_airspace" ? { result: "not_designated", source: SRC } : {}), ...extra });
  const SITE_OK = { thirdParty: "none", otherAircraft: "none", rain: "none", visibility: "good", windMs: 3.2, tempC: 18 };
  const flightInput = (o: Org, takeoffAt: string, landingAt: string, extra: Record<string, unknown> = {}) => ({
    aircraftId: o.aircraft,
    pilotId: o.pilotFree.id,
    purpose: "空撮",
    takeoffPlace: "米子市日吉津 本社",
    landingPlace: "米子市日吉津 本社",
    takeoffAt,
    landingAt,
    safetyIssue: false,
    ...extra,
  });
  const inspect = (o: Org, at: string, extra: Record<string, unknown> = {}) =>
    rec.createInspection(mgr(o), { aircraftId: o.aircraft, pilotId: o.pilotFree.id, inspectedAt: at, placeName: "本社", items: ITEMS, ...extra });
  const reportNew = (o: Org, plan: { id: string; version: number }, reportedAt: string) =>
    reports.createReport(mgr(o), plan.id, {
      kind: "new",
      expectedPlanVersion: plan.version,
      manual: { reportedAt, dipsNumber: "FP-0001", confirmedDipsDone: true, confirmedMatchesLatest: true },
      inputs: { flightPurposes: [1], assistantsNumber: 1, plannedMaxTime: 30, flightSpeed: 10, onsiteControlL3: "1", onsiteControlL35: "0", onsiteControl2: "1", mooring: "0" },
    });

  beforeAll(async () => {
    createdRole = await withClient(ADMIN_URL!, async (c) => {
      const exists = (await c.query("select 1 from pg_roles where rolname = 'soraban_app'")).rowCount === 1;
      if (!exists) await c.query("create role soraban_app nologin");
      return !exists;
    });
    db = await createTempDatabase(ADMIN_URL!);
    const r = await runCli(["migrate"], { DATABASE_URL_UNPOOLED: db.url });
    expect(r.code, r.stderr).toBe(0);
    owner = new pg.Pool({ connectionString: db.url, max: 6 });
    app = new pg.Pool({ connectionString: db.url, max: 10, options: "-c role=soraban_app" });
    A = await makeOrg("A");
    B = await makeOrg("B");
  });

  afterAll(async () => {
    await app?.end();
    await owner?.end();
    await db?.drop();
    if (createdRole) await withClient(ADMIN_URL!, (c) => c.query("drop role if exists soraban_app"));
  });

  // ---- 契約 1：テーブル・権限・トリガー・CHECK・外部キー ----------------------------------

  let O: Org;
  beforeEach(async () => {
    O = await makeOrg(`o${++seq}`);
  });

  describe("1. 追記専用のテーブル", () => {
    /** オーナーで 1 行を直接入れる（アプリを通さない。列の制約の検査用）。 */
    const raw = async (planId: string, org: Org, cols: Record<string, unknown>, client: pg.Pool = owner) => {
      const all: Record<string, unknown> = {
        org_id: org.id,
        plan_id: planId,
        kind: "check",
        item: "carry",
        result: "done",
        occurred_at: "2027-01-05T03:00:00Z",
        client_event_id: cid(),
        recorded_by_member_id: org.manager.id,
        ...cols,
      };
      const keys = Object.keys(all);
      const sql = `insert into flight_field_events (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")}) returning *`;
      return (await client.query(sql, keys.map((k) => (k === "gaps" && all[k] !== null ? JSON.stringify(all[k]) : all[k])))).rows[0];
    };
    const sqlState = async (p: Promise<unknown>): Promise<{ code: string; detail?: string; constraint?: string }> => {
      const e = await p.then(
        () => null,
        (x: unknown) => x as { code: string; detail?: string; constraint?: string },
      );
      expect(e, "拒否されていない").not.toBeNull();
      return e as { code: string; detail?: string; constraint?: string };
    };

    it("soraban_app は参照と追加だけ。更新・削除・TRUNCATE は権限エラー（42501）。オーナーロールでもトリガーが拒む（SB409 immutable）", async () => {
      const p = await newPlan(O);
      const row = await raw(p.id, O, {});
      for (const [priv, want] of [["SELECT", true], ["INSERT", true], ["UPDATE", false], ["DELETE", false], ["TRUNCATE", false]] as const) {
        const r = await owner.query("select has_table_privilege('soraban_app', 'flight_field_events', $1) as ok", [priv]);
        expect(r.rows[0].ok, priv).toBe(want);
      }
      expect((await sqlState(app.query("update flight_field_events set note = 'x' where id = $1", [row.id]))).code).toBe("42501");
      expect((await sqlState(app.query("delete from flight_field_events where id = $1", [row.id]))).code).toBe("42501");
      expect((await sqlState(app.query("truncate flight_field_events"))).code).toBe("42501");
      for (const stmt of ["update flight_field_events set note = 'x'", "delete from flight_field_events", "truncate flight_field_events"]) {
        const e = await sqlState(owner.query(stmt));
        expect(e.code, stmt).toBe("SB409");
        expect(e.detail, stmt).toBe("immutable");
      }
      expect(await count("flight_field_events", "id = $1", [row.id])).toBe(1);
    });

    it("recorded_at・content_hash・snapshot_id・plan_version・記録者の写しは DB が決める（INSERT で偽の値を渡しても上書きされる）", async () => {
      const p = await newPlan(O);
      const row = await raw(p.id, O, {
        recorded_at: "2000-01-01T00:00:00Z",
        content_hash: "fake",
        snapshot_id: randomUUID(),
        plan_version: 99,
        recorded_by_name: "偽の名前",
        recorded_by_role: "viewer",
      });
      expect(new Date(row.recorded_at).getFullYear()).toBeGreaterThan(2020);
      expect(row.content_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(row.content_hash).not.toBe("fake");
      expect(row.snapshot_id).toBe(p.currentSnapshotId);
      expect(row.plan_version).toBe(p.version);
      expect(row.recorded_by_name).toBe(O.manager.display_name);
      expect(row.recorded_by_role).toBe("manager");
      // 再計算は SQL の中で行う（JS の Date はマイクロ秒を持てない）
      const h = await owner.query(
        // Sprint 14（0017）：新しい行のハッシュは soraban-field-event-v2（新しい列を含む）
        `select flight_field_event_hash_v2(e.id, e.org_id, e.plan_id, e.kind, e.item, e.result, e.source, e.target_event_id,
                e.flight_record_id, e.inspection_id, e.report_id, e.occurred_at, e.snapshot_id, e.plan_version, e.gaps, e.note,
                e.queued, e.client_event_id, e.recorded_by_member_id, e.recorded_by_name, e.recorded_by_role, e.recorded_at,
                e.doc_key, e.site_third_party, e.site_other_aircraft, e.site_rain, e.site_visibility, e.site_wind_ms, e.site_temp_c) as h
           from flight_field_events e where e.id = $1`,
        [row.id],
      );
      expect(h.rows[0].h).toBe(row.content_hash);
    });

    it("CHECK が種別ごとの必須の列を守る", async () => {
      const p = await newPlan(O);
      const t = await raw(p.id, O, { kind: "takeoff", item: null, result: null, gaps: [] });
      const bad: [string, Record<string, unknown>][] = [
        ["種別が不正", { kind: "dance" }],
        ["check に項目がない", { item: null }],
        ["check に結果がない", { result: null }],
        ["緊急用務空域に情報源がない", { item: "emergency_airspace", result: "not_designated" }],
        ["緊急用務空域の情報源が空白", { item: "emergency_airspace", result: "designated", source: "  " }],
        ["緊急用務空域の結果が done", { item: "emergency_airspace", result: "done", source: SRC }],
        ["携行品の結果が designated", { item: "carry", result: "designated" }],
        ["項目が不正", { item: "other" }],
        ["情報源が 101 文字", { item: "emergency_airspace", result: "designated", source: "あ".repeat(101) }],
        ["離陸に gaps がない", { kind: "takeoff", item: null, result: null }],
        ["check に gaps がある", { gaps: [] }],
        ["gaps が配列でない", { kind: "takeoff", item: null, result: null, gaps: { a: 1 } }],
        ["離陸に項目がある", { kind: "takeoff", gaps: [] }],
        ["着陸に target がない", { kind: "landing", item: null, result: null }],
        ["離陸に target がある", { kind: "takeoff", item: null, result: null, gaps: [], target_event_id: t.id }],
        ["取り消すに target がない", { kind: "undo", item: null, result: null }],
        ["日誌との結び付きに飛行記録がない", { kind: "journal_linked", item: null, result: null, target_event_id: t.id }],
        ["日誌でないのに飛行記録がある", { flight_record_id: randomUUID() }],
        ["携行品に inspection_id がある", { inspection_id: randomUUID() }],
        ["携行品に report_id がある", { report_id: randomUUID() }],
        ["時刻が分単位でない", { occurred_at: "2027-01-05T03:00:30Z" }],
        ["メモが 301 文字", { note: "あ".repeat(301) }],
      ];
      for (const [label, cols] of bad) {
        const e = await sqlState(raw(p.id, O, cols));
        expect(e.code, label).toBe("23514");
      }
      // 通る組合せ
      await raw(p.id, O, { item: "emergency_airspace", result: "designated", source: SRC });
      await raw(p.id, O, { item: "inspection", result: "done" });
      await raw(p.id, O, { note: "あ".repeat(300) });
    });

    it("別の計画・組織の行を指す target_event_id・flight_record_id・inspection_id・report_id を拒む。指す行の種別も検査する", async () => {
      const p1 = await newPlan(O);
      const p2 = await newPlan(O);
      const pB = await newPlan(B);
      const t1 = await raw(p1.id, O, { kind: "takeoff", item: null, result: null, gaps: [] });
      const c1 = await raw(p1.id, O, {});
      const tB = await raw(pB.id, B, { kind: "takeoff", item: null, result: null, gaps: [] }, owner);
      const landing = (planId: string, org: Org, target: string) => raw(planId, org, { kind: "landing", item: null, result: null, target_event_id: target });
      // 他の計画の離陸を指す着陸
      expect(["23503", "SB404"]).toContain((await sqlState(landing(p2.id, O, t1.id))).code);
      // 他の組織の離陸を指す着陸（同じ組織の計画から）
      expect(["23503", "SB404"]).toContain((await sqlState(landing(p1.id, O, tB.id))).code);
      // 存在しない行
      expect(["23503", "SB404"]).toContain((await sqlState(landing(p1.id, O, randomUUID()))).code);
      // 正しい着陸は通る
      const l1 = await landing(p1.id, O, t1.id);
      // 離陸でない行を指す着陸・日誌との結び付き
      expect((await sqlState(landing(p1.id, O, c1.id))).detail).toBe("invalid_target");
      expect((await sqlState(landing(p1.id, O, l1.id))).detail).toBe("invalid_target");
      const fr = await rec.createFlight(mgr(O), flightInput(O, "2027-01-05T11:00", "2027-01-05T11:30", { flightPlanId: p1.id }));
      const frOther = await rec.createFlight(mgr(O), flightInput(O, "2027-01-05T11:40", "2027-01-05T11:50", { flightPlanId: p2.id }));
      const frB = await rec.createFlight(
        mgr(B),
        { ...flightInput(B, "2027-01-05T11:00", "2027-01-05T11:30"), flightPlanId: pB.id },
      );
      const journal = (planId: string, org: Org, target: string, record: string) =>
        raw(planId, org, { kind: "journal_linked", item: null, result: null, target_event_id: target, flight_record_id: record });
      expect((await sqlState(journal(p1.id, O, l1.id, fr.record.id))).detail).toBe("invalid_target");
      // 他の計画の飛行記録・他の組織の飛行記録・計画なしの飛行記録
      expect((await sqlState(journal(p1.id, O, t1.id, frOther.record.id))).code).toBe("23503");
      expect((await sqlState(journal(p1.id, O, t1.id, frB.record.id))).code).toBe("23503");
      const noPlan = await rec.createFlight(mgr(O), flightInput(O, "2027-01-05T09:00", "2027-01-05T09:30"));
      expect((await sqlState(journal(p1.id, O, t1.id, noPlan.record.id))).code).toBe("23503");
      // 正しい結び付きは通る
      await journal(p1.id, O, t1.id, fr.record.id);
      // 日常点検・通報の行
      const insA = await inspect(O, "2027-01-05T10:00");
      const insB = await rec.createInspection(mgr(B), { aircraftId: B.aircraft, pilotId: B.pilotFree.id, inspectedAt: "2027-01-05T10:00", placeName: "本社", items: ITEMS });
      expect((await sqlState(raw(p1.id, O, { item: "inspection", inspection_id: insB.record.id }))).code).toBe("23503");
      await raw(p1.id, O, { item: "inspection", inspection_id: insA.record.id });
      expect((await sqlState(raw(p1.id, O, { item: "report_recheck", report_id: randomUUID() }))).code).toBe("23503");
      // undo の対象
      const u = (target: string) => raw(p1.id, O, { kind: "undo", item: null, result: null, target_event_id: target });
      expect((await sqlState(u(randomUUID()))).code).toMatch(/23503|SB404/);
      await u(c1.id);
      expect((await sqlState(u(c1.id))).code, "二重の undo").toBe("23505");
      const j = (await owner.query("select id from flight_field_events where plan_id = $1 and kind = 'journal_linked'", [p1.id])).rows[0].id;
      expect((await sqlState(u(j))).detail, "journal_linked は取り消せない").toBe("invalid_target");
    });

    it("(org_id, client_event_id) は一意。計画・利用者が同じ組織にないと拒む（SB404）。取消した計画への check・takeoff は拒む（SB409 plan_cancelled）", async () => {
      const p = await newPlan(O);
      const id = cid();
      await raw(p.id, O, { client_event_id: id });
      expect((await sqlState(raw(p.id, O, { client_event_id: id }))).code).toBe("23505");
      const pB = await newPlan(B);
      // 組織 B の計画に組織 A の利用者の記録（org_id が計画と違う）
      expect((await sqlState(raw(pB.id, A, {}))).code).toMatch(/SB404|23503/);
      // 組織 A の計画に、組織 B の利用者を記録者にする
      expect((await sqlState(raw(p.id, O, { recorded_by_member_id: B.manager.id }))).code).toBe("SB404");
      // 取消した計画
      const v = await newPlan(O);
      const t = await raw(v.id, O, { kind: "takeoff", item: null, result: null, gaps: [] });
      await plans.voidPlan(mgr(O), v.id, { expectedVersion: v.version, reason: "中止" });
      expect((await sqlState(raw(v.id, O, {}))).detail).toBe("plan_cancelled");
      expect((await sqlState(raw(v.id, O, { kind: "takeoff", item: null, result: null, gaps: [] }))).detail).toBe("plan_cancelled");
      // 開いている離陸の着陸・取り消すは記録できる
      const l = await raw(v.id, O, { kind: "landing", item: null, result: null, target_event_id: t.id });
      await raw(v.id, O, { kind: "undo", item: null, result: null, target_event_id: l.id });
    });
  });

  // ---- 契約 3：POST /api/ops/plans/[id]/field-events ----------------------------------

  describe("3. 現場の記録（field-events）", () => {
    it("離陸は未了事項があっても 201 で記録され、応答と離陸の行に gaps の写しが残る。gaps・snapshotId・planVersion はサーバーが決める", async () => {
      const p = await newPlan(O);
      const fake = { snapshotId: randomUUID(), planVersion: 99, gaps: [], recordedAt: "2000-01-01T00:00:00Z", contentHash: "x", recordedByName: "偽" };
      const r = await post(O, p.id, body("takeoff", fake));
      expect(r.created).toBe(true);
      const e = r.event;
      expect(e.kind).toBe("takeoff");
      // Sprint 14（意図の変更）：12c の 5 項目に、飛行自粛要請・現場状況・書類・手続き（要確認）が加わる。
      // この計画は許可番号なし・リモートID／飛行マニュアルは常に要確認。登録記号と登録記号は機体台帳から確認済みになり未了に出ない。このテストの操縦者は有効期限が未入力なので技能証明も要確認
      expect(e.gaps!.map((g) => [g.item, g.state])).toEqual([
        ["inspection", "none"],
        ["emergency_airspace", "none"],
        ["flight_restriction", "none"],
        ["site_conditions", "none"],
        ["docs_permit", "needs_check"],
        ["docs_remote_id", "needs_check"],
        ["docs_license", "needs_check"],
        ["docs_manual", "needs_check"],
        ["report", "none"],
        ["confirmation", "draft"],
        ["carry", "none"],
      ]);
      expect(e.gaps![0]!.label).toBe("日常点検（記録なし）");
      expect(e.snapshotId).toBe(p.currentSnapshotId);
      expect(e.planVersion).toBe(p.version);
      expect(e.recordedByName).toBe(O.manager.display_name);
      expect(e.contentHash).not.toBe("x");
      const rows = await eventRows(p.id);
      expect(rows).toHaveLength(1);
      expect(rows[0].gaps).toEqual(e.gaps!.map((g) => ({ item: g.item, state: g.state })));
      expect(rows[0].snapshot_id).toBe(p.currentSnapshotId);
      expect(rows[0].queued).toBe(false);
    });

    it("すべて済ませてから離陸すると、未了事項は空", async () => {
      const p = await approvedPlan(O);
      // Sprint 15：飛行前点検も計画に結び付いた点検だけが数える（意図の変更。現場から入れた点検と同じく planId を渡す）
      await inspect(O, "2027-01-05T10:00", { planId: p.id });
      await reportNew(O, p, "2027-01-05T11:00");
      await post(O, p.id, checkBody("emergency_airspace"));
      await post(O, p.id, checkBody("carry"));
      // Sprint 14（意図の変更）：飛行自粛要請・現場状況・要確認の書類（人が確認）も済ませて、はじめて未了が空になる
      await post(O, p.id, checkBody("flight_restriction"));
      await post(O, p.id, checkBody("site_conditions", { site: SITE_OK }));
      for (const k of ["permit", "remote_id", "license", "manual"]) await post(O, p.id, checkBody("docs_confirm", { docKey: k }));
      const r = await post(O, p.id, body("takeoff"));
      expect(r.event.gaps).toEqual([]);
      expect((await eventRows(p.id)).at(-1).gaps).toEqual([]);
    });

    it("未了事項：異常あり・指定されている・通報の記録が離陸より後・判定が古い・前の版への確認", async () => {
      const p = await approvedPlan(O);
      await inspect(O, "2027-01-05T10:00", { planId: p.id, items: { ...ITEMS, frame: { result: "abnormal", note: "亀裂" } } });
      await post(O, p.id, checkBody("emergency_airspace", { result: "designated" }));
      await post(O, p.id, checkBody("carry"));
      // 通報を 11:58 に記録し、離陸は 11:55（記録が離陸より後）
      await reportNew(O, p, "2027-01-05T11:58");
      const t = await post(O, p.id, body("takeoff", { occurredAt: "2027-01-05T11:55", queued: true }));
      const states = Object.fromEntries(t.event.gaps!.map((g) => [g.item, g.state]));
      expect(states["inspection"]).toBe("abnormal");
      expect(states["emergency_airspace"]).toBe("designated");
      expect(states["report"]).toBe("after_takeoff");
      expect(states["confirmation"]).toBeUndefined();
      expect(t.created).toBe(true);
    });

    it("飛行中の離陸があるときの離陸は 409 already_in_flight。開いた離陸がない着陸は 409 no_open_flight。着陸すれば次の離陸ができる", async () => {
      const p = await newPlan(O);
      await expectOpsError(post(O, p.id, body("landing")), 409, "no_open_flight");
      const t = await post(O, p.id, body("takeoff"));
      await expectOpsError(post(O, p.id, body("takeoff")), 409, "already_in_flight");
      const l = await post(O, p.id, body("landing", { occurredAt: "2027-01-05T12:03" }));
      expect(l.event.targetEventId).toBe(t.event.id);
      await expectOpsError(post(O, p.id, body("landing")), 409, "no_open_flight");
      const t2 = await post(O, p.id, body("takeoff", { occurredAt: "2027-01-05T12:04" }));
      expect(t2.created).toBe(true);
      expect(await count("flight_field_events", "plan_id = $1 and kind = 'takeoff'", [p.id])).toBe(2);
    });

    it("並行の離陸（異なる識別子）は、ちょうど 1 件だけ記録される（計画ごとの排他）", async () => {
      const p = await newPlan(O);
      const results = await Promise.allSettled([1, 2, 3, 4].map(() => post(O, p.id, body("takeoff"))));
      const ok = results.filter((r) => r.status === "fulfilled");
      const ng = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
      expect(ok).toHaveLength(1);
      expect(ng).toHaveLength(3);
      for (const r of ng) expect((r.reason as OpsError).code).toBe("already_in_flight");
      expect(await count("flight_field_events", "plan_id = $1 and kind = 'takeoff'", [p.id])).toBe(1);
    });

    it("中止した計画：新しい確認・離陸は 409 plan_cancelled。開いている離陸の着陸と、取り消すは記録できる", async () => {
      const p = await newPlan(O);
      const c = await post(O, p.id, checkBody("carry"));
      const t = await post(O, p.id, body("takeoff"));
      await plans.voidPlan(mgr(O), p.id, { expectedVersion: p.version, reason: "天候のため中止" });
      await expectOpsError(post(O, p.id, checkBody("carry")), 409, "plan_cancelled");
      await expectOpsError(post(O, p.id, body("takeoff")), 409, "plan_cancelled");
      const l = await post(O, p.id, body("landing", { occurredAt: "2027-01-05T12:02" }));
      expect(l.created).toBe(true);
      const u = await post(O, p.id, body("undo", { targetEventId: c.event.id }));
      expect(u.event.targetEventId).toBe(c.event.id);
      // 着陸を取り消す → 離陸を取り消す（どちらも中止後に記録できる）
      await post(O, p.id, body("undo", { targetEventId: l.event.id }));
      await post(O, p.id, body("undo", { targetEventId: t.event.id }));
    });

    it("同じ clientEventId の再送：逐次も並行も新しい行を作らず、既存を 200 で返す。内容が違えば 409 request_conflict", async () => {
      const p = await newPlan(O);
      const b = body("takeoff");
      const first = await post(O, p.id, b);
      expect(first.created).toBe(true);
      const again = await post(O, p.id, { ...b, queued: true });
      expect(again.created).toBe(false);
      expect(again.event.id).toBe(first.event.id);
      expect(again.event.duplicate).toBe(true);
      expect(await count("flight_field_events", "plan_id = $1", [p.id])).toBe(1);
      // 内容が違う（時刻・種別・別の利用者・別の計画）
      await expectOpsError(post(O, p.id, { ...b, occurredAt: "2027-01-05T12:01" }), 409, "request_conflict");
      await expectOpsError(post(O, p.id, { ...b, kind: "check", item: "carry" }), 409, "request_conflict");
      const p2 = await newPlan(O);
      await expectOpsError(post(O, p2.id, b), 409, "request_conflict");
      // 並行の 2 リクエスト
      const q = await newPlan(O);
      const c = checkBody("carry");
      const both = await Promise.all([post(O, q.id, c), post(O, q.id, c), post(O, q.id, c)]);
      expect(both.filter((x) => x.created)).toHaveLength(1);
      expect(new Set(both.map((x) => x.event.id)).size).toBe(1);
      expect(await count("flight_field_events", "plan_id = $1", [q.id])).toBe(1);
      // 応答を落とした再試行（古い送信待ちの再送は、時刻の検査より先に既存を返す）
      const late = ctxOf(O.manager, { now: () => new Date(NOW.getTime() + 100 * 3600_000) });
      const replay = await post(O, q.id, c, late);
      expect(replay.created).toBe(false);
    });

    it("時刻の検査：未来 5 分超は 400 future_time、その場の送信で ±5 分超は 400 clock_skew、送信待ちは 72 時間まで（超えると 400 too_old）", async () => {
      const p = await newPlan(O);
      const rows = async () => count("flight_field_events", "plan_id = $1", [p.id]);
      const e1 = await expectOpsError(post(O, p.id, checkBody("carry", { occurredAt: "2027-01-05T12:06" })), 400, "future_time");
      expect(e1.fieldCodes).toEqual({ occurredAt: "future_time" });
      await expectOpsError(post(O, p.id, checkBody("carry", { occurredAt: "2027-01-05T12:06", queued: true })), 400, "future_time");
      const e2 = await expectOpsError(post(O, p.id, checkBody("carry", { occurredAt: "2027-01-05T11:54" })), 400, "clock_skew");
      expect(e2.fieldErrors!["occurredAt"]).toBe("端末の時刻がずれています。時刻の設定（自動）を確かめてください。");
      expect(await rows()).toBe(0);
      await post(O, p.id, checkBody("carry", { occurredAt: "2027-01-05T11:55" }));
      await post(O, p.id, checkBody("carry", { occurredAt: "2027-01-05T12:05" }));
      // 送信待ち
      await post(O, p.id, checkBody("report_recheck", { occurredAt: "2027-01-03T12:00", queued: true }));
      await post(O, p.id, checkBody("report_recheck", { occurredAt: "2027-01-02T12:00", queued: true }));
      await expectOpsError(post(O, p.id, checkBody("report_recheck", { occurredAt: "2027-01-02T11:59", queued: true })), 400, "too_old");
      // 送信待ちでなければ 1 時間前でも clock_skew
      await expectOpsError(post(O, p.id, checkBody("report_recheck", { occurredAt: "2027-01-05T11:00" })), 400, "clock_skew");
      // 形が違う
      await expectOpsError(post(O, p.id, checkBody("carry", { occurredAt: "2027-01-05 12:00" })), 400, "invalid_input");
      expect(await rows()).toBe(4);
    });

    it("緊急用務空域は情報源と結果が必須（400）。「指定されている」を選んでも記録は残る。日常点検の確認の行は作れない", async () => {
      const p = await newPlan(O);
      const e = await expectOpsError(post(O, p.id, body("check", { item: "emergency_airspace" })), 400, "invalid_input");
      expect(e.fieldCodes).toEqual({ result: "required", source: "required" });
      await expectOpsError(post(O, p.id, body("check", { item: "emergency_airspace", result: "designated", source: "自由入力" })), 400, "invalid_input");
      const d = await post(O, p.id, checkBody("emergency_airspace", { result: "designated" }));
      expect(d.created).toBe(true);
      expect(d.event).toMatchObject({ item: "emergency_airspace", result: "designated", source: SRC });
      const e2 = await expectOpsError(post(O, p.id, body("check", { item: "inspection" })), 400, "invalid_input");
      expect(e2.fieldCodes).toEqual({ item: "derived" });
      expect(await count("flight_field_events", "plan_id = $1", [p.id])).toBe(1);
    });

    it("取り消すの規則：着陸がある離陸は 409 landing_exists、日誌済みの着陸は 409 journal_exists、二重は already_undone、journal_linked は取り消せない", async () => {
      const p = await newPlan(O);
      const t = await post(O, p.id, body("takeoff"));
      const l = await post(O, p.id, body("landing", { occurredAt: "2027-01-05T12:02" }));
      await expectOpsError(post(O, p.id, body("undo", { targetEventId: t.event.id })), 409, "landing_exists");
      // 日誌に結び付ける
      const f = await rec.createFlight(mgr(O), flightInput(O, "2027-01-05T12:00", "2027-01-05T12:02", { takeoffEventId: t.event.id }));
      await expectOpsError(post(O, p.id, body("undo", { targetEventId: l.event.id })), 409, "journal_exists");
      const j = (await eventRows(p.id)).find((r) => r.kind === "journal_linked");
      await expectOpsError(post(O, p.id, body("undo", { targetEventId: j.id })), 409, "not_undoable");
      // 飛行記録を取消すと日誌待ちに戻り、着陸を取り消せる
      await rec.voidFlight(mgr(O), f.record.id, { expectedVersion: 1, reason: "誤り" });
      const u = await post(O, p.id, body("undo", { targetEventId: l.event.id }));
      expect(u.created).toBe(true);
      await expectOpsError(post(O, p.id, body("undo", { targetEventId: l.event.id })), 409, "already_undone");
      // 取り消された着陸のあとは再び飛行中。離陸は取り消せる
      await expectOpsError(post(O, p.id, body("takeoff")), 409, "already_in_flight");
      await post(O, p.id, body("undo", { targetEventId: t.event.id }));
      const t2 = await post(O, p.id, body("takeoff"));
      expect(t2.created).toBe(true);
      // 存在しない行
      await expectOpsError(post(O, p.id, body("undo", { targetEventId: randomUUID() })), 409, "invalid_target");
    });

    it("端末の識別子で指す（送信待ちの着陸・取り消す）：targetClientEventId で離陸・確認を指せる", async () => {
      const p = await newPlan(O);
      const tb = body("takeoff");
      await post(O, p.id, tb);
      const l = await post(O, p.id, body("landing", { occurredAt: "2027-01-05T12:03", targetClientEventId: tb["clientEventId"], queued: true }));
      expect(l.event.targetEventId).toBeTruthy();
      const cb = checkBody("carry");
      const c = await post(O, p.id, cb);
      const u = await post(O, p.id, body("undo", { targetClientEventId: cb["clientEventId"] }));
      expect(u.event.targetEventId).toBe(c.event.id);
    });

    it("認可：他の組織の計画は 404、閲覧者は 403、操縦者は自分が操縦者の計画だけ、運航管理者は全員分", async () => {
      const own = await newPlan(O, { pilotId: O.pilotLinked.id });
      const other = await newPlan(O);
      const pilotCtx = ctxOf(O.pilotMember);
      expect((await post(O, own.id, body("takeoff"), pilotCtx)).created).toBe(true);
      await expectOpsError(post(O, other.id, body("takeoff"), pilotCtx), 403, "forbidden");
      // 操縦者の行に結び付いていない操縦者役割
      await expectOpsError(post(O, own.id, body("takeoff"), ctxOf(O.pilotMember2)), 403, "forbidden");
      await expectOpsError(post(O, own.id, body("takeoff"), ctxOf(O.viewer)), 403, "forbidden");
      await expectOpsError(post(O, own.id, body("takeoff"), ctxOf(B.manager)), 404, "not_found");
      await expectOpsError(field.getFieldView(ctxOf(B.manager), own.id), 404, "not_found");
      await expectOpsError(field.listFieldEvents(ctxOf(B.manager), own.id), 404, "not_found");
      expect((await post(O, other.id, body("takeoff"))).created).toBe(true);
      // 閲覧は全役割
      for (const m of [O.viewer, O.pilotMember, O.pilotMember2, O.manager]) {
        const v = await field.getFieldView(ctxOf(m), other.id);
        expect(v.plan.id).toBe(other.id);
      }
      expect((await field.getFieldView(ctxOf(O.viewer), other.id)).canRecord).toBe(false);
      expect((await field.getFieldView(ctxOf(O.pilotMember), own.id)).canRecord).toBe(true);
      expect((await field.getFieldView(ctxOf(O.pilotMember), other.id)).canRecord).toBe(false);
      // 本文の値：不正な本文
      await expectOpsError(field.recordFieldEvent(mgr(O), own.id, []), 400, "invalid_body");
      await expectOpsError(field.recordFieldEvent(mgr(O), "not-a-uuid", body("takeoff")), 404, "not_found");
    });

    it("行に技能証明書番号・操縦者の氏名が入らない（応答にも）", async () => {
      const p = await newPlan(O);
      const t = await post(O, p.id, body("takeoff", { note: "確認" }));
      await post(O, p.id, checkBody("emergency_airspace"));
      const rows = await eventRows(p.id);
      const text = JSON.stringify(rows) + JSON.stringify(t.event);
      expect(text).not.toContain(LICENSE);
      expect(text).not.toContain(PILOT_NAME);
      // テーブルに氏名・番号の列がない
      const cols = (await owner.query("select column_name from information_schema.columns where table_name = 'flight_field_events'")).rows.map((r) => r.column_name as string);
      expect(cols.some((c) => /license|pilot_name|full_name/.test(c))).toBe(false);
    });

    it("現場モードの状態：確認項目・飛行の組・未了事項の予告・通報の状況・同日の計画", async () => {
      const p = await newPlan(O, { title: "状態の確認" });
      const sibling = await newPlan(O, { plannedStartAt: "2027-01-05T16:00" });
      let v = await field.getFieldView(mgr(O), p.id);
      expect(v.items.map((i) => [i.item, i.stateLabel])).toEqual([
        ["inspection", "未"],
        ["emergency_airspace", "未"],
        ["report_recheck", "未"],
        ["carry", "未"],
      ]);
      expect(v.report).toMatchObject({ requirementKind: "required", statusCode: "no_record", canRecheck: false });
      expect(v.report.warning).toContain("通報の記録がありません");
      expect(v.takeoffPreview.length).toBeGreaterThan(0);
      expect(v.sameDayPlans.map((x) => x.id)).toEqual(expect.arrayContaining([p.id, sibling.id]));
      expect(v.sameDayPlans.find((x) => x.id === p.id)!.isCurrent).toBe(true);
      expect(v.emergencySources.map((s) => s.id)).toEqual([SRC]);
      expect(v.today).toBe("2027-01-05");
      expect(v.serverNowJst).toBe("2027-01-05T12:00");
      // 日常点検は実際の点検の記録から導出する
      await inspect(O, "2027-01-05T09:30", { planId: p.id, items: { ...ITEMS, frame: { result: "abnormal", note: "亀裂" } } });
      v = await field.getFieldView(mgr(O), p.id);
      expect(v.items[0]).toMatchObject({ done: true, stateLabel: "異常あり", abnormal: true, time: "09:30" });
      expect(v.items[0]!.warning).toContain("飛行を止めて不具合を確認");
      // 緊急用務空域：指定されている
      const e = await post(O, p.id, checkBody("emergency_airspace", { result: "designated" }));
      v = await field.getFieldView(mgr(O), p.id);
      expect(v.items[1]).toMatchObject({ done: true, stateLabel: "済", designated: true, eventId: e.event.id, undoable: true, sourceTitle: expect.stringContaining("緊急用務空域") });
      expect(v.items[1]!.warning).toContain("飛行できません");
      // 離陸 → 飛行中
      const t = await post(O, p.id, body("takeoff"));
      v = await field.getFieldView(mgr(O), p.id);
      expect(v.openFlightEventId).toBe(t.event.id);
      expect(v.flights[0]).toMatchObject({ phase: "in_flight", phaseLabel: "飛行中", takeoffTime: "12:00" });
      // stateInput から端末で同じ状態を導出できる（個人情報を含まない）
      expect(JSON.stringify(v.stateInput)).not.toContain(LICENSE);
      expect(v.stateInput.day).toBe("2027-01-05");
    });

    it("通報の再掲の文言（推奨の計画なら「通報の記録を必須としません」と出し、未了事項に数えない。要・要確認なら出さない）", async () => {
      const O = await makeOrg("rec", 0.5);
      // 100g 以上で特定飛行に当たらない計画（推奨）か、判定不能で要確認になる。種別に応じて検査する
      const p = await newPlan(O, { flags: [], accessControl: undefined, maxAltitudeM: 30 }, mgr(O));
      const v = await field.getFieldView(mgr(O), p.id);
      if (v.report.requirementKind === "recommended") {
        expect(v.report.notRequiredNote).toBe("この飛行は通報の記録を必須としません（推奨）。");
        const t = await post(O, p.id, body("takeoff"), mgr(O));
        expect(t.event.gaps!.map((g) => g.item)).not.toContain("report");
      } else {
        expect(["required", "confirm"]).toContain(v.report.requirementKind);
        expect(v.report.notRequiredNote).toBeNull();
      }
      expect(JSON.stringify(v)).not.toMatch(/通報不要|通報は不要|通報の必要はありません|通報しなくて/);
    });
  });

  // ---- 契約 4：日誌への引き継ぎ ----------------------------------------------------------

  describe("4. POST /api/ops/flights の takeoffEventId", () => {
    const landed = async (o: Org = O, p?: Awaited<ReturnType<typeof newPlan>>) => {
      const plan = p ?? (await newPlan(o));
      const t = await post(o, plan.id, body("takeoff", { occurredAt: "2027-01-05T11:58" }));
      const l = await post(o, plan.id, body("landing", { occurredAt: "2027-01-05T12:02" }));
      return { plan, t: t.event, l: l.event };
    };

    it("飛行記録の作成と journal_linked の追記が同じトランザクションでできる。利用者が直した時刻は飛行記録に、離着陸の行は元の時刻のまま", async () => {
      const { plan, t } = await landed();
      const before = { v: await count("record_versions"), r: await count("flight_records") };
      const f = await rec.createFlight(mgr(O), flightInput(O, "2027-01-05T11:50", "2027-01-05T12:10", { takeoffEventId: t.id }));
      expect(f.created).toBe(true);
      expect(f.record).toMatchObject({ flightPlanId: plan.id, takeoffAt: "2027-01-05T11:50", landingAt: "2027-01-05T12:10", takeoffEventId: t.id });
      expect(f.record.snapshotId).toBe(plan.currentSnapshotId);
      expect(await count("record_versions")).toBe(before.v + 1);
      expect(await count("flight_records")).toBe(before.r + 1);
      const links = (await eventRows(plan.id)).filter((r) => r.kind === "journal_linked");
      expect(links).toHaveLength(1);
      expect(links[0]).toMatchObject({ flight_record_id: f.record.id, target_event_id: t.id, plan_id: plan.id });
      // 離着陸の行は元の時刻のまま
      const ev = await owner.query("select ops_timestamptz_to_jst_minute(occurred_at) as at, kind from flight_field_events where plan_id = $1 and kind in ('takeoff','landing') order by occurred_at", [plan.id]);
      expect(ev.rows.map((r) => r.at)).toEqual(["2027-01-05T11:58", "2027-01-05T12:02"]);
      // 現場の状態は日誌済み
      const v = await field.getFieldView(mgr(O), plan.id);
      expect(v.flights[0]).toMatchObject({ phase: "journaled", flightRecordId: f.record.id });
      expect(v.pendingJournalTakeoffEventIds).toEqual([]);
      // 計画の画面の記録に並ぶ（計画 → スナップショット → 証跡 ID への辿り）
      const detail = await plans.getPlan(mgr(O), plan.id);
      expect(detail.flights.map((x) => x.id)).toEqual([f.record.id]);
      expect(detail.flights[0]!.takeoffGaps!.length).toBeGreaterThan(0);
      expect(detail.flights[0]!.snapshotId).toBe(plan.currentSnapshotId);
      // 離陸時の未了事項の写しが飛行記録の詳細に出る
      const got = await rec.getFlight(mgr(O), f.record.id);
      expect(got.takeoffGaps).toEqual((await eventRows(plan.id))[0].gaps.map((g: { item: string; state: string }) => expect.objectContaining(g)));
      expect(got.takeoffEventId).toBe(t.id);
    });

    it("片方が失敗すれば両方残らない（journal_linked の追記が失敗すると、飛行記録の版も残らない）", async () => {
      const { plan, t } = await landed();
      await owner.query(`create function g1_fail_journal() returns trigger language plpgsql as $$ begin raise exception 'forced failure' using errcode = 'P0001'; end $$`);
      await owner.query("create trigger g1_fail_journal before insert on flight_field_events for each row when (new.kind = 'journal_linked') execute function g1_fail_journal()");
      const before = { v: await count("record_versions"), r: await count("flight_records") };
      try {
        await expect(rec.createFlight(mgr(O), flightInput(O, "2027-01-05T11:58", "2027-01-05T12:02", { takeoffEventId: t.id }))).rejects.toBeTruthy();
      } finally {
        await owner.query("drop trigger g1_fail_journal on flight_field_events");
        await owner.query("drop function g1_fail_journal()");
      }
      expect(await count("record_versions")).toBe(before.v);
      expect(await count("flight_records")).toBe(before.r);
      expect((await eventRows(plan.id)).filter((r) => r.kind === "journal_linked")).toHaveLength(0);
      // その後は正常に保存できる
      expect((await rec.createFlight(mgr(O), flightInput(O, "2027-01-05T11:58", "2027-01-05T12:02", { takeoffEventId: t.id }))).created).toBe(true);
    });

    it("着陸していない離陸・取り消された離陸・他の計画の離陸・他の組織の離陸は 400。すでに日誌済みの離陸は 409 already_journaled", async () => {
      const p = await newPlan(O);
      const open = await post(O, p.id, body("takeoff"));
      const e1 = await expectOpsError(rec.createFlight(mgr(O), flightInput(O, "2027-01-05T11:58", "2027-01-05T12:02", { takeoffEventId: open.event.id })), 400, "invalid_input");
      expect(e1.fieldCodes).toEqual({ takeoffEventId: "no_landing" });
      const { t: undoneT } = await landed();
      const l = (await eventRows(undoneT.planId)).find((r) => r.kind === "landing");
      await post(O, undoneT.planId, body("undo", { targetEventId: l.id }));
      await post(O, undoneT.planId, body("undo", { targetEventId: undoneT.id }));
      const e2 = await expectOpsError(rec.createFlight(mgr(O), flightInput(O, "2027-01-05T11:58", "2027-01-05T12:02", { takeoffEventId: undoneT.id })), 400, "invalid_input");
      expect(e2.fieldCodes).toEqual({ takeoffEventId: "invalid_target" });
      // 他の計画：flightPlanId が離陸の計画と違う
      const { t: tx, plan: planX } = await landed();
      const other = await newPlan(O);
      const e3 = await expectOpsError(rec.createFlight(mgr(O), flightInput(O, "2027-01-05T11:58", "2027-01-05T12:02", { takeoffEventId: tx.id, flightPlanId: other.id })), 400, "invalid_input");
      expect(e3.fieldCodes).toEqual({ flightPlanId: "plan_mismatch" });
      // 他の組織の離陸
      const { t: tb } = await landed(B);
      await expectOpsError(rec.createFlight(mgr(O), flightInput(O, "2027-01-05T11:58", "2027-01-05T12:02", { takeoffEventId: tb.id })), 400, "invalid_input");
      // 離陸でない行
      await expectOpsError(rec.createFlight(mgr(O), flightInput(O, "2027-01-05T11:58", "2027-01-05T12:02", { takeoffEventId: l.id })), 400, "invalid_input");
      await expectOpsError(rec.createFlight(mgr(O), flightInput(O, "2027-01-05T11:58", "2027-01-05T12:02", { takeoffEventId: "xyz" })), 400, "invalid_input");
      // 日誌済み
      await rec.createFlight(mgr(O), flightInput(O, "2027-01-05T11:58", "2027-01-05T12:02", { takeoffEventId: tx.id }));
      await expectOpsError(rec.createFlight(mgr(O), flightInput(O, "2027-01-05T11:58", "2027-01-05T12:02", { takeoffEventId: tx.id })), 409, "already_journaled");
      expect(await count("flight_records", "flight_plan_id = $1", [planX.id])).toBe(1);
    });

    it("並行する 2 回の保存は 1 件だけ（もう一方は already_journaled）", async () => {
      const { plan, t } = await landed();
      const rs = await Promise.allSettled([1, 2, 3].map(() => rec.createFlight(mgr(O), flightInput(O, "2027-01-05T11:58", "2027-01-05T12:02", { takeoffEventId: t.id }))));
      expect(rs.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      for (const r of rs.filter((x): x is PromiseRejectedResult => x.status === "rejected")) expect((r.reason as OpsError).code).toBe("already_journaled");
      expect(await count("flight_records", "flight_plan_id = $1", [plan.id])).toBe(1);
      expect((await eventRows(plan.id)).filter((r) => r.kind === "journal_linked")).toHaveLength(1);
    });

    it("同じ clientRequestId の再送は 1 件のまま（200・既存の記録）", async () => {
      const { plan, t } = await landed();
      const crid = randomUUID();
      const first = await rec.createFlight(mgr(O), flightInput(O, "2027-01-05T11:58", "2027-01-05T12:02", { takeoffEventId: t.id, clientRequestId: crid }));
      const again = await rec.createFlight(mgr(O), flightInput(O, "2027-01-05T11:58", "2027-01-05T12:02", { takeoffEventId: t.id, clientRequestId: crid }));
      expect(first.created).toBe(true);
      expect(again.created).toBe(false);
      expect(again.record.id).toBe(first.record.id);
      expect(await count("flight_records", "flight_plan_id = $1", [plan.id])).toBe(1);
      expect((await eventRows(plan.id)).filter((r) => r.kind === "journal_linked")).toHaveLength(1);
    });

    it("飛行記録を取消すと、その飛行は「日誌待ち」に戻り、もう一度日誌に結び付けられる", async () => {
      const { plan, t } = await landed();
      const f = await rec.createFlight(mgr(O), flightInput(O, "2027-01-05T11:58", "2027-01-05T12:02", { takeoffEventId: t.id }));
      expect((await field.getFieldView(mgr(O), plan.id)).flights[0]!.phase).toBe("journaled");
      await rec.voidFlight(mgr(O), f.record.id, { expectedVersion: 1, reason: "誤り" });
      const v = await field.getFieldView(mgr(O), plan.id);
      expect(v.flights[0]!.phase).toBe("journal_pending");
      expect(v.pendingJournalTakeoffEventIds).toEqual([t.id]);
      const f2 = await rec.createFlight(mgr(O), flightInput(O, "2027-01-05T11:58", "2027-01-05T12:02", { takeoffEventId: t.id }));
      expect(f2.created).toBe(true);
      expect((await field.getFieldView(mgr(O), plan.id)).flights[0]).toMatchObject({ phase: "journaled", flightRecordId: f2.record.id });
    });

    it("中止した計画でも、すでに離陸した飛行の日誌は残せる", async () => {
      const { plan, t } = await landed();
      await plans.voidPlan(mgr(O), plan.id, { expectedVersion: plan.version, reason: "中止" });
      const f = await rec.createFlight(mgr(O), flightInput(O, "2027-01-05T11:58", "2027-01-05T12:02", { takeoffEventId: t.id }));
      expect(f.created).toBe(true);
      // 従来の flightPlanId だけの保存は、中止した計画では 409 のまま
      await expectOpsError(rec.createFlight(mgr(O), flightInput(O, "2027-01-05T11:58", "2027-01-05T12:02", { flightPlanId: plan.id })), 409, "plan_cancelled");
    });

    it("操縦者は自分の飛行の分だけ。計画の予定時刻が飛行記録の時刻に入る経路がない（時刻が無ければ 400。入力どおりに保存）", async () => {
      const own = await newPlan(O, { pilotId: O.pilotLinked.id });
      // flightPlanId だけで時刻が無い保存は、予定時刻で補わず 400
      const noTimes = await expectOpsError(
        rec.createFlight(mgr(O), { aircraftId: O.aircraft, pilotId: O.pilotLinked.id, purpose: "空撮", takeoffPlace: "本社", landingPlace: "本社", safetyIssue: false, flightPlanId: own.id }),
        400,
        "invalid_input",
      );
      expect(Object.keys(noTimes.fieldErrors ?? {})).toEqual(expect.arrayContaining(["takeoffAt", "landingAt"]));
      // 計画の予定（13:00〜14:00）と違う時刻は、入力どおりに保存される
      const f = await rec.createFlight(mgr(O), { ...flightInput(O, "2027-01-05T09:00", "2027-01-05T09:20"), pilotId: O.pilotLinked.id, flightPlanId: own.id });
      expect(f.record.takeoffAt).toBe("2027-01-05T09:00");
      expect(f.record.landingAt).toBe("2027-01-05T09:20");
      // takeoffEventId がない保存では、現場の行は増えない
      expect((await eventRows(own.id)).filter((r) => r.kind === "journal_linked")).toHaveLength(0);
      // 他人の分は 403
      const t = await post(O, (await newPlan(O, { pilotId: O.pilotLinked.id })).id, body("takeoff"));
      await post(O, t.event.planId, body("landing", { occurredAt: "2027-01-05T12:02" }));
      await expectOpsError(rec.createFlight(ctxOf(O.pilotMember2), { ...flightInput(O, "2027-01-05T11:58", "2027-01-05T12:02"), pilotId: O.pilotLinked.id, takeoffEventId: t.event.id }), 403, "forbidden");
      expect((await rec.createFlight(ctxOf(O.pilotMember), { ...flightInput(O, "2027-01-05T11:58", "2027-01-05T12:02"), pilotId: O.pilotLinked.id, takeoffEventId: t.event.id })).created).toBe(true);
    });
  });

  // ---- 契約 5：食い違い -------------------------------------------------------------------

  describe("5. 日誌の食い違い（保存は止めない）", () => {
    /** 夜の時刻（19:00）。離陸が現在より後の飛行は記録できないため、計画の時間帯のあとに記録する。 */
    const evening = () => ctxOf(O.manager, { now: () => new Date("2027-01-05T10:00:00Z") });
    it("時間帯の外：警告と FlightDto.mismatches（一覧・詳細）に出る。保存は 201。既存の differs_from_plan は変わらない", async () => {
      const p = await approvedPlan(O);
      await reportNew(O, p, "2027-01-05T10:00");
      // 計画 13:00〜14:00。離陸が 12 分早く、着陸が 8 分遅い
      const f = await rec.createFlight(evening(), flightInput(O, "2027-01-05T12:48", "2027-01-05T14:08", { flightPlanId: p.id }));
      expect(f.created).toBe(true);
      expect(f.warnings).toEqual(expect.arrayContaining(["outside_plan_window", "differs_from_plan"]));
      expect(f.warnings).not.toContain("report_missing");
      expect(f.record.mismatches).toEqual([
        { code: "outside_plan_window", label: "計画の時間帯の外で飛行しています（離陸が 12 分早い／着陸が 8 分遅い）。", earlyMinutes: 12, lateMinutes: 8 },
      ]);
      expect((await rec.getFlight(evening(), f.record.id)).mismatches).toHaveLength(1);
      expect((await rec.listFlights(evening(), {})).find((x) => x.id === f.record.id)!.mismatches).toHaveLength(1);
      // 時間帯の中なら出ない（先の記録は取消して、機体の飛行時間が重ならないようにする）
      await rec.voidFlight(evening(), f.record.id, { expectedVersion: 1, reason: "確認用" });
      const g = await rec.createFlight(evening(), flightInput(O, "2027-01-05T13:05", "2027-01-05T13:40", { flightPlanId: p.id }));
      expect(g.record.mismatches).toEqual([]);
      expect(g.warnings).not.toContain("outside_plan_window");
      expect(g.warnings).not.toContain("differs_from_plan");
      // 訂正の応答にも警告が出る
      const upd = await rec.updateFlight(evening(), g.record.id, { expectedVersion: 1, reason: "訂正", takeoffAt: "2027-01-05T12:30" });
      expect(upd.warnings).toEqual(expect.arrayContaining(["outside_plan_window", "differs_from_plan"]));
    });

    it("通報の記録：離陸の時点に無ければ report_missing、離陸より後なら report_after_takeoff も。離陸より前の通報があれば出ない", async () => {
      const p = await approvedPlan(O);
      const none = await rec.createFlight(evening(), flightInput(O, "2027-01-05T13:10", "2027-01-05T13:40", { flightPlanId: p.id }));
      expect(none.created).toBe(true);
      expect(none.warnings).toContain("report_missing");
      expect(none.record.mismatches.map((m) => m.code)).toEqual(["report_missing"]);
      expect(none.record.mismatches[0]!.label).toBe("特定飛行ですが、離陸の時点で DIPS の通報の記録がありません。");
      // 通報を 11:00 に記録（離陸 13:10 より前）
      await reportNew(O, p, "2027-01-05T11:00");
      const before = await rec.getFlight(evening(), none.record.id);
      expect(before.mismatches).toEqual([]);
      // 離陸より後の通報
      const q = await approvedPlan(O);
      const early = await rec.createFlight(evening(), flightInput(O, "2027-01-05T09:00", "2027-01-05T09:30", { flightPlanId: q.id }));
      await reportNew(O, q, "2027-01-05T11:30");
      const after = await rec.getFlight(evening(), early.record.id);
      expect(after.mismatches.map((m) => m.code)).toEqual(expect.arrayContaining(["report_missing", "report_after_takeoff"]));
      expect(after.mismatches.find((m) => m.code === "report_after_takeoff")!.label).toBe("通報の記録が離陸より後です。事前の通報として数えません。");
    });

    it("計画なしの飛行記録には食い違いが出ない（判定の根拠が紐づいていません、は従来どおり）", async () => {
      const f = await rec.createFlight(evening(), flightInput(O, "2027-01-05T09:00", "2027-01-05T09:30", { specificFlightTypes: ["night"] }));
      expect(f.record.mismatches).toEqual([]);
      expect(f.record.judgementLink).toBe("missing");
      expect(f.warnings.filter((w) => ["outside_plan_window", "report_missing", "report_after_takeoff"].includes(w))).toEqual([]);
    });

    it("一覧の食い違いの導出に必要なクエリ数が、飛行記録の件数に比例しない（5 件と 50 件で同じ）", async () => {
      const make = async (n: number) => {
        const O = await makeOrg(`cnt${n}`);
        const p = await approvedPlan(O);
        const base = Date.parse("2027-01-03T00:00:00+09:00");
        for (let i = 0; i < n; i++) {
          // 30 分おきに 20 分の飛行（機体の飛行時間が重ならない）。計画（1/5 13:00〜）の時間帯の外
          const at = (ms: number) => new Date(ms + 9 * 3600_000).toISOString().slice(0, 16);
          await rec.createFlight(ctxOf(O.manager, { now: () => new Date("2027-01-05T10:00:00Z") }), flightInput(O, at(base + i * 30 * 60_000), at(base + (i * 30 + 20) * 60_000), { flightPlanId: p.id }));
        }
        return O;
      };
      const O5 = await make(5);
      const O50 = await make(50);
      const run = async (O: Org) => {
        log.sql = [];
        const list = await rec.listFlights({ db: countingDb(), member: O.manager, now: () => NOW }, {});
        return { n: log.sql.length, list };
      };
      const r5 = await run(O5);
      const r50 = await run(O50);
      expect(r5.list).toHaveLength(5);
      expect(r50.list).toHaveLength(50);
      expect(r50.n).toBe(r5.n);
      expect(r50.n).toBeLessThanOrEqual(6);
      for (const f of r50.list) expect(f.mismatches.length).toBeGreaterThan(0);
    });
  });

  // ---- 契約 6：今日 --------------------------------------------------------------------

  describe("6. GET /api/ops/today", () => {
    const ids = (t: today.TodayDto) => t.nextActions.map((a) => a.id);
    const all = (c: OpsContext) => today.getToday(c, { limit: 100 });

    it("今日のカード・残りの計画・次にやること（保存された状態は読まず、記録を足すだけで変わる）", async () => {
      const O = await makeOrg("today1");
      const empty = await today.getToday(mgr(O));
      expect(empty.card).toBeNull();
      expect(empty.rest).toEqual([]);
      expect(empty.empty!.message).toBe("予定されている飛行計画はありません。");
      expect(empty.empty!.actions.map((a) => a.href)).toEqual(["/ops/plans/new", "/"]);

      const p1 = await approvedPlan(O, { title: "午後の飛行", plannedStartAt: "2027-01-05T13:00" });
      const p2 = await newPlan(O, { title: "夕方の飛行", plannedStartAt: "2027-01-05T16:00" });
      let t = await all(mgr(O));
      expect(t.today).toBe("2027-01-05");
      expect(t.card).toMatchObject({
        planId: p1.id,
        reason: "today",
        title: "午後の飛行",
        timeLabel: "13:00〜14:00",
        verdictLevel: "needs_procedure",
        primary: { kind: "field", label: "現場モードを開く", href: `/ops/plans/${p1.id}/field` },
        confirmation: { state: "approved" },
        report: { requirementKind: "required", statusCode: "no_record" },
      });
      expect(t.card!.registrationMark).toMatch(/^JU12C/);
      expect(t.card!.verdictLabel).toBeTruthy();
      expect(t.rest.map((r) => r.planId)).toEqual([p2.id]);
      // 次にやること：通報・日常点検・緊急用務空域（飛行当日）が出る
      expect(ids(t)).toEqual(expect.arrayContaining(["report", "do_inspection", "check_emergency_airspace", "request_confirmation"]));
      expect(t.nextActions.every((a, i, arr) => i === 0 || arr[i - 1]!.tier <= a.tier)).toBe(true);
      for (const a of t.nextActions) expect(a.label).toMatch(/する$|直す$/);
      // 記録を足すだけで一覧が変わる（Sprint 15：点検は計画に結び付ける）
      await inspect(O, "2027-01-05T09:00", { planId: p1.id });
      await post(O, p1.id, checkBody("emergency_airspace"), mgr(O));
      t = await today.getToday(mgr(O));
      expect(t.nextActions.filter((a) => a.planId === p1.id).map((a) => a.id)).not.toContain("do_inspection");
      expect(t.nextActions.filter((a) => a.planId === p1.id).map((a) => a.id)).not.toContain("check_emergency_airspace");
      // 離陸 → 飛行中：着陸を記録する（tier 1）が先頭、カードは飛行中
      await post(O, p1.id, body("takeoff"), mgr(O));
      t = await today.getToday(mgr(O));
      expect(t.card).toMatchObject({ planId: p1.id, reason: "in_flight", badge: { code: "in_flight" } });
      expect(t.nextActions[0]).toMatchObject({ id: "record_landing", tier: 1, planId: p1.id, href: `/ops/plans/${p1.id}/field#flight`, canAct: true });
      // 着陸 → 日誌待ち：日誌を記入する
      await post(O, p1.id, body("landing", { occurredAt: "2027-01-05T12:03" }), mgr(O));
      t = await today.getToday(mgr(O));
      const w = t.nextActions.find((a) => a.id === "write_journal")!;
      expect(w).toMatchObject({ tier: 3, planId: p1.id });
      expect(w.href).toMatch(new RegExp(`^/ops/flights/new\\?planId=${p1.id}&takeoffEventId=`));
      expect(t.card!.reason).not.toBe("in_flight");
      // 日誌済みになれば消える
      const takeoffId = w.href.split("takeoffEventId=")[1]!;
      await rec.createFlight(mgr(O), flightInput(O, "2027-01-05T12:00", "2027-01-05T12:03", { takeoffEventId: takeoffId }));
      t = await today.getToday(mgr(O));
      expect(ids(t)).not.toContain("write_journal");
    });

    it("HM-5（サーバー側）：判定のスナップショットの問い合わせだけが失敗しても、ホームは返り、準備カードの判定の行だけ load_failed になる", async () => {
      const O = await makeOrg("todayhm5");
      const p1 = await approvedPlan(O, { title: "判定の取得に失敗する日", plannedStartAt: "2027-01-05T13:00" });
      const p2 = await newPlan(O, { title: "夕方の飛行", plannedStartAt: "2027-01-05T16:00" });
      // 正常なときは counts（比べる基準）
      const ok = await today.getToday(mgr(O));
      expect(ok.card!.prep.judgement.kind).toBe("counts");
      // judgement_snapshots への問い合わせだけを失敗させる包んだ db（permits.db.test.ts の wrapped と同じ形）。件数を数える問い合わせ（snapshotItemCounts。一覧の問い合わせは通す）だけが対象
      let failed = 0;
      const wrapped = {
        query: (sql: string, ...a: unknown[]) => {
          if (/judgement_snapshots/.test(sql) && /count\(\*\) filter/.test(sql)) {
            failed++;
            return Promise.reject(new Error("injected: judgement_snapshots の問い合わせの失敗"));
          }
          return (app.query as (...x: unknown[]) => unknown)(sql, ...a);
        },
        connect: () => app.connect(),
      } as unknown as OpsDb;
      const t = await today.getToday(ctxOf(O.manager, { db: wrapped }));
      expect(failed).toBeGreaterThan(0);
      expect(t.card!.prep.judgement).toEqual({ kind: "load_failed" });
      // 他の部分は返る：カード・他の 2 行・残りの予定・次にやること
      expect(t.card).toMatchObject({ planId: p1.id, title: "判定の取得に失敗する日" });
      expect(t.card!.prep.report).toBe("confirm");
      expect(t.card!.prep.inspection).toBe("missing");
      expect(t.rest.map((r) => r.planId)).toEqual([p2.id]);
      expect(t.nextActions.length).toBeGreaterThan(0);
    });

    it("判定の項目の数え方：5 段以外の verdict（null・欠落・想定外の値・項目が null）は unknown に数える。良い側には数えない", async () => {
      const O = await makeOrg("todaycount");
      const p = await newPlan(O, { title: "件数の確認", plannedStartAt: "2027-01-05T13:00" });
      const items = [
        { verdict: "no_fly" },
        { verdict: "needs_procedure" },
        { verdict: "procedure_done" },
        { verdict: "no_procedure" },
        { verdict: "unknown" },
        { verdict: null },
        {},
        { verdict: "bogus" },
        { verdict: "NO_FLY" },
        null,
        "文字",
      ];
      const ins = await owner.query<{ id: string }>(
        `insert into judgement_snapshots (id, org_id, plan_id, reason, input, result, verdict_level, verdict_unknown_count, category, engine_version, checked_at,
           check_evidence_id, diagnosis_evidence_id, datasets, procedures_revision, procedures_verified_at, created_by_member_id)
         select gen_random_uuid(), org_id, plan_id, 'manual', input, jsonb_build_object('verdict', jsonb_build_object('items', $2::jsonb)), verdict_level, verdict_unknown_count, category, engine_version, checked_at,
                check_evidence_id, diagnosis_evidence_id, datasets, procedures_revision, procedures_verified_at, created_by_member_id
           from judgement_snapshots where plan_id = $1 order by seq desc limit 1
         returning id`,
        [p.id, JSON.stringify(items)],
      );
      const c = await store.snapshotItemCounts(app as unknown as OpsDb, O.id, ins.rows[0]!.id);
      expect(c).toEqual({ no_fly: 1, needs_procedure: 1, procedure_done: 1, no_procedure: 1, unknown: 7 });
      // 項目が配列でない（空）ときは 0 件。記録なしの null とは区別する
      const empty = await owner.query<{ id: string }>(
        `insert into judgement_snapshots (id, org_id, plan_id, reason, input, result, verdict_level, verdict_unknown_count, category, engine_version, checked_at,
           check_evidence_id, diagnosis_evidence_id, datasets, procedures_revision, procedures_verified_at, created_by_member_id)
         select gen_random_uuid(), org_id, plan_id, 'manual', input, '{}'::jsonb, verdict_level, verdict_unknown_count, category, engine_version, checked_at,
                check_evidence_id, diagnosis_evidence_id, datasets, procedures_revision, procedures_verified_at, created_by_member_id
           from judgement_snapshots where plan_id = $1 order by seq desc limit 1
         returning id`,
        [p.id],
      );
      expect(await store.snapshotItemCounts(app as unknown as OpsDb, O.id, empty.rows[0]!.id)).toEqual({ no_fly: 0, needs_procedure: 0, procedure_done: 0, no_procedure: 0, unknown: 0 });
      expect(await store.snapshotItemCounts(app as unknown as OpsDb, O.id, randomUUID())).toBeNull();
    });

    it("今日の計画が無ければ次の計画、中止した計画は対象外、操縦者役割は自分の飛行を先に", async () => {
      const O = await makeOrg("today2");
      const far = await newPlan(O, { plannedStartAt: "2027-01-08T09:00" });
      const near = await newPlan(O, { plannedStartAt: "2027-01-06T09:00" });
      const cancelled = await newPlan(O, { plannedStartAt: "2027-01-05T18:00" });
      await plans.voidPlan(mgr(O), cancelled.id, { expectedVersion: cancelled.version, reason: "中止" });
      let t = await today.getToday(mgr(O));
      expect(t.card).toMatchObject({ planId: near.id, reason: "next", primary: { kind: "plan", label: "計画を開く" } });
      expect(t.rest).toEqual([]);
      expect(t.card!.reasonLabel).toBe("次の飛行");
      expect(far.id).not.toBe(t.card!.planId);
      // 操縦者役割：自分が操縦者の飛行を先に
      const other = await newPlan(O, { plannedStartAt: "2027-01-05T12:30" });
      const mine = await newPlan(O, { plannedStartAt: "2027-01-05T15:00", pilotId: O.pilotLinked.id });
      t = await today.getToday(ctxOf(O.pilotMember));
      expect(t.card!.planId).toBe(mine.id);
      expect(t.rest.map((r) => r.planId)).toEqual([other.id]);
      t = await today.getToday(mgr(O));
      expect(t.card!.planId).toBe(other.id);
    });

    it("認可：全役割が閲覧でき、canAct は役割と自分の飛行で決まる。他の組織の計画・記録は出ない", async () => {
      const O = await makeOrg("today3");
      const Z = await makeOrg("today3b");
      const own = await newPlan(O, { plannedStartAt: "2027-01-05T13:00", pilotId: O.pilotLinked.id });
      const other = await newPlan(O, { plannedStartAt: "2027-01-05T15:00" });
      await newPlan(Z, { plannedStartAt: "2027-01-05T13:00" });
      const act = (t: today.TodayDto, planId: string, id: string) => t.nextActions.find((a) => a.planId === planId && a.id === id)!;
      const asManager = await all(mgr(O));
      const asPilot = await all(ctxOf(O.pilotMember));
      const asPilot2 = await all(ctxOf(O.pilotMember2));
      const asViewer = await all(ctxOf(O.viewer));
      for (const t of [asManager, asPilot, asPilot2, asViewer]) {
        expect(t.nextActions.every((a) => a.planId === null || [own.id, other.id].includes(a.planId))).toBe(true);
        expect(t.card).not.toBeNull();
      }
      expect(act(asManager, own.id, "do_inspection").canAct).toBe(true);
      expect(act(asManager, other.id, "do_inspection").canAct).toBe(true);
      expect(act(asPilot, own.id, "do_inspection").canAct).toBe(true);
      expect(act(asPilot, other.id, "do_inspection").canAct).toBe(false);
      expect(act(asPilot2, own.id, "check_emergency_airspace").canAct).toBe(false);
      expect(act(asViewer, own.id, "check_emergency_airspace").canAct).toBe(false);
      expect(act(asViewer, own.id, "request_confirmation").canAct).toBe(false);
      expect(act(asPilot, own.id, "request_confirmation").canAct).toBe(true);
      // 他の組織の計画は 404（現場モードの状態でも）
      await expectOpsError(field.getFieldView(mgr(Z), own.id), 404);
    });

    it("日誌の食い違いを確認する（直近 3 日間だけ）と、技能証明を更新する（60 日前・期限切れ）", async () => {
      const O = await makeOrg("today4", 0.9, "2027-02-20");
      const p = await approvedPlan(O, { plannedStartAt: "2027-01-05T13:00", pilotId: O.pilotLinked.id });
      const f = await rec.createFlight(mgr(O), { ...flightInput(O, "2027-01-04T10:00", "2027-01-04T10:30"), pilotId: O.pilotLinked.id, flightPlanId: p.id });
      let t = await today.getToday(mgr(O));
      const m = t.nextActions.find((a) => a.id === "review_journal_mismatch")!;
      expect(m).toMatchObject({ tier: 4, href: `/ops/flights/${f.record.id}`, canAct: true });
      const lic = t.nextActions.find((a) => a.id === "renew_license")!;
      expect(lic).toMatchObject({ tier: 5, href: `/ops/pilots/${O.pilotLinked.id}`, label: "技能証明の有効期限を確認する" });
      expect(lic.reason).toContain("2027-02-20");
      // 時間で消える：4 日後には出ない
      t = await today.getToday(ctxOf(O.manager, { now: () => new Date(NOW.getTime() + 3.5 * 24 * 3600_000) }));
      expect(ids(t)).not.toContain("review_journal_mismatch");
      // 期限切れは tier 3
      const E = await makeOrg("today5", 0.9, "2027-01-04");
      await newPlan(E, { plannedStartAt: "2027-01-05T13:00", pilotId: E.pilotLinked.id });
      const te = await today.getToday(mgr(E));
      expect(te.nextActions.find((a) => a.id === "renew_license")).toMatchObject({ tier: 3 });
      // 61 日後（2027-03-07）は出ない
      const F = await makeOrg("today6", 0.9, "2027-03-07");
      await newPlan(F, { plannedStartAt: "2027-01-05T13:00", pilotId: F.pilotLinked.id });
      expect(ids(await today.getToday(mgr(F)))).not.toContain("renew_license");
    });

    it("予定終了から 60 分を過ぎても飛行記録も離陸の行も無い計画に、日誌を記入する（計画を中止する旨を添える）", async () => {
      const O = await makeOrg("today7");
      const p = await newPlan(O, { plannedStartAt: "2027-01-05T09:00", durationMinutes: 60 });
      const at = (hm: string) => ctxOf(O.manager, { now: () => new Date(`2027-01-05T${hm}:00+09:00`) });
      expect(ids(await today.getToday(at("10:59")))).not.toContain("write_journal");
      const t = await today.getToday(at("11:00"));
      const w = t.nextActions.find((a) => a.id === "write_journal")!;
      expect(w).toMatchObject({ planId: p.id, tier: 3, href: `/ops/flights/new?planId=${p.id}` });
      expect(w.reason).toContain("計画を中止");
      // 飛行記録が入れば消える
      await rec.createFlight(mgr(O), { ...flightInput(O, "2027-01-05T09:10", "2027-01-05T09:40"), flightPlanId: p.id });
      expect(ids(await today.getToday(at("11:30")))).not.toContain("write_journal");
    });

    it("result 全体を読まない（判定スナップショットの result は一部の項目だけを取る）。クエリ数は計画の件数に比例しない", async () => {
      const queries = async (n: number) => {
        const O = await makeOrg(`q${n}`);
        for (let i = 0; i < n; i++) await newPlan(O, { plannedStartAt: `2027-01-0${5 + (i % 3)}T${String(8 + (i % 10)).padStart(2, "0")}:00` });
        log.sql = [];
        await today.getToday({ db: countingDb(), member: O.manager, now: () => NOW, env: {} });
        return [...log.sql];
      };
      const q2 = await queries(2);
      const q9 = await queries(9);
      expect(q9.length).toBe(q2.length);
      for (const sql of q9) {
        expect(sql).not.toMatch(/\bs\.result(?!\s*->)/);
        expect(sql).not.toMatch(/select\s+s\.\*/i);
      }
    });

    it("中止した計画でも飛行中の離陸があればカードに出て、着陸を記録するが出る。「通報不要」などの禁止語が出ない", async () => {
      const O = await makeOrg("today8");
      const p = await newPlan(O);
      await post(O, p.id, body("takeoff"), mgr(O));
      await plans.voidPlan(mgr(O), p.id, { expectedVersion: p.version, reason: "天候" });
      const t = await today.getToday(mgr(O));
      expect(t.card).toMatchObject({ planId: p.id, reason: "in_flight" });
      expect(t.nextActions[0]).toMatchObject({ id: "record_landing", tier: 1 });
      expect(JSON.stringify(t)).not.toMatch(/通報不要|通報は不要|通報の必要はありません|通報しなくて|特許|出願/);
    });
  });

  // ---- Sprint 14：書類・手続き・飛行自粛要請・現場状況の記録 ------------------------------------
  describe("7. Sprint 14：新しい確認項目の記録（0017）", () => {
    const SITE_N = { thirdParty: "none", otherAircraft: "none", rain: "none", visibility: "good", windMs: 3.2, tempC: 18 };
    const siteBody = (site: Record<string, unknown> = SITE_N, extra: Record<string, unknown> = {}) => checkBody("site_conditions", { site, ...extra });
    const raw14 = async (planId: string, org: Org, cols: Record<string, unknown>) => {
      const all: Record<string, unknown> = {
        org_id: org.id,
        plan_id: planId,
        kind: "check",
        item: "flight_restriction",
        result: "done",
        occurred_at: "2027-01-05T03:00:00Z",
        client_event_id: cid(),
        recorded_by_member_id: org.manager.id,
        ...cols,
      };
      const keys = Object.keys(all);
      return (await owner.query(`insert into flight_field_events (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")}) returning *`, keys.map((k) => all[k]))).rows[0];
    };
    const code = async (p: Promise<unknown>): Promise<string> => {
      const e = await p.then(
        () => null,
        (x: unknown) => x as { code: string },
      );
      expect(e, "拒否されていない").not.toBeNull();
      return e!.code;
    };

    it("C-1 新しい記録も追記専用：更新・削除・TRUNCATE は、テーブルの所有者のロールでも SB409（immutable）で拒否される", async () => {
      const p = await newPlan(O);
      const row = await raw14(p.id, O, { item: "docs_confirm", doc_key: "remote_id" });
      for (const stmt of ["update flight_field_events set note = 'x'", "delete from flight_field_events", "truncate flight_field_events"]) {
        const e = await owner.query(stmt).then(
          () => null,
          (x: unknown) => x as { code: string; detail?: string },
        );
        expect(e?.code, stmt).toBe("SB409");
        expect(e?.detail, stmt).toBe("immutable");
      }
      expect(await count("flight_field_events", "id = $1", [row.id])).toBe(1);
    });

    it("C-4 DB が recorded_at・記録者の写し・content_hash（v2）・スナップショットと版を決める。アプリが送った値は使わない", async () => {
      const p = await newPlan(O);
      const r = await post(O, p.id, siteBody(SITE_N, { snapshotId: randomUUID(), planVersion: 77, contentHash: "x", recordedAt: "2000-01-01T00:00:00Z", recordedByName: "偽" }));
      expect(r.event.snapshotId).toBe(p.currentSnapshotId);
      expect(r.event.planVersion).toBe(p.version);
      expect(r.event.recordedByName).toBe(O.manager.display_name);
      expect(r.event.contentHash).toMatch(/^[0-9a-f]{64}$/);
      expect(r.event.site).toEqual(SITE_N);
      expect(new Date(r.event.recordedAt).getFullYear()).toBeGreaterThan(2020);
      const h = await owner.query(
        `select flight_field_event_hash_v2(e.id, e.org_id, e.plan_id, e.kind, e.item, e.result, e.source, e.target_event_id,
                e.flight_record_id, e.inspection_id, e.report_id, e.occurred_at, e.snapshot_id, e.plan_version, e.gaps, e.note,
                e.queued, e.client_event_id, e.recorded_by_member_id, e.recorded_by_name, e.recorded_by_role, e.recorded_at,
                e.doc_key, e.site_third_party, e.site_other_aircraft, e.site_rain, e.site_visibility, e.site_wind_ms, e.site_temp_c) as h
           from flight_field_events e where e.id = $1`,
        [r.event.id],
      );
      expect(h.rows[0].h).toBe(r.event.contentHash);
    });

    it("DB の制約：doc_key は docs_confirm の行だけ・現場状況の列は site_conditions の行だけ・注意ありは備考が必須・数値の範囲", async () => {
      const p = await newPlan(O);
      const okSite = { item: "site_conditions", site_third_party: "none", site_other_aircraft: "none", site_rain: "none", site_visibility: "good" };
      await raw14(p.id, O, okSite);
      await raw14(p.id, O, { item: "docs_confirm", doc_key: "license" });
      const bad: [string, Record<string, unknown>][] = [
        ["docs_confirm に doc_key がない", { item: "docs_confirm" }],
        ["doc_key が 6 項目の外", { item: "docs_confirm", doc_key: "other" }],
        ["別の項目に doc_key", { item: "carry", doc_key: "permit" }],
        ["現場状況の選択が欠ける", { item: "site_conditions", site_third_party: "none" }],
        ["別の項目に現場状況の列", { item: "carry", site_rain: "none" }],
        ["選択肢の外", { ...okSite, site_rain: "heavy" }],
        ["注意ありで備考がない", { ...okSite, site_third_party: "present" }],
        ["注意ありで備考が空白", { ...okSite, site_visibility: "limited", note: "  " }],
        ["風速が負", { ...okSite, site_wind_ms: -1 }],
        ["風速が極端に大きい", { ...okSite, site_wind_ms: 99 }],
        ["気温が範囲外", { ...okSite, site_temp_c: 100 }],
        ["undo に現場状況の列", { kind: "undo", item: null, result: null, site_rain: "none" }],
      ];
      for (const [label, cols] of bad) expect(["23514", "SB404", "23503"], label).toContain(await code(raw14(p.id, O, cols)));
      await raw14(p.id, O, { ...okSite, site_third_party: "present", note: "農道に歩行者" });
    });

    it("C-2 同じ client_event_id の再送は、内容が同じなら既存の行を返し（行は増えない）、違えば 409 request_conflict", async () => {
      const p = await newPlan(O);
      const b = siteBody();
      const a = await post(O, p.id, b);
      const again = await post(O, p.id, b);
      expect(again.created).toBe(false);
      expect(again.event.id).toBe(a.event.id);
      expect(await count("flight_field_events", "plan_id = $1 and item = 'site_conditions'", [p.id])).toBe(1);
      await expectOpsError(post(O, p.id, { ...b, site: { ...SITE_N, windMs: 9 } }), 409, "request_conflict");
      const d = checkBody("docs_confirm", { docKey: "manual" });
      await post(O, p.id, d);
      expect((await post(O, p.id, d)).created).toBe(false);
      await expectOpsError(post(O, p.id, { ...d, docKey: "remote_id" }), 409, "request_conflict");
    });

    it("C-3 取り消す（undo）と状態が戻る。同じ行は 2 回取り消せない", async () => {
      const p = await newPlan(O);
      const c = await post(O, p.id, checkBody("docs_confirm", { docKey: "remote_id" }));
      const v1 = await field.getFieldView(mgr(O), p.id);
      expect(v1.docs.find((d) => d.key === "remote_id")).toMatchObject({ effective: "confirmed_human", humanConfirmEventId: c.event.id });
      await post(O, p.id, body("undo", { targetEventId: c.event.id }));
      const v2 = await field.getFieldView(mgr(O), p.id);
      expect(v2.docs.find((d) => d.key === "remote_id")).toMatchObject({ effective: "needs_check", canConfirm: true });
      await expectOpsError(post(O, p.id, body("undo", { targetEventId: c.event.id })), 409, "already_undone");
      const s = await post(O, p.id, siteBody());
      expect((await field.getFieldView(mgr(O), p.id)).round.site.done).toBe(true);
      await post(O, p.id, body("undo", { targetEventId: s.event.id }));
      expect((await field.getFieldView(mgr(O), p.id)).round.site.done).toBe(false);
    });

    it("C-5 認可：viewer は 403、pilot と manager は記録できる、他の組織の計画は 404、取り消された計画は 409 plan_cancelled", async () => {
      const own = await newPlan(O, { pilotId: O.pilotLinked.id });
      const sample = () => siteBody();
      await expectOpsError(post(O, own.id, sample(), ctxOf(O.viewer)), 403, "forbidden");
      await expectOpsError(post(O, own.id, checkBody("docs_confirm", { docKey: "manual" }), ctxOf(O.viewer)), 403, "forbidden");
      await expectOpsError(post(O, own.id, checkBody("flight_restriction"), ctxOf(O.viewer)), 403, "forbidden");
      await expect(post(O, own.id, sample(), ctxOf(O.pilotMember))).resolves.toMatchObject({ created: true });
      await expect(post(O, own.id, checkBody("flight_restriction"), mgr(O))).resolves.toMatchObject({ created: true });
      await expectOpsError(post(O, own.id, sample(), ctxOf(B.manager)), 404, "not_found");
      const p = await newPlan(O);
      await plans.voidPlan(mgr(O), p.id, { expectedVersion: p.version, reason: "天候" });
      await expectOpsError(post(O, p.id, sample()), 409, "plan_cancelled");
      await expectOpsError(post(O, p.id, checkBody("docs_confirm", { docKey: "manual" })), 409, "plan_cancelled");
    });

    it("C-6 現場状況の検査：選択肢の外・風速と気温の範囲外・書類の項目の外は 400。注意ありで備考が空なら 400（note_required）", async () => {
      const p = await newPlan(O);
      await expectOpsError(post(O, p.id, siteBody({ ...SITE_N, rain: "storm" })), 400, "invalid_input");
      await expectOpsError(post(O, p.id, siteBody({ ...SITE_N, windMs: -5 })), 400, "invalid_input");
      await expectOpsError(post(O, p.id, siteBody({ ...SITE_N, windMs: 500 })), 400, "invalid_input");
      await expectOpsError(post(O, p.id, siteBody({ ...SITE_N, tempC: -80 })), 400, "invalid_input");
      await expectOpsError(post(O, p.id, checkBody("docs_confirm", { docKey: "zzz" })), 400, "invalid_input");
      const e = await expectOpsError(post(O, p.id, siteBody({ ...SITE_N, thirdParty: "present" })), 400, "invalid_input");
      expect(e.fieldCodes).toMatchObject({ note: "note_required" });
      await expect(post(O, p.id, siteBody({ ...SITE_N, thirdParty: "present" }, { note: "農道に歩行者" }))).resolves.toMatchObject({ created: true });
      // 数値は未入力でも保存できる
      await expect(post(O, p.id, siteBody({ ...SITE_N, windMs: null, tempC: null }))).resolves.toMatchObject({ created: true });
    });

    it("C-7 時刻の検査は 12c と同じ：その場の送信は ±5 分、送信待ちは 72 時間まで", async () => {
      const p = await newPlan(O);
      await expectOpsError(post(O, p.id, checkBody("flight_restriction", { occurredAt: "2027-01-05T11:50" })), 400, "clock_skew");
      await expectOpsError(post(O, p.id, siteBody(SITE_N, { occurredAt: "2027-01-05T12:30" })), 400, "future_time");
      await expectOpsError(post(O, p.id, checkBody("docs_confirm", { docKey: "manual", occurredAt: "2027-01-02T11:59", queued: true })), 400, "too_old");
      await expect(post(O, p.id, siteBody(SITE_N, { occurredAt: "2027-01-03T12:30", queued: true }))).resolves.toMatchObject({ created: true });
    });

    it("満たさない書類は人の確認で変えられない（409 doc_unmet）", async () => {
      // 操縦者の技能証明の有効期限が飛行日より前
      const pilot = await addPilot(O.id, "期限切れ 操縦者", null, "2026-12-31");
      const p = await newPlan(O, { pilotId: pilot.id });
      const v = await field.getFieldView(mgr(O), p.id);
      expect(v.docs.find((d) => d.key === "license")).toMatchObject({ status: "unmet", effective: "unmet", canConfirm: false });
      await expectOpsError(post(O, p.id, checkBody("docs_confirm", { docKey: "license" })), 409, "doc_unmet");
    });

    it("B-3/B-6/D-4 技能証明：期限内は確認済み（根拠に名前と期限・番号は含まない）。登録を変えると開き直したとき満たさないに変わり、離陸の gaps は書き換わらない", async () => {
      const pilot = await addPilot(O.id, "有効 操縦者", null, "2027-06-30");
      const p = await newPlan(O, { pilotId: pilot.id });
      const v = await field.getFieldView(mgr(O), p.id);
      const lic = v.docs.find((d) => d.key === "license")!;
      expect(lic).toMatchObject({ status: "confirmed", effective: "confirmed_auto" });
      expect(lic.basis.join("")).toContain("有効 操縦者");
      expect(lic.basis.join("")).toContain("2027-06-30");
      expect(JSON.stringify(v.docs)).not.toContain(LICENSE);
      expect(v.docs.find((d) => d.key === "registration")).toMatchObject({ status: "confirmed" });
      const t = await post(O, p.id, body("takeoff"));
      expect(t.event.gaps!.map((g) => g.item)).not.toContain("docs_license");
      // 登録を変える（期限を飛行日より前に）
      await owner.query("update pilots set license_expires_on = '2026-12-31' where id = $1", [pilot.id]).catch(async () => {
        await owner.query("alter table pilots disable trigger user");
        await owner.query("update pilots set license_expires_on = '2026-12-31' where id = $1", [pilot.id]);
        await owner.query("alter table pilots enable trigger user");
      });
      const v2 = await field.getFieldView(mgr(O), p.id);
      expect(v2.docs.find((d) => d.key === "license")).toMatchObject({ status: "unmet" });
      const rows = await eventRows(p.id);
      expect(rows.find((r) => r.kind === "takeoff").gaps.map((g: { item: string }) => g.item)).not.toContain("docs_license");
    });

    it("B-7 判定は他の組織のデータを読まない：別の組織の許可番号・機体・操縦者で確認済みにならない", async () => {
      const permitBodyB = {
        permitNumber: "XORG-1",
        coverage: "blanket",
        kinds: ["did", "night"],
        issuedOn: "2026-09-25",
        validFrom: "2026-10-01",
        validTo: "2027-09-30",
        placeScope: { type: "nationwide" },
        aircraftScope: { type: "any" },
        pilotScope: { type: "any" },
        clientRequestId: randomUUID(),
      };
      const { createPermit } = await import("./permits");
      await createPermit(ctxOf(A.manager), permitBodyB);
      const pB = await newPlan(B, { permitNumbers: "XORG-1", flags: ["method_night"] });
      const v = await field.getFieldView(mgr(B), pB.id);
      const permit = v.docs.find((d) => d.key === "permit")!;
      expect(permit.status).not.toBe("confirmed");
      // 別の組織の登録（期間・版）が根拠に出ない。登録の画面への経路も作られない
      expect(permit.basis.join("")).not.toContain("2026-10-01");
      expect(permit.basis.join("")).not.toContain("登録の版");
      expect(permit.href).not.toMatch(/\/ops\/permits\/[0-9a-f-]{36}/);
      await expectOpsError(field.getFieldView(mgr(B), (await newPlan(A)).id), 404, "not_found");
    });

    it("B-4/E-2 通報：離陸前に完了した通報（受付番号つき）で確認済み。画面の判定に「通報不要」を出さない", async () => {
      const p = await approvedPlan(O);
      const before = await field.getFieldView(mgr(O), p.id);
      expect(before.docs.find((d) => d.key === "report")).toMatchObject({ status: "needs_check" });
      await reportNew(O, p, "2027-01-05T11:00");
      const after = await field.getFieldView(mgr(O), p.id);
      expect(after.docs.find((d) => d.key === "report")).toMatchObject({ status: "confirmed" });
      expect(JSON.stringify(after.docs)).not.toMatch(/通報不要|手続き不要|該当なし/);
    });

    it("レビュー指摘：人の確認の対象は要確認の項目だけ（通報・自動で確認済みの項目は 409 doc_not_confirmable）", async () => {
      const p = await newPlan(O);
      await expectOpsError(post(O, p.id, checkBody("docs_confirm", { docKey: "report" })), 409, "doc_not_confirmable");
      await expectOpsError(post(O, p.id, checkBody("docs_confirm", { docKey: "registration" })), 409, "doc_not_confirmable");
      await expect(post(O, p.id, checkBody("docs_confirm", { docKey: "manual" }))).resolves.toMatchObject({ created: true });
    });

    it("レビュー指摘：人の確認は計画の版に結び付く。計画を訂正して版が進むと、前の版への確認は引き継がれない", async () => {
      const p = await newPlan(O);
      await post(O, p.id, checkBody("docs_confirm", { docKey: "remote_id" }));
      expect((await field.getFieldView(mgr(O), p.id)).docs.find((d) => d.key === "remote_id")!.effective).toBe("confirmed_human");
      await plans.updatePlan(mgr(O), p.id, { expectedVersion: p.version, reason: "名称の訂正", title: "訂正後" });
      const v = await field.getFieldView(mgr(O), p.id);
      expect(v.docs.find((d) => d.key === "remote_id")!.effective).toBe("needs_check");
      // 新しい版で確認し直せる
      await post(O, p.id, checkBody("docs_confirm", { docKey: "remote_id" }));
      expect((await field.getFieldView(mgr(O), p.id)).docs.find((d) => d.key === "remote_id")!.effective).toBe("confirmed_human");
    });

    it("レビュー指摘：次の飛行が始まっている着陸は取り消せない（409 later_flight_exists）", async () => {
      const p = await newPlan(O);
      const t = (hm: string) => ({ occurredAt: `2027-01-05T${hm}`, queued: true });
      await post(O, p.id, body("takeoff", t("11:00")));
      const l1 = await post(O, p.id, body("landing", t("11:20")));
      await post(O, p.id, body("takeoff", t("11:30")));
      await expectOpsError(post(O, p.id, body("undo", { targetEventId: l1.event.id })), 409, "later_flight_exists");
    });

    it("レビュー指摘：飛行中は開いている離陸の時刻で判定する。離陸のあとに記録した通報は確認済みにならない", async () => {
      const p = await approvedPlan(O);
      await post(O, p.id, body("takeoff", { occurredAt: "2027-01-05T11:50", queued: true }));
      await reportNew(O, p, "2027-01-05T11:58");
      const v = await field.getFieldView(mgr(O), p.id);
      expect(v.docs.find((d) => d.key === "report")).toMatchObject({ status: "needs_check" });
    });

    it("レビュー指摘：夜間と目視外が必要な計画に、夜間だけの有効な許可では確認済みにならない", async () => {
      const { createPermit } = await import("./permits");
      const num = `PART-${randomUUID().slice(0, 6)}`;
      await createPermit(mgr(O), {
        permitNumber: num, coverage: "blanket", kinds: ["night"], issuedOn: "2026-09-25", validFrom: "2026-10-01", validTo: "2027-09-30",
        placeScope: { type: "nationwide" }, aircraftScope: { type: "any" }, pilotScope: { type: "any" }, clientRequestId: randomUUID(),
      });
      const p = await newPlan(O, { permitNumbers: num, flags: ["method_night", "method_bvlos"] });
      const v = await field.getFieldView(mgr(O), p.id);
      expect(v.docs.find((d) => d.key === "permit")!.status).not.toBe("confirmed");
    });

    it("ユーザー決定：通報の前後は記録の時刻で判定する。記録が離陸より後なら、入力した通報日時が前でも要確認、離陸の gaps に通報が出る", async () => {
      const p = await approvedPlan(O);
      await reportNew(O, p, "2027-01-05T11:00");
      // 記録の時刻を離陸（12:00）より後にする（DB の時計は実時刻のため、所有者のロールで記録の時刻だけを動かす）
      await owner.query("update flight_reports set created_at = '2027-01-05T12:30:00+09:00' where plan_id = $1", [p.id]);
      const v = await field.getFieldView(mgr(O), p.id);
      expect(v.docs.find((d) => d.key === "report")).toMatchObject({ status: "needs_check" });
      const t = await post(O, p.id, body("takeoff"));
      const g = Object.fromEntries(t.event.gaps!.map((x) => [x.item, x.state]));
      expect(g["report"]).toBe("after_takeoff");
    });

    it("ユーザー決定：日誌済みの飛行のラウンドに属する空域・飛行自粛要請・現場状況の確認は取り消せない（409 round_journaled）。計画ごとの確認は取り消せる", async () => {
      const p = await newPlan(O);
      const t = (hm: string) => ({ occurredAt: `2027-01-05T${hm}`, queued: true });
      const em = await post(O, p.id, checkBody("emergency_airspace", t("11:00")));
      const rs = await post(O, p.id, checkBody("flight_restriction", t("11:01")));
      const st = await post(O, p.id, siteBody(SITE_N, t("11:02")));
      const cr = await post(O, p.id, checkBody("carry", t("11:03")));
      const tk = await post(O, p.id, body("takeoff", t("11:10")));
      await post(O, p.id, body("landing", t("11:30")));
      // 日誌待ちのうちは取り消せる（取り消して記録し直す）
      await post(O, p.id, body("undo", { targetEventId: em.event.id }));
      const em2 = await post(O, p.id, checkBody("emergency_airspace", { occurredAt: "2027-01-05T11:05", queued: true }));
      // 2 つ目の緊急用務空域の確認は着陸の後に記録したので次のラウンドに属する。日誌に結び付ける
      await rec.createFlight(mgr(O), flightInput(O, "2027-01-05T11:10", "2027-01-05T11:30", { takeoffEventId: tk.event.id }));
      for (const target of [rs, st]) await expectOpsError(post(O, p.id, body("undo", { targetEventId: target.event.id })), 409, "round_journaled");
      await expect(post(O, p.id, body("undo", { targetEventId: cr.event.id }))).resolves.toMatchObject({ created: true });
      await expect(post(O, p.id, body("undo", { targetEventId: em2.event.id }))).resolves.toMatchObject({ created: true });
    });

    it("D-9 1 つの計画で 2 回飛ぶ通し：確認 → 離陸 → 着陸 → 飛行後点検 → 次の飛行 → 確認 → 離陸 → 着陸", async () => {
      const p = await approvedPlan(O);
      await inspect(O, "2027-01-05T10:00", { planId: p.id });
      await reportNew(O, p, "2027-01-05T11:00");
      const t = (hm: string) => ({ occurredAt: `2027-01-05T${hm}`, queued: true });
      await post(O, p.id, checkBody("emergency_airspace", t("11:10")));
      await post(O, p.id, checkBody("flight_restriction", t("11:11")));
      await post(O, p.id, siteBody(SITE_N, t("11:12")));
      await post(O, p.id, checkBody("carry", t("11:13")));
      await post(O, p.id, checkBody("docs_confirm", { docKey: "remote_id", ...t("11:14") }));
      const t1 = await post(O, p.id, body("takeoff", t("11:20")));
      await post(O, p.id, body("landing", t("11:40")));
      // 着陸の直後：飛行後点検は未了、次のラウンドの飛行前は未了、計画ごとの確認は持ち越し
      let v = await field.getFieldView(mgr(O), p.id);
      expect(v.postPendingCount).toBe(1);
      expect(v.round.number).toBe(2);
      expect(v.round.restriction.done).toBe(false);
      expect(v.round.site.done).toBe(false);
      expect(v.items.find((i) => i.item === "emergency_airspace")!.done).toBe(false);
      expect(v.items.find((i) => i.item === "carry")!.done).toBe(true);
      expect(v.docs.find((d) => d.key === "remote_id")!.effective).toBe("confirmed_human");
      // 飛行後点検（飛行後の日常点検）。Sprint 15（R-1）：計画に結び付けた点検だけが、その計画の飛行後点検に数える
      await inspect(O, "2027-01-05T11:45", { timing: "post_flight", planId: p.id });
      v = await field.getFieldView(mgr(O), p.id);
      expect(v.postPendingCount).toBe(0);
      expect(v.flights[0]!.post.done).toBe(true);
      // 次の飛行（点検からやり直し）
      await inspect(O, "2027-01-05T11:50", { planId: p.id });
      await post(O, p.id, checkBody("emergency_airspace", t("11:51")));
      await post(O, p.id, checkBody("flight_restriction", t("11:52")));
      await post(O, p.id, siteBody(SITE_N, t("11:53")));
      const t2 = await post(O, p.id, body("takeoff", t("11:55")));
      // 2 回目の離陸の gaps：ラウンドごとの項目は済んでいるので出ない。持ち越した人の確認も出ない
      expect(t2.event.gaps!.map((g) => g.item)).not.toContain("flight_restriction");
      expect(t2.event.gaps!.map((g) => g.item)).not.toContain("docs_remote_id");
      await post(O, p.id, body("landing", { occurredAt: "2027-01-05T12:00" }));
      v = await field.getFieldView(mgr(O), p.id);
      expect(v.flights.map((f) => f.phase)).toEqual(["journal_pending", "journal_pending"]);
      expect(v.flights.map((f) => f.roundNumber)).toEqual([1, 2]);
      expect(v.postPendingCount).toBe(1);
      expect(t1.event.gaps!.length).toBeGreaterThanOrEqual(0);
    });

    it("D-10 未了があっても離陸は記録され（201）、離陸の行に未了の写しが残る。現場状況の注意ありは gaps に出る", async () => {
      const p = await approvedPlan(O);
      await post(O, p.id, siteBody({ ...SITE_N, rain: "present" }, { note: "小雨" }));
      const t = await post(O, p.id, body("takeoff"));
      expect(t.created).toBe(true);
      const g = Object.fromEntries(t.event.gaps!.map((x) => [x.item, x.state]));
      expect(g["site_conditions"]).toBe("attention");
      expect(g["flight_restriction"]).toBe("none");
      const row = (await eventRows(p.id)).find((r) => r.kind === "takeoff");
      expect(row.gaps.some((x: { item: string }) => x.item === "site_conditions")).toBe(true);
    });
  });

  describe("8. Sprint 15 R-1：飛行後点検を計画に結び付ける", () => {
    const landed = async () => {
      const p = await approvedPlan(A);
      const t = (hm: string) => ({ occurredAt: `2027-01-05T${hm}`, queued: true });
      await post(A, p.id, body("takeoff", t("11:20")));
      await post(A, p.id, body("landing", t("11:40")));
      return p;
    };

    it("同じ機体・同じ日の 2 つの計画で、一方の計画に結び付けた飛行後点検は、他方の計画を満たさない", async () => {
      const p1 = await landed();
      const p2 = await landed();
      const before = await count("flight_field_events", "plan_id = $1 and item = 'inspection'", [p1.id]);
      const r = await inspect(A, "2027-01-05T11:45", { timing: "post_flight", planId: p1.id });
      // 点検の保存と同じトランザクションで、計画 1 にだけ結び付きの行（check・inspection・inspection_id）が追記される
      expect(await count("flight_field_events", "plan_id = $1 and item = 'inspection' and inspection_id = $2", [p1.id, r.record.id])).toBe(1);
      expect(await count("flight_field_events", "plan_id = $1 and item = 'inspection'", [p1.id])).toBe(before + 1);
      expect(await count("flight_field_events", "plan_id = $1 and item = 'inspection'", [p2.id])).toBe(0);
      const v1 = await field.getFieldView(mgr(A), p1.id);
      const v2 = await field.getFieldView(mgr(A), p2.id);
      expect(v1.flights[0]!.post.done).toBe(true);
      expect(v1.postPendingCount).toBe(0);
      // 機体と時刻は合っているが、計画 2 には結び付いていない
      expect(v2.flights[0]!.post.done).toBe(false);
      expect(v2.postPendingCount).toBe(1);
    });

    it("結び付きのない飛行後点検（Sprint 14 以前の点検・planId なしの点検）は、どの計画の飛行後点検にも数えない", async () => {
      const p = await landed();
      await inspect(A, "2027-01-05T11:46", { timing: "post_flight" });
      const v = await field.getFieldView(mgr(A), p.id);
      expect(v.flights[0]!.post.done).toBe(false);
      expect(v.postPendingCount).toBe(1);
    });

    it("同じ clientRequestId の再送は、点検も結び付きも 1 行のまま（冪等）。別の組織の計画には結び付けられない（400）", async () => {
      const p = await landed();
      const reqId = randomUUID();
      const a = await inspect(A, "2027-01-05T11:47", { timing: "post_flight", planId: p.id, clientRequestId: reqId, queued: true });
      const b = await inspect(A, "2027-01-05T11:47", { timing: "post_flight", planId: p.id, clientRequestId: reqId, queued: true });
      expect(a.created).toBe(true);
      expect(b.created).toBe(false);
      expect(b.record.id).toBe(a.record.id);
      expect(await count("flight_field_events", "plan_id = $1 and item = 'inspection'", [p.id])).toBe(1);
      const link = (await eventRows(p.id)).find((x) => x.item === "inspection");
      expect(link.queued).toBe(true);
      expect(link.inspection_id).toBe(a.record.id);
      const other = await approvedPlan(B);
      await expectOpsError(inspect(A, "2027-01-05T11:48", { timing: "post_flight", planId: other.id }), 400);
    });

    it("BUG-1：計画の操縦者でない操縦者は、他人の計画に点検を結び付けられない（403。点検も結び付きも増えず、飛行後点検は未のまま）。運航管理者・計画の操縦者本人は結び付けられる", async () => {
      // 計画 p は操縦者 pilotLinked（利用者 pilotMember に結び付く）の計画
      const p = await approvedPlan(A, { pilotId: A.pilotLinked.id });
      const t = (hm: string) => ({ occurredAt: `2027-01-05T${hm}`, queued: true });
      await post(A, p.id, body("takeoff", t("10:35")));
      await post(A, p.id, body("landing", t("10:45")));
      // 別の操縦者（pilotMember2。自分の操縦者の行を持つ）が、自分の点検に p を指定する
      const existing = (await owner.query<PilotRow>("select * from pilots where member_id = $1", [A.pilotMember2.id])).rows[0];
      const other = existing ?? (await addPilot(A.id, "別の 操縦者", A.pilotMember2.id));
      const otherCtx = ctxOf(A.pilotMember2);
      const before = await count("daily_inspections", "org_id = $1", [A.id]);
      await expectOpsError(
        rec.createInspection(otherCtx, { aircraftId: A.aircraft, pilotId: other.id, inspectedAt: "2027-01-05T10:55", timing: "post_flight", placeName: "本社", items: ITEMS, planId: p.id }),
        403,
        "forbidden",
      );
      // 比較：同じ人が現場の行を直接送っても 403
      await expectOpsError(post(A, p.id, checkBody("carry"), otherCtx), 403);
      expect(await count("daily_inspections", "org_id = $1", [A.id])).toBe(before);
      expect(await count("flight_field_events", "plan_id = $1 and item = 'inspection'", [p.id])).toBe(0);
      expect((await field.getFieldView(mgr(A), p.id)).postPendingCount).toBe(1);
      // 計画の操縦者本人は結び付けられる
      const self = await rec.createInspection(ctxOf(A.pilotMember), {
        aircraftId: A.aircraft,
        pilotId: A.pilotLinked.id,
        inspectedAt: "2027-01-05T10:56",
        timing: "post_flight",
        placeName: "本社",
        items: ITEMS,
        planId: p.id,
      });
      expect(self.created).toBe(true);
      expect((await field.getFieldView(mgr(A), p.id)).postPendingCount).toBe(0);
    });

    it("飛行前点検も計画に結び付いた点検だけを数える（同じ機体・同じ日の別の計画の飛行前点検では満たさない）", async () => {
      const p1 = await approvedPlan(A);
      const p2 = await approvedPlan(A);
      await inspect(A, "2027-01-05T10:00", { planId: p1.id });
      const v1 = await field.getFieldView(mgr(A), p1.id);
      const v2 = await field.getFieldView(mgr(A), p2.id);
      expect(v1.items.find((i) => i.item === "inspection")!.done).toBe(true);
      expect(v2.items.find((i) => i.item === "inspection")!.done).toBe(false);
      // 結び付きのない点検（点検の一覧から入れた点検）も満たさない
      const p3 = await approvedPlan(A);
      await inspect(A, "2027-01-05T10:01");
      expect((await field.getFieldView(mgr(A), p3.id)).items.find((i) => i.item === "inspection")!.done).toBe(false);
    });

    it("計画の機体と違う機体の点検・中止した計画には結び付けない（点検は保存される）", async () => {
      const p = await landed();
      const voided = await approvedPlan(A);
      await plans.voidPlan(mgr(A), voided.id, { expectedVersion: voided.version, reason: "中止" });
      const r = await inspect(A, "2027-01-05T11:49", { timing: "post_flight", planId: voided.id });
      expect(r.created).toBe(true);
      expect(await count("flight_field_events", "plan_id = $1 and item = 'inspection'", [voided.id])).toBe(0);
      expect((await field.getFieldView(mgr(A), p.id)).postPendingCount).toBe(1);
    });

    it("fillFromPlan：場所名を送らない点検（端末の送信待ち）は、計画の場所名が入る", async () => {
      const p = await landed();
      const r = await rec.createInspection(mgr(A), {
        aircraftId: A.aircraft,
        pilotId: A.pilotFree.id,
        inspectedAt: "2027-01-05T11:50",
        timing: "post_flight",
        items: ITEMS,
        planId: p.id,
        fillFromPlan: true,
      });
      expect(r.record.placeName).toBe("フューチャーテック株式会社 本社");
      expect(r.record.latitude).toBeNull();
    });

    it("fillFromPlan：目的・場所・座標・特定飛行の形態を送らない日誌は、計画の値が入る（日誌への結び付きも 1 回）", async () => {
      const pl = await newPlan(A, { plannedStartAt: "2027-01-05T09:00" });
      const t = (hm: string) => ({ occurredAt: `2027-01-05T${hm}`, queued: true });
      const tk = await post(A, pl.id, body("takeoff", t("09:20")));
      await post(A, pl.id, body("landing", t("09:40")));
      const reqId = randomUUID();
      const input = {
        aircraftId: A.aircraft,
        pilotId: A.pilotFree.id,
        takeoffAt: "2027-01-05T09:20",
        landingAt: "2027-01-05T09:40",
        safetyIssue: false,
        takeoffEventId: tk.event.clientEventId,
        flightPlanId: pl.id,
        clientRequestId: reqId,
        fillFromPlan: true,
      };
      const f = await rec.createFlight(mgr(A), input);
      expect(f.created).toBe(true);
      expect(f.record.purpose).toBe("空撮");
      expect(f.record.takeoffPlace).toBe("フューチャーテック株式会社 本社");
      expect(f.record.takeoffLat).not.toBeNull();
      expect(f.record.specificFlightTypes).toContain("night");
      const again = await rec.createFlight(mgr(A), input);
      expect(again.created).toBe(false);
      expect(await count("flight_field_events", "plan_id = $1 and kind = 'journal_linked'", [pl.id])).toBe(1);
    });

    it("X-1：着陸より後に実施した飛行前点検は、その飛行の日誌の既定に入らない（次のラウンドには数える）。結び付けて保存すると知らせる。離陸より前の点検は従来どおり引き継ぐ", async () => {
      const t = (hm: string) => ({ occurredAt: `2027-01-05T${hm}`, queued: true });
      // 飛行（08:00〜08:10）の後、08:30 に日誌の画面から飛行前点検を入れた（計画に結び付く）
      const late = await newPlan(A, { plannedStartAt: "2027-01-05T08:00" });
      const tk = await post(A, late.id, body("takeoff", t("08:00")));
      await post(A, late.id, body("landing", t("08:10")));
      const lateInsp = await inspect(A, "2027-01-05T08:30", { planId: late.id });
      const v = await field.getFieldView(mgr(A), late.id);
      expect(v.flights[0]!.preInspectionId).toBeNull();
      // 次のラウンドの飛行前点検としては済（Sprint 14 のラウンドの導出）
      expect(v.items.find((i) => i.item === "inspection")!.inspectionId).toBe(lateInsp.record.id);
      // 日誌の既定（/ops/flights/new?planId&takeoffEventId と同じ組み立て）には入らない
      const flight = v.flights.find((x) => x.takeoffEventId === tk.event.id);
      expect(journalPreInspectionId(flight, v.items.find((i) => i.item === "inspection")!.inspectionId)).toBeNull();
      // 利用者がその点検を選んで保存すると、保存は止めずに知らせる
      const f = await rec.createFlight(mgr(A), {
        aircraftId: A.aircraft,
        pilotId: A.pilotFree.id,
        takeoffAt: "2027-01-05T08:00",
        landingAt: "2027-01-05T08:10",
        safetyIssue: false,
        takeoffEventId: tk.event.id,
        flightPlanId: late.id,
        dailyInspectionId: lateInsp.record.id,
        fillFromPlan: true,
      });
      expect(f.created).toBe(true);
      expect(f.warnings).toContain("pre_inspection_after_takeoff");

      // 12c の引き継ぎ：離陸より前（06:50）の点検は、その飛行の点検として日誌に入り、知らせは出ない
      const early = await newPlan(A, { plannedStartAt: "2027-01-05T07:00" });
      const earlyInsp = await inspect(A, "2027-01-05T06:50", { planId: early.id });
      const tk2 = await post(A, early.id, body("takeoff", t("07:00")));
      await post(A, early.id, body("landing", t("07:10")));
      const v2 = await field.getFieldView(mgr(A), early.id);
      const flight2 = v2.flights.find((x) => x.takeoffEventId === tk2.event.id);
      expect(journalPreInspectionId(flight2, v2.items.find((i) => i.item === "inspection")!.inspectionId)).toBe(earlyInsp.record.id);
      const f2 = await rec.createFlight(mgr(A), {
        aircraftId: A.aircraft,
        pilotId: A.pilotFree.id,
        takeoffAt: "2027-01-05T07:00",
        landingAt: "2027-01-05T07:10",
        safetyIssue: false,
        takeoffEventId: tk2.event.id,
        flightPlanId: early.id,
        dailyInspectionId: earlyInsp.record.id,
        fillFromPlan: true,
      });
      expect(f2.created).toBe(true);
      expect(f2.warnings).not.toContain("pre_inspection_after_takeoff");
    });

    it("X-4：離陸と着陸の間に実施した点検は、その飛行の飛行前点検にならない（飛行中のラウンドの「済」にも、日誌の既定にも入らない）", async () => {
      const t = (hm: string) => ({ occurredAt: `2027-01-05T${hm}`, queued: true });
      const p = await newPlan(A, { plannedStartAt: "2027-01-05T05:00" });
      const tk = await post(A, p.id, body("takeoff", t("05:00")));
      const mid = await inspect(A, "2027-01-05T05:05", { planId: p.id });
      const inFlight = await field.getFieldView(mgr(A), p.id);
      expect(inFlight.items.find((i) => i.item === "inspection")!.done).toBe(false);
      expect(inFlight.flights[0]!.preInspectionId).toBeNull();
      await post(A, p.id, body("landing", t("05:10")));
      const v = await field.getFieldView(mgr(A), p.id);
      const flight = v.flights.find((x) => x.takeoffEventId === tk.event.id);
      expect(flight!.preInspectionId).toBeNull();
      expect(journalPreInspectionId(flight, v.items.find((i) => i.item === "inspection")!.inspectionId)).toBeNull();
      // 結び付けて保存すると知らせる
      const f = await rec.createFlight(mgr(A), {
        aircraftId: A.aircraft,
        pilotId: A.pilotFree.id,
        takeoffAt: "2027-01-05T05:00",
        landingAt: "2027-01-05T05:10",
        safetyIssue: false,
        takeoffEventId: tk.event.id,
        flightPlanId: p.id,
        dailyInspectionId: mid.record.id,
        fillFromPlan: true,
      });
      expect(f.warnings).toContain("pre_inspection_after_takeoff");
    });
  });

  describe("9. Sprint 15 B-1・B-2：先読みの束", () => {
    it("一覧は今日・明日の、利用者が操縦者の計画だけ。他の人の計画・中止した計画・他の組織の計画は入らない", async () => {
      const mine = await newPlan(A, { pilotId: A.pilotLinked.id, plannedStartAt: "2027-01-06T09:00" });
      const others = await newPlan(A);
      const later = await newPlan(A, { pilotId: A.pilotLinked.id, plannedStartAt: "2027-01-08T09:00" });
      const pilotCtx = ctxOf(A.pilotMember);
      const r = await field.getFieldBundles(pilotCtx, null);
      const ids = r.bundles.map((b) => b.planId);
      expect(ids).toContain(mine.id);
      expect(ids).not.toContain(others.id);
      expect(ids).not.toContain(later.id);
      expect(r.bundles.every((b) => b.memberId === A.pilotMember.id)).toBe(true);
      // 技能証明書の番号・座標・自由記述（目的）を含まない
      const text = JSON.stringify(r);
      const lic = (await owner.query("select license_number from pilots where id = $1", [A.pilotLinked.id])).rows[0]?.license_number as string | null;
      if (lic) expect(text).not.toContain(lic);
      expect(text).not.toContain(String(HQ.latitude));
      expect(text).not.toContain("空撮");
    });

    it("計画を指定した束：運航管理者と計画の操縦者本人だけ（他の操縦者・閲覧者は 403）。他の組織の計画は 404", async () => {
      const p = await newPlan(A, { pilotId: A.pilotLinked.id });
      expect((await field.getFieldBundles(mgr(A), p.id)).bundles.map((b) => b.planId)).toEqual([p.id]);
      expect((await field.getFieldBundles(ctxOf(A.pilotMember), p.id)).bundles).toHaveLength(1);
      await expectOpsError(field.getFieldBundles(ctxOf(A.pilotMember2), p.id), 403);
      await expectOpsError(field.getFieldBundles(ctxOf(A.viewer), p.id), 403);
      const pB = await newPlan(B);
      await expectOpsError(field.getFieldBundles(mgr(A), pB.id), 404);
    });

    it("B-5：束から組み立てた画面は、サーバーの画面と書類・手続きの判定・未了の予告が同じ", async () => {
      const p = await approvedPlan(A);
      await post(A, p.id, checkBody("docs_confirm", { docKey: "remote_id", occurredAt: "2027-01-05T11:00", queued: true }));
      const view = await field.getFieldView(mgr(A), p.id);
      const b = (await field.getFieldBundles(mgr(A), p.id)).bundles[0]!;
      const { composeFieldView } = await import("./field-compose");
      const v2 = composeFieldView(JSON.parse(JSON.stringify(b)), { now: new Date("2027-01-05T12:00:00+09:00") });
      expect(v2.docs).toEqual(view.docs);
      expect(v2.takeoffPreview).toEqual(view.takeoffPreview);
      expect(v2.items).toEqual(view.items);
    });
  });
});
