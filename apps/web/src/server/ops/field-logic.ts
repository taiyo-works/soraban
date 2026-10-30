// 現場の状態・遷移・離陸の未了事項（Sprint 12c 設計 B・D）。純粋関数。DB・時計・ネットワークに触れない。
//   fieldState        現場の事実の行（flight_field_events）と実際の日常点検の記録から、確認項目・飛行の組・日誌の状態を毎回導出する
//   decideTransition  新しい 1 行を追記してよいか（遷移の規則を 1 か所で決める。サービス層は計画ごとの排他の下でこれを呼ぶ）
//   takeoffGaps       離陸の時点の未了事項（離陸の行の gaps に写しを残す）
//
// 守ること：
//   - 保存された「状態」は読まない。行の有無から毎回導出する（行を足すだけで状態が変わる）。
//   - 未了事項があっても離陸の記録は止めない（事実の記録を失わせない）。
//   - 取り消された行（undo の対象）は無いものとして扱う。undo と journal_linked は取り消せない。
//   - 通報を免除するような語（禁止語。12a 契約 15）を作らない。推奨・対象外（模型航空機）は通報の未了に数えない。
import {
  FIELD_CHECK_ITEMS,
  FIELD_DOC_KEYS,
  FIELD_GAP_ITEMS,
  siteHasAttention,
  type FieldCheckItem,
  type FieldCheckResult,
  type FieldDocKey,
  type FieldEventItem,
  type FieldEventKind,
  type FieldGapItem,
  type FieldGapState,
  type FieldSiteValues,
} from "@/lib/ops-field";
import type { OutboxEntry } from "@/lib/ops-outbox";
import { parseJstMinute } from "@/lib/ops-time";
import type { PlanState } from "./plan-logic";

// ---- 入力 -----------------------------------------------------------------

/** 状態の導出に使う、現場の事実の 1 行。 */
export type FieldEventLite = {
  readonly id: string;
  /** 端末が付けた識別子。送信待ちの行の target はこちらで指されることがある。 */
  readonly clientEventId: string;
  readonly kind: FieldEventKind;
  readonly item: FieldEventItem | null;
  readonly result: FieldCheckResult | null;
  readonly source: string | null;
  /** Sprint 14：docs_confirm の対象（それ以外は null か省略）。 */
  readonly docKey?: FieldDocKey | null;
  /** Sprint 14：site_conditions の値（それ以外は null か省略）。備考は端末に残さないため、導出には使わない。 */
  readonly site?: FieldSiteValues | null;
  /** landing は対応する takeoff、undo は取り消す行、journal_linked は結び付けた takeoff（id か clientEventId）。 */
  readonly targetEventId: string | null;
  readonly flightRecordId: string | null;
  readonly inspectionId: string | null;
  readonly reportId: string | null;
  /** 事実の時刻（ISO）。 */
  readonly occurredAt: string;
  /** 記録の順（古い順に辞書順で並ぶ鍵。DB の recorded_at のマイクロ秒つき ISO、または送信待ちの通し番号）。 */
  readonly recordedKey: string;
  readonly queued: boolean;
  readonly gaps: readonly FieldGap[] | null;
};

/** 実際の日常点検の記録（計画の機体のもの。取消していないもの）。 */
export type InspectionLite = {
  readonly id: string;
  /** 点検した時刻（ISO）。 */
  readonly inspectedAt: string;
  /** 点検の JST の日付（YYYY-MM-DD）。 */
  readonly date: string;
  readonly timing: "pre_flight" | "post_flight";
  readonly hasAbnormal: boolean;
};

export type FieldFlightRecordLite = { readonly id: string; readonly voided: boolean };

export type FieldStateInput = {
  readonly events: readonly FieldEventLite[];
  readonly inspections: readonly InspectionLite[];
  readonly flightRecords: readonly FieldFlightRecordLite[];
  /** 日常点検を探す日（JST の YYYY-MM-DD）。画面では今日、離陸の未了事項では離陸の日。 */
  readonly day: string;
};

