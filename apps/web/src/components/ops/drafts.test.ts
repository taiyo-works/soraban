// Sprint 11 差し戻し 1：下書きは利用者ごとに分け、他の利用者の下書きは読まない・消す。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearOpsDrafts, clearOtherUsersDrafts, draftKey, loadDraft, saveDraft } from "./drafts";

const memoryStorage = () => {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
  };
};

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  vi.stubGlobal("window", { localStorage: memoryStorage() });
});
afterEach(() => vi.unstubAllGlobals());

describe("下書き（利用者ごと）", () => {
  it("キーは種類と利用者の内部 ID を含み、利用者ごとに別", () => {
    expect(draftKey("flight", A)).toBe(`soraban:ops-draft:flight:${A}`);
    expect(draftKey("flight", A)).not.toBe(draftKey("flight", B));
    saveDraft(draftKey("flight", A), { purpose: "A の目的", clientRequestId: "x" });
    expect(loadDraft(draftKey("flight", B))).toBeNull();
    expect(loadDraft<{ purpose: string }>(draftKey("flight", A))?.purpose).toBe("A の目的");
  });

  it("別の利用者の画面を開くと、前の利用者の下書きと旧形式（利用者を区別しない）の下書きを消し、自分の分は残す", () => {
    saveDraft(draftKey("flight", A), { purpose: "A" });
    saveDraft(draftKey("inspection", A), { placeName: "A" });
    saveDraft(draftKey("flight", B), { purpose: "B" });
    saveDraft("soraban:ops-draft:flight", { purpose: "旧形式" });
    window.localStorage.setItem("soraban:ops-change-notice", "{}");
    clearOtherUsersDrafts(B);
    expect(loadDraft(draftKey("flight", A))).toBeNull();
    expect(loadDraft(draftKey("inspection", A))).toBeNull();
    expect(loadDraft("soraban:ops-draft:flight")).toBeNull();
    expect(loadDraft(draftKey("flight", B))).toEqual({ purpose: "B" });
    expect(window.localStorage.getItem("soraban:ops-change-notice")).toBe("{}");
  });

  it("ログアウトではすべての利用者の下書きを消す", () => {
    saveDraft(draftKey("flight", A), {});
    saveDraft(draftKey("inspection", B), {});
    clearOpsDrafts();
    expect(window.localStorage.length).toBe(0);
  });
});
