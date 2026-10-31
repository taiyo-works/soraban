// 先読みの束の端末の保存（Sprint 15 設計 3・4・9）。IndexedDB に利用者ごとのキーで置く（localStorage の上限に収まらない可能性があるため）。
//   - 保存・読み込みのたびに許可リスト（sanitizeFieldBundle）で絞る。持ち主（memberId）が違う束は読まない。
//   - IndexedDB が使えない環境（プライベートブラウズ・無効化）ではメモリに置く（画面を閉じるまで）。
//   - ログアウトで消す。別の利用者がログインしたら、前の利用者の束を消す（clearOtherMembersBundles）。
//   - 送信待ち（記録）は localStorage のまま（12c の形式・キー。lib/ops-outbox.ts）。ここには入れない。
import { sanitizeFieldBundle, type FieldBundlePlan } from "@/server/ops/field-compose";

const DB_NAME = "soraban-ops";
const DB_VERSION = 1;
const STORE = "field-bundles";

/** 端末の束のキー：<利用者の ID>:<計画の ID>。 */
export const bundleKey = (memberId: string, planId: string): string => `${memberId}:${planId}`;

const memory = new Map<string, FieldBundlePlan>();

let dbPromise: Promise<IDBDatabase | null> | null = null;
const openDb = (): Promise<IDBDatabase | null> => {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
};

const tx = async <T,>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | null): Promise<T | null> => {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const t = db.transaction(STORE, mode);
      const r = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(r ? (r.result as T) : null);
      t.onerror = () => resolve(null);
      t.onabort = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
};

/** 束を保存する（利用者の ID が違う束は保存しない）。保存できなければメモリに置き、false を返す。 */
export const saveBundles = async (memberId: string, bundles: readonly unknown[]): Promise<boolean> => {
  let ok = true;
  for (const raw of bundles) {
    const b = sanitizeFieldBundle(raw);
    if (!b || b.memberId !== memberId) continue;
    const key = bundleKey(memberId, b.planId);
    const saved = await tx("readwrite", (s) => s.put(b, key));
    if (saved === null) {
      memory.set(key, b);
      ok = false;
    } else memory.delete(key);
  }
  return ok;
};

/** 計画の束を読む（持ち主が違えば読まない）。無ければ null。 */
export const loadBundle = async (memberId: string, planId: string): Promise<FieldBundlePlan | null> => {
  const key = bundleKey(memberId, planId);
  const mem = memory.get(key);
  if (mem) return mem;
  const raw = await tx("readonly", (s) => s.get(key));
  const b = sanitizeFieldBundle(raw);
  return b && b.memberId === memberId && b.planId === planId ? b : null;
};

const allKeys = async (): Promise<string[]> => {
  const ks = (await tx("readonly", (s) => s.getAllKeys())) ?? [];
  return [...new Set([...ks.map(String), ...memory.keys()])];
};

/** 利用者の束の一覧（予定の開始の早い順）。 */
export const listBundles = async (memberId: string): Promise<FieldBundlePlan[]> => {
  const out: FieldBundlePlan[] = [];
  for (const k of await allKeys()) {
    if (!k.startsWith(`${memberId}:`)) continue;
    const b = await loadBundle(memberId, k.slice(memberId.length + 1));
    if (b) out.push(b);
  }
  return out.sort((a, b) => (a.plan.startIso < b.plan.startIso ? -1 : a.plan.startIso > b.plan.startIso ? 1 : 0));
};

/** 1 つの束を消す。 */
export const deleteBundle = async (memberId: string, planId: string): Promise<void> => {
  const key = bundleKey(memberId, planId);
  memory.delete(key);
  await tx("readwrite", (s) => s.delete(key));
};

/** 束を消す。memberId を渡せばその利用者の分だけ、渡さなければすべて（ログアウト）。 */
export const clearBundles = async (memberId?: string): Promise<void> => {
  for (const k of await allKeys()) {
    if (memberId !== undefined && !k.startsWith(`${memberId}:`)) continue;
    memory.delete(k);
    await tx("readwrite", (s) => s.delete(k));
  }
};

/** 他の利用者の束を消す（共用の端末で、前の利用者の先読みを次の人に見せない）。 */
export const clearOtherMembersBundles = async (memberId: string): Promise<void> => {
  for (const k of await allKeys()) {
    if (k.startsWith(`${memberId}:`)) continue;
    memory.delete(k);
    await tx("readwrite", (s) => s.delete(k));
  }
};

/** IndexedDB に保存できず、メモリにだけある束があるか。 */
export const bundlesUnsaved = (): boolean => memory.size > 0;

// ---- ログイン中の利用者（圏外で画面を開いたとき、どの利用者の束・送信待ちを読むか） -----------------------
// 値は利用者の内部 ID（UUID）だけ。氏名・メールは置かない。ログアウトで消す。

const CURRENT_MEMBER_KEY = "soraban:ops-current-member";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const setCurrentMember = (memberId: string): void => {
  try {
    window.localStorage.setItem(CURRENT_MEMBER_KEY, memberId);
  } catch {
    // 保存できない環境では、圏外で開いた画面が利用者を特定できない（その旨を出す）
  }
};

export const currentMember = (): string | null => {
  try {
    const v = window.localStorage.getItem(CURRENT_MEMBER_KEY);
    return v && UUID.test(v) ? v.toLowerCase() : null;
  } catch {
    return null;
  }
};

export const clearCurrentMember = (): void => {
  try {
    window.localStorage.removeItem(CURRENT_MEMBER_KEY);
  } catch {
    // 何もしない
  }
};

/** 先読みの束を取り直す（オンラインのとき）。planId を渡せばその計画だけ。取れなければ null。 */
export const fetchBundles = async (
  memberId: string,
  planId?: string,
  /** 全体を取り直すとき、送信待ちが残っている計画（束を消さない）。 */
  keepPlanIds: readonly string[] = [],
): Promise<{ readonly bundles: number; readonly build: string | null; readonly serverNow: string } | null> => {
  try {
    // 全体の取り直しでは、端末にある束の計画も送り、まだ使えるものだけ返してもらう（返らなかった束は消す。G-2）
    const known = planId ? [] : (await listBundles(memberId)).map((b) => b.planId);
    const q = planId ? `?planId=${planId}` : known.length > 0 ? `?known=${known.join(",")}` : "";
    const res = await fetch(`/api/ops/field-bundle${q}`, { credentials: "same-origin", cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as { memberId?: string; bundles?: unknown[]; build?: string | null; serverNow?: string };
    if (data.memberId !== memberId || !Array.isArray(data.bundles)) return null;
    await saveBundles(memberId, data.bundles);
    if (!planId) {
      const returned = new Set(data.bundles.map((b) => (b && typeof b === "object" ? String((b as { planId?: unknown }).planId ?? "") : "")));
      // 操縦者が変わった・中止した・過去の計画の束は消す。送信待ちが残っている計画の束は残す（圏外で送る前に画面を開けるように）
      for (const id of known) {
        if (returned.has(id) || keepPlanIds.includes(id)) continue;
        await deleteBundle(memberId, id);
      }
    }
    return { bundles: data.bundles.length, build: data.build ?? null, serverNow: data.serverNow ?? new Date().toISOString() };
  } catch {
    return null;
  }
};