// ---- 出力 -----------------------------------------------------------------

export type FieldCheckState = {
  readonly item: FieldCheckItem;
  readonly done: boolean;
  /** 済の時刻（ISO。確認は事実の時刻、日常点検は点検した時刻）。未なら null。 */
  readonly at: string | null;
  readonly result: FieldCheckResult | null;
  readonly source: string | null;
  /** 確認の行の ID（取り消すの対象）。日常点検・未は null。 */
  readonly eventId: string | null;
  /** 日常点検の記録の ID（inspection のとき）。 */
  readonly inspectionId: string | null;
  /** 日常点検に異常がある。 */
  readonly abnormal: boolean;
  /** 緊急用務空域が「指定されている」。 */
  readonly designated: boolean;
  /** 再確認した通報の行の ID（report_recheck のとき）。 */
  readonly reportId: string | null;
};

export type FieldFlightPhase = "in_flight" | "journal_pending" | "journaled";

/** 飛行後点検（実際の日常点検の記録 timing=post_flight から導出する）。 */
export type FieldPostInspection = {
  readonly done: boolean;
  readonly inspectionId: string | null;
  readonly abnormal: boolean;
  readonly at: string | null;
};

/** ラウンドごとの確認（空域・現場状況）。 */
export type FieldRoundConfirm = { readonly done: boolean; readonly eventId: string | null; readonly at: string | null };
export type FieldRoundSite = FieldRoundConfirm & { readonly values: FieldSiteValues | null; readonly attention: boolean };

/**
 * いまのラウンド（飛行中ならその飛行、そうでなければ次に始める飛行）。1 回の離陸〜着陸と、その前後の確認・点検が 1 ラウンド。
 * 行から毎回導出し、保存しない。前のラウンドの記録では満たされない項目（点検・空域・現場状況）はここに入る。
 */
export type FieldRound = {
  /** 0 始まり。閉じたラウンドの数。 */
  readonly index: number;
  readonly restriction: FieldRoundConfirm;
  readonly site: FieldRoundSite;
};

/** 離陸 → 着陸 → 日誌の 1 組。 */
export type FieldFlight = {
  readonly takeoffEventId: string;
  readonly takeoffClientEventId: string;
  readonly takeoffAt: string;
  readonly takeoffQueued: boolean;
  readonly gaps: readonly FieldGap[];
  readonly landingEventId: string | null;
  readonly landingAt: string | null;
  readonly landingQueued: boolean;
  readonly journalEventId: string | null;
  readonly flightRecordId: string | null;
  readonly phase: FieldFlightPhase;
  /** 0 始まりのラウンドの番号。 */
  readonly roundIndex: number;
  /** この飛行の後の飛行後点検（着陸していなければ done: false）。 */
  readonly post: FieldPostInspection;
};

export type FieldState = {
  readonly checks: Readonly<Record<FieldCheckItem, FieldCheckState>>;
  /** 取り消されていない離陸ごとの組（離陸の古い順）。 */
  readonly flights: readonly FieldFlight[];
  /** 飛行中の離陸（無ければ null）。 */
  readonly openFlight: FieldFlight | null;
  /** 着陸済みで日誌待ちの飛行（離陸の古い順）。 */
  readonly pendingJournal: readonly FieldFlight[];
  /** Sprint 14：いまのラウンドの空域（飛行自粛要請）・現場状況。 */
  readonly round: FieldRound;
  /** Sprint 14：書類・手続きの「人が確認した」（計画ごと。取り消されていない最新の行。次のラウンドに持ち越す）。 */
  readonly docConfirms: Readonly<Partial<Record<FieldDocKey, { readonly eventId: string; readonly at: string }>>>;
  /** 着陸済みで飛行後点検が未了の飛行（離陸の古い順）。 */
  readonly postPending: readonly FieldFlight[];
};

