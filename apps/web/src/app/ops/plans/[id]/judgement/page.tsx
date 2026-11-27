import Link from "next/link";
import {
  MODEL_AIRCRAFT_REFERENCE_LINE,
  MODEL_AIRCRAFT_REFERENCES,
  PLAN_JUDGEMENT_DISCLAIMER,
  PERMIT_SCOPE_NOT_VERIFIED_NOTE,
  type FlightVerdict,
} from "@soraban/regulations";
import { ChangeNotice } from "@/components/ops/change-notice";
import { PermitDeclaration, PlanPermitList } from "@/components/ops/permit-ui";
import { PlanFrame } from "@/components/ops/plan-frame";
import { JudgementTiles, type TileItem } from "@/components/ops/judgement-tiles";
import { RejudgeButton } from "@/components/ops/plans-client";
import { buttonOutlineBrandClass, buttonPrimaryClass, DetailList, Note, Section, VERSION_NOTICE_TARGET } from "@/components/ops/ui";
import { VerdictSummary } from "@/components/verdict-summary";
import { isApplicationSupportEnabled } from "@/lib/boundary";
import { datasetInfo } from "@/lib/judgement-datasets";
import { judgementTotal, TILE_RANK } from "@/lib/judgement-total";
import { formatJst } from "@/lib/ops-time";
import { baseStatusDisplay, legalTierLabel, VERDICT_LABEL } from "@/lib/verdict-display";
import { PERMIT_FORMAT_UNVERIFIED_NOTE } from "@/server/ops/permit-logic";
import { verdictPermitNotes } from "@/server/ops/permit-page";
import { getPlanPermits } from "@/server/ops/permits";
import { canUpdatePlan } from "@/server/ops/plan-page";
import { getSnapshot } from "@/server/ops/plans";
import { loadPlan } from "../_load";

const mono = "sb-num text-sm tnum break-all";

/** 許可の候補は、最初の 3 件だけを出し、残りは畳む（組織の許可の件数で画面の長さが変わらないように。16-H2 H2-5）。 */
const CANDIDATES_SHOWN = 3;

/** 項目の理由から、模型航空機の参照先の行を外す（参照先は題名のリンクとして別に出す）。 */
const splitReason = (reason: string): { readonly text: string; readonly refs: readonly { title: string; url: string }[] } =>
  reason.includes(MODEL_AIRCRAFT_REFERENCE_LINE)
    ? { text: reason.replace(MODEL_AIRCRAFT_REFERENCE_LINE, "").trim(), refs: MODEL_AIRCRAFT_REFERENCES.map((r) => ({ title: r.title, url: r.url })) }
    : { text: reason, refs: [] };

