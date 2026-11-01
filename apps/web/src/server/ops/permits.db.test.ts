// Sprint 12d 契約 1〜3・7〜9・15（DB）の DB テスト（pnpm test:db）。
// 使い捨てのデータベースにマイグレーションを適用し、アプリ用ロール soraban_app に切り替えた接続でサービス層を動かす。
// 判定は本物の runDiagnosis（同梱の規制データ・市町村コード固定）。DIPS・外部には接続しない。
import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { MemberRow, PilotRow } from "@soraban/db";
import { createTempDatabase, runCli, withClient, type TempDatabase } from "../../../../../packages/db/src/test-db-helpers";
import { resolveTestDatabaseUrl } from "../../../../../packages/db/src/test-db-env";
import { runRegulationCheckWith } from "../check-core";
import { runDiagnosis } from "../diagnose-core";
import { baselineProvider } from "../sprint11e-baseline";
import type { Judge } from "./judge";
import { canonicalJson, toDiagnosisRunInput } from "./plan-logic";
import * as permits from "./permits";
import * as plans from "./plans";
import * as procs from "./procedure-records";
import * as svc from "./service";
import { OpsError, type OpsContext } from "./service";
import type { OpsDb } from "./store";

const ADMIN_URL = resolveTestDatabaseUrl();
/** サーバーの現在時刻（JST 2027-01-05 12:00）。 */
const NOW = new Date("2027-01-05T03:00:00Z");

const judge: Judge = (input, now) =>
  runDiagnosis(
    toDiagnosisRunInput(input),
    (loc, ctx, n) => runRegulationCheckWith({ ...baselineProvider("31202"), reverseGeocode: async () => ({ muniCode: "31202" }) }, loc, ctx, n),
    now,
  );

const HQ = { latitude: 35.434238, longitude: 133.380508 };

