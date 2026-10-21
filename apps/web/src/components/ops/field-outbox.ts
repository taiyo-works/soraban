// 現場モードの送信待ち（アウトボックス）のブラウザ側の処理（Sprint 12c 設計 F）。規則そのものは lib/ops-outbox.ts（純粋）にある。
// ここは localStorage と fetch に触れる部分だけ。送り先は自分のサーバーの API だけ（外部へは送らない）。
//   - 1 行ずつ保存し、順番に送る。古い行が送れない（通信できない・5xx・時間切れ）うちは後ろを送らない。
//   - 同じ計画の送信は同時に 1 つだけ（画面と、日誌・ログアウトからの呼び出しが重ならない）。
import {
  applyOutcome,
  classifyResponse,
  isOutboxKey,
  loadOutbox,
  nextToSend,
  outboxKey,
  saveOutbox,
  toRequestBody,
  type OutboxEntry,
  type OutboxState,
  type StorageLike,
} from "@/lib/ops-outbox";
import { parseJstMinute } from "@/lib/ops-time";

/** 1 回の送信を待つ上限（ミリ秒）。超えたら通信できなかったものとして再試行に回す。 */
export const FIELD_SEND_TIMEOUT_MS = 10_000;
/** 押してから、この時間（ミリ秒）以内の最初の送信は「その場の送信」（端末の時計のずれをサーバーが検査する）。 */
const IMMEDIATE_WINDOW_MS = 2 * 60_000;

export const fieldEventsUrl = (planId: string): string => `/api/ops/plans/${planId}/field-events`;

const storage = (): StorageLike | null => {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
};

/** 計画ごとの送信待ちを読む（保存できない環境では空）。 */
export const loadPlanOutbox = (planId: string, memberId: string): OutboxState => {
  const st = storage();
  return st ? loadOutbox(st, outboxKey(planId, memberId)) : { v: 1, entries: [] };
};

/** 変更をかけてから保存する（最新を読み直してから変更する。画面の状態を直接書き戻さない）。 */
export const updatePlanOutbox = (planId: string, memberId: string, fn: (s: OutboxState) => OutboxState): OutboxState => {
  const st = storage();
  if (!st) return fn({ v: 1, entries: [] });
  const key = outboxKey(planId, memberId);
  const next = fn(loadOutbox(st, key));
  saveOutbox(st, key, next);
  return next;
};

/**
 * 送信の本文。最初の送信がまだ新しい行（押してから 2 分以内）は「その場の送信」（queued: false）にして、
 * 端末の時計のずれ（±5 分）をサーバーに検査させる。再試行の行・古い行は送信待ちを経由したもの（queued: true。72 時間まで）。
 */
export const requestBodyFor = (e: OutboxEntry, nowMs: number): Record<string, unknown> => {
  const at = parseJstMinute(e.occurredAt);
  const age = at ? nowMs - at.getTime() : Number.POSITIVE_INFINITY;
  const immediate = e.attempts === 0 && age <= IMMEDIATE_WINDOW_MS;
  return { ...toRequestBody(e), queued: !immediate };
};

export type SentInfo = { readonly entry: OutboxEntry; readonly status: number; readonly data: Record<string, unknown> };

const sendOne = async (
  planId: string,
  entry: OutboxEntry,
): Promise<{ readonly status: number | null; readonly code?: string; readonly data: Record<string, unknown> }> => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FIELD_SEND_TIMEOUT_MS);
  try {
    const res = await fetch(fieldEventsUrl(planId), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(requestBodyFor(entry, Date.now())),
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

const running = new Map<string, Promise<FlushResult>>();

export type FlushResult = {
  readonly sent: number;
  readonly rejected: number;
  /** 再試行が必要で止まった（後ろの行は送っていない）。 */
  readonly blocked: boolean;
};

/**
 * 計画の送信待ちを、押した順に送る。成功（201・200）した行は消し、4xx の行は理由つきで残して次へ進み、
 * 通信できない・5xx・時間切れで止まる（順序を守る）。送れるたびに onSent を呼ぶ。
 */
export const flushOutbox = (planId: string, memberId: string, onSent?: (info: SentInfo) => void): Promise<FlushResult> => {
  const key = outboxKey(planId, memberId);
  const existing = running.get(key);
  if (existing) return existing;
  const p = (async (): Promise<FlushResult> => {
    let sent = 0;
    let rejected = 0;
    for (let guard = 0; guard < 500; guard++) {
      const cur = loadPlanOutbox(planId, memberId);
      const entry = nextToSend(cur);
      if (!entry) return { sent, rejected, blocked: false };
      const res = await sendOne(planId, entry);
      const outcome = classifyResponse({ status: res.status, ...(res.code ? { code: res.code } : {}) });
      updatePlanOutbox(planId, memberId, (s) => applyOutcome(s, entry.clientEventId, outcome));
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

/** ある利用者の、すべての計画の送信待ちの計画 ID（ログアウトの前に送る対象）。 */
export const planIdsWithOutbox = (memberId: string): string[] => {
  const st = storage();
  if (!st) return [];
  const ids: string[] = [];
  try {
    for (let i = 0; i < st.length; i++) {
      const k = st.key(i);
      if (!k || !isOutboxKey(k) || !k.endsWith(`:${memberId}`)) continue;
      const m = /^soraban:ops-draft:field-([0-9a-f-]{36}):/i.exec(k);
      if (m?.[1]) ids.push(m[1].toLowerCase());
    }
  } catch {
    // 何もしない
  }
  return ids;
};
