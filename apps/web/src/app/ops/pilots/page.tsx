import Link from "next/link";
import {
  Badge,
  buttonPrimaryClass,
  CellLabel,
  LicenseNumber,
  ListHead,
  listRowClass,
  Note,
  PageHeader,
  VoidedToggle,
} from "@/components/ops/ui";
import { LicenseRenewalNotice } from "@/components/ops/license-renewal";
import { todayJst } from "@/server/ops/license";
import { listPilots } from "@/server/ops/service";
import { LICENSE_CLASS_LABELS, requireOpsMember } from "@/server/ops/page";

const GRID = "sm:grid-cols-[minmax(0,1fr)_minmax(0,7rem)_minmax(0,12rem)_minmax(0,6rem)]";

// 操縦者の一覧。技能証明書番号は常に末尾 4 桁以外を伏せる（伏せた値は API の応答の時点で伏せてある）。
export default async function PilotListPage({ searchParams }: { readonly searchParams: Promise<{ includeVoided?: string }> }) {
  const { ctx, me } = await requireOpsMember();
  const includeVoided = (await searchParams).includeVoided === "1";
  const rows = await listPilots(ctx, includeVoided);
  const manager = me.member.role === "manager";
  const today = todayJst();
  return (
    <main className="flex flex-col gap-6">
      <PageHeader
        title="操縦者"
        back={{ href: "/ops", label: "運航管理のトップ" }}
        aside={
          manager ? (
            <Link href="/ops/pilots/new" className={buttonPrimaryClass}>
              操縦者を登録
            </Link>
          ) : null
        }
      >
        <Note>
          技能証明書番号は、一覧では末尾 4 桁以外を伏せています。
          {manager
            ? "全桁は各操縦者の詳細画面で確認できます。"
            : "全桁は、自分に結び付いた操縦者の詳細画面でだけ確認できます。登録・取消は運航管理者だけが行えます。"}
        </Note>
      </PageHeader>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <VoidedToggle basePath="/ops/pilots" includeVoided={includeVoided} />
        <p className="font-mono text-[11px] tnum text-ink-mute">{rows.length} 件</p>
      </div>
      {rows.length === 0 ? (
        <p className="border-y border-rule py-6 text-center text-sm text-ink-mute">登録された操縦者はいません。</p>
      ) : (
        <div className="flex flex-col">
          <ListHead columns={["氏名", "技能証明", "技能証明書番号", ""]} gridClass={GRID} />
          <ul className="flex flex-col gap-2 sm:gap-0" data-testid="pilot-list">
            {rows.map((p) => (
              <li key={p.id}>
                <Link href={`/ops/pilots/${p.id}`} className={`${listRowClass} ${GRID} ${p.voided ? "text-ink-mute" : ""}`}>
                  <span className="min-w-0 break-words text-[15px] text-ink">
                    <CellLabel>氏名</CellLabel>
                    {p.fullName}
                    {p.isSelf ? <span className="ml-2 text-xs text-brand-700">（あなた）</span> : null}
                  </span>
                  <span className="text-ink-soft">
                    <CellLabel>技能証明</CellLabel>
                    {p.hasLicense && p.licenseClass ? LICENSE_CLASS_LABELS[p.licenseClass] : "なし"}
                    <LicenseRenewalNotice expiresOn={p.licenseExpiresOn} today={today} voided={p.voided} />
                  </span>
                  <span className="flex min-w-0 items-baseline text-ink-soft">
                    <CellLabel>番号</CellLabel>
                    {p.hasLicense && p.licenseNumber ? <LicenseNumber value={p.licenseNumber} /> : <span>—</span>}
                  </span>
                  {p.voided ? (
                    <span className="flex flex-wrap items-center gap-1.5">
                      <Badge tone="red">取消済み</Badge>
                    </span>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </main>
  );
}
