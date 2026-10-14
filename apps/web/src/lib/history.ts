// 判定履歴の localStorage 保管。
// Phase 1 中盤の Supabase 接続化でサーバ側 evidence_log テーブルに移送する想定。
// 同じ evidenceId は重複保存しない (= 同一座標+同一ctxは自然に idempotent)。
// LRU で最大 50 件まで保持、超えたら最古を削除。

import type { LatLng } from "@soraban/geo";
import type {
  DiagnosisCategory,
  FlightContext,
  ManualChoice,
  RegulationStatus,
  SpecificFlightFlag,
} from "@soraban/regulations";

const STORAGE_KEY = "soraban:history:v1";
// 同タブ内の変更を useSyncExternalStore に伝えるためのカスタムイベント。
// 別タブからの localStorage 変更は 'storage' イベントが拾うが、
// 同タブ内の自分自身の書き込みでは発火しない仕様なので分けて出す。
export const HISTORY_CHANGE_EVENT = "soraban:history-changed";
const MAX_ENTRIES = 50;

const notifyChange = (): void => {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(HISTORY_CHANGE_EVENT));
  }
};

// 申請支援（DIPS 飛行許可・承認 診断）の入力・操作状態。
// 履歴からの復元時に飛行方法・予定日・立入管理措置・マニュアル方針・チェックリスト完了状態を再現する。
export type SavedDiagnosisInput = {
  readonly methodFlags?: readonly SpecificFlightFlag[];
  readonly airspaceFlags?: readonly SpecificFlightFlag[];
  readonly plannedDate?: string;
  readonly accessMode?: "" | "yes" | "no_third_party";
  readonly bvlosObserver?: "" | "with" | "without";
  readonly manualChoice?: ManualChoice;
  readonly completedProcedureIds?: readonly string[];
};

// 申請支援診断の軽量サマリ（履歴リスト表示・証跡同定用）。
export type SavedDiagnosisSummary = {
  readonly diagnosisEvidenceId: string;
  readonly category: DiagnosisCategory;
  readonly isSpecificFlight: boolean;
  readonly procedureCount: number;
};

// SavedCheck: 履歴 1 エントリ。完全な RegulationCheckResult ではなく
// "後で再現できる十分な手がかり + 軽量サマリ" のみ保存することで
// localStorage 容量逼迫を避ける。詳細は再判定で復元する設計。
export type SavedCheck = {
  readonly evidenceId: string;
  readonly savedAt: string; // ISO
  readonly loc: LatLng;
  readonly ctx?: FlightContext;
  readonly overall: RegulationStatus;
  readonly resolvedAddress?: string;
  readonly engineVersion: string;
  readonly checkedAt: string; // ISO
  readonly muniCode?: string;
  readonly diagnosisInput?: SavedDiagnosisInput;
  readonly diagnosisSummary?: SavedDiagnosisSummary;
};

export type DiagnosisHistoryPatch = {
  readonly evidenceId?: string;
  readonly loc?: LatLng;
  readonly diagnosisInput?: Partial<SavedDiagnosisInput>;
  readonly diagnosisSummary?: SavedDiagnosisSummary;
};

const isBrowser = (): boolean =>
  typeof window !== "undefined" && typeof window.localStorage !== "undefined";

const isSameLoc = (a: LatLng, b: LatLng): boolean =>
  Math.abs(a.lat - b.lat) < 1e-6 && Math.abs(a.lng - b.lng) < 1e-6;

const safeRead = (): SavedCheck[] => {
  if (!isBrowser()) return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // 軽い shape check。旧形式（diagnosisInput / diagnosisSummary なし）もそのまま通す。
    return parsed.filter(
      (e): e is SavedCheck =>
        typeof e === "object" &&
        e !== null &&
        typeof e.evidenceId === "string" &&
        typeof e.savedAt === "string" &&
        typeof e.loc === "object" &&
        e.loc !== null &&
        typeof e.loc.lat === "number" &&
        typeof e.loc.lng === "number",
    );
  } catch {
    return [];
  }
};

const safeWrite = (entries: readonly SavedCheck[]): void => {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // QuotaExceededError 等。静かに諦める (履歴は補助機能)
  }
};

export const loadHistory = (): readonly SavedCheck[] => safeRead();

