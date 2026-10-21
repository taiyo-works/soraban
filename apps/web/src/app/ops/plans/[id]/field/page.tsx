import { notFound } from "next/navigation";
import { DraftOwnerGuard } from "@/components/ops/ops-client";
import { FieldClient } from "@/components/ops/field-client";
import { getFieldView } from "@/server/ops/field";
import { requireOpsMember } from "@/server/ops/page";
import { OpsError } from "@/server/ops/service";

// 現場モード（Sprint 12c 設計 H）。飛行前の確認 → 離陸・着陸 → 日誌を、片手・屋外で行う。下メニューは出さない（layout が現場モードを除く）。
// 状態は行から毎回導出する（GET /api/ops/plans/[id]/field と同じ内容）。押した記録は端末の送信待ちを経て自分のサーバーへ送る。
export default async function PlanFieldPage({ params }: { readonly params: Promise<{ id: string }> }) {
  const { ctx, me } = await requireOpsMember();
  const { id } = await params;
  let view;
  try {
    view = await getFieldView(ctx, id);
  } catch (e) {
    if (e instanceof OpsError && e.status === 404) notFound();
    throw e;
  }
  return (
    <>
      <DraftOwnerGuard memberId={me.member.id} />
      <FieldClient initial={view} memberId={me.member.id} />
    </>
  );
}
