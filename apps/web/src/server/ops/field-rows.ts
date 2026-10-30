// 現場の事実の行（DB）→ 状態の導出（field-logic）への橋渡し。records.ts・field.ts・today.ts が使う。
import type { FieldCheckResult, FieldDocKey, FieldEventItem, FieldEventKind, FieldSiteValues } from "@/lib/ops-field";
import { fieldState, type FieldEventLite, type FieldFlightRecordLite, type FieldState, type InspectionLite } from "./field-logic";
import * as store from "./store";
import type { FieldEventRowWithTimes, Queryable } from "./store";

const asDate = (v: unknown): Date => (v instanceof Date ? v : new Date(String(v)));

const siteOf = (r: FieldEventRowWithTimes): FieldSiteValues | null =>
  r.item === "site_conditions" && r.site_third_party && r.site_other_aircraft && r.site_rain && r.site_visibility
    ? {
        thirdParty: r.site_third_party,
        otherAircraft: r.site_other_aircraft,
        rain: r.site_rain,
        visibility: r.site_visibility,
        windMs: r.site_wind_ms === null ? null : Number(r.site_wind_ms),
        tempC: r.site_temp_c === null ? null : Number(r.site_temp_c),
      }
    : null;

export const toLite = (r: FieldEventRowWithTimes): FieldEventLite => ({
  id: r.id,
  clientEventId: r.client_event_id,
  kind: r.kind as FieldEventKind,
  item: r.item as FieldEventItem | null,
  result: r.result as FieldCheckResult | null,
  source: r.source,
  docKey: r.doc_key as FieldDocKey | null,
  site: siteOf(r),
  targetEventId: r.target_event_id,
  flightRecordId: r.flight_record_id,
  inspectionId: r.inspection_id,
  reportId: r.report_id,
  occurredAt: asDate(r.occurred_at).toISOString(),
  recordedKey: r.recorded_key,
  queued: r.queued,
  gaps: r.gaps === null ? null : (r.gaps as unknown as FieldEventLite["gaps"]),
});

/** 日常点検の行 → 導出に使う形（飛行前・指定の日付）。 */
export const inspectionLites = (
  rows: readonly { id: string; inspected_at: Date | string; has_abnormal: boolean }[],
  day: string,
): InspectionLite[] =>
  rows.map((x) => ({
    id: x.id,
    inspectedAt: asDate(x.inspected_at).toISOString(),
    date: day,
    timing: "pre_flight",
    hasAbnormal: x.has_abnormal,
  }));

/** 日常点検の行（飛行前・飛行後）→ 導出に使う形。点検の日付は行の実際の日付。 */
export const fieldInspectionLites = (
  rows: readonly { id: string; inspected_at: Date | string; has_abnormal: boolean; timing: "pre_flight" | "post_flight"; inspected_date_text: string }[],
): InspectionLite[] =>
  rows.map((x) => ({
    id: x.id,
    inspectedAt: asDate(x.inspected_at).toISOString(),
    date: x.inspected_date_text,
    timing: x.timing,
    hasAbnormal: x.has_abnormal,
  }));

export type LoadedFieldState = {
  readonly rows: readonly FieldEventRowWithTimes[];
  readonly events: readonly FieldEventLite[];
  readonly inspections: readonly InspectionLite[];
  readonly flightRecords: readonly FieldFlightRecordLite[];
  readonly state: FieldState;
};

/**
 * 計画の現場の状態を読んで導出する（計画ごとに行・日常点検・日誌に結び付いた飛行記録の取消の有無を読む）。
 * db にトランザクションの接続を渡せば、その中の最新の状態になる。
 */
export const loadFieldState = async (
  q: Queryable,
  orgId: string,
  plan: { readonly id: string; readonly aircraft_id: string },
  /** 日常点検を探す日（JST の YYYY-MM-DD）。日誌に結び付ける離陸の検査のように、点検が要らないときは null。 */
  day: string | null,
): Promise<LoadedFieldState> => {
  const rows = await store.listFieldEventsFor(q, orgId, [plan.id]);
  const events = rows.map(toLite);
  const inspections = day === null ? [] : fieldInspectionLites(await store.listFieldInspections(q, orgId, [plan.aircraft_id], day));
  const flightRecords = await store.listFlightRecordVoidState(
    q,
    orgId,
    rows.map((r) => r.flight_record_id).filter((x): x is string => x !== null),
  );
  return { rows, events, inspections, flightRecords, state: fieldState({ events, inspections, flightRecords, day: day ?? "" }) };
};