const mergeDiagnosisInput = (
  base: SavedDiagnosisInput | undefined,
  patch: Partial<SavedDiagnosisInput> | undefined,
): SavedDiagnosisInput | undefined => {
  if (!base && !patch) return undefined;
  return {
    ...(base ?? {}),
    ...(patch ?? {}),
  };
};

/**
 * 履歴に1件追加 (= 同じ evidenceId が既存ならその場で更新、新規なら先頭に挿入)。
 * MAX_ENTRIES を超えたら末尾 (最古) を切り捨てる。
 * 戻り値は更新後の履歴一覧。
 */
export const saveHistory = (entry: SavedCheck): readonly SavedCheck[] => {
  const current = safeRead();
  const existing = current.find((e) => e.evidenceId === entry.evidenceId);
  const mergedEntry: SavedCheck = {
    ...entry,
    diagnosisInput: mergeDiagnosisInput(existing?.diagnosisInput, entry.diagnosisInput),
    diagnosisSummary: entry.diagnosisSummary ?? existing?.diagnosisSummary,
  };
  const dedup = current.filter((e) => e.evidenceId !== entry.evidenceId);
  const next = [mergedEntry, ...dedup].slice(0, MAX_ENTRIES);
  safeWrite(next);
  notifyChange();
  return next;
};

/**
 * 既存の履歴エントリに対して、申請支援の入力（diagnosisInput）や診断サマリ（diagnosisSummary）を
 * 部分更新する。対象エントリは以下の優先順で特定する：
 *   1. evidenceId が一致するエントリ（地点判定の evidenceId または diagnosisEvidenceId）
 *   2. loc が一致する最新のエントリ（同一地点で飛行方法・予定日・チェックリスト等を変更した場合）
 */
export const patchHistoryDiagnosis = (
  patch: DiagnosisHistoryPatch,
): readonly SavedCheck[] => {
  const current = safeRead();
  if (current.length === 0) return current;

  let idx = -1;
  if (patch.evidenceId) {
    idx = current.findIndex(
      (e) =>
        e.evidenceId === patch.evidenceId ||
        e.diagnosisSummary?.diagnosisEvidenceId === patch.evidenceId,
    );
  }
  if (idx === -1 && patch.loc) {
    idx = current.findIndex((e) => isSameLoc(e.loc, patch.loc!));
  }
  if (idx === -1) return current;

  const target = current[idx]!;
  const updated: SavedCheck = {
    ...target,
    diagnosisInput: mergeDiagnosisInput(target.diagnosisInput, patch.diagnosisInput),
    diagnosisSummary: patch.diagnosisSummary ?? target.diagnosisSummary,
  };
  const next = [...current];
  next[idx] = updated;
  safeWrite(next);
  notifyChange();
  return next;
};

export const removeHistory = (evidenceId: string): readonly SavedCheck[] => {
  const next = safeRead().filter((e) => e.evidenceId !== evidenceId);
  safeWrite(next);
  notifyChange();
  return next;
};

export const clearHistory = (): readonly SavedCheck[] => {
  safeWrite([]);
  notifyChange();
  return [];
};

// useSyncExternalStore 用 subscribe。同タブ + 別タブ両方の変更を拾う。
export const subscribeHistory = (callback: () => void): (() => void) => {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("storage", callback);
  window.addEventListener(HISTORY_CHANGE_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(HISTORY_CHANGE_EVENT, callback);
  };
};

// useSyncExternalStore 用 getServerSnapshot。SSR 中は localStorage を読めないので空配列。
const EMPTY: readonly SavedCheck[] = [];

// useSyncExternalStore は getSnapshot が同一参照を返すことを期待する。
// localStorage の raw 文字列をキャッシュキーにして、変化していなければ前回の参照を返す。
let cachedRaw: string | null = null;
let cachedSnapshot: readonly SavedCheck[] = EMPTY;

export const getHistorySnapshot = (): readonly SavedCheck[] => {
  if (!isBrowser()) return EMPTY;
  const raw = window.localStorage.getItem(STORAGE_KEY) ?? "";
  if (raw === cachedRaw) return cachedSnapshot;
  cachedRaw = raw;
  cachedSnapshot = safeRead();
  return cachedSnapshot;
};

export const getHistoryServerSnapshot = (): readonly SavedCheck[] => EMPTY;
