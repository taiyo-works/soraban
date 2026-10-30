import { notFound } from "next/navigation";
import { safeReturnTo } from "@/lib/ops-return";
import { AircraftForm, VoidForm } from "@/components/ops/ops-client";
import { VersionList } from "@/components/ops/versions";
import { AIRCRAFT_STATUS_TONE, Badge, DetailList, Note, PageHeader, Section } from "@/components/ops/ui";
import { getAircraft, listAircraftVersions, OpsError } from "@/server/ops/service";
import { AIRCRAFT_STATUS_LABELS, CERT_CLASS_LABELS, formatMinutes, requireOpsMember } from "@/server/ops/page";

// 機体の詳細（訂正・取消・版の一覧）。取消済みでも詳細と版の一覧は残る。
export default async function AircraftDetailPage({ params, searchParams }: { readonly params: Promise<{ id: string }>; readonly searchParams?: Promise<{ returnTo?: string }> }) {
  const { ctx, me } = await requireOpsMember();
  const { id } = await params;
  // Sprint 14：現場モードから来たとき（returnTo は同じオリジンの /ops/ 配下だけ）、戻り先を現場モードにする
  const returnTo = safeReturnTo((await searchParams)?.returnTo);
  let a;
  try {
    a = await getAircraft(ctx, id);
  } catch (e) {
    if (e instanceof OpsError && e.status === 404) notFound();
    throw e;
  }
  const versions = await listAircraftVersions(ctx, id);
  const manager = me.member.role === "manager";
  const mono = (s: string) => <span className="sb-num">{s}</span>;
  const rows: [string, React.ReactNode][] = [
    ["登録記号", mono(a.registrationMark)],
    ["型式名", a.modelName],
    ["設計製造者", a.manufacturer],
    ["製造番号", mono(a.serialNumber)],
    [
      "型式認証",
      a.typeCertified ? (
        <span className="flex flex-col">
          <span>あり</span>
          <span className="text-sb-ink-2">
            種類：{a.typeCertCategory}／型式：{a.typeCertModel}／番号：<span className="sb-num">{a.typeCertNumber}</span>
          </span>
        </span>
      ) : (
        "なし"
      ),
    ],
    [
      "機体認証",
      a.airworthinessClass ? (
        <span>
          {CERT_CLASS_LABELS[a.airworthinessClass]}
          <span className="text-sb-ink-2">（番号：<span className="sb-num">{a.airworthinessCertNumber}</span>）</span>
        </span>
      ) : (
        "なし"
      ),
    ],
    ["最大離陸重量", a.maxTakeoffWeightKg === null ? "—" : <span className="tnum">{a.maxTakeoffWeightKg} kg</span>],
    [
      "使用開始時の既存の総飛行時間",
      <span key="m" className="tnum">
        {Math.floor(a.initialFlightMinutes / 60)} 時間 {a.initialFlightMinutes % 60} 分
        <span className="ml-1 sb-num text-xs text-sb-ink-3">（{formatMinutes(a.initialFlightMinutes)}）</span>
      </span>,
    ],
    [
      "現在の総飛行時間",
      <span key="t" className="flex flex-col">
        <span className="sb-num tnum" data-testid="aircraft-total">
          {formatMinutes(a.totalFlightMinutes)}
        </span>
        <span className="text-xs text-sb-ink-3">
          既存の総飛行時間 ＋ 取消していない飛行記録 {a.flightCount} 件の飛行時間の合計。
          <a href={`/ops/flights?aircraftId=${a.id}`} className="ml-1 inline-flex min-h-11 items-center text-sb-ink underline underline-offset-2">
            この機体の飛行記録
          </a>
        </span>
      </span>,
    ],
    ["状態", <Badge key="s" tone={AIRCRAFT_STATUS_TONE[a.status]}>{AIRCRAFT_STATUS_LABELS[a.status]}</Badge>],
  ];
  return (
    <main className="flex flex-col gap-10">
      <div className="flex flex-col gap-5">
        <PageHeader
          eyebrow="機体の詳細"
          back={returnTo ? { href: returnTo, label: "現場モードへ戻る" } : { href: "/ops/aircraft", label: "機体の一覧" }}
          title={
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="break-all">機体 {a.registrationMark}</span>
              {a.voided ? <Badge tone="red">取消済み</Badge> : null}
            </span>
          }
        />
        {a.voided ? (
          <Note tone="red">
            この機体は取り消されています。誤登録の記録として、登録内容と版の一覧を残しています。訂正はできません。
          </Note>
        ) : manager ? null : (
          <Note>訂正・取消は運航管理者だけが行えます。</Note>
        )}
        <DetailList rows={rows} data-testid="aircraft-detail" />
      </div>
      {manager && !a.voided ? (
        <Section title="訂正" description="登録内容の誤りや変化を直します。訂正前の内容は版として残ります。">
          <AircraftForm key={a.version} initial={a} />
        </Section>
      ) : null}
      <VersionList versions={versions} />
      {manager && !a.voided ? (
        <Section
          title="取消"
          tone="danger"
          description="誤って登録した機体を取り消します。削除ではありません。取り消した機体は一覧に出なくなりますが、登録内容と版の一覧は誤登録の記録として残り、以後は訂正できません。"
        >
          <VoidForm url={`/api/ops/aircraft/${a.id}/void`} version={a.version} label="この機体" />
        </Section>
      ) : null}
    </main>
  );
}
