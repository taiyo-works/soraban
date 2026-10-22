// 許可・承認の登録のサービス層（Sprint 12d 設計 B・F）。画面と API の両方がここを通る。
// 認可は authz.ts の can()（書き込みは運航管理者のみ・閲覧は全役割）、DB の読み書きは store.ts（org_id 必須）だけで行う。
// 登録は record_versions（entity_type = permit_registration）への追記だけ（訂正・失効・取消は版。物理削除はしない）。
// 登録は利用者の申告で、そらばんは許可書そのものを確認できない。DIPS には接続しない。
import { createHash, randomUUID } from "node:crypto";
import type { PermitPlaceScopeDb } from "@soraban/db";
import { jstDate } from "@/lib/ops-time";
import {
  effectiveLastDate,
  normalizePermitNumber,
  PERMIT_ANY_SCOPE_NOTE,
  PERMIT_DECLARATION_NOTE,
  PERMIT_FORMAT_UNVERIFIED_NOTE,
  PERMIT_KIND_LABEL,
  PERMIT_NO_DIPS_NOTE,
  PERMIT_TEXT_PLACE_NOTE,
  PERMIT_VALIDITY_LABEL,
  permitValidity,
  splitPermitNumbers,
  summarizePermitMatch,
  type PermitCoverage,
  type PermitKind,
  type PermitValidity,
  type PlanPermitSummary,
} from "./permit-logic";
import { matchWithCandidates, planPermitInputOfRow } from "./permit-match";
import { loadPlan } from "./plans";
import { snapshotPermitInputUpToDate } from "./plan-logic";
import { fieldError, invalid, nowOf, pickFields } from "./records";
import { asInput, assertCan, formatJstMinute, isUuid, type OpsContext, type VersionDto } from "./service";
import { collectMatching } from "./paging";
import * as store from "./store";
import { OpsError, type PermitRow } from "./store";
import { validateChangeMeta } from "./validate";
import { PERMIT_FIELD_LABELS, PERMIT_FIELDS, validatePermitRegistration, validateRevokedOn } from "./validate-permit";
import { parseClientRequestId } from "./validate-records";

// ---- DTO -----------------------------------------------------

export const PERMIT_COVERAGE_LABEL: Readonly<Record<PermitCoverage, string>> = { blanket: "包括許可", individual: "個別許可" };

export type PermitScopeDto = {
  readonly type: "any" | "listed";
  readonly ids: readonly string[];
  /** listed のとき、機体の登録記号・操縦者の氏名。 */
  readonly labels: readonly string[];
};

export type PermitDto = {
  readonly id: string;
  readonly permitNumber: string;
  readonly coverage: PermitCoverage;
  readonly coverageLabel: string;
  readonly kinds: readonly { readonly kind: PermitKind; readonly label: string }[];
  readonly airportNames: readonly string[];
  readonly issuedOn: string;
  readonly validFrom: string;
  readonly validTo: string;
  readonly status: "active" | "revoked";
  /** 失効・取消された日（この日以降は使えない）。 */
  readonly revokedOn: string | null;
  /** 有効な最終日（満了日と、失効日の前日の早いほう）。 */
  readonly effectiveLastDate: string;
  /** 有効性（今日の日付から導出）。 */
  readonly validity: PermitValidity;
  readonly validityLabel: string;
  readonly placeScope: PermitPlaceScopeDb;
  /** 場所の範囲の要約（全国／円の数／文章のみ）。 */
  readonly placeSummary: string;
  readonly aircraftScope: PermitScopeDto;
  readonly pilotScope: PermitScopeDto;
  readonly maxAltitudeM: number | null;
  readonly maxWeightKg: number | null;
  readonly requiresObserver: boolean;
  readonly requiresAccessControl: boolean;
  /** 機械的に照合できない条件の文章。表示するだけで、照合には使わない。適用した許可にも常に添える。 */
  readonly conditionsText: string | null;
  readonly source: "manual" | "dips_fpa";
  readonly version: number;
  /** 現在の版のハッシュ（スナップショットの根拠と同じ値）。 */
  readonly versionHash: string;
  readonly voided: boolean;
  readonly voidedAt: string | null;
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
  /** 画面・API に常に添える固定の文言。 */
  readonly declaration: string;
  readonly noDipsNote: string;
  /** 照合できない・許可書で確認が要る旨（場所が文章のみ・機体や操縦者を限定しない・様式の要確認）。 */
  readonly notes: readonly string[];
};