// ---- 並び・取り消し -------------------------------------------------------------

const cmpRecorded = (a: FieldEventLite, b: FieldEventLite): number =>
  a.recordedKey < b.recordedKey ? -1 : a.recordedKey > b.recordedKey ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/** 行を id か clientEventId で引く。 */
const indexEvents = (events: readonly FieldEventLite[]): Map<string, FieldEventLite> => {
  const m = new Map<string, FieldEventLite>();
  for (const e of events) {
    m.set(e.id, e);
    m.set(e.clientEventId, e);
  }
  return m;
};

/** 取り消された行の id の集合（undo の対象。undo と journal_linked の取り消しは無視する）。 */
export const undoneIds = (events: readonly FieldEventLite[]): Set<string> => {
  const by = indexEvents(events);
  const out = new Set<string>();
  for (const u of events) {
    if (u.kind !== "undo" || u.targetEventId === null) continue;
    const t = by.get(u.targetEventId);
    if (t && (t.kind === "check" || t.kind === "takeoff" || t.kind === "landing")) out.add(t.id);
  }
  return out;
};

// ---- 状態の導出 -----------------------------------------------------------------

const emptyCheck = (item: FieldCheckItem): FieldCheckState => ({
  item,
  done: false,
  at: null,
  result: null,
  source: null,
  eventId: null,
  inspectionId: null,
  abnormal: false,
  designated: false,
  reportId: null,
});

/**
 * 現場の状態を導出する。
 *   - 確認項目：同じ項目の最新の（取り消されていない）check が有効。日常点検は check の行を見ず、実際の日常点検の記録
 *     （飛行前・day の日付・取消していないもの。複数なら最新）から導出する。異常ありは abnormal。
 *   - 飛行：取り消されていない takeoff ごとに、対応する取り消されていない landing があれば着陸済み、無ければ飛行中。
 *   - 日誌：着陸済みの飛行に、取消されていない飛行記録を指す journal_linked があれば日誌済み、無ければ日誌待ち
 *     （結び付いた飛行記録が後で取消されたら日誌待ちに戻る）。
 */
