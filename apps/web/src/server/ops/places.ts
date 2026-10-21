// よく使う地点（社内拠点など）のサービス層（Sprint 12a 設計 B4・I）。画面と API の両方がここを通る。
// 運航管理者が登録・訂正・取消（版の履歴）。全役割が一覧と詳細を見られる。コードに本社の座標を直書きしない（組織ごとのデータ）。
import { randomUUID } from "node:crypto";
import type { SavedPlaceRow } from "@soraban/db";
import { invalid, num, pickFields } from "./records";
import { asInput, assertCan, iso, isUuid, listEntityVersions, type OpsContext, type VersionDto } from "./service";
import * as store from "./store";
import { OpsError } from "./store";
import { validateChangeMeta } from "./validate";
import { PLACE_FIELDS, validatePlace } from "./validate-plan";

export type PlaceDto = {
  readonly id: string;
  readonly name: string;
  readonly addressText: string | null;
  readonly latitude: number;
  readonly longitude: number;
  readonly note: string | null;
  readonly version: number;
  readonly voided: boolean;
  readonly voidedAt: string | null;
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
};

const placeDto = (r: SavedPlaceRow): PlaceDto => ({
  id: r.id,
  name: r.name,
  addressText: r.address_text,
  latitude: num(r.latitude)!,
  longitude: num(r.longitude)!,
  note: r.note,
  version: r.current_version,
  voided: r.voided_at !== null,
  voidedAt: iso(r.voided_at),
  createdAt: iso(r.created_at),
  updatedAt: iso(r.updated_at),
});

const placeInputFromData = (d: Readonly<Record<string, unknown>>): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const [api, col] of Object.entries(PLACE_FIELDS)) out[api] = d[col];
  return out;
};

export const listPlaces = async (ctx: OpsContext, includeVoided = false): Promise<PlaceDto[]> => {
  assertCan(ctx, "place.read");
  return (await store.listSavedPlaces(ctx.db, ctx.member.org_id, includeVoided)).map(placeDto);
};

const loadPlace = async (ctx: OpsContext, id: string): Promise<SavedPlaceRow> => {
  const r = isUuid(id) ? await store.getSavedPlace(ctx.db, ctx.member.org_id, id) : null;
  if (!r) throw new OpsError(404, "not_found");
  return r;
};

export const getPlace = async (ctx: OpsContext, id: string): Promise<PlaceDto> => {
  assertCan(ctx, "place.read");
  return placeDto(await loadPlace(ctx, id));
};

export const createPlace = async (ctx: OpsContext, body: unknown): Promise<PlaceDto> => {
  assertCan(ctx, "place.create");
  const v = validatePlace(asInput(body));
  if (!v.ok) return invalid(v);
  const id = randomUUID();
  await store.appendVersion(ctx.db, {
    orgId: ctx.member.org_id,
    entityType: "saved_place",
    entityId: id,
    op: "create",
    data: v.data,
    reason: null,
    actorMemberId: ctx.member.id,
  });
  return placeDto(await loadPlace(ctx, id));
};

export const updatePlace = async (ctx: OpsContext, id: string, body: unknown): Promise<PlaceDto> => {
  const current = await loadPlace(ctx, id);
  assertCan(ctx, "place.update");
  const input = asInput(body);
  const meta = validateChangeMeta(input);
  const base = (await store.latestVersionData(ctx.db, ctx.member.org_id, "saved_place", id)) ?? {};
  const v = validatePlace({ ...placeInputFromData(base), ...pickFields(input, PLACE_FIELDS) });
  if (!meta.ok || !v.ok) return invalid(v, meta.ok ? undefined : { errors: { ...meta.errors }, codes: {} });
  if (current.voided_at !== null) throw new OpsError(409, "voided");
  await store.appendVersion(ctx.db, {
    orgId: ctx.member.org_id,
    entityType: "saved_place",
    entityId: id,
    op: "update",
    data: v.data,
    reason: meta.data.reason,
    actorMemberId: ctx.member.id,
    expectedVersion: meta.data.expectedVersion,
  });
  return placeDto(await loadPlace(ctx, id));
};

export const voidPlace = async (ctx: OpsContext, id: string, body: unknown): Promise<PlaceDto> => {
  const current = await loadPlace(ctx, id);
  assertCan(ctx, "place.void");
  const meta = validateChangeMeta(asInput(body));
  if (!meta.ok) throw new OpsError(400, "invalid_input", meta.errors);
  if (current.voided_at !== null) throw new OpsError(409, "voided");
  const data = (await store.latestVersionData(ctx.db, ctx.member.org_id, "saved_place", id)) ?? {};
  await store.appendVersion(ctx.db, {
    orgId: ctx.member.org_id,
    entityType: "saved_place",
    entityId: id,
    op: "void",
    data,
    reason: meta.data.reason,
    actorMemberId: ctx.member.id,
    expectedVersion: meta.data.expectedVersion,
  });
  return placeDto(await loadPlace(ctx, id));
};

export const listPlaceVersions = async (ctx: OpsContext, id: string): Promise<VersionDto[]> => {
  assertCan(ctx, "place.read");
  await loadPlace(ctx, id);
  return listEntityVersions(ctx, "saved_place", id);
};
