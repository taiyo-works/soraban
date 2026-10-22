// 現場の簡易記録（事故・ヒヤリハット。Sprint 12e 設計 F・判断 9）の端末の保存（送信待ち）の規則。ブラウザに依らない純粋な部分だけ。
// 12c の lib/ops-outbox.ts は変えずに、同じ規則の別の小さなモジュールにする（12c の OutboxKind は閉じた型のため）。
// 共通にできる純粋な補助（応答の分類 classifyResponse）は 12c から import して再利用する。
//
// 規則（12c の設計 F と同じ）：
//   - 「記録する」を押した時点で 1 行保存し（clientRequestId と occurredAt を付ける）、自分のサーバーの API だけへ送る。
//   - 成功（201・200）で消す。通信できない・5xx・時間切れは残して再試行する。順序を守る（古い行が送れないうちは後ろを送らない）。
//   - 4xx（clock_skew・too_old・request_conflict など）は黙って捨てない。理由を残し、「あとから入力」への案内と、破棄は利用者が選ぶ。
//   - 端末に残す内容は、計画の ID（キー）・区分・けがの有無・時刻・識別子だけ。氏名・技能証明書番号・座標・自由記述は入れない
//     （保存・読み込みのたびに許す項目だけに絞る）。
//   - キーは soraban:ops-draft:incident-<計画の ID>:<利用者の ID>（drafts.ts の clearOtherUsersDrafts が他の利用者の分を消す）。
import type { SendOutcome, StorageLike } from "./ops-outbox";
import { INCIDENT_KINDS, INCIDENT_OUTBOX_KEY_PREFIX, YES_NO_UNKNOWN, incidentErrorMessage, incidentOutboxKey, type IncidentKind, type YesNoUnknown } from "./ops-incident";
import { parseJstMinute } from "./ops-time";

export const isIncidentOutboxKey = (key: string): boolean => key.startsWith(INCIDENT_OUTBOX_KEY_PREFIX);

export type IncidentOutboxStatus = "pending" | "rejected";

export type IncidentOutboxEntry = {
  /** 二重登録の防止（サーバーが同じ値の再送を 1 件にまとめる）。 */
  readonly clientRequestId: string;
  readonly kind: IncidentKind;
  readonly peopleInjury: YesNoUnknown;
  /** 押した時点の端末の時計（JST の `YYYY-MM-DDTHH:MM`）。 */
  readonly occurredAt: string;
  readonly status: IncidentOutboxStatus;
  readonly attempts: number;
  readonly rejection?: { readonly status: number; readonly code: string; readonly message: string };
};

export type IncidentOutboxState = { readonly v: 1; readonly entries: readonly IncidentOutboxEntry[] };

export const emptyIncidentOutbox = (): IncidentOutboxState => ({ v: 1, entries: [] });

/** 端末に残してよい項目（これ以外は保存・読み込みのたびに落とす）。 */
export const INCIDENT_OUTBOX_ALLOWED_KEYS = ["clientRequestId", "kind", "peopleInjury", "occurredAt", "status", "attempts", "rejection"] as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MINUTE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

/** 許す項目だけに絞る（余計な項目＝氏名・座標・自由記述などが紛れ込んでも端末に残さない）。壊れた行は null。 */
export const sanitizeIncidentEntry = (raw: unknown): IncidentOutboxEntry | null => {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r["clientRequestId"] !== "string" || !UUID.test(r["clientRequestId"])) return null;
  if (typeof r["kind"] !== "string" || !(INCIDENT_KINDS as readonly string[]).includes(r["kind"])) return null;
  if (typeof r["peopleInjury"] !== "string" || !(YES_NO_UNKNOWN as readonly string[]).includes(r["peopleInjury"])) return null;
  if (typeof r["occurredAt"] !== "string" || !MINUTE.test(r["occurredAt"])) return null;
  const rejection = r["rejection"] as Record<string, unknown> | undefined;
  const rejected = r["status"] === "rejected" && rejection && typeof rejection["code"] === "string";
  return {
    clientRequestId: r["clientRequestId"].toLowerCase(),
    kind: r["kind"] as IncidentKind,
    peopleInjury: r["peopleInjury"] as YesNoUnknown,
    occurredAt: r["occurredAt"],
    status: rejected ? "rejected" : "pending",
    attempts: typeof r["attempts"] === "number" && Number.isFinite(r["attempts"]) ? Math.max(0, Math.floor(r["attempts"])) : 0,
    ...(rejected
      ? {
          rejection: {
            status: typeof rejection["status"] === "number" ? (rejection["status"] as number) : 400,
            code: rejection["code"] as string,
            // 文言は端末に保存された文でなく、定数から引き直す（自由記述を残さない）
            message: incidentErrorMessage(rejection["code"] as string),
          },
        }
      : {}),
  };
};

export const parseIncidentOutbox = (raw: string | null): IncidentOutboxState => {
  if (!raw) return emptyIncidentOutbox();
  try {
    const v = JSON.parse(raw) as { entries?: unknown };
    if (!v || !Array.isArray(v.entries)) return emptyIncidentOutbox();
    const entries = v.entries.map(sanitizeIncidentEntry).filter((e): e is IncidentOutboxEntry => e !== null);
    const seen = new Set<string>();
    return { v: 1, entries: entries.filter((e) => (seen.has(e.clientRequestId) ? false : (seen.add(e.clientRequestId), true))) };
  } catch {
    return emptyIncidentOutbox();
  }
};

export const serializeIncidentOutbox = (s: IncidentOutboxState): string =>
  JSON.stringify({ v: 1, entries: s.entries.map((e) => sanitizeIncidentEntry(e)).filter(Boolean) });

// ---- 操作 -----------------------------------------------------------------

