import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildRestorePlan,
  clearHistory,
  createHistoryRunId,
  getHistorySnapshot,
  clearHistoryDiagnosisVerdict,
  historyDiagnosisDetail,
  historyVerdictDisplay,
  loadHistory,
  markHistoryDiagnosisFailed,
  patchHistoryDiagnosis,
  recordHistoryCheck,
  recordHistoryDiagnosis,
  removeHistory,
  saveHistory,
  type SavedCheck,
} from "./history";

// Node 環境用の最小限の window + localStorage モック。
class MemoryStorage {
  private map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  clear(): void {
    this.map.clear();
  }
}

const makeBaseEntry = (overrides?: Partial<SavedCheck>): SavedCheck => ({
  evidenceId: "ev_1111222233334444",
  savedAt: "2026-10-14T00:00:00.000Z",
  loc: { lat: 35.4278, lng: 133.3314 },
  ctx: { droneWeightG: 900 },
  overall: "red",
  resolvedAddress: "鳥取県米子市加茂町１丁目",
  engineVersion: "soraban-0.2.0-clausegraph",
  checkedAt: "2026-10-14T00:00:00.000Z",
  muniCode: "31202",
  ...overrides,
});

describe("history.ts — 判定履歴＋申請支援条件・進捗の保存と復元", () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
    vi.stubGlobal("window", {
      localStorage: storage,
      dispatchEvent: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
  });

  it("旧形式（diagnosisInput / diagnosisSummary なし）のエントリも後方互換で読み込める", () => {
    const legacy = [
      {
        evidenceId: "ev_legacy0000000001",
        savedAt: "2026-06-01T00:00:00.000Z",
        loc: { lat: 35.4278, lng: 133.3314 },
        overall: "red",
        engineVersion: "soraban-0.2.0-clausegraph",
        checkedAt: "2026-06-01T00:00:00.000Z",
      },
    ];
    storage.setItem("soraban:history:v1", JSON.stringify(legacy));
    const loaded = loadHistory();
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.evidenceId).toBe("ev_legacy0000000001");
    expect(loaded[0]?.diagnosisInput).toBeUndefined();
    expect(loaded[0]?.diagnosisSummary).toBeUndefined();
  });

  it("saveHistory で申請支援入力（diagnosisInput）とサマリ（diagnosisSummary）を保存できる", () => {
    const entry = makeBaseEntry({
      diagnosisInput: {
        methodFlags: ["method_night", "method_bvlos"],
        airspaceFlags: ["airspace_did"],
        plannedDate: "2026-11-10",
        accessMode: "yes",
        bvlosObserver: "with",
        manualChoice: "custom",
        completedProcedureIds: ["drone-registration"],
      },
      diagnosisSummary: {
        diagnosisEvidenceId: "ev_diag999988887777",
        category: "II_B_eligible",
        isSpecificFlight: true,
        procedureCount: 6,
      },
    });
    saveHistory(entry);
    const snapshot = getHistorySnapshot();
    expect(snapshot).toHaveLength(1);
    expect(snapshot[0]?.diagnosisInput?.methodFlags).toEqual([
      "method_night",
      "method_bvlos",
    ]);
    expect(snapshot[0]?.diagnosisInput?.plannedDate).toBe("2026-11-10");
    expect(snapshot[0]?.diagnosisInput?.completedProcedureIds).toEqual([
      "drone-registration",
    ]);
    expect(snapshot[0]?.diagnosisSummary?.category).toBe("II_B_eligible");
    expect(snapshot[0]?.diagnosisSummary?.diagnosisEvidenceId).toBe(
      "ev_diag999988887777",
    );
  });

  it("patchHistoryDiagnosis で同一座標の最新エントリに申請支援条件・完了チェックを部分更新できる", () => {
    saveHistory(makeBaseEntry());

    // 1. 診断完了時のパッチ（フラグ・予定日・診断サマリ）
    patchHistoryDiagnosis({
      loc: { lat: 35.4278, lng: 133.3314 },
      diagnosisInput: {
        methodFlags: ["method_night"],
        airspaceFlags: ["airspace_did"],
        plannedDate: "2026-12-01",
      },
      diagnosisSummary: {
        diagnosisEvidenceId: "ev_diag1234567890ab",
        category: "II_B_eligible",
        isSpecificFlight: true,
        procedureCount: 5,
      },
    });

    // 2. 手続き完了チェックとマニュアル選択の個別パッチ（既存の methodFlags や plannedDate を壊さない）
    patchHistoryDiagnosis({
      loc: { lat: 35.4278, lng: 133.3314 },
      diagnosisInput: {
        completedProcedureIds: ["drone-registration", "flight-permission-did"],
        manualChoice: "standard",
      },
    });

    const updated = loadHistory()[0]!;
    expect(updated.diagnosisInput?.methodFlags).toEqual(["method_night"]);
    expect(updated.diagnosisInput?.plannedDate).toBe("2026-12-01");
    expect(updated.diagnosisInput?.manualChoice).toBe("standard");
    expect(updated.diagnosisInput?.completedProcedureIds).toEqual([
      "drone-registration",
      "flight-permission-did",
    ]);
    expect(updated.diagnosisSummary?.diagnosisEvidenceId).toBe(
      "ev_diag1234567890ab",
    );
  });

  it("同一 evidenceId で saveHistory が再実行された際、既存の diagnosisSummary と completedProcedureIds を保持する", () => {
    saveHistory(
      makeBaseEntry({
        diagnosisInput: {
          methodFlags: ["method_night"],
          completedProcedureIds: ["drone-registration"],
        },
        diagnosisSummary: {
          diagnosisEvidenceId: "ev_diag0001",
          category: "II_B_eligible",
          isSpecificFlight: true,
          procedureCount: 4,
        },
      }),
    );

    // diagnosisSummary なしで同一 evidenceId を再保存しても消えない
    saveHistory(
      makeBaseEntry({
        diagnosisInput: {
          methodFlags: ["method_night"],
        },
      }),
    );

    const saved = loadHistory()[0]!;
    expect(saved.diagnosisSummary?.diagnosisEvidenceId).toBe("ev_diag0001");
    expect(saved.diagnosisInput?.completedProcedureIds).toEqual([
      "drone-registration",
    ]);
  });

  it("removeHistory / clearHistory が正常に動作する", () => {
    saveHistory(makeBaseEntry({ evidenceId: "ev_a" }));
    saveHistory(makeBaseEntry({ evidenceId: "ev_b" }));
    expect(loadHistory()).toHaveLength(2);

    removeHistory("ev_a");
    expect(loadHistory().map((e) => e.evidenceId)).toEqual(["ev_b"]);

    clearHistory();
    expect(loadHistory()).toHaveLength(0);
  });
});