export type PermitBasisPlanDto = {
  readonly planId: string;
  readonly title: string;
  readonly plannedDate: string;
  readonly snapshotId: string;
  readonly snapshotSeq: number;
  /** 根拠にしている版（現在のスナップショットの permitBasis）。 */
  readonly versionNo: number | null;
  readonly applied: boolean;
  /** 根拠にしている版が、登録の現在の版か（違えば、計画は「判定が古い」になる）。 */
  readonly isCurrentVersion: boolean;
};

export type PermitDetailDto = PermitDto & {
  /** この登録を根拠にしている計画（現在のスナップショットの permitBasis から。中止した計画を除く）。 */
  readonly basisPlans: readonly PermitBasisPlanDto[];
  readonly basisPlanCount: number;
};

export type AffectsPlansDto = {
  /** 番号・種類・期間・範囲などの、照合に関わる項目が変わったか。 */
  readonly changed: boolean;
  /** 影響する計画の数（この登録を根拠にしている計画と、許可番号の欄に番号がある計画）。 */
  readonly count: number;
  /** 影響する計画があるときの文（「判定が古い」になる旨）。 */
  readonly note: string | null;
};

export type PermitChangeDto = PermitDto & { readonly affectsPlans: AffectsPlansDto };

export type PermitContentDto = {
  readonly permitNumber: string;
  readonly coverage: PermitCoverage;
  readonly kinds: readonly PermitKind[];
  readonly airportNames: readonly string[];
  readonly issuedOn: string;
  readonly validFrom: string;
  readonly validTo: string;
  readonly status: "active" | "revoked";
  readonly revokedOn: string | null;
  readonly placeScope: PermitPlaceScopeDb;
  readonly aircraftScope: { readonly type: "any" | "listed"; readonly ids: readonly string[] };
  readonly pilotScope: { readonly type: "any" | "listed"; readonly ids: readonly string[] };
  readonly maxAltitudeM: number | null;
  readonly maxWeightKg: number | null;
  readonly requiresObserver: boolean;
  readonly requiresAccessControl: boolean;
  readonly conditionsText: string | null;
};

export type PermitVersionDto = VersionDto & {
  /** その版のハッシュ（record_versions.content_hash。スナップショットの versionHash と同じ値）。 */
  readonly contentHash: string;
  readonly prevHash: string;
  /** その版の内容（スナップショットの根拠から、当時の内容を読める）。 */
  readonly content: PermitContentDto;
};

export const AFFECTS_PLANS_NOTE = (n: number): string =>
  `この登録を使っている計画 ${n} 件が「判定が古い」になります。計画ごとに判定をやり直してください（自動では書き換えません）。`;

const MATCHING_FIELDS: readonly string[] = [
  "permit_number",
  "coverage",
  "kinds",
  "valid_from",
  "valid_to",
  "place_scope",
  "aircraft_scope",
  "pilot_scope",
  "max_altitude_m",
  "max_weight_kg",
  "requires_observer",
  "requires_access_control",
  "airport_names",
];

type Labels = { readonly aircraft: ReadonlyMap<string, string>; readonly pilots: ReadonlyMap<string, string> };

const placeSummaryOf = (p: PermitPlaceScopeDb): string =>
  p.type === "nationwide" ? "全国" : p.type === "circles" ? `円 ${p.circles.length} 件` : "文章のみ（照合できません）";

const scopeDto = (s: { readonly type: "any" | "listed"; readonly ids?: readonly string[] }, names: ReadonlyMap<string, string>): PermitScopeDto => ({
  type: s.type,
  ids: s.type === "listed" ? (s.ids ?? []) : [],
  labels: s.type === "listed" ? (s.ids ?? []).map((id) => names.get(id) ?? "（不明）") : [],
});