// 判定の画面（Sprint 17-1）。判定は補助。中身は計画の詳細にあった「判定の要約」「許可・承認の照合」をそのまま移した（再設計しない）。
// 判定を見なくても、通報の準備と記録は止まらない（通報の主画面と /report で完結する）。
export default async function PlanJudgementPage({ params }: { readonly params: Promise<{ id: string }> }) {
  const { ctx, me, id, plan } = await loadPlan(params);
  const [snapshot, planPermits] = await Promise.all([getSnapshot(ctx, id, plan.currentSnapshotId), getPlanPermits(ctx, id)]);
  // 判定の項目への表示の置き換えは、保存した判定（現在のスナップショット）が根拠にした登録だけに限る（登録が変わって古い判定には出さない）
  const permitNotes = planPermits.judgementUpToDate ? verdictPermitNotes(planPermits.permits) : { applied: {}, item: {} };
  const verdict = (snapshot.result as { verdict?: FlightVerdict }).verdict;
  const updatable = !plan.voided && canUpdatePlan(me, plan.isSelf);
  const j = plan.judgement;
  const stale = plan.freshness.stale;
  const total = judgementTotal(verdict, stale);
  // 16-L の L-4：古い判定のとき、DIPS に出す内容の確認は主にしない。再判定できる人は plan-rejudge が主、閲覧だけの人は主ボタン無し（再判定は押せず、
  // 古い判定のまま DIPS へ進む導線を強めないため。サーバーの権限は変えない＝表示だけ）
  const forwardIsPrimary = !stale;
  const fetchedAt = formatJst(new Date(j.checkedAt));
  const staleIds = new Set(snapshot.staleSources.map((x) => x.id));
  const datasets = snapshot.datasets.map((d) => datasetInfo(d, staleIds.has(d.id)));
  const tiles: TileItem[] = (verdict?.items ?? [])
    .map((it, idx) => ({ it, idx }))
    .sort((a, b) => TILE_RANK[a.it.verdict] - TILE_RANK[b.it.verdict] || a.idx - b.idx)
    .map(({ it }) => {
      const r = splitReason(it.reason);
      const done = verdict?.done.find((d) => d.itemId === it.id);
      const note = permitNotes.item[it.id];
      return {
        id: it.id,
        title: it.title,
        verdict: it.verdict,
        verdictLabel: VERDICT_LABEL[it.verdict],
        baseLabel: baseStatusDisplay(it),
        tierLabel: legalTierLabel(it.legalTier),
        reason: r.text,
        refs: r.refs,
        appliedPermits: it.appliedPermits.map((p) => p.label),
        ...(note ? { permitNote: note } : {}),
        procedures: (verdict?.procedures ?? []).filter((p) => p.itemId === it.id).map((p) => ({ id: p.id, title: p.title, submitTo: p.submitTo, deadline: p.deadline.label })),
        conditions: (done?.conditions ?? []).map((c) => (c === PERMIT_SCOPE_NOT_VERIFIED_NOTE ? (permitNotes.applied[it.id] ?? c) : c)),
      };
    });

  return (
    <PlanFrame plan={plan} eyebrow="判定（補助）" back={{ href: `/ops/plans/${plan.id}`, label: "通報の状況" }}>
      {/* 再判定の直後の結果の通知（版の一覧は /overview にあるため、ここでも受け取る） */}
      <ChangeNotice target={VERSION_NOTICE_TARGET} />
      <p data-note="" className="opx-note" data-testid="plan-disclaimer">
        {PLAN_JUDGEMENT_DISCLAIMER}
      </p>

        <Section
          id="sec-verdict"
          title="判定の要約"
          aria-label="判定の要約"
          description="計画を保存したときに、サーバーが実行した判定（現在のスナップショット）です。総合・項目・詳細の順に見られます。"
        >
          {/* 判定エンジンの文言を出す領域の印（Sprint 18-3。限定語の検査から外す。lib/wording-policy.ts） */}
          <div data-wording-scope="judgement" data-testid="judgement-scope-plan" className="flex flex-col gap-6">
            {/* 第 1 層：判定の総合（形と言葉）と、判定の取得時刻 */}
            <VerdictSummary
              part="conclusion"
              verdict={verdict}
              pending={false}
              failed={verdict === undefined}
              failedNote="この計画には、判定の記録がありません。判定をやり直すと、記録ができます。"
              total={total}
              permitNotes={permitNotes}
              meta={
                <p data-note="" className="sb-v-sub" data-testid="judgement-fetched-at">
                  判定の取得時刻（日本時間）：<time dateTime={j.checkedAt} className="sb-num tnum">{fetchedAt}</time>
                </p>
              }
            />
            {/* 古いときは、再判定の導線を総合の直下（タイルより前）に置く。再判定が主ボタン（§17 の 14） */}
            {stale ? (
              <div className="opx-stale-box" data-testid="plan-stale-box">
                <p className="font-medium text-sb-ink">判定が古くなっています</p>
                <ul className="list-disc pl-5 text-sb-ink-2" data-testid="plan-stale-reasons">
                  {plan.freshness.reasons.map((r) => (
                    <li key={r.code}>{r.label}</li>
                  ))}
                </ul>
                {updatable ? (
                  <div id="rejudge" className="scroll-mt-4">
                    <RejudgeButton planId={plan.id} version={plan.version} highlight />
                  </div>
                ) : !plan.voided ? (
                  // 再判定の権限がない（閲覧だけ）利用者には、次に誰が何をするかを 1 行で示す。古い判定のとき judgement-primary は副で、閲覧だけの人の主ボタンは 0
                  <p data-note="" className="text-sb-ink-2" data-testid="plan-stale-readonly-note">
                    判定のやり直しは、計画を変更できる人が行います
                  </p>
                ) : null}
              </div>
            ) : null}
            {/* 第 2 層：項目のタイル（押すと第 3 層のボトムシートで詳細） */}
            {tiles.length > 0 ? (
              <div className="flex flex-col gap-3" data-testid="judgement-tiles-section">
                <h3 className="opx-tile-h3">項目ごとの判定（{tiles.length} 件）</h3>
                <p data-note="" className="opx-tile-aside">調べた項目だけです。項目を押すと、理由と根拠を開きます。気象・標高・ハザードは、まだ調べていません。</p>
                <JudgementTiles items={tiles} datasets={datasets} fetchedAt={fetchedAt} fetchedAtIso={j.checkedAt} stale={stale} />
              </div>
            ) : null}
            {/* 手続き・手続き済み・飛行の前後の確認・規制ごとの表（従来の全体）。長さのため畳む */}
            {verdict ? (
              <details data-testid="plan-judgement-full">
                <summary className="flex min-h-12 cursor-pointer select-none items-center text-sm font-bold text-sb-ink">手続き・飛行の前後の確認・規制ごとの表（全体）</summary>
                <div className="pt-3">
                  <VerdictSummary part="details" verdict={verdict} pending={false} permitNotes={permitNotes} />
                </div>
              </details>
            ) : null}
          </div>
          {/* 主ボタンは 1 つ（H2-3）。判定が新しいときはこれ。アプリからは送らない。DIPS へ出す内容の確認（通報の主画面）へ進む */}
          <div className="flex flex-col gap-2" data-testid="judgement-next">
            <Link
              prefetch={false}
              href={`/ops/plans/${plan.id}`}
              {...(forwardIsPrimary ? { "data-variant": "primary" } : {})}
              className={`${forwardIsPrimary ? buttonPrimaryClass : buttonOutlineBrandClass} self-start`}
              data-testid="judgement-primary"
            >
              DIPS に出す内容を確認
            </Link>
            <p data-note="" className="text-sb-ink-2">判定は補助です。通報は、ご本人が DIPS で行います。</p>
          </div>
          <details data-testid="plan-judgement-details">
            <summary className="flex min-h-12 cursor-pointer select-none items-center text-sm font-bold text-sb-ink">判定の記録（通し番号・日時・証跡 ID・エンジンの版）</summary>
          <DetailList
            compact
            data-testid="plan-judgement"
            rows={[
              ["判定の通し番号", <span key="n" data-testid="plan-snapshot-seq">{j.seq}</span>],
              ["判定の日時（日本時間）", <time key="t" data-note="" dateTime={j.checkedAt} className="sb-num text-sm tnum" data-testid="plan-judged-at">{formatJst(new Date(j.checkedAt))}</time>],
              ["地点判定の証跡 ID", <span key="c" data-note="" className={mono} data-testid="plan-check-evidence">{j.checkEvidenceId}</span>],
              ["飛行の方法を含む判定の証跡 ID", <span key="d" data-note="" className={mono} data-testid="plan-diagnosis-evidence">{j.diagnosisEvidenceId}</span>],
              ["エンジンの版", <span key="e" data-note="" className={mono}>{j.engineVersion}</span>],
            ]}
          />
          </details>
          <div className="flex flex-wrap items-center gap-3">
            <Link prefetch={false} href={`/ops/plans/${plan.id}/snapshots/${plan.currentSnapshotId}`} className={buttonOutlineBrandClass} data-testid="plan-basis-link">
              判定の根拠を見る
            </Link>
            <Link prefetch={false} href={`/ops/plans/${plan.id}/snapshots`} className="inline-flex min-h-12 items-center text-sm text-sb-ink underline underline-offset-2" data-testid="plan-snapshots-link">
              判定の履歴を見る
            </Link>
          </div>
          {updatable && !stale ? (
            <div id="rejudge" className="scroll-mt-4">
              <RejudgeButton planId={plan.id} version={plan.version} />
            </div>
          ) : null}
        </Section>

        <Section
          id="permits"
          title="許可・承認の照合"
          aria-label="許可・承認の照合"
          description="計画の許可番号の欄に入れた番号を、登録した許可・承認に結びつけ、計画の日時・場所・飛行の方法・機体・操縦者が範囲に収まるものだけを判定に使います。"
        >
          <PermitDeclaration declaration={planPermits.declaration} noDipsNote={planPermits.noDipsNote} />
          <Note tone="red" body>
            範囲外・期限切れ・失効・取消・未登録・確認できないものは適用せず、要手続きのままです。許可があっても、空港の敷地内と緊急用務空域は飛行不可のままで、
            空港等周辺の個別許可は表示と根拠までで、判定の段は変えません。
          </Note>
          <details data-testid="plan-permit-format-details">
            <summary className="flex min-h-12 cursor-pointer select-none items-center text-sm text-sb-ink underline-offset-2 hover:underline">許可番号の形式について（※要再確認）</summary>
            <p data-note="" className="opx-note" data-testid="plan-permit-format-note">{PERMIT_FORMAT_UNVERIFIED_NOTE}</p>
          </details>
          {planPermits.permits.window ? (
            <p data-note="" className="sb-num text-sm tnum text-sb-ink-2" data-testid="plan-permit-window">
              照合した飛行の日付：{planPermits.permits.window.from === planPermits.permits.window.to ? planPermits.permits.window.from : `${planPermits.permits.window.from} 〜 ${planPermits.permits.window.to}`}
            </p>
          ) : null}
          {!planPermits.judgementUpToDate ? (
            <p className="opx-note opx-note-lg" data-testid="plan-permit-stale">
              ! 登録（または許可番号）が、判定した時点から変わっています。判定をやり直すと、現在の登録で照合し直します。
            </p>
          ) : null}
          <PlanPermitList summary={planPermits.permits} />
          {planPermits.candidates.length > 0 ? (
            <div className="flex flex-col gap-2" data-testid="plan-permit-candidates">
              <p data-note="" className="text-sm font-medium text-sb-ink">範囲に収まる登録済みの許可・承認（候補）</p>
              <p className="text-sb-ink-2">番号を計画の許可番号の欄に入れて保存すると、判定に使われます。提案だけで、いまの判定には使っていません。</p>
              <ul className="flex flex-col border-t border-sb-rule">
                {planPermits.candidates.slice(0, CANDIDATES_SHOWN).map((c) => (
                  <PermitCandidate key={c.registrationId} c={c} />
                ))}
              </ul>
              {planPermits.candidates.length > CANDIDATES_SHOWN ? (
                <details data-testid="plan-permit-candidates-more">
                  <summary className="flex min-h-12 cursor-pointer select-none items-center text-sm font-bold text-sb-ink">ほか {planPermits.candidates.length - CANDIDATES_SHOWN} 件を見る</summary>
                  <ul className="flex flex-col border-t border-sb-rule">
                    {planPermits.candidates.slice(CANDIDATES_SHOWN).map((c) => (
                      <PermitCandidate key={c.registrationId} c={c} />
                    ))}
                  </ul>
                </details>
              ) : null}
              {updatable ? (
                <Link prefetch={false} href={`/ops/plans/${plan.id}/edit`} className={`${buttonOutlineBrandClass} self-start`} data-testid="plan-permit-edit-link">
                  計画を訂正して番号を入れる
                </Link>
              ) : null}
            </div>
          ) : null}
          <div className="flex flex-col gap-1 border-l-2 border-sb-rule pl-3 text-sm leading-relaxed text-sb-ink-2" data-testid="plan-permit-applied-note">
            {isApplicationSupportEnabled() ? (
              <p data-note="">
                「許可・承認の申請済み」の記録（手続きの記録）は利用者の申告で、判定を変えません。許可が下りたら登録し、計画の許可番号の欄に番号を入れると、
                範囲に収まるときだけ判定が変わります。
              </p>
            ) : (
              <p data-note="">許可・承認は、利用者本人が DIPS 2.0 などの公式の手続きで取得します。取得した許可・承認を登録し、計画の許可番号の欄に番号を入れると、範囲に収まるときだけ判定が変わります。</p>
            )}
            <Link prefetch={false} href="/ops/permits" className="inline-flex min-h-12 items-center self-start text-sb-ink underline underline-offset-2" data-testid="plan-permits-link">
              許可・承認の登録を見る
            </Link>
          </div>
        </Section>
    </PlanFrame>
  );
}

type Candidate = Awaited<ReturnType<typeof getPlanPermits>>["candidates"][number];

function PermitCandidate({ c }: { readonly c: Candidate }) {
  return (
    <li className="flex flex-col gap-0.5 border-b border-l-2 border-b-sb-rule border-l-sb-ink py-1 pl-3" data-testid="plan-permit-candidate">
      <span className="break-all sb-num text-sb-ink">{c.permitNumber}</span>
      <span className="text-sb-ink-2">{c.coverageLabel}／{c.kinds.map((k) => k.label).join("、")}／版 {c.versionNo}／{c.validFrom} 〜 {c.validTo}</span>
    </li>
  );
}
