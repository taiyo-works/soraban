// 運航管理のテスト用の初期データ（Sprint 10 設計 G）。CI の E2E-DB とローカルの確認で使う。
//   pnpm db:seed:ops-test   （接続先は DATABASE_URL_UNPOOLED。オーナーロールで接続する）
// - localhost・127.0.0.1 以外の接続先では実行を拒否する（本番に投入しない）。
// - 2 組織、各役割の利用者（テスト用の本人確認 test に結び付け済み）、招待中の利用者、操縦者・機体を作る。
// - Sprint 11：組織 A に既存の総飛行時間が 0 と 0 以外（600 分）の機体、操縦者の行に結び付いていない操縦者役割の利用者を加える。
// - Sprint 12a：組織 A に最大離陸重量 0.9kg の機体（重量が分かる機体）と、よく使う地点「フューチャーテック株式会社 本社」を加える。
// - 既に同じ名前の組織があれば何もしない。
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

const addVersion = async (c: Q, orgId: string, entityType: string, entityId: string, data: object): Promise<void> => {
  await c.query(
    `insert into record_versions (org_id, entity_type, entity_id, op, data, actor_kind)
     values ($1, $2, $3, 'create', $4::jsonb, 'system')`,
    [orgId, entityType, entityId, JSON.stringify(data)],
  );
};

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
  ) => {
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
  };
  await aircraft("b", "JUORGB0001", "組織Bの機体", "B-0001", 0);
  // Sprint 11：既存の総飛行時間が 0 と 0 以外の機体
  await aircraft("a", OPS_TEST_AIRCRAFT.zero, "点検機（既存 0 分）", "A-0001", 0);
  await aircraft("a", OPS_TEST_AIRCRAFT.initial600, "空撮機（既存 600 分）", "A-0002", 600);
  // Sprint 12a：最大離陸重量が分かる機体（飛行計画の判定は、登録機体の最大離陸重量を機体重量として使う）
  await aircraft("a", OPS_TEST_AIRCRAFT.weighted, "計画機（最大離陸重量 0.9kg）", "A-0003", 0, 0.9);
  // Sprint 12a：よく使う地点
  await addVersion(c, orgIds.a, "saved_place", (await c.query<{ id: string }>("select gen_random_uuid() as id")).rows[0]!.id, {
    name: OPS_TEST_PLACE.name,
    address_text: OPS_TEST_PLACE.addressText,
    latitude: OPS_TEST_PLACE.latitude,
    longitude: OPS_TEST_PLACE.longitude,
    note: null,
  });
  return { created: true, orgIds };
};
