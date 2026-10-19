// 運航管理の DB の読み書き（Sprint 10 設計 B・C）。
// - 読み出しはすべて org_id を必須の引数に取る（組織の条件を付け忘れない）。
// - 書き込みは record_versions への追加だけ（ヘッド表は DB のトリガーが作る）。
// - 楽観的排他は set_config('soraban.expected_version', …, true) で DB のトリガーに渡す（0006）。
import type {
  AircraftRow,
  DailyInspectionRow,
  FlightRecordRow,
  MemberRow,
  OrganizationRow,
  PilotRow,
  RecordEntityTypeDb,
  RecordOpDb,
  RecordVersionRow,
} from "@soraban/db";

/** pg.Pool が満たす最小インターフェース。 */
export type OpsDb = {
  query: <R = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<{ rows: R[]; rowCount: number | null }>;
  connect: () => Promise<{
    query: <R = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<{ rows: R[]; rowCount: number | null }>;
    release: () => void;
  }>;
};

/** 業務上の誤り（状態コードと機械可読のコード）。 */
export class OpsError extends Error {
  override readonly name = "OpsError";
  constructor(
    readonly status: number,
    readonly code: string,
    readonly fieldErrors?: Readonly<Record<string, string>>,
    /** 項目ごとの理由コード（Sprint 11。例：takeoffAt → time_format）。 */
    readonly fieldCodes?: Readonly<Record<string, string>>,
  ) {
    super(code);
  }
}

/** pg の例外を OpsError に写す。写せないものはそのまま投げ直す。 */
export const mapDbError = (e: unknown): never => {
  const o = (e ?? {}) as { code?: unknown; detail?: unknown; constraint?: unknown };
  switch (o.code) {
    case "SB404":
      throw new OpsError(404, "not_found");
    case "SB409": {
      const d = typeof o.detail === "string" ? o.detail : "conflict";
      throw new OpsError(409, d);
    }
    case "23505": {
      const c = typeof o.constraint === "string" ? o.constraint : "";
      if (c.endsWith("_request")) throw new OpsError(409, "duplicate_request");
      throw new OpsError(409, c.includes("registration") ? "duplicate_registration" : c.includes("email") ? "duplicate_email" : c.includes("pilots_member") ? "member_already_linked" : "duplicate");
    }
    case "23503":
      throw new OpsError(404, "not_found");
    case "23514": {
      // 0008 のトリガーが detail で理由を示す検査（機体の変更・別の機体の日常点検）
      if (o.detail === "aircraft_immutable") {
        throw new OpsError(400, "invalid_input", { aircraftId: "機体は訂正で変えられません" }, { aircraftId: "aircraft_immutable" });
      }
      if (o.detail === "inspection_mismatch") {
        throw new OpsError(400, "invalid_input", { dailyInspectionId: "同じ機体の日常点検を選んでください" }, { dailyInspectionId: "inspection_mismatch" });
      }
      throw new OpsError(400, "invalid_input");
    }
    case "23502":
    case "22P02":
    case "22007":
    case "22008":
      throw new OpsError(400, "invalid_input");
  }
  throw e;
};

export type AppendVersion = {
  readonly orgId: string;
  readonly entityType: RecordEntityTypeDb;
  readonly entityId: string;
  readonly op: RecordOpDb;
  readonly data: Readonly<Record<string, unknown>>;
  readonly reason: string | null;
  /** 操作した利用者。null はシステム（初回ログインの結び付け等）。 */
  readonly actorMemberId: string | null;
  readonly expectedVersion?: number;
};

/** 版を 1 つ追加する。version_no・created_at・prev_hash・content_hash は DB が決める。 */
export const appendVersion = async (db: OpsDb, v: AppendVersion): Promise<number> => {
  const c = await db.connect();
  try {
    await c.query("begin");
    if (v.expectedVersion !== undefined) {
      await c.query("select set_config('soraban.expected_version', $1, true)", [String(v.expectedVersion)]);
    }
    const r = await c.query<{ version_no: number }>(
      `insert into record_versions (org_id, entity_type, entity_id, op, data, reason, actor_kind, actor_member_id)
       values ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)
       returning version_no`,
      [
        v.orgId,
        v.entityType,
        v.entityId,
        v.op,
        JSON.stringify(v.data),
        v.reason,
        v.actorMemberId ? "member" : "system",
        v.actorMemberId,
      ],
    );
    await c.query("commit");
    return r.rows[0]!.version_no;
  } catch (e) {
    await c.query("rollback").catch(() => undefined);
    return mapDbError(e);
  } finally {
    c.release();
  }
};

// ---- 読み出し ------------------------------------------------

export const findMemberByAuth = async (db: OpsDb, provider: string, authUserId: string): Promise<MemberRow | null> =>
  (
    await db.query<MemberRow>(
      "select * from members where auth_provider = $1 and auth_user_id = $2 and voided_at is null",
      [provider, authUserId],
    )
  ).rows[0] ?? null;

export const findInvitedByEmail = async (db: OpsDb, email: string): Promise<MemberRow[]> =>
  (
    await db.query<MemberRow>(
      "select * from members where email = $1 and status = 'invited' and auth_user_id is null and voided_at is null",
      [email],
    )
  ).rows;