describe.skipIf(!ADMIN_URL)("許可・承認の登録・計画への適用・スナップショットの根拠の DB（Sprint 12d）", () => {
  let db: TempDatabase;
  let createdRole = false;
  let owner: pg.Pool;
  let app: pg.Pool;
  let orgA: string;
  let orgB: string;
  let manager: MemberRow;
  let managerB: MemberRow;
  let pilotMember: MemberRow;
  let viewer: MemberRow;
  let pilotA: PilotRow;
  let pilotB: PilotRow;
  let pilotOrgB: PilotRow;
  let aircraftW: string;
  let aircraftW2: string;
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
  const verifyChain = async (type: string, id: string) =>
    (await owner.query("select * from verify_record_chain($1, $2)", [type, id])).rows as { version_no: number; problem: string }[];
  const versionHash = async (id: string, no: number): Promise<string> =>
    (await owner.query("select content_hash from record_versions where entity_type = 'permit_registration' and entity_id = $1 and version_no = $2", [id, no])).rows[0].content_hash;
  const snapshotRows = async (planId: string) =>
    (await owner.query("select * from judgement_snapshots where plan_id = $1 order by seq", [planId])).rows;

  let pseq = 0;
  const permitBody = (over: Record<string, unknown> = {}) => ({
    permitNumber: `TP-${++pseq}`,
    coverage: "blanket",
    kinds: ["did", "night"],
    issuedOn: "2026-09-25",
    validFrom: "2026-10-01",
    validTo: "2027-09-30",
    placeScope: { type: "nationwide" },
    aircraftScope: { type: "any" },
    pilotScope: { type: "any" },
    ...over,
  });
  const newPermit = async (over: Record<string, unknown> = {}, ctx: OpsContext = mgr()) => (await permits.createPermit(ctx, permitBody(over))).record;

  const planBody = (extra: Record<string, unknown> = {}) => ({
    title: `計画 ${++seq}`,
    aircraftId: aircraftW,
    pilotId: pilotB.id,
    plannedStartAt: "2027-01-14T09:00",
    durationMinutes: 60,
    purpose: "空撮",
    placeName: "フューチャーテック株式会社 本社",
    ...HQ,
    radiusM: 100,
    ...extra,
  });
  const newPlan = async (extra: Record<string, unknown> = {}, ctx: OpsContext = mgr()) => (await plans.createPlan(ctx, planBody(extra))).record;
  const snapshotInput = async (planId: string, seqNo?: number): Promise<Record<string, unknown> & { permitBasis?: Record<string, unknown>[] }> => {
    const rows = await snapshotRows(planId);
    return (seqNo ? rows.find((r) => r.seq === seqNo) : rows[rows.length - 1])!.input;
  };
  const NIGHT = { flags: ["method_night"] };

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
    app = new pg.Pool({ connectionString: db.url, max: 4, options: "-c role=soraban_app" });
    orgA = (await owner.query("insert into organizations (name) values ('組織A') returning id")).rows[0].id;
    orgB = (await owner.query("insert into organizations (name) values ('組織B') returning id")).rows[0].id;
    manager = await addMember(orgA, "manager", "s12d-mgr");
    pilotMember = await addMember(orgA, "pilot", "s12d-pilot");
    viewer = await addMember(orgA, "viewer", "s12d-viewer");
    managerB = await addMember(orgB, "manager", "s12d-mgr-b");
    pilotA = await addPilot(orgA, "操縦 一郎", pilotMember.id);
    pilotB = await addPilot(orgA, "操縦 二郎", null);
    pilotOrgB = await addPilot(orgB, "組織B 操縦者", null);
    const mk = async (weight: number, ctx: OpsContext) =>
      (
        await svc.createAircraft(ctx, {
          registrationMark: `JU12D${(seq++).toString().padStart(4, "0")}`,
          modelName: "Matrice 350 RTK",
          manufacturer: "DJI",
          serialNumber: `SN-${seq}`,
          typeCertified: false,
          initialFlightMinutes: 0,
          maxTakeoffWeightKg: weight,
        })
      ).id;
    aircraftW = await mk(0.9, mgr());
    aircraftW2 = await mk(2.5, mgr());
    aircraftOrgB = await mk(0.9, ctxOf(managerB));
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
  describe("契約 1：許可・承認の登録（追記専用）", () => {
    it("record_versions の entity_type に permit_registration がある。作成・訂正・失効・取消がすべて版として追記され、連鎖の検証が通る", async () => {
      const p = await newPermit();
      expect(p.version).toBe(1);
      expect(await verifyChain("permit_registration", p.id)).toEqual([]);
      const u = await permits.updatePermit(mgr(), p.id, { expectedVersion: 1, reason: "訂正", maxAltitudeM: 100 });
      expect(u.version).toBe(2);
      const r = await permits.revokePermit(mgr(), p.id, { expectedVersion: 2, reason: "失効の通知", revokedOn: "2027-02-01" });
      expect(r).toMatchObject({ version: 3, status: "revoked", revokedOn: "2027-02-01" });
      const v = await permits.voidPermit(mgr(), p.id, { expectedVersion: 3, reason: "誤登録" });
      expect(v).toMatchObject({ version: 4, voided: true });
      const ops = (await owner.query("select op from record_versions where entity_type = 'permit_registration' and entity_id = $1 order by version_no", [p.id])).rows.map((x) => x.op);
      expect(ops).toEqual(["create", "update", "update", "void"]);
      expect(await verifyChain("permit_registration", p.id)).toEqual([]);
    });

    it("soraban_app はヘッド表を参照だけできる（INSERT・UPDATE・DELETE・TRUNCATE は 42501）。record_versions への追加で作れる", async () => {
      const p = await newPermit();
      const c = await app.connect();
      try {
        expect(Number((await c.query("select count(*)::int as n from permit_registrations")).rows[0].n)).toBeGreaterThan(0);
        await expect(c.query("update permit_registrations set org_id = org_id"), "UPDATE").rejects.toMatchObject({ code: "42501" });
        await expect(c.query("delete from permit_registrations"), "DELETE").rejects.toMatchObject({ code: "42501" });
        await expect(c.query("truncate permit_registrations"), "TRUNCATE").rejects.toMatchObject({ code: "42501" });
        await expect(
          c.query(
            `insert into permit_registrations (id, org_id, permit_number, permit_number_key, coverage, kinds, issued_on, valid_from, valid_to, status, place_scope, aircraft_scope, pilot_scope, current_version, created_at, updated_at)
             values ($1, $2, 'X', 'X', 'blanket', '["did"]', '2026-10-01', '2026-10-01', '2027-10-01', 'active', '{"type":"nationwide"}', '{"type":"any"}', '{"type":"any"}', 1, now(), now())`,
            [randomUUID(), orgA],
          ),
          "INSERT",
        ).rejects.toMatchObject({ code: "42501" });
      } finally {
        c.release();
      }
      for (const priv of ["INSERT", "UPDATE", "DELETE", "TRUNCATE"]) {
        const has = (await owner.query("select has_table_privilege('soraban_app', 'permit_registrations', $1) as h", [priv])).rows[0].h;
        expect(has, priv).toBe(false);
      }
      expect((await owner.query("select has_table_privilege('soraban_app', 'permit_registrations', 'SELECT') as h")).rows[0].h).toBe(true);
      expect(p.id).toBeTruthy();
    });

    it("ヘッド表の CHECK：期間の大小・失効日・airport は個別のみ・空港名 1 件以上・個別は全国を持てない・種類の値", async () => {
      const head = (over: Record<string, unknown>) => {
        const row: Record<string, unknown> = {
          id: randomUUID(),
          org_id: orgA,
          permit_number: "X",
          permit_number_key: `HEAD${++pseq}`,
          coverage: "blanket",
          kinds: JSON.stringify(["did"]),
          airport_names: "[]",
          issued_on: "2026-10-01",
          valid_from: "2026-10-01",
          valid_to: "2027-10-01",
          status: "active",
          revoked_on: null,
          place_scope: JSON.stringify({ type: "nationwide" }),
          aircraft_scope: JSON.stringify({ type: "any" }),
          pilot_scope: JSON.stringify({ type: "any" }),
          current_version: 1,
          created_at: new Date(),
          updated_at: new Date(),
          ...over,
        };
        const cols = Object.keys(row);
        return owner.query(`insert into permit_registrations (${cols.join(",")}) values (${cols.map((_, i) => `$${i + 1}`).join(",")})`, cols.map((c) => row[c]));
      };
      await expect(head({}), "正常").resolves.toBeTruthy();
      const circles = JSON.stringify({ type: "circles", circles: [{ lat: 35, lng: 133, radiusM: 100 }] });
      const bad = async (over: Record<string, unknown>, constraint: string) =>
        expect(head(over), constraint).rejects.toMatchObject({ code: "23514", constraint });
      await bad({ valid_from: "2027-10-02", valid_to: "2027-10-01" }, "permit_registrations_period_check");
      await bad({ status: "revoked", revoked_on: null }, "permit_registrations_revoked_check");
      await bad({ status: "active", revoked_on: "2027-01-01" }, "permit_registrations_revoked_check");
      await bad({ coverage: "blanket", kinds: JSON.stringify(["airport"]), airport_names: JSON.stringify(["A"]), place_scope: circles }, "permit_registrations_airport_check");
      await bad({ coverage: "individual", kinds: JSON.stringify(["airport"]), airport_names: "[]", place_scope: circles }, "permit_registrations_airport_check");
      await bad({ coverage: "individual", kinds: JSON.stringify(["airport"]), airport_names: JSON.stringify(["A"]) }, "permit_registrations_airport_check");
      await bad({ coverage: "individual" }, "permit_registrations_individual_place_check");
      await expect(head({ coverage: "individual", kinds: JSON.stringify(["airport"]), airport_names: JSON.stringify(["A"]), place_scope: circles }), "個別の空港等周辺は可").resolves.toBeTruthy();
      await expect(head({ kinds: JSON.stringify(["unknown"]) })).rejects.toMatchObject({ code: "23514" });
      await expect(head({ kinds: JSON.stringify([]) })).rejects.toMatchObject({ code: "23514" });
      await expect(head({ place_scope: JSON.stringify({ type: "circles", circles: [] }) })).rejects.toMatchObject({ code: "23514" });
      await expect(head({ aircraft_scope: JSON.stringify({ type: "listed", ids: [] }) })).rejects.toMatchObject({ code: "23514" });
      await expect(head({ pilot_scope: JSON.stringify({ type: "listed" }) })).rejects.toMatchObject({ code: "23514" });
      await expect(head({ source: "other" })).rejects.toMatchObject({ code: "23514" });
      await expect(head({ max_altitude_m: 2001 })).rejects.toMatchObject({ code: "23514" });
      await expect(head({ max_weight_kg: 1000 }), "numeric(5,2) の範囲外").rejects.toMatchObject({ code: "22003" });
      await expect(head({ conditions_text: "x".repeat(1001) })).rejects.toMatchObject({ code: "23514" });
    });

    it("listed の機体・操縦者は同じ組織のものに限る（別の組織の ID は SB404。サービス層は 400 unknown_id）", async () => {
      const raw = (scope: { aircraft?: object; pilot?: object }) =>
        app.query(
          `insert into record_versions (org_id, entity_type, entity_id, op, data, actor_kind) values ($1, 'permit_registration', $2, 'create', $3::jsonb, 'system')`,
          [
            orgA,
            randomUUID(),
            JSON.stringify({
              permit_number: `RAW${++pseq}`,
              permit_number_key: `RAW${pseq}`,
              coverage: "blanket",
              kinds: ["did"],
              airport_names: [],
              issued_on: "2026-10-01",
              valid_from: "2026-10-01",
              valid_to: "2027-10-01",
              status: "active",
              revoked_on: null,
              place_scope: { type: "nationwide" },
              aircraft_scope: scope.aircraft ?? { type: "any" },
              pilot_scope: scope.pilot ?? { type: "any" },
              source: "manual",
              external_ref: {},
            }),
          ],
        );
      await expect(raw({ aircraft: { type: "listed", ids: [aircraftOrgB] } })).rejects.toMatchObject({ code: "SB404" });
      await expect(raw({ pilot: { type: "listed", ids: [pilotOrgB.id] } })).rejects.toMatchObject({ code: "SB404" });
      await expect(raw({ aircraft: { type: "listed", ids: [aircraftW, aircraftOrgB] } })).rejects.toMatchObject({ code: "SB404" });
      await expect(raw({ aircraft: { type: "listed", ids: [aircraftW] }, pilot: { type: "listed", ids: [pilotA.id] } })).resolves.toBeTruthy();
      const e = await expectOpsError(permits.createPermit(mgr(), permitBody({ aircraftScope: { type: "listed", ids: [aircraftOrgB] } })), 400, "invalid_input");
      expect(e.fieldCodes).toMatchObject({ aircraftScope: "unknown_id" });
      await expectOpsError(permits.createPermit(mgr(), permitBody({ pilotScope: { type: "listed", ids: [pilotOrgB.id] } })), 400, "invalid_input");
    });

    it("番号の一意（正規化後。取消していない行の中）。取消した番号は再登録できる。失効した番号は使われたまま", async () => {
      const a = await newPermit({ permitNumber: "dup ｘ-1" });
      await expectOpsError(permits.createPermit(mgr(), permitBody({ permitNumber: "DUPX-1" })), 409, "duplicate_number");
      // SB409 duplicate_number（DB の追加前のトリガー）
      await expect(
        app.query(
          `insert into record_versions (org_id, entity_type, entity_id, op, data, actor_kind) values ($1, 'permit_registration', $2, 'create', $3::jsonb, 'system')`,
          [orgA, randomUUID(), JSON.stringify({ permit_number: "x", permit_number_key: "DUPX-1", coverage: "blanket", kinds: ["did"], airport_names: [], issued_on: "2026-10-01", valid_from: "2026-10-01", valid_to: "2027-10-01", status: "active", revoked_on: null, place_scope: { type: "nationwide" }, aircraft_scope: { type: "any" }, pilot_scope: { type: "any" } })],
        ),
      ).rejects.toMatchObject({ code: "SB409", detail: "duplicate_number" });
      // 訂正で他の登録の番号にすることもできない
      const b = await newPermit();
      await expectOpsError(permits.updatePermit(mgr(), b.id, { expectedVersion: 1, reason: "訂正", permitNumber: "Dup X-1" }), 409, "duplicate_number");
      // 他の組織の同じ番号は別
      await expect(permits.createPermit(ctxOf(managerB), permitBody({ permitNumber: "DUPX-1" }))).resolves.toMatchObject({ created: true });
      // 失効しても番号は使われたまま
      await permits.revokePermit(mgr(), a.id, { expectedVersion: 1, reason: "失効", revokedOn: "2027-02-01" });
      await expectOpsError(permits.createPermit(mgr(), permitBody({ permitNumber: "dupx-1" })), 409, "duplicate_number");
      // 取消したら再登録できる
      await permits.voidPermit(mgr(), a.id, { expectedVersion: 2, reason: "誤登録" });
      await expect(permits.createPermit(mgr(), permitBody({ permitNumber: "dupx-1" }))).resolves.toMatchObject({ created: true });
    });

    it("verify_record_chain が permit_registration を検査し、版の改変・ヘッド表だけの書き換えを検出する", async () => {
      const p = await newPermit();
      await permits.updatePermit(mgr(), p.id, { expectedVersion: 1, reason: "訂正", maxAltitudeM: 50 });
      const clean = await newPermit();
      expect(await verifyChain("permit_registration", p.id)).toEqual([]);
      expect(await verifyChain("permit_registration", clean.id)).toEqual([]);
      // 日付・数値・jsonb を含むヘッド表が版の data と一致している（取消を含む）
      const rich = await newPermit({ maxWeightKg: 25.5, maxAltitudeM: 150, placeScope: { type: "circles", circles: [{ lat: 35.434238, lng: 133.380508, radiusM: 500, name: "本社" }] }, aircraftScope: { type: "listed", ids: [aircraftW] }, conditionsText: "x" });
      expect(await verifyChain("permit_registration", rich.id)).toEqual([]);
      await owner.query(`update record_versions set data = data || '{"max_altitude_m": 999}'::jsonb where entity_type = 'permit_registration' and entity_id = $1 and version_no = 2`, [p.id]);
      // 版の改変はハッシュの不一致として検出される（ヘッド表は改変前の値のままなので、ヘッド表との不一致も出る）
      expect(await verifyChain("permit_registration", p.id)).toEqual(expect.arrayContaining([{ version_no: 2, problem: "content_hash_mismatch" }]));
      expect(await verifyChain("permit_registration", clean.id)).toEqual([]);
      await owner.query("update permit_registrations set valid_to = '2030-01-01' where id = $1", [clean.id]);
      expect(await verifyChain("permit_registration", clean.id)).toEqual([{ version_no: 1, problem: "head_data_mismatch" }]);
    });

    it("失効の版は元の内容を変えない（SB409 revoke_changes_content）。失効した登録は訂正・再度の失効ができない（SB409 revoked）。新規は有効のみ", async () => {
      const p = await newPermit();
      const base = (await owner.query("select data from record_versions where entity_type = 'permit_registration' and entity_id = $1 and version_no = 1", [p.id])).rows[0].data;
      await expect(
        app.query(`insert into record_versions (org_id, entity_type, entity_id, op, data, reason, actor_kind) values ($1, 'permit_registration', $2, 'update', $3::jsonb, '失効', 'system')`, [orgA, p.id, JSON.stringify({ ...base, status: "revoked", revoked_on: "2027-02-01", max_altitude_m: 10 })]),
      ).rejects.toMatchObject({ code: "SB409", detail: "revoke_changes_content" });
      await expect(
        app.query(`insert into record_versions (org_id, entity_type, entity_id, op, data, actor_kind) values ($1, 'permit_registration', $2, 'create', $3::jsonb, 'system')`, [orgA, randomUUID(), JSON.stringify({ ...base, permit_number_key: `NEWREV${++pseq}`, status: "revoked", revoked_on: "2027-02-01" })]),
      ).rejects.toMatchObject({ code: "23514", detail: "invalid_status" });
      await permits.revokePermit(mgr(), p.id, { expectedVersion: 1, reason: "失効", revokedOn: "2027-02-01" });
      await expectOpsError(permits.revokePermit(mgr(), p.id, { expectedVersion: 2, reason: "二重", revokedOn: "2027-02-02" }), 409, "revoked");
      await expectOpsError(permits.updatePermit(mgr(), p.id, { expectedVersion: 2, reason: "訂正", maxAltitudeM: 1 }), 409, "revoked");
      await expect(
        app.query(`insert into record_versions (org_id, entity_type, entity_id, op, data, reason, actor_kind) values ($1, 'permit_registration', $2, 'update', $3::jsonb, '訂正', 'system')`, [orgA, p.id, JSON.stringify({ ...base, status: "revoked", revoked_on: "2027-02-01", max_altitude_m: 5 })]),
      ).rejects.toMatchObject({ code: "SB409", detail: "revoked" });
    });
  });

  // ================================================================
  // 契約 3：操作（作成・訂正・失効・取消・版・認可）
  // ================================================================
  describe("契約 3：登録の操作", () => {
    it("作成は 201 相当。同じ clientRequestId の再送は新しい登録を作らず、既存を返す", async () => {
      const cid = randomUUID();
      const a = await permits.createPermit(mgr(), { ...permitBody(), clientRequestId: cid });
      const b = await permits.createPermit(mgr(), { ...permitBody({ permitNumber: "別の番号" }), clientRequestId: cid });
      expect(a.created).toBe(true);
      expect(b.created).toBe(false);
      expect(b.record.id).toBe(a.record.id);
      expect(b.record.permitNumber).toBe(a.record.permitNumber);
      await expectOpsError(permits.createPermit(mgr(), { ...permitBody(), clientRequestId: "bad" }), 400, "invalid_input");
    });

    it("訂正は reason と expectedVersion が必須。版が違えば 409 version_conflict。訂正前の値が履歴に残る。物理削除はない", async () => {
      const p = await newPermit({ maxAltitudeM: 100 });
      await expectOpsError(permits.updatePermit(mgr(), p.id, { expectedVersion: 1, maxAltitudeM: 50 }), 400, "invalid_input");
      await expectOpsError(permits.updatePermit(mgr(), p.id, { reason: "訂正", maxAltitudeM: 50 }), 400, "invalid_input");
      await expectOpsError(permits.updatePermit(mgr(), p.id, { expectedVersion: 9, reason: "訂正", maxAltitudeM: 50 }), 409, "version_conflict");
      const u = await permits.updatePermit(mgr(), p.id, { expectedVersion: 1, reason: "高度の誤り", maxAltitudeM: 50 });
      expect(u).toMatchObject({ version: 2, maxAltitudeM: 50 });
      expect(u.affectsPlans).toMatchObject({ changed: true });
      // 入力の誤りは 400（登録の検査）
      const e = await expectOpsError(permits.updatePermit(mgr(), p.id, { expectedVersion: 2, reason: "x", validTo: "2020-01-01" }), 400, "invalid_input");
      expect(e.fieldCodes).toMatchObject({ validTo: "period_order" });
      const versions = await permits.listPermitVersions(mgr(), p.id);
      expect(versions.map((v) => v.versionNo)).toEqual([1, 2]);
      expect(versions[0]!.content.maxAltitudeM).toBe(100);
      expect(versions[1]!.content.maxAltitudeM).toBe(50);
      expect(versions[1]).toMatchObject({ reason: "高度の誤り", changedFields: ["最大高度の条件"], prevHash: versions[0]!.contentHash });
      expect(versions[0]!.contentHash).toBe(await versionHash(p.id, 1));
      expect((await permits.getPermit(mgr(), p.id)).versionHash).toBe(versions[1]!.contentHash);
      expect(await owner.query("select count(*)::int as n from record_versions where entity_type = 'permit_registration' and entity_id = $1", [p.id])).toMatchObject({ rows: [{ n: 2 }] });
    });

    it("失効は revokedOn と reason が必須。取消は reason が必須。取消した登録・失効した登録の訂正と、取消の登録の失効・二重の取消は拒否される", async () => {
      const p = await newPermit();
      await expectOpsError(permits.revokePermit(mgr(), p.id, { expectedVersion: 1, reason: "失効" }), 400, "invalid_input");
      await expectOpsError(permits.revokePermit(mgr(), p.id, { expectedVersion: 1, revokedOn: "2027-02-01" }), 400, "invalid_input");
      await expectOpsError(permits.revokePermit(mgr(), p.id, { expectedVersion: 1, reason: "失効", revokedOn: "2027/02/01" }), 400, "invalid_input");
      await expectOpsError(permits.voidPermit(mgr(), p.id, { expectedVersion: 1 }), 400, "invalid_body".length ? "invalid_input" : undefined);
      await permits.voidPermit(mgr(), p.id, { expectedVersion: 1, reason: "誤登録" });
      await expectOpsError(permits.updatePermit(mgr(), p.id, { expectedVersion: 2, reason: "訂正", maxAltitudeM: 1 }), 409, "voided");
      await expectOpsError(permits.revokePermit(mgr(), p.id, { expectedVersion: 2, reason: "失効", revokedOn: "2027-02-01" }), 409, "voided");
      await expectOpsError(permits.voidPermit(mgr(), p.id, { expectedVersion: 2, reason: "二重" }), 409, "voided");
      // 失効した登録の取消（誤登録）はできる
      const q = await newPermit();
      await permits.revokePermit(mgr(), q.id, { expectedVersion: 1, reason: "失効", revokedOn: "2027-02-01" });
      await expect(permits.voidPermit(mgr(), q.id, { expectedVersion: 2, reason: "誤登録" })).resolves.toMatchObject({ voided: true });
    });

    it("認可：書き込みは運航管理者だけ（操縦者・閲覧者は 403）。閲覧は全役割。他の組織の登録は 404", async () => {
      const p = await newPermit();
      for (const m of [pilotMember, viewer]) {
        const c = ctxOf(m);
        await expectOpsError(permits.createPermit(c, permitBody()), 403);
        await expectOpsError(permits.updatePermit(c, p.id, { expectedVersion: 1, reason: "x", maxAltitudeM: 1 }), 403);
        await expectOpsError(permits.revokePermit(c, p.id, { expectedVersion: 1, reason: "x", revokedOn: "2027-02-01" }), 403);
        await expectOpsError(permits.voidPermit(c, p.id, { expectedVersion: 1, reason: "x" }), 403);
        expect((await permits.listPermits(c)).map((x) => x.id)).toContain(p.id);
        expect((await permits.getPermit(c, p.id)).id).toBe(p.id);
        expect((await permits.listPermitVersions(c, p.id)).length).toBe(1);
      }
      const b = ctxOf(managerB);
      await expectOpsError(permits.getPermit(b, p.id), 404);
      await expectOpsError(permits.updatePermit(b, p.id, { expectedVersion: 1, reason: "x", maxAltitudeM: 1 }), 404);
      await expectOpsError(permits.revokePermit(b, p.id, { expectedVersion: 1, reason: "x", revokedOn: "2027-02-01" }), 404);
      await expectOpsError(permits.voidPermit(b, p.id, { expectedVersion: 1, reason: "x" }), 404);
      await expectOpsError(permits.listPermitVersions(b, p.id), 404);
      expect((await permits.listPermits(b)).map((x) => x.id)).not.toContain(p.id);
      await expectOpsError(permits.getPermit(mgr(), "not-a-uuid"), 404);
    });

    it("一覧：有効性は今日の日付で導出。validity・q で絞り込み。取消は既定で出さない", async () => {
      const mk = (over: Record<string, unknown>) => newPermit({ permitNumber: `LST-${++pseq}`, ...over });
      const valid = await mk({ validFrom: "2026-10-01", validTo: "2027-12-31" });
      const expiring = await mk({ validFrom: "2026-10-01", validTo: "2027-01-20" });
      const expired = await mk({ validFrom: "2026-01-01", validTo: "2026-12-31" });
      const upcoming = await mk({ validFrom: "2027-02-01", validTo: "2027-12-31" });
      const revoked = await mk({});
      await permits.revokePermit(mgr(), revoked.id, { expectedVersion: 1, reason: "失効", revokedOn: "2027-01-01" });
      const voided = await mk({});
      await permits.voidPermit(mgr(), voided.id, { expectedVersion: 1, reason: "誤登録" });
      const byId = new Map((await permits.listPermits(mgr(), { includeVoided: true })).map((x) => [x.id, x]));
      expect(byId.get(valid.id)).toMatchObject({ validity: "valid", validityLabel: "● 有効" });
      expect(byId.get(expiring.id)).toMatchObject({ validity: "expiring", validityLabel: "▲ 期限間近（30 日以内）" });
      expect(byId.get(expired.id)).toMatchObject({ validity: "expired", validityLabel: "× 期限切れ" });
      expect(byId.get(upcoming.id)).toMatchObject({ validity: "upcoming", validityLabel: "◇ 開始前" });
      expect(byId.get(revoked.id)).toMatchObject({ validity: "revoked", effectiveLastDate: "2026-12-31" });
      expect(byId.get(voided.id)).toMatchObject({ validity: "voided" });
      expect((await permits.listPermits(mgr())).map((x) => x.id)).not.toContain(voided.id);
      expect((await permits.listPermits(mgr(), { validity: "expired" })).map((x) => x.id)).toContain(expired.id);
      expect((await permits.listPermits(mgr(), { validity: "expired" })).every((x) => x.validity === "expired")).toBe(true);
      expect((await permits.listPermits(mgr(), { q: valid.permitNumber.toLowerCase() })).map((x) => x.id)).toEqual([valid.id]);
      expect((await permits.listPermits(mgr(), { validity: "voided" })).map((x) => x.id)).toContain(voided.id);
      expect(valid.declaration).toContain("許可書で確認してください");
      expect(valid.noDipsNote).toContain("DIPS に接続しません");
    });

    it("一覧の上限（500 件）を超える組織でも、有効性・番号の検索は上限の前の古い一致する登録に届く（ページを順に読んで絞る）", async () => {
      const org = (await owner.query("insert into organizations (name) values ('組織P') returning id")).rows[0].id;
      const m = await addMember(org, "manager", "s12d-mgr-p");
      const c = ctxOf(m);
      const data = {
        coverage: "blanket",
        kinds: ["did"],
        airport_names: [],
        issued_on: "2026-10-01",
        valid_from: "2026-10-01",
        status: "active",
        revoked_on: null,
        place_scope: { type: "nationwide" },
        aircraft_scope: { type: "any" },
        pilot_scope: { type: "any" },
        source: "manual",
        external_ref: {},
      };
      // 有効期間の終わりが最も早い（一覧の最後）期限切れの登録と、それより後ろまで 520 件の有効な登録を SQL で入れる
      await owner.query(
        `insert into record_versions (org_id, entity_type, entity_id, op, data, actor_kind)
         select $1, 'permit_registration', gen_random_uuid(), 'create',
                $2::jsonb || jsonb_build_object('permit_number', 'BULK-' || g, 'permit_number_key', 'BULK' || g, 'valid_to', '2027-12-31'), 'system'
           from generate_series(1, 520) g`,
        [org, JSON.stringify(data)],
      );
      await owner.query(
        `insert into record_versions (org_id, entity_type, entity_id, op, data, actor_kind) values ($1, 'permit_registration', gen_random_uuid(), 'create', $2::jsonb, 'system')`,
        [org, JSON.stringify({ ...data, permit_number: "OLDEST-1", permit_number_key: "OLDEST1", valid_from: "2025-01-01", valid_to: "2025-12-31" })],
      );
      expect(await permits.listPermits(c)).toHaveLength(500);
      expect((await permits.listPermits(c, { validity: "expired" })).map((x) => x.permitNumber)).toEqual(["OLDEST-1"]);
      expect((await permits.listPermits(c, { q: "oldest-1" })).map((x) => x.permitNumber)).toEqual(["OLDEST-1"]);
      expect((await permits.listPermits(c, { validity: "valid" })).length).toBe(500);
    });
  });

  // ================================================================
  // 契約 7・8：計画への適用と根拠の記録
  // ================================================================
  describe("契約 7・8：計画への適用（範囲に収まった DIPS の種類だけ）", () => {
    it("番号の欄の番号で登録に結びつき、範囲に収まると判定が手続き済み（条件付き）になる。根拠が input.permitBasis に残る", async () => {
      const none = await newPlan(NIGHT);
      expect(none.judgement.verdictLevel).toBe("needs_procedure");
      const p = await newPermit({ permitNumber: "R8-NIGHT-1", kinds: ["did", "night"] });
      const plan = await newPlan({ ...NIGHT, permitNumbers: " ｒ8-night-1 " });
      expect(plan.judgement.verdictLevel).toBe("procedure_done");
      const input = await snapshotInput(plan.id);
      expect(input["pilotPermits"]).toEqual(["mlit:did", "mlit:night"]);
      expect(input["permitBasis"]).toEqual([
        {
          registrationId: p.id,
          versionNo: 1,
          versionHash: await versionHash(p.id, 1),
          permitNumber: "R8-NIGHT-1",
          coverage: "blanket",
          kinds: ["did", "night"],
          applied: true,
          validFrom: "2026-10-01",
          validTo: "2027-09-30",
          window: { from: "2027-01-14", to: "2027-01-14" },
        },
      ]);
      expect(plan.permits.numbers[0]).toMatchObject({ status: "applied", versionNo: 1, registrationId: p.id });
      expect(plan.permits.appliedCount).toBe(1);
      expect(plan.freshness.stale).toBe(false);
      // 結果のエンジンの注記（範囲と有効期間は照合していません）は、スナップショットの結果のまま残る
      const result = (await snapshotRows(plan.id))[0]!.result as { verdict: { items: { id: string; verdict: string; reason: string }[] } };
      expect(result.verdict.items.find((i) => i.id === "method_night")!.verdict).toBe("procedure_done");
      expect(JSON.stringify(result)).toContain("許可の範囲と有効期間は照合していません");
    });

    it("範囲外・期限切れ・開始前・失効・取消・未登録・確認できないケースは要手続きのまま（理由が計画の DTO と照合の API に出る）。根拠のキーは持たない", async () => {
      const cases: { name: string; over: Record<string, unknown>; plan?: Record<string, unknown>; reasons: string[]; after?: (id: string) => Promise<void> }[] = [
        { name: "期限切れ", over: { validTo: "2027-01-13" }, reasons: ["expired"] },
        { name: "開始前", over: { validFrom: "2027-01-15" }, reasons: ["not_started"] },
        { name: "場所が範囲外", over: { placeScope: { type: "circles", circles: [{ lat: 43, lng: 141, radiusM: 1000 }] } }, reasons: ["place_out_of_scope"] },
        { name: "場所が文章のみ", over: { placeScope: { type: "text", text: "県内" } }, reasons: ["place_not_checkable"] },
        { name: "半径が未入力", over: { placeScope: { type: "circles", circles: [{ ...{ lat: HQ.latitude, lng: HQ.longitude }, radiusM: 5000 }] } }, plan: { radiusM: null }, reasons: ["place_extent_unknown"] },
        { name: "別の機体", over: { aircraftScope: { type: "listed", ids: [aircraftW2] } }, reasons: ["aircraft_out_of_scope"] },
        { name: "別の操縦者", over: { pilotScope: { type: "listed", ids: [pilotA.id] } }, reasons: ["pilot_out_of_scope"] },
        { name: "高度の条件を超える", over: { maxAltitudeM: 50 }, plan: { maxAltitudeM: 80 }, reasons: ["altitude_over_limit"] },
        { name: "重量の条件を超える", over: { maxWeightKg: 0.5 }, reasons: ["weight_over_limit"] },
        { name: "立入管理措置が条件で未選択", over: { requiresAccessControl: true }, reasons: ["access_control_required"] },
        { name: "失効（飛行日が失効日以降）", over: {}, reasons: ["revoked"], after: async (id) => void (await permits.revokePermit(mgr(), id, { expectedVersion: 1, reason: "失効", revokedOn: "2027-01-14" })) },
        { name: "取消", over: {}, reasons: ["voided"], after: async (id) => void (await permits.voidPermit(mgr(), id, { expectedVersion: 1, reason: "誤登録" })) },
      ];
      for (const c of cases) {
        const number = `NA-${++pseq}`;
        const p = await newPermit({ permitNumber: number, kinds: ["did", "night"], ...c.over });
        await c.after?.(p.id);
        const plan = await newPlan({ ...NIGHT, permitNumbers: number, ...c.plan });
        expect(plan.judgement.verdictLevel, c.name).toBe("needs_procedure");
        const input = await snapshotInput(plan.id);
        expect("permitBasis" in input, c.name).toBe(false);
        expect(input["pilotPermits"], c.name).toEqual([]);
        const n = plan.permits.numbers[0]!;
        expect(n.reasons.map((r) => r.code), c.name).toEqual(c.reasons);
        expect(n.reasons.every((r) => r.label.length > 0), c.name).toBe(true);
        const api = await permits.getPlanPermits(mgr(), plan.id);
        expect(api.permits.numbers[0]!.reasons.map((r) => r.code), c.name).toEqual(c.reasons);
        expect(api.judgementUpToDate, c.name).toBe(true);
      }
      // 未登録の番号
      const un = await newPlan({ ...NIGHT, permitNumbers: "NOT-REGISTERED" });
      expect(un.judgement.verdictLevel).toBe("needs_procedure");
      expect(un.permits.numbers[0]).toMatchObject({ status: "unregistered", registrationId: null });
      expect(un.permits.unregisteredCount).toBe(1);
    });

    it("空港等周辺の個別許可（airport）は参考の根拠に残るが、判定の入力に値を足さず、判定の段は変えない", async () => {
      const ap = await newPermit({
        permitNumber: "AP-1",
        coverage: "individual",
        kinds: ["airport"],
        airportNames: ["テスト空港"],
        placeScope: { type: "circles", circles: [{ lat: HQ.latitude, lng: HQ.longitude, radiusM: 3000 }] },
      });
      const base = await newPlan({ ...NIGHT });
      const plan = await newPlan({ ...NIGHT, permitNumbers: "AP-1" });
      expect(plan.permits.numbers[0]).toMatchObject({ status: "reference" });
      expect(plan.judgement.verdictLevel).toBe(base.judgement.verdictLevel);
      const input = await snapshotInput(plan.id);
      expect(input["pilotPermits"]).toEqual([]);
      expect(input["permitBasis"]).toEqual([expect.objectContaining({ registrationId: ap.id, applied: false, kinds: ["airport"] })]);
    });

    it("計画の pilotPermits に DIPS の値を渡すと 400 dips_permit_from_registry。同意・通報・公園・文化庁の手入力は従来どおり効く", async () => {
      for (const v of ["mlit:night", "mlit"]) {
        const e = await expectOpsError(plans.createPlan(mgr(), planBody({ pilotPermits: [v] })), 400, "invalid_input");
        expect(e.fieldCodes).toMatchObject({ pilotPermits: "dips_permit_from_registry" });
        expect(e.fieldErrors!["pilotPermits"]).toContain("登録から照合します");
      }
      const plan = await newPlan({ ...NIGHT });
      const e = await expectOpsError(plans.updatePlan(mgr(), plan.id, { expectedVersion: plan.version, reason: "x", pilotPermits: ["mlit:did"] }), 400, "invalid_input");
      expect(e.fieldCodes).toMatchObject({ pilotPermits: "dips_permit_from_registry" });
      const manual = await newPlan({ pilotPermits: ["park_manager", "facility_manager"] });
      expect((await snapshotInput(manual.id))["pilotPermits"]).toEqual(["facility_manager", "park_manager"]);
      // 手入力の値と登録の適用が合わさる
      const p = await newPermit({ permitNumber: "MIX-1" });
      const mixed = await newPlan({ pilotPermits: ["park_manager"], permitNumbers: "MIX-1" });
      expect((await snapshotInput(mixed.id))["pilotPermits"]).toEqual(["mlit:did", "park_manager"]);
      expect(p.id).toBeTruthy();
    });

    it("12c までの計画に残る DIPS の手入力値は、訂正で外れる（判定に使わない）", async () => {
      const plan = await newPlan({ ...NIGHT });
      // 12c までの計画を再現する：データに DIPS の手入力値がある版を、オーナーで追加（アプリは入力を拒む）
      const base = (await owner.query("select data from record_versions where entity_type = 'flight_plan' and entity_id = $1 order by version_no desc limit 1", [plan.id])).rows[0].data;
      await owner.query(
        `insert into record_versions (org_id, entity_type, entity_id, op, data, reason, actor_kind) values ($1, 'flight_plan', $2, 'update', $3::jsonb, '12c の入力を再現', 'system')`,
        [orgA, plan.id, JSON.stringify({ ...base, pilot_permits: ["mlit:night", "park_manager"] })],
      );
      const legacy = await plans.getPlan(mgr(), plan.id);
      expect(legacy.pilotPermits).toEqual(["mlit:night", "park_manager"]);
      // 判定の入力は DIPS の値を使わないため、「判定が古い」（permits_changed）
      expect(legacy.freshness.reasons.map((r) => r.code)).toEqual(["permits_changed"]);
      const fixed = (await plans.updatePlan(mgr(), plan.id, { expectedVersion: legacy.version, reason: "メモ", notes: "x" })).record;
      expect(fixed.pilotPermits).toEqual(["park_manager"]);
      expect(fixed.judgement.seq).toBeGreaterThan(legacy.judgement.seq);
      expect(fixed.judgement.verdictLevel).toBe("needs_procedure");
      expect(fixed.freshness.stale).toBe(false);
    });

    it("許可番号の集合・所要時間・操縦者の変更で照合の結果が変わるとき、新しいスナップショットができる（input_changed）。古いスナップショットは不変", async () => {
      const p = await newPermit({ permitNumber: "CHG-1", validFrom: "2027-01-01", validTo: "2027-01-14", pilotScope: { type: "listed", ids: [pilotB.id] } });
      const plan = await newPlan({ ...NIGHT, plannedStartAt: "2027-01-14T22:00", durationMinutes: 60 });
      expect(plan.judgement.seq).toBe(1);
      const before = (await snapshotRows(plan.id))[0]!;
      // 許可番号を入れる → 適用
      const a = (await plans.updatePlan(mgr(), plan.id, { expectedVersion: plan.version, reason: "番号", permitNumbers: "chg-1" })).record;
      expect(a.judgement.seq).toBe(2);
      expect(a.judgement.reason).toBe("input_changed");
      expect(a.judgement.verdictLevel).toBe("procedure_done");
      // 所要時間を延ばして日またぎ（最終日が許可期間の翌日）→ 適用しない
      const b = (await plans.updatePlan(mgr(), plan.id, { expectedVersion: a.version, reason: "延長", durationMinutes: 180 })).record;
      expect(b.judgement.seq).toBe(3);
      expect(b.judgement.verdictLevel).toBe("needs_procedure");
      expect(b.permits.numbers[0]!.reasons.map((r) => r.code)).toEqual(["expired"]);
      expect("permitBasis" in (await snapshotInput(plan.id, 3))).toBe(false);
      // 時間を戻し、操縦者を変える → 許可の範囲外
      const c = (await plans.updatePlan(mgr(), plan.id, { expectedVersion: b.version, reason: "戻す", durationMinutes: 60 })).record;
      expect(c.judgement.seq).toBe(4);
      const d = (await plans.updatePlan(mgr(), plan.id, { expectedVersion: c.version, reason: "操縦者", pilotId: pilotA.id })).record;
      expect(d.judgement.seq).toBe(5);
      expect(d.permits.numbers[0]!.reasons.map((r) => r.code)).toEqual(["pilot_out_of_scope"]);
      // 判定に関わらない訂正（メモ）と、照合の結果が変わらない番号の表記の変更では増えない
      const e = (await plans.updatePlan(mgr(), plan.id, { expectedVersion: d.version, reason: "メモ", notes: "メモ" })).record;
      expect(e.judgement.seq).toBe(5);
      const f = (await plans.updatePlan(mgr(), plan.id, { expectedVersion: e.version, reason: "表記", permitNumbers: "CHG-1 " })).record;
      expect(f.judgement.seq).toBe(5);
      // 古いスナップショットは不変
      const after = (await snapshotRows(plan.id))[0]!;
      expect(after.content_hash).toBe(before.content_hash);
      expect(canonicalJson(after.input)).toBe(canonicalJson(before.input));
      expect((await owner.query("select * from verify_judgement_snapshots($1)", [plan.id])).rows).toEqual([]);
      expect(p.id).toBeTruthy();
    });

    it("許可番号のない計画の判定の入力は、12c までと同じ（キー・値が増えない）", async () => {
      const plan = await newPlan({ flags: ["method_night"], pilotPermits: ["park_manager"], accessControl: true });
      const input = await snapshotInput(plan.id);
      expect(Object.keys(input).sort()).toEqual(["accessControl", "droneWeightG", "flags", "lat", "lng", "pilotPermits", "plannedDate"]);
      expect(input["pilotPermits"]).toEqual(["park_manager"]);
    });
  });

  // ================================================================
  // 契約 2：スナップショットの根拠の検査
  // ================================================================
  describe("契約 2：judgement_snapshots の permitBasis の検査", () => {
    /** 既存のスナップショットを複製して、input だけを替えた追加を試す（オーナーの接続。追加前のトリガーは全ての接続に効く）。 */
    const insertSnapshot = async (planId: string, input: unknown) =>
      owner.query(
        `insert into judgement_snapshots (id, org_id, plan_id, reason, input, result, verdict_level, verdict_unknown_count, category, engine_version, checked_at,
           check_evidence_id, diagnosis_evidence_id, datasets, procedures_revision, procedures_verified_at, created_by_member_id)
         select gen_random_uuid(), org_id, plan_id, 'manual', $2::jsonb, result, verdict_level, verdict_unknown_count, category, engine_version, checked_at,
                check_evidence_id, diagnosis_evidence_id, datasets, procedures_revision, procedures_verified_at, created_by_member_id
           from judgement_snapshots where plan_id = $1 order by seq desc limit 1`,
        [planId, JSON.stringify(input)],
      );

    it("存在しない版・他の組織の登録・ハッシュの違い・版番号の違いは SB409 permit_basis_invalid。実在の版は追加できる。permitBasis のない入力は従来どおり", async () => {
      const p = await newPermit({ permitNumber: "SNAP-1" });
      const plan = await newPlan({ ...NIGHT, permitNumbers: "SNAP-1" });
      const input = await snapshotInput(plan.id);
      const good = (input["permitBasis"] as Record<string, unknown>[])[0]!;
      const withBasis = (patch: Record<string, unknown>) => ({ ...input, permitBasis: [{ ...good, ...patch }] });
      const bad = async (patch: Record<string, unknown>, label: string) =>
        expect(insertSnapshot(plan.id, withBasis(patch)), label).rejects.toMatchObject({ code: "SB409", detail: "permit_basis_invalid" });
      await bad({ registrationId: randomUUID() }, "存在しない登録");
      await bad({ versionNo: 99 }, "存在しない版");
      await bad({ versionNo: 2 }, "存在しない版（次の版）");
      await bad({ versionHash: "0".repeat(64) }, "ハッシュの違い");
      await bad({ registrationId: "not-a-uuid" }, "ID の形が違う");
      // 他の組織の登録
      const other = (await permits.createPermit(ctxOf(managerB), permitBody({ permitNumber: "ORGB-1" }))).record;
      await bad({ registrationId: other.id, versionNo: 1, versionHash: await versionHash(other.id, 1) }, "他の組織の登録");
      await expect(insertSnapshot(plan.id, { ...input, permitBasis: "x" })).rejects.toMatchObject({ code: "SB409", detail: "permit_basis_invalid" });
      await expect(insertSnapshot(plan.id, { ...input, permitBasis: [1] })).rejects.toMatchObject({ code: "SB409", detail: "permit_basis_invalid" });
      await expect(insertSnapshot(plan.id, { ...input, permitBasis: [good, { ...good, versionHash: "1".repeat(64) }] })).rejects.toMatchObject({ detail: "permit_basis_invalid" });
      // 追加は拒まれ、スナップショットは増えていない
      expect((await snapshotRows(plan.id)).length).toBe(1);
      // 実在の版は追加できる。permitBasis のない入力も従来どおり追加できる
      await expect(insertSnapshot(plan.id, input)).resolves.toBeTruthy();
      const { permitBasis: _drop, ...legacy } = input;
      void _drop;
      await expect(insertSnapshot(plan.id, legacy)).resolves.toBeTruthy();
      expect((await snapshotRows(plan.id)).length).toBe(3);
      // 既存のスナップショットのハッシュと verify_judgement_snapshots の結果は変わらない（head_snapshot_not_latest だけがテストの複製による）
      const problems = (await owner.query("select * from verify_judgement_snapshots($1)", [plan.id])).rows.map((r) => r.problem);
      expect(problems).toEqual(["head_snapshot_not_latest"]);
      expect(p.id).toBeTruthy();
    });

    it("アプリ用ロールの経路（計画の保存）でも、根拠の登録が保存前に変わっていれば 409 permit_basis_invalid にならず、保存した瞬間の版が根拠になる", async () => {
      const p = await newPermit({ permitNumber: "SNAP-2" });
      const plan = await newPlan({ ...NIGHT, permitNumbers: "SNAP-2" });
      await permits.updatePermit(mgr(), p.id, { expectedVersion: 1, reason: "訂正", conditionsText: "条件" });
      // 古いスナップショットは当時の版 1 を指したまま。新しい保存は版 2 を根拠にする
      const re = await plans.rejudgePlan(mgr(), plan.id, {});
      const first = await snapshotInput(plan.id, 1);
      const second = await snapshotInput(plan.id, 2);
      expect(first.permitBasis![0]).toMatchObject({ versionNo: 1, versionHash: await versionHash(p.id, 1) });
      expect(second.permitBasis![0]).toMatchObject({ versionNo: 2, versionHash: await versionHash(p.id, 2) });
      expect(re.judgement.seq).toBe(2);
    });
  });

  // ================================================================
  // 契約 8：登録の訂正・失効後も、過去のスナップショットは不変で、当時の版から当時の内容を読める
  // ================================================================
  describe("契約 8・14：根拠の辿り", () => {
    it("登録をあとで訂正・失効しても、過去のスナップショットの permitBasis・結果・ハッシュは変わらず、当時の版から当時の内容を読める", async () => {
      const p = await newPermit({ permitNumber: "TRACE-1", conditionsText: "当時の条件", maxAltitudeM: 120 });
      const plan = await newPlan({ ...NIGHT, permitNumbers: "TRACE-1", maxAltitudeM: 100 });
      const snapBefore = (await snapshotRows(plan.id))[0]!;
      await permits.updatePermit(mgr(), p.id, { expectedVersion: 1, reason: "条件の訂正", conditionsText: "新しい条件", maxAltitudeM: 130 });
      await permits.revokePermit(mgr(), p.id, { expectedVersion: 2, reason: "失効", revokedOn: "2027-01-20" });
      const snapAfter = (await snapshotRows(plan.id))[0]!;
      expect(snapAfter.content_hash).toBe(snapBefore.content_hash);
      expect(canonicalJson(snapAfter.input)).toBe(canonicalJson(snapBefore.input));
      expect(canonicalJson(snapAfter.result)).toBe(canonicalJson(snapBefore.result));
      const detail = await plans.getSnapshot(mgr(), plan.id, snapBefore.id);
      expect(detail.permitBasis).toHaveLength(1);
      expect(detail.permitBasis[0]).toMatchObject({ registrationId: p.id, versionNo: 1, permitNumber: "TRACE-1", applied: true, versionExists: true, hashMatches: true });
      // 当時の版から当時の内容を読める
      const versions = await permits.listPermitVersions(mgr(), p.id);
      const then = versions.find((v) => v.versionNo === detail.permitBasis[0]!.versionNo)!;
      expect(then.contentHash).toBe(detail.permitBasis[0]!.versionHash);
      expect(then.content).toMatchObject({ conditionsText: "当時の条件", maxAltitudeM: 120, status: "active" });
      expect(versions.at(-1)!.content).toMatchObject({ conditionsText: "新しい条件", status: "revoked", revokedOn: "2027-01-20" });
      // 適用がないスナップショット（12c までを含む）は「根拠にした許可の登録はない」
      const none = await newPlan({});
      expect((await plans.getSnapshot(mgr(), none.id, none.judgement.id)).permitBasis).toEqual([]);
      // 登録の詳細：この登録を根拠にしている計画（現在のスナップショットから）
      const d = await permits.getPermit(mgr(), p.id);
      expect(d.basisPlans.map((x) => x.planId)).toContain(plan.id);
      expect(d.basisPlans.find((x) => x.planId === plan.id)).toMatchObject({ versionNo: 1, applied: true, isCurrentVersion: false });
      expect(d.basisPlanCount).toBe(d.basisPlans.length);
    });

    it("ハッシュが一致しない根拠は hashMatches: false（版が一致しません）になる", async () => {
      const p = await newPermit({ permitNumber: "TRACE-2" });
      const plan = await newPlan({ ...NIGHT, permitNumbers: "TRACE-2" });
      await owner.query(`update record_versions set content_hash = $2 where entity_type = 'permit_registration' and entity_id = $1 and version_no = 1`, [p.id, "f".repeat(64)]);
      const detail = await plans.getSnapshot(mgr(), plan.id, plan.judgement.id);
      expect(detail.permitBasis[0]).toMatchObject({ versionExists: true, hashMatches: false });
    });
  });

  // ================================================================
  // 契約 9：鮮度
  // ================================================================
  describe("契約 9：鮮度（permits_changed）", () => {
    it("登録の訂正・失効・取消で照合の結果が変わるときだけ「判定が古い」（permits_changed）。無関係な登録の変更では変わらない。再判定で新しい版が根拠になる", async () => {
      const p = await newPermit({ permitNumber: "FRESH-1" });
      const unrelated = await newPermit({ permitNumber: "FRESH-OTHER" });
      const plan = await newPlan({ ...NIGHT, permitNumbers: "FRESH-1" });
      expect(plan.freshness.stale).toBe(false);
      // 無関係な登録の訂正・失効・取消・新規
      await permits.updatePermit(mgr(), unrelated.id, { expectedVersion: 1, reason: "訂正", conditionsText: "x" });
      await permits.revokePermit(mgr(), unrelated.id, { expectedVersion: 2, reason: "失効", revokedOn: "2027-02-01" });
      await newPermit({ permitNumber: "FRESH-NEW" });
      expect((await plans.getPlan(mgr(), plan.id)).freshness.stale).toBe(false);
      // 結びついた登録の訂正 → permits_changed
      await permits.updatePermit(mgr(), p.id, { expectedVersion: 1, reason: "訂正", conditionsText: "条件" });
      const stale = await plans.getPlan(mgr(), plan.id);
      expect(stale.freshness).toEqual({ stale: true, reasons: [{ code: "permits_changed", label: "許可・承認の登録が、判定した時点から変わっています" }] });
      expect(stale.nextActions.map((a) => a.id)).toContain("rejudge");
      // 再判定 → 新しいスナップショットが新しい版（2）を根拠にして残り、古いスナップショットは版 1 を指したまま
      const re = await plans.rejudgePlan(mgr(), plan.id, {});
      expect(re.freshness.stale).toBe(false);
      expect(re.judgement.reason).toBe("manual");
      expect((await snapshotInput(plan.id, 2)).permitBasis![0]!.versionNo).toBe(2);
      expect((await snapshotInput(plan.id, 1)).permitBasis![0]!.versionNo).toBe(1);
      // 失効（飛行日以前）・取消 → 適用がなくなり古い
      await permits.revokePermit(mgr(), p.id, { expectedVersion: 2, reason: "失効", revokedOn: "2027-01-14" });
      expect((await plans.getPlan(mgr(), plan.id)).freshness.reasons.map((r) => r.code)).toEqual(["permits_changed"]);
      const re2 = await plans.rejudgePlan(mgr(), plan.id, {});
      expect(re2.judgement.verdictLevel).toBe("needs_procedure");
      expect("permitBasis" in (await snapshotInput(plan.id, 3))).toBe(false);
      // 登録の訂正・失効の影響を受ける計画の数が応答に出る
      const q = await newPermit({ permitNumber: "FRESH-2" });
      await newPlan({ ...NIGHT, permitNumbers: "FRESH-2" });
      await newPlan({ ...NIGHT, permitNumbers: "fresh-2, X" });
      const u = await permits.updatePermit(mgr(), q.id, { expectedVersion: 1, reason: "訂正", validTo: "2027-12-31" });
      expect(u.affectsPlans).toMatchObject({ changed: true, count: 2 });
      expect(u.affectsPlans.note).toContain("判定が古い");
      const noEffect = await permits.updatePermit(mgr(), q.id, { expectedVersion: 2, reason: "条件の文章だけ", conditionsText: "z" });
      expect(noEffect.affectsPlans).toMatchObject({ changed: false, note: null });
    });

    it("一覧の鮮度の計算に必要なクエリ数は、計画の件数に比例しない（5 件と 30 件で同じ）", async () => {
      await newPermit({ permitNumber: "Q-1" });
      const mkAircraft = async (): Promise<string> =>
        (
          await svc.createAircraft(mgr(), {
            registrationMark: `JU12Q${(seq++).toString().padStart(4, "0")}`,
            modelName: "M",
            manufacturer: "DJI",
            serialNumber: `SNQ-${seq}`,
            typeCertified: false,
            initialFlightMinutes: 0,
            maxTakeoffWeightKg: 0.9,
          })
        ).id;
      const small = await mkAircraft();
      const large = await mkAircraft();
      for (let i = 0; i < 5; i++) await newPlan({ aircraftId: small, ...NIGHT, permitNumbers: "Q-1, Q-2" });
      for (let i = 0; i < 30; i++) await newPlan({ aircraftId: large, ...NIGHT, permitNumbers: "Q-1, Q-2" });
      const measure = async (aircraftId: string) => {
        let n = 0;
        const wrapped = {
          query: (...a: unknown[]) => {
            n++;
            return (app.query as (...x: unknown[]) => unknown)(...a);
          },
          connect: () => app.connect(),
        } as unknown as OpsDb;
        const list = await plans.listPlans(ctxOf(manager, { db: wrapped }), { aircraftId });
        return { n, list };
      };
      const a = await measure(small);
      const b = await measure(large);
      expect(a.list).toHaveLength(5);
      expect(b.list).toHaveLength(30);
      expect(b.n).toBe(a.n);
      expect(a.list.every((p) => p.freshness.stale === false)).toBe(true);
      expect(b.list.every((p) => p.permits.numbers.length === 2)).toBe(true);
    });
  });

  // ================================================================
  // 計画の照合の API・候補
  // ================================================================
  describe("計画の照合の結果（GET /api/ops/plans/[id]/permits）", () => {
    it("番号ごとの状態・理由・登録の版・候補（番号が欄にない登録）。閲覧は全役割。他の組織の計画は 404", async () => {
      const inField = await newPermit({ permitNumber: "API-IN", kinds: ["did", "night"] });
      const cand = await newPermit({ permitNumber: "API-CAND", kinds: ["night"], validTo: "2027-12-31" });
      await newPermit({ permitNumber: "API-OUTSIDE", kinds: ["night"], placeScope: { type: "circles", circles: [{ lat: 43, lng: 141, radiusM: 1000 }] } });
      const notRelevant = await newPermit({ permitNumber: "API-NR", kinds: ["bvlos"] });
      const plan = await newPlan({ ...NIGHT, permitNumbers: "API-IN, API-NR, API-NONE" });
      const r = await permits.getPlanPermits(ctxOf(viewer), plan.id);
      expect(r.permits.numbers.map((n) => [n.numberText, n.status])).toEqual([
        ["API-IN", "applied"],
        ["API-NR", "not_relevant"],
        ["API-NONE", "unregistered"],
      ]);
      // 組織の他の登録（他のテストで作ったもの）も範囲に収まれば候補に出る。ここでは対象の登録の出入りを確かめる
      const names = r.candidates.map((c) => c.permitNumber);
      expect(names).toContain("API-CAND");
      for (const not of ["API-IN", "API-NR", "API-OUTSIDE"]) expect(names, not).not.toContain(not);
      expect(r.candidates.find((c) => c.permitNumber === "API-CAND")).toMatchObject({ registrationId: cand.id, insertText: "API-CAND", validTo: "2027-12-31", versionNo: 1 });
      // 候補は有効な最終日の遅い順
      const lasts = r.candidates.map((c) => c.validTo);
      expect(lasts).toEqual([...lasts].sort().reverse());
      expect(r.permits.window).toEqual({ from: "2027-01-14", to: "2027-01-14" });
      expect(r.judgementUpToDate).toBe(true);
      expect(r.snapshotBasis).toHaveLength(1);
      expect(r.declaration).toContain("許可書で確認してください");
      expect(inField.id && notRelevant.id).toBeTruthy();
      await expectOpsError(permits.getPlanPermits(ctxOf(managerB), plan.id), 404);
      // 適用が変わると judgementUpToDate が false
      await permits.updatePermit(mgr(), inField.id, { expectedVersion: 1, reason: "訂正", maxAltitudeM: 10 });
      expect((await permits.getPlanPermits(mgr(), plan.id)).judgementUpToDate).toBe(false);
    });
  });

  // ================================================================
  // 契約 15：次にやること「取得した許可・承認を登録する」（12b との関係）
  // ================================================================
  describe("契約 15：取得した許可・承認を登録する", () => {
    const MIHO = { latitude: 35.4936, longitude: 133.2361 };
    afterEach(() => vi.unstubAllEnvs());

    it("【フラグ有効】申請済みの記録があり、判定に許可の手続きが残り、適用された登録がないとき出る（運航管理者だけ canAct）。登録を作って番号を入れると消える", async () => {
      vi.stubEnv("APPLICATION_SUPPORT_ENABLED", "1");
      const plan = await plans.requestConfirmation(mgr(), (await newPlan({ ...MIHO, ...NIGHT, plannedStartAt: "2027-02-10T09:00" })).id, {});
      const before = await plans.getPlan(mgr(), plan.id);
      expect(before.nextActions.map((a) => a.id)).toContain("apply_permit");
      expect(before.nextActions.map((a) => a.id)).not.toContain("register_permit");
      await procs.createProcedureRecord(mgr(), plan.id, { kind: "dips_permit", action: "done", doneAt: "2027-01-05T11:00", checks: { applicationCompleted: true } });
      const asked = await plans.getPlan(mgr(), plan.id);
      const ids = asked.nextActions.map((a) => a.id);
      expect(ids).toContain("register_permit");
      expect(ids).not.toContain("apply_permit");
      expect(asked.nextActions.find((a) => a.id === "register_permit")).toMatchObject({ label: "取得した許可・承認を登録する", canAct: true, href: "/ops/permits/new" });
      // 運航管理者以外は依頼（canAct false）
      const asPilot = await plans.getPlan(ctxOf(pilotMember), plan.id);
      expect(asPilot.nextActions.find((a) => a.id === "register_permit")).toMatchObject({ canAct: false });
      // 登録を作り、番号を計画に入れて再判定 → 判定が手続き済み（条件付き）になり、この項目も消える（申請の記録は履歴に残る）
      await newPermit({ permitNumber: "NEXT-1", kinds: ["did", "night"], validFrom: "2027-02-01", validTo: "2027-02-28" });
      const upd = (await plans.updatePlan(mgr(), plan.id, { expectedVersion: asked.version, reason: "許可番号", permitNumbers: "NEXT-1" })).record;
      const after = await plans.getPlan(mgr(), plan.id);
      expect(after.permits.appliedCount).toBe(1);
      expect(upd.judgement.verdictLevel).not.toBe("no_procedure");
      expect(after.nextActions.map((a) => a.id)).not.toContain("register_permit");
      expect(after.nextActions.map((a) => a.id)).not.toContain("apply_permit");
      expect(after.procedureRecords.some((r) => r.kind === "dips_permit")).toBe(true);
    });

    it("【フラグ無効（既定）Sprint 18-2】記録なしで register_permit が出る（apply_permit は出ない）。登録を作って番号を入れると消える。申請の記録は作られない", async () => {
      vi.stubEnv("APPLICATION_SUPPORT_ENABLED", "");
      const plan = await plans.requestConfirmation(mgr(), (await newPlan({ ...MIHO, ...NIGHT, plannedStartAt: "2027-02-10T09:00" })).id, {});
      const asked = await plans.getPlan(mgr(), plan.id);
      const ids = asked.nextActions.map((a) => a.id);
      expect(ids).toContain("register_permit");
      expect(ids).not.toContain("apply_permit");
      const next = asked.nextActions.find((a) => a.id === "register_permit")!;
      expect(next).toMatchObject({ label: "取得した許可・承認を登録する", canAct: true, href: "/ops/permits/new", tier: 3, dueLabel: null });
      expect(JSON.stringify(asked.nextActions)).not.toContain("申請");
      // 運航管理者以外は依頼（canAct false）
      expect((await plans.getPlan(ctxOf(pilotMember), plan.id)).nextActions.find((a) => a.id === "register_permit")).toMatchObject({ canAct: false });
      // 登録を作り、番号を計画に入れて再判定 → 判定が手続き済み（条件付き）になり、この項目も消える
      await newPermit({ permitNumber: "NEXT-18-2", kinds: ["did", "night"], validFrom: "2027-02-01", validTo: "2027-02-28" });
      await plans.updatePlan(mgr(), plan.id, { expectedVersion: asked.version, reason: "許可番号", permitNumbers: "NEXT-18-2" });
      const after = await plans.getPlan(mgr(), plan.id);
      expect(after.permits.appliedCount).toBe(1);
      expect(after.nextActions.map((a) => a.id)).not.toContain("register_permit");
      expect(after.nextActions.map((a) => a.id)).not.toContain("apply_permit");
      // 申請の記録（dips_permit）は一度も作られていない。期待は「申請の記録に依存しない」こと
      expect(after.procedureRecords.some((r) => r.kind === "dips_permit")).toBe(false);
    });
  });
});
