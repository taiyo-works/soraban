import Link from "next/link";
import {
  AIRCRAFT_STATUS_TONE,
  Badge,
  buttonPrimaryClass,
  CellLabel,
  ListHead,
  listRowClass,
  Note,
  PageHeader,
  VoidedToggle,
} from "@/components/ops/ui";
import { listAircraft } from "@/server/ops/service";
import { AIRCRAFT_STATUS_LABELS, formatMinutes, requireOpsMember } from "@/server/ops/page";
import { BACK_TO } from "@/components/ops/ops-nav-model";

const GRID = "sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)_6rem_minmax(0,9rem)]";

// 機体の一覧（?includeVoided=1 で取消済みを含める）。狭い画面ではカード、広い画面では表の行で示す。
export default async function AircraftListPage({ searchParams }: { readonly searchParams: Promise<{ includeVoided?: string }> }) {
  const { ctx, me } = await requireOpsMember();
  const includeVoided = (await searchParams).includeVoided === "1";
  const rows = await listAircraft(ctx, includeVoided);
  const manager = me.member.role === "manager";
  return (
    <main className="flex flex-col gap-6">
      <PageHeader
        title="機体"
        back={BACK_TO.register}
        aside={
          manager ? (
            <Link href="/ops/aircraft/new" className={buttonPrimaryClass}>
              機体を登録
            </Link>
          ) : null
        }
      >
        {manager ? null : <Note>機体の登録・訂正・取消は運航管理者だけが行えます。</Note>}
      </PageHeader>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <VoidedToggle basePath="/ops/aircraft" includeVoided={includeVoided} />
        <p className="font-mono text-[11px] tnum text-ink-mute">{rows.length} 件</p>
      </div>
      {rows.length === 0 ? (
        <p className="border-y border-rule py-6 text-center text-sm text-ink-mute">登録された機体はありません。</p>
      ) : (
        <div className="flex flex-col">
          <ListHead columns={["登録記号", "型式名（設計製造者）", "総飛行時間", "状態"]} gridClass={GRID} />
          <ul className="flex flex-col gap-2 sm:gap-0" data-testid="aircraft-list">
            {rows.map((a) => (
              <li key={a.id}>
                <Link
                  href={`/ops/aircraft/${a.id}`}
                  className={`${listRowClass} ${GRID} ${a.voided ? "text-ink-mute" : ""}`}
                >
                  <span className="min-w-0 break-all font-mono text-[15px] text-ink">
                    <CellLabel>登録記号</CellLabel>
                    {a.registrationMark}
                  </span>
                  <span className="min-w-0 break-words text-ink-soft">
                    <CellLabel>型式名</CellLabel>
                    {a.modelName}
                    <span className="text-ink-mute">（{a.manufacturer}）</span>
                  </span>
                  <span className="font-mono tnum text-ink-soft">
                    <CellLabel>総飛行時間</CellLabel>
                    {formatMinutes(a.totalFlightMinutes)}
                  </span>
                  <span className="flex flex-wrap items-center gap-1.5">
                    <CellLabel>状態</CellLabel>
                    <Badge tone={AIRCRAFT_STATUS_TONE[a.status]}>{AIRCRAFT_STATUS_LABELS[a.status]}</Badge>
                    {a.voided ? <Badge tone="red">取消済み</Badge> : null}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </main>
  );
}
