// 運航管理の API（ルートハンドラ）の共通処理（Sprint 10 設計 A・F）。
// 可否（404／503）→ Origin の確認（変更を伴う要求）→ 本人確認（401）→ 利用者の解決（403）→ 処理、の順。
// route.ts はこのファイルの関数を呼ぶだけにする（単体テストで依存を差し替えられるようにするため）。
import { NextResponse } from "next/server";
import { getPool } from "@soraban/db";
import type { Identity } from "./auth/identity";
import { describeError } from "./auth/identity";
import { getOpsAvailability, opsNow, type OpsEnv } from "./availability";
import { OpsError, resolveMember, type OpsContext } from "./service";
import type { OpsDb } from "./store";

export type OpsDeps = {
  readonly env: OpsEnv;
  readonly getIdentity: () => Promise<Identity | null>;
  readonly getDb: () => OpsDb | null;
};

const defaultDeps = async (): Promise<OpsDeps> => {
  const { getCurrentIdentity } = await import("./auth/current");
  return {
    env: process.env,
    getIdentity: () => getCurrentIdentity(process.env),
    getDb: () => getPool(process.env) as unknown as OpsDb | null,
  };
};

const NO_STORE = { "cache-control": "no-store" } as const;

export const json = (status: number, body: unknown): Response =>
  NextResponse.json(body, { status, headers: NO_STORE });

/** Cookie 認証での CSRF 対策：変更を伴う要求の Origin が自サイトでなければ false。 */
export const isSameOrigin = (req: Request): boolean => {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const origin = req.headers.get("origin");
  if (origin !== null) {
    if (origin === "null" || host === null) return false;
    try {
      return new URL(origin).host === host;
    } catch {
      return false;
    }
  }
  // Origin が無い要求（ブラウザ以外）は、Sec-Fetch-Site が他サイトを示すときだけ拒否する。
  const site = req.headers.get("sec-fetch-site");
  return site === null || site === "same-origin" || site === "none";
};

/** エラーのログ。種別・コード・経路だけを書き、要求本文（メールアドレス・氏名・技能証明書番号）は書かない。 */
export const logOpsError = (route: string, e: unknown): void => {
  console.error(`[ops] ${route} failed: ${describeError(e)}`);
};

const readJson = async (req: Request): Promise<unknown> => {
  const text = await req.text();
  if (text.trim() === "") return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new OpsError(400, "invalid_json");
  }
};

export type OpsHandlerArgs = {
  readonly ctx: OpsContext;
  readonly req: Request;
  readonly params: Readonly<Record<string, string>>;
  readonly body: () => Promise<unknown>;
};

/** 可否の確認だけを行う（404／503）。null なら続行してよい。 */
export const availabilityResponse = (env: OpsEnv): Response | null => {
  const a = getOpsAvailability(env);
  if (a.state === "disabled") return json(404, { error: "not_found" });
  if (a.state === "misconfigured") return json(503, { error: "ops_unavailable", reason: a.reason });
  return null;
};

export const opsHandler =
  (
    route: string,
    fn: (args: OpsHandlerArgs) => Promise<Response>,
    opts: { readonly mutating?: boolean } = {},
  ) =>
  async (req: Request, params: Readonly<Record<string, string>> = {}, deps?: OpsDeps): Promise<Response> => {
    const d = deps ?? (await defaultDeps());
    const unavailable = availabilityResponse(d.env);
    if (unavailable) return unavailable;
    if (opts.mutating && !isSameOrigin(req)) return json(403, { error: "forbidden_origin" });
    try {
      const identity = await d.getIdentity();
      if (!identity) return json(401, { error: "unauthenticated" });
      const db = d.getDb();
      if (!db) return json(503, { error: "ops_unavailable", reason: "database_url_missing" });
      const r = await resolveMember(db, identity);
      if (r.kind !== "member") return json(403, { error: "no_access" });
      return await fn({
        ctx: { db, member: r.member, now: () => opsNow(d.env), env: d.env },
        req,
        params,
        body: () => readJson(req),
      });
    } catch (e) {
      if (e instanceof OpsError) {
        return json(e.status, {
          error: e.code,
          ...(e.fieldErrors ? { fields: e.fieldErrors } : {}),
          ...(e.fieldCodes ? { codes: e.fieldCodes } : {}),
        });
      }
      logOpsError(route, e);
      return json(500, { error: "internal_error" });
    }
  };

/** DELETE は提供しない（物理削除の API は作らない）。 */
export const methodNotAllowed = (allow: string): Response =>
  new Response(JSON.stringify({ error: "method_not_allowed" }), {
    status: 405,
    headers: { "content-type": "application/json", allow, ...NO_STORE },
  });
