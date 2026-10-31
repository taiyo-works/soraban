// 端末の保存（送信待ち。アウトボックス。Sprint 12c 設計 F）の規則。ブラウザに依らない純粋な部分だけを置く
// （ストレージ・fetch は引数で受ける。画面は G2）。
//
// 規則：
//   - 現場の記録（確認・離陸・着陸・取り消す）は、送る前に 1 行ずつ端末の localStorage に保存する（clientEventId と occurredAt を付ける）。
//   - 順番に送る。古い行が送れない（通信できない・5xx・時間切れ・401）うちは、後の行を送らない（順序を守る）。
//   - 成功（201・200）した行は消す。同じ clientEventId の再送はサーバーが既存の行を返す（二重にならない）。
//   - 4xx（業務上の拒否：clock_skew・too_old・plan_cancelled・landing_exists など）の行は黙って捨てない。
//     「送れませんでした」と理由を行ごとに残し、利用者が「あとから入力」へ進むか、破棄を選べる。後ろの行は止めない（理由の行だけ飛ばす）。
//   - キーは計画ごと・利用者ごと。末尾が利用者の ID なので、他の利用者の保存は clearOtherUsersDrafts（drafts.ts）が消す。
//   - 端末に残す内容は、計画の ID（キー）・種別・時刻・識別子・確認の項目（書類の項目キー・現場状況の選択と数値を含む）だけ。氏名・技能証明書番号・座標・自由記述は入れない。
//   - ログアウトは、未送信が残っているときに警告し、黙って消さない。
//
// Sprint 15（圏外）：同じ送信待ちに、日常点検（inspection）と日誌（journal）を種別として足す（キー・形式・既存の種別は 12c のまま）。
//   - 点検・日誌は、作った順に、現場の事実と同じ列に並ぶ。点検 → それを指す日誌 の順を守り、端末の仮の識別子（clientEventId）を
//     サーバーの ID に読み替える（ids に対応を残す）。
//   - 端末に残す自由記述は、点検の「異常」の項目の備考と、日誌の「飛行の安全に影響のあった事項」の内容だけ（契約 D-5 の推奨の方式）。
//     どちらも送れた時点・破棄した時点で行ごと消える。上限は 500 文字（サーバーの入力検査と同じ）。氏名・技能証明書番号・座標・
//     計画の目的・場所名は入れない（送るときにサーバーが計画から補う：fillFromPlan）。
//   - 72 時間（FIELD_QUEUED_MAX_AGE_HOURS）を超えた点検・日誌は送らずに「古すぎて送れません」として残す（延長しない）。
//     12 時間以内に超える行があれば、画面が事前に知らせる（expiringSoon）。
import { INSPECTION_ITEMS, MAX_LONG_TEXT, type InspectionItemKey } from "./ops-records";
import { FIELD_QUEUED_MAX_AGE_HOURS } from "./ops-field";
import { parseJstMinute } from "./ops-time";
import type { FieldCheckResult, FieldDocKey, FieldRecordableCheckItem, FieldSiteValues } from "./ops-field";
import { FIELD_DOC_KEYS, FIELD_RECORDABLE_CHECK_ITEMS, SITE_TEMP_RANGE, SITE_WIND_RANGE, fieldErrorMessage, siteHasAttention } from "./ops-field";

/** drafts.ts の PREFIX と同じ（clearOtherUsersDrafts が他の利用者の保存を消せるように、同じ接頭辞・末尾が利用者の ID）。 */
export const OUTBOX_KEY_PREFIX = "soraban:ops-draft:field-";

/** 計画ごと・利用者ごとの送信待ちのキー。例：soraban:ops-draft:field-<計画の ID>:<利用者の ID> */
export const outboxKey = (planId: string, memberId: string): string => `${OUTBOX_KEY_PREFIX}${planId}:${memberId}`;
export const isOutboxKey = (key: string): boolean => key.startsWith(OUTBOX_KEY_PREFIX);

