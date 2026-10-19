import { describe, expect, it } from "vitest";
import { mergeCookieHeader } from "./neon-proxy";

describe("mergeCookieHeader", () => {
  it("Set-Cookie の値で上書き・追加し、削除（Max-Age=0）は除く", () => {
    const merged = mergeCookieHeader("a=1; __Secure-neon-auth.session_challenge=c; b=2", [
      "__Secure-neon-auth.session_token=tok; Path=/; HttpOnly; Secure; SameSite=Lax",
      "__Secure-neon-auth.session_challenge=; Path=/; Max-Age=0",
      "b=3; Path=/",
    ]);
    expect(merged.split("; ").sort()).toEqual(["__Secure-neon-auth.session_token=tok", "a=1", "b=3"].sort());
    expect(mergeCookieHeader(null, ["x=1; Expires=Thu, 01 Jan 1970 00:00:00 GMT"])).toBe("");
  });
});
