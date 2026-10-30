// 運航管理の DB の読み書き（Sprint 10 設計 B・C）。
// - 読み出しはすべて org_id を必須の引数に取る（組織の条件を付け忘れない）。
// - 書き込みは record_versions への追加だけ（ヘッド表は DB のトリガーが作る）。
// - 楽観的排他は set_config('soraban.expected_version', …, true) で DB のトリガーに渡す（0006）。
import type {
  AircraftRow,
  DailyInspectionRow,
  EvidenceLogInsert,
  FlightPlanRow,
  FlightFieldEventRow,
  FlightRecordRow,
  FlightReportAttemptRow,
  FlightReportRow,
  IncidentRecordRow,
  IncidentReportRecordRow,
  JudgementSnapshotRow,
  MemberRow,
  OrganizationRow,
  PilotRow,
  PlanConfirmationRow,
  PermitRegistrationRow,
  PlanProcedureRecordRow,
  RecordEntityTypeDb,
  RecordOpDb,
  RecordVersionRow,
  SavedPlaceRow,
  SnapshotReasonDb,
} from "@soraban/db";
import type { SpecificFlightFlag } from "@soraban/regulations";
import { evidenceLogParams, INSERT_EVIDENCE_LOG_SQL } from "@soraban/db";

/** pg.Pool が満たす最小インターフェース。 */
export type OpsDb = {
  query: <R = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<{ rows: R[]; rowCount: number | null }>;
  connect: () => Promise<{
    query: <R = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<{ rows: R[]; rowCount: number | null }>;
    release: () => void;
  }>;
};

/** 読み出しだけに使う最小のインターフェース（pool でもトランザクションの接続でもよい）。 */
export type Queryable = Pick<OpsDb, "query">;

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
      if (c.includes("saved_places_name")) throw new OpsError(409, "duplicate_name");
      if (c.includes("permit_regs_number")) throw new OpsError(409, "duplicate_number");
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

/** トランザクションの中で使う接続（pg.PoolClient が満たす最小インターフェース）。 */
export type OpsTx = {
  query: <R = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<{ rows: R[]; rowCount: number | null }>;
};

/**
 * 版を 1 つ追加する（呼び出し側が開いたトランザクションの中で）。version_no・created_at・prev_hash・content_hash は DB が決める。
 * 失敗しても rollback はしない（呼び出し側の withTransaction が行う）。
 */
export const appendVersionOn = async (c: OpsTx, v: AppendVersion): Promise<number> => {
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
  return r.rows[0]!.version_no;
};

/**
 * 1 つのトランザクションで処理する。どれかが失敗したら全部取り消す（コミット時に検査される遅延可能な外部キーの失敗も含む）。
 * DB の例外は OpsError に写す。OpsError はそのまま投げる。
 */
export const withTransaction = async <T,>(db: OpsDb, fn: (c: OpsTx) => Promise<T>): Promise<T> => {
  const c = await db.connect();
  try {
    await c.query("begin");
    const r = await fn(c);
    await c.query("commit");
    return r;
  } catch (e) {
    await c.query("rollback").catch(() => undefined);
    if (e instanceof OpsError) throw e;
    return mapDbError(e);
  } finally {
    c.release();
  }
};

/** 版を 1 つ追加する。version_no・created_at・prev_hash・content_hash は DB が決める。 */
export const appendVersion = (db: OpsDb, v: AppendVersion): Promise<number> =>
  withTransaction(db, (c) => appendVersionOn(c, v));

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

export type RecordFilter = {
  readonly aircraftId?: string;
  readonly pilotId?: string;
  /** JST の日付（YYYY-MM-DD）。両端を含む。 */
  readonly from?: string;
  readonly to?: string;
  readonly includeVoided?: boolean;
};

/** 一覧の 1 回の上限。導出の絞り込み（SQL にできないもの）は、この単位でページを順に読んで絞る。 */
export const LIST_LIMIT = 500;

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

/**
 * 日常点検記録の一覧（新しい順、最大 500 件）。
 * timing（飛行前／飛行後）は省略できる。省略すると全区分（従来どおり）。渡したときは、件数の上限（500 件）の**前**に絞り込む
 * （上限のあとに絞ると、500 件より古い位置にある区分の記録が「0 件」に見える）。
 */