export const getOrganization = async (db: OpsDb, orgId: string): Promise<OrganizationRow | null> =>
  (await db.query<OrganizationRow>("select * from organizations where id = $1", [orgId])).rows[0] ?? null;

export const getMember = async (db: OpsDb, orgId: string, id: string): Promise<MemberRow | null> =>
  (await db.query<MemberRow>("select * from members where org_id = $1 and id = $2", [orgId, id])).rows[0] ?? null;

export const listMembers = async (db: OpsDb, orgId: string): Promise<MemberRow[]> =>
  (await db.query<MemberRow>("select * from members where org_id = $1 and voided_at is null order by created_at, id", [orgId]))
    .rows;

/** 機体の行と、現在の総飛行時間（Sprint 11。aircraft_flight_totals）。 */
export type AircraftWithTotal = AircraftRow & { readonly total_flight_minutes: number; readonly flight_count: number };

const AIRCRAFT_SELECT = `select a.*, t.total_flight_minutes, t.flight_count
   from aircraft a join aircraft_flight_totals t on t.aircraft_id = a.id`;

export const getAircraft = async (db: OpsDb, orgId: string, id: string): Promise<AircraftWithTotal | null> =>
  (await db.query<AircraftWithTotal>(`${AIRCRAFT_SELECT} where a.org_id = $1 and a.id = $2`, [orgId, id])).rows[0] ?? null;

export const listAircraft = async (db: OpsDb, orgId: string, includeVoided: boolean): Promise<AircraftWithTotal[]> =>
  (
    await db.query<AircraftWithTotal>(
      `${AIRCRAFT_SELECT} where a.org_id = $1 ${includeVoided ? "" : "and a.voided_at is null"}
        order by a.voided_at nulls first, a.registration_mark, a.id`,
      [orgId],
    )
  ).rows;

/** 操縦者の行と、そらばんで記録した飛行の累計（Sprint 11。pilot_flight_totals）。 */
export type PilotWithTotal = PilotRow & { readonly recorded_flight_minutes: number; readonly recorded_flight_count: number };

const PILOT_SELECT = `select p.*, t.total_flight_minutes as recorded_flight_minutes, t.flight_count as recorded_flight_count
   from pilots p join pilot_flight_totals t on t.pilot_id = p.id`;

export const getPilot = async (db: OpsDb, orgId: string, id: string): Promise<PilotWithTotal | null> =>
  (await db.query<PilotWithTotal>(`${PILOT_SELECT} where p.org_id = $1 and p.id = $2`, [orgId, id])).rows[0] ?? null;

export const listPilots = async (db: OpsDb, orgId: string, includeVoided: boolean): Promise<PilotWithTotal[]> =>
  (
    await db.query<PilotWithTotal>(
      `${PILOT_SELECT} where p.org_id = $1 ${includeVoided ? "" : "and p.voided_at is null"}
        order by p.voided_at nulls first, p.full_name, p.id`,
      [orgId],
    )
  ).rows;

export const findPilotByMember = async (db: OpsDb, orgId: string, memberId: string): Promise<PilotRow | null> =>
  (
    await db.query<PilotRow>("select * from pilots where org_id = $1 and member_id = $2 and voided_at is null", [
      orgId,
      memberId,
    ])
  ).rows[0] ?? null;

export type VersionWithActor = RecordVersionRow & { readonly actor_display_name: string | null };

export const listVersions = async (
  db: OpsDb,
  orgId: string,
  entityType: RecordEntityTypeDb,
  entityId: string,
): Promise<VersionWithActor[]> =>
  (
    await db.query<VersionWithActor>(
      `select v.*, m.display_name as actor_display_name
         from record_versions v left join members m on m.id = v.actor_member_id
        where v.org_id = $1 and v.entity_type = $2 and v.entity_id = $3
        order by v.version_no`,
      [orgId, entityType, entityId],
    )
  ).rows;

/** 実体の最新の版の data（訂正の合成と取消の版の data に使う。ヘッド表から作り直さない）。 */
export const latestVersionData = async (
  db: OpsDb,
  orgId: string,
  entityType: RecordEntityTypeDb,
  entityId: string,
): Promise<Record<string, unknown> | null> =>
  (
    await db.query<{ data: Record<string, unknown> }>(
      `select data from record_versions where org_id = $1 and entity_type = $2 and entity_id = $3
        order by version_no desc limit 1`,
      [orgId, entityType, entityId],
    )
  ).rows[0]?.data ?? null;

// ---- 飛行記録・日常点検記録（Sprint 11） ---------------------

/** 飛行記録の行に、機体の登録記号・総飛行時間（取消済みは null）・飛行年月日の文字列を付けたもの。 */
export type FlightWithTotal = FlightRecordRow & {
  readonly registration_mark: string;
  readonly total_flight_minutes: number | null;
  readonly flight_date_text: string;
};

const FLIGHT_SELECT = `select f.*, a.registration_mark, t.total_flight_minutes::integer as total_flight_minutes,
        to_char(f.flight_date, 'YYYY-MM-DD') as flight_date_text
   from flight_records f
   join aircraft a on a.id = f.aircraft_id
   left join flight_record_totals t on t.id = f.id`;

