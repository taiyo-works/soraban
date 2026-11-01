import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BOUNDARY_SHORT, isApplicationSupportEnabled } from "./boundary";

describe("isApplicationSupportEnabled（Sprint 18-1 §4.1）", () => {
  it("未設定は偽（既定）", () => {
    expect(isApplicationSupportEnabled({})).toBe(false);
  });
  it('"0"・空・"true" など "1" 以外は偽', () => {
    for (const v of ["", "0", "true", "yes", "11", " 1"]) {
      expect(isApplicationSupportEnabled({ APPLICATION_SUPPORT_ENABLED: v }), JSON.stringify(v)).toBe(false);
    }
  });
  it('"1" は真（VERCEL_ENV が空・preview・development のとき）', () => {
    expect(isApplicationSupportEnabled({ APPLICATION_SUPPORT_ENABLED: "1" })).toBe(true);
    expect(isApplicationSupportEnabled({ APPLICATION_SUPPORT_ENABLED: "1", VERCEL_ENV: "preview" })).toBe(true);
    expect(isApplicationSupportEnabled({ APPLICATION_SUPPORT_ENABLED: "1", VERCEL_ENV: "development" })).toBe(true);
  });
  it('本番のデプロイ（VERCEL_ENV=production）は "1" でも偽', () => {
    expect(isApplicationSupportEnabled({ APPLICATION_SUPPORT_ENABLED: "1", VERCEL_ENV: "production" })).toBe(false);
  });
  it('Vercel の環境（VERCEL が設定されている）は、production・preview・development のどれでも "1" で偽', () => {
    for (const v of ["production", "preview", "development", ""]) {
      expect(isApplicationSupportEnabled({ APPLICATION_SUPPORT_ENABLED: "1", VERCEL: "1", VERCEL_ENV: v }), v).toBe(false);
    }
    expect(isApplicationSupportEnabled({ APPLICATION_SUPPORT_ENABLED: "1", VERCEL: "1" })).toBe(false);
  });
  it("引数を省くと process.env を読む", () => {
    const before = process.env["APPLICATION_SUPPORT_ENABLED"];
    try {
      delete process.env["APPLICATION_SUPPORT_ENABLED"];
      expect(isApplicationSupportEnabled()).toBe(false);
    } finally {
      if (before !== undefined) process.env["APPLICATION_SUPPORT_ENABLED"] = before;
    }
  });
});

describe("境界の文", () => {
  it("「代行」「代理」を使わない", () => {
    expect(BOUNDARY_SHORT).not.toMatch(/代行|代理/);
  });
});

describe("app/page.tsx のフラグの読み方（1-7）", () => {
  it("isApplicationSupportEnabled を 1 回だけ呼ぶ", () => {
    const src = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
    expect(src.match(/isApplicationSupportEnabled\(/g)?.length ?? 0).toBe(1);
  });
});