export type OutboxKind = "check" | "takeoff" | "landing" | "undo" | "inspection" | "journal";
/** 現場の事実（POST /api/ops/plans/[id]/field-events に送る種別）。 */
export const FIELD_EVENT_OUTBOX_KINDS: readonly OutboxKind[] = ["check", "takeoff", "landing", "undo"];
export const isFieldEventKind = (k: OutboxKind): boolean => FIELD_EVENT_OUTBOX_KINDS.includes(k);

/** Sprint 15：圏外で保存した日常点検（9 項目を項目別に）。備考は「異常」の項目だけ（自由記述の最小限）。 */
export type OutboxInspection = {
  readonly timing: "pre_flight" | "post_flight";
  readonly aircraftId: string;
  readonly pilotId: string;
  readonly items: Readonly<Record<InspectionItemKey, { readonly result: "normal" | "abnormal"; readonly note?: string }>>;
};

/** Sprint 15：圏外で保存した日誌（飛行記録）。離着陸の時刻は現場の記録から引き継ぐ。 */
export type OutboxJournal = {
  readonly aircraftId: string;
  readonly pilotId: string;
  readonly takeoffAt: string;
  readonly landingAt: string;
  /** 結び付ける離陸（サーバーの行の ID か端末の識別子。サーバーがどちらでも引ける）。 */
  readonly takeoffRef: string;
  /** 飛行前の点検（サーバーの ID）。 */
  readonly inspectionId?: string;
  /** 飛行前の点検が送信待ちの点検のとき、その端末の識別子（送るときにサーバーの ID に読み替える）。 */
  readonly inspectionClientRef?: string;
  readonly safetyIssue: boolean;
  /** 「あり」のときだけ（自由記述の最小限。500 文字まで）。 */
  readonly safetyIssueDetail?: string;
};
export type OutboxStatus = "pending" | "rejected";

export type OutboxEntry = {
  readonly clientEventId: string;
  readonly kind: OutboxKind;
  /** 事実の時刻（JST の `YYYY-MM-DDTHH:MM`）。押した時点の端末の時計。 */
  readonly occurredAt: string;
  readonly item?: FieldRecordableCheckItem;
  readonly result?: FieldCheckResult;
  /** Sprint 14：書類・手続きの人の確認の対象（項目キー）。 */
  readonly docKey?: FieldDocKey;
  /**
   * Sprint 14：現場状況の選択と数値（風速・気温）。備考の自由記述は端末に残さない（契約 C-9）。
   * 「いる／あり／制限あり」を含む現場状況は備考が必須なので、送信待ちに入れない（sanitizeSite が null を返す）。
   */
  readonly site?: FieldSiteValues;
  /** 緊急用務空域の確認元（選択肢の ID）。 */
  readonly source?: string;
  /** landing（飛行中の離陸）・undo（取り消す行）が指す行。サーバーの ID が分からない（まだ届いていない）ときは端末の識別子。 */
  readonly targetEventId?: string;
  readonly targetClientEventId?: string;
  /** Sprint 15：kind=inspection の内容。 */
  readonly inspection?: OutboxInspection;
  /** Sprint 15：kind=journal の内容。 */
  readonly journal?: OutboxJournal;
  readonly status: OutboxStatus;
  /** 送ろうとした回数。 */
  readonly attempts: number;
  readonly rejection?: { readonly status: number; readonly code: string; readonly message: string };
};

export type OutboxState = {
  readonly v: 1;
  readonly entries: readonly OutboxEntry[];
  /** Sprint 15：端末の仮の識別子 → サーバーの ID（送れた点検など。後ろの行の読み替えに使う）。省略は空（12c の形式）。 */
  readonly ids?: Readonly<Record<string, string>>;
};

export const emptyOutbox = (): OutboxState => ({ v: 1, entries: [] });

