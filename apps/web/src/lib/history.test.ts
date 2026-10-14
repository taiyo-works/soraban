import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearHistory,
  getHistorySnapshot,
  loadHistory,
  patchHistoryDiagnosis,
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