const permitDto = (r: PermitRow, today: string, labels: Labels): PermitDto => {
  const voided = r.voided_at !== null;
  const validity = permitValidity({ validFrom: r.valid_from, validTo: r.valid_to, status: r.status, voided }, today);
  const notes: string[] = [PERMIT_FORMAT_UNVERIFIED_NOTE];
  if (r.place_scope.type === "text") notes.push(PERMIT_TEXT_PLACE_NOTE);
  if (r.aircraft_scope.type === "any" || r.pilot_scope.type === "any") notes.push(PERMIT_ANY_SCOPE_NOTE);
  return {
    id: r.id,
    permitNumber: r.permit_number,
    coverage: r.coverage,
    coverageLabel: PERMIT_COVERAGE_LABEL[r.coverage],
    kinds: r.kinds.map((kind) => ({ kind, label: PERMIT_KIND_LABEL[kind] })),
    airportNames: r.airport_names,
    issuedOn: r.issued_on,
    validFrom: r.valid_from,
    validTo: r.valid_to,
    status: r.status,
    revokedOn: r.revoked_on,
    effectiveLastDate: effectiveLastDate({ validTo: r.valid_to, revokedOn: r.revoked_on }),
    validity,
    validityLabel: PERMIT_VALIDITY_LABEL[validity],
    placeScope: r.place_scope,
    placeSummary: placeSummaryOf(r.place_scope),
    aircraftScope: scopeDto(r.aircraft_scope, labels.aircraft),
    pilotScope: scopeDto(r.pilot_scope, labels.pilots),
    maxAltitudeM: r.max_altitude_m,
    maxWeightKg: r.max_weight_kg === null ? null : Number(r.max_weight_kg),
    requiresObserver: r.requires_observer,
    requiresAccessControl: r.requires_access_control,
    conditionsText: r.conditions_text,
    source: r.source,
    version: r.current_version,
    versionHash: r.version_hash,
    voided,
    voidedAt: r.voided_at === null ? null : new Date(r.voided_at).toISOString(),
    createdAt: r.created_at === null ? null : new Date(r.created_at).toISOString(),
    updatedAt: r.updated_at === null ? null : new Date(r.updated_at).toISOString(),
    declaration: PERMIT_DECLARATION_NOTE,
    noDipsNote: PERMIT_NO_DIPS_NOTE,
    notes,
  };
};

const loadLabels = async (ctx: OpsContext, rows: readonly PermitRow[]): Promise<Labels> => {
  const aircraftIds = new Set<string>();
  const pilotIds = new Set<string>();
  for (const r of rows) {
    if (r.aircraft_scope.type === "listed") for (const id of r.aircraft_scope.ids) aircraftIds.add(id);
    if (r.pilot_scope.type === "listed") for (const id of r.pilot_scope.ids) pilotIds.add(id);
  }
  const [a, p] = await Promise.all([
    store.listAircraftMarks(ctx.db, ctx.member.org_id, [...aircraftIds]),
    store.listPilotNames(ctx.db, ctx.member.org_id, [...pilotIds]),
  ]);
  return { aircraft: new Map(a.map((x) => [x.id, x.label])), pilots: new Map(p.map((x) => [x.id, x.label])) };
};

const today = (ctx: OpsContext): string => jstDate(nowOf(ctx));

// ---- 一覧・詳細 ----------------------------------------------

export type PermitListFilter = {
  readonly includeVoided?: boolean;
  /** 有効性での絞り込み（導出）。 */
  readonly validity?: PermitValidity;
  /** 番号・空港名の部分一致（全角・半角・大文字小文字・空白の違いは無視）。 */
  readonly q?: string;
};

const VALIDITIES = Object.keys(PERMIT_VALIDITY_LABEL) as PermitValidity[];

/** 一覧の絞り込み（クエリ）を読む。includeVoided=1・validity・q。 */
export const parsePermitFilter = (q: URLSearchParams): PermitListFilter => {
  const validity = q.get("validity");
  if (validity && !(VALIDITIES as readonly string[]).includes(validity)) {
    fieldError("validity", "unknown_value", `有効性は ${VALIDITIES.join("・")} のいずれかです`);
  }
  const text = q.get("q")?.trim();
  return {
    ...(q.get("includeVoided") === "1" ? { includeVoided: true } : {}),
    ...(validity ? { validity: validity as PermitValidity } : {}),
    ...(text ? { q: text } : {}),
  };
};