const KINDS: readonly string[] = ["check", "takeoff", "landing", "undo", "inspection", "journal"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MINUTE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

const SITE_NONE_PRESENT = ["none", "present"];
const num = (v: unknown, range: { readonly min: number; readonly max: number }): number | null | undefined => {
  if (v === null || v === undefined) return null;
  if (typeof v !== "number" || !Number.isFinite(v) || v < range.min || v > range.max) return undefined;
  return Math.round(v * 10) / 10;
};

/**
 * 現場状況を許す形に絞る。選択は列挙された値だけ、数値は範囲内だけ。注意あり（いる／あり／制限あり）は備考が必須で、
 * 備考は端末に残さないため null を返す（その行は送信待ちに入れない。オンラインの間に入力する）。
 */
export const sanitizeSite = (raw: unknown): FieldSiteValues | null => {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const tp = r["thirdParty"];
  const oa = r["otherAircraft"];
  const rain = r["rain"];
  const vis = r["visibility"];
  if (typeof tp !== "string" || !SITE_NONE_PRESENT.includes(tp)) return null;
  if (typeof oa !== "string" || !SITE_NONE_PRESENT.includes(oa)) return null;
  if (typeof rain !== "string" || !SITE_NONE_PRESENT.includes(rain)) return null;
  if (vis !== "good" && vis !== "limited") return null;
  const wind = num(r["windMs"], SITE_WIND_RANGE);
  const temp = num(r["tempC"], SITE_TEMP_RANGE);
  if (wind === undefined || temp === undefined) return null;
  const v: FieldSiteValues = {
    thirdParty: tp as FieldSiteValues["thirdParty"],
    otherAircraft: oa as FieldSiteValues["otherAircraft"],
    rain: rain as FieldSiteValues["rain"],
    visibility: vis,
    windMs: wind,
    tempC: temp,
  };
  return siteHasAttention(v) ? null : v;
};

const isUuidStr = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
const freeText = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 && t.length <= MAX_LONG_TEXT ? t : null;
};

/** 点検の内容を許す形に絞る。9 項目すべてに正常・異常があり、異常の項目は備考（500 文字まで）が必須。正常の項目の備考は残さない。 */
export const sanitizeInspection = (raw: unknown): OutboxInspection | null => {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r["timing"] !== "pre_flight" && r["timing"] !== "post_flight") return null;
  if (!isUuidStr(r["aircraftId"]) || !isUuidStr(r["pilotId"])) return null;
  const items = r["items"];
  if (!items || typeof items !== "object") return null;
  const out: Record<string, { result: "normal" | "abnormal"; note?: string }> = {};
  for (const it of INSPECTION_ITEMS) {
    const x = (items as Record<string, unknown>)[it.key] as Record<string, unknown> | undefined;
    if (!x || (x["result"] !== "normal" && x["result"] !== "abnormal")) return null;
    if (x["result"] === "abnormal") {
      const note = freeText(x["note"]);
      if (!note) return null;
      out[it.key] = { result: "abnormal", note };
    } else out[it.key] = { result: "normal" };
  }
  return {
    timing: r["timing"],
    aircraftId: r["aircraftId"].toLowerCase(),
    pilotId: r["pilotId"].toLowerCase(),
    items: out as OutboxInspection["items"],
  };
};

/** 日誌の内容を許す形に絞る。「あり」なら内容（500 文字まで）が必須、「なし」なら内容を残さない。 */
export const sanitizeJournal = (raw: unknown): OutboxJournal | null => {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!isUuidStr(r["aircraftId"]) || !isUuidStr(r["pilotId"]) || !isUuidStr(r["takeoffRef"])) return null;
  if (typeof r["takeoffAt"] !== "string" || !MINUTE.test(r["takeoffAt"]) || typeof r["landingAt"] !== "string" || !MINUTE.test(r["landingAt"])) return null;
  if (typeof r["safetyIssue"] !== "boolean") return null;
  const detail = r["safetyIssue"] ? freeText(r["safetyIssueDetail"]) : null;
  if (r["safetyIssue"] && !detail) return null;
  return {
    aircraftId: r["aircraftId"].toLowerCase(),
    pilotId: r["pilotId"].toLowerCase(),
    takeoffAt: r["takeoffAt"],
    landingAt: r["landingAt"],
    takeoffRef: r["takeoffRef"].toLowerCase(),
    ...(isUuidStr(r["inspectionId"]) ? { inspectionId: r["inspectionId"].toLowerCase() } : {}),
    ...(isUuidStr(r["inspectionClientRef"]) ? { inspectionClientRef: r["inspectionClientRef"].toLowerCase() } : {}),
    safetyIssue: r["safetyIssue"],
    ...(detail ? { safetyIssueDetail: detail } : {}),
  };
};

