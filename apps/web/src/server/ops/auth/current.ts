// 認証の境界（Sprint 10 設計 A）。アプリの他の部分は getCurrentIdentity() だけを使う。
// 実装（neon／test）は AUTH_PROVIDER で切り替え、可否は getOpsAvailability の 1 か所で決める。
import { cookies } from "next/headers";
import { getOpsAvailability, type OpsEnv } from "../availability";
import type { Identity } from "./identity";
import { getNeonAuth, identityFromNeonSession } from "./neon";
import { TEST_AUTH_COOKIE, verifyTestAuthCookie } from "./test-auth";

export type { Identity } from "./identity";

export const getCurrentIdentity = async (env: OpsEnv = process.env): Promise<Identity | null> => {
  const a = getOpsAvailability(env);
  if (a.state !== "enabled") return null;
  if (a.provider === "test") {
    const store = await cookies();
    return verifyTestAuthCookie(store.get(TEST_AUTH_COOKIE)?.value, env["AUTH_TEST_SECRET"]?.trim() ?? "");
  }
  const auth = await getNeonAuth(env);
  return identityFromNeonSession(() => auth.getSession());
};
