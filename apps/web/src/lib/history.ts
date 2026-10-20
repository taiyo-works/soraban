// 判定履歴の localStorage 保管。
// サーバ側の evidence_log（Sprint 8 から /api/check の応答後に記録）とは別に、利用者の端末にも残す。
// 同じ evidenceId は重複保存しない (= 同一座標+同一ctxは自然に idempotent)。
// LRU で最大 50 件まで保持、超えたら最古を削除。

import type { LatLng } from "@soraban/geo";
import {
  LEGACY_STATUS_LABEL,
  VERDICT_LABEL,
  VERDICT_LEVELS,
  type AirspaceDeterminationStatus,
  type DiagnosisCategory,
  type DidDetail,
  type FlightContext,
  type ManualChoice,
  type RegulationStatus,
  type SpecificFlightFlag,
  type VerdictLevel,
} from "@soraban/regulations";

const STORAGE_KEY = "soraban:history:v1";
// 地点判定より先に届いた診断結果を runId 単位で一時保管するキー（応答順に依存しないため）。
const PENDING_KEY = "soraban:history:pending:v1";
const MAX_PENDING = 20;
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
  /** ユーザーが手動で指定した空域フラグ（自動判定由来は含めない）。 */
  readonly userAirspaceFlags?: readonly SpecificFlightFlag[];
  /** DID 非該当をユーザーが確認済み。 */
  readonly didConfirmedNotApplicable?: boolean;
};

// 申請支援診断の軽量サマリ（履歴リスト表示・証跡同定用）。
export type SavedDiagnosisSummary = {
  readonly diagnosisEvidenceId: string;
  readonly category: DiagnosisCategory;
  readonly isSpecificFlight: boolean;
  readonly procedureCount: number;
  /** DID 該当の三値（旧形式エントリには無い）。 */
  readonly didStatus?: AirspaceDeterminationStatus;
  /** DID 判定の詳細（「非該当（工業専用地域）」等の区別。Sprint 7 以降のエントリのみ）。 */
  readonly didDetail?: DidDetail;
};

