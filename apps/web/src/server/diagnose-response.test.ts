// Sprint 18-1 A16：/api/diagnose の応答から prefill を取り除くのは、ルートの層（server/diagnose-response.ts）だけ。
// handleDiagnosePost の応答は変えない（diagnose-core.test.ts の基準が守る）。
import { describe, expect, it } from "vitest";
import { runRegulationCheckWith } from "./check-core";
import { applyApplicationSupportFlag, stripPrefillFromResponse } from "./diagnose-response";
import { handleDiagnosePost } from "./handlers";
import { BASELINE_LOCATIONS, BASELINE_NOW, baselineProvider } from "./sprint11e-baseline";

const yonago = BASELINE_LOCATIONS.find((l) => l.name === "米子市役所")!;

const original = async (): Promise<Response> =>
  handleDiagnosePost(
    new Request("http://x/api/diagnose", {
      method: "POST",
      body: JSON.stringify({ ...yonago.loc, droneWeightG: 900, flags: ["method_night"], plannedDate: "2027-01-14" }),
    }),
    (loc, ctx) => runRegulationCheckWith(baselineProvider("31202"), loc, ctx, BASELINE_NOW),
  );

describe("applyApplicationSupportFlag（A16）", () => {
  it("無効（未設定）：prefill が無く、他の項目は同一。状態コード・ヘッダーは保つ", async () => {
    const before = (await (await original()).json()) as Record<string, unknown>;
    expect(Array.isArray(before["prefill"]) && (before["prefill"] as unknown[]).length > 0).toBe(true);
    const res = await applyApplicationSupportFlag(await original(), {});
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const after = (await res.json()) as Record<string, unknown>;
    expect("prefill" in after).toBe(false);
    expect(after["verdict"]).toBeDefined();
    expect(after["procedures"]).toBeDefined();
    expect(after["evidenceId"]).toBe(before["evidenceId"]);
    const { prefill: _p, ...rest } = before;
    void _p;
    expect(after).toEqual(rest);
  });

  it("有効：応答は無変更（prefill が残る）", async () => {
    const before = await (await original()).text();
    const res = await applyApplicationSupportFlag(await original(), { APPLICATION_SUPPORT_ENABLED: "1" });
    expect(await res.text()).toBe(before);
  });

  it("有効でも本番のデプロイ（VERCEL_ENV=production）は取り除く", async () => {
    const res = await applyApplicationSupportFlag(await original(), {
      APPLICATION_SUPPORT_ENABLED: "1",
      VERCEL_ENV: "production",
    });
    expect("prefill" in ((await res.json()) as object)).toBe(false);
  });

  it("失敗の応答（400）はそのまま返す", async () => {
    const bad = await handleDiagnosePost(
      new Request("http://x/api/diagnose", { method: "POST", body: "{" }),
      (loc, ctx) => runRegulationCheckWith(baselineProvider("31202"), loc, ctx, BASELINE_NOW),
    );
    const res = await stripPrefillFromResponse(bad);
    expect(res.status).toBe(400);
  });
});