export const fieldState = (i: FieldStateInput): FieldState => {
  const events = [...i.events].sort(cmpRecorded);
  const undone = undoneIds(events);
  const by = indexEvents(events);
  const resolve = (ref: string | null): FieldEventLite | undefined => (ref === null ? undefined : by.get(ref));

  // ---- 確認項目 ----
  const checks = {} as Record<FieldCheckItem, FieldCheckState>;
  for (const item of FIELD_CHECK_ITEMS) checks[item] = emptyCheck(item);

  // ---- ラウンドの区切り（Sprint 14）----
  // 取り消されていない離陸・着陸から、いまのラウンドの始まり（直前の飛行の着陸の記録の位置）を求める。
  // ラウンドごとの項目（点検・空域・現場状況）は、この位置より後の記録だけが数える。計画ごとの項目（書類・手続きの人の確認・
  // 通報済みの再確認・携行品）は位置に関わらず最新が有効（次のラウンドに持ち越す）。
  const takeoffsAll = events.filter((e) => e.kind === "takeoff" && !undone.has(e.id));
  const landingsAll = events.filter((e) => e.kind === "landing" && !undone.has(e.id));
  const landingOf = (t: FieldEventLite): FieldEventLite | null =>
    landingsAll.filter((l) => resolve(l.targetEventId)?.id === t.id).pop() ?? null;
  const lastTakeoff = takeoffsAll[takeoffsAll.length - 1];
  const lastIsOpen = lastTakeoff !== undefined && landingOf(lastTakeoff) === null;
  const prevTakeoff = lastIsOpen ? takeoffsAll[takeoffsAll.length - 2] : lastTakeoff;
  const prevLanding = prevTakeoff ? landingOf(prevTakeoff) : null;
  const roundStartKey = prevLanding?.recordedKey ?? "";
  const roundStartAt = prevLanding?.occurredAt ?? null;
  const inRound = (e: FieldEventLite): boolean => e.recordedKey > roundStartKey;

  const docConfirms: Partial<Record<FieldDocKey, { eventId: string; at: string }>> = {};
  let restriction: FieldRoundConfirm = { done: false, eventId: null, at: null };
  let site: FieldRoundSite = { done: false, eventId: null, at: null, values: null, attention: false };
  for (const e of events) {
    if (e.kind !== "check" || undone.has(e.id)) continue;
    if (e.item === "docs_confirm" && e.docKey && (FIELD_DOC_KEYS as readonly string[]).includes(e.docKey)) {
      docConfirms[e.docKey] = { eventId: e.id, at: e.occurredAt };
    } else if (e.item === "flight_restriction" && inRound(e)) {
      restriction = { done: true, eventId: e.id, at: e.occurredAt };
    } else if (e.item === "site_conditions" && inRound(e)) {
      site = { done: true, eventId: e.id, at: e.occurredAt, values: e.site ?? null, attention: e.site ? siteHasAttention(e.site) : false };
    }
  }

  for (const e of events) {
    if (e.kind !== "check" || e.item === null || undone.has(e.id)) continue;
    if (!(FIELD_CHECK_ITEMS as readonly string[]).includes(e.item) || e.item === "inspection") continue;
    const item = e.item as FieldCheckItem;
    // ラウンドごとの項目（緊急用務空域）は、前のラウンドの記録では満たされない
    if (item === "emergency_airspace" && !inRound(e)) continue;
    // 最新の取り消されていない行が有効（events は記録の順）
    checks[item] = {
      item,
      done: true,
      at: e.occurredAt,
      result: e.result,
      source: e.source,
      eventId: e.id,
      inspectionId: null,
      abnormal: false,
      designated: item === "emergency_airspace" && e.result === "designated",
      reportId: e.reportId,
    };
  }
  const pre = i.inspections
    .filter((x) => x.timing === "pre_flight" && x.date === i.day && (roundStartAt === null || x.inspectedAt >= roundStartAt))
    .sort((a, b) => (a.inspectedAt < b.inspectedAt ? -1 : a.inspectedAt > b.inspectedAt ? 1 : a.id < b.id ? -1 : 1));
  const latestInspection = pre[pre.length - 1];
  if (latestInspection) {
    checks.inspection = {
      item: "inspection",
      done: true,
      at: latestInspection.inspectedAt,
      result: "done",
      source: null,
      eventId: null,
      inspectionId: latestInspection.id,
      abnormal: latestInspection.hasAbnormal,
      designated: false,
      reportId: null,
    };
  }

  // ---- 飛行の組 ----
  const recordVoided = new Map(i.flightRecords.map((r) => [r.id, r.voided]));
  const takeoffs = events.filter((e) => e.kind === "takeoff" && !undone.has(e.id));
  const landings = events.filter((e) => e.kind === "landing" && !undone.has(e.id));
  const journals = events.filter((e) => e.kind === "journal_linked");
  const postInspections = i.inspections.filter((x) => x.timing === "post_flight");
  const flights: FieldFlight[] = takeoffs.map((t, idx): FieldFlight => {
    // 対応する取り消されていない着陸（複数なら最新）
    const landing = landings.filter((l) => resolve(l.targetEventId)?.id === t.id).pop() ?? null;
    const journal =
      landing === null
        ? null
        : (journals
            .filter((j) => resolve(j.targetEventId)?.id === t.id && j.flightRecordId !== null && recordVoided.get(j.flightRecordId) !== true)
            .pop() ?? null);
    // 飛行後点検：この飛行の着陸から、次の離陸の前までの飛行後の日常点検（最新）
    const nextTakeoff = takeoffs[idx + 1];
    const postHit =
      landing === null
        ? undefined
        : postInspections
            .filter((x) => x.inspectedAt >= landing.occurredAt && (nextTakeoff === undefined || x.inspectedAt < nextTakeoff.occurredAt))
            .sort((a, b) => (a.inspectedAt < b.inspectedAt ? -1 : a.inspectedAt > b.inspectedAt ? 1 : a.id < b.id ? -1 : 1))
            .pop();
    return {
      takeoffEventId: t.id,
      takeoffClientEventId: t.clientEventId,
      takeoffAt: t.occurredAt,
      takeoffQueued: t.queued,
      gaps: t.gaps ?? [],
      landingEventId: landing?.id ?? null,
      landingAt: landing?.occurredAt ?? null,
      landingQueued: landing?.queued ?? false,
      journalEventId: journal?.id ?? null,
      flightRecordId: journal?.flightRecordId ?? null,
      phase: landing === null ? "in_flight" : journal === null ? "journal_pending" : "journaled",
      roundIndex: idx,
      post: postHit
        ? { done: true, inspectionId: postHit.id, abnormal: postHit.hasAbnormal, at: postHit.inspectedAt }
        : { done: false, inspectionId: null, abnormal: false, at: null },
    };
  });
  return {
    checks,
    flights,
    openFlight: flights.find((f) => f.phase === "in_flight") ?? null,
    pendingJournal: flights.filter((f) => f.phase === "journal_pending"),
    round: { index: lastIsOpen ? takeoffsAll.length - 1 : takeoffsAll.length, restriction, site },
    docConfirms,
    postPending: flights.filter((f) => f.landingEventId !== null && !f.post.done),
  };
};