/** 保存・読み込みのたびに、許す項目だけに絞る（余計な項目＝氏名・座標などが紛れ込んでも端末に残さない）。 */
export const sanitizeEntry = (raw: unknown): OutboxEntry | null => {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r["clientEventId"] !== "string" || !UUID.test(r["clientEventId"])) return null;
  if (typeof r["kind"] !== "string" || !KINDS.includes(r["kind"])) return null;
  if (typeof r["occurredAt"] !== "string" || !MINUTE.test(r["occurredAt"])) return null;
  const str = (k: string): string | undefined => (typeof r[k] === "string" ? (r[k] as string) : undefined);
  const uuid = (k: string): string | undefined => {
    const v = str(k);
    return v !== undefined && UUID.test(v) ? v : undefined;
  };
  const rejection = r["rejection"] as Record<string, unknown> | undefined;
  const rejected = r["status"] === "rejected" && rejection && typeof rejection["code"] === "string";
  const item = str("item");
  const result = str("result");
  const docKey = str("docKey");
  const site = r["site"] === undefined ? undefined : sanitizeSite(r["site"]);
  // 現場状況の行は、許す形（備考が要らない選択）でなければ端末に残さない
  if (item === "site_conditions" && !site) return null;
  if (item === "docs_confirm" && !(docKey && (FIELD_DOC_KEYS as readonly string[]).includes(docKey))) return null;
  const inspection = r["kind"] === "inspection" ? sanitizeInspection(r["inspection"]) : null;
  const journal = r["kind"] === "journal" ? sanitizeJournal(r["journal"]) : null;
  if (r["kind"] === "inspection" && !inspection) return null;
  if (r["kind"] === "journal" && !journal) return null;
  const source = str("source");
  const target = uuid("targetEventId");
  const targetClient = uuid("targetClientEventId");
  return {
    clientEventId: r["clientEventId"].toLowerCase(),
    kind: r["kind"] as OutboxKind,
    occurredAt: r["occurredAt"],
    ...(item && (FIELD_RECORDABLE_CHECK_ITEMS as readonly string[]).includes(item) ? { item: item as OutboxEntry["item"] } : {}),
    ...(docKey && item === "docs_confirm" && (FIELD_DOC_KEYS as readonly string[]).includes(docKey) ? { docKey: docKey as FieldDocKey } : {}),
    ...(site && item === "site_conditions" ? { site } : {}),
    ...(result && ["done", "not_designated", "designated"].includes(result) ? { result: result as FieldCheckResult } : {}),
    ...(source && source.length <= 100 ? { source } : {}),
    ...(target ? { targetEventId: target } : {}),
    ...(targetClient ? { targetClientEventId: targetClient } : {}),
    ...(inspection ? { inspection } : {}),
    ...(journal ? { journal } : {}),
    status: rejected ? "rejected" : "pending",
    attempts: typeof r["attempts"] === "number" && Number.isFinite(r["attempts"]) ? Math.max(0, Math.floor(r["attempts"])) : 0,
    ...(rejected
      ? {
          rejection: {
            status: typeof rejection["status"] === "number" ? (rejection["status"] as number) : 400,
            code: rejection["code"] as string,
            message: typeof rejection["message"] === "string" ? (rejection["message"] as string) : fieldErrorMessage(rejection["code"] as string),
          },
        }
      : {}),
  };
};

