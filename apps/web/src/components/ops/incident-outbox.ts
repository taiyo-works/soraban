// 現場の簡易記録（事故・ヒヤリハット。Sprint 12e 設計 F）の送信待ちのブラウザ側の処理。規則は lib/incident-outbox.ts（純粋）。
// ここは localStorage と fetch に触れる部分だけ。送り先は自分のサーバーの API（POST /api/ops/incidents）だけ（外部へは送らない）。
// 12c の components/ops/field-outbox.ts と同じ作法（保存できなければメモリ、順番に送る、同じ計画の送信は同時に 1 つ）。
import {
  applyIncidentOutcome,
  emptyIncidentOutbox,
  incidentOutboxKey,
  incidentOutboxKeys,
  incidentRejectedCount,
  incidentRequestBody,
  incidentUnsentCount,
  loadIncidentOutbox,
  nextIncidentToSend,
  planIdOfIncidentKey,
  saveIncidentOutbox,
  type IncidentOutboxEntry,
  type IncidentOutboxState,
} from "@/lib/incident-outbox";
import { classifyResponse, type StorageLike } from "@/lib/ops-outbox";

/** 1 回の送信を待つ上限（ミリ秒）。超えたら通信できなかったものとして再試行に回す。 */
export const INCIDENT_SEND_TIMEOUT_MS = 10_000;
export const INCIDENTS_API = "/api/ops/incidents";

const storage = (): StorageLike | null => {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
};

/** 端末に保存できなかった送信待ち（キーは incidentOutboxKey）。画面を閉じるまではここに残し、通信できれば送る。 */
const memory = new Map<string, IncidentOutboxState>();

export const loadPlanIncidentOutbox = (planId: string, memberId: string): IncidentOutboxState => {
  const key = incidentOutboxKey(planId, memberId);
  const mem = memory.get(key);
  if (mem) return mem;
  const st = storage();
  return st ? loadIncidentOutbox(st, key) : emptyIncidentOutbox();
};

/** 最新を読み直してから変更して保存する。保存できなければメモリに置く（黙って失わない）。 */
export const updatePlanIncidentOutbox = (planId: string, memberId: string, fn: (s: IncidentOutboxState) => IncidentOutboxState): IncidentOutboxState => {
  const key = incidentOutboxKey(planId, memberId);
  const next = fn(loadPlanIncidentOutbox(planId, memberId));
  const st = storage();
  if (st && saveIncidentOutbox(st, key, next)) memory.delete(key);
  else if (next.entries.length > 0) memory.set(key, next);
  else memory.delete(key);
  return next;
};

/** 端末に保存できていない送信待ちがある。 */
export const planIncidentOutboxUnsaved = (planId: string, memberId: string): boolean =>
  (memory.get(incidentOutboxKey(planId, memberId))?.entries.length ?? 0) > 0;

/** ある利用者の、簡易記録の未送信・送れなかった行の数（端末とメモリの両方。ログアウトの警告に足す）。 */
export const incidentUnsentTotalForMember = (memberId: string): number => {
  let n = 0;
  const st = storage();
  const memKeys = new Set<string>();
  for (const [k, s] of memory) {
    if (!k.endsWith(`:${memberId}`)) continue;
    memKeys.add(k);
    n += incidentUnsentCount(s) + incidentRejectedCount(s);
  }
  if (st) {
    for (const k of incidentOutboxKeys(st)) {
      if (memKeys.has(k) || !k.endsWith(`:${memberId}`)) continue;
      const s = loadIncidentOutbox(st, k);
      n += incidentUnsentCount(s) + incidentRejectedCount(s);
    }
  }
  return n;
};

export type IncidentSentInfo = { readonly entry: IncidentOutboxEntry; readonly status: number; readonly data: Record<string, unknown> };

const sendOne = async (
  planId: string,
  entry: IncidentOutboxEntry,
): Promise<{ readonly status: number | null; readonly code?: string; readonly data: Record<string, unknown> }> => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), INCIDENT_SEND_TIMEOUT_MS);
  try {
    const res = await fetch(INCIDENTS_API, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(incidentRequestBody(planId, entry, Date.now())),
      credentials: "same-origin",
      signal: ctrl.signal,
    });
    let data: Record<string, unknown> = {};
    try {
      data = (await res.json()) as Record<string, unknown>;
    } catch {
      // 本文なし
    }
    return { status: res.status, ...(typeof data["error"] === "string" ? { code: data["error"] } : {}), data };
  } catch {
    return { status: null, data: {} };
  } finally {
    clearTimeout(timer);
  }
};

const running = new Map<string, Promise<IncidentFlushResult>>();

export type IncidentFlushResult = { readonly sent: number; readonly rejected: number; readonly blocked: boolean };

/**
 * 計画の簡易記録の送信待ちを、押した順に送る。成功（201・200）は消し、4xx は理由つきで残して次へ、
 * 通信できない・5xx・時間切れで止まる（順序を守る）。送れるたびに onSent を呼ぶ（応答の記録の ID を画面が使う）。
 */
export const flushIncidentOutbox = (planId: string, memberId: string, onSent?: (info: IncidentSentInfo) => void): Promise<IncidentFlushResult> => {
  const key = incidentOutboxKey(planId, memberId);
  const existing = running.get(key);
  if (existing) return existing;
  const p = (async (): Promise<IncidentFlushResult> => {
    let sent = 0;
    let rejected = 0;
    for (let guard = 0; guard < 200; guard++) {
      const entry = nextIncidentToSend(loadPlanIncidentOutbox(planId, memberId));
      if (!entry) return { sent, rejected, blocked: false };
      const res = await sendOne(planId, entry);
      const outcome = classifyResponse({ status: res.status, ...(res.code ? { code: res.code } : {}) });
      updatePlanIncidentOutbox(planId, memberId, (s) => applyIncidentOutcome(s, entry.clientRequestId, outcome));
      if (outcome.kind === "retry") return { sent, rejected, blocked: true };
      if (outcome.kind === "sent") {
        sent += 1;
        onSent?.({ entry, status: res.status ?? 0, data: res.data });
      } else {
        rejected += 1;
      }
    }
    return { sent, rejected, blocked: false };
  })().finally(() => running.delete(key));
  running.set(key, p);
  return p;
};

/** ある利用者の、簡易記録の送信待ちがある計画の ID（ログアウトの前に送る対象）。 */
export const planIdsWithIncidentOutbox = (memberId: string): string[] => {
  const ids = new Set<string>();
  const add = (k: string): void => {
    const id = planIdOfIncidentKey(k, memberId);
    if (id) ids.add(id);
  };
  for (const k of memory.keys()) add(k);
  const st = storage();
  if (st) for (const k of incidentOutboxKeys(st)) add(k);
  return [...ids];
};

/** テスト用：メモリの保持を空にする。 */
export const resetUnsavedIncidentOutboxForTest = (): void => memory.clear();