/**
 * 端末の送信待ちの行（未送信のもの。送れなかった行は除く）を、サーバーの行と同じ形にする。fieldState に足して渡すと、
 * 押した結果が送信の前に画面へ反映される（経過時間の表示など）。id は端末の識別子、記録の順はサーバーの行より後ろ。
 * landing は、飛行中の離陸を target に持たせて保存すること（省略すると、どの離陸の着陸か分からず、飛行中のままに見える）。
 */
export const outboxAsEvents = (entries: readonly OutboxEntry[]): FieldEventLite[] =>
  entries
    .filter((e) => e.status === "pending")
    .map((e, i): FieldEventLite => {
      const at = parseJstMinute(e.occurredAt);
      return {
        id: e.clientEventId,
        clientEventId: e.clientEventId,
        kind: e.kind,
        item: e.item ?? null,
        result: e.result ?? null,
        source: e.source ?? null,
        docKey: e.docKey ?? null,
        site: e.site ?? null,
        targetEventId: e.targetClientEventId ?? e.targetEventId ?? null,
        flightRecordId: null,
        inspectionId: null,
        reportId: null,
        occurredAt: at ? at.toISOString() : e.occurredAt,
        // サーバーの記録の鍵（ISO の数字で始まる）より後ろに並ぶ
        recordedKey: `~${String(i).padStart(6, "0")}`,
        queued: true,
        gaps: null,
      };
    });

// ---- 遷移（新しい 1 行を追記してよいか） ------------------------------------------

export type FieldRequest =
  | { readonly kind: "check"; readonly item: FieldEventItem }
  | { readonly kind: "takeoff" }
  /** targetEventId を省くと、飛行中の離陸に対する着陸になる。 */
  | { readonly kind: "landing"; readonly targetEventId: string | null }
  | { readonly kind: "undo"; readonly targetEventId: string };

export type FieldTransitionErrorCode =
  | "plan_cancelled"
  | "already_in_flight"
  | "no_open_flight"
  | "landing_exists"
  | "journal_exists"
  | "already_undone"
  | "not_undoable"
  | "invalid_target";

export type FieldTransition =
  | {
      readonly ok: true;
      /** 追記する行の target_event_id（landing：対応する離陸、undo：取り消す行の id）。それ以外は null。 */
      readonly targetEventId: string | null;
    }
  | { readonly ok: false; readonly status: 409; readonly code: FieldTransitionErrorCode };

