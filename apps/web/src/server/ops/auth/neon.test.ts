// Sprint 10 契約 4：neon の実装（SDK を模擬）。
import { afterEach, describe, expect, it, vi } from "vitest";
import { identityFromNeonSession } from "./neon";

afterEach(() => vi.restoreAllMocks());

describe("identityFromNeonSession", () => {
  it("セッションありで Identity の各項目が写される（メールアドレスは小文字）", async () => {
    const id = await identityFromNeonSession(async () => ({
      data: {
        user: { id: "u_123", email: "Taro.Yamada@Example.COM", emailVerified: true, name: "山田 太郎", image: "https://x/y.png" },
        session: { id: "s1" },
      },
      error: null,
    }));
    expect(id).toEqual({
      provider: "neon",
      authUserId: "u_123",
      email: "taro.yamada@example.com",
      emailVerified: true,
      name: "山田 太郎",
    });
  });

  it("emailVerified が true でなければ false、名前が空なら null", async () => {
    const id = await identityFromNeonSession(async () => ({ data: { user: { id: "u", email: "a@b.c", name: "" } } }));
    expect(id).toMatchObject({ emailVerified: false, name: null });
  });

  it("セッションなしは null", async () => {
    expect(await identityFromNeonSession(async () => ({ data: null, error: null }))).toBeNull();
    expect(await identityFromNeonSession(async () => null)).toBeNull();
    expect(await identityFromNeonSession(async () => ({ data: { user: { id: "u" } } }))).toBeNull();
  });

  it("SDK の例外は null。ログにメールアドレス・氏名を含めない", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const err = Object.assign(new Error("session fetch failed for taro.yamada@example.com 山田 太郎"), { code: "FETCH_ERROR" });
    expect(await identityFromNeonSession(async () => Promise.reject(err))).toBeNull();
    const logged = spy.mock.calls.flat().join(" ");
    expect(logged).toContain("FETCH_ERROR");
    expect(logged).not.toContain("taro.yamada@example.com");
    expect(logged).not.toContain("山田");
  });
});
