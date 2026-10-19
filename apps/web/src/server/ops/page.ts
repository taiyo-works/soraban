// 運航管理の画面（サーバーコンポーネント）の冒頭で呼ぶ共通処理（Sprint 10 設計 A）。
// 認可は proxy.ts ではなくここ（と API の opsHandler）で行う。test 実装でも同じ経路を通る。
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { getPool } from "@soraban/db";
import { getCurrentIdentity } from "./auth/current";
import { getOpsAvailability, type AuthProviderName } from "./availability";
import { getMe, resolveMember, type MeDto, type OpsContext } from "./service";
import type { OpsDb } from "./store";

export type OpsPageSession = {
  readonly ctx: OpsContext;
  readonly me: MeDto;
  readonly provider: AuthProviderName;
};

/** 利用者機能が有効なら認証の方式を返す。無効・設定不足なら 404（proxy.ts が先に 404・503 を返す）。 */
export const requireOpsEnabled = async (): Promise<AuthProviderName> => {
  await connection();
  const a = getOpsAvailability(process.env);
  if (a.state !== "enabled") notFound();
  return a.provider;
};

/** ログイン中の利用者を返す。未ログインはサインイン画面へ、利用者でなければ権限なしの画面へ移す。 */
export const requireOpsMember = async (): Promise<OpsPageSession> => {
  const provider = await requireOpsEnabled();
  const identity = await getCurrentIdentity(process.env);
  if (!identity) redirect("/ops/sign-in");
  const db = getPool(process.env) as unknown as OpsDb | null;
  if (!db) notFound();
  const r = await resolveMember(db, identity);
  if (r.kind !== "member") redirect("/ops/no-access");
  const ctx: OpsContext = { db, member: r.member };
  return { ctx, me: await getMe(ctx), provider };
};

export const ROLE_LABELS = { manager: "運航管理者", pilot: "操縦者", viewer: "閲覧者" } as const;
export const MEMBER_STATUS_LABELS = { invited: "招待中", active: "有効", disabled: "停止" } as const;
export const AIRCRAFT_STATUS_LABELS = { active: "使用中", suspended: "休止", deregistered: "抹消" } as const;
export const CERT_CLASS_LABELS = { first: "第一種", second: "第二種" } as const;
export const LICENSE_CLASS_LABELS = { first: "一等", second: "二等" } as const;
export const OP_LABELS = { create: "登録", update: "訂正", void: "取消" } as const;

/** 分を「時間:分」にする（例：90 → 1:30）。 */
export const formatMinutes = (m: number): string => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