const rejected = (code: FieldTransitionErrorCode): FieldTransition => ({ ok: false, status: 409, code });

/**
 * 遷移の規則（設計 B）。
 *   check・takeoff：中止した計画には記録できない（plan_cancelled）。takeoff は飛行中の離陸があれば already_in_flight。
 *   landing：飛行中の離陸が必要（no_open_flight）。中止した計画でも記録できる（飛んだ事実は止めない）。
 *   undo：check・takeoff・landing を取り消せる。takeoff は、取り消されていない landing があれば landing_exists。
 *         landing は、日誌済みなら journal_exists。journal_linked と undo は取り消せない（not_undoable）。
 *         すでに取り消された行は already_undone。中止した計画でも記録できる。
 */
export const decideTransition = (
  events: readonly FieldEventLite[],
  state: FieldState,
  req: FieldRequest,
  ctx: { readonly planCancelled: boolean },
): FieldTransition => {
  const by = indexEvents(events);
  switch (req.kind) {
    case "check":
      return ctx.planCancelled ? rejected("plan_cancelled") : { ok: true, targetEventId: null };
    case "takeoff":
      if (ctx.planCancelled) return rejected("plan_cancelled");
      if (state.openFlight) return rejected("already_in_flight");
      return { ok: true, targetEventId: null };
    case "landing": {
      const open = state.openFlight;
      if (!open) return rejected("no_open_flight");
      if (req.targetEventId !== null) {
        const t = by.get(req.targetEventId);
        if (!t || t.kind !== "takeoff") return rejected("invalid_target");
        if (t.id !== open.takeoffEventId) return rejected("no_open_flight");
      }
      return { ok: true, targetEventId: open.takeoffEventId };
    }
    case "undo": {
      const t = by.get(req.targetEventId);
      if (!t) return rejected("invalid_target");
      if (t.kind !== "check" && t.kind !== "takeoff" && t.kind !== "landing") return rejected("not_undoable");
      if (undoneIds(events).has(t.id)) return rejected("already_undone");
      if (t.kind === "takeoff") {
        const f = state.flights.find((x) => x.takeoffEventId === t.id);
        if (f && f.landingEventId !== null) return rejected("landing_exists");
      }
      if (t.kind === "landing") {
        const f = state.flights.find((x) => x.landingEventId === t.id);
        if (f && f.phase === "journaled") return rejected("journal_exists");
      }
      return { ok: true, targetEventId: t.id };
    }
  }
};

/** 日誌に結び付けてよい離陸か（着陸済みで日誌待ち）。 */
export type JournalLinkCheck =
  | { readonly ok: true; readonly flight: FieldFlight }
  | { readonly ok: false; readonly status: 400 | 409; readonly code: "invalid_target" | "no_landing" | "already_journaled" };

/** 日誌（飛行記録）に結び付ける離陸の検査。取り消された離陸・他の計画の離陸・着陸していない離陸は 400、日誌済みは 409。 */
export const checkJournalLink = (state: FieldState, takeoffEventId: string): JournalLinkCheck => {
  const f = state.flights.find((x) => x.takeoffEventId === takeoffEventId);
  if (!f) return { ok: false, status: 400, code: "invalid_target" };
  if (f.phase === "in_flight") return { ok: false, status: 400, code: "no_landing" };
  if (f.phase === "journaled") return { ok: false, status: 409, code: "already_journaled" };
  return { ok: true, flight: f };
};

// ---- 離陸の未了事項 -------------------------------------------------------------

/** 離陸の時点の未了事項の 1 項目（item は FIELD_GAP_ITEMS、state は FIELD_GAP_STATES の語）。 */
export type FieldGap = { readonly item: FieldGapItem; readonly state: FieldGapState };

