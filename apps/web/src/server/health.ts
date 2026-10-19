// GET /api/health/db の処理本体（Sprint 8）。route.ts とテストから呼ぶ。
import { NextResponse } from "next/server";
import { checkDbHealth, type DbEnv } from "@soraban/db";

export const handleHealthDbGet = async (env: DbEnv = process.env): Promise<Response> => {
  const health = await checkDbHealth(env);
  return NextResponse.json(health, { status: 200, headers: { "cache-control": "no-store" } });
};
