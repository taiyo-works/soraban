import Link from "next/link";
import { DraftOwnerGuard } from "@/components/ops/ops-client";
import { IncidentFactNotice, IncidentList, IncidentOfficialNotice } from "@/components/ops/incident-ui";
import { buttonGhostClass, buttonPrimaryClass, PageHeader, VoidedToggle } from "@/components/ops/ui";
import { INCIDENT_FOLLOW_UP_LABEL, INCIDENT_FOLLOW_UPS, INCIDENT_KIND_LABEL, INCIDENT_KINDS, INCIDENT_REPORT_STATE_LABEL, type IncidentFollowUp, type IncidentKind } from "@/lib/ops-incident";
import { can } from "@/server/ops/authz";
import { listIncidents, type IncidentListFilter } from "@/server/ops/incidents";
import { requireOpsMember } from "@/server/ops/page";

const REPORT_STATES = ["none", "reported", "consulted", "changed"] as const;
const REPORT_STATE_FILTER_LABEL: Readonly<Record<(typeof REPORT_STATES)[number], string>> = {
  none: INCIDENT_REPORT_STATE_LABEL.none.label,
  reported: INCIDENT_REPORT_STATE_LABEL.reported.label,
  consulted: INCIDENT_REPORT_STATE_LABEL.consulted.label,
  changed: "記録のあとで内容が変わった",
};
const selectClass = "min-h-11 rounded-sharp border border-rule bg-paper px-3 text-base text-ink sm:text-sm";

// 事故・ヒヤリハットの一覧（Sprint 12e 設計 E）。全役割が見られる。記録は運航管理者と操縦者。取消は既定で出さない（?includeVoided=1）。
// N1（事実の記録の注意）・N2（公式の手続き）を常に出す。目安・報告の状態・簡易記録の印・取消は文字と記号で示す。
export default async function IncidentListPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ includeVoided?: string; kind?: string; followUp?: string; reportState?: string; detailPending?: string; planId?: string }>;
}) {
  const { ctx, me } = await requireOpsMember();
  const sp = await searchParams;
  const kind = INCIDENT_KINDS.find((k) => k === sp.kind) as IncidentKind | undefined;
  const followUp = INCIDENT_FOLLOW_UPS.find((f) => f === sp.followUp) as IncidentFollowUp | undefined;
  const reportState = REPORT_STATES.find((r) => r === sp.reportState);
  const filter: IncidentListFilter = {
    ...(sp.includeVoided === "1" ? { includeVoided: true } : {}),
    ...(kind ? { kind } : {}),
    ...(followUp ? { followUp } : {}),
    ...(reportState ? { reportState } : {}),
    ...(sp.detailPending === "1" ? { detailPending: true } : {}),
    ...(sp.planId && /^[0-9a-f-]{36}$/i.test(sp.planId) ? { planId: sp.planId.toLowerCase() } : {}),
  };
  const rows = await listIncidents(ctx, filter);
  const canCreate = can(me.member.role, "incident.create");
  return (
    <main className="flex flex-col gap-6" data-testid="incident-list-page">
      <DraftOwnerGuard memberId={me.member.id} />
      <PageHeader
        title="事故・ヒヤリハット"
        eyebrow="起きたことの記録"
        back={{ href: "/ops/more", label: "その他" }}
        aside={
          canCreate ? (
            <Link prefetch={false} href="/ops/incidents/new" className={buttonPrimaryClass} data-testid="incident-new-link">
              記録する
            </Link>
          ) : null
        }
      >
        <IncidentFactNotice />
        <IncidentOfficialNotice />
        {canCreate ? null : <p className="text-xs leading-relaxed text-ink-soft">閲覧者は記録を見ることだけができます。</p>}
      </PageHeader>

      <form method="get" className="flex flex-wrap items-end gap-3" data-testid="incident-filter" aria-label="事故・ヒヤリハットの絞り込み">
        <label className="flex flex-col gap-1 text-xs text-ink-mute">
          区分
          <select name="kind" defaultValue={kind ?? ""} className={selectClass} data-testid="incident-filter-kind">
            <option value="">すべて</option>
            {INCIDENT_KINDS.map((k) => (
              <option key={k} value={k}>
                {INCIDENT_KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-mute">
          報告の状態
          <select name="reportState" defaultValue={reportState ?? ""} className={selectClass} data-testid="incident-filter-report">
            <option value="">すべて</option>
            {REPORT_STATES.map((r) => (
              <option key={r} value={r}>
                {REPORT_STATE_FILTER_LABEL[r]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-mute">
          対応の状況
          <select name="followUp" defaultValue={followUp ?? ""} className={selectClass} data-testid="incident-filter-follow-up">
            <option value="">すべて</option>
            {INCIDENT_FOLLOW_UPS.map((f) => (
              <option key={f} value={f}>
                {INCIDENT_FOLLOW_UP_LABEL[f]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-h-11 items-center gap-2 text-sm text-ink">
          <input type="checkbox" name="detailPending" value="1" defaultChecked={sp.detailPending === "1"} className="h-5 w-5 accent-brand-700" data-testid="incident-filter-pending" />
          詳細が未記入のものだけ
        </label>
        {sp.includeVoided === "1" ? <input type="hidden" name="includeVoided" value="1" /> : null}
        <button type="submit" className={buttonGhostClass} data-testid="incident-filter-submit">
          絞り込む
        </button>
      </form>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <VoidedToggle basePath="/ops/incidents" includeVoided={sp.includeVoided === "1"} />
        <p className="font-mono text-[11px] tnum text-ink-mute" data-testid="incident-count">
          {rows.length} 件
        </p>
      </div>
      <IncidentList rows={rows} empty="記録された事故・ヒヤリハットはありません。" />
    </main>
  );
}