/** 識別子の対応（端末の識別子 → サーバーの ID）。どちらも UUID のものだけ、最大 200 件。 */
const sanitizeIds = (raw: unknown): Record<string, string> | null => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: Record<string, string> = {};
  let n = 0;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!UUID.test(k) || !isUuidStr(v)) continue;
    out[k.toLowerCase()] = v.toLowerCase();
    if (++n >= 200) break;
  }
  return n > 0 ? out : null;
};

/** 保存された文字列を読む。壊れていれば空にする（端末の保存は、読めなくても画面を壊さない）。 */
export const parseOutbox = (raw: string | null): OutboxState => {
  if (!raw) return emptyOutbox();
  try {
    const v = JSON.parse(raw) as { entries?: unknown };
    if (!v || !Array.isArray(v.entries)) return emptyOutbox();
    const entries = v.entries.map(sanitizeEntry).filter((e): e is OutboxEntry => e !== null);
    // 同じ識別子は 1 件だけ（先のものを残す）
    const seen = new Set<string>();
    const ids = sanitizeIds((v as { ids?: unknown }).ids);
    return {
      v: 1,
      entries: entries.filter((e) => (seen.has(e.clientEventId) ? false : (seen.add(e.clientEventId), true))),
      ...(ids ? { ids } : {}),
    };
  } catch {
    return emptyOutbox();
  }
};

export const serializeOutbox = (s: OutboxState): string => {
  // 送信待ちが残っている間だけ、対応を残す（全部送れたら項目ごと消える。saveOutbox）
  const ids = s.ids && s.entries.length > 0 ? sanitizeIds(s.ids) : null;
  return JSON.stringify({ v: 1, entries: s.entries.map((e) => sanitizeEntry(e)).filter(Boolean), ...(ids ? { ids } : {}) });
};

// ---- 操作 -----------------------------------------------------------------

/** 末尾に追加する（押した順＝送る順）。同じ識別子はすでにあれば追加しない。 */
export const enqueue = (s: OutboxState, e: Omit<OutboxEntry, "status" | "attempts" | "rejection"> & Partial<Pick<OutboxEntry, "status" | "attempts">>): OutboxState => {
  const entry = sanitizeEntry({ ...e, status: "pending", attempts: 0 });
  if (!entry || s.entries.some((x) => x.clientEventId === entry.clientEventId)) return s;
  return { ...s, v: 1, entries: [...s.entries, entry] };
};

export const pendingEntries = (s: OutboxState): OutboxEntry[] => s.entries.filter((e) => e.status === "pending");
export const rejectedEntries = (s: OutboxState): OutboxEntry[] => s.entries.filter((e) => e.status === "rejected");
/** 画面の「未送信 N 件」（送れなかった行は別に数える）。 */
export const unsentCount = (s: OutboxState): number => pendingEntries(s).length;
export const rejectedCount = (s: OutboxState): number => rejectedEntries(s).length;
/** 次に送る行（先頭の未送信）。 */
export const nextToSend = (s: OutboxState): OutboxEntry | null => pendingEntries(s)[0] ?? null;

/** 送信の本文。送信待ちを経由した行は queued: true（サーバーが古さの上限を 72 時間で検査する）。 */
export const toRequestBody = (e: OutboxEntry): Record<string, unknown> => ({
  kind: e.kind,
  clientEventId: e.clientEventId,
  occurredAt: e.occurredAt,
  queued: true,
  ...(e.item ? { item: e.item } : {}),
  ...(e.result ? { result: e.result } : {}),
  ...(e.source ? { source: e.source } : {}),
  ...(e.docKey ? { docKey: e.docKey } : {}),
  ...(e.site ? { site: e.site } : {}),
  ...(e.targetEventId ? { targetEventId: e.targetEventId } : {}),
  ...(e.targetClientEventId ? { targetClientEventId: e.targetClientEventId } : {}),
});

/** 端末の識別子をサーバーの ID に読み替える（対応が無ければそのまま）。 */
export const resolveRef = (s: OutboxState, ref: string): string => s.ids?.[ref.toLowerCase()] ?? ref;

