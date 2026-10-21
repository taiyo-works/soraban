// Sprint 12a 契約 2〜12・17 の DB テスト（pnpm test:db）。
// 使い捨てのデータベースにマイグレーションを適用し、アプリ用ロール soraban_app に切り替えた接続でサービス層を動かす。
// 判定は本物の runDiagnosis に、同梱の規制データと市町村コード固定の読み込み口を渡して実行する（国土地理院へ接続しない）。
import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { MemberRow, PilotRow } from "@soraban/db";
import { ENGINE_VERSION } from "@soraban/regulations";
import { createTempDatabase, runCli, withClient, type TempDatabase } from "../../../../../packages/db/src/test-db-helpers";
import { resolveTestDatabaseUrl } from "../../../../../packages/db/src/test-db-env";
import { computeDiagnosisEvidenceId, runRegulationCheckWith } from "../check-core";
import { runDiagnosis } from "../diagnose-core";
import { baselineProvider } from "../sprint11e-baseline";
import type { Judge } from "./judge";
import { currentFreshnessContext, toDiagnosisRunInput } from "./plan-logic";
import * as places from "./places";
import * as plans from "./plans";
import * as rec from "./records";
import * as svc from "./service";
import { OpsError, type OpsContext } from "./service";
import type { OpsDb } from "./store";

const ADMIN_URL = resolveTestDatabaseUrl();
/** サーバーの現在時刻（JST 2027-01-05 12:00）。 */
const NOW = new Date("2027-01-05T03:00:00Z");

/** 本物の判定。市町村コードを固定する（undefined は逆ジオコーダが市町村を返さない場合）。 */
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

