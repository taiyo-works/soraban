import Link from "next/link";
import { connection } from "next/server";
import { getPool } from "@soraban/db";
import { getCurrentIdentity } from "@/server/ops/auth/current";
import { getOpsAvailability } from "@/server/ops/availability";
import { resolveMember } from "@/server/ops/service";
import type { OpsDb } from "@/server/ops/store";
import { OpsEntryFlag } from "./ops-entry-flag";

// `/` の「運航管理」への入口（Sprint 12a 設計 J）。Suspense の内側で描く動的な部分で、`/` の静的なシェルは変えない。
// 運航管理が無効（OPS_ENABLED でない）・設定不足・未ログイン・利用者でないときは何も描かない（追加の通信もない）。
// 有効でログイン済みの利用者にだけ、リンクと、判定結果のボタンを出してよいという印（OpsEntryFlag）を描く。
export async function OpsHomeEntry() {
  await connection();
  if (getOpsAvailability(process.env).state !== "enabled") return null;
  try {
    const identity = await getCurrentIdentity(process.env);
    if (!identity) return null;
    const db = getPool(process.env) as unknown as OpsDb | null;
    if (!db) return null;
    const r = await resolveMember(db, identity);
    if (r.kind !== "member") return null;
  } catch {
    return null;
  }
  return (
    <>
      <OpsEntryFlag />
      <p className="text-sm">
        <Link
          href="/ops"
          prefetch={false}
          data-testid="home-ops-link"
          className="inline-flex min-h-11 items-center gap-2 rounded-sharp border border-brand-700 bg-paper px-4 font-medium text-brand-700 transition-colors hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
        >
          運航管理へ
          <span aria-hidden>→</span>
        </Link>
      </p>
    </>
  );
}
