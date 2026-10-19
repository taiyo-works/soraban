// 運航管理の DB の読み書き（Sprint 10 設計 B・C）。
// - 読み出しはすべて org_id を必須の引数に取る（組織の条件を付け忘れない）。
// - 書き込みは record_versions への追加だけ（ヘッド表は DB のトリガーが作る）。
// - 楽観的排他は set_config('soraban.expected_version', …, true) で DB のトリガーに渡す（0006）。
import type {
  AircraftRow,
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
      throw new OpsError(409, c.includes("registration") ? "duplicate_registration" : c.includes("email") ? "duplicate_email" : c.includes("pilots_member") ? "member_already_linked" : "duplicate");
    }
    case "23503":
      throw new OpsError(404, "not_found");
    case "23514":
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

export const getAircraft = async (db: OpsDb, orgId: string, id: string): Promise<AircraftRow | null> =>
  (await db.query<AircraftRow>("select * from aircraft where org_id = $1 and id = $2", [orgId, id])).rows[0] ?? null;

export const listAircraft = async (db: OpsDb, orgId: string, includeVoided: boolean): Promise<AircraftRow[]> =>
  (
    await db.query<AircraftRow>(
      `select * from aircraft where org_id = $1 ${includeVoided ? "" : "and voided_at is null"}
        order by voided_at nulls first, registration_mark, id`,
      [orgId],
    )
  ).rows;

export const getPilot = async (db: OpsDb, orgId: string, id: string): Promise<PilotRow | null> =>
  (await db.query<PilotRow>("select * from pilots where org_id = $1 and id = $2", [orgId, id])).rows[0] ?? null;

export const listPilots = async (db: OpsDb, orgId: string, includeVoided: boolean): Promise<PilotRow[]> =>
  (
    await db.query<PilotRow>(
      `select * from pilots where org_id = $1 ${includeVoided ? "" : "and voided_at is null"}
        order by voided_at nulls first, full_name, id`,
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