export type TakeoffGapsInput = {
  /** 現場の状態（日常点検は離陸の日で導出したもの）。 */
  readonly checks: FieldState["checks"];
  /** 通報の要否の種別（required／confirm／recommended／not_applicable_model。reportRequirement の kind）。 */
  readonly requirementKind: string;
  /** 通報の状況の code（reportStatus）。 */
  readonly reportStatusCode: string;
  /** 有効な通報の通報日時（JST の `YYYY-MM-DDTHH:MM`）。無ければ null。 */
  readonly effectiveReportedAt: string | null;
  /** 離陸の時刻（JST の `YYYY-MM-DDTHH:MM`）。 */
  readonly takeoffAtJst: string;
  readonly planState: PlanState;
  readonly judgementStale: boolean;
  /**
   * Sprint 14：書類・手続き、空域（飛行自粛要請）、現場状況の未了。省略すると（12c の呼び出し）これらは数えない。
   *   docs：要確認・満たさない（人が確認した要確認は含めない。通報は report の未了が担うので含めない）
   *   restrictionDone／site：いまのラウンドの確認の有無と、現場状況の注意あり
   */
  readonly round?: {
    readonly docs: readonly { readonly key: Exclude<FieldDocKey, "report">; readonly state: "needs_check" | "unmet" }[];
    readonly restrictionDone: boolean;
    readonly site: { readonly done: boolean; readonly attention: boolean };
  };
};

const NEEDS_REPORT = new Set(["required", "confirm"]);

/**
 * 離陸の時点の未了事項（項目の順は FIELD_GAP_ITEMS）。未了事項があっても離陸の記録は成功する。
 *   日常点検：飛行前の点検が離陸の日付で無い（none）／異常あり（abnormal）
 *   緊急用務空域：確認の行が無い（none）／「指定されている」（designated）
 *   通報：要・要確認の計画で、有効な通報が無い（none）／指紋が変わっている（changed）／通報の記録が離陸より後（after_takeoff）。
 *         推奨・対象外（模型航空機）は数えない
 *   確認（運航管理者）：確認済みでない（draft／pending／returned／stale＝前の版への確認）
 *   判定：判定が古い（stale）
 *   携行品：確認の行が無い（none）
 */
export const takeoffGaps = (i: TakeoffGapsInput): FieldGap[] => {
  const out: FieldGap[] = [];
  const add = (item: FieldGapItem, state: FieldGapState): void => {
    out.push({ item, state });
  };
  const insp = i.checks.inspection;
  if (!insp.done) add("inspection", "none");
  else if (insp.abnormal) add("inspection", "abnormal");
  const emg = i.checks.emergency_airspace;
  if (!emg.done) add("emergency_airspace", "none");
  else if (emg.designated) add("emergency_airspace", "designated");
  if (NEEDS_REPORT.has(i.requirementKind)) {
    if (i.reportStatusCode === "change_review") add("report", "changed");
    else if (i.reportStatusCode === "reported") {
      if (i.effectiveReportedAt !== null && i.effectiveReportedAt > i.takeoffAtJst) add("report", "after_takeoff");
    } else add("report", "none");
  }
  switch (i.planState) {
    case "draft":
      add("confirmation", "draft");
      break;
    case "pending":
      add("confirmation", "pending");
      break;
    case "returned":
      add("confirmation", "returned");
      break;
    case "approved_stale":
    case "returned_stale":
      add("confirmation", "stale");
      break;
    case "approved":
    case "voided":
      break;
  }
  if (i.round) {
    if (!i.round.restrictionDone) add("flight_restriction", "none");
    if (!i.round.site.done) add("site_conditions", "none");
    else if (i.round.site.attention) add("site_conditions", "attention");
    for (const d of i.round.docs) add(`docs_${d.key}` as FieldGapItem, d.state);
  }
  if (i.judgementStale) add("judgement", "stale");
  if (!i.checks.carry.done) add("carry", "none");
  // 項目の順を固定する
  return out.sort((a, b) => FIELD_GAP_ITEMS.indexOf(a.item) - FIELD_GAP_ITEMS.indexOf(b.item));
};