export const listPermits = async (ctx: OpsContext, filter: PermitListFilter = {}): Promise<PermitDto[]> => {
  assertCan(ctx, "permit.read");
  // 取消を絞り込みたいとき（validity=voided）は取消も読む
  const includeVoided = filter.includeVoided === true || filter.validity === "voided";
  const t = today(ctx);
  const key = filter.q ? normalizePermitNumber(filter.q) : null;
  const keep = (d: PermitDto): boolean =>
    (!filter.validity || d.validity === filter.validity) &&
    (key === null || normalizePermitNumber(d.permitNumber).includes(key) || d.airportNames.some((n) => normalizePermitNumber(n).includes(key)));
  const dtosOf = async (rows: readonly PermitRow[]): Promise<PermitDto[]> => {
    const labels = await loadLabels(ctx, rows);
    return rows.map((r) => permitDto(r, t, labels));
  };
  if (!filter.validity && key === null) return dtosOf(await store.listPermits(ctx.db, ctx.member.org_id, includeVoided));
  // 有効性・番号の検索は日付や正規化から導出する。上限の後で絞ると古い一致する登録が漏れるため、ページを順に読んで一致するものを集める
  return collectMatching(
    (offset) => store.listPermits(ctx.db, ctx.member.org_id, includeVoided, offset),
    async (rows) => (await dtosOf(rows)).filter(keep),
    store.LIST_LIMIT,
  );
};

const loadPermit = async (ctx: OpsContext, id: string): Promise<PermitRow> => {
  const r = isUuid(id) ? await store.getPermit(ctx.db, ctx.member.org_id, id) : null;
  if (!r) throw new OpsError(404, "not_found");
  return r;
};

const dtoOf = async (ctx: OpsContext, r: PermitRow): Promise<PermitDto> => permitDto(r, today(ctx), await loadLabels(ctx, [r]));

type BasisItem = { readonly registrationId?: unknown; readonly versionNo?: unknown; readonly applied?: unknown };

const basisPlansOf = async (ctx: OpsContext, r: PermitRow): Promise<PermitBasisPlanDto[]> =>
  (await store.listPlansBasedOnPermit(ctx.db, ctx.member.org_id, r.id)).map((p) => {
    const entry = (Array.isArray(p.permit_basis) ? (p.permit_basis as BasisItem[]) : []).find((b) => b.registrationId === r.id);
    const versionNo = typeof entry?.versionNo === "number" ? entry.versionNo : null;
    return {
      planId: p.id,
      title: p.title,
      plannedDate: p.planned_date_text,
      snapshotId: p.current_snapshot_id,
      snapshotSeq: p.snapshot_seq,
      versionNo,
      applied: entry?.applied === true,
      isCurrentVersion: versionNo === r.current_version,
    };
  });

export const getPermit = async (ctx: OpsContext, id: string): Promise<PermitDetailDto> => {
  assertCan(ctx, "permit.read");
  const r = await loadPermit(ctx, id);
  const basisPlans = await basisPlansOf(ctx, r);
  return { ...(await dtoOf(ctx, r)), basisPlans, basisPlanCount: basisPlans.length };
};

// ---- 版の履歴 ------------------------------------------------

const contentOfData = (d: Readonly<Record<string, unknown>>): PermitContentDto => {
  const scope = (v: unknown): { type: "any" | "listed"; ids: readonly string[] } => {
    const o = (v ?? {}) as { type?: unknown; ids?: unknown };
    return o.type === "listed" ? { type: "listed", ids: Array.isArray(o.ids) ? (o.ids as string[]) : [] } : { type: "any", ids: [] };
  };
  const str = (v: unknown): string => (typeof v === "string" ? v : "");
  return {
    permitNumber: str(d["permit_number"]),
    coverage: d["coverage"] === "individual" ? "individual" : "blanket",
    kinds: Array.isArray(d["kinds"]) ? (d["kinds"] as PermitKind[]) : [],
    airportNames: Array.isArray(d["airport_names"]) ? (d["airport_names"] as string[]) : [],
    issuedOn: str(d["issued_on"]),
    validFrom: str(d["valid_from"]),
    validTo: str(d["valid_to"]),
    status: d["status"] === "revoked" ? "revoked" : "active",
    revokedOn: typeof d["revoked_on"] === "string" ? d["revoked_on"] : null,
    placeScope: (d["place_scope"] ?? { type: "text", text: "" }) as PermitPlaceScopeDb,
    aircraftScope: scope(d["aircraft_scope"]),
    pilotScope: scope(d["pilot_scope"]),
    maxAltitudeM: typeof d["max_altitude_m"] === "number" ? d["max_altitude_m"] : null,
    maxWeightKg: typeof d["max_weight_kg"] === "number" ? d["max_weight_kg"] : null,
    requiresObserver: d["requires_observer"] === true,
    requiresAccessControl: d["requires_access_control"] === true,
    conditionsText: typeof d["conditions_text"] === "string" ? d["conditions_text"] : null,
  };
};

