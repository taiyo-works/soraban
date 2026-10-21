// GET /api/health/db の処理本体（Sprint 8）。route.ts とテストから呼ぶ。
// Sprint 12b：通報ゲートウェイの設定（DIPS_REPORT_ADAPTER）が誤りなら 503 と理由コードを返す
// （api・未知の値・本番/プレビューでの mock。値は返さない）。設定が正しければ従来どおり 200。
import { NextResponse } from "next/server";
import { checkDbHealth, type DbEnv } from "@soraban/db";
import { resolveDipsAdapterConfig } from "@soraban/dips";

export const handleHealthDbGet = async (env: DbEnv = process.env): Promise<Response> => {
  const health = await checkDbHealth(env);
  const dips = resolveDipsAdapterConfig(env);
  if (!dips.ok) {
    return NextResponse.json(
      { ...health, dips: { ok: false, error: "adapter_unavailable", reason: dips.reason } },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
  return NextResponse.json(health, { status: 200, headers: { "cache-control": "no-store" } });
};
