import { notFound } from "next/navigation";
import { requireOpsMember } from "@/server/ops/page";
import { getPlan } from "@/server/ops/plans";
import { OpsError } from "@/server/ops/service";

/** 計画の各画面（通報の主画面・計画・日誌・判定）で共通の読み込み。見つからなければ 404。 */
export async function loadPlan(params: Promise<{ id: string }>) {
  const { ctx, me } = await requireOpsMember();
  const { id } = await params;
  try {
    const plan = await getPlan(ctx, id);
    return { ctx, me, id, plan };
  } catch (e) {
    if (e instanceof OpsError && e.status === 404) notFound();
    throw e;
  }
}
