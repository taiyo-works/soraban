import { notFound } from "next/navigation";
import { FieldModeMark } from "@/components/ops/field-mode-mark";
import { DraftOwnerGuard } from "@/components/ops/ops-client";
import { IncidentQuickClient } from "@/components/ops/incident-quick-client";
import { can } from "@/server/ops/authz";
import { requireOpsMember } from "@/server/ops/page";
import { getPlan } from "@/server/ops/plans";
import { OpsError } from "@/server/ops/service";

// 現場の簡易記録（事故・ヒヤリハット。Sprint 12e 設計 F）。現場モードの帯から移る。下メニューは出さない（ops-nav が経路で判断する）。
// 区分とけがの有無を選んで「記録する」だけで、端末の送信待ちを経て自分のサーバーへ送る。詳細はあとで記入する。
export default async function PlanFieldIncidentPage({ params }: { readonly params: Promise<{ id: string }> }) {
  const { ctx, me } = await requireOpsMember();
  const { id } = await params;
  let plan;
  try {
    plan = await getPlan(ctx, id);
  } catch (e) {
    if (e instanceof OpsError && e.status === 404) notFound();
    throw e;
  }
  return (
    <>
      <FieldModeMark />
      <DraftOwnerGuard memberId={me.member.id} />
      <IncidentQuickClient planId={plan.id} planTitle={plan.title} memberId={me.member.id} canCreate={can(me.member.role, "incident.create")} />
    </>
  );
}
