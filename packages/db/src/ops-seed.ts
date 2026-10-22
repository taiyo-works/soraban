// 運航管理のテスト用の初期データ（Sprint 10 設計 G）。CI の E2E-DB とローカルの確認で使う。
//   pnpm db:seed:ops-test   （接続先は DATABASE_URL_UNPOOLED。オーナーロールで接続する）
// - localhost・127.0.0.1 以外の接続先では実行を拒否する（本番に投入しない）。
// - 2 組織、各役割の利用者（テスト用の本人確認 test に結び付け済み）、招待中の利用者、操縦者・機体を作る。
// - Sprint 11：組織 A に既存の総飛行時間が 0 と 0 以外（600 分）の機体、操縦者の行に結び付いていない操縦者役割の利用者を加える。
// - Sprint 12a：組織 A に最大離陸重量 0.9kg の機体（重量が分かる機体）と、よく使う地点「フューチャーテック株式会社 本社」を加える。
// - Sprint 12d：組織 A に許可・承認の登録を 6 件加える（OPS_TEST_PERMITS）。サーバーの時計 OPS_TEST_NOW（JST 2027-01-05 12:00）に対し、
//   ①包括・全国・有効 ②個別・円・目視外・機体を限定 ③期限切れ ④失効 ⑤空港等周辺の個別（円） ⑥場所が文章のみ。
// - Sprint 12e：組織 A に事故・ヒヤリハットの記録を 7 件（OPS_TEST_INCIDENTS）、組織 B に 1 件（分離の確認用）を加える。
//   ①事故・けがあり・報告の記録なし ②ヒヤリハット・類型「どれにも当たらない」・対応済み ③現場の簡易記録（詳細が未記入）
//   ④報告の記録あり（DIPS 2.0・番号あり） ⑤報告の記録のあとで事実が変わった ⑥取消済み ⑦日誌（飛行記録）に結び付いた記録。
//   日誌は、組織 A の既存 0 分の機体で 2026-11-10 の飛行記録を 1 件作る（「安全に影響のあった事項」あり。計画には結び付けない）。
//   飛行計画に結び付いた記録は作らない（計画は判定スナップショットを伴い、判定エンジンを持たないこのパッケージでは作れないため。
//   E2E は API で計画を作ってから記録する）。
// - 既に同じ名前の組織があれば何もしない。
import { createHash } from "node:crypto";
import pg from "pg";
import { describeConnection } from "./config";

export const OPS_TEST_ORGS = { a: "テスト組織A", b: "テスト組織B" } as const;
/** 組織 A の機体の登録記号（Sprint 11）。 */
export const OPS_TEST_AIRCRAFT = { zero: "JUSEEDA0001", initial600: "JUSEEDA0600", weighted: "JUSEEDA0900" } as const;

/**
 * 組織 A のよく使う地点（Sprint 12a）。住所は鳥取県西伯郡日吉津村日吉津45番地3、座標は緯度 35.434238・経度 133.380508
 * （リポジトリ内の値は一貫している。本番では運航管理者が地図で確かめてから /ops/places で登録する。コードには直書きしない）。
 */
export const OPS_TEST_PLACE = {
  name: "フューチャーテック株式会社 本社",
  addressText: "鳥取県西伯郡日吉津村日吉津45番地3",
  latitude: 35.434238,
  longitude: 133.380508,
} as const;

/**
 * 組織 A の許可・承認の登録の番号（Sprint 12d）。内容は seedOpsTestData を参照（①包括・全国・DID と夜間・機体と操縦者は限定なし、
 * ②個別・円（本社の周囲 1km）・目視外・補助者が条件・機体を限定、③期限切れ、④失効、⑤空港等周辺の個別（円）、⑥場所が文章のみ）。
 * 有効期間は OPS_TEST_NOW（JST 2027-01-05 12:00）を基準に決めている。
 */