// SavedCheck: 履歴 1 エントリ。完全な RegulationCheckResult ではなく
// "後で再現できる十分な手がかり + 軽量サマリ" のみ保存することで
// localStorage 容量逼迫を避ける。詳細は再判定で復元する設計。
export type SavedCheck = {
  /** 1 回のチェック実行（地点判定＋申請支援診断）を表す ID。旧形式エントリには無い。 */
  readonly runId?: string;
  readonly evidenceId: string;
  readonly savedAt: string; // ISO
  readonly loc: LatLng;
  readonly ctx?: FlightContext;
  /** 元の判定の集約（0.3.0 までは許可を当てた後の値）。互換のため残す。 */
  readonly overall: RegulationStatus;
  /** 地点の判定（4 段。/api/check の verdict）。Sprint 11d より前の旧形式エントリには無い。 */
  readonly verdict?: VerdictLevel;
  /** 判定不能（データ未整備）の規制の件数。 */
  readonly verdictUnknownCount?: number;
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
 * @deprecated Sprint 6 以降の UI は recordHistoryDiagnosis（runId 指定）を使う。
 * 座標フォールバックは古い同一座標エントリを誤更新し得るため、後方互換のためだけに残す。
 *
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

// ============================================================
// runId 単位の履歴書き込み（Sprint 6: 応答順レース対策）
// ============================================================

type PendingDiagnosis = {
  readonly runId: string;
  readonly diagnosisInput?: SavedDiagnosisInput;
  readonly diagnosisSummary?: SavedDiagnosisSummary;
};

const readPending = (): PendingDiagnosis[] => {
  if (!isBrowser()) return [];
  try {
    const raw = window.localStorage.getItem(PENDING_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter(
          (p): p is PendingDiagnosis =>
            typeof p === "object" && p !== null && typeof p.runId === "string",
        )
      : [];
  } catch {
    return [];
  }
};

const writePending = (entries: readonly PendingDiagnosis[]): void => {
  if (!isBrowser()) return;
  try {
    if (entries.length === 0) window.localStorage.removeItem(PENDING_KEY);
    else window.localStorage.setItem(PENDING_KEY, JSON.stringify(entries.slice(0, MAX_PENDING)));
  } catch {
    // 静かに諦める
  }
};

/** チェック実行ごとの履歴 ID を採番する（地点判定・診断の両結果をこの ID に書き込む）。 */
export const createHistoryRunId = (): string => {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return `run_${c.randomUUID()}`;
  return `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
};

/**
 * 地点判定の結果を runId のエントリに書き込む。
 *   - 同じ runId のエントリがあれば判定部分のみ更新（診断部分は保持）
 *   - 無ければ新規作成し、先に届いていた診断結果（pending）を合流する
 *   - 別 runId で同じ evidenceId のエントリは重複として除去する（idempotent）
 * 座標一致での照合は行わない（古い同一座標エントリを誤更新しない）。
 */
export const recordHistoryCheck = (
  runId: string,
  entry: Omit<SavedCheck, "runId">,
): readonly SavedCheck[] => {
  const current = safeRead();
  const existing = current.find((e) => e.runId === runId);
  const pendingAll = readPending();
  const pending = pendingAll.find((p) => p.runId === runId);
  const base = existing ?? pending;
  const merged: SavedCheck = {
    ...entry,
    runId,
    // 判定時点の入力スナップショットに、診断側（より新しい／確定した）入力を重ねる。
    diagnosisInput: mergeDiagnosisInput(entry.diagnosisInput, base?.diagnosisInput),
    diagnosisSummary: base?.diagnosisSummary ?? entry.diagnosisSummary,
  };
  const withoutDup = current.filter(
    (e) => e.runId === runId || e.evidenceId !== entry.evidenceId,
  );
  const next = (
    existing
      ? withoutDup.map((e) => (e.runId === runId ? merged : e))
      : [merged, ...withoutDup]
  ).slice(0, MAX_ENTRIES);
  if (pending) writePending(pendingAll.filter((p) => p.runId !== runId));
  safeWrite(next);
  notifyChange();
  return next;
};

/**
 * 申請支援診断の結果・入力（およびチェックリスト操作）を runId のエントリに書き込む。
 * 地点判定がまだ届いていなければ pending に保管し、判定到着時に合流させる。
 */
export const recordHistoryDiagnosis = (
  runId: string,
  patch: {
    readonly diagnosisInput?: Partial<SavedDiagnosisInput>;
    readonly diagnosisSummary?: SavedDiagnosisSummary;
  },
): readonly SavedCheck[] => {
  const current = safeRead();
  const idx = current.findIndex((e) => e.runId === runId);
  if (idx === -1) {
    const pendingAll = readPending();
    const prev = pendingAll.find((p) => p.runId === runId);
    const nextPending: PendingDiagnosis = {
      runId,
      diagnosisInput: mergeDiagnosisInput(prev?.diagnosisInput, patch.diagnosisInput),
      diagnosisSummary: patch.diagnosisSummary ?? prev?.diagnosisSummary,
    };
    writePending([nextPending, ...pendingAll.filter((p) => p.runId !== runId)]);
    return current;
  }
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
  writePending([]);
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

// ============================================================
// 履歴からの復元計画（Sprint 7: 旧形式・旧規制 ID の互換）
// ============================================================

/**
 * Sprint 6 までの規制 ID・手続き ID を現行の ID に読み替える表。
 * 復元時に完了チェック（completedProcedureIds）等へ旧 ID が含まれていても例外にしない。
 */
export const LEGACY_ID_ALIASES: Readonly<Record<string, string>> = {
  // 規制 ID：美保基地のみ → 飛行禁止法の対象施設一般（Sprint 7）
  "miho-airbase-no-fly": "small-drone-law",
};

const ALL_FLAGS: ReadonlySet<string> = new Set([
  "airspace_airport",
  "airspace_150m",
  "airspace_did",
  "airspace_emergency",
  "method_night",
  "method_bvlos",
  "method_30m",
  "method_event",
  "method_dangerous",
  "method_drop",
]);

const sanitizeFlags = (v: unknown): SpecificFlightFlag[] =>
  Array.isArray(v)
    ? v.filter((f): f is SpecificFlightFlag => typeof f === "string" && ALL_FLAGS.has(f))
    : [];

const sanitizeIds = (v: unknown): string[] =>
  Array.isArray(v)
    ? Array.from(
        new Set(
          v
            .filter((x): x is string => typeof x === "string" && x.length > 0)
            .map((x) => LEGACY_ID_ALIASES[x] ?? x),
        ),
      )
    : [];

const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;

export type RestorePlan = {
  readonly loc: LatLng;
  readonly ctx?: FlightContext;
  readonly methodFlags: readonly SpecificFlightFlag[];
  readonly userAirspaceFlags: readonly SpecificFlightFlag[];
  readonly didConfirmedNotApplicable: boolean;
  readonly plannedDate: string;
  readonly accessMode: "" | "yes" | "no_third_party";
  readonly bvlosObserver: "" | "with" | "without";
  readonly manualChoice: ManualChoice;
  readonly completedProcedureIds: readonly string[];
};

/**
 * 履歴エントリから復元に必要な値を組み立てる純関数。
 * 旧形式（Sprint 6 以前の soraban:history:v1、旧規制 ID・未知の値を含む）でも例外を出さず、
 * 不正値は既定値に倒す。UI（regulation-checker）の restoreFromHistory はこの結果を state に戻す。
 */
export const buildRestorePlan = (entry: SavedCheck): RestorePlan => {
  const input = (entry.diagnosisInput ?? {}) as Record<string, unknown>;
  // 新形式はユーザー指定分のみ。旧形式（userAirspaceFlags なし）は当該地点の airspaceFlags をユーザー指定扱い。
  const userAirspace =
    input["userAirspaceFlags"] !== undefined
      ? sanitizeFlags(input["userAirspaceFlags"])
      : sanitizeFlags(input["airspaceFlags"]);
  const plannedDate =
    typeof input["plannedDate"] === "string" ? (input["plannedDate"] as string) : "";
  const ctx =
    entry.ctx && typeof entry.ctx === "object"
      ? {
          ...(typeof entry.ctx.droneWeightG === "number" ? { droneWeightG: entry.ctx.droneWeightG } : {}),
          ...(Array.isArray(entry.ctx.pilotPermits)
            ? { pilotPermits: entry.ctx.pilotPermits.filter((p) => typeof p === "string") }
            : {}),
          ...(typeof entry.ctx.purpose === "string" ? { purpose: entry.ctx.purpose } : {}),
          ...(typeof entry.ctx.droneClass === "string" ? { droneClass: entry.ctx.droneClass } : {}),
        }
      : undefined;
  return {
    loc: { lat: entry.loc.lat, lng: entry.loc.lng },
    ...(ctx && Object.keys(ctx).length > 0 ? { ctx } : {}),
    methodFlags: sanitizeFlags(input["methodFlags"]),
    userAirspaceFlags: userAirspace,
    didConfirmedNotApplicable: input["didConfirmedNotApplicable"] === true,
    plannedDate,
    accessMode: pick(input["accessMode"], ["", "yes", "no_third_party"] as const, ""),
    bvlosObserver: pick(input["bvlosObserver"], ["", "with", "without"] as const, ""),
    manualChoice: pick(input["manualChoice"], ["standard", "custom"] as const, "custom"),
    completedProcedureIds: sanitizeIds(input["completedProcedureIds"]),
  };
};

// ============================================================
// 履歴の判定の表示（Sprint 11d C5）
// ============================================================

export type HistoryVerdictDisplay = {
  /** 4 段の判定（旧形式は undefined）。 */
  readonly level?: VerdictLevel;
  readonly label: string;
  /** 旧版（verdict なし）の値か。 */
  readonly legacy: boolean;
  readonly unknownCount?: number;
};

/**
 * 履歴 1 件の判定の表示。新形式は 4 段の言葉、旧形式（verdict なし。0.3.0／0.2.0）は旧版の値であることを
 * 明示した言葉（例：適用外（旧版の判定））。旧版の緑の表示の言葉（飛べると読める語）は新旧とも出さない。
 */
export const historyVerdictDisplay = (entry: SavedCheck): HistoryVerdictDisplay => {
  const v = entry.verdict;
  if (typeof v === "string" && (VERDICT_LEVELS as readonly string[]).includes(v)) {
    const n = typeof entry.verdictUnknownCount === "number" ? entry.verdictUnknownCount : undefined;
    return { level: v, label: VERDICT_LABEL[v], legacy: false, ...(n !== undefined ? { unknownCount: n } : {}) };
  }
  const overall: RegulationStatus =
    entry.overall === "red" || entry.overall === "yellow" || entry.overall === "green"
      ? entry.overall
      : "unknown";
  return { label: LEGACY_STATUS_LABEL[overall], legacy: true };
};