/** 末尾に追加する（押した順＝送る順）。同じ識別子はすでにあれば追加しない。 */
export const enqueueIncident = (
  s: IncidentOutboxState,
  e: Pick<IncidentOutboxEntry, "clientRequestId" | "kind" | "peopleInjury" | "occurredAt">,
): IncidentOutboxState => {
  const entry = sanitizeIncidentEntry({ ...e, status: "pending", attempts: 0 });
  if (!entry || s.entries.some((x) => x.clientRequestId === entry.clientRequestId)) return s;
  return { v: 1, entries: [...s.entries, entry] };
};

export const pendingIncidentEntries = (s: IncidentOutboxState): IncidentOutboxEntry[] => s.entries.filter((e) => e.status === "pending");
export const rejectedIncidentEntries = (s: IncidentOutboxState): IncidentOutboxEntry[] => s.entries.filter((e) => e.status === "rejected");
/** 画面の「未送信 N 件」（送れなかった行は別に数える）。 */
export const incidentUnsentCount = (s: IncidentOutboxState): number => pendingIncidentEntries(s).length;
export const incidentRejectedCount = (s: IncidentOutboxState): number => rejectedIncidentEntries(s).length;
export const nextIncidentToSend = (s: IncidentOutboxState): IncidentOutboxEntry | null => pendingIncidentEntries(s)[0] ?? null;

/** 押してから、この時間（ミリ秒）以内の最初の送信は「その場の送信」（端末の時計のずれ ±5 分をサーバーが検査する）。12c と同じ。 */
export const INCIDENT_IMMEDIATE_WINDOW_MS = 2 * 60_000;

/**
 * 送信の本文（mode = quick）。最初の送信がまだ新しい行は queued: false（その場の送信）、再試行・古い行は queued: true（72 時間まで）。
 * 自由記述・座標・氏名は送らない（簡易記録の項目だけ）。
 */
export const incidentRequestBody = (planId: string, e: IncidentOutboxEntry, nowMs: number): Record<string, unknown> => {
  const at = parseJstMinute(e.occurredAt);
  const age = at ? nowMs - at.getTime() : Number.POSITIVE_INFINITY;
  const immediate = e.attempts === 0 && age <= INCIDENT_IMMEDIATE_WINDOW_MS;
  return {
    mode: "quick",
    kind: e.kind,
    peopleInjury: e.peopleInjury,
    occurredAt: e.occurredAt,
    planId,
    clientRequestId: e.clientRequestId,
    queued: !immediate,
  };
};

/** 送信の結果を反映する。送れた行は消し、再試行の行は回数だけ増やし、拒否の行は理由つきで残す。 */
export const applyIncidentOutcome = (s: IncidentOutboxState, clientRequestId: string, outcome: SendOutcome): IncidentOutboxState => ({
  v: 1,
  entries:
    outcome.kind === "sent"
      ? s.entries.filter((e) => e.clientRequestId !== clientRequestId)
      : s.entries.map((e) =>
          e.clientRequestId !== clientRequestId
            ? e
            : outcome.kind === "retry"
              ? { ...e, attempts: e.attempts + 1 }
              : {
                  ...e,
                  attempts: e.attempts + 1,
                  status: "rejected" as const,
                  rejection: { status: outcome.status, code: outcome.code, message: incidentErrorMessage(outcome.code) },
                },
        ),
});

/** 拒否された行を破棄する（利用者が選ぶ）。未送信の行は破棄しない（黙って消さない）。 */
export const discardRejectedIncident = (s: IncidentOutboxState, clientRequestId: string): IncidentOutboxState => ({
  v: 1,
  entries: s.entries.filter((e) => !(e.clientRequestId === clientRequestId && e.status === "rejected")),
});

// ---- ストレージ ----------------------------------------------------------------

export const loadIncidentOutbox = (storage: StorageLike, key: string): IncidentOutboxState => {
  try {
    return parseIncidentOutbox(storage.getItem(key));
  } catch {
    return emptyIncidentOutbox();
  }
};

/** 保存する。空なら項目ごと消す。保存できない環境では false。 */
export const saveIncidentOutbox = (storage: StorageLike, key: string, s: IncidentOutboxState): boolean => {
  try {
    if (s.entries.length === 0) storage.removeItem(key);
    else storage.setItem(key, serializeIncidentOutbox(s));
    return true;
  } catch {
    return false;
  }
};

export const incidentOutboxKeys = (storage: StorageLike): string[] => {
  const keys: string[] = [];
  try {
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k && isIncidentOutboxKey(k)) keys.push(k);
    }
  } catch {
    // 何もしない
  }
  return keys;
};

/** ある利用者の、すべての計画の簡易記録の未送信・送れなかった行の数（ログアウトの警告に使う）。 */
export const countIncidentUnsentForMember = (storage: StorageLike, memberId: string): { readonly pending: number; readonly rejected: number } => {
  let pending = 0;
  let rejected = 0;
  for (const k of incidentOutboxKeys(storage)) {
    if (!k.endsWith(`:${memberId}`)) continue;
    const s = loadIncidentOutbox(storage, k);
    pending += incidentUnsentCount(s);
    rejected += incidentRejectedCount(s);
  }
  return { pending, rejected };
};

/** キーから計画の ID を取り出す（その利用者のキーでなければ null）。 */
export const planIdOfIncidentKey = (key: string, memberId: string): string | null => {
  if (!isIncidentOutboxKey(key) || !key.endsWith(`:${memberId}`)) return null;
  const m = /^soraban:ops-draft:incident-([0-9a-f-]{36}):/i.exec(key);
  return m?.[1] ? m[1].toLowerCase() : null;
};

export { incidentOutboxKey };
