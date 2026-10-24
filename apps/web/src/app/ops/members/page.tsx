import { MemberControls, MemberInviteForm } from "@/components/ops/ops-client";
import { Forbidden } from "@/components/ops/versions";
import { ChangeNotice } from "@/components/ops/change-notice";
import {
  Badge,
  MEMBER_INVITE_NOTICE_TARGET,
  MEMBER_STATUS_TONE,
  memberNoticeTarget,
  PageHeader,
  ROLE_DESCRIPTIONS,
  ROLE_TONE,
  Section,
} from "@/components/ops/ui";
import { listMembers } from "@/server/ops/service";
import { MEMBER_STATUS_LABELS, requireOpsMember, ROLE_LABELS } from "@/server/ops/page";
import { BACK_TO } from "@/components/ops/ops-nav-model";

// 利用者の招待・役割の変更・停止・再開（運航管理者のみ）。
export default async function MembersPage() {
  const { ctx, me } = await requireOpsMember();
  if (me.member.role !== "manager") return <Forbidden />;
  const members = await listMembers(ctx);
  return (
    <main className="flex flex-col gap-10">
      <PageHeader title="利用者" back={BACK_TO.register}>
        <p className="text-xs leading-relaxed text-ink-mute">
          {me.org.name}の利用者です。役割の変更と利用の停止は、次にその人が操作したときから反映されます。
        </p>
      </PageHeader>
      <ul className="flex flex-col border-t border-rule" data-testid="member-list">
        {members.map((m) => (
          <li key={m.id} className="flex flex-col gap-2 border-b border-rule py-3">
            <div className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
              <p className="flex min-w-0 flex-col">
                <span className="text-[15px] text-ink">
                  {m.displayName}
                  {m.id === me.member.id ? <span className="ml-2 text-xs text-brand-700">（あなた）</span> : null}
                </span>
                <span className="break-all font-mono text-xs text-ink-mute">{m.email}</span>
              </p>
              <span className="flex shrink-0 flex-wrap items-center gap-1.5">
                <Badge tone={ROLE_TONE[m.role]}>{ROLE_LABELS[m.role]}</Badge>
                <Badge tone={MEMBER_STATUS_TONE[m.status]}>{MEMBER_STATUS_LABELS[m.status]}</Badge>
              </span>
            </div>
            <ChangeNotice target={memberNoticeTarget(m.id)} />
            <details className="group">
              <summary className="inline-flex min-h-11 cursor-pointer select-none items-center text-xs text-brand-700 underline-offset-2 hover:underline">
                <span aria-hidden className="mr-1.5 inline-block transition-transform group-open:rotate-90">›</span>
                役割・利用を変更する
              </summary>
              <div className="mt-2 border-l-2 border-rule pl-3">
                <MemberControls key={m.version} member={m} />
              </div>
            </details>
          </li>
        ))}
      </ul>
      <Section
        title="招待"
        description="招待した人が、このメールアドレスの Google アカウントで初めてログインすると、利用者として有効になります。"
      >
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-xs sm:grid-cols-3">
          {(["manager", "pilot", "viewer"] as const).map((r) => (
            <div key={r} className="flex flex-col gap-0.5 border-l border-rule pl-3">
              <dt className="font-medium text-ink">{ROLE_LABELS[r]}</dt>
              <dd className="leading-relaxed text-ink-mute">{ROLE_DESCRIPTIONS[r]}</dd>
            </div>
          ))}
        </dl>
        <ChangeNotice target={MEMBER_INVITE_NOTICE_TARGET} />
        <MemberInviteForm />
      </Section>
    </main>
  );
}