/** 版の履歴（ハッシュの連鎖と、各版の内容つき）。他の組織・存在しない登録は 404。 */
export const listPermitVersions = async (ctx: OpsContext, id: string): Promise<PermitVersionDto[]> => {
  assertCan(ctx, "permit.read");
  await loadPermit(ctx, id);
  const rows = await store.listVersions(ctx.db, ctx.member.org_id, "permit_registration", id);
  if (rows.length === 0) throw new OpsError(404, "not_found");
  return rows.map((r) => {
    const created = new Date(r.created_at as unknown as string | Date);
    const prev = r.version_no > 1 ? rows.find((x) => x.version_no === r.version_no - 1) : undefined;
    const changed =
      prev && r.op === "update"
        ? Object.keys({ ...prev.data, ...r.data }).filter((k) => JSON.stringify(prev.data[k] ?? null) !== JSON.stringify(r.data[k] ?? null))
        : [];
    return {
      versionNo: r.version_no,
      op: r.op,
      actorName: r.actor_kind === "system" ? "システム" : (r.actor_display_name ?? "（不明）"),
      createdAt: created.toISOString(),
      createdAtJst: formatJstMinute(created),
      reason: r.reason,
      changedFields: changed.map((k) => PERMIT_FIELD_LABEL_OF(k)),
      contentHash: r.content_hash,
      prevHash: r.prev_hash,
      content: contentOfData(r.data),
    };
  });
};

const PERMIT_FIELD_LABEL_OF = (k: string): string => PERMIT_FIELD_LABELS[k] ?? k;

// ---- 書き込み ------------------------------------------------

/** 版の data（snake_case）を API の入力の形（camelCase）にする（訂正の合成用）。 */
const permitInputFromData = (d: Readonly<Record<string, unknown>>): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const [api, col] of Object.entries(PERMIT_FIELDS)) out[api] = d[col];
  return out;
};

