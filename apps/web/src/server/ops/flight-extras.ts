// 飛行記録の一覧・詳細に添える、日誌の食い違いと離陸時の未了事項の写し（Sprint 12c 設計 D）。
// 飛行記録ごとに計画・通報を引くと件数に比例してクエリが増えるため、飛行記録の ID の集合でまとめて引く
// （計画 1 回・通報 1 回・日誌との結び付き 1 回。件数に依らず一定）。records.ts・plans.ts から使う（このファイルはどちらも読まない）。
import type { ReportRowLite } from "@soraban/dips";
import { reportRequirement } from "@soraban/regulations";
import { journalMismatches, type JournalMismatch } from "./journal-logic";
import * as store from "./store";
import type { FlightWithTotal, Queryable, ReportRowWithTimes } from "./store";

import { gapDto, type GapDto } from "./field-compose";

export type { GapDto };

export type FlightExtra = {
  /** 日誌の食い違い（計画の時間帯の外・通報の記録）。計画なしは空。保存は止めない。 */
  readonly mismatches: readonly JournalMismatch[];
  /** 結び付いた離陸の行の、離陸時の未了事項の写し（現場モードを経由しなければ null）。 */
  readonly takeoffGaps: readonly GapDto[] | null;
  /** 結び付いた離陸の行の ID（現場モードを経由しなければ null）。 */
  readonly takeoffEventId: string | null;
  /** 計画の名称（食い違いの確認の表示用。計画なしは null）。 */
  readonly planTitle: string | null;
};

const EMPTY: FlightExtra = { mismatches: [], takeoffGaps: null, takeoffEventId: null, planTitle: null };

export { gapDto };

const asDate = (v: unknown): Date => (v instanceof Date ? v : new Date(String(v)));

const reportLite = (r: ReportRowWithTimes): ReportRowLite => ({
  id: r.id,
  kind: r.kind,
  status: r.status,
  channel: r.channel,
  createdAt: r.created_at_us,
  updatedAt: r.updated_at_us,
  fingerprint: r.fingerprint,
  reportedAt: r.reported_at_jst,
  dipsNumber: r.dips_number,
  numberUnavailable: r.number_unavailable,
});

/** 飛行記録のまとまりに対する、食い違いと離陸時の未了事項の写し（クエリは件数に依らず最大 3 回）。 */
export const enrichFlights = async (
  db: Queryable,
  orgId: string,
  rows: readonly FlightWithTotal[],
): Promise<Map<string, FlightExtra>> => {
  const out = new Map<string, FlightExtra>();
  if (rows.length === 0) return out;
  const planIds = [...new Set(rows.map((r) => r.flight_plan_id).filter((x): x is string => x !== null))];
  const [plans, reports, links] = await Promise.all([
    store.listPlansByIds(db, orgId, planIds),
    planIds.length > 0 ? store.listReportsFor(db, orgId, planIds) : Promise.resolve([] as ReportRowWithTimes[]),
    store.listJournalLinksFor(db, orgId, rows.map((r) => r.id)),
  ]);
  const planBy = new Map(plans.map((p) => [p.id, p]));
  const reportsBy = new Map<string, ReportRowLite[]>();
  for (const r of reports) reportsBy.set(r.plan_id, [...(reportsBy.get(r.plan_id) ?? []), reportLite(r)]);
  const linkBy = new Map(links.map((l) => [l.flight_record_id, l]));
  for (const f of rows) {
    const plan = f.flight_plan_id ? planBy.get(f.flight_plan_id) : undefined;
    const link = linkBy.get(f.id);
    let mismatches: JournalMismatch[] = [];
    if (plan) {
      const input = plan.snapshot_input as { droneWeightG?: number | null; purpose?: string | null };
      const requirement = reportRequirement({
        input: { droneWeightG: input.droneWeightG ?? null, purpose: input.purpose ?? null },
        result: plan.snapshot_result_slim,
      });
      mismatches = journalMismatches({
        takeoffAt: asDate(f.takeoff_at),
        landingAt: asDate(f.landing_at),
        plan: { plannedStartAt: asDate(plan.planned_start_at), durationMinutes: plan.duration_minutes, requirementKind: requirement.kind },
        reports: reportsBy.get(plan.id) ?? [],
      });
    }
    out.set(f.id, {
      mismatches,
      takeoffGaps: link ? (link.takeoff_gaps ?? []).map(gapDto) : null,
      takeoffEventId: link?.takeoff_event_id ?? null,
      planTitle: plan?.title ?? null,
    });
  }
  return out;
};

export const emptyFlightExtra = (): FlightExtra => EMPTY;