describe.skipIf(!ADMIN_URL)("飛行計画・判定スナップショット・確認・よく使う地点の DB", () => {
  let db: TempDatabase;
  let createdRole = false;
  let owner: pg.Pool;
  let app: pg.Pool;
  let orgA: string;
  let orgB: string;
  let manager: MemberRow;
  let manager2: MemberRow;
  let managerB: MemberRow;
  let pilotMember: MemberRow;
  let pilotMember2: MemberRow;
  let unlinkedPilotMember: MemberRow;
  let viewer: MemberRow;
  let pilotA: PilotRow;
  let pilotB: PilotRow;
  let pilotOfManager2: PilotRow;
  let pilotOrgB: PilotRow;
  let aircraftW: string;
  let aircraftNoWeight: string;
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

  const judge = judgeWith("31384");
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
  const count = async (table: string, where = "true", params: unknown[] = []): Promise<number> =>
    Number((await owner.query(`select count(*)::int as n from ${table} where ${where}`, params)).rows[0].n);
  const counts = async () => ({
    versions: await count("record_versions"),
    snapshots: await count("judgement_snapshots"),
    evidence: await count("evidence_log"),
    plans: await count("flight_plans"),
  });
  const verifyChain = async (type: string, id: string) =>
    (await owner.query("select * from verify_record_chain($1, $2)", [type, id])).rows as { version_no: number; problem: string }[];
  const verifySnapshots = async (planId: string) =>
    (await owner.query("select * from verify_judgement_snapshots($1)", [planId])).rows as { seq: number; problem: string }[];
  const snapshotRows = async (planId: string) =>
    (await owner.query("select * from judgement_snapshots where plan_id = $1 order by seq", [planId])).rows;

  const planInput = (aircraftId: string, pilotId: string, extra: Record<string, unknown> = {}) => ({
    title: `計画 ${++seq}`,
    aircraftId,
    pilotId,
    plannedStartAt: "2027-01-14T09:00",
    durationMinutes: 60,
    purpose: "空撮",
    placeName: "フューチャーテック株式会社 本社",
    ...HQ,
    ...extra,
  });
  const newPlan = async (extra: Record<string, unknown> = {}, o: { aircraftId?: string; pilotId?: string; ctx?: OpsContext } = {}) =>
    (await plans.createPlan(o.ctx ?? mgr(), planInput(o.aircraftId ?? aircraftW, o.pilotId ?? pilotB.id, extra))).record;
  /** 確認を依頼した計画（版 2）。 */
  const requestedPlan = async (extra: Record<string, unknown> = {}, pilotId?: string) => {
    const p = await newPlan(extra, { pilotId });
    return plans.requestConfirmation(mgr(), p.id, { expectedVersion: p.version });
  };
  const newAircraft = async (weightKg?: number, ctx: OpsContext = mgr()) =>
    (
      await svc.createAircraft(ctx, {
        registrationMark: `JU12T${(seq++).toString().padStart(4, "0")}`,
        modelName: "Matrice 350 RTK",
        manufacturer: "DJI",
        serialNumber: `SN-${seq}`,
        typeCertified: false,
        initialFlightMinutes: 0,
        ...(weightKg !== undefined ? { maxTakeoffWeightKg: weightKg } : {}),
      })
    ).id;

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
    manager = await addMember(orgA, "manager", "s12-mgr");
    manager2 = await addMember(orgA, "manager", "s12-mgr2");
    pilotMember = await addMember(orgA, "pilot", "s12-pilot");
    pilotMember2 = await addMember(orgA, "pilot", "s12-pilot2");
    unlinkedPilotMember = await addMember(orgA, "pilot", "s12-pilot-unlinked");
    viewer = await addMember(orgA, "viewer", "s12-viewer");
    managerB = await addMember(orgB, "manager", "s12-mgr-b");
    pilotA = await addPilot(orgA, "操縦 一郎", pilotMember.id);
    pilotB = await addPilot(orgA, "操縦 二郎", null);
    pilotOfManager2 = await addPilot(orgA, "運航 管理子", manager2.id);
    await addPilot(orgA, "操縦 三郎", pilotMember2.id);
    pilotOrgB = await addPilot(orgB, "組織B 操縦者", null);
    aircraftW = await newAircraft(0.9);
    aircraftNoWeight = await newAircraft();
    aircraftOrgB = await newAircraft(0.9, ctxOf(managerB));
  });

  afterAll(async () => {
    await app?.end();
    await owner?.end();
    await db?.drop();
    if (createdRole) await withClient(ADMIN_URL!, (c) => c.query("drop role if exists soraban_app"));
  });

  // ---- 契約 2・3：サーバーが判定を実行して保存する ----------------

  it("2. 計画を保存すると、サーバーが判定を実行して判定スナップショットが 1 件（seq = 1、reason = initial）できる。偽の判定は保存されない", async () => {
    const before = await counts();
    const p = await newPlan({
      flags: ["method_night"],
      // 偽の判定（夜間の計画に「手続き不要」）。サーバーは読まない
      verdict: { level: "no_procedure" },
      result: { verdict: { level: "no_procedure" }, category: "I" },
      snapshot: { id: randomUUID() },
      snapshotId: randomUUID(),
      evidenceId: "ev_fake",
      diagnosisEvidenceId: "ev_fake",
      droneWeightG: 1,
    });
    const rows = await snapshotRows(p.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ seq: 1, reason: "initial", verdict_level: "needs_procedure", category: "II_B_eligible", prev_hash: "" });
    expect(rows[0].result.verdict.level).toBe("needs_procedure");
    expect(rows[0].result.category).toBe("II_B_eligible");
    expect(rows[0].result.droneWeightG).toBe(900);
    expect(JSON.stringify(rows[0].result)).not.toContain("ev_fake");
    expect(rows[0].diagnosis_evidence_id).not.toBe("ev_fake");
    expect(p.currentSnapshotId).toBe(rows[0].id);
    expect(p.judgement).toMatchObject({ seq: 1, reason: "initial", verdictLevel: "needs_procedure", category: "II_B_eligible" });
    expect(p.droneWeightG).toBe(900);
    expect(p.status).toBe("draft");
    expect(p.state).toBe("draft");
    // 1 計画 = 版 1 つ + スナップショット 1 件
    const after = await counts();
    expect(after.versions).toBe(before.versions + 1);
    expect(after.snapshots).toBe(before.snapshots + 1);
    expect(after.plans).toBe(before.plans + 1);
  });

  it("3. スナップショットに入力・結果・エンジンの版・データセット（確認日つき）・手続きデータの版・証跡 ID・content_hash が入り、EVIDENCE_LOG=off でも evidence_log に地点判定の行ができる。診断の証跡 ID は再計算と一致する", async () => {
    const prev = process.env["EVIDENCE_LOG"];
    process.env["EVIDENCE_LOG"] = "off";
    try {
      const p = await newPlan({ flags: ["method_night"], plannedStartAt: "2027-01-15T22:00", maxAltitudeM: 160 });
      const s = (await snapshotRows(p.id))[0];
      expect(s.input).toEqual({
        lat: HQ.latitude,
        lng: HQ.longitude,
        droneWeightG: 900,
        flags: ["airspace_150m", "method_night"],
        plannedDate: "2027-01-15",
        pilotPermits: [],
      });
      expect(s.engine_version).toBe(ENGINE_VERSION);
      expect(s.procedures_revision).toBeGreaterThanOrEqual(1);
      expect(s.procedures_verified_at).toMatch(/^\d{4}-\d{2}-\d{2}/);
      expect(s.datasets.length).toBeGreaterThan(0);
      for (const d of s.datasets) expect(d).toMatchObject({ id: expect.any(String), name: expect.any(String), verifiedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}/) });
      expect(s.result.flags).toEqual(expect.arrayContaining(["method_night", "airspace_150m"]));
      expect(s.content_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(s.created_by_member_id).toBe(manager.id);
      expect(new Date(s.checked_at).toISOString()).toBe(NOW.toISOString());
      // 同じトランザクションで evidence_log に地点判定の行ができる
      const ev = await owner.query("select * from evidence_log where evidence_id = $1", [s.check_evidence_id]);
      expect(ev.rows).toHaveLength(1);
      expect(ev.rows[0].engine_version).toBe(ENGINE_VERSION);
      expect(ev.rows[0].verdict).not.toBeNull();
      // 保存した入力と結果から診断の証跡 ID を再計算すると一致する
      const r = s.result;
      const recomputed = computeDiagnosisEvidenceId({
        lat: r.lat,
        lng: r.lng,
        checkedAt: r.checkedAt,
        regulationIds: ev.rows[0].regulation_ids,
        droneWeightG: s.input.droneWeightG ?? undefined,
        flags: r.flags,
        plannedDate: s.input.plannedDate,
        accessControl: s.input.accessControl,
        thirdPartyOverflight: s.input.thirdPartyOverflight,
        bvlosWithObserver: s.input.bvlosWithObserver,
        category: r.category,
        procedureIds: r.procedures.map((x: { id: string }) => x.id),
        didStatus: r.didStatus,
        datasets: r.datasets,
        permits: r.verdict.permits,
        ...(r.verdict.purpose !== undefined ? { purpose: r.verdict.purpose } : {}),
      });
      expect(recomputed).toBe(s.diagnosis_evidence_id);
      expect(r.evidenceId).toBe(s.diagnosis_evidence_id);
      expect(r.checkEvidenceId).toBe(s.check_evidence_id);
      // content_hash は DB の関数で再計算した値と一致する
      expect(await verifySnapshots(p.id)).toEqual([]);
    } finally {
      if (prev === undefined) delete process.env["EVIDENCE_LOG"];
      else process.env["EVIDENCE_LOG"] = prev;
    }
  });

  // ---- 契約 4：追記専用（権限とトリガー） --------------------------

  it("4. soraban_app は judgement_snapshots・plan_confirmations に INSERT・SELECT だけできる（UPDATE・DELETE・TRUNCATE は 42501）。flight_plans・saved_places は SELECT だけ", async () => {
    const p = await requestedPlan();
    const c = (await plans.confirmPlan(mgr(), p.id, { decision: "approved", expectedVersion: p.version })).confirmation;
    await withClient(db.url, async (cl) => {
      await cl.query("set role soraban_app");
      expect((await cl.query("select count(*)::int as n from judgement_snapshots")).rows[0].n).toBeGreaterThan(0);
      expect((await cl.query("select count(*)::int as n from plan_confirmations")).rows[0].n).toBeGreaterThan(0);
      expect((await cl.query("select count(*)::int as n from flight_plans")).rows[0].n).toBeGreaterThan(0);
      for (const t of ["judgement_snapshots", "plan_confirmations"]) {
        await expect(cl.query(`update ${t} set org_id = org_id`)).rejects.toMatchObject({ code: "42501" });
        await expect(cl.query(`delete from ${t}`)).rejects.toMatchObject({ code: "42501" });
        await expect(cl.query(`truncate ${t}`)).rejects.toMatchObject({ code: "42501" });
      }
      for (const t of ["flight_plans", "saved_places"]) {
        await expect(cl.query(`insert into ${t} (id) values (gen_random_uuid())`)).rejects.toMatchObject({ code: "42501" });
        await expect(cl.query(`update ${t} set org_id = org_id`)).rejects.toMatchObject({ code: "42501" });
        await expect(cl.query(`delete from ${t}`)).rejects.toMatchObject({ code: "42501" });
        await expect(cl.query(`truncate ${t}`)).rejects.toMatchObject({ code: "42501" });
      }
    });
    // has_table_privilege（CI の確認と同じ内容）
    const priv = async (t: string, op: string) =>
      (await owner.query("select has_table_privilege('soraban_app', $1, $2) as p", [t, op])).rows[0].p as boolean;
    for (const t of ["judgement_snapshots", "plan_confirmations"]) {
      expect([await priv(t, "SELECT"), await priv(t, "INSERT"), await priv(t, "UPDATE"), await priv(t, "DELETE"), await priv(t, "TRUNCATE")]).toEqual([
        true,
        true,
        false,
        false,
        false,
      ]);
    }
    for (const t of ["flight_plans", "saved_places"]) {
      expect([await priv(t, "SELECT"), await priv(t, "INSERT"), await priv(t, "UPDATE"), await priv(t, "DELETE"), await priv(t, "TRUNCATE")]).toEqual([
        true,
        false,
        false,
        false,
        false,
      ]);
    }
    expect(c.id).toBeTruthy();
  });

  it("4. オーナーロールで UPDATE・DELETE・TRUNCATE しても、トリガーが拒む（SB409 immutable）", async () => {
    const p = await requestedPlan();
    await plans.confirmPlan(mgr(), p.id, { decision: "approved", expectedVersion: p.version });
    for (const t of ["judgement_snapshots", "plan_confirmations"]) {
      for (const sql of [`update ${t} set org_id = org_id`, `delete from ${t}`, `truncate ${t} cascade`]) {
        const e = await owner.query(sql).then(
          () => null,
          (x: { code?: string; detail?: string }) => x,
        );
        expect(e, sql).toMatchObject({ code: "SB409", detail: "immutable" });
      }
    }
    // 参照されている表の TRUNCATE（CASCADE なし）は外部キーが拒む
    await expect(owner.query("truncate judgement_snapshots")).rejects.toMatchObject({ code: "0A000" });
    // 拒まれた後も、行は残っている
    expect(await count("judgement_snapshots", "plan_id = $1", [p.id])).toBe(1);
    expect(await count("plan_confirmations", "plan_id = $1", [p.id])).toBe(1);
  });

  // ---- 契約 5：DB が決める値・ハッシュの検証 -----------------------

  it("5. seq・prev_hash・content_hash・created_at は DB が決め、INSERT で偽の値を渡しても上書きされる", async () => {
    const p = await newPlan({ flags: ["method_night"] });
    const first = (await snapshotRows(p.id))[0];
    const cl = await owner.connect();
    try {
      await cl.query("begin");
      const r = await cl.query(
        `insert into judgement_snapshots (id, org_id, plan_id, seq, reason, input, result, verdict_level, verdict_unknown_count,
           category, engine_version, checked_at, check_evidence_id, diagnosis_evidence_id, datasets, procedures_revision,
           procedures_verified_at, created_by_member_id, created_at, prev_hash, content_hash)
         values ($1, $2, $3, 99, 'manual', $4::jsonb, $5::jsonb, 'needs_procedure', 0, 'II_A', 'x', now(), $6, 'ev_x', '[]'::jsonb, 1,
           '2026-10-19', $7, '1999-01-01T00:00:00Z', 'fake-prev', 'fake-content')
         returning *`,
        [randomUUID(), orgA, p.id, JSON.stringify(first.input), JSON.stringify(first.result), first.check_evidence_id, manager.id],
      );
      const row = r.rows[0];
      expect(row.seq).toBe(2);
      expect(row.prev_hash).toBe(first.content_hash);
      expect(row.content_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(row.content_hash).not.toBe("fake-content");
      expect(new Date(row.created_at).getFullYear()).toBeGreaterThan(2000);
      await cl.query("rollback");
    } finally {
      cl.release();
    }
    expect(await snapshotRows(p.id)).toHaveLength(1);
  });

  it("5. verify_judgement_snapshots は改変のない計画で 0 行、トリガーを無効にして書き換えると問題を返す", async () => {
    const p = await newPlan({ flags: ["method_night"] });
    const upd = await plans.updatePlan(mgr(), p.id, { expectedVersion: p.version, reason: "場所の訂正", latitude: 35.4278, longitude: 133.3314 });
    expect(upd.record.judgement.seq).toBe(2);
    expect(await verifySnapshots(p.id)).toEqual([]);
    const rows = await snapshotRows(p.id);
    const disable = () => owner.query("alter table judgement_snapshots disable trigger judgement_snapshots_no_update_delete");
    const enable = () => owner.query("alter table judgement_snapshots enable trigger judgement_snapshots_no_update_delete");
    await disable();
    try {
      // result の書き換え
      await owner.query("update judgement_snapshots set result = jsonb_set(result, '{category}', '\"I\"') where id = $1", [rows[0].id]);
      expect(await verifySnapshots(p.id)).toEqual([{ seq: 1, problem: "content_hash_mismatch" }]);
      await owner.query("update judgement_snapshots set result = $2::jsonb where id = $1", [rows[0].id, JSON.stringify(rows[0].result)]);
      expect(await verifySnapshots(p.id)).toEqual([]);
      // content_hash の書き換え（その行の不一致と、次の行の prev_hash の不一致）
      await owner.query("update judgement_snapshots set content_hash = repeat('0', 64) where id = $1", [rows[0].id]);
      expect(await verifySnapshots(p.id)).toEqual([
        { seq: 1, problem: "content_hash_mismatch" },
        { seq: 2, problem: "prev_hash_mismatch" },
      ]);
      await owner.query("update judgement_snapshots set content_hash = $2 where id = $1", [rows[0].id, rows[0].content_hash]);
      expect(await verifySnapshots(p.id)).toEqual([]);
    } finally {
      await enable();
    }
    const q = await newPlan();
    const q2 = await plans.rejudgePlan(mgr(), q.id, {});
    expect(q2.judgement.seq).toBe(2);
    const qrows = await snapshotRows(q.id);
    await disable();
    try {
      await owner.query("delete from judgement_snapshots where id = $1", [qrows[0].id]);
      const problems = (await verifySnapshots(q.id)).map((x) => x.problem);
      expect(problems).toContain("missing_seq");
      expect(problems).toContain("prev_hash_mismatch");
    } finally {
      await enable();
    }
  });

  it("5. 計画の現在のスナップショットが最新でない・無い場合は verify が検出する（計画のヘッド表の書き換え）", async () => {
    const p = await newPlan();
    const s1 = (await snapshotRows(p.id))[0];
    expect(await verifySnapshots(p.id)).toEqual([]);
    // 最新でない（2 件目を追加して、計画の current_snapshot_id は 1 件目のまま）
    const cl = await owner.connect();
    try {
      await cl.query("begin");
      await cl.query(
        `insert into judgement_snapshots (id, org_id, plan_id, reason, input, result, verdict_level, verdict_unknown_count, category,
           engine_version, checked_at, check_evidence_id, diagnosis_evidence_id, datasets, procedures_revision, procedures_verified_at,
           created_by_member_id)
         values ($1, $2, $3, 'manual', $4::jsonb, $5::jsonb, 'needs_procedure', 0, 'I', 'x', now(), $6, 'ev_x', '[]'::jsonb, 1, 'x', $7)`,
        [randomUUID(), orgA, p.id, JSON.stringify(s1.input), JSON.stringify(s1.result), s1.check_evidence_id, manager.id],
      );
      const r = (await cl.query("select * from verify_judgement_snapshots($1)", [p.id])).rows;
      expect(r).toEqual([{ seq: 2, problem: "head_snapshot_not_latest" }]);
      await cl.query("rollback");
    } finally {
      cl.release();
    }
  });

  // ---- 契約 6：原子性 ------------------------------------------------

  it("6b. 判定の待ち時間に別の訂正が入っても、版の指定がない判定のやり直しは上書きせず 409 version_conflict にする", async () => {
    const p = await newPlan();
    // 判定の最中に、別の人が計画を訂正する（メモの追記。版が上がる）。
    const racing: Judge = async (input, now) => {
      await plans.updatePlan(mgr(), p.id, { expectedVersion: p.version, reason: "判定中の訂正", notes: "同時に入った訂正" });
      return judgeWith(undefined)(input, now);
    };
    const before = await counts();
    await expectOpsError(plans.rejudgePlan(mgr({ judge: racing }), p.id, {}), 409, "version_conflict");
    const after = await counts();
    expect(after.snapshots).toBe(before.snapshots);
    const now = await plans.getPlan(mgr(), p.id);
    expect(now.version).toBe(p.version + 1);
    expect(now.notes).toBe("同時に入った訂正");
  });


  it("6. 判定の失敗・時間切れでは 503 judgement_failed を返し、record_versions・judgement_snapshots・evidence_log のどれにも行が残らない", async () => {
    const before = await counts();
    const failing: Judge = async () => {
      throw new Error("逆ジオコーダが落ちた");
    };
    await expectOpsError(plans.createPlan(mgr({ judge: failing }), planInput(aircraftW, pilotB.id, { latitude: 35.5, longitude: 133.5 })), 503, "judgement_failed");
    const hanging: Judge = () => new Promise(() => undefined);
    await expectOpsError(
      plans.createPlan(mgr({ judge: hanging, judgeTimeoutMs: 50 }), planInput(aircraftW, pilotB.id, { latitude: 35.5, longitude: 133.5 })),
      503,
      "judgement_failed",
    );
    expect(await counts()).toEqual(before);
    // 訂正でも同じ（判定に関わる項目を変える訂正）
    const p = await newPlan();
    const mid = await counts();
    await expectOpsError(
      plans.updatePlan(mgr({ judge: failing }), p.id, { expectedVersion: p.version, reason: "場所の訂正", latitude: 35.51 }),
      503,
      "judgement_failed",
    );
    await expectOpsError(plans.rejudgePlan(mgr({ judge: failing }), p.id, {}), 503, "judgement_failed");
    expect(await counts()).toEqual(mid);
    expect((await plans.getPlan(mgr(), p.id)).version).toBe(p.version);
  });

  it("6. スナップショットの挿入後に計画の版の追加が失敗した場合も、スナップショットと地点判定の証跡が残らない", async () => {
    const p = await newPlan();
    const before = await counts();
    // 版番号の食い違い（SB409 version_conflict）は、スナップショットの挿入の後、計画の版の追加で DB が検出する
    await expectOpsError(
      plans.updatePlan(mgr(), p.id, { expectedVersion: p.version + 5, reason: "場所の訂正", latitude: 35.52, longitude: 133.52 }),
      409,
      "version_conflict",
    );
    expect(await counts()).toEqual(before);
    expect(await snapshotRows(p.id)).toHaveLength(1);
    // 計画の版の追加の失敗（存在しない地点）でも作成が丸ごと取り消される
    await expectOpsError(
      plans.createPlan(mgr(), planInput(aircraftW, pilotB.id, { latitude: 35.53, longitude: 133.53, savedPlaceId: randomUUID() })),
      404,
      "not_found",
    );
    expect(await counts()).toEqual(before);
  });

  // ---- 契約 7：版・中止・二重送信・組織の分離 ---------------------

  it("7. 計画の作成・訂正・中止が版として残り、verify_record_chain が 0 行。物理削除はない", async () => {
    const p = await newPlan();
    const u = await plans.updatePlan(mgr(), p.id, { expectedVersion: 1, reason: "計画名の訂正", title: "訂正後の計画名" });
    expect(u.record).toMatchObject({ version: 2, title: "訂正後の計画名" });
    const v = await plans.voidPlan(mgr(), p.id, { expectedVersion: 2, reason: "天候不良で中止" });
    expect(v).toMatchObject({ voided: true, version: 3, state: "voided", stateLabel: "中止" });
    expect(await verifyChain("flight_plan", p.id)).toEqual([]);
    const versions = await plans.listPlanVersions(mgr(), p.id);
    expect(versions.map((x) => [x.versionNo, x.op])).toEqual([
      [1, "create"],
      [2, "update"],
      [3, "void"],
    ]);
    expect(versions[1]!.changedFields).toContain("計画名");
    // 物理削除の権限はない
    await withClient(db.url, async (c) => {
      await c.query("set role soraban_app");
      await expect(c.query("delete from flight_plans where id = $1", [p.id])).rejects.toMatchObject({ code: "42501" });
    });
    expect(await count("flight_plans", "id = $1", [p.id])).toBe(1);
  });

  it("7. 中止した計画の訂正・確認・確認の依頼・再判定・飛行記録の紐付けは 409", async () => {
    const p = await requestedPlan();
    await plans.voidPlan(mgr(), p.id, { expectedVersion: p.version, reason: "中止" });
    const cancelled = await plans.getPlan(mgr(), p.id);
    await expectOpsError(plans.updatePlan(mgr(), p.id, { expectedVersion: cancelled.version, reason: "訂正", title: "x" }), 409, "voided");
    await expectOpsError(plans.confirmPlan(mgr(), p.id, { decision: "approved", expectedVersion: cancelled.version }), 409, "voided");
    await expectOpsError(plans.requestConfirmation(mgr(), p.id, {}), 409, "voided");
    await expectOpsError(plans.rejudgePlan(mgr(), p.id, {}), 409, "voided");
    await expectOpsError(plans.voidPlan(mgr(), p.id, { expectedVersion: cancelled.version, reason: "再度" }), 409, "voided");
    await expectOpsError(
      rec.createFlight(mgr(), {
        aircraftId: aircraftW,
        pilotId: pilotB.id,
        flightPlanId: p.id,
        purpose: "空撮",
        takeoffPlace: "本社",
        landingPlace: "本社",
        takeoffAt: "2026-12-09T09:00",
        landingAt: "2026-12-09T09:10",
        safetyIssue: false,
      }),
      409,
      "plan_cancelled",
    );
    // DB も拒む（確認の記録を直接追加）
    await expect(
      owner.query(
        `insert into plan_confirmations (org_id, plan_id, plan_version, snapshot_id, decision, confirmer_member_id)
         values ($1, $2, $3, $4, 'approved', $5)`,
        [orgA, p.id, cancelled.version, cancelled.currentSnapshotId, manager.id],
      ),
    ).rejects.toMatchObject({ code: "SB409", detail: "voided" });
  });

  it("7. 同じ clientRequestId の作成は新しい計画を作らず既存を返す。別の利用者の識別子は 409", async () => {
    const clientRequestId = randomUUID();
    const input = planInput(aircraftW, pilotB.id, { clientRequestId });
    const a = await plans.createPlan(mgr(), input);
    const b = await plans.createPlan(mgr(), input);
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(b.record.id).toBe(a.record.id);
    expect(await count("flight_plans", "client_request_id = $1", [clientRequestId])).toBe(1);
    expect(await count("judgement_snapshots", "plan_id = $1", [a.record.id])).toBe(1);
    await expectOpsError(plans.createPlan(ctxOf(manager2), input), 409, "request_conflict");
    await expectOpsError(plans.createPlan(mgr(), { ...input, clientRequestId: "not-a-uuid" }), 400, "invalid_input");
  });

  it("7. 他の組織の計画・スナップショットは 404（読み出し・訂正・中止・確認・再判定・版・地点の指定）", async () => {
    const p = await requestedPlan();
    const b = ctxOf(managerB);
    await expectOpsError(plans.getPlan(b, p.id), 404);
    await expectOpsError(plans.updatePlan(b, p.id, { expectedVersion: p.version, reason: "x", title: "x" }), 404);
    await expectOpsError(plans.voidPlan(b, p.id, { expectedVersion: p.version, reason: "x" }), 404);
    await expectOpsError(plans.confirmPlan(b, p.id, { decision: "approved", expectedVersion: p.version }), 404);
    await expectOpsError(plans.rejudgePlan(b, p.id, {}), 404);
    await expectOpsError(plans.requestConfirmation(b, p.id, {}), 404);
    await expectOpsError(plans.listPlanVersions(b, p.id), 404);
    await expectOpsError(plans.listPlanConfirmations(b, p.id), 404);
    await expectOpsError(plans.listSnapshots(b, p.id), 404);
    await expectOpsError(plans.getSnapshot(b, p.id, p.currentSnapshotId), 404);
    expect((await plans.listPlans(b)).map((x) => x.id)).not.toContain(p.id);
    // 他の組織の機体・操縦者で作る計画は 404
    await expectOpsError(plans.createPlan(mgr(), planInput(aircraftOrgB, pilotB.id)), 404);
    await expectOpsError(plans.createPlan(mgr(), planInput(aircraftW, pilotOrgB.id)), 404);
    // 他の組織の計画に、自分の組織のスナップショットの ID で到達できない・その逆も
    const own = await plans.createPlan(b, planInput(aircraftOrgB, pilotOrgB.id));
    await expectOpsError(plans.getSnapshot(mgr(), p.id, own.record.currentSnapshotId), 404);
    await expectOpsError(plans.getSnapshot(b, own.record.id, p.currentSnapshotId), 404);
    // DB の外部キー：他の組織の計画のスナップショットを自分の組織の確認に結べない
    await expect(
      owner.query(
        `insert into plan_confirmations (org_id, plan_id, plan_version, snapshot_id, decision, confirmer_member_id)
         values ($1, $2, $3, $4, 'approved', $5)`,
        [orgA, p.id, p.version, own.record.currentSnapshotId, manager.id],
      ),
    ).rejects.toMatchObject({ code: "SB409" });
  });

  // ---- 契約 8：判定に関わる項目の訂正 --------------------------------

  it("8. 判定に関わる項目を訂正すると、新しい版と新しいスナップショット（seq + 1、input_changed）が同じトランザクションでできる。古いスナップショットは変わらず、一覧に並ぶ", async () => {
    const p = await newPlan({ flags: ["method_night"] });
    const first = (await snapshotRows(p.id))[0];
    const cases: { name: string; patch: Record<string, unknown> }[] = [
      { name: "場所", patch: { latitude: 35.4278, longitude: 133.3314 } },
      { name: "予定日", patch: { plannedStartAt: "2027-01-20T09:00" } },
      { name: "飛行の方法・空域", patch: { flags: ["method_night", "method_bvlos"] } },
      { name: "最大高度", patch: { maxAltitudeM: 150 } },
      { name: "許可", patch: { pilotPermits: ["mlit:night"] } },
      { name: "目的の例外", patch: { judgementPurpose: "emergency" } },
      { name: "立入管理措置", patch: { accessControl: true } },
      { name: "第三者上空", patch: { thirdPartyOverflight: false } },
      { name: "補助者", patch: { bvlosWithObserver: true } },
    ];
    let current = p;
    for (const [i, c] of cases.entries()) {
      const before = await counts();
      const u = await plans.updatePlan(mgr(), p.id, { expectedVersion: current.version, reason: `${c.name}の訂正`, ...c.patch });
      current = u.record;
      expect(current.version, c.name).toBe(p.version + i + 1);
      expect(current.judgement.seq, c.name).toBe(i + 2);
      expect(current.judgement.reason, c.name).toBe("input_changed");
      const after = await counts();
      expect(after.versions, c.name).toBe(before.versions + 1);
      expect(after.snapshots, c.name).toBe(before.snapshots + 1);
      // 新しい版の data の current_snapshot_id が新しいスナップショット
      const data = (await owner.query("select data from record_versions where entity_id = $1 and version_no = $2", [p.id, current.version])).rows[0].data;
      expect(data.current_snapshot_id).toBe(current.currentSnapshotId);
    }
    const rows = await snapshotRows(p.id);
    expect(rows.map((r) => r.seq)).toEqual(cases.map((_, i) => i + 1 + 0).concat([cases.length + 1]));
    expect(rows[0].content_hash).toBe(first.content_hash);
    expect(rows[0].result).toEqual(first.result);
    expect((await plans.listSnapshots(mgr(), p.id)).map((s) => [s.seq, s.isCurrent])).toEqual([
      ...cases.map((_, i) => [i + 1, false]),
      [cases.length + 1, true],
    ]);
    expect(await verifySnapshots(p.id)).toEqual([]);
    expect(await verifyChain("flight_plan", p.id)).toEqual([]);
    // 許可・目的の例外・最大高度が判定の入力に入っている
    const last = rows[rows.length - 1];
    expect(last.input).toMatchObject({
      pilotPermits: ["mlit:night"],
      purpose: "emergency",
      accessControl: true,
      thirdPartyOverflight: false,
      bvlosWithObserver: true,
    });
    expect(last.input.flags).toEqual(["airspace_150m", "method_night", "method_bvlos"]);
  });

  it("8. 判定に関わらない項目（計画名、メモ、許可番号の文字、目的の自由記述、予定の時刻、場所の名称、所要時間、操縦者）の訂正ではスナップショットが増えない", async () => {
    const p = await newPlan({ flags: ["method_night"] });
    const before = await counts();
    const u = await plans.updatePlan(mgr(), p.id, {
      expectedVersion: p.version,
      reason: "記載の整理",
      title: "新しい計画名",
      notes: "メモ",
      permitNumbers: "AB-1234",
      purpose: "点検",
      plannedStartAt: "2027-01-14T15:30",
      placeName: "別の名称",
      durationMinutes: 90,
      pilotId: pilotA.id,
    });
    expect(u.record).toMatchObject({
      version: p.version + 1,
      title: "新しい計画名",
      notes: "メモ",
      permitNumbers: "AB-1234",
      purpose: "点検",
      placeName: "別の名称",
      durationMinutes: 90,
      pilotId: pilotA.id,
      pilotName: "操縦 一郎",
      currentSnapshotId: p.currentSnapshotId,
    });
    expect(u.record.plannedStartAt).toBe("2027-01-14T15:30");
    const after = await counts();
    expect(after.versions).toBe(before.versions + 1);
    expect(after.snapshots).toBe(before.snapshots);
    expect(after.evidence).toBe(before.evidence);
    expect(await verifyChain("flight_plan", p.id)).toEqual([]);
  });

  it("8. 機体は訂正で変えられない（400 aircraft_immutable）。計画の項目の検査は項目ごとの理由コードで返る", async () => {
    const p = await newPlan();
    const e = await expectOpsError(
      plans.updatePlan(mgr(), p.id, { expectedVersion: p.version, reason: "機体の変更", aircraftId: aircraftNoWeight }),
      400,
      "invalid_input",
    );
    expect(e.fieldCodes).toMatchObject({ aircraftId: "aircraft_immutable" });
    // DB も拒む（版の data の機体を変える）
    await expect(
      owner.query(
        `insert into record_versions (org_id, entity_type, entity_id, op, data, reason, actor_kind, actor_member_id)
         select org_id, 'flight_plan', entity_id, 'update', data || jsonb_build_object('aircraft_id', $2::text), '機体の変更', 'member', $3
           from record_versions where entity_id = $1 and version_no = 1`,
        [p.id, aircraftNoWeight, manager.id],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    const bad = await expectOpsError(
      plans.updatePlan(mgr(), p.id, { expectedVersion: p.version, reason: "x", latitude: 100, durationMinutes: 0 }),
      400,
      "invalid_input",
    );
    expect(bad.fieldCodes).toMatchObject({ latitude: "coordinate_range", durationMinutes: "out_of_range" });
  });

  // ---- 契約 9：鮮度と再判定 --------------------------------------------

  it("9. 機体の最大離陸重量の変更で「判定が古い」（input_changed）になり、判定をやり直すと新しいスナップショット（manual）と新しい計画の版ができる。古いスナップショットは残る", async () => {
    const ac = await newAircraft(0.5);
    const p = await newPlan({ flags: ["method_night"] }, { aircraftId: ac });
    expect(p.droneWeightG).toBe(500);
    expect(p.freshness).toEqual({ stale: false, reasons: [] });
    const a = await svc.getAircraft(mgr(), ac);
    await svc.updateAircraft(mgr(), ac, { expectedVersion: a.version, reason: "実機の確認", maxTakeoffWeightKg: 1.5 });
    const stale = await plans.getPlan(mgr(), p.id);
    expect(stale.freshness.stale).toBe(true);
    expect(stale.freshness.reasons.map((r) => r.code)).toEqual(["input_changed"]);
    // 一覧でも result を読まずに求められる
    expect((await plans.listPlans(mgr())).find((x) => x.id === p.id)!.freshness.stale).toBe(true);
    const before = await counts();
    const re = await plans.rejudgePlan(mgr(), p.id, { expectedVersion: stale.version });
    expect(re.judgement).toMatchObject({ seq: 2, reason: "manual" });
    expect(re.version).toBe(stale.version + 1);
    expect(re.droneWeightG).toBe(1500);
    expect(re.freshness.stale).toBe(false);
    const after = await counts();
    expect(after.snapshots).toBe(before.snapshots + 1);
    expect(after.versions).toBe(before.versions + 1);
    const rows = await snapshotRows(p.id);
    expect(rows).toHaveLength(2);
    expect(rows[0].input.droneWeightG).toBe(500);
    expect(rows[1].input.droneWeightG).toBe(1500);
    expect(await verifySnapshots(p.id)).toEqual([]);
    expect(await verifyChain("flight_plan", p.id)).toEqual([]);
  });

  it("9. エンジンの版・データセットの確認日・手続きデータの版が変わると「判定が古い」になり、判定をやり直すと data_updated になる", async () => {
    const real = currentFreshnessContext();
    const p = await newPlan();
    const engine = mgr({ freshnessNow: { ...real, engineVersion: "soraban-9.9.9" } });
    expect((await plans.getPlan(engine, p.id)).freshness.reasons.map((r) => r.code)).toEqual(["engine_changed"]);
    const data = mgr({ freshnessNow: { ...real, datasetVerifiedAt: () => "2099-01-01" } });
    expect((await plans.getPlan(data, p.id)).freshness.reasons.map((r) => r.code)).toEqual(["data_changed"]);
    const procs = mgr({ freshnessNow: { ...real, proceduresRevision: real.proceduresRevision + 1 } });
    expect((await plans.getPlan(procs, p.id)).freshness.reasons.map((r) => r.code)).toEqual(["procedures_changed"]);
    // 現在の値では新しい
    expect((await plans.getPlan(mgr(), p.id)).freshness.stale).toBe(false);
    const re = await plans.rejudgePlan(engine, p.id, {});
    expect(re.judgement).toMatchObject({ seq: 2, reason: "data_updated" });
    expect(await snapshotRows(p.id)).toHaveLength(2);
    // 新しいとき（古くないとき）の手動の再判定は manual
    const again = await plans.rejudgePlan(mgr(), p.id, {});
    expect(again.judgement).toMatchObject({ seq: 3, reason: "manual" });
  });

  // ---- 契約 10：運航管理者の確認 --------------------------------------------

  it("10. 運航管理者が確認すると plan_confirmations に確認者・日時・計画の版・スナップショット ID が残る。差し戻しは理由が必須", async () => {
    const p = await requestedPlan({ flags: ["method_night"] });
    expect(p.state).toBe("pending");
    const ok = await plans.confirmPlan(ctxOf(manager2), p.id, { decision: "approved", expectedVersion: p.version });
    expect(ok.confirmation).toMatchObject({
      planVersion: p.version,
      snapshotId: p.currentSnapshotId,
      decision: "approved",
      confirmerMemberId: manager2.id,
      confirmerName: "s12-mgr2",
      selfConfirmation: false,
    });
    expect(ok.confirmation.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(ok.plan).toMatchObject({ state: "approved", stateLabel: "確認済み" });
    const row = (await owner.query("select * from plan_confirmations where id = $1", [ok.confirmation.id])).rows[0];
    expect(new Date(row.created_at).getFullYear()).toBeGreaterThan(2000);
    // 差し戻し：理由が必須（空は 400）
    const e = await expectOpsError(plans.confirmPlan(mgr(), p.id, { decision: "returned", expectedVersion: p.version }), 400, "invalid_input");
    expect(e.fieldCodes).toMatchObject({ reason: "required" });
    await expectOpsError(plans.confirmPlan(mgr(), p.id, { decision: "returned", expectedVersion: p.version, reason: "   " }), 400, "invalid_input");
    await expectOpsError(plans.confirmPlan(mgr(), p.id, { decision: "maybe", expectedVersion: p.version }), 400, "invalid_input");
    await expectOpsError(plans.confirmPlan(mgr(), p.id, { decision: "approved" }), 400, "invalid_input");
    const back = await plans.confirmPlan(mgr(), p.id, { decision: "returned", expectedVersion: p.version, reason: "夜間の灯火の記載が足りません" });
    expect(back.confirmation).toMatchObject({ decision: "returned", reason: "夜間の灯火の記載が足りません" });
    expect(back.plan).toMatchObject({ state: "returned", stateLabel: "差し戻し" });
    expect((await plans.listPlanConfirmations(mgr(), p.id)).map((c) => c.decision)).toEqual(["approved", "returned"]);
    // DB の CHECK でも拒否（理由なしの差し戻し）
    await expect(
      owner.query(
        `insert into plan_confirmations (org_id, plan_id, plan_version, snapshot_id, decision, reason, confirmer_member_id)
         values ($1, $2, $3, $4, 'returned', NULL, $5)`,
        [orgA, p.id, p.version, p.currentSnapshotId, manager.id],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      owner.query(
        `insert into plan_confirmations (org_id, plan_id, plan_version, snapshot_id, decision, reason, confirmer_member_id)
         values ($1, $2, $3, $4, 'returned', '  ', $5)`,
        [orgA, p.id, p.version, p.currentSnapshotId, manager.id],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("10. draft の計画・最新でない版への確認は 409。訂正の後は「前の版への確認」になり、修正は「修正済み（再確認待ち）」になる", async () => {
    const draft = await newPlan();
    await expectOpsError(plans.confirmPlan(mgr(), draft.id, { decision: "approved", expectedVersion: draft.version }), 409, "not_requested");
    await expect(
      owner.query(
        `insert into plan_confirmations (org_id, plan_id, plan_version, snapshot_id, decision, confirmer_member_id)
         values ($1, $2, $3, $4, 'approved', $5)`,
        [orgA, draft.id, draft.version, draft.currentSnapshotId, manager.id],
      ),
    ).rejects.toMatchObject({ code: "SB409", detail: "not_requested" });

    const p = await requestedPlan();
    const ok = await plans.confirmPlan(mgr(), p.id, { decision: "approved", expectedVersion: p.version });
    expect(ok.plan.state).toBe("approved");
    // 確認の後に計画を訂正すると、「前の版への確認（再確認が必要）」になる
    const changed = await plans.updatePlan(mgr(), p.id, { expectedVersion: p.version, reason: "場所を訂正", latitude: 35.4278, longitude: 133.3314 });
    expect(changed.record.state).toBe("approved_stale");
    expect(changed.record.stateLabel).toBe("前の版への確認（再確認が必要）");
    // 最新でない版への確認は 409
    await expectOpsError(plans.confirmPlan(mgr(), p.id, { decision: "approved", expectedVersion: p.version }), 409, "version_conflict");
    await expect(
      owner.query(
        `insert into plan_confirmations (org_id, plan_id, plan_version, snapshot_id, decision, confirmer_member_id)
         values ($1, $2, $3, $4, 'approved', $5)`,
        [orgA, p.id, p.version, p.currentSnapshotId, manager.id],
      ),
    ).rejects.toMatchObject({ code: "SB409", detail: "version_conflict" });
    // その版の snapshot_id と違うスナップショットは拒む（最新の版でも、古い snapshot_id では確認できない）
    await expect(
      owner.query(
        `insert into plan_confirmations (org_id, plan_id, plan_version, snapshot_id, decision, confirmer_member_id)
         values ($1, $2, $3, $4, 'approved', $5)`,
        [orgA, p.id, changed.record.version, p.currentSnapshotId, manager.id],
      ),
    ).rejects.toMatchObject({ code: "SB409", detail: "snapshot_mismatch" });
    // 再確認で「確認済み」に戻る
    const again = await plans.confirmPlan(mgr(), p.id, { decision: "approved", expectedVersion: changed.record.version });
    expect(again.plan.state).toBe("approved");
    // 差し戻し → 修正 → 修正済み（再確認待ち）
    const q = await requestedPlan();
    const back = await plans.confirmPlan(mgr(), q.id, { decision: "returned", expectedVersion: q.version, reason: "場所を直してください" });
    expect(back.plan.state).toBe("returned");
    const fixed = await plans.updatePlan(mgr(), q.id, { expectedVersion: q.version, reason: "場所を直した", title: "直した計画" });
    expect(fixed.record.state).toBe("returned_stale");
    expect(fixed.record.stateLabel).toBe("修正済み（再確認待ち）");
    // 再判定でも版が上がるため「前の版への確認」になる
    const r2 = await requestedPlan();
    await plans.confirmPlan(mgr(), r2.id, { decision: "approved", expectedVersion: r2.version });
    expect((await plans.rejudgePlan(mgr(), r2.id, {})).state).toBe("approved_stale");
  });

  it("10. self_confirmation は DB が決める：自分が保存した版・自分が操縦者の計画で true。送った値は無視される", async () => {
    // (1) 運航管理者が自分で依頼（版を保存）して、自分で確認 → true
    const own = await requestedPlan();
    const c1 = await plans.confirmPlan(mgr(), own.id, { decision: "approved", expectedVersion: own.version });
    expect(c1.confirmation.selfConfirmation).toBe(true);
    expect(c1.plan).toMatchObject({ state: "approved", selfConfirmation: true, stateLabel: "確認済み（自己確認）" });
    // (2) 別の運航管理者が確認 → false（併記なし）
    const other = await requestedPlan();
    const c2 = await plans.confirmPlan(ctxOf(manager2), other.id, { decision: "approved", expectedVersion: other.version });
    expect(c2.confirmation.selfConfirmation).toBe(false);
    expect(c2.plan.stateLabel).toBe("確認済み");
    // (3) 計画の操縦者が確認者に結び付いている → true（保存したのは別の運航管理者）
    const mine = await requestedPlan({}, pilotOfManager2.id);
    const c3 = await plans.confirmPlan(ctxOf(manager2), mine.id, { decision: "approved", expectedVersion: mine.version });
    expect(c3.confirmation.selfConfirmation).toBe(true);
    // (4) 直接追加で self_confirmation・confirmer_name・content_hash を偽っても DB が上書きする
    const forged = await requestedPlan();
    const row = (
      await owner.query(
        `insert into plan_confirmations (org_id, plan_id, plan_version, snapshot_id, decision, confirmer_member_id,
           confirmer_name, self_confirmation, created_at, content_hash)
         values ($1, $2, $3, $4, 'approved', $5, '偽の名前', true, '1999-01-01T00:00:00Z', 'fake')
         returning *`,
        [orgA, forged.id, forged.version, forged.currentSnapshotId, manager2.id],
      )
    ).rows[0];
    expect(row.self_confirmation).toBe(false);
    expect(row.confirmer_name).toBe("s12-mgr2");
    expect(row.content_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(new Date(row.created_at).getFullYear()).toBeGreaterThan(2000);
    // 運航管理者でない確認者は DB も拒む
    const p2 = await requestedPlan();
    await expect(
      owner.query(
        `insert into plan_confirmations (org_id, plan_id, plan_version, snapshot_id, decision, confirmer_member_id)
         values ($1, $2, $3, $4, 'approved', $5)`,
        [orgA, p2.id, p2.version, p2.currentSnapshotId, pilotMember.id],
      ),
    ).rejects.toMatchObject({ code: "SB409", detail: "not_manager" });
  });

  it("10. 操縦者・閲覧者の確認は 403（自分の計画でも）。確認は同じ組織の運航管理者だけ", async () => {
    const p = await requestedPlan({}, pilotA.id);
    for (const m of [pilotMember, viewer, unlinkedPilotMember]) {
      await expectOpsError(plans.confirmPlan(ctxOf(m), p.id, { decision: "approved", expectedVersion: p.version }), 403, "forbidden");
    }
    expect(await count("plan_confirmations", "plan_id = $1", [p.id])).toBe(0);
  });

  // ---- 認可：作成・訂正・中止・閲覧 ---------------------------------------

  it("認可：閲覧は全役割が全件。作成・訂正・再判定・確認依頼・中止は運航管理者は全員分、操縦者は自分が操縦者の計画だけ、閲覧者は不可", async () => {
    const own = await newPlan({}, { pilotId: pilotA.id });
    const others = await newPlan({}, { pilotId: pilotB.id });
    const pilotCtx = ctxOf(pilotMember);
    for (const m of [viewer, pilotMember, unlinkedPilotMember, manager]) {
      const c = ctxOf(m);
      expect((await plans.listPlans(c)).map((x) => x.id)).toEqual(expect.arrayContaining([own.id, others.id]));
      expect((await plans.getPlan(c, others.id)).id).toBe(others.id);
      expect((await plans.listSnapshots(c, others.id)).length).toBe(1);
      expect((await plans.getSnapshot(c, others.id, others.currentSnapshotId)).seq).toBe(1);
      expect((await plans.listPlanVersions(c, others.id)).length).toBe(1);
    }
    // 操縦者：自分の計画だけ
    const created = await plans.createPlan(pilotCtx, planInput(aircraftW, pilotA.id));
    expect(created.created).toBe(true);
    await expectOpsError(plans.createPlan(pilotCtx, planInput(aircraftW, pilotB.id)), 403, "forbidden");
    await expectOpsError(plans.updatePlan(pilotCtx, others.id, { expectedVersion: 1, reason: "x", title: "x" }), 403, "forbidden");
    await expectOpsError(plans.voidPlan(pilotCtx, others.id, { expectedVersion: 1, reason: "x" }), 403, "forbidden");
    await expectOpsError(plans.requestConfirmation(pilotCtx, others.id, {}), 403, "forbidden");
    await expectOpsError(plans.rejudgePlan(pilotCtx, others.id, {}), 403, "forbidden");
    // 自分の計画の訂正・確認依頼・再判定・中止はできる
    const upd = await plans.updatePlan(pilotCtx, own.id, { expectedVersion: 1, reason: "訂正", title: "自分の計画" });
    expect(upd.record.title).toBe("自分の計画");
    expect((await plans.requestConfirmation(pilotCtx, own.id, {})).status).toBe("active");
    expect((await plans.rejudgePlan(pilotCtx, own.id, {})).judgement.seq).toBe(2);
    expect((await plans.voidPlan(pilotCtx, own.id, { expectedVersion: 4, reason: "中止" })).voided).toBe(true);
    // 操縦者を他人に付け替える訂正は 403
    const mine = await newPlan({}, { pilotId: pilotA.id });
    await expectOpsError(plans.updatePlan(pilotCtx, mine.id, { expectedVersion: 1, reason: "付け替え", pilotId: pilotB.id }), 403, "forbidden");
    // 操縦者の行に結び付いていない操縦者役割・閲覧者は作れない
    await expectOpsError(plans.createPlan(ctxOf(unlinkedPilotMember), planInput(aircraftW, pilotB.id)), 403, "forbidden");
    await expectOpsError(plans.createPlan(ctxOf(viewer), planInput(aircraftW, pilotB.id)), 403, "forbidden");
    await expectOpsError(plans.updatePlan(ctxOf(viewer), mine.id, { expectedVersion: 1, reason: "x", title: "x" }), 403, "forbidden");
    await expectOpsError(plans.voidPlan(ctxOf(viewer), mine.id, { expectedVersion: 1, reason: "x" }), 403, "forbidden");
  });

  // ---- 通報の要否（計画の応答に含まれる） -----------------------------------

  it("通報の要否：夜間飛行は「通報：要」、特定飛行に当たらない計画は推奨、重量が未登録の機体は要確認（要として扱います）、DID の該当を確認できない地点は要", async () => {
    const night = await newPlan({ flags: ["method_night"] });
    expect(night.report.label).toBe("通報：要");
    expect(night.report.reasons).toContain("夜間飛行に当たるため");
    const none = await newPlan({ latitude: 35.0, longitude: 133.0 });
    expect(none.judgement.category).toBe("I");
    expect(none.report.label).toBe("通報：義務ではないが推奨");
    const noWeight = await newPlan({ flags: ["method_night"] }, { aircraftId: aircraftNoWeight });
    expect(noWeight.report.label).toBe("通報：要確認（要として扱います）");
    expect(noWeight.report.reasons).toEqual(["機体の重量が分からないため"]);
    expect(noWeight.droneWeightG).toBeNull();
    // 逆ジオコーダが市町村を返さない地点：DID の該当を確認できない（判定不能）
    const unknownMuni = (await plans.createPlan(mgr({ judge: judgeWith(undefined) }), planInput(aircraftW, pilotB.id, { latitude: 35.0, longitude: 133.0 }))).record;
    expect(unknownMuni.judgement.category).toBe("needs_verification");
    expect(unknownMuni.report.label).toBe("通報：要");
    expect(unknownMuni.report.reasons.join()).toContain("判定不能");
    expect(unknownMuni.judgement.verdictUnknownCount).toBeGreaterThan(0);
    // 目的の例外：表示は変えず、添え書きを出す
    const ex = await newPlan({ flags: ["method_night"], judgementPurpose: "public_duty" });
    expect(ex.report.label).toBe("通報：要");
    expect(ex.report.exceptionNote).toContain("例外に当たる可能性があります（※要確認）");
    // 禁止語はどの応答にも出ない
    for (const r of [night, none, noWeight, unknownMuni, ex]) {
      expect(JSON.stringify(r.report)).not.toMatch(/通報不要|通報は不要|通報の必要はありません|通報しなくて/);
    }
    // 一覧でも同じ
    const list = await plans.listPlans(mgr());
    expect(list.find((x) => x.id === noWeight.id)!.report.label).toBe("通報：要確認（要として扱います）");
  });

  it("確認の画面に出す、判定不能の件数と出典・確認日が古い項目（90 日超）", async () => {
    const p = await newPlan();
    expect(p.judgement.verdictUnknownCount).toBeGreaterThanOrEqual(0);
    // 時計を進めて 90 日超にする
    const later = mgr({ now: () => new Date("2027-12-31T00:00:00Z") });
    const d = await plans.getPlan(later, p.id);
    expect(d.staleSources.length).toBeGreaterThan(0);
    expect(d.staleSources.map((s) => s.id)).toContain("procedures");
    expect(d.staleSources.every((s) => s.ageDays === null || s.ageDays > 90)).toBe(true);
    const detail = await plans.getSnapshot(later, p.id, p.currentSnapshotId);
    expect(detail.staleSources.length).toBe(d.staleSources.length);
    expect(detail.result["evidenceId"]).toBe(p.judgement.diagnosisEvidenceId);
  });

  // ---- 契約 12：飛行記録との紐付け -----------------------------------------

  const flightInput = (aircraftId: string, pilotId: string, takeoffAt: string, landingAt: string, extra: Record<string, unknown> = {}) => ({
    aircraftId,
    pilotId,
    purpose: "空撮",
    takeoffPlace: "フューチャーテック株式会社 本社",
    landingPlace: "フューチャーテック株式会社 本社",
    takeoffAt,
    landingAt,
    safetyIssue: false,
    ...extra,
  });

  it("12. flightPlanId を付けると flight_plan_id と、計画の現在の snapshot_id（サーバーが決める）が保存される。リクエストの snapshotId は無視", async () => {
    const ac = await newAircraft(0.9);
    const p = await newPlan({ flags: ["method_night"] }, { aircraftId: ac, pilotId: pilotB.id });
    const other = await newPlan({}, { aircraftId: ac, pilotId: pilotB.id });
    const f = await rec.createFlight(
      mgr(),
      flightInput(ac, pilotB.id, "2026-12-10T09:00", "2026-12-10T09:30", { flightPlanId: p.id, snapshotId: other.currentSnapshotId }),
    );
    expect(f.record).toMatchObject({ flightPlanId: p.id, snapshotId: p.currentSnapshotId, judgementLink: "linked" });
    const head = (await owner.query("select flight_plan_id, snapshot_id from flight_records where id = $1", [f.record.id])).rows[0];
    expect(head).toEqual({ flight_plan_id: p.id, snapshot_id: p.currentSnapshotId });
    // 計画を再判定した後に作る記録は、新しい現在のスナップショットに結ばれる
    const re = await plans.rejudgePlan(mgr(), p.id, {});
    const f2 = await rec.createFlight(mgr(), flightInput(ac, pilotB.id, "2026-12-10T10:00", "2026-12-10T10:30", { flightPlanId: p.id }));
    expect(f2.record.snapshotId).toBe(re.currentSnapshotId);
    expect(f2.record.snapshotId).not.toBe(f.record.snapshotId);
    // 計画の詳細に、結びついた飛行記録が並ぶ
    expect((await plans.getPlan(mgr(), p.id)).flights.map((x) => x.id).sort()).toEqual([f.record.id, f2.record.id].sort());
    expect(await verifyChain("flight_record", f.record.id)).toEqual([]);
  });

  it("12. 他の組織の計画は 404、不正な ID は 400。DB の外部キーが、別の計画のスナップショットを結ぶことを拒む", async () => {
    const ac = await newAircraft(0.9);
    const b = await plans.createPlan(ctxOf(managerB), planInput(aircraftOrgB, pilotOrgB.id));
    await expectOpsError(
      rec.createFlight(mgr(), flightInput(ac, pilotB.id, "2026-12-11T11:00", "2026-12-11T11:10", { flightPlanId: b.record.id })),
      404,
    );
    await expectOpsError(
      rec.createFlight(mgr(), flightInput(ac, pilotB.id, "2026-12-11T11:00", "2026-12-11T11:10", { flightPlanId: "x" })),
      400,
      "invalid_input",
    );
    const p1 = await newPlan({}, { aircraftId: ac });
    const p2 = await newPlan({}, { aircraftId: ac });
    let hour = 0;
    const insertFlight = (data: Record<string, unknown>) =>
      owner.query(
        `insert into record_versions (org_id, entity_type, entity_id, op, data, actor_kind, actor_member_id)
         values ($1, 'flight_record', $2, 'create', $3::jsonb, 'member', $4)`,
        [
          orgA,
          randomUUID(),
          JSON.stringify({
            aircraft_id: ac,
            pilot_id: pilotB.id,
            purpose: "試験",
            takeoff_place: "x",
            landing_place: "x",
            takeoff_at: `2026-12-11T0${++hour}:00`,
            landing_at: `2026-12-11T0${hour}:10`,
            safety_issue: false,
            pilot_name: "操縦 二郎",
            pilot_version: 1,
            ...data,
          }),
          manager.id,
        ],
      );
    // 別の計画のスナップショットは結べない
    await expect(insertFlight({ flight_plan_id: p1.id, snapshot_id: p2.currentSnapshotId })).rejects.toMatchObject({ code: "23503" });
    // 他の組織の計画は結べない
    await expect(insertFlight({ flight_plan_id: b.record.id, snapshot_id: b.record.currentSnapshotId })).rejects.toMatchObject({ code: "23503" });
    // 計画なしでスナップショットだけは結べない
    await expect(insertFlight({ flight_plan_id: null, snapshot_id: p1.currentSnapshotId })).rejects.toMatchObject({ code: "23514" });
    // 正しい組合せと、どちらも NULL は結べる
    await insertFlight({ flight_plan_id: p1.id, snapshot_id: p1.currentSnapshotId });
    await insertFlight({ flight_plan_id: p1.id, snapshot_id: null });
    await insertFlight({ flight_plan_id: null, snapshot_id: null });
  });

  it("12. 訂正で flight_plan_id を付け替え・解除できず、NULL のときだけ設定できる", async () => {
    const ac = await newAircraft(0.9);
    const p1 = await newPlan({}, { aircraftId: ac });
    const p2 = await newPlan({}, { aircraftId: ac });
    const f = (await rec.createFlight(mgr(), flightInput(ac, pilotB.id, "2026-12-12T12:00", "2026-12-12T12:20", { specificFlightTypes: ["night"] }))).record;
    expect(f.flightPlanId).toBeNull();
    expect(f.judgementLink).toBe("missing");
    // 後入力の紐付け（NULL のとき）
    const linked = (await rec.updateFlight(mgr(), f.id, { expectedVersion: 1, reason: "計画との紐付け", flightPlanId: p1.id })).record;
    expect(linked).toMatchObject({ flightPlanId: p1.id, snapshotId: p1.currentSnapshotId, judgementLink: "linked" });
    // 付け替え・解除はできない
    const swap = await expectOpsError(rec.updateFlight(mgr(), f.id, { expectedVersion: 2, reason: "付け替え", flightPlanId: p2.id }), 400, "invalid_input");
    expect(swap.fieldCodes).toMatchObject({ flightPlanId: "plan_immutable" });
    await expectOpsError(rec.updateFlight(mgr(), f.id, { expectedVersion: 2, reason: "解除", flightPlanId: null }), 400, "invalid_input");
    // 指定しない訂正・同じ計画の指定では保たれる
    expect((await rec.updateFlight(mgr(), f.id, { expectedVersion: 2, reason: "目的の訂正", purpose: "点検" })).record.flightPlanId).toBe(p1.id);
    expect((await rec.updateFlight(mgr(), f.id, { expectedVersion: 3, reason: "同じ指定", flightPlanId: p1.id })).record.flightPlanId).toBe(p1.id);
    // 付け替えの snapshotId はサーバーが決める。リクエストの snapshotId は読まない
    expect((await rec.updateFlight(mgr(), f.id, { expectedVersion: 4, reason: "偽の指定", snapshotId: p2.currentSnapshotId })).record.snapshotId).toBe(
      p1.currentSnapshotId,
    );
    // 取消した計画には後から紐付けられない
    const g = (await rec.createFlight(mgr(), flightInput(ac, pilotB.id, "2026-12-12T13:00", "2026-12-12T13:20"))).record;
    await plans.voidPlan(mgr(), p2.id, { expectedVersion: p2.version, reason: "中止" });
    await expectOpsError(rec.updateFlight(mgr(), g.id, { expectedVersion: 1, reason: "紐付け", flightPlanId: p2.id }), 409, "plan_cancelled");
    expect(await verifyChain("flight_record", f.id)).toEqual([]);
  });

  it("12. 計画と違う機体・操縦者・時間帯のときは保存して differs_from_plan を返す。同じならない。計画なしの記録も従来どおり作れる", async () => {
    const ac = await newAircraft(0.9);
    const ac2 = await newAircraft(0.9);
    const p = await newPlan({ plannedStartAt: "2026-12-13T09:00", durationMinutes: 60 }, { aircraftId: ac, pilotId: pilotB.id });
    const same = await rec.createFlight(mgr(), flightInput(ac, pilotB.id, "2026-12-13T09:10", "2026-12-13T09:50", { flightPlanId: p.id }));
    expect(same.warnings).not.toContain("differs_from_plan");
    const otherAircraft = await rec.createFlight(mgr(), flightInput(ac2, pilotB.id, "2026-12-13T09:55", "2026-12-13T09:58", { flightPlanId: p.id }));
    expect(otherAircraft.created).toBe(true);
    expect(otherAircraft.warnings).toContain("differs_from_plan");
    const otherPilot = await rec.createFlight(mgr(), flightInput(ac, pilotA.id, "2026-12-13T10:00", "2026-12-13T10:00", { flightPlanId: p.id }));
    expect(otherPilot.warnings).toContain("differs_from_plan");
    const otherTime = await rec.createFlight(mgr(), flightInput(ac, pilotB.id, "2026-12-13T13:00", "2026-12-13T13:20", { flightPlanId: p.id }));
    expect(otherTime.warnings).toContain("differs_from_plan");
    expect(otherTime.record.flightPlanId).toBe(p.id);
    // 訂正でも警告が出る
    const upd = await rec.updateFlight(mgr(), same.record.id, { expectedVersion: 1, reason: "離陸時刻", takeoffAt: "2026-12-13T08:30" });
    expect(upd.warnings).toContain("differs_from_plan");
    // 計画なしの記録は従来どおり。特定飛行の形態があれば missing、なければ not_required
    const none = await rec.createFlight(mgr(), flightInput(ac, pilotB.id, "2026-12-13T15:00", "2026-12-13T15:10"));
    expect(none.record).toMatchObject({ flightPlanId: null, snapshotId: null, judgementLink: "not_required" });
    expect(none.warnings).not.toContain("differs_from_plan");
    const missing = await rec.createFlight(mgr(), flightInput(ac, pilotB.id, "2026-12-13T16:00", "2026-12-13T16:10", { specificFlightTypes: ["night"] }));
    expect(missing.record.judgementLink).toBe("missing");
    expect((await rec.listFlights(mgr())).find((x) => x.id === missing.record.id)!.judgementLink).toBe("missing");
    expect(rec.JUDGEMENT_LINK_MISSING_LABEL).toBe("判定の根拠が紐づいていません");
  });

  // ---- 契約 17：よく使う地点 -----------------------------------------------

  it("17. 運航管理者が地点を登録・訂正・取消でき（版の履歴）、全役割が一覧を見られる。操縦者・閲覧者の登録は 403、他の組織の地点は 404", async () => {
    const hq = await places.createPlace(mgr(), {
      name: "フューチャーテック株式会社 本社",
      addressText: "鳥取県西伯郡日吉津村日吉津45番地3",
      latitude: 35.434238,
      longitude: 133.380508,
    });
    expect(hq).toMatchObject({ name: "フューチャーテック株式会社 本社", latitude: 35.434238, longitude: 133.380508, version: 1, voided: false });
    expect(hq.addressText).toBe("鳥取県西伯郡日吉津村日吉津45番地3");
    for (const m of [manager, pilotMember, viewer, unlinkedPilotMember]) {
      expect((await places.listPlaces(ctxOf(m))).map((p) => p.id)).toContain(hq.id);
      expect((await places.getPlace(ctxOf(m), hq.id)).name).toBe(hq.name);
    }
    for (const m of [pilotMember, viewer]) {
      await expectOpsError(places.createPlace(ctxOf(m), { name: "x", latitude: 35, longitude: 133 }), 403, "forbidden");
      await expectOpsError(places.updatePlace(ctxOf(m), hq.id, { expectedVersion: 1, reason: "x", note: "x" }), 403, "forbidden");
      await expectOpsError(places.voidPlace(ctxOf(m), hq.id, { expectedVersion: 1, reason: "x" }), 403, "forbidden");
    }
    await expectOpsError(places.getPlace(ctxOf(managerB), hq.id), 404);
    await expectOpsError(places.updatePlace(ctxOf(managerB), hq.id, { expectedVersion: 1, reason: "x", note: "x" }), 404);
    await expectOpsError(places.voidPlace(ctxOf(managerB), hq.id, { expectedVersion: 1, reason: "x" }), 404);
    await expectOpsError(places.listPlaceVersions(ctxOf(managerB), hq.id), 404);
    expect((await places.listPlaces(ctxOf(managerB))).map((p) => p.id)).not.toContain(hq.id);
    // 訂正（版 2）・名称の重複・取消
    const upd = await places.updatePlace(mgr(), hq.id, { expectedVersion: 1, reason: "メモの追記", note: "正面玄関" });
    expect(upd).toMatchObject({ version: 2, note: "正面玄関", name: hq.name });
    await expectOpsError(places.createPlace(mgr(), { name: hq.name, latitude: 35, longitude: 133 }), 409, "duplicate_name");
    await expectOpsError(places.updatePlace(mgr(), hq.id, { expectedVersion: 1, reason: "古い版", note: "x" }), 409, "version_conflict");
    const gone = await places.voidPlace(mgr(), hq.id, { expectedVersion: 2, reason: "移転" });
    expect(gone).toMatchObject({ voided: true, version: 3 });
    expect((await places.listPlaces(mgr())).map((p) => p.id)).not.toContain(hq.id);
    expect((await places.listPlaces(mgr(), true)).map((p) => p.id)).toContain(hq.id);
    await expectOpsError(places.updatePlace(mgr(), hq.id, { expectedVersion: 3, reason: "x", note: "x" }), 409, "voided");
    // 取消した後は同じ名称で登録できる
    const again = await places.createPlace(mgr(), { name: hq.name, latitude: 35.434238, longitude: 133.380508 });
    expect(again.id).not.toBe(hq.id);
    expect((await places.listPlaceVersions(mgr(), hq.id)).map((v) => [v.versionNo, v.op])).toEqual([
      [1, "create"],
      [2, "update"],
      [3, "void"],
    ]);
    expect(await verifyChain("saved_place", hq.id)).toEqual([]);
    // 入力の検査
    const bad = await expectOpsError(places.createPlace(mgr(), { latitude: 91, longitude: 133 }), 400, "invalid_input");
    expect(bad.fieldCodes).toMatchObject({ name: "required", latitude: "coordinate_range" });
  });

  it("17. 計画のフォームで地点を選ぶと名称と座標が計画に写り、saved_place_id が残る。他の組織の地点・取消した地点は選べない", async () => {
    const place = await places.createPlace(mgr(), { name: `拠点 ${seq++}`, latitude: 35.434238, longitude: 133.380508 });
    const p = await newPlan({ savedPlaceId: place.id, placeName: place.name });
    expect(p).toMatchObject({ savedPlaceId: place.id, placeName: place.name, latitude: 35.434238, longitude: 133.380508 });
    expect(await verifyChain("flight_plan", p.id)).toEqual([]);
    const foreign = await places.createPlace(ctxOf(managerB), { name: "組織Bの拠点", latitude: 35, longitude: 133 });
    await expectOpsError(plans.createPlan(mgr(), planInput(aircraftW, pilotB.id, { savedPlaceId: foreign.id })), 404);
    await places.voidPlace(mgr(), place.id, { expectedVersion: 1, reason: "移転" });
    const e = await expectOpsError(plans.createPlan(mgr(), planInput(aircraftW, pilotB.id, { savedPlaceId: place.id })), 400, "invalid_input");
    expect(e.fieldCodes).toMatchObject({ savedPlaceId: "place_voided" });
    // 取消した地点を選んだままの既存の計画の訂正は、地点を変えなければ通る
    const u = await plans.updatePlan(mgr(), p.id, { expectedVersion: p.version, reason: "計画名", title: "地点が取消された後の訂正" });
    expect(u.record.savedPlaceId).toBe(place.id);
  });

  // ---- 確認依頼・状態 -----------------------------------------------------

  it("確認を依頼する（下書き → 依頼済み）は計画の訂正の版（理由「確認を依頼」）として残り、二重の依頼は 409", async () => {
    const p = await newPlan();
    const r = await plans.requestConfirmation(mgr(), p.id, { expectedVersion: p.version });
    expect(r).toMatchObject({ status: "active", state: "pending", stateLabel: "確認待ち", version: p.version + 1 });
    const versions = await plans.listPlanVersions(mgr(), p.id);
    expect(versions[1]).toMatchObject({ op: "update", reason: "確認を依頼" });
    expect(versions[1]!.changedFields).toContain("状態");
    await expectOpsError(plans.requestConfirmation(mgr(), p.id, {}), 409, "already_requested");
    await expectOpsError(plans.requestConfirmation(mgr(), (await newPlan()).id, { expectedVersion: 99 }), 409, "version_conflict");
    expect(await verifyChain("flight_plan", p.id)).toEqual([]);
    // 一覧の状態での絞り込み（確認待ち）
    const pending = await plans.listPlans(mgr(), { state: "pending" });
    expect(pending.map((x) => x.id)).toContain(p.id);
    expect(pending.every((x) => x.state === "pending")).toBe(true);
    expect(plans.parsePlanFilter(new URLSearchParams("status=pending")).state).toBe("pending");
    expect(() => plans.parsePlanFilter(new URLSearchParams("status=nope"))).toThrow(OpsError);
  });

  it("計画・スナップショットの個人情報：技能証明書番号・操縦者の氏名・メールアドレスを保存しない（ID だけ）", async () => {
    const p = await newPlan({ flags: ["method_night"] }, { pilotId: pilotA.id });
    const rows = await owner.query(
      `select to_jsonb(p)::text as plan, (select string_agg(v.data::text, ' ') from record_versions v where v.entity_id = p.id) as versions,
              (select string_agg(to_jsonb(s)::text, ' ') from judgement_snapshots s where s.plan_id = p.id) as snaps
         from flight_plans p where p.id = $1`,
      [p.id],
    );
    const all = `${rows.rows[0].plan} ${rows.rows[0].versions} ${rows.rows[0].snaps}`;
    expect(all).not.toContain("TEST-12345678");
    expect(all).not.toContain("操縦 一郎");
    expect(all).not.toContain("@example.test");
    expect(p.pilotName).toBe("操縦 一郎");
  });

  it("ENGINE_VERSION が変わっていない", () => {
    expect(ENGINE_VERSION).toBe("soraban-0.4.0-verdict-2026-10");
  });
});