/**
 * Sprint 15：送り先と本文（種別ごと）。現場の事実は 12c の toRequestBody、点検は POST /api/ops/inspections、
 * 日誌は POST /api/ops/flights。点検・日誌の clientRequestId は端末の識別子（clientEventId）。場所名・目的・座標は送らない
 * （サーバーが計画から補う：fillFromPlan）。送信待ちの点検を指す日誌は、送れた点検のサーバーの ID に読み替える。
 */
export const requestFor = (s: OutboxState, planId: string, e: OutboxEntry): { readonly url: string; readonly body: Record<string, unknown> } => {
  if (e.kind === "inspection" && e.inspection) {
    const i = e.inspection;
    return {
      url: "/api/ops/inspections",
      body: {
        clientRequestId: e.clientEventId,
        aircraftId: i.aircraftId,
        pilotId: i.pilotId,
        inspectedAt: e.occurredAt,
        timing: i.timing,
        items: Object.fromEntries(Object.entries(i.items).map(([k, v]) => [k, { result: v.result, note: v.note ?? null }])),
        planId,
        fillFromPlan: true,
        queued: true,
      },
    };
  }
  if (e.kind === "journal" && e.journal) {
    const j = e.journal;
    const mapped = j.inspectionClientRef ? s.ids?.[j.inspectionClientRef] : undefined;
    const inspectionId = j.inspectionId ?? mapped ?? null;
    return {
      url: "/api/ops/flights",
      body: {
        clientRequestId: e.clientEventId,
        aircraftId: j.aircraftId,
        pilotId: j.pilotId,
        takeoffAt: j.takeoffAt,
        landingAt: j.landingAt,
        takeoffEventId: resolveRef(s, j.takeoffRef),
        dailyInspectionId: inspectionId,
        flightPlanId: planId,
        safetyIssue: j.safetyIssue,
        safetyIssueDetail: j.safetyIssue ? (j.safetyIssueDetail ?? null) : null,
        fillFromPlan: true,
      },
    };
  }
  return { url: `/api/ops/plans/${planId}/field-events`, body: toRequestBody(e) };
};

/** 送れた行のサーバーの ID を対応に残す（点検・日誌の応答の id。後ろの行の読み替えに使う）。 */
export const rememberId = (s: OutboxState, clientEventId: string, serverId: unknown): OutboxState =>
  typeof serverId === "string" && UUID.test(serverId)
    ? { ...s, ids: { ...(s.ids ?? {}), [clientEventId.toLowerCase()]: serverId.toLowerCase() } }
    : s;

// ---- 72 時間の上限（Sprint 15 契約 E-6） ---------------------------------------------

/** 期限が近いと知らせる残り時間（時間）。 */
export const OUTBOX_EXPIRY_WARN_HOURS = 12;

/** 行の残り時間（時間。負なら超えている）。時刻が読めなければ null。 */
export const hoursLeft = (e: OutboxEntry, nowMs: number): number | null => {
  const at = parseJstMinute(e.occurredAt);
  return at ? FIELD_QUEUED_MAX_AGE_HOURS - (nowMs - at.getTime()) / 3600_000 : null;
};

/** 72 時間を超えた行（送らずに「古すぎて送れません」にする。サーバーも too_old で拒む）。 */
export const isExpired = (e: OutboxEntry, nowMs: number): boolean => {
  const h = hoursLeft(e, nowMs);
  return h !== null && h < 0;
};

/** 12 時間以内に 72 時間を超える未送信の行の、最も短い残り時間（時間、切り捨て）。無ければ null。 */
export const expiringSoon = (s: OutboxState, nowMs: number): number | null => {
  let min: number | null = null;
  for (const e of pendingEntries(s)) {
    const h = hoursLeft(e, nowMs);
    if (h === null || h < 0 || h > OUTBOX_EXPIRY_WARN_HOURS) continue;
    min = min === null ? h : Math.min(min, h);
  }
  return min === null ? null : Math.max(0, Math.floor(min));
};

export const OUTBOX_EXPIRY_WARNING = (h: number): string =>
  `送れていない記録があります。あと ${h} 時間で古すぎて送れなくなります（72 時間まで）。電波のある場所で送ってください。`;