export const OPS_TEST_PERMITS = {
  blanket: "TEST-PERMIT-BLANKET-001",
  individual: "TEST-PERMIT-INDIV-002",
  expired: "TEST-PERMIT-EXPIRED-003",
  revoked: "TEST-PERMIT-REVOKED-004",
  airport: "TEST-PERMIT-AIRPORT-005",
  textOnly: "TEST-PERMIT-TEXT-006",
} as const;

/** 事故・ヒヤリハットの記録（Sprint 12e）の要約。E2E が記録を見分けるのに使う（ID は投入のたびに変わる）。 */
export const OPS_TEST_INCIDENTS = {
  accidentNoReport: "テスト事故：着陸のときにプロペラが手に当たった",
  nearMissDone: "テストヒヤリハット：鳥が近づいたため飛行を中断した",
  quickPending: null,
  reported: "テスト事故：倉庫の壁に機体が接触した",
  changedAfterReport: "テスト事故：駐車場の車に部品が落ちた",
  voided: "テスト：誤って登録した記録",
  journalLinked: "テストヒヤリハット：風にあおられて着陸地点がずれた",
  orgB: "組織Bのテストヒヤリハット",
} as const;

/** 報告の記録の事実の指紋（アプリの incidentFactsSource と同じ規則。apps/web の DB テストが一致を確かめる）。 */
export const incidentFactsFingerprint = (f: {
  readonly kind: string;
  readonly event_types: readonly string[];
  readonly people_injury: string;
  readonly injured_count: number | null;
}): string =>
  createHash("sha256")
    .update(JSON.stringify(["soraban-incident-facts-v1", f.kind, [...f.event_types].sort(), f.people_injury, f.injured_count ?? null]), "utf8")
    .digest("hex");

type SeedMember = {
  readonly key: string;
  readonly org: "a" | "b";
  readonly role: "manager" | "pilot" | "viewer";
  readonly displayName: string;
  /** 結び付け済み（active）にする場合の test の本人確認 ID。未指定は招待中。 */
  readonly authUserId?: string;
};

/** メールアドレスは `${key}@example.test`。authUserId があれば結び付け済み。 */
export const OPS_TEST_MEMBERS: readonly SeedMember[] = [
  { key: "a-manager", org: "a", role: "manager", displayName: "運航 管理子", authUserId: "a-manager" },
  { key: "a-pilot", org: "a", role: "pilot", displayName: "操縦 一郎", authUserId: "a-pilot" },
  { key: "a-pilot2", org: "a", role: "pilot", displayName: "操縦 二郎", authUserId: "a-pilot2" },
  { key: "a-viewer", org: "a", role: "viewer", displayName: "閲覧 花子", authUserId: "a-viewer" },
  // Sprint 11：操縦者役割だが、操縦者の行に結び付いていない（飛行記録・日常点検を作れない）
  { key: "a-pilot-unlinked", org: "a", role: "pilot", displayName: "未結付 五郎", authUserId: "a-pilot-unlinked" },
  { key: "a-invited", org: "a", role: "pilot", displayName: "招待 三郎" },
  { key: "a-invited-unverified", org: "a", role: "viewer", displayName: "招待 四郎" },
  // Neon Auth の模擬サーバー（e2e/mock-neon-auth-server.mjs）でログインする E2E 用（招待中）
  { key: "a-neon", org: "a", role: "pilot", displayName: "ネオン 太郎" },
  { key: "a-neon2", org: "a", role: "viewer", displayName: "ネオン 花子" },
  { key: "b-manager", org: "b", role: "manager", displayName: "組織B 管理者", authUserId: "b-manager" },
  { key: "b-pilot", org: "b", role: "pilot", displayName: "組織B 操縦者", authUserId: "b-pilot" },
];

export const assertLocalTarget = (connectionString: string | undefined): string => {
  if (!connectionString) throw new Error("DATABASE_URL_UNPOOLED が設定されていません。");
  const c = describeConnection(connectionString);
  if (!c) throw new Error("接続文字列を解釈できません。");
  if (c.host !== "localhost" && c.host !== "127.0.0.1") {
    throw new Error(`テスト用の初期データは localhost・127.0.0.1 にだけ投入できます（接続先：${c.host}）。`);
  }
  return connectionString;
};

