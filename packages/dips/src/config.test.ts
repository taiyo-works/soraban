// Sprint 12b 契約 14：設定（DIPS_REPORT_ADAPTER）。
import { describe, expect, it } from "vitest";
import { DIPS_CONFIG_ERROR_MESSAGE, resolveDipsAdapterConfig } from "./config";

describe("DIPS_REPORT_ADAPTER", () => {
  it("未設定・空は manual", () => {
    expect(resolveDipsAdapterConfig({})).toEqual({ ok: true, adapter: "manual" });
    expect(resolveDipsAdapterConfig({ DIPS_REPORT_ADAPTER: "" })).toEqual({ ok: true, adapter: "manual" });
    expect(resolveDipsAdapterConfig({ DIPS_REPORT_ADAPTER: "  " })).toEqual({ ok: true, adapter: "manual" });
    expect(resolveDipsAdapterConfig(undefined)).toEqual({ ok: true, adapter: "manual" });
    expect(resolveDipsAdapterConfig({ DIPS_REPORT_ADAPTER: "manual" })).toEqual({ ok: true, adapter: "manual" });
  });

  it("mock は Vercel 以外で使える（next start で NODE_ENV が production でも拒否しない）", () => {
    expect(resolveDipsAdapterConfig({ DIPS_REPORT_ADAPTER: "mock" })).toEqual({ ok: true, adapter: "mock" });
    expect(resolveDipsAdapterConfig({ DIPS_REPORT_ADAPTER: "mock", NODE_ENV: "production" })).toEqual({ ok: true, adapter: "mock" });
    expect(resolveDipsAdapterConfig({ DIPS_REPORT_ADAPTER: "mock", VERCEL_ENV: "development" })).toEqual({ ok: true, adapter: "mock" });
    expect(resolveDipsAdapterConfig({ DIPS_REPORT_ADAPTER: "mock", VERCEL_ENV: "" })).toEqual({ ok: true, adapter: "mock" });
  });

  it("mock は VERCEL_ENV が production・preview のとき拒否される", () => {
    for (const v of ["production", "preview", "Production", " preview "]) {
      expect(resolveDipsAdapterConfig({ DIPS_REPORT_ADAPTER: "mock", VERCEL_ENV: v }), v).toEqual({
        ok: false,
        reason: "mock_forbidden_on_vercel",
      });
    }
  });

  it("api と未知の値は設定の誤りで、manual に自動で落とさない", () => {
    expect(resolveDipsAdapterConfig({ DIPS_REPORT_ADAPTER: "api" })).toEqual({ ok: false, reason: "api_not_implemented" });
    expect(resolveDipsAdapterConfig({ DIPS_REPORT_ADAPTER: "API" })).toEqual({ ok: false, reason: "api_not_implemented" });
    for (const v of ["relay", "mock2", "true", "1", "manual,mock"]) {
      expect(resolveDipsAdapterConfig({ DIPS_REPORT_ADAPTER: v }), v).toEqual({ ok: false, reason: "unknown_adapter" });
    }
    // 本番でも api は同じ誤り（手動に落とさない）
    expect(resolveDipsAdapterConfig({ DIPS_REPORT_ADAPTER: "api", VERCEL_ENV: "production" }).ok).toBe(false);
  });

  it("誤りの説明は理由コードごとにあり、値を含まない", () => {
    for (const m of Object.values(DIPS_CONFIG_ERROR_MESSAGE)) expect(m.length).toBeGreaterThan(5);
  });
});
