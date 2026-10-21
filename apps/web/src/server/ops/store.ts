// 運航管理の DB の読み書き（Sprint 10 設計 B・C）。
// - 読み出しはすべて org_id を必須の引数に取る（組織の条件を付け忘れない）。
// - 書き込みは record_versions への追加だけ（ヘッド表は DB のトリガーが作る）。
// - 楽観的排他は set_config('soraban.expected_version', …, true) で DB のトリガーに渡す（0006）。
import type {
  AircraftRow,
  DailyInspectionRow,
  EvidenceLogInsert,
  FlightPlanRow,
  FlightRecordRow,
  JudgementSnapshotRow,
  MemberRow,
  OrganizationRow,
  PilotRow,
  PlanConfirmationRow,
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
  /** 通報の要否の判定に使う結果の一部（droneWeightG・category・flags・verdict.purpose）。 */
  readonly snapshot_result_slim: {
    readonly droneWeightG: number | null;
    readonly category: string | null;
    readonly flags: readonly SpecificFlightFlag[] | null;
    readonly verdict: { readonly purpose: string | null };
  };
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
          'verdict', jsonb_build_object('purpose', s.result->'verdict'->'purpose')
        ) as snapshot_result_slim
   from flight_plans p
   join aircraft a on a.id = p.aircraft_id
   join pilots pl on pl.id = p.pilot_id
   join judgement_snapshots s on s.id = p.current_snapshot_id`;

export const getPlan = async (db: OpsDb, orgId: string, id: string): Promise<PlanWithJoins | null> =>
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
export const listPlans = async (db: OpsDb, orgId: string, f: PlanFilter): Promise<PlanWithJoins[]> => {
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
      `${PLAN_SELECT} where ${where.join(" and ")} order by p.planned_start_at ${dir}, p.id ${dir} limit ${LIST_LIMIT}`,
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