export const listInspections = async (db: OpsDb, orgId: string, f: RecordFilter, timing?: "pre_flight" | "post_flight"): Promise<InspectionWithAircraft[]> => {
  const where = ["i.org_id = $1"];
  const params: unknown[] = [orgId];
  if (timing) where.push(`i.timing = $${params.push(timing)}`);
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

/**
 * 送信の識別子（clientRequestId）で作られた記録の ID と、作成した利用者（版 1 の actor_member_id）。
 * 二重送信の判定は作成者も含めて行う（別の利用者が同じ識別子を送っても、既存の記録を返さない）。
 */
export const findRequestOwner = async (
  db: OpsDb,
  orgId: string,
  entityType: "flight_record" | "daily_inspection" | "flight_plan",
  requestId: string,
): Promise<{ readonly id: string; readonly actor_member_id: string | null } | null> => {
  const table =
    entityType === "flight_record" ? "flight_records" : entityType === "flight_plan" ? "flight_plans" : "daily_inspections";
  return (
    (
      await db.query<{ id: string; actor_member_id: string | null }>(
        `select h.id, v.actor_member_id
           from ${table} h
           join record_versions v on v.entity_type = $3 and v.entity_id = h.id and v.version_no = 1
          where h.org_id = $1 and h.client_request_id = $2`,
        [orgId, requestId, entityType],
      )
    ).rows[0] ?? null
  );
};

// ---- 飛行計画・判定スナップショット・確認・よく使う地点（Sprint 12a） --------

/** 地点判定の証跡を evidence_log に書く（同じトランザクションの中で。EVIDENCE_LOG の設定に関係なく。同じ ID は無視する）。 */
export const insertEvidenceOn = async (c: OpsTx, row: EvidenceLogInsert): Promise<void> => {
  await c.query(INSERT_EVIDENCE_LOG_SQL, evidenceLogParams(row) as unknown[]);
};

export type SnapshotInsert = {
  readonly id: string;
  readonly orgId: string;
  readonly planId: string;
  readonly reason: SnapshotReasonDb;
  readonly input: unknown;
  readonly result: unknown;
  readonly verdictLevel: string;
  readonly verdictUnknownCount: number;
  readonly category: string;
  readonly engineVersion: string;
  readonly checkedAt: string;
  readonly checkEvidenceId: string;
  readonly diagnosisEvidenceId: string;
  readonly datasets: unknown;
  readonly proceduresRevision: number;
  readonly proceduresVerifiedAt: string;
  readonly createdByMemberId: string;
};

/** スナップショットを 1 件追加する。seq・prev_hash・content_hash・created_at は DB が決める（送らない）。 */
export const insertSnapshotOn = async (c: OpsTx, s: SnapshotInsert): Promise<void> => {
  await c.query(
    `insert into judgement_snapshots (id, org_id, plan_id, reason, input, result, verdict_level, verdict_unknown_count,
       category, engine_version, checked_at, check_evidence_id, diagnosis_evidence_id, datasets,
       procedures_revision, procedures_verified_at, created_by_member_id)
     values ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, $15, $16, $17)`,
    [
      s.id,
      s.orgId,
      s.planId,
      s.reason,
      JSON.stringify(s.input),
      JSON.stringify(s.result),
      s.verdictLevel,
      s.verdictUnknownCount,
      s.category,
      s.engineVersion,
      s.checkedAt,
      s.checkEvidenceId,
      s.diagnosisEvidenceId,
      JSON.stringify(s.datasets),
      s.proceduresRevision,
      s.proceduresVerifiedAt,
      s.createdByMemberId,
    ],
  );
};

/** 計画の行に、機体・操縦者・現在のスナップショットの要約を付けたもの。result の全文は読まない（一覧で重くしない）。 */
export type PlanWithJoins = FlightPlanRow & {
  readonly planned_date_text: string;
  readonly registration_mark: string;
  readonly model_name: string;
  readonly aircraft_max_takeoff_weight_kg: string | null;
  readonly pilot_name: string;
  readonly pilot_member_id: string | null;
  readonly snapshot_seq: number;
  readonly snapshot_reason: SnapshotReasonDb;
  readonly snapshot_input: Record<string, unknown>;
  readonly verdict_level: JudgementSnapshotRow["verdict_level"];
  readonly verdict_unknown_count: number;
  readonly category: JudgementSnapshotRow["category"];
  readonly engine_version: string;
  readonly snapshot_checked_at: string | Date;
  readonly check_evidence_id: string;
  readonly diagnosis_evidence_id: string;
  readonly snapshot_datasets: JudgementSnapshotRow["datasets"];
  readonly procedures_revision: number;
  readonly procedures_verified_at: string;
  readonly snapshot_created_at: string | Date;
  /**
   * 通報の要否・次にやることの判定に使う結果の一部（droneWeightG・category・flags・verdict.purpose・verdict.unknownCount、
   * 手続きの procedureId と期限）。result の全体は読まない（一覧で重くしない）。
   */
  readonly snapshot_result_slim: {
    readonly droneWeightG: number | null;
    readonly category: string | null;
    readonly flags: readonly SpecificFlightFlag[] | null;
    readonly verdict: {
      readonly purpose: string | null;
      readonly unknownCount: number | null;
      readonly procedures: readonly SlimProcedure[];
    };
  };
};

/** 判定の結論の手続きのうち、procedureId があるもの（次にやることの「許可・承認を申請する」「警察へ通報する」に使う）。 */
export type SlimProcedure = {
  readonly procedureId: string;
  readonly deadlineLabel: string | null;
  /** 期限の日付（YYYY-MM-DD）。決まらないときは null。 */
  readonly deadlineDate: string | null;
};

const PLAN_SELECT = `select p.*, to_char(p.planned_date, 'YYYY-MM-DD') as planned_date_text,
        a.registration_mark, a.model_name, a.max_takeoff_weight_kg as aircraft_max_takeoff_weight_kg,
        pl.full_name as pilot_name, pl.member_id as pilot_member_id,
        s.seq as snapshot_seq, s.reason as snapshot_reason, s.input as snapshot_input,
        s.verdict_level, s.verdict_unknown_count, s.category, s.engine_version,
        s.checked_at as snapshot_checked_at, s.check_evidence_id, s.diagnosis_evidence_id,
        s.datasets as snapshot_datasets, s.procedures_revision, s.procedures_verified_at,
        s.created_at as snapshot_created_at,
        jsonb_build_object(
          'droneWeightG', s.result->'droneWeightG',
          'category', s.result->'category',
          'flags', s.result->'flags',
          'verdict', jsonb_build_object(
            'purpose', s.result->'verdict'->'purpose',
            'unknownCount', s.result->'verdict'->'unknownCount',
            'procedures', coalesce((
              select jsonb_agg(jsonb_build_object(
                       'procedureId', x->'procedureId',
                       'deadlineLabel', x->'deadline'->'label',
                       'deadlineDate', x->'deadline'->'date'))
                from jsonb_array_elements(
                       case when jsonb_typeof(s.result->'verdict'->'procedures') = 'array'
                            then s.result->'verdict'->'procedures' else '[]'::jsonb end) x
               where x ? 'procedureId'
            ), '[]'::jsonb)
          )
        ) as snapshot_result_slim
   from flight_plans p
   join aircraft a on a.id = p.aircraft_id
   join pilots pl on pl.id = p.pilot_id
   join judgement_snapshots s on s.id = p.current_snapshot_id`;

export const getPlan = async (db: Queryable, orgId: string, id: string): Promise<PlanWithJoins | null> =>
  (await db.query<PlanWithJoins>(`${PLAN_SELECT} where p.org_id = $1 and p.id = $2`, [orgId, id])).rows[0] ?? null;

export type PlanFilter = {
  readonly aircraftId?: string;
  readonly pilotId?: string;
  /** 予定日（JST の日付）。両端を含む。 */
  readonly from?: string;
  readonly to?: string;
  readonly includeVoided?: boolean;
  readonly voidedOnly?: boolean;
  readonly oldestFirst?: boolean;
};

/** 計画の一覧（予定開始の新しい順、最大 500 件。oldestFirst なら古い順）。 */
export const listPlans = async (db: OpsDb, orgId: string, f: PlanFilter, offset = 0): Promise<PlanWithJoins[]> => {
  const where = ["p.org_id = $1"];
  const params: unknown[] = [orgId];
  if (f.aircraftId) where.push(`p.aircraft_id = $${params.push(f.aircraftId)}`);
  if (f.pilotId) where.push(`p.pilot_id = $${params.push(f.pilotId)}`);
  if (f.from) where.push(`p.planned_date >= $${params.push(f.from)}::date`);
  if (f.to) where.push(`p.planned_date <= $${params.push(f.to)}::date`);
  if (f.voidedOnly) where.push("p.voided_at is not null");
  else if (!f.includeVoided) where.push("p.voided_at is null");
  const dir = f.oldestFirst ? "asc" : "desc";
  return (
    await db.query<PlanWithJoins>(
      `${PLAN_SELECT} where ${where.join(" and ")} order by p.planned_start_at ${dir}, p.id ${dir} limit ${LIST_LIMIT} offset ${Math.max(0, Math.trunc(offset))}`,
      params,
    )
  ).rows;
};

/** 計画の確認の記録（古い順）。plan_ids は同じ組織の計画。 */
export const listConfirmationsFor = async (
  db: OpsDb,
  orgId: string,
  planIds: readonly string[],
): Promise<PlanConfirmationRow[]> => {
  if (planIds.length === 0) return [];
  return (
    await db.query<PlanConfirmationRow>(
      `select * from plan_confirmations where org_id = $1 and plan_id = any($2::uuid[]) order by created_at, id`,
      [orgId, [...planIds]],
    )
  ).rows;
};

export type SnapshotListRow = Omit<JudgementSnapshotRow, "result"> & { readonly created_by_name: string | null };
export type SnapshotFullRow = JudgementSnapshotRow & { readonly created_by_name: string | null };

const SNAPSHOT_LIST_COLUMNS = `s.id, s.org_id, s.plan_id, s.seq, s.reason, s.input, s.verdict_level, s.verdict_unknown_count,
        s.category, s.engine_version, s.checked_at, s.check_evidence_id, s.diagnosis_evidence_id, s.datasets,
        s.procedures_revision, s.procedures_verified_at, s.created_by_member_id, s.created_at, s.prev_hash, s.content_hash,
        m.display_name as created_by_name`;

/** 計画のスナップショットの一覧（result を除く。通し番号の順）。 */
export const listSnapshots = async (db: OpsDb, orgId: string, planId: string): Promise<SnapshotListRow[]> =>
  (
    await db.query<SnapshotListRow>(
      `select ${SNAPSHOT_LIST_COLUMNS}
         from judgement_snapshots s left join members m on m.id = s.created_by_member_id
        where s.org_id = $1 and s.plan_id = $2 order by s.seq`,
      [orgId, planId],
    )
  ).rows;

/** スナップショット 1 件（result を含む）。他の計画・他の組織のものは null。 */
export const getSnapshot = async (
  db: OpsDb,
  orgId: string,
  planId: string,
  snapshotId: string,
): Promise<SnapshotFullRow | null> =>
  (
    await db.query<SnapshotFullRow>(
      `select s.*, m.display_name as created_by_name
         from judgement_snapshots s left join members m on m.id = s.created_by_member_id
        where s.org_id = $1 and s.plan_id = $2 and s.id = $3`,
      [orgId, planId, snapshotId],
    )
  ).rows[0] ?? null;

export type ConfirmationInsert = {
  readonly orgId: string;
  readonly planId: string;
  readonly planVersion: number;
  readonly snapshotId: string;
  readonly decision: "approved" | "returned";
  readonly reason: string | null;
  readonly confirmerMemberId: string;
};

/**
 * 確認を 1 件追加する。confirmer_name・self_confirmation・created_at・content_hash は DB が決める（送らない）。
 * 計画の状態・版・スナップショットの検証も DB が行う（SB404／SB409）。
 */
export const insertConfirmation = async (db: OpsDb, i: ConfirmationInsert): Promise<string> =>
  withTransaction(db, async (c) => {
    const r = await c.query<{ id: string }>(
      `insert into plan_confirmations (org_id, plan_id, plan_version, snapshot_id, decision, reason, confirmer_member_id)
       values ($1, $2, $3, $4, $5, $6, $7) returning id`,
      [i.orgId, i.planId, i.planVersion, i.snapshotId, i.decision, i.reason, i.confirmerMemberId],
    );
    return r.rows[0]!.id;
  });

export const getSavedPlace = async (db: OpsDb, orgId: string, id: string): Promise<SavedPlaceRow | null> =>
  (await db.query<SavedPlaceRow>("select * from saved_places where org_id = $1 and id = $2", [orgId, id])).rows[0] ?? null;

export const listSavedPlaces = async (db: OpsDb, orgId: string, includeVoided: boolean): Promise<SavedPlaceRow[]> =>
  (
    await db.query<SavedPlaceRow>(
      `select * from saved_places where org_id = $1 ${includeVoided ? "" : "and voided_at is null"}
        order by voided_at nulls first, name, id`,
      [orgId],
    )
  ).rows;

/** この計画に結びついた（取消していない）飛行記録。離陸の新しい順。 */
export const listFlightsByPlan = async (db: OpsDb, orgId: string, planId: string): Promise<FlightWithTotal[]> =>
  (
    await db.query<FlightWithTotal>(
      `${FLIGHT_SELECT} where f.org_id = $1 and f.flight_plan_id = $2 and f.voided_at is null
        order by f.takeoff_at desc, f.id desc limit ${LIST_LIMIT}`,
      [orgId, planId],
    )
  ).rows;

// ---- 通報の記録・試行の監査・手続きの「済み」の記録（Sprint 12b） ----------------

/** 通報の行に、並べ替え用のマイクロ秒つきの時刻と、通報日時の JST の分を付けたもの。 */
export type ReportRowWithTimes = FlightReportRow & {
  /** UTC・小数 6 桁の ISO 文字列（作成・更新）。ミリ秒の Date では同じ時刻になりうるため、順序の判定にはこちらを使う。 */
  readonly created_at_us: string;
  readonly updated_at_us: string;
  /** 通報日時（JST の `YYYY-MM-DDTHH:MM`）。 */
  readonly reported_at_jst: string | null;
  /** 通報の対象のスナップショットの通し番号と証跡 ID（judgement_snapshots から引く）。 */
  readonly snapshot_seq: number;
  readonly check_evidence_id: string;
  readonly diagnosis_evidence_id: string;
};

const REPORT_SELECT = `select r.*,
        to_char(r.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as created_at_us,
        to_char(r.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as updated_at_us,
        ops_timestamptz_to_jst_minute(r.reported_at) as reported_at_jst,
        s.seq as snapshot_seq, s.check_evidence_id, s.diagnosis_evidence_id
   from flight_reports r
   join judgement_snapshots s on s.id = r.snapshot_id`;

/** 計画の通報の行（古い順）。plan_ids は同じ組織の計画。 */
export const listReportsFor = async (db: Queryable, orgId: string, planIds: readonly string[]): Promise<ReportRowWithTimes[]> => {
  if (planIds.length === 0) return [];
  return (
    await db.query<ReportRowWithTimes>(
      `${REPORT_SELECT} where r.org_id = $1 and r.plan_id = any($2::uuid[]) order by r.created_at, r.id`,
      [orgId, [...planIds]],
    )
  ).rows;
};

/** 通報の行 1 件。他の計画・他の組織のものは null。 */
export const getReport = async (db: OpsDb, orgId: string, planId: string, id: string): Promise<ReportRowWithTimes | null> =>
  (await db.query<ReportRowWithTimes>(`${REPORT_SELECT} where r.org_id = $1 and r.plan_id = $2 and r.id = $3`, [orgId, planId, id]))
    .rows[0] ?? null;

/** 冪等性キーの通報の行（組織の中で一意）。 */
export const findReportByKey = async (db: OpsDb, orgId: string, key: string): Promise<ReportRowWithTimes | null> =>
  (await db.query<ReportRowWithTimes>(`${REPORT_SELECT} where r.org_id = $1 and r.idempotency_key = $2`, [orgId, key])).rows[0] ?? null;

export type AttemptInsert = {
  readonly orgId: string;
  readonly planId: string;
  readonly reportId: string | null;
  readonly operation: FlightReportAttemptRow["operation"];
  readonly memberId: string;
  readonly adapter: FlightReportAttemptRow["adapter"];
  readonly idempotencyKey: string | null;
  readonly payloadHash: string | null;
  readonly summary: string | null;
  readonly mapRevision: number | null;
  readonly checkEvidenceId: string | null;
  readonly diagnosisEvidenceId: string | null;
  readonly result: FlightReportAttemptRow["result"];
  readonly httpStatus: number | null;
  readonly errorKind: string | null;
  readonly dipsNumber: string | null;
};

/** 試行の監査を 1 行追加する（呼び出し側のトランザクションの中で）。member_name・member_role・created_at は DB が決める。 */
export const insertAttemptOn = async (c: OpsTx, a: AttemptInsert): Promise<void> => {
  await c.query(
    `insert into flight_report_attempts (org_id, plan_id, report_id, operation, member_id, member_name, member_role, adapter,
       idempotency_key, payload_hash, summary, map_revision, check_evidence_id, diagnosis_evidence_id, result, http_status,
       error_kind, dips_number, created_at)
     values ($1, $2, $3, $4, $5, '-', 'viewer', $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, now())`,
    [
      a.orgId,
      a.planId,
      a.reportId,
      a.operation,
      a.memberId,
      a.adapter,
      a.idempotencyKey,
      a.payloadHash,
      a.summary,
      a.mapRevision,
      a.checkEvidenceId,
      a.diagnosisEvidenceId,
      a.result,
      a.httpStatus,
      a.errorKind,
      a.dipsNumber,
    ],
  );
};

/** 試行の監査を、1 つのトランザクションで追加する。 */
export const insertAttempts = (db: OpsDb, list: readonly AttemptInsert[]): Promise<void> =>
  withTransaction(db, async (c) => {
    for (const a of list) await insertAttemptOn(c, a);
  });

/** 計画の試行の監査（新しい順）。 */
export const listAttempts = async (db: OpsDb, orgId: string, planId: string, limit = 50): Promise<FlightReportAttemptRow[]> =>
  (
    await db.query<FlightReportAttemptRow>(
      `select * from flight_report_attempts where org_id = $1 and plan_id = $2 order by created_at desc, id desc limit $3`,
      [orgId, planId, limit],
    )
  ).rows;

/**
 * 通報内容のコピーの監査が、その計画の最後の通報の行（取り下げを含む）より後にある計画の ID。
 * 「通報内容を開いて記録がない場合の入口」（次にやること）に使う。
 */
export const plansCopiedSinceLastReport = async (db: OpsDb, orgId: string, planIds: readonly string[]): Promise<Set<string>> => {
  if (planIds.length === 0) return new Set();
  const r = await db.query<{ plan_id: string }>(
    `select distinct a.plan_id
       from flight_report_attempts a
      where a.org_id = $1 and a.plan_id = any($2::uuid[]) and a.operation = 'copy'
        and a.created_at > coalesce((select max(r.created_at) from flight_reports r where r.plan_id = a.plan_id), '-infinity'::timestamptz)`,
    [orgId, [...planIds]],
  );
  return new Set(r.rows.map((x) => x.plan_id));
};

/** 計画の手続きの記録（古い順）。plan_ids は同じ組織の計画。 */
export const listProcedureRecordsFor = async (
  db: OpsDb,
  orgId: string,
  planIds: readonly string[],
): Promise<(PlanProcedureRecordRow & { readonly created_at_us: string; readonly done_at_jst: string | null })[]> => {
  if (planIds.length === 0) return [];
  return (
    await db.query<PlanProcedureRecordRow & { created_at_us: string; done_at_jst: string | null }>(
      `select r.*,
              to_char(r.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as created_at_us,
              ops_timestamptz_to_jst_minute(r.done_at) as done_at_jst
         from plan_procedure_records r
        where r.org_id = $1 and r.plan_id = any($2::uuid[]) order by r.created_at, r.id`,
      [orgId, [...planIds]],
    )
  ).rows;
};

export type ProcedureRecordInsert = {
  readonly orgId: string;
  readonly planId: string;
  readonly kind: PlanProcedureRecordRow["kind"];
  readonly action: PlanProcedureRecordRow["action"];
  /** JST の `YYYY-MM-DDTHH:MM`（done のとき）。 */
  readonly doneAtJst: string | null;
  readonly reference: string | null;
  readonly checks: Readonly<Record<string, boolean>>;
  readonly snapshotId: string;
  readonly planVersion: number;
  readonly recordedByMemberId: string;
  readonly reason: string | null;
};

/**
 * 手続きの記録を 1 件追加する。recorded_by_name・created_at・content_hash は DB が決める（送らない）。
 * 計画の状態・スナップショット・版の検証も DB が行う（SB404／SB409）。
 */
export const insertProcedureRecord = async (db: OpsDb, i: ProcedureRecordInsert): Promise<string> =>
  withTransaction(db, async (c) => {
    const r = await c.query<{ id: string }>(
      `insert into plan_procedure_records (org_id, plan_id, kind, action, done_at, reference, checks, snapshot_id, plan_version,
         recorded_by_member_id, recorded_by_name, reason, created_at, content_hash)
       values ($1, $2, $3, $4, ops_jst_minute_to_timestamptz($5), $6, $7::jsonb, $8, $9, $10, '-', $11, now(), '-')
       returning id`,
      [i.orgId, i.planId, i.kind, i.action, i.doneAtJst, i.reference, JSON.stringify(i.checks), i.snapshotId, i.planVersion, i.recordedByMemberId, i.reason],
    );
    return r.rows[0]!.id;
  });

// ---- 現場の事実の記録（Sprint 12c。flight_field_events。追記専用） ----------------------

/** 現場の事実の行に、並べ替え用のマイクロ秒つきの時刻と、事実の時刻の JST の分を付けたもの。 */
export type FieldEventRowWithTimes = FlightFieldEventRow & {
  /** 記録の順の鍵（UTC・小数 6 桁の ISO 文字列）。ミリ秒の Date では同じ時刻になりうるため、順序の判定にはこちらを使う。 */
  readonly recorded_key: string;
  /** 事実の時刻（JST の `YYYY-MM-DDTHH:MM`）。 */
  readonly occurred_at_jst: string;
};

const FIELD_EVENT_SELECT = `select e.*,
        to_char(e.recorded_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as recorded_key,
        ops_timestamptz_to_jst_minute(e.occurred_at) as occurred_at_jst
   from flight_field_events e`;

/** 計画の現場の事実の行（記録の古い順）。plan_ids は同じ組織の計画。 */
export const listFieldEventsFor = async (
  db: Queryable,
  orgId: string,
  planIds: readonly string[],
): Promise<FieldEventRowWithTimes[]> => {
  if (planIds.length === 0) return [];
  return (
    await db.query<FieldEventRowWithTimes>(
      `${FIELD_EVENT_SELECT} where e.org_id = $1 and e.plan_id = any($2::uuid[]) order by e.recorded_at, e.id`,
      [orgId, [...planIds]],
    )
  ).rows;
};

/** 端末の識別子（clientEventId）の行。組織の中で一意。 */
export const findFieldEventByClientId = async (
  db: Queryable,
  orgId: string,
  clientEventId: string,
): Promise<FieldEventRowWithTimes | null> =>
  (await db.query<FieldEventRowWithTimes>(`${FIELD_EVENT_SELECT} where e.org_id = $1 and e.client_event_id = $2`, [orgId, clientEventId]))
    .rows[0] ?? null;

export type FieldEventInsert = {
  readonly orgId: string;
  readonly planId: string;
  readonly kind: FlightFieldEventRow["kind"];
  readonly item: FlightFieldEventRow["item"];
  readonly result: FlightFieldEventRow["result"];
  readonly source: string | null;
  readonly targetEventId: string | null;
  readonly flightRecordId: string | null;
  readonly inspectionId: string | null;
  readonly reportId: string | null;
  /** 事実の時刻（JST の `YYYY-MM-DDTHH:MM`）。 */
  readonly occurredAtJst: string;
  readonly gaps: readonly { readonly item: string; readonly state: string }[] | null;
  readonly note: string | null;
  readonly queued: boolean;
  readonly clientEventId: string;
  readonly recordedByMemberId: string;
  /** Sprint 14（0017）。docs_confirm の対象。 */
  readonly docKey?: string | null;
  /** Sprint 14（0017）。site_conditions の値。 */
  readonly site?: {
    readonly thirdParty: string;
    readonly otherAircraft: string;
    readonly rain: string;
    readonly visibility: string;
    readonly windMs: number | null;
    readonly tempC: number | null;
  } | null;
};

/**
 * 現場の事実の行を 1 件追加する（呼び出し側が開いたトランザクションの中で）。snapshot_id・plan_version・recorded_by_name・
 * recorded_by_role・recorded_at・content_hash は DB が決める（送らない）。
 */
export const insertFieldEventOn = async (c: OpsTx, i: FieldEventInsert): Promise<string> => {
  const r = await c.query<{ id: string }>(
    `insert into flight_field_events (org_id, plan_id, kind, item, result, source, target_event_id, flight_record_id, inspection_id,
       report_id, occurred_at, gaps, note, queued, client_event_id, recorded_by_member_id,
       doc_key, site_third_party, site_other_aircraft, site_rain, site_visibility, site_wind_ms, site_temp_c)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, ops_jst_minute_to_timestamptz($11), $12::jsonb, $13, $14, $15, $16,
       $17, $18, $19, $20, $21, $22, $23)
     returning id`,
    [
      i.orgId,
      i.planId,
      i.kind,
      i.item,
      i.result,
      i.source,
      i.targetEventId,
      i.flightRecordId,
      i.inspectionId,
      i.reportId,
      i.occurredAtJst,
      i.gaps === null ? null : JSON.stringify(i.gaps),
      i.note,
      i.queued,
      i.clientEventId,
      i.recordedByMemberId,
      i.docKey ?? null,
      i.site?.thirdParty ?? null,
      i.site?.otherAircraft ?? null,
      i.site?.rain ?? null,
      i.site?.visibility ?? null,
      i.site?.windMs ?? null,
      i.site?.tempC ?? null,
    ],
  );
  return r.rows[0]!.id;
};

/** 計画ごとの排他（現場の記録・計画の版・確認と同じ鍵。DB の追加前のトリガーも同じ鍵を取る）。トランザクションの中で呼ぶ。 */
export const lockPlanOn = async (c: OpsTx, planId: string): Promise<void> => {
  await c.query("select pg_advisory_xact_lock(hashtextextended('record_versions:flight_plan:' || $1::text, 0))", [planId]);
};

/**
 * 指定の時刻以降に離陸した計画の ID（飛行中・日誌待ちの計画を日付に関わらず拾う）。
 * 事実の時刻（occurred_at）で数える（記録の時刻 recorded_at は DB の実時刻で、テスト用に固定したサーバーの時計と合わない）。
 */
export const listPlanIdsWithTakeoffSince = async (db: Queryable, orgId: string, since: Date): Promise<string[]> =>
  (
    await db.query<{ plan_id: string }>(
      `select distinct plan_id from flight_field_events where org_id = $1 and kind = 'takeoff' and occurred_at >= $2`,
      [orgId, since],
    )
  ).rows.map((r) => r.plan_id);

/** 機体の、ある JST の日付の（取消していない）飛行前の日常点検。 */
export const listPreflightInspections = async (
  db: Queryable,
  orgId: string,
  aircraftIds: readonly string[],
  date: string,
): Promise<{ id: string; aircraft_id: string; inspected_at: Date | string; has_abnormal: boolean }[]> => {
  if (aircraftIds.length === 0) return [];
  return (
    await db.query<{ id: string; aircraft_id: string; inspected_at: Date | string; has_abnormal: boolean }>(
      `select id, aircraft_id, inspected_at, has_abnormal from daily_inspections
        where org_id = $1 and aircraft_id = any($2::uuid[]) and voided_at is null and timing = 'pre_flight' and inspected_date = $3::date
        order by inspected_at, id`,
      [orgId, [...aircraftIds], date],
    )
  ).rows;
};

/**
 * 現場の導出に使う日常点検（飛行前・飛行後。取消していないもの）。date の前日からの分を読む（日付をまたぐ飛行後点検のため）。
 * 飛行前の点検は呼び出し側が点検の日付で絞る（fieldState の day）。
 */
export const listFieldInspections = async (
  db: Queryable,
  orgId: string,
  aircraftIds: readonly string[],
  date: string,
): Promise<{ id: string; inspected_at: Date | string; has_abnormal: boolean; timing: "pre_flight" | "post_flight"; inspected_date_text: string }[]> => {
  if (aircraftIds.length === 0) return [];
  return (
    await db.query<{ id: string; inspected_at: Date | string; has_abnormal: boolean; timing: "pre_flight" | "post_flight"; inspected_date_text: string }>(
      `select id, inspected_at, has_abnormal, timing, inspected_date::text as inspected_date_text from daily_inspections
        where org_id = $1 and aircraft_id = any($2::uuid[]) and voided_at is null
          and inspected_date >= $3::date - 1 and inspected_date <= $3::date
        order by inspected_at, id`,
      [orgId, [...aircraftIds], date],
    )
  ).rows;
};

/** 飛行記録の取消の有無（日誌待ちへの復帰の判定に使う）。 */
export const listFlightRecordVoidState = async (
  db: Queryable,
  orgId: string,
  ids: readonly string[],
): Promise<{ id: string; voided: boolean }[]> => {
  if (ids.length === 0) return [];
  return (
    await db.query<{ id: string; voided: boolean }>(
      `select id, (voided_at is not null) as voided from flight_records where org_id = $1 and id = any($2::uuid[])`,
      [orgId, [...ids]],
    )
  ).rows;
};

/** 計画に結び付いた飛行記録の、取消していないものがある計画の ID。 */
export const plansWithFlightRecords = async (db: Queryable, orgId: string, planIds: readonly string[]): Promise<Set<string>> => {
  if (planIds.length === 0) return new Set();
  const r = await db.query<{ flight_plan_id: string }>(
    `select distinct flight_plan_id from flight_records
      where org_id = $1 and flight_plan_id = any($2::uuid[]) and voided_at is null`,
    [orgId, [...planIds]],
  );
  return new Set(r.rows.map((x) => x.flight_plan_id));
};

/** ID の集合で計画をまとめて読む（食い違いの導出で、飛行記録ごとに計画を引かないため）。 */
export const listPlansByIds = async (db: Queryable, orgId: string, ids: readonly string[]): Promise<PlanWithJoins[]> => {
  if (ids.length === 0) return [];
  return (
    await db.query<PlanWithJoins>(`${PLAN_SELECT} where p.org_id = $1 and p.id = any($2::uuid[]) order by p.planned_start_at, p.id`, [
      orgId,
      [...ids],
    ])
  ).rows;
};

/** 離陸が指定の時刻以降の（取消していない）飛行記録（直近の食い違いの確認に使う）。 */
export const listFlightsSince = async (db: Queryable, orgId: string, since: Date): Promise<FlightWithTotal[]> =>
  (
    await db.query<FlightWithTotal>(
      `${FLIGHT_SELECT} where f.org_id = $1 and f.voided_at is null and f.takeoff_at >= $2
        order by f.takeoff_at desc, f.id desc limit ${LIST_LIMIT}`,
      [orgId, since],
    )
  ).rows;

/** 飛行記録と結び付いた離陸の行（日誌との結び付き）。離陸の行の未了事項の写しも返す。 */
export type JournalLinkRow = {
  readonly flight_record_id: string;
  readonly takeoff_event_id: string;
  readonly takeoff_gaps: readonly { readonly item: string; readonly state: string }[] | null;
};

export const listJournalLinksFor = async (db: Queryable, orgId: string, flightRecordIds: readonly string[]): Promise<JournalLinkRow[]> => {
  if (flightRecordIds.length === 0) return [];
  return (
    await db.query<JournalLinkRow>(
      `select j.flight_record_id, t.id as takeoff_event_id, t.gaps as takeoff_gaps
         from flight_field_events j
         join flight_field_events t on t.id = j.target_event_id and t.org_id = j.org_id
        where j.org_id = $1 and j.kind = 'journal_linked' and j.flight_record_id = any($2::uuid[])
        order by j.recorded_at, j.id`,
      [orgId, [...flightRecordIds]],
    )
  ).rows;
};

/** 現場の事実の行 1 件を、ID か端末の識別子で引く（同じ組織の行だけ）。 */
export const getFieldEventByRef = async (db: Queryable, orgId: string, ref: string): Promise<FieldEventRowWithTimes | null> =>
  (
    await db.query<FieldEventRowWithTimes>(
      `${FIELD_EVENT_SELECT} where e.org_id = $1 and (e.id = $2::uuid or e.client_event_id = $2::uuid) limit 1`,
      [orgId, ref],
    )
  ).rows[0] ?? null;

// ---- 許可・承認の登録（Sprint 12d） ----------------------------------------------------

/** 許可・承認の登録の行に、現在の版の content_hash（版のハッシュ）を付けたもの。日付は YYYY-MM-DD の文字列。 */
export type PermitRow = PermitRegistrationRow & { readonly version_hash: string };

const PERMIT_SELECT = `select p.id, p.org_id, p.permit_number, p.permit_number_key, p.coverage, p.kinds, p.airport_names,
        to_char(p.issued_on, 'YYYY-MM-DD') as issued_on, to_char(p.valid_from, 'YYYY-MM-DD') as valid_from,
        to_char(p.valid_to, 'YYYY-MM-DD') as valid_to, p.status, to_char(p.revoked_on, 'YYYY-MM-DD') as revoked_on,
        p.place_scope, p.aircraft_scope, p.pilot_scope, p.max_altitude_m, p.max_weight_kg, p.requires_observer,
        p.requires_access_control, p.conditions_text, p.source, p.external_ref, p.current_version, p.created_at,
        p.updated_at, p.voided_at, v.content_hash as version_hash
   from permit_registrations p
   join record_versions v on v.entity_type = 'permit_registration' and v.entity_id = p.id and v.version_no = p.current_version`;

export const getPermit = async (db: Queryable, orgId: string, id: string): Promise<PermitRow | null> =>
  (await db.query<PermitRow>(`${PERMIT_SELECT} where p.org_id = $1 and p.id = $2`, [orgId, id])).rows[0] ?? null;

/** 許可・承認の登録の一覧（取消は includeVoided のときだけ。有効期間の終わりが遅い順、番号の順）。 */
export const listPermits = async (db: Queryable, orgId: string, includeVoided: boolean, offset = 0): Promise<PermitRow[]> =>
  (
    await db.query<PermitRow>(
      `${PERMIT_SELECT} where p.org_id = $1 ${includeVoided ? "" : "and p.voided_at is null"}
        order by p.voided_at nulls first, p.valid_to desc, p.permit_number, p.id limit ${LIST_LIMIT} offset ${Math.max(0, Math.trunc(offset))}`,
      [orgId],
    )
  ).rows;

/** 番号の鍵で結びついた登録（取消済みも含む。照合が取消を判断する）。1 回のクエリで、計画の件数に依らない。 */
export const listPermitsByKeys = async (db: Queryable, orgId: string, keys: readonly string[]): Promise<PermitRow[]> => {
  if (keys.length === 0) return [];
  return (
    await db.query<PermitRow>(`${PERMIT_SELECT} where p.org_id = $1 and p.permit_number_key = any($2::text[])`, [orgId, [...keys]])
  ).rows;
};

export type PlanBasisRow = {
  readonly id: string;
  readonly title: string;
  readonly planned_date_text: string;
  readonly current_snapshot_id: string;
  readonly snapshot_seq: number;
  readonly permit_basis: unknown;
};

/** この登録を根拠にしている計画（現在のスナップショットの permitBasis から。中止した計画は除く）。 */
export const listPlansBasedOnPermit = async (db: Queryable, orgId: string, registrationId: string): Promise<PlanBasisRow[]> =>
  (
    await db.query<PlanBasisRow>(
      `select p.id, p.title, to_char(p.planned_date, 'YYYY-MM-DD') as planned_date_text, p.current_snapshot_id,
              s.seq as snapshot_seq, s.input->'permitBasis' as permit_basis
         from flight_plans p join judgement_snapshots s on s.id = p.current_snapshot_id
        where p.org_id = $1 and p.voided_at is null
          and s.input->'permitBasis' @> jsonb_build_array(jsonb_build_object('registrationId', $2::text))
        order by p.planned_start_at desc, p.id limit ${LIST_LIMIT}`,
      [orgId, registrationId],
    )
  ).rows;

/** 許可番号の欄に文字がある計画（中止した計画は除く）。登録の変更が影響する計画の数に使う。 */
export const listPlanPermitNumberFields = async (
  db: Queryable,
  orgId: string,
): Promise<{ readonly id: string; readonly permit_numbers: string }[]> =>
  (
    await db.query<{ id: string; permit_numbers: string }>(
      `select id, permit_numbers from flight_plans
        where org_id = $1 and voided_at is null and permit_numbers is not null and btrim(permit_numbers) <> ''
        order by planned_start_at desc, id limit ${LIST_LIMIT}`,
      [orgId],
    )
  ).rows;

/** 登録の版（ID・版番号・ハッシュ）。スナップショットの permitBasis が指す版が実在し、ハッシュが一致するかの確認に使う。 */
export const listPermitVersionHashes = async (
  db: Queryable,
  orgId: string,
  registrationIds: readonly string[],
): Promise<{ readonly entity_id: string; readonly version_no: number; readonly content_hash: string }[]> => {
  if (registrationIds.length === 0) return [];
  return (
    await db.query<{ entity_id: string; version_no: number; content_hash: string }>(
      `select entity_id, version_no, content_hash from record_versions
        where org_id = $1 and entity_type = 'permit_registration' and entity_id = any($2::uuid[])`,
      [orgId, [...registrationIds]],
    )
  ).rows;
};

/** 機体の登録記号・操縦者の氏名（許可の範囲の表示用）。同じ組織のものだけ。 */
export const listAircraftMarks = async (db: Queryable, orgId: string, ids: readonly string[]): Promise<{ readonly id: string; readonly label: string }[]> =>
  ids.length === 0
    ? []
    : (
        await db.query<{ id: string; label: string }>(
          "select id, registration_mark as label from aircraft where org_id = $1 and id = any($2::uuid[])",
          [orgId, [...ids]],
        )
      ).rows;

export const listPilotNames = async (db: Queryable, orgId: string, ids: readonly string[]): Promise<{ readonly id: string; readonly label: string }[]> =>
  ids.length === 0
    ? []
    : (await db.query<{ id: string; label: string }>("select id, full_name as label from pilots where org_id = $1 and id = any($2::uuid[])", [orgId, [...ids]]))
        .rows;

// ---- 事故・ヒヤリハット（Sprint 12e） --------------------------------------------------------

/**
 * 事故・ヒヤリハットの記録の行に、起きた日時の JST の分、計画の題名、機体の登録記号、操縦者の氏名（表示のたびに引く。写しは持たない）、
 * 記録を作った利用者（版 1 の actor）を付けたもの。follow_up_on は YYYY-MM-DD の文字列。
 */
export type IncidentRowWithJoins = IncidentRecordRow & {
  readonly occurred_at_jst: string;
  readonly plan_title: string | null;
  readonly plan_voided_at: string | Date | null;
  readonly snapshot_seq: number | null;
  readonly registration_mark: string | null;
  readonly pilot_name: string | null;
  readonly pilot_member_id: string | null;
  readonly created_by_member_id: string | null;
  readonly created_by_name: string | null;
};

const INCIDENT_SELECT = `select i.id, i.org_id, i.kind, i.occurred_at, ops_timestamptz_to_jst_minute(i.occurred_at) as occurred_at_jst,
        i.phase, i.place_name, i.latitude, i.longitude, i.plan_id, i.snapshot_id, i.flight_record_id, i.aircraft_id, i.pilot_id,
        i.event_types, i.people_injury, i.aircraft_damage, i.injured_count, i.contacts_made, i.summary, i.details, i.factors_note,
        i.actions_taken, i.prevention_note, i.detail_pending, i.source, i.follow_up_status,
        to_char(i.follow_up_on, 'YYYY-MM-DD') as follow_up_on, i.guidance_level, i.guidance_revision, i.client_request_id,
        i.current_version, i.created_at, i.updated_at, i.voided_at,
        p.title as plan_title, p.voided_at as plan_voided_at, s.seq as snapshot_seq, a.registration_mark,
        pl.full_name as pilot_name, pl.member_id as pilot_member_id,
        v1.actor_member_id as created_by_member_id, m.display_name as created_by_name
   from incident_records i
   join record_versions v1 on v1.entity_type = 'incident_record' and v1.entity_id = i.id and v1.version_no = 1
   left join members m on m.id = v1.actor_member_id
   left join flight_plans p on p.id = i.plan_id
   left join judgement_snapshots s on s.id = i.snapshot_id
   left join aircraft a on a.id = i.aircraft_id
   left join pilots pl on pl.id = i.pilot_id`;

export const getIncident = async (db: Queryable, orgId: string, id: string): Promise<IncidentRowWithJoins | null> =>
  (await db.query<IncidentRowWithJoins>(`${INCIDENT_SELECT} where i.org_id = $1 and i.id = $2`, [orgId, id])).rows[0] ?? null;

export type IncidentFilter = {
  readonly includeVoided?: boolean;
  readonly kind?: IncidentRecordRow["kind"];
  readonly followUp?: IncidentRecordRow["follow_up_status"];
  readonly planId?: string;
  readonly flightRecordId?: string;
  /** 現場の簡易記録で詳細が未記入のものだけ。 */
  readonly detailPending?: boolean;
  /** 報告の状態（導出）：none・reported・consulted、または changed（記録のあとで事実が変わった）。上限（LIMIT）の前にかける。 */
  readonly reportState?: "none" | "reported" | "consulted" | "changed";
};

/**
 * 報告の記録のまとめ（記録ごとの結合。上限や絞り込みの前に、SQL の中で報告の状態を導出するのに使う）。
 *   active_n     有効な（取り下げられていない）reported・consulted の数
 *   has_reported 有効な reported がある
 *   any_match    有効な記録のうち、記録した時点の版の事実（区分・類型の組・けがの有無・人数）がいまと同じものがある
 *                （アプリの「指紋が同じ」と同じ条件。指紋は、記録した時点の事実から作られる）
 * 報告の状態：reported ＞ consulted ＞ none。changed は active_n > 0 で any_match でないとき。
 */
const INCIDENT_REPORT_LATERAL = `
   left join lateral (
     select count(*)::int as active_n,
            coalesce(bool_or(r.action = 'reported'), false) as has_reported,
            coalesce(bool_or(rv.data->>'kind' = i.kind
                             and rv.data->>'people_injury' = i.people_injury
                             and (rv.data->>'injured_count')::integer is not distinct from i.injured_count
                             and (rv.data->'event_types') <@ i.event_types and i.event_types <@ (rv.data->'event_types')), false) as any_match
       from incident_report_records r
       left join record_versions rv on rv.org_id = r.org_id and rv.entity_type = 'incident_record'
                                   and rv.entity_id = r.incident_id and rv.version_no = r.incident_version
      where r.org_id = i.org_id and r.incident_id = i.id and r.action in ('reported', 'consulted')
        and not exists (select 1 from incident_report_records t
                         where t.org_id = r.org_id and t.incident_id = r.incident_id
                           and t.action = 'retract' and t.target_record_id = r.id)
   ) rs on true`;

const REPORT_STATE_SQL: Readonly<Record<NonNullable<IncidentFilter["reportState"]>, string>> = {
  none: "rs.active_n = 0",
  reported: "rs.has_reported",
  consulted: "rs.active_n > 0 and not rs.has_reported",
  changed: "rs.active_n > 0 and not rs.any_match",
};

/** 事故・ヒヤリハットの一覧（起きた日時の新しい順、最大 500 件）。絞り込みはすべて上限の前にかける。1 回のクエリで、件数に依らない。 */
export const listIncidents = async (db: Queryable, orgId: string, f: IncidentFilter = {}): Promise<IncidentRowWithJoins[]> => {
  const where = ["i.org_id = $1"];
  const params: unknown[] = [orgId];
  if (f.kind) where.push(`i.kind = $${params.push(f.kind)}`);
  if (f.followUp) where.push(`i.follow_up_status = $${params.push(f.followUp)}`);
  if (f.planId) where.push(`i.plan_id = $${params.push(f.planId)}`);
  if (f.flightRecordId) where.push(`i.flight_record_id = $${params.push(f.flightRecordId)}`);
  if (!f.includeVoided) where.push("i.voided_at is null");
  if (f.detailPending) where.push("i.detail_pending");
  if (f.reportState) where.push(`(${REPORT_STATE_SQL[f.reportState]})`);
  return (
    await db.query<IncidentRowWithJoins>(
      `${INCIDENT_SELECT}${f.reportState ? INCIDENT_REPORT_LATERAL : ""} where ${where.join(" and ")} order by i.occurred_at desc, i.id desc limit ${LIST_LIMIT}`,
      params,
    )
  ).rows;
};

/**
 * 「今日」の次にやることの候補（取消していない記録のうち、未解決のものだけ）。一覧の上限（LIMIT）をかけない。1 回のクエリで、件数に依らない。
 *   - 目安が possible で、有効な（取り下げられていない）報告・要否の確認の記録のうち、記録した時点の版の事実（区分・類型・けがの有無・人数）が
 *     いまの事実と同じものが無い（記録が無い、または記録のあとで事実が変わった。指紋の比較と同じ条件）。
 *   - 詳細の記入待ち（detail_pending）で、起きた日（JST）が detailSince（YYYY-MM-DD）以後。
 * 報告の状態の最終の判定は、サービス層が報告の記録から導出する（ここは候補を絞るだけ）。
 */
export const listIncidentTodayCandidates = async (db: Queryable, orgId: string, detailSince: string): Promise<IncidentRowWithJoins[]> =>
  (
    await db.query<IncidentRowWithJoins>(
      `${INCIDENT_SELECT}${INCIDENT_REPORT_LATERAL}
        where i.org_id = $1 and i.voided_at is null
          and ((i.guidance_level = 'possible' and (rs.active_n = 0 or not rs.any_match))
               or (i.detail_pending and ops_timestamptz_to_jst_minute(i.occurred_at) >= $2))
        order by i.occurred_at desc, i.id desc`,
      [orgId, detailSince],
    )
  ).rows;

/** 報告の記録の行に、並べ替え用のマイクロ秒つきの時刻と、日時の JST の分を付けたもの。 */
export type IncidentReportRowWithTimes = IncidentReportRecordRow & {
  readonly created_at_us: string;
  readonly done_at_jst: string | null;
};

/** 記録の報告の記録（古い順）。incident_ids は同じ組織の記録。1 回のクエリで、記録の件数に依らない。 */
export const listIncidentReportRecordsFor = async (
  db: Queryable,
  orgId: string,
  incidentIds: readonly string[],
): Promise<IncidentReportRowWithTimes[]> => {
  if (incidentIds.length === 0) return [];
  return (
    await db.query<IncidentReportRowWithTimes>(
      `select r.*,
              to_char(r.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as created_at_us,
              ops_timestamptz_to_jst_minute(r.done_at) as done_at_jst
         from incident_report_records r
        where r.org_id = $1 and r.incident_id = any($2::uuid[]) order by r.created_at, r.id`,
      [orgId, [...incidentIds]],
    )
  ).rows;
};

export type IncidentReportInsert = {
  readonly orgId: string;
  readonly incidentId: string;
  readonly action: IncidentReportRecordRow["action"];
  /** JST の `YYYY-MM-DDTHH:MM`（reported・consulted）。 */
  readonly doneAtJst: string | null;
  readonly channel: IncidentReportRecordRow["channel"];
  readonly channelNote: string | null;
  readonly reference: string | null;
  readonly referenceAbsent: boolean;
  readonly note: string | null;
  readonly checks: Readonly<Record<string, boolean>>;
  readonly targetRecordId: string | null;
  readonly factsFingerprint: string;
  readonly reason: string | null;
  readonly recordedByMemberId: string;
};

/**
 * 報告の記録を 1 件追加する（呼び出し側が開いたトランザクションの中で）。incident_version・recorded_by_name・recorded_by_role・
 * created_at・content_hash は DB が決める（仮の値を送り、追加前のトリガーが上書きする）。
 */
export const insertIncidentReportOn = async (c: OpsTx, i: IncidentReportInsert): Promise<string> => {
  const r = await c.query<{ id: string }>(
    `insert into incident_report_records (org_id, incident_id, action, done_at, channel, channel_note, reference, reference_absent, note,
       checks, target_record_id, incident_version, facts_fingerprint, reason, recorded_by_member_id, recorded_by_name, recorded_by_role,
       created_at, content_hash)
     values ($1, $2, $3, ops_jst_minute_to_timestamptz($4), $5, $6, $7, $8, $9, $10::jsonb, $11, 1, $12, $13, $14, '-', 'viewer', now(), '-')
     returning id`,
    [
      i.orgId,
      i.incidentId,
      i.action,
      i.doneAtJst,
      i.channel,
      i.channelNote,
      i.reference,
      i.referenceAbsent,
      i.note,
      JSON.stringify(i.checks),
      i.targetRecordId,
      i.factsFingerprint,
      i.reason,
      i.recordedByMemberId,
    ],
  );
  return r.rows[0]!.id;
};

/**
 * 操縦者に結び付いた利用者（pilots.member_id）を、確定した最新の値で読み、そのトランザクションの終わりまで変わらないようにする。
 * 操縦者の版の追加（updatePilot・voidPilot）が取る排他の鍵（record_versions:pilot:<ID>）を共有で取る。操縦者の更新はこの鍵の解放を待つので、
 * 認可の確認から書き込みまでの間に結び付きは変わらない。取る順は「記録の鍵 → 操縦者の共有の鍵」で、操縦者の更新側は操縦者の鍵しか取らない。
 */
export const lockPilotMemberOn = async (c: OpsTx, orgId: string, pilotId: string): Promise<string | null> => {
  await c.query("select pg_advisory_xact_lock_shared(hashtextextended('record_versions:pilot:' || $1::text, 0))", [pilotId]);
  const r = await c.query<{ member_id: string | null }>("select member_id from pilots where org_id = $1 and id = $2", [orgId, pilotId]);
  return r.rows[0]?.member_id ?? null;
};

/** 記録ごとの排他（版の追加・報告の記録と同じ鍵。DB の追加前のトリガーも同じ鍵を取る）。トランザクションの中で呼ぶ。 */
export const lockIncidentOn = async (c: OpsTx, incidentId: string): Promise<void> => {
  await c.query("select pg_advisory_xact_lock(hashtextextended('record_versions:incident_record:' || $1::text, 0))", [incidentId]);
};

/** 実体の版 1 の data と作成者（二重送信の判定に使う）。 */
export const firstVersionOf = async (
  db: Queryable,
  orgId: string,
  entityType: RecordEntityTypeDb,
  entityId: string,
): Promise<{ readonly data: Record<string, unknown>; readonly actor_member_id: string | null } | null> =>
  (
    await db.query<{ data: Record<string, unknown>; actor_member_id: string | null }>(
      `select data, actor_member_id from record_versions where org_id = $1 and entity_type = $2 and entity_id = $3 and version_no = 1`,
      [orgId, entityType, entityId],
    )
  ).rows[0] ?? null;