describe("history.ts — runId 単位の書き込み（Sprint 6: 応答順レース対策）", () => {
  let storage: MemoryStorage;
  beforeEach(() => {
    storage = new MemoryStorage();
    vi.stubGlobal("window", {
      localStorage: storage,
      dispatchEvent: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
  });

  const summary = {
    diagnosisEvidenceId: "ev_diag000000000001",
    category: "II_B_eligible" as const,
    isSpecificFlight: true,
    procedureCount: 5,
    didStatus: "applicable" as const,
  };
  const { runId: _omit, ...checkPart } = makeBaseEntry({ evidenceId: "ev_check00000000001" });
  void _omit;

  it("createHistoryRunId は毎回異なる ID を返す", () => {
    expect(createHistoryRunId()).not.toBe(createHistoryRunId());
  });

  it("地点判定 → 診断 の順で届いても同じエントリに両方が入る", () => {
    const runId = createHistoryRunId();
    recordHistoryCheck(runId, checkPart);
    recordHistoryDiagnosis(runId, {
      diagnosisInput: { methodFlags: ["method_night"] },
      diagnosisSummary: summary,
    });
    const h = loadHistory();
    expect(h).toHaveLength(1);
    expect(h[0]?.runId).toBe(runId);
    expect(h[0]?.evidenceId).toBe("ev_check00000000001");
    expect(h[0]?.diagnosisSummary).toEqual(summary);
    expect(h[0]?.diagnosisInput?.methodFlags).toEqual(["method_night"]);
  });

  it("診断 → 地点判定 の順で届いても同じエントリに両方が入る（pending 合流）", () => {
    const runId = createHistoryRunId();
    recordHistoryDiagnosis(runId, {
      diagnosisInput: { methodFlags: ["method_bvlos"] },
      diagnosisSummary: summary,
    });
    // 地点判定前は履歴一覧に現れない
    expect(loadHistory()).toHaveLength(0);
    recordHistoryCheck(runId, { ...checkPart, diagnosisInput: { methodFlags: [] } });
    const h = loadHistory();
    expect(h).toHaveLength(1);
    expect(h[0]?.runId).toBe(runId);
    expect(h[0]?.diagnosisSummary).toEqual(summary);
    // 診断側の入力が判定時スナップショットより優先される
    expect(h[0]?.diagnosisInput?.methodFlags).toEqual(["method_bvlos"]);
    expect(storage.getItem("soraban:history:pending:v1")).toBeNull();
  });

  it("同一座標の古いエントリを誤って更新しない", () => {
    const oldRun = createHistoryRunId();
    recordHistoryCheck(oldRun, { ...checkPart, evidenceId: "ev_old0000000000001" });
    recordHistoryDiagnosis(oldRun, { diagnosisSummary: { ...summary, diagnosisEvidenceId: "ev_old_diag" } });

    const newRun = createHistoryRunId();
    // 新しい実行の診断が先に届く（同一座標）
    recordHistoryDiagnosis(newRun, { diagnosisSummary: { ...summary, diagnosisEvidenceId: "ev_new_diag" } });
    let h = loadHistory();
    expect(h).toHaveLength(1);
    expect(h[0]?.diagnosisSummary?.diagnosisEvidenceId).toBe("ev_old_diag");

    recordHistoryCheck(newRun, { ...checkPart, evidenceId: "ev_new0000000000001" });
    h = loadHistory();
    expect(h).toHaveLength(2);
    const byRun = new Map(h.map((e) => [e.runId, e]));
    expect(byRun.get(oldRun)?.diagnosisSummary?.diagnosisEvidenceId).toBe("ev_old_diag");
    expect(byRun.get(newRun)?.diagnosisSummary?.diagnosisEvidenceId).toBe("ev_new_diag");
  });

  it("別 runId で同じ evidenceId は重複させない（idempotent）", () => {
    recordHistoryCheck(createHistoryRunId(), checkPart);
    recordHistoryCheck(createHistoryRunId(), checkPart);
    expect(loadHistory()).toHaveLength(1);
  });

  it("チェックリスト操作も runId のエントリだけを更新する", () => {
    const a = createHistoryRunId();
    const b = createHistoryRunId();
    recordHistoryCheck(a, { ...checkPart, evidenceId: "ev_a" });
    recordHistoryCheck(b, { ...checkPart, evidenceId: "ev_b" });
    recordHistoryDiagnosis(a, { diagnosisInput: { completedProcedureIds: ["drone-registration"] } });
    const byRun = new Map(loadHistory().map((e) => [e.runId, e]));
    expect(byRun.get(a)?.diagnosisInput?.completedProcedureIds).toEqual(["drone-registration"]);
    expect(byRun.get(b)?.diagnosisInput?.completedProcedureIds).toBeUndefined();
  });
});

describe("history.ts — Sprint 6 形式の履歴の互換（Sprint 7）", () => {
  let storage: MemoryStorage;
  beforeEach(() => {
    storage = new MemoryStorage();
    vi.stubGlobal("window", {
      localStorage: storage,
      dispatchEvent: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
  });

  // Sprint 6 時点の soraban:history:v1 の実例に近い形（旧エンジン版・旧規制 ID・未知の値を含む）。
  const sprint6Raw = [
    {
      runId: "run_legacy_1",
      evidenceId: "ev_aaaabbbbccccdddd",
      savedAt: "2026-10-18T09:00:00.000Z",
      loc: { lat: 35.4925, lng: 133.2364 },
      ctx: { droneWeightG: 900, pilotPermits: ["facility_manager_and_pref_pubsafety"] },
      overall: "red",
      resolvedAddress: "鳥取県境港市佐斐神町",
      engineVersion: "soraban-0.2.0-clausegraph",
      checkedAt: "2026-10-18T09:00:00.000Z",
      muniCode: "31204",
      diagnosisInput: {
        methodFlags: ["method_night", "method_unknown_future"],
        airspaceFlags: ["airspace_airport"],
        plannedDate: "2026-11-20",
        accessMode: "yes",
        bvlosObserver: "",
        manualChoice: "standard",
        completedProcedureIds: ["miho-airbase-no-fly", "drone-registration", 42],
      },
      diagnosisSummary: {
        diagnosisEvidenceId: "ev_1234123412341234",
        category: "II_A",
        isSpecificFlight: true,
        procedureCount: 5,
        didStatus: "unverified",
      },
    },
    // さらに古い形式（runId・diagnosisInput なし）
    {
      evidenceId: "ev_0000111122223333",
      savedAt: "2026-06-01T00:00:00.000Z",
      loc: { lat: 35.4278, lng: 133.3314 },
      overall: "unknown",
      engineVersion: "soraban-0.1.0",
      checkedAt: "2026-06-01T00:00:00.000Z",
    },
  ];

  it("旧形式（Sprint 6 の soraban:history:v1、旧規制 ID を含む）が読み込め、復元時に例外が出ない", () => {
    storage.setItem("soraban:history:v1", JSON.stringify(sprint6Raw));
    const loaded = loadHistory();
    expect(loaded).toHaveLength(2);
    for (const e of loaded) {
      expect(() => buildRestorePlan(e)).not.toThrow();
    }
    const plan = buildRestorePlan(loaded[0]!);
    expect(plan.methodFlags).toEqual(["method_night"]);
    expect(plan.userAirspaceFlags).toEqual(["airspace_airport"]);
    expect(plan.completedProcedureIds).toEqual(["small-drone-law", "drone-registration"]);
    expect(plan.manualChoice).toBe("standard");
    expect(plan.ctx?.droneWeightG).toBe(900);
    const old = buildRestorePlan(loaded[1]!);
    expect(old.methodFlags).toEqual([]);
    expect(old.ctx).toBeUndefined();
    expect(old.accessMode).toBe("");
  });

  it("旧形式のエントリに Sprint 7 の判定を追記しても壊れない", () => {
    storage.setItem("soraban:history:v1", JSON.stringify(sprint6Raw));
    recordHistoryDiagnosis("run_legacy_1", {
      diagnosisSummary: {
        diagnosisEvidenceId: "ev_new",
        category: "I",
        isSpecificFlight: false,
        procedureCount: 1,
        didStatus: "not_applicable",
        didDetail: "industrial_exclusive",
      },
    });
    const e = loadHistory().find((x) => x.runId === "run_legacy_1");
    expect(e?.diagnosisSummary?.didDetail).toBe("industrial_exclusive");
    expect(e?.engineVersion).toBe("soraban-0.2.0-clausegraph");
  });
});

// Sprint 11d 契約 14・C5：旧形式（verdict なし、0.3.0／0.2.0）は旧版の判定であることが分かる表示。
describe("historyVerdictDisplay（Sprint 11d）", () => {
  const base = {
    evidenceId: "ev_x",
    savedAt: "2026-10-20T00:00:00.000Z",
    loc: { lat: 35.4, lng: 133.3 },
    checkedAt: "2026-10-20T00:00:00.000Z",
  };
  it("旧形式は旧版の値を明示する（飛べると読める語を出さない）", () => {
    const g = historyVerdictDisplay({ ...base, overall: "green", engineVersion: "soraban-0.3.0-regulations-2026-07" });
    expect(g).toEqual({ label: "適用外（旧版の判定）", legacy: true });
    const r = historyVerdictDisplay({ ...base, overall: "red", engineVersion: "soraban-0.2.0-clausegraph" });
    expect(r.legacy).toBe(true);
    expect(r.label).toContain("旧版の判定");
    const bad = historyVerdictDisplay({ ...base, overall: "bogus" as never, engineVersion: "x" });
    expect(bad.label).toBe("判定不能（旧版の判定）");
  });
  it("新形式は診断の判定（4 段の言葉と判定不能の件数）を出す", () => {
    const v = historyVerdictDisplay({
      ...base,
      overall: "red",
      verdict: "no_procedure",
      engineVersion: "soraban-0.4.0-verdict-2026-10",
      diagnosisSummary: {
        diagnosisEvidenceId: "ev_d",
        category: "I",
        isSpecificFlight: false,
        procedureCount: 1,
        verdict: "procedure_done",
        verdictUnknownCount: 0,
      },
    });
    expect(v).toEqual({ level: "procedure_done", label: "手続き済み（条件付き）", legacy: false, unknownCount: 0 });
  });

  it("地点だけの判定しか無い新形式の項目は判定未確定（手続き不要と出さない。差し戻し 2 回目）", () => {
    const v = historyVerdictDisplay({
      ...base,
      overall: "green",
      verdict: "no_procedure",
      verdictUnknownCount: 0,
      engineVersion: "soraban-0.4.0-verdict-2026-10",
    });
    expect(v.level).toBeUndefined();
    expect(v.label).toContain("判定未確定");
    expect(v.label).not.toContain("手続き不要");
  });

  it("診断の失敗で、その実行の診断の判定を外す（前の判定を残さない）", () => {
    recordHistoryCheck("run_f", {
      ...base,
      evidenceId: "ev_check_f",
      overall: "green",
      verdict: "no_procedure",
      engineVersion: "soraban-0.4.0-verdict-2026-10",
    } as Omit<SavedCheck, "runId">);
    recordHistoryDiagnosis("run_f", {
      diagnosisSummary: {
        diagnosisEvidenceId: "ev_d_f",
        category: "I",
        isSpecificFlight: false,
        procedureCount: 1,
        verdict: "no_procedure",
        verdictUnknownCount: 0,
      },
    });
    markHistoryDiagnosisFailed("run_f");
    const e = loadHistory().find((x) => x.runId === "run_f")!;
    expect(e.diagnosisSummary?.verdict).toBeUndefined();
    expect(historyVerdictDisplay(e).label).toContain("判定未確定");
  });

  it("診断の判定（飛行の方法を含む）を地点だけの判定より優先し、地点判定が後から届いても上書きしない（PR #23 P1）", () => {
    recordHistoryDiagnosis("run_d", {
      diagnosisSummary: {
        diagnosisEvidenceId: "ev_diag",
        category: "II_B_eligible",
        isSpecificFlight: true,
        procedureCount: 3,
        verdict: "needs_procedure",
        verdictUnknownCount: 0,
      },
    });
    recordHistoryCheck("run_d", {
      ...base,
      evidenceId: "ev_check_d",
      overall: "green",
      verdict: "no_procedure",
      verdictUnknownCount: 0,
      engineVersion: "soraban-0.4.0-verdict-2026-10",
    } as Omit<SavedCheck, "runId">);
    const e = loadHistory().find((x) => x.runId === "run_d")!;
    expect(historyVerdictDisplay(e)).toMatchObject({ level: "needs_procedure", label: "要手続き" });
    recordHistoryDiagnosis("run_d", {
      diagnosisSummary: { ...e.diagnosisSummary!, verdict: "no_procedure" },
    });
    const e2 = loadHistory().find((x) => x.runId === "run_d")!;
    expect(historyVerdictDisplay(e2).level).toBe("no_procedure");
  });


  it("Sprint 11f B1：診断の開始で判定が外れ（確定分と保留分）、判定中として渡した行は「判定中」、渡さない行は「判定未確定」。手続き不要は出ない", () => {
    const summary = {
      diagnosisEvidenceId: "ev_d_p",
      category: "I" as const,
      isSpecificFlight: false,
      procedureCount: 1,
      didStatus: "not_applicable" as const,
      verdict: "no_procedure" as const,
      verdictUnknownCount: 0,
    };
    // 確定分（地点判定が届いている実行）
    recordHistoryCheck("run_p", {
      ...base,
      evidenceId: "ev_check_p",
      overall: "green",
      verdict: "no_procedure",
      engineVersion: "soraban-0.4.0-verdict-2026-10",
    } as Omit<SavedCheck, "runId">);
    recordHistoryDiagnosis("run_p", { diagnosisSummary: summary });
    // 保留分（診断が先に届いた実行）
    recordHistoryDiagnosis("run_q", { diagnosisSummary: { ...summary, diagnosisEvidenceId: "ev_d_q" } });

    clearHistoryDiagnosisVerdict("run_p");
    clearHistoryDiagnosisVerdict("run_q");
    const e = loadHistory().find((x) => x.runId === "run_p")!;
    expect(e.diagnosisSummary?.verdict).toBeUndefined();
    expect(e.diagnosisSummary?.verdictUnknownCount).toBeUndefined();
    expect(e.diagnosisSummary?.category).toBe("I"); // 前の値は消さない（表示だけ止める）
    const pending = historyVerdictDisplay(e, { pending: true });
    expect(pending).toMatchObject({ label: "判定中", pending: true });
    expect(pending.level).toBeUndefined();
    const reopened = historyVerdictDisplay(e);
    expect(reopened.label).toContain("判定未確定");
    expect(reopened.pending).toBeUndefined();
    for (const l of [pending.label, reopened.label]) expect(l).not.toContain("手続き不要");
    // 判定中の印は保存されない
    expect(JSON.stringify(loadHistory())).not.toContain("判定中");

    // 保留分も外れていて、地点判定が後から届いても判定は戻らない
    recordHistoryCheck("run_q", {
      ...base,
      evidenceId: "ev_check_q",
      overall: "green",
      verdict: "no_procedure",
      engineVersion: "soraban-0.4.0-verdict-2026-10",
    } as Omit<SavedCheck, "runId">);
    const q = loadHistory().find((x) => x.runId === "run_q")!;
    expect(historyVerdictDisplay(q).label).toContain("判定未確定");
    expect(historyVerdictDisplay(q, { pending: true }).label).toBe("判定中");

    // 成功を書くと診断の判定、失敗の後は判定未確定
    recordHistoryDiagnosis("run_p", { diagnosisSummary: { ...summary, verdict: "needs_procedure" } });
    expect(historyVerdictDisplay(loadHistory().find((x) => x.runId === "run_p")!)).toMatchObject({
      level: "needs_procedure",
    });
    markHistoryDiagnosisFailed("run_p");
    expect(historyVerdictDisplay(loadHistory().find((x) => x.runId === "run_p")!).label).toContain("判定未確定");
  });
  it("Sprint 11f：判定未確定・判定中の行は前の診断の値を出さず、成功で戻り、旧形式は今のまま", () => {
    const summary = {
      diagnosisEvidenceId: "ev_d_r",
      category: "I" as const,
      isSpecificFlight: false,
      procedureCount: 1,
      didStatus: "not_applicable" as const,
      verdict: "no_procedure" as const,
      verdictUnknownCount: 0,
    };
    recordHistoryCheck("run_r", {
      ...base,
      evidenceId: "ev_check_r",
      overall: "green",
      verdict: "no_procedure",
      engineVersion: "soraban-0.4.0-verdict-2026-10",
    } as Omit<SavedCheck, "runId">);
    recordHistoryDiagnosis("run_r", { diagnosisSummary: summary });
    expect(historyDiagnosisDetail(loadHistory().find((x) => x.runId === "run_r")!)?.procedureCount).toBe(1);
    markHistoryDiagnosisFailed("run_r");
    const failed = loadHistory().find((x) => x.runId === "run_r")!;
    expect(historyDiagnosisDetail(failed)).toBeUndefined();
    expect(historyDiagnosisDetail(failed, { pending: true })).toBeUndefined();
    recordHistoryDiagnosis("run_r", { diagnosisSummary: { ...summary, procedureCount: 2, verdict: "needs_procedure" } });
    expect(historyDiagnosisDetail(loadHistory().find((x) => x.runId === "run_r")!)).toMatchObject({
      procedureCount: 2,
      category: "I",
    });
    // 旧形式（verdict なし）は今のまま
    const legacy = { ...base, overall: "green", engineVersion: "soraban-0.3.0-regulations-2026-07", diagnosisSummary: summary } as SavedCheck;
    const { verdict: _v, ...legacyNoVerdict } = legacy;
    void _v;
    const legacyEntry = { ...legacyNoVerdict, diagnosisSummary: { ...summary, verdict: undefined } } as SavedCheck;
    expect(historyDiagnosisDetail(legacyEntry)?.procedureCount).toBe(1);
  });
});
