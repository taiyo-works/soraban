import { safeReturnTo } from "@/lib/ops-return";
import { notFound } from "next/navigation";
import { ChangeNotice } from "@/components/ops/change-notice";
import { BasisPlanList, PermitDeclaration, PermitValidityBadge, PermitVersionList } from "@/components/ops/permit-ui";
import { PermitForm, PermitVoidForm, RevokeForm } from "@/components/ops/permits-client";
import { Badge, DetailList, Note, PageHeader, Section, VERSION_NOTICE_TARGET } from "@/components/ops/ui";
import { can } from "@/server/ops/authz";
import { requireOpsMember } from "@/server/ops/page";
import { permitFormOptions } from "@/server/ops/permit-page";
import { PERMIT_FORMAT_UNVERIFIED_NOTE, PERMIT_KIND_LABEL, PERMIT_KINDS } from "@/server/ops/permit-logic";
import { getPermit, listPermitVersions } from "@/server/ops/permits";
import { OpsError } from "@/server/ops/service";

// 許可・承認の登録の詳細（訂正・失効・取消・版の履歴・この登録を根拠にしている計画）。取消済みでも詳細と版の履歴は残る。
// ?version=N&#vN で、判定の根拠にした当時の版を強調して示す（スナップショット → 登録の版へ辿る導線）。
export default async function PermitDetailPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ id: string }>;
  readonly searchParams: Promise<{ version?: string; returnTo?: string }>;
}) {
  const { ctx, me } = await requireOpsMember();
  const { id } = await params;
  const sp = await searchParams;
  // Sprint 14：現場モードから来たとき（returnTo は同じオリジンの /ops/ 配下だけ）、戻り先を現場モードにする
  const returnTo = safeReturnTo(sp.returnTo);
  let p;
  try {
    p = await getPermit(ctx, id);
  } catch (e) {
    if (e instanceof OpsError && e.status === 404) notFound();
    throw e;
  }
  const versions = await listPermitVersions(ctx, id);
  const highlight = /^\d+$/.test(sp.version ?? "") ? Number(sp.version) : null;
  const canUpdate = can(me.member.role, "permit.update") && !p.voided;
  const canRevoke = can(me.member.role, "permit.revoke") && !p.voided && p.status === "active";
  const canVoid = can(me.member.role, "permit.void") && !p.voided;
  const opts = canUpdate ? await permitFormOptions(ctx, [...p.aircraftScope.ids, ...p.pilotScope.ids]) : null;
  const mono = (s: string) => <span className="sb-num">{s}</span>;
  const scopeText = (s: { type: "any" | "listed"; labels: readonly string[] }) =>
    s.type === "any" ? "限定しない（許可書で確認してください）" : s.labels.join("、");
  const rows: [string, React.ReactNode][] = [
    ["番号", <span key="n" className="sb-num" data-testid="permit-detail-number">{p.permitNumber}</span>],
    ["包括／個別", p.coverageLabel],
    ["許可・承認の種類", <span key="k" data-testid="permit-detail-kinds">{p.kinds.map((k) => k.label).join("、")}</span>],
    ...(p.airportNames.length > 0 ? ([["空港名", p.airportNames.join("、")]] as [string, React.ReactNode][]) : []),
    ["許可書発行日", mono(p.issuedOn)],
    [
      "許可期間",
      <span key="pe" className="sb-num tnum" data-testid="permit-detail-period">
        {p.validFrom} 〜 {p.validTo}
        {p.revokedOn ? `（失効日 ${p.revokedOn}。有効な最終日 ${p.effectiveLastDate}）` : ""}
      </span>,
    ],
    ["有効性（今日の日付から導出）", <PermitValidityBadge key="v" p={p} />],
    [
      "場所の範囲",
      <span key="pl" className="flex flex-col gap-0.5" data-testid="permit-detail-place">
        <span>{p.placeSummary}</span>
        {p.placeScope.type === "circles"
          ? p.placeScope.circles.map((c, i) => (
              <span key={i} className="sb-num text-xs tnum text-sb-ink-2">
                {c.name ? `${c.name}：` : ""}
                {c.lat}, {c.lng}／半径 {c.radiusM} m
              </span>
            ))
          : null}
        {p.placeScope.type === "text" ? <span className="text-sb-ink-2">{p.placeScope.text || "（記載なし）"}</span> : null}
      </span>,
    ],
    ["機体の範囲", scopeText(p.aircraftScope)],
    ["操縦者の範囲", scopeText(p.pilotScope)],
    ["最大高度の条件", p.maxAltitudeM === null ? "—" : `${p.maxAltitudeM} m 以下`],
    ["機体重量の条件", p.maxWeightKg === null ? "—" : `${p.maxWeightKg} kg 以下`],
    ["補助者の配置が条件", p.requiresObserver ? "はい" : "いいえ"],
    ["立入管理措置が条件", p.requiresAccessControl ? "はい" : "いいえ"],
    ["照合できない条件（文章）", p.conditionsText ?? "—"],
    ["現在の版", <span key="ver" className="sb-num tnum" data-testid="permit-detail-version">版 {p.version}</span>],
  ];
  return (
    <main className="flex flex-col gap-10">
      <div className="flex flex-col gap-5">
        <PageHeader
          eyebrow="許可・承認の詳細"
          back={returnTo ? { href: returnTo, label: "現場モードへ戻る" } : { href: "/ops/permits", label: "許可・承認の一覧" }}
          title={
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="break-all" data-testid="permit-title">許可・承認 {p.permitNumber}</span>
              {p.voided ? <Badge tone="red">× 取消</Badge> : null}
            </span>
          }
        />
        <PermitDeclaration declaration={p.declaration} noDipsNote={p.noDipsNote} />
        {p.notes.map((n) => (
          <p key={n} className="text-xs leading-relaxed text-sb-ink-3" data-testid="permit-note">{n}</p>
        ))}
        {p.voided ? (
          <Note tone="red">この登録は取り消されています（誤登録の記録）。登録内容と版の履歴は残しています。訂正はできません。</Note>
        ) : p.status === "revoked" ? (
          <Note tone="red">この登録は失効しています（失効日 {p.revokedOn}）。失効日以降の飛行には適用されません。訂正はできません。</Note>
        ) : null}
        {!can(me.member.role, "permit.update") ? <Note>訂正・失効・取消は運航管理者だけが行えます。</Note> : null}
        <DetailList rows={rows} data-testid="permit-detail" />
      </div>

      <BasisPlanList plans={p.basisPlans} count={p.basisPlanCount} />

      {canUpdate && opts && p.status === "active" ? (
        <Section title="訂正" description="登録内容の誤りや変化を直します。訂正前の内容は版として残ります。">
          <PermitForm
            key={p.version}
            initial={{
              id: p.id,
              version: p.version,
              permitNumber: p.permitNumber,
              coverage: p.coverage,
              kinds: p.kinds.map((k) => k.kind),
              airportNames: p.airportNames,
              issuedOn: p.issuedOn,
              validFrom: p.validFrom,
              validTo: p.validTo,
              placeScope: p.placeScope,
              aircraftScope: { type: p.aircraftScope.type, ids: p.aircraftScope.ids },
              pilotScope: { type: p.pilotScope.type, ids: p.pilotScope.ids },
              maxAltitudeM: p.maxAltitudeM,
              maxWeightKg: p.maxWeightKg,
              requiresObserver: p.requiresObserver,
              requiresAccessControl: p.requiresAccessControl,
              conditionsText: p.conditionsText,
            }}
            kindChoices={PERMIT_KINDS.map((k) => ({ value: k, label: PERMIT_KIND_LABEL[k] }))}
            aircraftOptions={opts.aircraft}
            pilotOptions={opts.pilots}
            affectedCount={p.basisPlanCount}
          />
          <p className="text-xs leading-relaxed text-sb-ink-3">{PERMIT_FORMAT_UNVERIFIED_NOTE}</p>
        </Section>
      ) : null}

      <ChangeNotice target={VERSION_NOTICE_TARGET} />
      <PermitVersionList versions={versions} highlight={highlight} />

      {canRevoke ? (
        <Section title="失効" tone="danger" description="許可・承認が失効・取消された日を記録します。その日以降の飛行には適用されません（前日までの飛行には適用できます）。削除ではなく、版として残ります。">
          <RevokeForm id={p.id} version={p.version} />
        </Section>
      ) : null}
      {canVoid ? (
        <Section title="取消" tone="danger" description="誤って登録したものを取り消します。削除ではありません。取り消した番号は照合に使われなくなり、登録内容と版の履歴は誤登録の記録として残ります。">
          <PermitVoidForm id={p.id} version={p.version} />
        </Section>
      ) : null}
    </main>
  );
}