export type SendOutcome =
  /** 送れた（201・200）。 */
  | { readonly kind: "sent" }
  /** 通信できない・5xx・時間切れ・401・429：残して、あとで再試行する。 */
  | { readonly kind: "retry" }
  /** 業務上の拒否（4xx）：黙って捨てず、理由を残す。 */
  | { readonly kind: "reject"; readonly status: number; readonly code: string };

/** 応答（status が null なら通信できなかった・時間切れ）を、送れた／再試行／拒否に分ける。 */
export const classifyResponse = (res: { readonly status: number | null; readonly code?: string }): SendOutcome => {
  const s = res.status;
  if (s === null) return { kind: "retry" };
  if (s === 200 || s === 201) return { kind: "sent" };
  if (s >= 500 || s === 408 || s === 429 || s === 401) return { kind: "retry" };
  if (s >= 400) return { kind: "reject", status: s, code: res.code && res.code.length > 0 ? res.code : "rejected" };
  // 3xx など想定外は、捨てずに再試行側に倒す
  return { kind: "retry" };
};

/** 送信の結果を反映する。送れた行は消し、再試行の行は回数だけ増やし、拒否の行は理由つきで残す。 */
export const applyOutcome = (s: OutboxState, clientEventId: string, outcome: SendOutcome): OutboxState => ({
  ...s,
  v: 1,
  entries:
    outcome.kind === "sent"
      ? s.entries.filter((e) => e.clientEventId !== clientEventId)
      : s.entries.map((e) =>
          e.clientEventId !== clientEventId
            ? e
            : outcome.kind === "retry"
              ? { ...e, attempts: e.attempts + 1 }
              : {
                  ...e,
                  attempts: e.attempts + 1,
                  status: "rejected" as const,
                  rejection: { status: outcome.status, code: outcome.code, message: fieldErrorMessage(outcome.code) },
                },
        ),
});

/** 拒否された行を破棄する（利用者が選ぶ）。未送信の行は破棄しない（黙って消さない）。 */
export const discardRejected = (s: OutboxState, clientEventId: string): OutboxState => ({
  ...s,
  v: 1,
  entries: s.entries.filter((e) => !(e.clientEventId === clientEventId && e.status === "rejected")),
});

export type DrainResult = {
  readonly state: OutboxState;
  /** 送れた行の数。 */
  readonly sent: number;
  /** 拒否された行の数（理由つきで残る）。 */
  readonly rejected: number;
  /** 再試行が必要で止まった（後ろの行は送っていない）。 */
  readonly blocked: boolean;
};

/**
 * 順番に送る。先頭の未送信から 1 行ずつ send を呼び、結果で次へ進む。
 *   送れた → 消して次へ／拒否（4xx）→ 理由を残して次へ（後ろの行は止めない）／再試行 → そこで止める（順序を守る）。
 * send は fetch の薄い包み（通信できない・時間切れは status: null を返す）。例外は再試行として扱う。
 */
export const drainOutbox = async (
  state: OutboxState,
  send: (body: Record<string, unknown>, entry: OutboxEntry) => Promise<{ readonly status: number | null; readonly code?: string }>,
  onProgress?: (s: OutboxState) => void,
): Promise<DrainResult> => {
  let cur = state;
  let sent = 0;
  let rejected = 0;
  for (;;) {
    const e = nextToSend(cur);
    if (!e) return { state: cur, sent, rejected, blocked: false };
    let outcome: SendOutcome;
    try {
      outcome = classifyResponse(await send(toRequestBody(e), e));
    } catch {
      outcome = { kind: "retry" };
    }
    cur = applyOutcome(cur, e.clientEventId, outcome);
    onProgress?.(cur);
    if (outcome.kind === "retry") return { state: cur, sent, rejected, blocked: true };
    if (outcome.kind === "sent") sent += 1;
    else rejected += 1;
  }
};

// ---- ストレージ（localStorage と同じ形。テストでは差し替える） ----------------------------

