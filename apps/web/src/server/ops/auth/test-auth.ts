// テスト用の本人確認（AUTH_PROVIDER=test。CI・E2E・ローカル専用。Sprint 10 設計 A）。
// POST /api/test-auth/sign-in で AUTH_TEST_SECRET により HMAC-SHA256 で署名した Cookie を発行し、
// getCurrentIdentity はその署名を検証して Identity を返す。Vercel 上（VERCEL_ENV が設定されている環境）では使えない。
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Identity } from "./identity";

export const TEST_AUTH_COOKIE = "soraban_test_auth";
/** Cookie の有効期間（秒）。 */
export const TEST_AUTH_MAX_AGE = 8 * 60 * 60;

type Payload = {
  readonly sub: string;
  readonly email: string;
  readonly ev: boolean;
  readonly name: string | null;
  readonly iat: number;
};

const b64url = (b: Buffer): string => b.toString("base64url");
const mac = (body: string, secret: string): string => b64url(createHmac("sha256", secret).update(body).digest());

export type TestSignInInput = {
  readonly authUserId: string;
  readonly email: string;
  readonly emailVerified: boolean;
  readonly name: string | null;
};

export const signTestAuthCookie = (input: TestSignInInput, secret: string, nowSec = Math.floor(Date.now() / 1000)): string => {
  const payload: Payload = {
    sub: input.authUserId,
    email: input.email.trim().toLowerCase(),
    ev: input.emailVerified,
    name: input.name,
    iat: nowSec,
  };
  const body = b64url(Buffer.from(JSON.stringify(payload), "utf8"));
  return `${body}.${mac(body, secret)}`;
};

/** 署名を検証して Identity を返す。改ざん・期限切れ・形式不正は null。 */
export const verifyTestAuthCookie = (
  value: string | undefined,
  secret: string,
  nowSec = Math.floor(Date.now() / 1000),
): Identity | null => {
  if (!value || !secret) return null;
  const dot = value.indexOf(".");
  if (dot <= 0 || dot !== value.lastIndexOf(".")) return null;
  const body = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  const expected = mac(body, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<Payload>;
    if (typeof p.sub !== "string" || p.sub === "" || typeof p.email !== "string" || typeof p.iat !== "number") return null;
    if (nowSec - p.iat > TEST_AUTH_MAX_AGE || p.iat - nowSec > 60) return null;
    return {
      provider: "test",
      authUserId: p.sub,
      email: p.email,
      emailVerified: p.ev === true,
      name: typeof p.name === "string" ? p.name : null,
    };
  } catch {
    return null;
  }
};

/** sign-in の本文を検査する。 */
export const parseTestSignIn = (body: unknown): TestSignInInput | null => {
  if (!body || typeof body !== "object") return null;
  const o = body as Record<string, unknown>;
  const authUserId = o["authUserId"];
  const email = o["email"];
  if (typeof authUserId !== "string" || authUserId.trim() === "" || authUserId.length > 200) return null;
  if (typeof email !== "string" || !/^[^@\s]+@[^@\s]+$/.test(email.trim())) return null;
  const name = o["name"];
  return {
    authUserId: authUserId.trim(),
    email: email.trim(),
    emailVerified: o["emailVerified"] === true,
    name: typeof name === "string" && name.trim() !== "" ? name.trim().slice(0, 100) : null,
  };
};
