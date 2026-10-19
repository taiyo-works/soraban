// Sprint 10 契約 9〜13・15（DB 部分）の DB テスト（pnpm test:db）。
// 使い捨てのデータベースにマイグレーションを適用し、アプリ用ロール soraban_app に切り替えた接続でサービス層を動かす。
import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { MemberRow } from "@soraban/db";
import { createTempDatabase, runCli, withClient, type TempDatabase } from "../../../../../packages/db/src/test-db-helpers";
import { resolveTestDatabaseUrl } from "../../../../../packages/db/src/test-db-env";
import * as svc from "./service";
import { OpsError, type OpsContext } from "./service";
import type { OpsDb } from "./store";

const ADMIN_URL = resolveTestDatabaseUrl();

describe.skipIf(!ADMIN_URL)("運航管理の DB（版の履歴・権限・組織）", () => {
  let db: TempDatabase;
  let createdRole = false;
  let owner: pg.Pool;
  let app: pg.Pool;
  let orgA: string;
  let orgB: string;
  let managerA: MemberRow;
  let managerB: MemberRow;

  /** オーナーロールで利用者を直接作る（active・結び付け済み）。 */
  const addMember = async (orgId: string, role: MemberRow["role"], label: string): Promise<MemberRow> => {
    const id = randomUUID();
    await owner.query(
      `insert into record_versions (org_id, entity_type, entity_id, op, data, actor_kind)
       values ($1, 'member', $2, 'create', $3::jsonb, 'system')`,
      [
        orgId,
        id,
        JSON.stringify({
          email: `${label}@example.test`,
          display_name: label,
          role,
          status: "active",
          auth_provider: "test",
          auth_user_id: label,
        }),
      ],
    );
    return (await owner.query<MemberRow>("select * from members where id = $1", [id])).rows[0]!;
  };

  const ctxOf = (member: MemberRow): OpsContext => ({ db: app as unknown as OpsDb, member });
  const reload = async (m: MemberRow): Promise<MemberRow> =>
    (await owner.query<MemberRow>("select * from members where id = $1", [m.id])).rows[0]!;
  const versionCount = async (entityId: string): Promise<number> =>
    Number((await owner.query("select count(*)::int as n from record_versions where entity_id = $1", [entityId])).rows[0].n);
  const expectOpsError = async (p: Promise<unknown>, status: number, code?: string) => {
    const e = await p.then(
      () => null,
      (x: unknown) => x,
    );
    expect(e, "OpsError が投げられていない").toBeInstanceOf(OpsError);
    expect((e as OpsError).status).toBe(status);
    if (code) expect((e as OpsError).code).toBe(code);
  };

  const AIRCRAFT = {
    modelName: "Matrice 350 RTK",
    manufacturer: "DJI",
    serialNumber: "SN-1",
    typeCertified: false,
    initialFlightMinutes: 0,
  };

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
    // アプリ用ロールに切り替えた接続（接続開始時に role を設定する）
    app = new pg.Pool({ connectionString: db.url, max: 4, options: "-c role=soraban_app" });
    expect((await app.query("select current_user as u")).rows[0].u).toBe("soraban_app");
    orgA = (await owner.query("insert into organizations (name) values ('組織A') returning id")).rows[0].id;
    orgB = (await owner.query("insert into organizations (name) values ('組織B') returning id")).rows[0].id;
    managerA = await addMember(orgA, "manager", "mgr-a");
    managerB = await addMember(orgB, "manager", "mgr-b");
  });

  afterAll(async () => {
    await app?.end();
    await owner?.end();
    await db?.drop();
    if (createdRole) await withClient(ADMIN_URL!, (c) => c.query("drop role if exists soraban_app"));
  });

  it("10. 機体を登録して 2 回訂正すると版 1・2・3 の連番、prev_hash が直前の content_hash と一致、ヘッド表が版 3 と一致", async () => {
    const ctx = ctxOf(managerA);
    const a = await svc.createAircraft(ctx, { ...AIRCRAFT, registrationMark: "JU10AAA" });
    await svc.updateAircraft(ctx, a.id, { expectedVersion: 1, reason: "型式名の誤記", modelName: "M350" });
    const a3 = await svc.updateAircraft(ctx, a.id, { expectedVersion: 2, reason: "製造番号の誤記", serialNumber: "SN-2" });
    expect(a3.version).toBe(3);
    const vs = (
      await owner.query("select * from record_versions where entity_type = 'aircraft' and entity_id = $1 order by version_no", [a.id])
    ).rows;
    expect(vs.map((v) => v.version_no)).toEqual([1, 2, 3]);
    expect(vs[0].prev_hash).toBe("");
    expect(vs[1].prev_hash).toBe(vs[0].content_hash);
    expect(vs[2].prev_hash).toBe(vs[1].content_hash);
    for (const v of vs) expect(v.content_hash).toMatch(/^[0-9a-f]{64}$/);
    const head = (await owner.query("select * from aircraft where id = $1", [a.id])).rows[0];
    expect(head).toMatchObject({ model_name: "M350", serial_number: "SN-2", current_version: 3, registration_mark: "JU10AAA" });
    expect(vs[2].data).toMatchObject({ model_name: "M350", serial_number: "SN-2" });
    expect(head.model_name).toBe(vs[2].data.model_name);

    // アプリが送った version_no・prev_hash・content_hash は無視される
    await withClient(db.url, async (c) => {
      await c.query("set role soraban_app");
      await c.query(
        `insert into record_versions (org_id, entity_type, entity_id, op, data, reason, actor_kind, actor_member_id,
                                      version_no, prev_hash, content_hash, created_at)
         values ($1, 'aircraft', $2, 'update', $3::jsonb, '試験', 'member', $4, 99, 'forged', 'forged', '2000-01-01')`,
        [orgA, a.id, JSON.stringify(vs[2].data), managerA.id],
      );
    });
    const v4 = (
      await owner.query("select * from record_versions where entity_id = $1 and version_no = 4", [a.id])
    ).rows[0];
    expect(v4).toBeDefined();
    expect(v4.prev_hash).toBe(vs[2].content_hash);
    expect(v4.content_hash).not.toBe("forged");
    expect(new Date(v4.created_at).getUTCFullYear()).toBeGreaterThan(2000);
    expect((await owner.query("select count(*)::int as n from record_versions where entity_id = $1 and version_no = 99", [a.id])).rows[0].n).toBe(0);
  });

  it("11. soraban_app：record_versions の更新・削除・TRUNCATE、ヘッド表と organizations の追加・更新・削除は権限エラー。追加と参照はできる", async () => {
    await withClient(db.url, async (c) => {
      await c.query("set role soraban_app");
      const denied = async (sql: string, params: unknown[] = []) =>
        expect(c.query(sql, params), sql).rejects.toMatchObject({ code: "42501" });
      await denied("update record_versions set reason = 'x'");
      await denied("delete from record_versions");
      await denied("truncate record_versions");
      for (const t of ["members", "aircraft", "pilots", "organizations"]) {
        await denied(`update ${t} set id = id`);
        await denied(`delete from ${t}`);
        await denied(`truncate ${t}`);
      }
      await denied("insert into organizations (name) values ('x')");
      await denied(
        "insert into members (id, org_id, email, display_name, role, status, current_version, created_at, updated_at) values ($1, $2, 'a@b.c', 'a', 'viewer', 'invited', 1, now(), now())",
        [randomUUID(), orgA],
      );
      await denied(
        "insert into aircraft (id, org_id, registration_mark, model_name, manufacturer, serial_number, type_certified, status, current_version, created_at, updated_at) values ($1, $2, 'JU1', 'm', 'm', 's', false, 'active', 1, now(), now())",
        [randomUUID(), orgA],
      );
      await denied(
        "insert into pilots (id, org_id, full_name, has_license, current_version, created_at, updated_at) values ($1, $2, 'p', false, 1, now(), now())",
        [randomUUID(), orgA],
      );
      // 参照はできる
      for (const t of ["record_versions", "members", "aircraft", "pilots", "organizations"]) {
        await c.query(`select count(*) from ${t}`);
      }
      // 追加はできる（ヘッド表は DB が作る）
      const id = randomUUID();
      await c.query(
        `insert into record_versions (org_id, entity_type, entity_id, op, data, actor_kind, actor_member_id)
         values ($1, 'pilot', $2, 'create', '{"full_name":"権限試験","has_license":false}'::jsonb, 'member', $3)`,
        [orgA, id, managerA.id],
      );
      expect((await c.query("select full_name from pilots where id = $1", [id])).rows[0].full_name).toBe("権限試験");
      // 最初の運航管理者を作る関数は実行できない
      await denied("select ops_bootstrap('x', 'a@b.c', 'a')");
    });
  });

  it("12. 同じ expectedVersion で 2 つの訂正を同時に送ると一方が成功・他方が 409。連番に欠け・重複がなく、同じ prev_hash の版が 2 つできない", async () => {
    const ctx = ctxOf(managerA);
    const a = await svc.createAircraft(ctx, { ...AIRCRAFT, registrationMark: "JU12RACE" });
    const results = await Promise.allSettled([
      svc.updateAircraft(ctx, a.id, { expectedVersion: 1, reason: "訂正A", modelName: "A" }),
      svc.updateAircraft(ctx, a.id, { expectedVersion: 1, reason: "訂正B", modelName: "B" }),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const ng = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(ok).toHaveLength(1);
    expect(ng).toHaveLength(1);
    expect(ng[0]!.reason).toBeInstanceOf(OpsError);
    expect((ng[0]!.reason as OpsError).status).toBe(409);
    expect((ng[0]!.reason as OpsError).code).toBe("version_conflict");
    const vs = (await owner.query("select version_no, prev_hash from record_versions where entity_id = $1 order by version_no", [a.id])).rows;
    expect(vs.map((v) => v.version_no)).toEqual([1, 2]);
    expect(new Set(vs.map((v) => v.prev_hash)).size).toBe(vs.length);
    expect(await svc.getAircraft(ctx, a.id)).toMatchObject({ version: 2 });
  });

  it("13. オーナーロールで版 2 の data を書き換えると verify_record_chain が版 2 を返す。改変のない実体では何も返さない", async () => {
    const ctx = ctxOf(managerA);
    const a = await svc.createAircraft(ctx, { ...AIRCRAFT, registrationMark: "JU13TAMPER" });
    await svc.updateAircraft(ctx, a.id, { expectedVersion: 1, reason: "訂正", modelName: "X" });
    await svc.updateAircraft(ctx, a.id, { expectedVersion: 2, reason: "訂正", modelName: "Y" });
    const b = await svc.createAircraft(ctx, { ...AIRCRAFT, registrationMark: "JU13CLEAN" });
    await svc.updateAircraft(ctx, b.id, { expectedVersion: 1, reason: "訂正", modelName: "Z" });
    const verify = async (id: string) =>
      (await owner.query("select * from verify_record_chain('aircraft', $1)", [id])).rows as { version_no: number; problem: string }[];
    expect(await verify(a.id)).toEqual([]);
    expect(await verify(b.id)).toEqual([]);
    await owner.query(
      `update record_versions set data = data || '{"model_name":"改ざん"}'::jsonb where entity_id = $1 and version_no = 2`,
      [a.id],
    );
    expect(await verify(a.id)).toEqual([{ version_no: 2, problem: "content_hash_mismatch" }]);
    expect(await verify(b.id)).toEqual([]);
  });

  it("9. 組織の最後の有効な運航管理者の降格・停止は 409 で、版が増えない", async () => {
    const before = await versionCount(managerB.id);
    const ctx = ctxOf(await reload(managerB));
    await expectOpsError(
      svc.updateMember(ctx, managerB.id, { expectedVersion: managerB.current_version, reason: "降格", role: "viewer" }),
      409,
      "last_manager",
    );
    await expectOpsError(
      svc.updateMember(ctx, managerB.id, { expectedVersion: managerB.current_version, reason: "停止", status: "disabled" }),
      409,
      "last_manager",
    );
    expect(await versionCount(managerB.id)).toBe(before);
    expect(await reload(managerB)).toMatchObject({ role: "manager", status: "active" });

    // 2 人目の運航管理者がいれば降格できる
    const second = await addMember(orgB, "manager", "mgr-b2");
    const updated = await svc.updateMember(ctx, second.id, { expectedVersion: second.current_version, reason: "異動", role: "pilot" });
    expect(updated.role).toBe("pilot");
  });

  it("9. 組織 A の利用者が組織 B の機体の ID を指定すると 404", async () => {
    const b = await svc.createAircraft(ctxOf(managerB), { ...AIRCRAFT, registrationMark: "JU9ORGB" });
    const ctxA = ctxOf(managerA);
    await expectOpsError(svc.getAircraft(ctxA, b.id), 404, "not_found");
    await expectOpsError(svc.updateAircraft(ctxA, b.id, { expectedVersion: 1, reason: "x", modelName: "x" }), 404);
    await expectOpsError(svc.voidAircraft(ctxA, b.id, { expectedVersion: 1, reason: "x" }), 404);
    await expectOpsError(svc.listAircraftVersions(ctxA, b.id), 404);
    // 版の表に直接、他の組織の実体への版を追加しても失敗する（SB404）
    await expect(
      app.query(
        `insert into record_versions (org_id, entity_type, entity_id, op, data, reason, actor_kind, actor_member_id)
         values ($1, 'aircraft', $2, 'void', '{}'::jsonb, 'x', 'member', $3)`,
        [orgA, b.id, managerA.id],
      ),
    ).rejects.toMatchObject({ code: "SB404" });
    expect((await svc.getAircraft(ctxOf(managerB), b.id)).voided).toBe(false);
  });

  it("15. 同じ組織で取消していない機体と同じ登録記号は 409、取消済みの機体と同じなら登録できる。他の組織なら同じ記号を登録できる", async () => {
    const ctx = ctxOf(managerA);
    const a = await svc.createAircraft(ctx, { ...AIRCRAFT, registrationMark: "JU15DUP" });
    await expectOpsError(svc.createAircraft(ctx, { ...AIRCRAFT, registrationMark: "ju15dup" }), 409, "duplicate_registration");
    await svc.voidAircraft(ctx, a.id, { expectedVersion: 1, reason: "誤登録" });
    const again = await svc.createAircraft(ctx, { ...AIRCRAFT, registrationMark: "JU15DUP" });
    expect(again.registrationMark).toBe("JU15DUP");
    expect(again.id).not.toBe(a.id);
    // 取消済みの機体は既定の一覧に出ず、取消済みを含めると出る
    expect((await svc.listAircraft(ctx)).map((x) => x.id)).not.toContain(a.id);
    expect((await svc.listAircraft(ctx, true)).map((x) => x.id)).toContain(a.id);
    // 他の組織
    expect((await svc.createAircraft(ctxOf(managerB), { ...AIRCRAFT, registrationMark: "JU15DUP" })).registrationMark).toBe("JU15DUP");
  });

  it("ops_bootstrap：組織と招待中の運航管理者を作り、運航管理者がいる組織では何もしない", async () => {
    const org = (await owner.query("select ops_bootstrap('フューチャーテック株式会社', ' Boss@Example.COM ', '奥田') as id")).rows[0].id;
    const ms = (await owner.query<MemberRow>("select * from members where org_id = $1", [org])).rows;
    expect(ms).toHaveLength(1);
    expect(ms[0]).toMatchObject({ email: "boss@example.com", role: "manager", status: "invited", auth_user_id: null });
    const again = (await owner.query("select ops_bootstrap('フューチャーテック株式会社', 'other@example.com', '他') as id")).rows[0].id;
    expect(again).toBe(org);
    expect((await owner.query("select count(*)::int as n from members where org_id = $1", [org])).rows[0].n).toBe(1);

    // 招待中の運航管理者は、確認済みのメールアドレスで初回ログインすると結び付く（版が 1 つ増える）
    const r = await svc.resolveMember(app as unknown as OpsDb, {
      provider: "test",
      authUserId: "boss-auth",
      email: "boss@example.com",
      emailVerified: true,
      name: "奥田",
    });
    expect(r.kind).toBe("member");
    expect(await versionCount(ms[0]!.id)).toBe(2);
    const v2 = (await owner.query("select * from record_versions where entity_id = $1 and version_no = 2", [ms[0]!.id])).rows[0];
    expect(v2).toMatchObject({ actor_kind: "system", actor_member_id: null, op: "update" });
  });
});