export type StorageLike = {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export const loadOutbox = (storage: StorageLike, key: string): OutboxState => {
  try {
    return parseOutbox(storage.getItem(key));
  } catch {
    return emptyOutbox();
  }
};

/** 保存する。空なら項目ごと消す。保存できない環境（容量超過・プライベートブラウズ）では false を返す。 */
export const saveOutbox = (storage: StorageLike, key: string, s: OutboxState): boolean => {
  try {
    if (s.entries.length === 0) storage.removeItem(key);
    else storage.setItem(key, serializeOutbox(s));
    return true;
  } catch {
    return false;
  }
};

const outboxKeys = (storage: StorageLike): string[] => {
  const keys: string[] = [];
  try {
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k && isOutboxKey(k)) keys.push(k);
    }
  } catch {
    // 何もしない
  }
  return keys;
};

/** ある利用者の、すべての計画の未送信・送れなかった行の数（ログアウトの警告に使う）。 */
export const countUnsentForMember = (storage: StorageLike, memberId: string): { readonly pending: number; readonly rejected: number } => {
  let pending = 0;
  let rejected = 0;
  for (const k of outboxKeys(storage)) {
    if (!k.endsWith(`:${memberId}`)) continue;
    const s = loadOutbox(storage, k);
    pending += unsentCount(s);
    rejected += rejectedCount(s);
  }
  return { pending, rejected };
};

/**
 * 日誌の入力を、端末の送信待ちの離着陸から始める（現場の記録がまだ全部は届いていないとき）。
 * refs は、その離陸を指す識別子（サーバーの離陸の ID・端末の識別子）。離陸の時刻は、サーバーに届いていればそれ、
 * なければ送信待ちの離陸の行から取る。着陸は、送信待ちの着陸のうち targetEventId・targetClientEventId のどちらかが
 * その離陸を指すもの。両方の時刻が決まらなければ null。
 */
export const recoverFlightFromOutbox = (
  s: OutboxState,
  refs: readonly string[],
  serverTakeoffAt: string | null,
): { readonly takeoffAt: string; readonly landingAt: string } | null => {
  const set = new Set(refs.map((r) => r.toLowerCase()));
  const takeoffAt = serverTakeoffAt ?? pendingEntries(s).find((e) => e.kind === "takeoff" && set.has(e.clientEventId.toLowerCase()))?.occurredAt;
  if (!takeoffAt) return null;
  const pointsHere = (e: OutboxEntry): boolean =>
    (e.targetEventId !== undefined && set.has(e.targetEventId.toLowerCase())) ||
    (e.targetClientEventId !== undefined && set.has(e.targetClientEventId.toLowerCase()));
  const landing = pendingEntries(s).find((e) => e.kind === "landing" && pointsHere(e));
  return landing ? { takeoffAt, landingAt: landing.occurredAt } : null;
};

export const LOGOUT_UNSENT_WARNING = (n: number): string => `未送信 ${n} 件があります。送ってからログアウトしますか`;

/**
 * ログアウトの前の確認。未送信（または送れなかった行）が残っていれば警告を返し、黙って消さない。
 * 画面は、警告を出して「送ってからログアウトする」を既定にし、利用者が選んだときだけ消す。
 */
export const logoutGuard = (
  storage: StorageLike,
  memberId: string,
): { readonly warn: boolean; readonly count: number; readonly message: string | null } => {
  const c = countUnsentForMember(storage, memberId);
  const count = c.pending + c.rejected;
  return { warn: count > 0, count, message: count > 0 ? LOGOUT_UNSENT_WARNING(count) : null };
};

/** 他の利用者の送信待ちを消す（共用の端末で、前の利用者の記録を次の人に引き継がない）。clearOtherUsersDrafts と同じ規則。 */
export const clearOtherUsersOutbox = (storage: StorageLike, memberId: string): void => {
  try {
    for (const k of outboxKeys(storage)) if (!k.endsWith(`:${memberId}`)) storage.removeItem(k);
  } catch {
    // 何もしない
  }
};
