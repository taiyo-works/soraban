// Sprint 11 契約 3・6・8〜13（DB）の DB テスト（pnpm test:db）。
// 使い捨てのデータベースにマイグレーションを適用し、アプリ用ロール soraban_app に切り替えた接続でサービス層を動かす。
import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { MemberRow, PilotRow } from "@soraban/db";
import { flightMinutesFromInput, parseJstMinute } from "@/lib/ops-time";
import { INSPECTION_ITEMS } from "@/lib/ops-records";
import { createTempDatabase, runCli, withClient, type TempDatabase } from "../../../../../packages/db/src/test-db-helpers";
import { resolveTestDatabaseUrl } from "../../../../../packages/db/src/test-db-env";
import * as rec from "./records";
import * as svc from "./service";
import { OpsError, type OpsContext } from "./service";
import type { OpsDb } from "./store";

const ADMIN_URL = resolveTestDatabaseUrl();
/** サーバーの現在時刻（JST 2027-01-05 12:00）。 */
const NOW = new Date("2027-01-05T03:00:00Z");

describe.skipIf(!ADMIN_URL)("飛行記録・日常点検記録の DB（時刻・総飛行時間・版・権限）", () => {
  let db: TempDatabase;
  let createdRole = false;
  let owner: pg.Pool;
  let app: pg.Pool;
  let orgA: string;
  let orgB: string;
  let manager: MemberRow;
  let pilotMember: MemberRow;
  let pilotA: PilotRow;
  let pilotB: PilotRow;
  let pilotOrgB: PilotRow;
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
  const addPilot = async (orgId: string, fullName: string, license: string | null, memberId: string | null): Promise<PilotRow> => {
    const id = await addVersion(orgId, "pilot", {
      full_name: fullName,
      has_license: license !== null,
      license_class: license !== null ? "second" : null,
      license_number: license,
      license_expires_on: null,
      member_id: memberId,
    });
    return (await owner.query<PilotRow>("select * from pilots where id = $1", [id])).rows[0]!;
  };
  const ctxOf = (member: MemberRow): OpsContext => ({ db: app as unknown as OpsDb, member, now: () => NOW });
  const mgr = () => ctxOf(manager);
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
    return e as OpsError;
  };
  const newAircraft = async (initialFlightMinutes: number, orgCtx: OpsContext = mgr()) =>
    svc.createAircraft(orgCtx, {
      registrationMark: `JU11T${(seq++).toString().padStart(4, "0")}`,
      modelName: "Matrice 350 RTK",
      manufacturer: "DJI",
      serialNumber: `SN-${seq}`,
      typeCertified: false,
      initialFlightMinutes,
    });
  const flightInput = (aircraftId: string, pilotId: string, takeoffAt: string, landingAt: string, extra: object = {}) => ({
    aircraftId,
    pilotId,
    purpose: "空撮",
    takeoffPlace: "米子市日吉津 本社",
    landingPlace: "米子市日吉津 本社",
    takeoffAt,
    landingAt,
    safetyIssue: false,
    ...extra,
  });
  const totals = async (ids: readonly string[]) =>
    Promise.all(ids.map(async (id) => (await rec.getFlight(mgr(), id)).totalFlightMinutes));
  const verify = async (type: string, id: string) =>
    (await owner.query("select * from verify_record_chain($1, $2)", [type, id])).rows as { version_no: number; problem: string }[];

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
    manager = await addMember(orgA, "manager", "s11-mgr");
    pilotMember = await addMember(orgA, "pilot", "s11-pilot");
    pilotA = await addPilot(orgA, "操縦 一郎", "TEST-11112222", pilotMember.id);
    pilotB = await addPilot(orgA, "操縦 二郎", "TEST-33334444", null);
    await addMember(orgB, "manager", "s11-mgr-b");
    pilotOrgB = await addPilot(orgB, "組織B 操縦者", null, null);
  });

  afterAll(async () => {
    await app?.end();
    await owner?.end();
    await db?.drop();
    if (createdRole) await withClient(ADMIN_URL!, (c) => c.query("drop role if exists soraban_app"));
  });

  it("3. アプリが送った flight_minutes・flight_date は使われず、DB が単体テストと同じ規則で決める", async () => {
    const a = await newAircraft(0);
    const cases = [
      ["2027-01-04T09:30", "2027-01-04T09:30"], // 同じ分 → 1
      ["2027-01-02T23:50", "2027-01-03T00:10"], // 日をまたぐ → 20、飛行年月日は離陸の日付
      ["2026-12-31T23:59", "2027-01-01T01:30"],
    ] as const;
    for (const [t, l] of cases) {
      const id = randomUUID();
      // soraban_app で、data に偽の flight_minutes・flight_date を入れて追加する
      await withClient(db.url, async (c) => {
        await c.query("set role soraban_app");
        await c.query(
          `insert into record_versions (org_id, entity_type, entity_id, op, data, actor_kind, actor_member_id)
           values ($1, 'flight_record', $2, 'create', $3::jsonb, 'member', $4)`,
          [
            orgA,
            id,
            JSON.stringify({
              aircraft_id: a.id,
              pilot_id: pilotB.id,
              purpose: "試験",
              takeoff_place: "x",
              landing_place: "x",
              takeoff_at: t,
              landing_at: l,
              safety_issue: false,
              pilot_name: "操縦 二郎",
              pilot_version: 1,
              flight_minutes: 999,
              flight_date: "2000-01-01",
            }),
            manager.id,
          ],
        );
      });
      const head = (
        await owner.query("select flight_minutes, to_char(flight_date, 'YYYY-MM-DD') as d from flight_records where id = $1", [id])
      ).rows[0];
      const expected = flightMinutesFromInput(t, l);
      expect(expected.ok).toBe(true);
      expect(head.flight_minutes).toBe(expected.ok ? expected.minutes : -1);
      expect(head.d).toBe(t.slice(0, 10));
      // 版の data も DB が決めた値（content_hash はこの値を含めて計算）
      const v = (await owner.query("select data from record_versions where entity_id = $1", [id])).rows[0].data;
      expect(v.flight_minutes).toBe(head.flight_minutes);
      expect(v.flight_date).toBe(t.slice(0, 10));
      expect(await verify("flight_record", id)).toEqual([]);
    }
    const sameMinute = (await owner.query("select flight_minutes from flight_records where takeoff_at = landing_at")).rows;
    expect(sameMinute.map((r) => r.flight_minutes)).toEqual([1]);
    // DB の関数とアプリの関数が一致する（同じ分・日またぎ・最大）
    for (const [t, l] of [...cases, ["2027-01-03T09:00", "2027-01-04T08:59"]] as const) {
      const db1 = (
        await owner.query("select ops_flight_minutes(ops_jst_minute_to_timestamptz($1), ops_jst_minute_to_timestamptz($2)) as m", [t, l])
      ).rows[0].m;
      const appR = flightMinutesFromInput(t, l);
      expect(db1).toBe(appR.ok ? appR.minutes : null);
      expect(
        new Date((await owner.query("select ops_jst_minute_to_timestamptz($1) as t", [t])).rows[0].t).toISOString(),
      ).toBe(parseJstMinute(t)!.toISOString());
    }
    // 秒付き・タイムゾーン付きの形は DB でも拒否
    await expect(owner.query("select ops_jst_minute_to_timestamptz('2027-01-05T09:30:15')")).rejects.toMatchObject({ code: "22007" });
    await expect(owner.query("select ops_jst_minute_to_timestamptz('2027-01-05T09:30+09:00')")).rejects.toMatchObject({ code: "22007" });
  });

  it("6. 版の data に、サーバーが写した操縦者の氏名・技能証明書番号・版番号が入り、本文の氏名は無視。後で操縦者の氏名を訂正しても記録の氏名は変わらない", async () => {
    const a = await newAircraft(0);
    const p = await addPilot(orgA, "写し 太郎", "TEST-55556666", null);
    const r = await rec.createFlight(
      mgr(),
      flightInput(a.id, p.id, "2027-01-04T10:00", "2027-01-04T10:10", { pilotName: "偽の名前", pilot_name: "偽の名前", pilotLicenseNumber: "FAKE" }),
    );
    expect(r.created).toBe(true);
    const v1 = (await owner.query("select data from record_versions where entity_id = $1 and version_no = 1", [r.record.id])).rows[0].data;
    expect(v1).toMatchObject({ pilot_name: "写し 太郎", pilot_license_number: "TEST-55556666", pilot_version: 1 });
    expect(JSON.stringify(v1)).not.toContain("偽の名前");
    expect(JSON.stringify(v1)).not.toContain("FAKE");

    // 訂正の版にも写しが入る
    const upd = await rec.updateFlight(mgr(), r.record.id, { expectedVersion: 1, reason: "目的の誤記", purpose: "点検" });
    const v2 = (await owner.query("select data from record_versions where entity_id = $1 and version_no = 2", [r.record.id])).rows[0].data;
    expect(v2).toMatchObject({ pilot_name: "写し 太郎", pilot_license_number: "TEST-55556666", pilot_version: 1, purpose: "点検" });
    expect(upd.record.version).toBe(2);

    // 操縦者の氏名を訂正しても、既存の飛行記録の詳細の氏名は変わらない
    const pilotNow = await svc.getPilot(mgr(), p.id);
    await svc.updatePilot(mgr(), p.id, { expectedVersion: pilotNow.version, reason: "改姓", fullName: "写し 次郎" });
    const after = await rec.getFlight(mgr(), r.record.id);
    expect(after.pilotName).toBe("写し 太郎");
    expect(after.pilotVersion).toBe(1);

    // 日常点検でも実施者の氏名を写す
    const i = await rec.createInspection(mgr(), {
      aircraftId: a.id,
      pilotId: p.id,
      inspectedAt: "2027-01-04T09:00",
      placeName: "本社",
      items: Object.fromEntries(INSPECTION_ITEMS.map((it) => [it.key, { result: "normal" }])),
      inspectorName: "偽の名前",
    });
    expect(i.record.inspectorName).toBe("写し 次郎");
    const iv = (await owner.query("select data from record_versions where entity_id = $1", [i.record.id])).rows[0].data;
    expect(iv).toMatchObject({ inspector_name: "写し 次郎", inspector_version: 2, has_abnormal: false, inspected_date: "2027-01-04" });
  });

  it("8・9. 総飛行時間の累計と再計算（訂正・取消・後入力・既存の総飛行時間の訂正）。総飛行時間の列はヘッド表にない", async () => {
    const a = await newAircraft(600);
    const f1 = (await rec.createFlight(mgr(), flightInput(a.id, pilotB.id, "2027-01-02T09:00", "2027-01-02T09:30"))).record;
    const f2 = (await rec.createFlight(mgr(), flightInput(a.id, pilotB.id, "2027-01-02T10:00", "2027-01-02T10:00"))).record;
    const f3 = (await rec.createFlight(mgr(), flightInput(a.id, pilotB.id, "2027-01-02T11:00", "2027-01-02T11:45"))).record;
    expect([f1.flightMinutes, f2.flightMinutes, f3.flightMinutes]).toEqual([30, 1, 45]);
    expect(await totals([f1.id, f2.id, f3.id])).toEqual([630, 631, 676]);
    expect((await svc.getAircraft(mgr(), a.id)).totalFlightMinutes).toBe(676);

    // (a) 1 件目の着陸時刻を 10 分延ばす
    await rec.updateFlight(mgr(), f1.id, { expectedVersion: 1, reason: "着陸時刻の誤記", landingAt: "2027-01-02T09:40" });
    expect(await totals([f1.id, f2.id, f3.id])).toEqual([640, 641, 686]);
    // (b) 2 件目の取消
    await rec.voidFlight(mgr(), f2.id, { expectedVersion: 1, reason: "重複して入力した" });
    expect(await totals([f1.id, f3.id])).toEqual([640, 685]);
    const voided = await rec.getFlight(mgr(), f2.id);
    expect(voided).toMatchObject({ voided: true, totalFlightMinutes: null });
    // (c) 1 件目より前の日付で 20 分の記録を後入力
    const f0 = (await rec.createFlight(mgr(), flightInput(a.id, pilotB.id, "2027-01-01T08:00", "2027-01-01T08:20"))).record;
    expect(f0.totalFlightMinutes).toBe(620);
    expect(await totals([f1.id, f3.id])).toEqual([660, 705]);
    // (d) 機体の既存の総飛行時間を 500 に訂正
    const ac = await svc.getAircraft(mgr(), a.id);
    await svc.updateAircraft(mgr(), a.id, { expectedVersion: ac.version, reason: "紙の飛行日誌と照合", initialFlightMinutes: 500 });
    expect(await totals([f0.id, f1.id, f3.id])).toEqual([520, 560, 605]);
    expect((await svc.getAircraft(mgr(), a.id)).totalFlightMinutes).toBe(605);

    // 保存済みの総飛行時間の更新は行われていない（総飛行時間の列がヘッド表にない）
    const cols = (
      await owner.query("select column_name from information_schema.columns where table_name = 'flight_records'")
    ).rows.map((r) => r.column_name as string);
    expect(cols.filter((c) => c.includes("total"))).toEqual([]);
    expect(cols).toContain("flight_minutes");
  });

  it("10. 操縦者ごとの累計は 2 機体にまたがる取消していない飛行時間の合計で、取消で減る", async () => {
    const p = await addPilot(orgA, "累計 花子", null, null);
    const a1 = await newAircraft(100);
    const a2 = await newAircraft(0);
    await rec.createFlight(mgr(), flightInput(a1.id, p.id, "2027-01-03T09:00", "2027-01-03T09:15"));
    const g = (await rec.createFlight(mgr(), flightInput(a2.id, p.id, "2027-01-03T10:00", "2027-01-03T10:40"))).record;
    await rec.createFlight(mgr(), flightInput(a1.id, p.id, "2027-01-03T11:00", "2027-01-03T11:05"));
    expect((await svc.getPilot(mgr(), p.id)).recordedFlightMinutes).toBe(60);
    await rec.voidFlight(mgr(), g.id, { expectedVersion: 1, reason: "別の操縦者の記録" });
    expect((await svc.getPilot(mgr(), p.id)).recordedFlightMinutes).toBe(20);
    expect((await svc.getPilot(mgr(), p.id)).recordedFlightCount).toBe(2);
  });

  it("11. 同じ機体・同じ操縦者で時間帯が重なる作成・訂正は 409 overlap で版が増えない。取消した記録とは重なってよい。接するだけなら作成できる", async () => {
    const a = await newAircraft(0);
    const other = await newAircraft(0);
    const p = await addPilot(orgA, "重なり 一郎", null, null);
    const q = await addPilot(orgA, "重なり 二郎", null, null);
    const base = (await rec.createFlight(mgr(), flightInput(a.id, p.id, "2027-01-03T13:00", "2027-01-03T13:30"))).record;
    const before = Number((await owner.query("select count(*)::int as n from record_versions where entity_type = 'flight_record'")).rows[0].n);
    // 同じ機体・別の操縦者で重なる
    await expectOpsError(rec.createFlight(mgr(), flightInput(a.id, q.id, "2027-01-03T13:29", "2027-01-03T13:40")), 409, "overlap");
    // 別の機体・同じ操縦者で重なる
    await expectOpsError(rec.createFlight(mgr(), flightInput(other.id, p.id, "2027-01-03T12:50", "2027-01-03T13:01")), 409, "overlap");
    expect(Number((await owner.query("select count(*)::int as n from record_versions where entity_type = 'flight_record'")).rows[0].n)).toBe(before);
    // 接するだけ（前の着陸の分 = 次の離陸の分）は作成できる
    const touch = (await rec.createFlight(mgr(), flightInput(a.id, q.id, "2027-01-03T13:30", "2027-01-03T13:50"))).record;
    // 同じ分（1 分）の記録は〔離陸, 離陸＋1 分）を占める
    await rec.createFlight(mgr(), flightInput(a.id, q.id, "2027-01-03T14:00", "2027-01-03T14:00"));
    await expectOpsError(rec.createFlight(mgr(), flightInput(other.id, q.id, "2027-01-03T14:00", "2027-01-03T14:05")), 409, "overlap");
    await rec.createFlight(mgr(), flightInput(other.id, q.id, "2027-01-03T14:01", "2027-01-03T14:05"));
    // 訂正で重なる → 409、版が増えない
    const n = await versionCount(touch.id);
    await expectOpsError(
      rec.updateFlight(mgr(), touch.id, { expectedVersion: 1, reason: "時刻の訂正", takeoffAt: "2027-01-03T13:20" }),
      409,
      "overlap",
    );
    expect(await versionCount(touch.id)).toBe(n);
    // 取消した記録とは重なってよい
    await rec.voidFlight(mgr(), base.id, { expectedVersion: 1, reason: "誤入力" });
    await rec.createFlight(mgr(), flightInput(a.id, p.id, "2027-01-03T13:00", "2027-01-03T13:25"));
  });

  it("12. 飛行記録・日常点検を作成して 2 回訂正すると版 1・2・3 で prev_hash がつながり verify が 0 行。版 2 の data を書き換えると版 2 を返す", async () => {
    const a = await newAircraft(0);
    const f = (
      await rec.createFlight(
        mgr(),
        flightInput(a.id, pilotB.id, "2027-01-04T15:00", "2027-01-04T15:20", {
          takeoffLat: 35.43,
          takeoffLng: 133.36,
          takeoffAccuracyM: 8,
          specificFlightTypes: ["did"],
          defects: [{ occurredOn: "2027-01-04", description: "プロペラの欠け" }],
        }),
      )
    ).record;
    await rec.updateFlight(mgr(), f.id, { expectedVersion: 1, reason: "経由地の追記", waypoints: "日吉津村役場" });
    await rec.updateFlight(mgr(), f.id, {
      expectedVersion: 2,
      reason: "処置の追記",
      defects: [{ occurredOn: "2027-01-04", description: "プロペラの欠け", actionOn: "2027-01-05", action: "交換", confirmerName: "運航 管理子" }],
    });
    const i = (
      await rec.createInspection(mgr(), {
        aircraftId: a.id,
        pilotId: pilotB.id,
        inspectedAt: "2027-01-04T14:30",
        placeName: "本社",
        latitude: 35.43,
        longitude: 133.36,
        items: Object.fromEntries(INSPECTION_ITEMS.map((it) => [it.key, { result: "normal" }])),
      })
    ).record;
    await rec.updateInspection(mgr(), i.id, { expectedVersion: 1, reason: "特記事項の追記", specialNotes: "異常なし" });
    await rec.updateInspection(mgr(), i.id, {
      expectedVersion: 2,
      reason: "異常の追記",
      items: { ...Object.fromEntries(INSPECTION_ITEMS.map((it) => [it.key, { result: "normal" }])), frame: { result: "abnormal", note: "亀裂" } },
    });
    expect((await rec.getInspection(mgr(), i.id)).hasAbnormal).toBe(true);

    for (const [type, id] of [
      ["flight_record", f.id],
      ["daily_inspection", i.id],
    ] as const) {
      const vs = (
        await owner.query("select * from record_versions where entity_type = $1 and entity_id = $2 order by version_no", [type, id])
      ).rows;
      expect(vs.map((v) => v.version_no)).toEqual([1, 2, 3]);
      expect(vs[1].prev_hash).toBe(vs[0].content_hash);
      expect(vs[2].prev_hash).toBe(vs[1].content_hash);
      expect(await verify(type, id)).toEqual([]);
      await owner.query("update record_versions set data = data || '{\"place_name\": \"改ざん\"}'::jsonb where entity_id = $1 and version_no = 2", [id]);
      expect(await verify(type, id)).toEqual([{ version_no: 2, problem: "content_hash_mismatch" }]);
    }

    // ヘッド表の時刻だけを書き換えると head_data_mismatch
    const g = (await rec.createFlight(mgr(), flightInput(a.id, pilotB.id, "2027-01-04T16:00", "2027-01-04T16:10"))).record;
    expect(await verify("flight_record", g.id)).toEqual([]);
    await owner.query("update flight_records set landing_at = landing_at + interval '5 minutes' where id = $1", [g.id]);
    expect(await verify("flight_record", g.id)).toEqual([{ version_no: 1, problem: "head_data_mismatch" }]);
    // 取消の版も連鎖がつながる
    const h = (await rec.createFlight(mgr(), flightInput(a.id, pilotB.id, "2027-01-04T17:00", "2027-01-04T17:10"))).record;
    await rec.voidFlight(mgr(), h.id, { expectedVersion: 1, reason: "誤入力" });
    expect(await verify("flight_record", h.id)).toEqual([]);
  });

  it("13. soraban_app はヘッド表に追加・更新・削除できず、参照と総飛行時間のビュー・関数は使える", async () => {
    await withClient(db.url, async (c) => {
      await c.query("set role soraban_app");
      const denied = async (sql: string) => expect(c.query(sql), sql).rejects.toMatchObject({ code: "42501" });
      for (const t of ["daily_inspections", "flight_records"]) {
        await denied(`update ${t} set id = id`);
        await denied(`delete from ${t}`);
        await denied(`truncate ${t}`);
        await denied(`insert into ${t} (id) values (gen_random_uuid())`);
        await c.query(`select count(*) from ${t}`);
      }
      for (const v of ["flight_record_totals", "aircraft_flight_totals", "pilot_flight_totals"]) {
        await c.query(`select * from ${v} limit 1`);
      }
      expect((await c.query("select ops_flight_minutes(now(), now()) as m")).rows[0].m).toBe(1);
      await expect(c.query("select * from verify_record_chain('flight_record', gen_random_uuid())")).rejects.toMatchObject({ code: "42501" });
    });
  });

  it("7（DB 部分）. 機体は訂正で変えられない。取消済み・抹消の機体への作成は 409。他の組織の機体・操縦者は 404。別の機体の点検は 400", async () => {
    const a = await newAircraft(0);
    const b = await newAircraft(0);
    const f = (await rec.createFlight(mgr(), flightInput(a.id, pilotB.id, "2027-01-04T18:00", "2027-01-04T18:10"))).record;
    const e = await expectOpsError(
      rec.updateFlight(mgr(), f.id, { expectedVersion: 1, reason: "機体の誤り", aircraftId: b.id }),
      400,
      "invalid_input",
    );
    expect(e.fieldCodes).toMatchObject({ aircraftId: "aircraft_immutable" });
    // DB でも機体の変更を拒否する（アプリの検査を通らない追加）
    await expect(
      owner.query(
        `insert into record_versions (org_id, entity_type, entity_id, op, data, reason, actor_kind)
         select org_id, entity_type, entity_id, 'update', data || jsonb_build_object('aircraft_id', $2::text), '試験', 'system'
           from record_versions where entity_id = $1 and version_no = 1`,
        [f.id, b.id],
      ),
    ).rejects.toMatchObject({ code: "23514" });

    const dereg = await newAircraft(0);
    await svc.updateAircraft(mgr(), dereg.id, { expectedVersion: 1, reason: "抹消", status: "deregistered" });
    await expectOpsError(rec.createFlight(mgr(), flightInput(dereg.id, pilotB.id, "2027-01-04T19:00", "2027-01-04T19:10")), 409, "aircraft_unavailable");
    const voidedA = await newAircraft(0);
    await svc.voidAircraft(mgr(), voidedA.id, { expectedVersion: 1, reason: "誤登録" });
    await expectOpsError(rec.createFlight(mgr(), flightInput(voidedA.id, pilotB.id, "2027-01-04T19:00", "2027-01-04T19:10")), 409, "aircraft_unavailable");

    const bAircraft = (await owner.query("select id from aircraft where org_id = $1 limit 1", [orgB])).rows[0]?.id as string | undefined;
    const orgBAircraft = bAircraft ?? (await addVersion(orgB, "aircraft", {
      registration_mark: "JUORGB11",
      model_name: "x",
      manufacturer: "x",
      serial_number: "x",
      type_certified: false,
      initial_flight_minutes: 0,
      status: "active",
    }));
    await expectOpsError(rec.createFlight(mgr(), flightInput(orgBAircraft, pilotB.id, "2027-01-04T20:00", "2027-01-04T20:10")), 404);
    await expectOpsError(rec.createFlight(mgr(), flightInput(a.id, pilotOrgB.id, "2027-01-04T20:00", "2027-01-04T20:10")), 404);

    const insp = (
      await rec.createInspection(mgr(), {
        aircraftId: b.id,
        pilotId: pilotB.id,
        inspectedAt: "2027-01-04T19:30",
        placeName: "本社",
        items: Object.fromEntries(INSPECTION_ITEMS.map((it) => [it.key, { result: "normal" }])),
      })
    ).record;
    const mismatch = await expectOpsError(
      rec.createFlight(mgr(), flightInput(a.id, pilotB.id, "2027-01-04T20:00", "2027-01-04T20:10", { dailyInspectionId: insp.id })),
      400,
    );
    expect(mismatch.fieldCodes).toMatchObject({ dailyInspectionId: "inspection_mismatch" });
  });

  it("二重送信：同じ clientRequestId の作成は既存の記録を返し、記録は 1 件だけ（同時に送っても）", async () => {
    const a = await newAircraft(0);
    const requestId = randomUUID();
    const body = { ...flightInput(a.id, pilotB.id, "2027-01-04T21:00", "2027-01-04T21:10"), clientRequestId: requestId };
    const [x, y] = await Promise.all([rec.createFlight(mgr(), body), rec.createFlight(mgr(), body)]);
    expect(x.record.id).toBe(y.record.id);
    expect([x.created, y.created].sort()).toEqual([false, true]);
    const z = await rec.createFlight(mgr(), body);
    expect(z).toMatchObject({ created: false, record: { id: x.record.id } });
    expect(Number((await owner.query("select count(*)::int as n from flight_records where client_request_id = $1", [requestId])).rows[0].n)).toBe(1);
  });

  it("14（DB 部分）. 操縦者は自分の分だけ作成・訂正でき、取消はできない。結び付いていない操縦者役割は作れない", async () => {
    const a = await newAircraft(0);
    const pctx = ctxOf(pilotMember);
    const own = await rec.createFlight(pctx, flightInput(a.id, pilotA.id, "2027-01-04T22:00", "2027-01-04T22:10"));
    expect(own.created).toBe(true);
    await expectOpsError(rec.createFlight(pctx, flightInput(a.id, pilotB.id, "2027-01-04T22:20", "2027-01-04T22:30")), 403);
    await rec.updateFlight(pctx, own.record.id, { expectedVersion: 1, reason: "目的の訂正", purpose: "点検" });
    await expectOpsError(rec.voidFlight(pctx, own.record.id, { expectedVersion: 2, reason: "x" }), 403);
    const unlinked = await addMember(orgA, "pilot", "s11-unlinked");
    await expectOpsError(rec.createFlight(ctxOf(unlinked), flightInput(a.id, pilotB.id, "2027-01-04T23:00", "2027-01-04T23:10")), 403);
    const viewer = await addMember(orgA, "viewer", "s11-viewer");
    await expectOpsError(rec.createFlight(ctxOf(viewer), flightInput(a.id, pilotB.id, "2027-01-04T23:00", "2027-01-04T23:10")), 403);
    expect((await rec.listFlights(ctxOf(viewer), { aircraftId: a.id })).length).toBe(1);
  });
});
