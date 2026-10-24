import type { Metadata } from "next";
import Link from "next/link";
import { Badge, buttonPrimaryClass, listRowClass, Note, PageHeader, VoidedToggle } from "@/components/ops/ui";
import { requireOpsMember } from "@/server/ops/page";
import { listPlaces } from "@/server/ops/places";
import { BACK_TO } from "@/components/ops/ops-nav-model";

// よく使う地点（社内拠点など）の一覧。全役割が見られる。登録・訂正・取消は運航管理者だけ。
export const metadata: Metadata = { title: "よく使う地点" };

export default async function PlaceListPage({ searchParams }: { readonly searchParams: Promise<{ includeVoided?: string }> }) {
  const { ctx, me } = await requireOpsMember();
  const includeVoided = (await searchParams).includeVoided === "1";
  const rows = await listPlaces(ctx, includeVoided);
  const manager = me.member.role === "manager";
  return (
    <main className="flex flex-col gap-6">
      <PageHeader
        title="よく使う地点"
        back={BACK_TO.register}
        aside={
          manager ? (
            <Link prefetch={false} href="/ops/places/new" className={buttonPrimaryClass} data-testid="place-new-link">
              地点を登録
            </Link>
          ) : null
        }
      >
        {manager ? (
          <Note>登録した地点は、飛行計画のフォームで選べます。選ぶと名称と座標が計画に写ります。</Note>
        ) : (
          <Note>地点の登録・訂正・取消は運航管理者だけが行えます。</Note>
        )}
      </PageHeader>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <VoidedToggle basePath="/ops/places" includeVoided={includeVoided} />
        <p className="font-mono text-[11px] tnum text-ink-mute">{rows.length} 件</p>
      </div>
      {rows.length === 0 ? (
        <p className="border-y border-rule py-6 text-center text-sm text-ink-mute">登録された地点はありません。</p>
      ) : (
        <ul className="flex flex-col gap-2" data-testid="place-list">
          {rows.map((p) => (
            <li key={p.id}>
              <Link prefetch={false} href={`/ops/places/${p.id}`} className={`${listRowClass} sm:grid-cols-1 sm:rounded-sharp sm:border sm:bg-paper sm:px-3 ${p.voided ? "text-ink-mute" : ""}`} data-testid="place-row">
                <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="break-words font-medium text-ink" data-testid="place-row-name">
                    {p.name}
                  </span>
                  {p.voided ? <Badge tone="red">取消済み</Badge> : null}
                </span>
                {p.addressText ? <span className="text-xs text-ink-soft">{p.addressText}</span> : null}
                <span className="font-mono text-xs tnum text-ink-soft">
                  {p.latitude}, {p.longitude}（WGS84）
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
