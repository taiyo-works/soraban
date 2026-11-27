import { notFound } from "next/navigation";
import { VoidForm } from "@/components/ops/ops-client";
import { PlaceForm } from "@/components/ops/plans-client";
import { Badge, DetailList, Note, PageHeader, Section } from "@/components/ops/ui";
import { VersionList } from "@/components/ops/versions";
import { can } from "@/server/ops/authz";
import { requireOpsMember } from "@/server/ops/page";
import { getPlace, listPlaceVersions } from "@/server/ops/places";
import { OpsError } from "@/server/ops/service";

// よく使う地点の詳細（訂正・取消・版の一覧）。取消済みでも詳細と版の一覧は残る。
export default async function PlaceDetailPage({ params }: { readonly params: Promise<{ id: string }> }) {
  const { ctx, me } = await requireOpsMember();
  const { id } = await params;
  let p;
  try {
    p = await getPlace(ctx, id);
  } catch (e) {
    if (e instanceof OpsError && e.status === 404) notFound();
    throw e;
  }
  const versions = await listPlaceVersions(ctx, id);
  const manager = can(me.member.role, "place.update");
  return (
    <main className="flex flex-col gap-10">
      <div className="flex flex-col gap-5">
        <PageHeader
          eyebrow="よく使う地点の詳細"
          back={{ href: "/ops/places", label: "よく使う地点" }}
          title={
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="break-all" data-testid="place-title">{p.name}</span>
              {p.voided ? <Badge tone="red">取消済み</Badge> : null}
            </span>
          }
        />
        {p.voided ? <Note tone="red" body>この地点は取り消されています。計画のフォームでは選べません。記載内容と版の一覧は残しています。</Note> : null}
        <DetailList
          data-testid="place-detail"
          rows={[
            ["名称", p.name],
            ["住所", p.addressText ?? "—"],
            ["座標（WGS84）", <span key="c" className="sb-num text-sm tnum" data-testid="place-coords">{p.latitude}, {p.longitude}</span>],
            ["メモ", p.note ?? "—"],
          ]}
        />
      </div>
      {manager && !p.voided ? (
        <Section title="訂正" description="記載の誤りを直します。訂正前の内容は版として残ります。">
          <PlaceForm
            key={p.version}
            initial={{ id: p.id, version: p.version, name: p.name, addressText: p.addressText, latitude: p.latitude, longitude: p.longitude, note: p.note }}
          />
        </Section>
      ) : null}
      <VersionList versions={versions} />
      {manager && !p.voided ? (
        <Section title="取消" tone="danger" description="地点を取り消します。削除ではありません。取り消した地点は計画のフォームで選べなくなります（作成済みの計画の写しは変わりません）。">
          <VoidForm url={`/api/ops/places/${p.id}/void`} version={p.version} label="この地点" />
        </Section>
      ) : null}
    </main>
  );
}
