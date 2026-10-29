import { notFound } from "next/navigation";
import { PilotForm, VoidForm } from "@/components/ops/ops-client";
import { VersionList } from "@/components/ops/versions";
import { Badge, DetailList, LicenseNumber, Note, PageHeader, Section } from "@/components/ops/ui";
import { LicenseRenewalNotice } from "@/components/ops/license-renewal";
import { LICENSE_RENEWAL_SOURCE_URL, todayJst } from "@/server/ops/license";
import { getPilot, listMembers, listPilotVersions, OpsError } from "@/server/ops/service";
import { formatMinutes, LICENSE_CLASS_LABELS, requireOpsMember, ROLE_LABELS } from "@/server/ops/page";

// 操縦者の詳細。技能証明書番号の全桁は運航管理者と本人にだけ示す（API の応答そのものから除く）。
export default async function PilotDetailPage({ params }: { readonly params: Promise<{ id: string }> }) {
  const { ctx, me } = await requireOpsMember();
  const { id } = await params;
  let p;
  try {
    p = await getPilot(ctx, id);
  } catch (e) {
    if (e instanceof OpsError && e.status === 404) notFound();
    throw e;
  }
  const versions = await listPilotVersions(ctx, id);
  const manager = me.member.role === "manager";
  const canEdit = !p.voided && (manager || (me.member.role === "pilot" && p.isSelf));
  const members = manager ? await listMembers(ctx) : [];
  const limits = [
    p.limitationType ? "種類" : null,
    p.limitationWeight ? "重量" : null,
    p.limitationDaytime ? "昼間" : null,
    p.limitationVlos ? "目視内" : null,
  ].filter(Boolean);
  const rows: [string, React.ReactNode][] = [
    ["氏名", p.fullName],
    ["技能証明", p.hasLicense && p.licenseClass ? `${LICENSE_CLASS_LABELS[p.licenseClass]}` : "なし"],
    [
      "技能証明書番号",
      p.licenseNumber ? (
        <span className="flex flex-col gap-0.5">
          <LicenseNumber value={p.licenseNumber} />
          {p.licenseNumberMasked ? (
            <span className="text-xs text-sb-ink-3">末尾 4 桁以外を伏せています。全桁は運航管理者と本人だけが見られます。</span>
          ) : null}
        </span>
      ) : (
        "—"
      ),
    ],
    [
      "有効期限",
      p.licenseExpiresOn ? (
        <span className="flex flex-col items-start gap-1.5">
          <span className="tnum">{p.licenseExpiresOn}</span>
          <LicenseRenewalNotice expiresOn={p.licenseExpiresOn} today={todayJst()} voided={p.voided} />
          <a
            href={LICENSE_RENEWAL_SOURCE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center text-[13px] font-bold text-sb-ink underline decoration-sb-orange decoration-2 underline-offset-4"
          >
            更新の手続き（国土交通省）↗
          </a>
        </span>
      ) : (
        "—"
      ),
    ],
    ["限定事項", limits.length > 0 ? limits.join("・") : "なし"],
    [
      "そらばんで記録した飛行の累計",
      <span key="rt" className="flex flex-col">
        <span className="sb-num tnum" data-testid="pilot-recorded-total">
          {formatMinutes(p.recordedFlightMinutes)}
        </span>
        <span className="text-xs text-sb-ink-3">
          取消していない飛行記録 {p.recordedFlightCount} 件の飛行時間の合計（全機体）。そらばんで記録する前の飛行時間は含みません。
        </span>
      </span>,
    ],
  ];
  const editNote = p.voided
    ? null
    : manager
      ? null
      : canEdit
        ? "自分に結び付いた操縦者のため、訂正できます。取消は運航管理者だけが行えます。"
        : "訂正・取消は運航管理者（自分に結び付いた操縦者は本人）だけが行えます。";
  return (
    <main className="flex flex-col gap-10">
      <div className="flex flex-col gap-5">
        <PageHeader
          eyebrow="操縦者の詳細"
          back={{ href: "/ops/pilots", label: "操縦者の一覧" }}
          title={
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="break-words">操縦者 {p.fullName}</span>
              {p.isSelf ? <Badge tone="brand">あなた</Badge> : null}
              {p.voided ? <Badge tone="red">取消済み</Badge> : null}
            </span>
          }
        />
        {p.voided ? (
          <Note tone="red">
            この操縦者は取り消されています。誤登録の記録として、登録内容と版の一覧を残しています。訂正はできません。
          </Note>
        ) : editNote ? (
          <Note>{editNote}</Note>
        ) : null}
        <DetailList rows={rows} data-testid="pilot-detail" />
      </div>
      {canEdit ? (
        <Section title="訂正" description="登録内容の誤りや変化を直します。訂正前の内容は版として残ります。">
          <PilotForm
            key={p.version}
            initial={p}
            memberOptions={
              manager ? members.map((m) => ({ id: m.id, label: `${m.displayName}（${ROLE_LABELS[m.role]}）` })) : undefined
            }
          />
        </Section>
      ) : null}
      <VersionList versions={versions} />
      {manager && !p.voided ? (
        <Section
          title="取消"
          tone="danger"
          description="誤って登録した操縦者を取り消します。削除ではありません。取り消した操縦者は一覧に出なくなりますが、登録内容と版の一覧は誤登録の記録として残り、以後は訂正できません。"
        >
          <VoidForm url={`/api/ops/pilots/${p.id}/void`} version={p.version} label="この操縦者" />
        </Section>
      ) : null}
    </main>
  );
}