type Q = Pick<pg.Client, "query">;

const addVersion = async (
  c: Q,
  orgId: string,
  entityType: string,
  entityId: string,
  data: object,
  op: "create" | "update" | "void" = "create",
  reason: string | null = null,
): Promise<void> => {
  await c.query(
    `insert into record_versions (org_id, entity_type, entity_id, op, data, reason, actor_kind)
     values ($1, $2, $3, $4, $5::jsonb, $6, 'system')`,
    [orgId, entityType, entityId, op, JSON.stringify(data), reason],
  );
};

/** 許可・承認の登録の版の data の既定値（12d。version の data は snake_case）。 */
const permitData = (permitNumber: string, over: Record<string, unknown>): Record<string, unknown> => ({
  permit_number: permitNumber,
  permit_number_key: permitNumber.normalize("NFKC").replace(/\s+/g, "").toUpperCase(),
  coverage: "blanket",
  kinds: ["did"],
  airport_names: [],
  issued_on: "2026-09-25",
  valid_from: "2026-10-01",
  valid_to: "2027-09-30",
  status: "active",
  revoked_on: null,
  place_scope: { type: "nationwide" },
  aircraft_scope: { type: "any" },
  pilot_scope: { type: "any" },
  max_altitude_m: null,
  max_weight_kg: null,
  requires_observer: false,
  requires_access_control: false,
  conditions_text: null,
  source: "manual",
  external_ref: {},
  ...over,
});