/** clientRequestId から、組織ごとに決まる登録の ID を作る（同じ ID の作成は版が重複するため、二重の登録を防げる）。 */
const idFromRequest = (orgId: string, requestId: string): string => {
  const h = createHash("sha256").update(`permit_registration:${orgId}:${requestId}`).digest("hex");
  const variant = ((parseInt(h.slice(16, 17), 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

/** 機体・操縦者の範囲に選んだ ID が同じ組織のものか（他の組織の ID は 400。DB のトリガーも SB404 で拒む）。 */
const checkScopeIds = async (
  ctx: OpsContext,
  data: { readonly aircraft_scope: { readonly type: string; readonly ids?: readonly string[] }; readonly pilot_scope: { readonly type: string; readonly ids?: readonly string[] } },
): Promise<void> => {
  const check = async (key: string, scope: { readonly type: string; readonly ids?: readonly string[] }, load: typeof store.listAircraftMarks, label: string) => {
    if (scope.type !== "listed" || !scope.ids) return;
    const found = await load(ctx.db, ctx.member.org_id, scope.ids);
    if (found.length !== scope.ids.length) fieldError(key, "unknown_id", `${label}に選べないものが含まれています`);
  };
  await check("aircraftScope", data.aircraft_scope, store.listAircraftMarks, "機体");
  await check("pilotScope", data.pilot_scope, store.listPilotNames, "操縦者");
};

export type PermitSaveResult = { readonly created: boolean; readonly record: PermitDto };

export const createPermit = async (ctx: OpsContext, body: unknown): Promise<PermitSaveResult> => {
  assertCan(ctx, "permit.create");
  const input = asInput(body);
  const req = parseClientRequestId(input["clientRequestId"]);
  const v = validatePermitRegistration(input);
  if (!req.ok || !v.ok) {
    return invalid(v, req.ok ? undefined : { errors: { clientRequestId: "送信の識別子が正しくありません" }, codes: { clientRequestId: "invalid" } });
  }
  await checkScopeIds(ctx, v.data);
  const id = req.value ? idFromRequest(ctx.member.org_id, req.value) : randomUUID();
  try {
    await store.appendVersion(ctx.db, {
      orgId: ctx.member.org_id,
      entityType: "permit_registration",
      entityId: id,
      op: "create",
      data: v.data,
      reason: null,
      actorMemberId: ctx.member.id,
    });
  } catch (e) {
    // 同じ clientRequestId の再送：新しい登録を作らず、既存の登録を返す
    if (e instanceof OpsError && e.code === "already_exists" && req.value) {
      const existing = await store.getPermit(ctx.db, ctx.member.org_id, id);
      if (existing) return { created: false, record: await dtoOf(ctx, existing) };
    }
    throw e;
  }
  return { created: true, record: await dtoOf(ctx, await loadPermit(ctx, id)) };
};

/** 変更が影響する計画の数：この登録を根拠にしている計画と、許可番号の欄にこの登録の番号がある計画。 */
const affectsPlans = async (ctx: OpsContext, registrationId: string, keys: readonly string[], changed: boolean): Promise<AffectsPlansDto> => {
  const ids = new Set((await store.listPlansBasedOnPermit(ctx.db, ctx.member.org_id, registrationId)).map((p) => p.id));
  const keySet = new Set(keys);
  for (const f of await store.listPlanPermitNumberFields(ctx.db, ctx.member.org_id)) {
    if (splitPermitNumbers(f.permit_numbers).some((t) => keySet.has(t.key))) ids.add(f.id);
  }
  return { changed, count: ids.size, note: changed && ids.size > 0 ? AFFECTS_PLANS_NOTE(ids.size) : null };
};

export const updatePermit = async (ctx: OpsContext, id: string, body: unknown): Promise<PermitChangeDto> => {
  const current = await loadPermit(ctx, id);
  assertCan(ctx, "permit.update");
  const input = asInput(body);
  const meta = validateChangeMeta(input);
  const base = (await store.latestVersionData(ctx.db, ctx.member.org_id, "permit_registration", id)) ?? {};
  const v = validatePermitRegistration({ ...permitInputFromData(base), ...pickFields(input, PERMIT_FIELDS) });
  if (!meta.ok || !v.ok) return invalid(v, meta.ok ? undefined : { errors: { ...meta.errors }, codes: {} });
  if (current.voided_at !== null) throw new OpsError(409, "voided");
  if (current.status === "revoked") throw new OpsError(409, "revoked");
  await checkScopeIds(ctx, v.data);
  const data = { ...v.data, source: base["source"] ?? "manual", external_ref: base["external_ref"] ?? {} };
  const changed = MATCHING_FIELDS.some((k) => JSON.stringify(base[k] ?? null) !== JSON.stringify((data as Record<string, unknown>)[k] ?? null));
  await store.appendVersion(ctx.db, {
    orgId: ctx.member.org_id,
    entityType: "permit_registration",
    entityId: id,
    op: "update",
    data,
    reason: meta.data.reason,
    actorMemberId: ctx.member.id,
    expectedVersion: meta.data.expectedVersion,
  });
  const saved = await loadPermit(ctx, id);
  return { ...(await dtoOf(ctx, saved)), affectsPlans: await affectsPlans(ctx, id, [current.permit_number_key, saved.permit_number_key], changed) };
};

/** 失効（失効日以降は使えない。有効な登録だけ）。元の版の内容は変えず、状態と失効日だけを変えた版を追記する。 */
export const revokePermit = async (ctx: OpsContext, id: string, body: unknown): Promise<PermitChangeDto> => {
  const current = await loadPermit(ctx, id);
  assertCan(ctx, "permit.revoke");
  const input = asInput(body);
  const meta = validateChangeMeta(input);
  const rv = validateRevokedOn(input);
  if (!meta.ok || !rv.ok) return invalid(rv, meta.ok ? undefined : { errors: { ...meta.errors }, codes: {} });
  if (current.voided_at !== null) throw new OpsError(409, "voided");
  if (current.status === "revoked") throw new OpsError(409, "revoked");
  const base = (await store.latestVersionData(ctx.db, ctx.member.org_id, "permit_registration", id)) ?? {};
  await store.appendVersion(ctx.db, {
    orgId: ctx.member.org_id,
    entityType: "permit_registration",
    entityId: id,
    op: "update",
    data: { ...base, status: "revoked", revoked_on: rv.data.revoked_on },
    reason: meta.data.reason,
    actorMemberId: ctx.member.id,
    expectedVersion: meta.data.expectedVersion,
  });
  return { ...(await dtoOf(ctx, await loadPermit(ctx, id))), affectsPlans: await affectsPlans(ctx, id, [current.permit_number_key], true) };
};

/** 取消（誤登録。理由必須。物理削除はしない）。取消した登録の番号は再登録できる。 */
export const voidPermit = async (ctx: OpsContext, id: string, body: unknown): Promise<PermitChangeDto> => {
  const current = await loadPermit(ctx, id);
  assertCan(ctx, "permit.void");
  const meta = validateChangeMeta(asInput(body));
  if (!meta.ok) throw new OpsError(400, "invalid_input", meta.errors);
  if (current.voided_at !== null) throw new OpsError(409, "voided");
  const base = (await store.latestVersionData(ctx.db, ctx.member.org_id, "permit_registration", id)) ?? {};
  await store.appendVersion(ctx.db, {
    orgId: ctx.member.org_id,
    entityType: "permit_registration",
    entityId: id,
    op: "void",
    data: base,
    reason: meta.data.reason,
    actorMemberId: ctx.member.id,
    expectedVersion: meta.data.expectedVersion,
  });
  return { ...(await dtoOf(ctx, await loadPermit(ctx, id))), affectsPlans: await affectsPlans(ctx, id, [current.permit_number_key], true) };
};

// ---- 計画の照合の結果 ------------------------------------------

export type PlanPermitCandidateDto = {
  readonly registrationId: string;
  readonly permitNumber: string;
  readonly versionNo: number;
  readonly coverage: PermitCoverage;
  readonly coverageLabel: string;
  readonly kinds: readonly { readonly kind: PermitKind; readonly label: string }[];
  readonly validFrom: string;
  /** 有効な最終日。 */
  readonly validTo: string;
  /** 「番号を入れる」で計画の許可番号の欄に足す文字。 */
  readonly insertText: string;
};

export type PlanPermitsDto = {
  readonly planId: string;
  readonly planVersion: number;
  readonly permits: PlanPermitSummary;
  /** 範囲に収まる登録済みの許可の候補（番号が欄にないもの）。提案だけで、判定には使わない。 */
  readonly candidates: readonly PlanPermitCandidateDto[];
  /** 現在のスナップショットが根拠にした登録の版（input.permitBasis。無ければ空）。 */
  readonly snapshotBasis: readonly unknown[];
  /** 現在のスナップショットの許可の入力（pilotPermits・permitBasis）が、現在の登録で照合し直した結果と同じか。違えば「判定が古い」。 */
  readonly judgementUpToDate: boolean;
  readonly declaration: string;
  readonly noDipsNote: string;
  readonly notes: readonly string[];
};

/** 計画の照合の結果（番号ごとの状態・理由・候補）。計画の閲覧と同じ認可（全役割）。 */
export const getPlanPermits = async (ctx: OpsContext, planId: string): Promise<PlanPermitsDto> => {
  assertCan(ctx, "plan.read");
  const plan = await loadPlan(ctx, planId);
  const match = await matchWithCandidates(ctx.db, ctx.member.org_id, planPermitInputOfRow(plan));
  const snapshotInput = plan.snapshot_input as { permitBasis?: unknown[]; pilotPermits?: unknown[] };
  const basis = snapshotInput.permitBasis ?? [];
  const upToDate = snapshotPermitInputUpToDate(snapshotInput, match);
  return {
    planId: plan.id,
    planVersion: plan.current_version,
    permits: summarizePermitMatch(match),
    candidates: match.candidates.map((c) => ({
      registrationId: c.registration.id,
      permitNumber: c.registration.permitNumber,
      versionNo: c.registration.versionNo,
      coverage: c.registration.coverage,
      coverageLabel: PERMIT_COVERAGE_LABEL[c.registration.coverage],
      kinds: c.relevantKinds.map((kind) => ({ kind, label: PERMIT_KIND_LABEL[kind] })),
      validFrom: c.registration.validFrom,
      validTo: c.effectiveLastDate,
      insertText: c.registration.permitNumber,
    })),
    snapshotBasis: basis,
    judgementUpToDate: upToDate,
    declaration: PERMIT_DECLARATION_NOTE,
    noDipsNote: PERMIT_NO_DIPS_NOTE,
    notes: [PERMIT_FORMAT_UNVERIFIED_NOTE],
  };
};
