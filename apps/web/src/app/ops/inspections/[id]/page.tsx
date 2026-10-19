import { notFound } from "next/navigation";
import { VoidForm } from "@/components/ops/ops-client";
import { InspectionForm } from "@/components/ops/records-client";
import { VersionList } from "@/components/ops/versions";
import { Badge, buttonGhostClass, buttonFieldClass, DetailList, Note, PageHeader, Section } from "@/components/ops/ui";
import { INSPECTION_RESULT_LABELS, INSPECTION_TIMING_LABELS } from "@/lib/ops-records";
import { getInspection, listInspectionVersions } from "@/server/ops/records";
import { OpsError } from "@/server/ops/service";
import { requireOpsMember } from "@/server/ops/page";
import { canCorrectRecord, recordCreateDenied, recordFormOptions } from "@/server/ops/record-page";

/** 訂正の入力を開閉する見出し（ボタンと同じ押しやすさにする）。 */
const CORRECT_SUMMARY = `${buttonGhostClass} cursor-pointer list-none gap-2 self-start [&::-webkit-details-marker]:hidden`;

// 日常点検記録の詳細（9 項目の結果・訂正・取消・版の一覧）。保存後はここから飛行記録の入力へ進める。
export default async function InspectionDetailPage({ params }: { readonly params: Promise<{ id: string }> }) {
  const { ctx, me } = await requireOpsMember();
  const { id } = await params;
  let i;
  try {
    i = await getInspection(ctx, id);
  } catch (e) {
    if (e instanceof OpsError && e.status === 404) notFound();
    throw e;
  }
  const versions = await listInspectionVersions(ctx, id);
  const manager = me.member.role === "manager";
  const correctable = !i.voided && canCorrectRecord(me, i.isSelf);
  const options = correctable ? await recordFormOptions(ctx, me) : null;
  const rows: [string, React.ReactNode][] = [
    ["実施年月日・時刻", <span key="d" className="font-mono tnum">{i.inspectedAtJst}</span>],
    ["区分", INSPECTION_TIMING_LABELS[i.timing]],
    ["機体（登録記号）", <span key="a" className="font-mono">{i.registrationMark}</span>],
    ["実施者", <span key="p">{i.inspectorName}<span className="ml-1 text-xs text-ink-mute">（記録した時点の氏名）</span></span>],
    [
      "実施場所",
      <span key="pl" className="flex flex-col">
        <span>{i.placeName}</span>
        {i.latitude !== null ? (
          <span className="font-mono text-xs text-ink-soft tnum">
            {i.latitude}, {i.longitude}（WGS84）{i.accuracyM !== null ? `／精度 約 ${i.accuracyM} m` : ""}
          </span>
        ) : null}
      </span>,
    ],
    ...i.items.map(
      (it): [string, React.ReactNode] => [
        it.label,
        <span key={it.key} className="flex flex-wrap items-center gap-2" data-testid={`inspection-result-${it.key}`}>
          <Badge tone={it.result === "normal" ? "green" : "red"}>{INSPECTION_RESULT_LABELS[it.result]}</Badge>
          {it.note ? <span className="text-ink-soft">{it.note}</span> : null}
        </span>,
      ],
    ),
    ["特記事項", i.specialNotes ?? "—"],
  ];
  const canEnterFlight = !i.voided && recordCreateDenied(me) === null;
  return (
    <main className="flex flex-col gap-10">
      <div className="flex flex-col gap-5">
        <PageHeader
          eyebrow="日常点検の詳細"
          back={{ href: "/ops/inspections", label: "日常点検の一覧" }}
          title={
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="break-all">
                {i.inspectedDate} {i.registrationMark}
              </span>
              {i.hasAbnormal ? <Badge tone="red">異常あり</Badge> : <Badge tone="green">すべて正常</Badge>}
              {i.voided ? <Badge tone="red">取消済み</Badge> : null}
            </span>
          }
          aside={
            canEnterFlight ? (
              // 通常の画面遷移で開く（入力画面は下書きを端末から読み直すため。クライアント側の遷移の競合も避ける）
              <a href={`/ops/flights/new?aircraftId=${i.aircraftId}&inspectionId=${i.id}`} className={buttonFieldClass}>
                この機体の飛行記録を入力
              </a>
            ) : null
          }
        />
        {i.voided ? <Note tone="red">この日常点検は取り消されています。記載内容と版の一覧は残しています。</Note> : null}
        <DetailList rows={rows} data-testid="inspection-detail" />
      </div>
      {correctable && options ? (
        <Section title="訂正" description="記載の誤りを直します。訂正前の内容は版として残ります。">
          <details className="group/correct">
            <summary className={CORRECT_SUMMARY}>
              <span aria-hidden className="inline-block transition-transform group-open/correct:rotate-90">›</span>
              <span className="group-open/correct:hidden">訂正の入力を開く</span>
              <span className="hidden group-open/correct:inline">訂正の入力を閉じる</span>
            </summary>
            <div className="mt-4 border-l-2 border-brand-700 pl-3 sm:pl-5">
              <InspectionForm key={i.version} aircraft={options.aircraft} pilots={options.pilots} fixedPilotId={options.fixedPilotId} memberId={me.member.id} editing={i} />
            </div>
          </details>
        </Section>
      ) : null}
      <VersionList versions={versions} />
      {manager && !i.voided ? (
        <Section title="取消" tone="danger" description="誤って入力した日常点検を取り消します。削除ではありません。記載内容と版の一覧は残ります。">
          <VoidForm url={`/api/ops/inspections/${i.id}/void`} version={i.version} label="この日常点検" />
        </Section>
      ) : null}
    </main>
  );
}
