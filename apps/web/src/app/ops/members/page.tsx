import { MemberControls, MemberInviteForm } from "@/components/ops/ops-client";
import { Forbidden } from "@/components/ops/versions";
import { listMembers } from "@/server/ops/service";
import { MEMBER_STATUS_LABELS, requireOpsMember, ROLE_LABELS } from "@/server/ops/page";

// 利用者の招待・役割の変更・停止・再開（運航管理者のみ）。
export default async function MembersPage() {
  const { ctx, me } = await requireOpsMember();
  if (me.member.role !== "manager") return <Forbidden />;
  const members = await listMembers(ctx);
  return (
    <main className="flex flex-col gap-6">
      <h1 className="text-lg text-ink">利用者</h1>
      <ul className="flex flex-col gap-3" data-testid="member-list">
        {members.map((m) => (
          <li key={m.id} className="flex flex-col gap-2 border border-rule px-3 py-3">
            <p className="flex flex-col text-sm">
              <span className="text-ink">{m.displayName}</span>
              <span className="break-all text-ink-mute">{m.email}</span>
              <span className="text-ink-soft">
                {ROLE_LABELS[m.role]}・{MEMBER_STATUS_LABELS[m.status]}
              </span>
            </p>
            <MemberControls key={m.version} member={m} />
          </li>
        ))}
      </ul>
      <section className="flex flex-col gap-2">
        <h2 className="text-base text-ink">招待</h2>
        <MemberInviteForm />
      </section>
    </main>
  );
}
