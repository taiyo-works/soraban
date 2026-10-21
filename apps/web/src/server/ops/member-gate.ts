// 運航管理が有効で、ログイン済みの利用者かを調べる（画面を止めない版）。Sprint 12c：下メニューと `/` の「今日」の帯が使う。
// 無効（OPS_ENABLED でない）・設定不足・未ログイン・利用者でないときは null を返し、何も描かせない（追加の通信もしない）。
// requireOpsMember（page.ts）は同じ判定を 404・転送で止める版。ここは止めない。1 回の描画の間は結果を使い回す。
import { cache } from "react";
import { connection } from "next/server";
import { getPool } from "@soraban/db";
import { getCurrentIdentity } from "./auth/current";
import { getOpsAvailability, opsNow } from "./availability";
import { resolveMember, type OpsContext } from "./service";
import type { OpsDb } from "./store";

export const getSignedInMember = cache(async (): Promise<OpsContext | null> => {
  await connection();
  if (getOpsAvailability(process.env).state !== "enabled") return null;
  try {
    const identity = await getCurrentIdentity(process.env);
    if (!identity) return null;
    const db = getPool(process.env) as unknown as OpsDb | null;
    if (!db) return null;
    const r = await resolveMember(db, identity);
    if (r.kind !== "member") return null;
    return { db, member: r.member, now: () => opsNow(process.env) };
  } catch {
    return null;
  }
});