/** 事故・ヒヤリハットの版の data の既定値（12e。version の data は snake_case。目安は版 1 の類型のデータで決めた値）。 */
const incidentData = (over: Record<string, unknown>): Record<string, unknown> => ({
  kind: "accident",
  occurred_at: "2027-01-04T10:00",
  phase: null,
  place_name: OPS_TEST_PLACE.name,
  latitude: OPS_TEST_PLACE.latitude,
  longitude: OPS_TEST_PLACE.longitude,
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
  summary: null,
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

export type SeedResult = { readonly created: boolean; readonly orgIds: Readonly<Record<"a" | "b", string>> };

export const seedOpsTestData = async (c: Q): Promise<SeedResult> => {
  const existing = await c.query<{ id: string; name: string }>("select id, name from organizations where name = any($1)", [
    Object.values(OPS_TEST_ORGS),
  ]);
  if (existing.rows.length > 0) {
    const byName = new Map(existing.rows.map((r) => [r.name, r.id]));
    return { created: false, orgIds: { a: byName.get(OPS_TEST_ORGS.a) ?? "", b: byName.get(OPS_TEST_ORGS.b) ?? "" } };
  }
  const orgIds = {
    a: (await c.query<{ id: string }>("insert into organizations (name) values ($1) returning id", [OPS_TEST_ORGS.a])).rows[0]!.id,
    b: (await c.query<{ id: string }>("insert into organizations (name) values ($1) returning id", [OPS_TEST_ORGS.b])).rows[0]!.id,
  };
  const memberIds = new Map<string, string>();
  for (const m of OPS_TEST_MEMBERS) {
    const id = (await c.query<{ id: string }>("select gen_random_uuid() as id")).rows[0]!.id;
    memberIds.set(m.key, id);
    await addVersion(c, orgIds[m.org], "member", id, {
      email: `${m.key}@example.test`,
      display_name: m.displayName,
      role: m.role,
      status: m.authUserId ? "active" : "invited",
      auth_provider: m.authUserId ? "test" : null,
      auth_user_id: m.authUserId ?? null,
    });
  }
  const pilot = async (org: "a" | "b", fullName: string, memberKey: string | null, licenseNumber: string | null) => {
    const id = (await c.query<{ id: string }>("select gen_random_uuid() as id")).rows[0]!.id;
    await addVersion(c, orgIds[org], "pilot", id, {
      full_name: fullName,
      has_license: licenseNumber !== null,
      license_class: licenseNumber !== null ? "second" : null,
      license_number: licenseNumber,
      license_expires_on: licenseNumber !== null ? "2029-03-31" : null,
      limitation_type: false,
      limitation_weight: false,
      limitation_daytime: false,
      limitation_vlos: true,
      member_id: memberKey ? memberIds.get(memberKey)! : null,
    });
  };
  await pilot("a", "操縦 一郎", "a-pilot", "TEST-11112222");
  await pilot("a", "操縦 二郎", "a-pilot2", "TEST-33334444");
  await pilot("b", "組織B 操縦者", "b-pilot", "TEST-55556666");
  const aircraft = async (
    org: "a" | "b",
    mark: string,
    modelName: string,
    serial: string,
    initialFlightMinutes: number,
    maxTakeoffWeightKg: number | null = null,
  ): Promise<string> => {
    const id = (await c.query<{ id: string }>("select gen_random_uuid() as id")).rows[0]!.id;
    await addVersion(c, orgIds[org], "aircraft", id, {
      registration_mark: mark,
      model_name: modelName,
      manufacturer: "テスト製作所",
      serial_number: serial,
      type_certified: false,
      type_cert_category: null,
      type_cert_model: null,
      type_cert_number: null,
      airworthiness_class: null,
      airworthiness_cert_number: null,
      max_takeoff_weight_kg: maxTakeoffWeightKg,
      initial_flight_minutes: initialFlightMinutes,
      status: "active",
    });
    return id;
  };
  await aircraft("b", "JUORGB0001", "組織Bの機体", "B-0001", 0);
  // Sprint 11：既存の総飛行時間が 0 と 0 以外の機体
  await aircraft("a", OPS_TEST_AIRCRAFT.zero, "点検機（既存 0 分）", "A-0001", 0);
  await aircraft("a", OPS_TEST_AIRCRAFT.initial600, "空撮機（既存 600 分）", "A-0002", 600);
  // Sprint 12a：最大離陸重量が分かる機体（飛行計画の判定は、登録機体の最大離陸重量を機体重量として使う）
  const weightedId = await aircraft("a", OPS_TEST_AIRCRAFT.weighted, "計画機（最大離陸重量 0.9kg）", "A-0003", 0, 0.9);
  // Sprint 12a：よく使う地点
  await addVersion(c, orgIds.a, "saved_place", (await c.query<{ id: string }>("select gen_random_uuid() as id")).rows[0]!.id, {
    name: OPS_TEST_PLACE.name,
    address_text: OPS_TEST_PLACE.addressText,
    latitude: OPS_TEST_PLACE.latitude,
    longitude: OPS_TEST_PLACE.longitude,
    note: null,
  });
  // Sprint 12d：許可・承認の登録（組織 A）。円の中心は本社の座標（OPS_TEST_PLACE）
  const permit = async (number: string, over: Record<string, unknown>, revokedOn?: string) => {
    const id = (await c.query<{ id: string }>("select gen_random_uuid() as id")).rows[0]!.id;
    const data = permitData(number, over);
    await addVersion(c, orgIds.a, "permit_registration", id, data);
    if (revokedOn) {
      await addVersion(c, orgIds.a, "permit_registration", id, { ...data, status: "revoked", revoked_on: revokedOn }, "update", "許可の失効（テスト用）");
    }
  };
  const here = { lat: OPS_TEST_PLACE.latitude, lng: OPS_TEST_PLACE.longitude };
  await permit(OPS_TEST_PERMITS.blanket, { kinds: ["did", "night"], conditions_text: "飛行マニュアルに従う（テスト用）" });
  await permit(OPS_TEST_PERMITS.individual, {
    coverage: "individual",
    kinds: ["bvlos"],
    valid_from: "2026-12-01",
    valid_to: "2027-03-31",
    place_scope: { type: "circles", circles: [{ name: "本社の周囲", ...here, radiusM: 1000 }] },
    aircraft_scope: { type: "listed", ids: [weightedId] },
    requires_observer: true,
  });
  await permit(OPS_TEST_PERMITS.expired, { kinds: ["did"], valid_from: "2025-04-01", valid_to: "2026-03-31", issued_on: "2025-03-20" });
  await permit(OPS_TEST_PERMITS.revoked, { kinds: ["night"] }, "2026-12-15");
  await permit(OPS_TEST_PERMITS.airport, {
    coverage: "individual",
    kinds: ["airport"],
    airport_names: ["テスト空港"],
    valid_from: "2026-12-01",
    valid_to: "2027-06-30",
    place_scope: { type: "circles", circles: [{ name: "空港の周辺", ...here, radiusM: 3000 }] },
  });
  await permit(OPS_TEST_PERMITS.textOnly, { kinds: ["150m"], place_scope: { type: "text", text: "許可書の別紙に記載の区域（テスト用）" } });

  // Sprint 12e：事故・ヒヤリハット（組織 A に 7 件、組織 B に 1 件）
  const newId = async () => (await c.query<{ id: string }>("select gen_random_uuid() as id")).rows[0]!.id;
  const pilotA = (await c.query<{ id: string }>("select id from pilots where org_id = $1 and full_name = '操縦 一郎'", [orgIds.a])).rows[0]!.id;
  const zeroAircraft = (await c.query<{ id: string }>("select id from aircraft where org_id = $1 and registration_mark = $2", [orgIds.a, OPS_TEST_AIRCRAFT.zero])).rows[0]!.id;
  const managerA = memberIds.get("a-manager")!;
  const incident = async (org: "a" | "b", over: Record<string, unknown>): Promise<{ id: string; data: Record<string, unknown> }> => {
    const id = await newId();
    const data = incidentData(over);
    await addVersion(c, orgIds[org], "incident_record", id, data);
    return { id, data };
  };
  const report = async (incidentId: string, facts: Record<string, unknown>, over: Record<string, unknown>) => {
    await c.query(
      `insert into incident_report_records (org_id, incident_id, action, done_at, channel, channel_note, reference, reference_absent, note,
         checks, target_record_id, incident_version, facts_fingerprint, reason, recorded_by_member_id, recorded_by_name, recorded_by_role,
         created_at, content_hash)
       values ($1, $2, $3, ops_jst_minute_to_timestamptz($4), $5, null, $6, false, $7, $8::jsonb, null, 1, $9, null, $10, '-', 'viewer', now(), '-')`,
      [
        orgIds.a,
        incidentId,
        over["action"],
        over["done_at"],
        over["channel"] ?? null,
        over["reference"] ?? null,
        over["note"] ?? null,
        JSON.stringify(over["checks"]),
        incidentFactsFingerprint(facts as never),
        managerA,
      ],
    );
  };
  // ① 事故・けがあり（軽傷 1 名）・報告の記録なし（目安は possible。「今日」に報告の要否の確認が出る）
  await incident("a", {
    occurred_at: "2027-01-04T10:00",
    phase: "landing",
    pilot_id: pilotA,
    event_types: ["minor_injury"],
    injured_count: 1,
    contacts_made: ["internal_manager"],
    summary: OPS_TEST_INCIDENTS.accidentNoReport,
    details: "着陸のあと、回転が止まる前に機体に近づいた（テスト用）",
  });
  // ② ヒヤリハット・どれにも当たらない・対応済み（目安は none_selected）
  await incident("a", {
    kind: "near_miss",
    occurred_at: "2027-01-02T14:30",
    phase: "in_flight",
    event_types: ["none"],
    people_injury: "no",
    summary: OPS_TEST_INCIDENTS.nearMissDone,
    prevention_note: "鳥の多い時間帯を避ける（テスト用）",
    follow_up_status: "done",
    follow_up_on: "2027-01-03",
    guidance_level: "none_selected",
  });
  // ③ 現場の簡易記録（詳細が未記入。類型は「まだ分からない」、機体の損傷は「わからない」。座標・自由記述は持たない）
  await incident("a", {
    kind: "undetermined",
    occurred_at: "2027-01-05T09:00",
    place_name: null,
    latitude: null,
    longitude: null,
    event_types: ["unknown"],
    people_injury: "no",
    aircraft_damage: "unknown",
    detail_pending: true,
    source: "field_quick",
    client_request_id: await newId(),
  });
  // ④ 報告の記録あり（DIPS 2.0・番号あり）
  const r4 = await incident("a", {
    occurred_at: "2026-12-20T11:00",
    event_types: ["property_damage"],
    people_injury: "no",
    aircraft_damage: "yes",
    summary: OPS_TEST_INCIDENTS.reported,
  });
  await report(r4.id, r4.data, { action: "reported", done_at: "2026-12-20T15:00", channel: "dips", reference: "TEST-REPORT-0001", checks: { reportCompleted: true } });
  // ⑤ 報告の記録のあとで事実が変わった（類型に軽傷を足し、けがありに訂正）
  const r5 = await incident("a", {
    occurred_at: "2026-12-25T10:30",
    event_types: ["property_damage"],
    people_injury: "no",
    aircraft_damage: "no",
    summary: OPS_TEST_INCIDENTS.changedAfterReport,
  });
  await report(r5.id, r5.data, { action: "reported", done_at: "2026-12-25T16:00", channel: "dips", reference: "TEST-REPORT-0002", checks: { reportCompleted: true } });
  await addVersion(
    c,
    orgIds.a,
    "incident_record",
    r5.id,
    { ...r5.data, event_types: ["property_damage", "minor_injury"], people_injury: "yes", injured_count: 1 },
    "update",
    "けがをした人がいたことが分かった（テスト用）",
  );
  // ⑥ 取消済み
  const r6 = await incident("a", { kind: "near_miss", occurred_at: "2026-12-28T09:00", event_types: ["none"], people_injury: "no", summary: OPS_TEST_INCIDENTS.voided, guidance_level: "none_selected" });
  await addVersion(c, orgIds.a, "incident_record", r6.id, r6.data, "void", "誤って登録した（テスト用）");
  // ⑦ 日誌（飛行記録）に結び付いた記録（操縦ミスなどによる操縦不能の事実だけ。目安は none_selected）
  const flightId = await newId();
  await addVersion(c, orgIds.a, "flight_record", flightId, {
    aircraft_id: zeroAircraft,
    pilot_id: pilotA,
    daily_inspection_id: null,
    flight_plan_id: null,
    snapshot_id: null,
    purpose: "点検",
    waypoints: null,
    specific_flight_types: [],
    takeoff_place: OPS_TEST_PLACE.name,
    takeoff_lat: null,
    takeoff_lng: null,
    takeoff_accuracy_m: null,
    landing_place: OPS_TEST_PLACE.name,
    landing_lat: null,
    landing_lng: null,
    landing_accuracy_m: null,
    takeoff_at: "2026-11-10T10:00",
    landing_at: "2026-11-10T10:20",
    safety_issue: true,
    safety_issue_detail: "風にあおられて着陸地点が 3m ずれた（テスト用）",
    defects: [],
    pilot_name: "操縦 一郎",
    pilot_license_number: "TEST-11112222",
    pilot_version: 1,
    client_request_id: null,
  });
  await incident("a", {
    kind: "near_miss",
    occurred_at: "2026-11-10T10:15",
    phase: "landing",
    flight_record_id: flightId,
    aircraft_id: zeroAircraft,
    pilot_id: pilotA,
    event_types: ["loss_by_operation"],
    people_injury: "no",
    summary: OPS_TEST_INCIDENTS.journalLinked,
    guidance_level: "none_selected",
  });
  // 組織 B（分離の確認用）
  await incident("b", {
    kind: "near_miss",
    occurred_at: "2027-01-03T13:00",
    place_name: "組織Bの現場",
    latitude: null,
    longitude: null,
    event_types: ["none"],
    people_injury: "no",
    summary: OPS_TEST_INCIDENTS.orgB,
    guidance_level: "none_selected",
  });
  return { created: true, orgIds };
};
