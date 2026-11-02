// Sprint 19-1b の DB テスト（pnpm test:db）。使い捨てのデータベースに 0001〜0018 を適用し、soraban_app で計画の API 層を動かす。
import { randomUUID } from "node:crypto";
import { cpSync, mkdtempSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { MemberRow, PilotRow } from "@soraban/db";
import { fingerprintOf } from "@soraban/dips";
import { haversineMeters } from "@soraban/geo";
import { ENGINE_VERSION } from "@soraban/regulations";
import { createTempDatabase, runCli, withClient, type TempDatabase } from "../../../../../packages/db/src/test-db-helpers";
import { resolveTestDatabaseUrl } from "../../../../../packages/db/src/test-db-env";
import { runRegulationCheckWith } from "../check-core";
import { runDiagnosis } from "../diagnose-core";
import { baselineProvider } from "../sprint11e-baseline";
import { fingerprintAreasOfRow } from "./flight-areas";
import type { Judge } from "./judge";
import { toDiagnosisRunInput } from "./plan-logic";
import * as permits from "./permits";
import * as plans from "./plans";
import * as reports from "./reports";
import { currentFingerprintOf } from "./report-dto";
import * as svc from "./service";
import { OpsError, type OpsContext } from "./service";
import * as store from "./store";
import type { OpsDb } from "./store";

const ADMIN_URL = resolveTestDatabaseUrl();
const NOW = new Date("2027-01-05T03:00:00Z");
const judge: Judge = (input, now) =>
  runDiagnosis(
    toDiagnosisRunInput(input),
    (loc, ctx, n) => runRegulationCheckWith({ ...baselineProvider("31202"), reverseGeocode: async () => ({ muniCode: "31384" }) }, loc, ctx, n),
    now,
  );

const TRI = [
  [133.33, 35.42],
  [133.34, 35.42],
  [133.335, 35.43],
];
const mv = (n: number): number => Number(n.toFixed(6));
const FAR = { kind: "circle", center: [133.36, 35.44], radiusM: 300 };

describe.skipIf(!ADMIN_URL)("飛行範囲（flight_areas）の保存・照合・権限の DB", () => {
  let db: TempDatabase;
  let createdRole = false;
  let owner: pg.Pool;
  let app: pg.Pool;
  let org: string;
  let manager: MemberRow;
  let pilot: PilotRow;
  let aircraft: string;
  let seq = 0;
  const before0018: { id: string; row: Record<string, unknown>; chain: unknown[] }[] = [];

  const addVersion = async (orgId: string, entityType: string, data: object): Promise<string> => {
    const id = randomUUID();
    await owner.query(
      `insert into record_versions (org_id, entity_type, entity_id, op, data, actor_kind) values ($1, $2, $3, 'create', $4::jsonb, 'system')`,
      [orgId, entityType, id, JSON.stringify(data)],
    );
    return id;
  };
  const ctx = (): OpsContext => ({ db: app as unknown as OpsDb, member: manager, now: () => NOW, judge });
  const input = (extra: Record<string, unknown> = {}) => ({
    title: `範囲 ${++seq}`,
    aircraftId: aircraft,
    pilotId: pilot.id,
    plannedStartAt: "2027-01-14T09:00",
    durationMinutes: 60,
    purpose: "空撮",
    placeName: "テスト地点",
    ...extra,
  });
  const create = async (extra: Record<string, unknown>) => (await plans.createPlan(ctx(), input(extra))).record;
  const row = async (id: string) => (await owner.query("select * from flight_plans where id = $1", [id])).rows[0];
  const count = async (t: string) => Number((await owner.query(`select count(*)::int n from ${t}`)).rows[0].n);
  const verifyAreas = async (id: string) => (await owner.query("select * from verify_flight_areas($1)", [id])).rows.map((r) => r.problem as string);
  const verifyChain = async (id: string) => (await owner.query("select * from verify_record_chain('flight_plan', $1)", [id])).rows;
  const err = async (p: Promise<unknown>): Promise<OpsError> => {
    const e = await p.then(() => null, (x: unknown) => x);
    expect(e).toBeInstanceOf(OpsError);
    return e as OpsError;
  };

  beforeAll(async () => {
    createdRole = await withClient(ADMIN_URL!, async (c) => {
      const exists = (await c.query("select 1 from pg_roles where rolname = 'soraban_app'")).rowCount === 1;
      if (!exists) await c.query("create role soraban_app nologin");
      return !exists;
    });
    db = await createTempDatabase(ADMIN_URL!);
    // 0017 まで適用した状態で既存の計画（円・点）を作り、そのあと 0018 を当てる（既存の行が変わらないことの確認）
    const dir = mkdtempSync(path.join(tmpdir(), "soraban-fa-"));
    cpSync(path.resolve(__dirname, "../../../../../packages/db/migrations"), dir, { recursive: true });
    for (const f of readdirSync(dir)) if (f.startsWith("0018_")) rmSync(path.join(dir, f));
    const r0 = await runCli(["migrate", "--dir", dir], { DATABASE_URL_UNPOOLED: db.url });
    expect(r0.code, r0.stderr).toBe(0);
    owner = new pg.Pool({ connectionString: db.url, max: 4 });
    app = new pg.Pool({ connectionString: db.url, max: 4, options: "-c role=soraban_app" });
    org = (await owner.query("insert into organizations (name) values ('範囲組織') returning id")).rows[0].id;
    const mid = await addVersion(org, "member", { email: "m@example.test", display_name: "m", role: "manager", status: "active", auth_provider: "test", auth_user_id: "fa-mgr" });
    manager = (await owner.query<MemberRow>("select * from members where id = $1", [mid])).rows[0]!;
    const pid = await addVersion(org, "pilot", { full_name: "操縦 一郎", has_license: true, license_class: "second", license_number: "T-1", license_expires_on: null, member_id: null });
    pilot = (await owner.query<PilotRow>("select * from pilots where id = $1", [pid])).rows[0]!;
    aircraft = (
      await svc.createAircraft(ctx(), { registrationMark: "JU19T0001", modelName: "M", manufacturer: "DJI", serialNumber: "SN19", typeCertified: false, initialFlightMinutes: 0, maxTakeoffWeightKg: 0.9 })
    ).id;
    for (const extra of [{ latitude: 35.428, longitude: 133.331, radiusM: 150 }, { latitude: 35.428, longitude: 133.331 }]) {
      const rec = (await plans.createPlan(ctx(), input(extra))).record;
      before0018.push({ id: rec.id, row: (await owner.query("select to_jsonb(p) as j from flight_plans p where id = $1", [rec.id])).rows[0].j, chain: await verifyChain(rec.id) });
    }
    const r = await runCli(["migrate"], { DATABASE_URL_UNPOOLED: db.url });
    expect(r.code, r.stderr).toBe(0);
  });

  afterAll(async () => {
    await app?.end();
    await owner?.end();
    await db?.drop();
    if (createdRole) await withClient(ADMIN_URL!, (c) => c.query("drop role if exists soraban_app"));
  });

  it("B1-1：flight_areas 列（jsonb・null 可）があり、既存の列の形は変わらない。0018 は適用済み", async () => {
    const c = (await owner.query("select data_type, is_nullable from information_schema.columns where table_name = 'flight_plans' and column_name = 'flight_areas'")).rows[0];
    expect(c).toEqual({ data_type: "jsonb", is_nullable: "YES" });
    expect((await owner.query("select version from schema_migrations order by version desc limit 1")).rows[0].version).toBe("0018");
  });

  it("B1-1：0017 まで適用済みで計画がある DB に 0018 を当てても、既存の行は変わらない（flight_areas は null）。版の連鎖・照合は問題なし", async () => {
    expect(before0018).toHaveLength(2);
    for (const b of before0018) {
      const now = (await owner.query("select to_jsonb(p) as j from flight_plans p where id = $1", [b.id])).rows[0].j as Record<string, unknown>;
      const { flight_areas, ...rest } = now;
      expect(flight_areas).toBeNull();
      expect(rest).toEqual(b.row);
      expect(await verifyChain(b.id)).toEqual([]);
      expect(await verifyAreas(b.id)).toEqual([]);
    }
  });

  it("B1-2：多角形＋遠い円で保存すると、サーバーが代表点と覆う円を求める（リクエストの緯度・経度・半径は使わない）。小数 6 桁で DB と一致", async () => {
    const p = await create({ areas: [{ kind: "polygon", vertices: TRI }, FAR], latitude: 1, longitude: 2, radiusM: 3 });
    const r = await row(p.id);
    expect(p.areaState).toBe("areas");
    expect(p.areas).toHaveLength(2);
    expect(r.flight_areas).toHaveLength(2);
    expect(r.radius_m).toBeGreaterThan(3);
    expect(Number(r.latitude)).toBeGreaterThan(35);
    // 丸め済みの値を保存：numeric(9,6) に入れても値が変わらない
    expect(p.latitude).toBe(Number(r.latitude));
    expect(Number(Number(r.latitude).toFixed(6))).toBe(Number(r.latitude));
    expect(p.longitude).toBe(Number(r.longitude));
    // 半径は全範囲を覆う（多角形の全頂点と、遠い円の縁）
    const c = { lat: Number(r.latitude), lng: Number(r.longitude) };
    for (const [lng, lat] of TRI) expect(haversineMeters(c, { lat: lat!, lng: lng! })).toBeLessThanOrEqual(r.radius_m);
    expect(haversineMeters(c, { lat: 35.44, lng: 133.36 }) + 300).toBeLessThanOrEqual(r.radius_m);
    // 版の data にも覆う円と範囲が入る
    const d = await store.latestVersionData(app as unknown as OpsDb, org, "flight_plan", p.id);
    expect(d!["radius_m"]).toBe(r.radius_m);
    expect((d!["flight_areas"] as unknown[]).length).toBe(2);
    expect(await verifyAreas(p.id)).toEqual([]);
    expect(await verifyChain(p.id)).toEqual([]);
  });

  it("B1-2：areas が円 1 つなら、緯度・経度・半径は円そのもの", async () => {
    const p = await create({ areas: [{ kind: "circle", center: [133.331, 35.428], radiusM: 150 }] });
    expect([p.latitude, p.longitude, p.radiusM]).toEqual([35.428, 133.331, 150]);
  });

  it("B1-3：不正な areas は 422（理由コード別）で、何も保存しない（版・計画・スナップショットが増えない）", async () => {
    const before = [await count("record_versions"), await count("flight_plans"), await count("judgement_snapshots"), await count("evidence_log")];
    const cases: [unknown, string][] = [
      [[{ kind: "polygon", vertices: TRI.slice(0, 2) }], "vertices_too_few"],
      [[{ kind: "polygon", vertices: Array.from({ length: 101 }, (_, i) => [133 + i * 0.0001, 35 + (i % 2) * 0.0001]) }], "vertices_too_many"],
      [[{ kind: "polygon", vertices: [[133.3, 35.4], [133.31, 35.4], [133.32, 35.4]] }], "area_degenerate"],
      [[{ kind: "circle", center: [35.4, 133.3], radiusM: 10 }], "lat_out_of_range"],
      [[{ kind: "circle", center: [133.3, 35.4], radiusM: 6000 }, { kind: "circle", center: [133.5, 35.4], radiusM: 6000 }], "area_too_large"],
      [[], "areas_empty"],
    ];
    for (const [areas, code] of cases) {
      const e = await err(plans.createPlan(ctx(), input({ areas })));
      expect([e.status, e.code, e.fieldCodes?.["areas"]], code).toEqual([422, code, code]);
    }
    expect([await count("record_versions"), await count("flight_plans"), await count("judgement_snapshots"), await count("evidence_log")]).toEqual(before);
  });

  it("B1-4：訂正は新しい版になり、前の版の data は変わらない。表を直接書き換えると照合が偽になる", async () => {
    const p = await create({ areas: [{ kind: "polygon", vertices: TRI }] });
    const v1 = (await owner.query("select data, content_hash from record_versions where entity_id = $1 and version_no = 1", [p.id])).rows[0];
    const moved = TRI.map(([a, b], i) => (i === 0 ? [mv(a! + 0.001), b] : [a, b]));
    const u = await plans.updatePlan(ctx(), p.id, { expectedVersion: p.version, reason: "頂点を動かした", areas: [{ kind: "polygon", vertices: moved }] });
    expect(u.record.version).toBe(p.version + 1);
    const v1b = (await owner.query("select data, content_hash from record_versions where entity_id = $1 and version_no = 1", [p.id])).rows[0];
    expect(v1b).toEqual(v1);
    expect((await row(p.id)).flight_areas[0].vertices[0]).toEqual(moved[0]);
    expect(await verifyAreas(p.id)).toEqual([]);
    expect(await verifyChain(p.id)).toEqual([]);
    // 表を直接書き換える（owner）と、照合と版の連鎖の検査が偽になる
    await owner.query("update flight_plans set flight_areas = $2::jsonb where id = $1", [p.id, JSON.stringify([{ id: "a1", kind: "polygon", vertices: TRI }])]);
    expect(await verifyAreas(p.id)).toContain("flight_areas_mismatch");
    expect((await verifyChain(p.id)).map((x) => x.problem)).toContain("head_data_mismatch");
    // null にしても偽
    await owner.query("update flight_plans set flight_areas = null where id = $1", [p.id]);
    expect(await verifyAreas(p.id)).toContain("flight_areas_mismatch");
  });

  it("B1-4：訂正で areas を外す（null）と、緯度・経度・半径の値で円か点になり、flight_areas は null。範囲を足すのも訂正でできる", async () => {
    const p = await create({ areas: [{ kind: "polygon", vertices: TRI }] });
    const u = await plans.updatePlan(ctx(), p.id, { expectedVersion: p.version, reason: "訂正", areas: null, latitude: 35.4, longitude: 133.3, radiusM: 80 });
    expect((await row(p.id)).flight_areas).toBeNull();
    expect([u.record.areaState, u.record.radiusM]).toEqual(["circle", 80]);
    expect(await verifyAreas(p.id)).toEqual([]);
    const u2 = await plans.updatePlan(ctx(), p.id, { expectedVersion: u.record.version, reason: "訂正", areas: [{ kind: "polygon", vertices: TRI }] });
    expect(u2.record.areaState).toBe("areas");
    expect(await verifyAreas(p.id)).toEqual([]);
    // 範囲がある計画への、保存値と違う緯度・経度・半径だけの訂正（areas 無し）は 422 areas_present（黙って捨てない）。
    // 以前は 200 で送った値を無視していた。意図の変更：範囲を直したいのに直っていないことを利用者に知らせる。
    const e = await err(plans.updatePlan(ctx(), p.id, { expectedVersion: u2.record.version, reason: "訂正", latitude: 10, longitude: 10, radiusM: 5, notes: "メモ" }));
    expect([e.status, e.code, e.fieldCodes?.["areas"]]).toEqual([422, "areas_present", "areas_present"]);
    expect(e.fieldErrors?.["areas"]).toBe("範囲がある計画は、範囲で直してください");
    // 保存値と同じ値を送り返すフォームは通る（範囲は変わらない）
    const u3 = await plans.updatePlan(ctx(), p.id, { expectedVersion: u2.record.version, reason: "訂正", latitude: u2.record.latitude, longitude: u2.record.longitude, radiusM: u2.record.radiusM, notes: "メモ" });
    expect(u3.record.latitude).toBe(u2.record.latitude);
    expect(u3.record.radiusM).toBe(u2.record.radiusM);
    expect(u3.record.areas).toEqual(u2.record.areas);
  });

  it("B1-5：areas 無しの計画の読み出し。半径ありは円 1 つ、半径なしは点だけ。DB の行は書き換えない（flight_areas は null のまま）", async () => {
    const c = await create({ latitude: 35.428, longitude: 133.331, radiusM: 150 });
    const pt = await create({ latitude: 35.428, longitude: 133.331 });
    expect(c.areaState).toBe("circle");
    expect(c.areas).toEqual([{ id: "plan-circle", kind: "circle", name: null, center: [133.331, 35.428], radiusM: 150 }]);
    expect(pt.areaState).toBe("point");
    expect(pt.areas).toEqual([]);
    for (const id of [c.id, pt.id]) {
      expect((await row(id)).flight_areas).toBeNull();
      const d = await store.latestVersionData(app as unknown as OpsDb, org, "flight_plan", id);
      expect("flight_areas" in d!).toBe(false);
      expect(await verifyAreas(id)).toEqual([]);
    }
    // 読み出しは行を増やさない
    const n = await count("record_versions");
    await plans.getPlan(ctx(), c.id);
    expect(await count("record_versions")).toBe(n);
  });

  it("B1-6：通報の指紋は DB に保存した値から計算し、保存前の値と一致。円 1 つ・点だけの指紋は範囲を入れない", async () => {
    const p = await create({ areas: [{ kind: "polygon", vertices: TRI }, FAR] });
    const r = (await store.getPlan(app as unknown as OpsDb, org, p.id))!;
    const fromDb = currentFingerprintOf(r, null);
    // 保存前（API が返した値から、範囲の入力の座標・覆う円で）
    const pre = fingerprintOf({
      startAt: p.plannedStartAt, durationMinutes: p.durationMinutes, latitude: p.latitude, longitude: p.longitude, radiusM: p.radiusM,
      areas: fingerprintAreasOfRow({ flight_areas: (await store.latestVersionData(app as unknown as OpsDb, org, "flight_plan", p.id))!["flight_areas"] }),
      maxAltitudeM: p.maxAltitudeM, aircraftId: p.aircraftId, pilotId: p.pilotId, snapshot: { flags: r.snapshot_result_slim.flags ?? [] },
    });
    expect(fromDb).toBe(pre);
    // 円だけの計画の指紋は、範囲の列を持たない従来の計算と同じ
    const c = await create({ areas: [{ kind: "circle", center: [133.331, 35.428], radiusM: 150 }] });
    const rc = (await store.getPlan(app as unknown as OpsDb, org, c.id))!;
    expect(currentFingerprintOf(rc, null)).toBe(
      fingerprintOf({ startAt: c.plannedStartAt, durationMinutes: 60, latitude: 35.428, longitude: 133.331, radiusM: 150, maxAltitudeM: null, aircraftId: c.aircraftId, pilotId: c.pilotId, snapshot: { flags: rc.snapshot_result_slim.flags ?? [] } }),
    );
    // 頂点を 1 つ動かすと指紋が変わる
    const u = await plans.updatePlan(ctx(), p.id, { expectedVersion: p.version, reason: "訂正", areas: [{ kind: "polygon", vertices: TRI.map(([a, b], i) => (i === 2 ? [a, mv(b! + 0.000001)] : [a, b])) }, FAR] });
    const r2 = (await store.getPlan(app as unknown as OpsDb, org, u.record.id))!;
    expect(currentFingerprintOf(r2, null)).not.toBe(fromDb);
  });

  it("B1-8：判定の入力は代表点だけ（スナップショットの入力に areas が入らない）。ENGINE_VERSION は変わらない", async () => {
    const p = await create({ areas: [{ kind: "polygon", vertices: TRI }, FAR] });
    const s = (await owner.query("select input, engine_version from judgement_snapshots where plan_id = $1", [p.id])).rows[0];
    expect(Object.keys(s.input).sort()).toEqual(["droneWeightG", "flags", "lat", "lng", "pilotPermits", "plannedDate"]);
    expect(JSON.stringify(s.input)).not.toMatch(/area|vertices/i);
    expect([s.input.lat, s.input.lng]).toEqual([p.latitude, p.longitude]);
    expect(s.engine_version).toBe(ENGINE_VERSION);
  });

  it("B1-9：範囲の訂正の後は、確認がやり直しになる（確認は版に結びつく。既存の規則のまま）", async () => {
    const p = await create({ areas: [{ kind: "polygon", vertices: TRI }] });
    const req = await plans.requestConfirmation(ctx(), p.id, { expectedVersion: p.version });
    const ok = await plans.confirmPlan(ctx(), p.id, { decision: "approved", expectedVersion: req.version });
    expect(ok.plan.state).toBe("approved");
    const u = await plans.updatePlan(ctx(), p.id, { expectedVersion: req.version, reason: "訂正", areas: [{ kind: "polygon", vertices: TRI.map(([a, b], i) => (i === 0 ? [mv(a! + 0.001), b] : [a, b])) }] });
    expect(u.record.state).toBe("approved_stale");
  });

  it("DB の防御：覆わない半径・不正な形の版は、版ごと拒否される（アプリを通さない直接の追加）", async () => {
    const p = await create({ areas: [{ kind: "polygon", vertices: TRI }] });
    const d = (await store.latestVersionData(app as unknown as OpsDb, org, "flight_plan", p.id))!;
    const next = async (patch: Record<string, unknown>) =>
      owner.query(
        `insert into record_versions (org_id, entity_type, entity_id, op, data, reason, actor_kind) values ($1, 'flight_plan', $2, 'update', $3::jsonb, 'x', 'system')`,
        [org, p.id, JSON.stringify({ ...d, ...patch })],
      );
    const n = await count("record_versions");
    // 半径が範囲を覆わない
    await expect(next({ radius_m: 1 })).rejects.toMatchObject({ code: "23514" });
    // 半径なし
    await expect(next({ radius_m: null })).rejects.toMatchObject({ code: "23514" });
    // 形が不正（頂点 2 つ／kind 不明／座標が 7 桁）
    await expect(next({ flight_areas: [{ id: "a1", kind: "polygon", vertices: [[133.3, 35.4], [133.31, 35.4]] }] })).rejects.toMatchObject({ code: "23514" });
    await expect(next({ flight_areas: [{ id: "a1", kind: "square" }] })).rejects.toMatchObject({ code: "23514" });
    await expect(next({ flight_areas: [{ id: "a1", kind: "circle", center: [133.3123456, 35.4], radius_m: 5 }] })).rejects.toMatchObject({ code: "23514" });
    await expect(next({ flight_areas: [{ id: "a1", kind: "circle", center: [133.3, 35.4], radius_m: 20000 }] })).rejects.toMatchObject({ code: "23514" });
    // 鍵の欠落（radius_m なしの円・vertices なしの多角形・center なしの円）と余分な鍵、id・name の不正
    const bad: Record<string, unknown>[][] = [
      [{ id: "a1", kind: "circle", center: [133.3, 35.4] }],
      [{ id: "a1", kind: "polygon" }],
      [{ id: "a1", kind: "circle", radius_m: 5 }],
      [{ id: "a1", kind: "circle", center: [133.3, 35.4], radius_m: 5, extra: 1 }],
      [{ id: "a1", kind: "polygon", vertices: TRI, radius_m: 5 }],
      [{ kind: "circle", center: [133.3, 35.4], radius_m: 5 }],
      [{ id: "bad id", kind: "circle", center: [133.3, 35.4], radius_m: 5 }],
      [{ id: 1, kind: "circle", center: [133.3, 35.4], radius_m: 5 }],
      [{ id: "a1", name: "a\nb", kind: "circle", center: [133.3, 35.4], radius_m: 5 }],
      [{ id: "a1", name: "x".repeat(51), kind: "circle", center: [133.3, 35.4], radius_m: 5 }],
      [{ id: "a1", name: 5, kind: "circle", center: [133.3, 35.4], radius_m: 5 }],
      [{ id: "a1", kind: "circle", center: [133.3, 35.4], radius_m: 5 }, { id: "a1", kind: "circle", center: [133.3, 35.4], radius_m: 5 }],
    ];
    for (const areas of bad) {
      expect((await owner.query("select flight_areas_valid($1::jsonb) as ok", [JSON.stringify(areas)])).rows[0].ok, JSON.stringify(areas)).toBe(false);
      await expect(next({ flight_areas: areas }), JSON.stringify(areas)).rejects.toMatchObject({ code: "23514" });
    }
    // 覆いの検査も、鍵が欠けた範囲を「覆う」としない
    expect((await owner.query("select flight_areas_covered(35.4, 133.3, 100, $1::jsonb) as ok", [JSON.stringify([{ id: "a1", kind: "circle", center: [133.3, 35.4] }])])).rows[0].ok).toBe(false);
    expect((await owner.query("select flight_areas_covered(35.4, 133.3, 100, $1::jsonb) as ok", [JSON.stringify([{ id: "a1", kind: "polygon" }])])).rows[0].ok).toBe(false);
    // 正しい名前つきは通る
    expect((await owner.query("select flight_areas_valid($1::jsonb) as ok", [JSON.stringify([{ id: "a-1_x", name: "北側", kind: "circle", center: [133.3, 35.4], radius_m: 5 }])])).rows[0].ok).toBe(true);
    expect(await count("record_versions")).toBe(n);
    expect(await verifyAreas(p.id)).toEqual([]);
  });

  it("B1-7：許可の登録＋多角形の計画：覆う円が許可の円に収まらないと place_out_of_scope、収まると通る", async () => {
    const polys = [{ kind: "polygon", vertices: TRI }, FAR];
    const probe = await create({ areas: polys });
    const centre = { lat: probe.latitude, lng: probe.longitude };
    const reg = async (radiusM: number, n: string) =>
      permits.createPermit(ctx(), {
        permitNumber: n, coverage: "blanket", kinds: ["did", "night"], issuedOn: "2026-09-25", validFrom: "2026-10-01", validTo: "2027-09-30",
        placeScope: { type: "circles", circles: [{ lat: centre.lat, lng: centre.lng, radiusM }] }, aircraftScope: { type: "any" }, pilotScope: { type: "any" },
      });
    await reg(probe.radiusM! + 10, "B17-OK");
    await reg(probe.radiusM! - 1, "B17-NG");
    const ok = await create({ areas: polys, flags: ["method_night"], permitNumbers: "B17-OK" });
    const ng = await create({ areas: polys, flags: ["method_night"], permitNumbers: "B17-NG" });
    expect(ok.permits.numbers[0]!.reasons.map((r) => r.code)).not.toContain("place_out_of_scope");
    expect(ok.permits.numbers[0]!.status).toBe("applied");
    expect(ng.permits.numbers[0]!.reasons.map((r) => r.code)).toContain("place_out_of_scope");
    expect(ng.permits.numbers[0]!.status).not.toBe("applied");
  });

  it("通報の準備（19-1c）：範囲が 2 つ以上は、画面の読み出しは通すが経路を出さず（警告 route_multiple_areas。新規・変更の記録と再送の停止は reports.db.test.ts で検査）。多角形 1 つ・円 1 つ・点は通る", async () => {
    const two = await create({ areas: [{ kind: "circle", center: [133.33, 35.42], radiusM: 20 }, { kind: "circle", center: [133.331, 35.42], radiusM: 20 }] });
    const polyAndCircle = await create({ areas: [{ kind: "polygon", vertices: TRI }, FAR] });
    for (const pl of [two, polyAndCircle]) {
      const v = await reports.getPlanReport(ctx(), pl.id);
      const route = v.prepared.items.find((i) => i.key === "route")!;
      expect(route.apiValue).toBeNull();
      expect(route.warnings.map((w) => w.code)).toEqual(["route_multiple_areas"]);
      expect(v.recordable.reason === "multiple_areas" || v.recordable.reason === "draft").toBe(true);
    }
    const one = await create({ areas: [{ kind: "circle", center: [133.33, 35.42], radiusM: 20 }] });
    const pt = await create({ latitude: 35.4, longitude: 133.3 });
    for (const pl of [one, pt]) await expect(reports.getPlanReport(ctx(), pl.id)).resolves.toBeDefined();
    // 多角形 1 つ：経路は多角形の GeoJSON（開いた環・小数 6 桁）。指紋は円・点の計画と別の値
    const poly = await create({ areas: [{ kind: "polygon", vertices: TRI }] });
    const view = await reports.getPlanReport(ctx(), poly.id);
    const route = view.prepared.items.find((i) => i.key === "route")!;
    expect(route.value).toBe("多角形・頂点 3");
    const g = JSON.parse(route.apiValue!);
    expect(g.features[0].geometry).toEqual({ type: "Polygon", coordinates: [TRI] });
    expect(g.features[0].properties).toEqual({});
    expect(route.warnings).toEqual([]);
  });

  it("PlanDto.judgementScope は常に representative_point", async () => {
    const p = await create({ areas: [{ kind: "polygon", vertices: TRI }] });
    expect(p.judgementScope).toBe("representative_point");
    expect((await create({ latitude: 35.4, longitude: 133.3 })).judgementScope).toBe("representative_point");
  });

  it("権限：soraban_app は flight_plans を更新できず、verify_flight_areas を実行できない。追記専用は変わらない", async () => {
    const p = await create({ areas: [{ kind: "polygon", vertices: TRI }] });
    await expect(app.query("update flight_plans set flight_areas = null where id = $1", [p.id])).rejects.toMatchObject({ code: "42501" });
    await expect(app.query("insert into flight_plans (id) values ($1)", [randomUUID()])).rejects.toMatchObject({ code: "42501" });
    await expect(app.query("select * from verify_flight_areas($1)", [p.id])).rejects.toMatchObject({ code: "42501" });
    await expect(app.query("update record_versions set reason = 'x' where entity_id = $1", [p.id])).rejects.toMatchObject({ code: "42501" });
    const priv = async (t: string, k: string) => (await owner.query("select has_table_privilege('soraban_app', $1, $2) as ok", [t, k])).rows[0].ok;
    expect(await priv("flight_plans", "SELECT")).toBe(true);
    for (const k of ["INSERT", "UPDATE", "DELETE", "TRUNCATE"]) expect(await priv("flight_plans", k), k).toBe(false);
  });

  it("0018 の再実行：migrate は 2 回目に何もしない。0016 の大きな関数は再定義していない", async () => {
    const r = await runCli(["migrate"], { DATABASE_URL_UNPOOLED: db.url });
    expect(r.code, r.stderr).toBe(0);
    const trg = (await owner.query("select tgname from pg_trigger where tgrelid = 'record_versions'::regclass and not tgisinternal order by tgname")).rows.map((x) => x.tgname);
    const i = trg.indexOf("record_versions_after_insert");
    expect(trg[i + 1]).toBe("record_versions_after_insert_flight_areas");
  });
});