export const getFlight = async (db: OpsDb, orgId: string, id: string): Promise<FlightWithTotal | null> =>
  (await db.query<FlightWithTotal>(`${FLIGHT_SELECT} where f.org_id = $1 and f.id = $2`, [orgId, id])).rows[0] ?? null;

export const findFlightByRequest = async (db: OpsDb, orgId: string, requestId: string): Promise<FlightWithTotal | null> =>
  (await db.query<FlightWithTotal>(`${FLIGHT_SELECT} where f.org_id = $1 and f.client_request_id = $2`, [orgId, requestId]))
    .rows[0] ?? null;

export type RecordFilter = {
  readonly aircraftId?: string;
  readonly pilotId?: string;
  /** JST の日付（YYYY-MM-DD）。両端を含む。 */
  readonly from?: string;
  readonly to?: string;
  readonly includeVoided?: boolean;
};

const LIST_LIMIT = 500;

/** 飛行記録の一覧（新しい順、最大 500 件）。 */
export const listFlights = async (db: OpsDb, orgId: string, f: RecordFilter): Promise<FlightWithTotal[]> => {
  const where = ["f.org_id = $1"];
  const params: unknown[] = [orgId];
  if (f.aircraftId) where.push(`f.aircraft_id = $${params.push(f.aircraftId)}`);
  if (f.pilotId) where.push(`f.pilot_id = $${params.push(f.pilotId)}`);
  if (f.from) where.push(`f.flight_date >= $${params.push(f.from)}::date`);
  if (f.to) where.push(`f.flight_date <= $${params.push(f.to)}::date`);
  if (!f.includeVoided) where.push("f.voided_at is null");
  return (
    await db.query<FlightWithTotal>(
      `${FLIGHT_SELECT} where ${where.join(" and ")} order by f.takeoff_at desc, f.id desc limit ${LIST_LIMIT}`,
      params,
    )
  ).rows;
};

export type InspectionWithAircraft = DailyInspectionRow & {
  readonly registration_mark: string;
  readonly inspected_date_text: string;
};

const INSPECTION_SELECT = `select i.*, a.registration_mark, to_char(i.inspected_date, 'YYYY-MM-DD') as inspected_date_text
   from daily_inspections i join aircraft a on a.id = i.aircraft_id`;

export const getInspection = async (db: OpsDb, orgId: string, id: string): Promise<InspectionWithAircraft | null> =>
  (await db.query<InspectionWithAircraft>(`${INSPECTION_SELECT} where i.org_id = $1 and i.id = $2`, [orgId, id])).rows[0] ?? null;

export const findInspectionByRequest = async (
  db: OpsDb,
  orgId: string,
  requestId: string,
): Promise<InspectionWithAircraft | null> =>
  (await db.query<InspectionWithAircraft>(`${INSPECTION_SELECT} where i.org_id = $1 and i.client_request_id = $2`, [orgId, requestId]))
    .rows[0] ?? null;

/** 日常点検記録の一覧（新しい順、最大 500 件）。 */
export const listInspections = async (db: OpsDb, orgId: string, f: RecordFilter): Promise<InspectionWithAircraft[]> => {
  const where = ["i.org_id = $1"];
  const params: unknown[] = [orgId];
  if (f.aircraftId) where.push(`i.aircraft_id = $${params.push(f.aircraftId)}`);
  if (f.pilotId) where.push(`i.pilot_id = $${params.push(f.pilotId)}`);
  if (f.from) where.push(`i.inspected_date >= $${params.push(f.from)}::date`);
  if (f.to) where.push(`i.inspected_date <= $${params.push(f.to)}::date`);
  if (!f.includeVoided) where.push("i.voided_at is null");
  return (
    await db.query<InspectionWithAircraft>(
      `${INSPECTION_SELECT} where ${where.join(" and ")} order by i.inspected_at desc, i.id desc limit ${LIST_LIMIT}`,
      params,
    )
  ).rows;
};

/** 機体の、ある時刻以前で最新の（取消していない）日常点検。 */
export const latestInspectionBefore = async (
  db: OpsDb,
  orgId: string,
  aircraftId: string,
  at: Date,
): Promise<DailyInspectionRow | null> =>
  (
    await db.query<DailyInspectionRow>(
      `select * from daily_inspections where org_id = $1 and aircraft_id = $2 and voided_at is null and inspected_at <= $3
        order by inspected_at desc limit 1`,
      [orgId, aircraftId, at],
    )
  ).rows[0] ?? null;

/** 機体の、ある JST の日付の（取消していない）日常点検の件数。 */
export const countInspectionsOn = async (db: OpsDb, orgId: string, aircraftId: string, date: string): Promise<number> =>
  Number(
    (
      await db.query<{ n: number }>(
        `select count(*)::int as n from daily_inspections
          where org_id = $1 and aircraft_id = $2 and voided_at is null and inspected_date = $3::date`,
        [orgId, aircraftId, date],
      )
    ).rows[0]?.n ?? 0,
  );
