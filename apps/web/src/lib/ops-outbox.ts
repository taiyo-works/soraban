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
//   - 端末に残す内容は、計画の ID（キー）・種別・時刻・識別子・確認の項目だけ。氏名・技能証明書番号・座標・自由記述は入れない。
//   - ログアウトは、未送信が残っているときに警告し、黙って消さない。
import type { FieldCheckItem, FieldCheckResult } from "./ops-field";
import { fieldErrorMessage } from "./ops-field";

/** drafts.ts の PREFIX と同じ（clearOtherUsersDrafts が他の利用者の保存を消せるように、同じ接頭辞・末尾が利用者の ID）。 */
export const OUTBOX_KEY_PREFIX = "soraban:ops-draft:field-";

/** 計画ごと・利用者ごとの送信待ちのキー。例：soraban:ops-draft:field-<計画の ID>:<利用者の ID> */
export const outboxKey = (planId: string, memberId: string): string => `${OUTBOX_KEY_PREFIX}${planId}:${memberId}`;
export const isOutboxKey = (key: string): boolean => key.startsWith(OUTBOX_KEY_PREFIX);

export type OutboxKind = "check" | "takeoff" | "landing" | "undo";
export type OutboxStatus = "pending" | "rejected";

export type OutboxEntry = {
  readonly clientEventId: string;
  readonly kind: OutboxKind;
  /** 事実の時刻（JST の `YYYY-MM-DDTHH:MM`）。押した時点の端末の時計。 */
  readonly occurredAt: string;
  readonly item?: Exclude<FieldCheckItem, "inspection">;
  readonly result?: FieldCheckResult;
  /** 緊急用務空域の確認元（選択肢の ID）。 */
  readonly source?: string;
  /** landing（飛行中の離陸）・undo（取り消す行）が指す行。サーバーの ID が分からない（まだ届いていない）ときは端末の識別子。 */
  readonly targetEventId?: string;
  readonly targetClientEventId?: string;
  readonly status: OutboxStatus;
  /** 送ろうとした回数。 */
  readonly attempts: number;
  readonly rejection?: { readonly status: number; readonly code: string; readonly message: string };
};

export type OutboxState = { readonly v: 1; readonly entries: readonly OutboxEntry[] };

export const emptyOutbox = (): OutboxState => ({ v: 1, entries: [] });

const KINDS: readonly string[] = ["check", "takeoff", "landing", "undo"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MINUTE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

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
  const source = str("source");
  const target = uuid("targetEventId");
  const targetClient = uuid("targetClientEventId");
  return {
    clientEventId: r["clientEventId"].toLowerCase(),
    kind: r["kind"] as OutboxKind,
    occurredAt: r["occurredAt"],
    ...(item && ["emergency_airspace", "report_recheck", "carry"].includes(item) ? { item: item as OutboxEntry["item"] } : {}),
    ...(result && ["done", "not_designated", "designated"].includes(result) ? { result: result as FieldCheckResult } : {}),
    ...(source && source.length <= 100 ? { source } : {}),
    ...(target ? { targetEventId: target } : {}),
    ...(targetClient ? { targetClientEventId: targetClient } : {}),
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

/** 保存された文字列を読む。壊れていれば空にする（端末の保存は、読めなくても画面を壊さない）。 */
export const parseOutbox = (raw: string | null): OutboxState => {
  if (!raw) return emptyOutbox();
  try {
    const v = JSON.parse(raw) as { entries?: unknown };
    if (!v || !Array.isArray(v.entries)) return emptyOutbox();
    const entries = v.entries.map(sanitizeEntry).filter((e): e is OutboxEntry => e !== null);
    // 同じ識別子は 1 件だけ（先のものを残す）
    const seen = new Set<string>();
    return { v: 1, entries: entries.filter((e) => (seen.has(e.clientEventId) ? false : (seen.add(e.clientEventId), true))) };
  } catch {
    return emptyOutbox();
  }
};

export const serializeOutbox = (s: OutboxState): string => JSON.stringify({ v: 1, entries: s.entries.map((e) => sanitizeEntry(e)).filter(Boolean) });

// ---- 操作 -----------------------------------------------------------------

/** 末尾に追加する（押した順＝送る順）。同じ識別子はすでにあれば追加しない。 */
export const enqueue = (s: OutboxState, e: Omit<OutboxEntry, "status" | "attempts" | "rejection"> & Partial<Pick<OutboxEntry, "status" | "attempts">>): OutboxState => {
  const entry = sanitizeEntry({ ...e, status: "pending", attempts: 0 });
  if (!entry || s.entries.some((x) => x.clientEventId === entry.clientEventId)) return s;
  return { v: 1, entries: [...s.entries, entry] };
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
  ...(e.targetEventId ? { targetEventId: e.targetEventId } : {}),
  ...(e.targetClientEventId ? { targetClientEventId: e.targetClientEventId } : {}),
});

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
