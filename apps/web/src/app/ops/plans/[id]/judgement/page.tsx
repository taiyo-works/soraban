import Link from "next/link";
import { PLAN_JUDGEMENT_DISCLAIMER, type FlightVerdict } from "@soraban/regulations";
import { ChangeNotice } from "@/components/ops/change-notice";
import { PermitDeclaration, PlanPermitList } from "@/components/ops/permit-ui";
import { PlanFrame } from "@/components/ops/plan-frame";
import { RejudgeButton } from "@/components/ops/plans-client";
import { buttonOutlineBrandClass, DetailList, Note, Section, VERSION_NOTICE_TARGET } from "@/components/ops/ui";
import { VerdictSummary } from "@/components/verdict-summary";
import { isApplicationSupportEnabled } from "@/lib/boundary";
import { formatJst } from "@/lib/ops-time";
import { PERMIT_FORMAT_UNVERIFIED_NOTE } from "@/server/ops/permit-logic";
import { verdictPermitNotes } from "@/server/ops/permit-page";
import { getPlanPermits } from "@/server/ops/permits";
import { canUpdatePlan } from "@/server/ops/plan-page";
import { getSnapshot } from "@/server/ops/plans";
import { loadPlan } from "../_load";

const mono = "sb-num text-sm tnum break-all";

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

  return (
    <PlanFrame plan={plan} eyebrow="判定（補助）" back={{ href: `/ops/plans/${plan.id}`, label: "通報の状況" }}>
      {/* 再判定の直後の結果の通知（版の一覧は /overview にあるため、ここでも受け取る） */}
      <ChangeNotice target={VERSION_NOTICE_TARGET} />
      <p className="opx-note" data-testid="plan-disclaimer">
        {PLAN_JUDGEMENT_DISCLAIMER}
      </p>

        <Section
          id="sec-verdict"
          title="判定の要約"
          aria-label="判定の要約"
          description="結論と、判定の根拠です。計画を保存したときに、サーバーが実行した判定（現在のスナップショット）です。"
        >
          {/* 判定エンジンの文言を出す領域の印（Sprint 18-3。限定語の検査から外す。lib/wording-policy.ts） */}
          <div data-wording-scope="judgement" data-testid="judgement-scope-plan">
            <VerdictSummary verdict={verdict} pending={false} failed={verdict === undefined} permitNotes={permitNotes} />
          </div>
          <details data-testid="plan-judgement-details">
            <summary className="flex min-h-12 cursor-pointer select-none items-center text-sm font-bold text-sb-ink">判定の記録（通し番号・日時・証跡 ID・エンジンの版）</summary>
          <DetailList
            compact
            data-testid="plan-judgement"
            rows={[
              ["判定の通し番号", <span key="n" data-testid="plan-snapshot-seq">{j.seq}</span>],
              ["判定の日時（日本時間）", <time key="t" dateTime={j.checkedAt} className="sb-num text-sm tnum" data-testid="plan-judged-at">{formatJst(new Date(j.checkedAt))}</time>],
              ["地点判定の証跡 ID", <span key="c" className={mono} data-testid="plan-check-evidence">{j.checkEvidenceId}</span>],
              ["飛行の方法を含む判定の証跡 ID", <span key="d" className={mono} data-testid="plan-diagnosis-evidence">{j.diagnosisEvidenceId}</span>],
              ["エンジンの版", <span key="e" className={mono}>{j.engineVersion}</span>],
            ]}
          />
          </details>
          {plan.freshness.stale ? (
            <div className="flex flex-col gap-2 border-l-2 border-sb-ink pl-3" data-testid="plan-stale-box">
              <p className="text-sm font-medium text-sb-ink">判定が古くなっています</p>
              <ul className="list-disc pl-5 text-sm text-sb-ink-2" data-testid="plan-stale-reasons">
                {plan.freshness.reasons.map((r) => (
                  <li key={r.code}>{r.label}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            <Link prefetch={false} href={`/ops/plans/${plan.id}/snapshots/${plan.currentSnapshotId}`} className={buttonOutlineBrandClass} data-testid="plan-basis-link">
              判定の根拠を見る
            </Link>
            <Link prefetch={false} href={`/ops/plans/${plan.id}/snapshots`} className="inline-flex min-h-11 items-center text-sm text-sb-ink underline underline-offset-2" data-testid="plan-snapshots-link">
              判定の履歴を見る
            </Link>
          </div>
          {updatable ? (
            <div id="rejudge" className="scroll-mt-4">
              <RejudgeButton planId={plan.id} version={plan.version} highlight={plan.freshness.stale} />
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
          <Note tone="red">
            範囲外・期限切れ・失効・取消・未登録・確認できないものは適用せず、要手続きのままです。許可があっても、空港の敷地内と緊急用務空域は飛行不可のままで、
            空港等周辺の個別許可は表示と根拠までで、判定の段は変えません。
          </Note>
          <details data-testid="plan-permit-format-details">
            <summary className="flex min-h-12 cursor-pointer select-none items-center text-sm text-sb-ink underline-offset-2 hover:underline">許可番号の形式について（※要再確認）</summary>
            <p className="opx-note" data-testid="plan-permit-format-note">{PERMIT_FORMAT_UNVERIFIED_NOTE}</p>
          </details>
          {planPermits.permits.window ? (
            <p className="sb-num text-sm tnum text-sb-ink-2" data-testid="plan-permit-window">
              照合した飛行の日付：{planPermits.permits.window.from === planPermits.permits.window.to ? planPermits.permits.window.from : `${planPermits.permits.window.from} 〜 ${planPermits.permits.window.to}`}
            </p>
          ) : null}
          {!planPermits.judgementUpToDate ? (
            <p className="opx-note" data-testid="plan-permit-stale">
              ! 登録（または許可番号）が、判定した時点から変わっています。判定をやり直すと、現在の登録で照合し直します。
            </p>
          ) : null}
          <PlanPermitList summary={planPermits.permits} />
          {planPermits.candidates.length > 0 ? (
            <div className="flex flex-col gap-2" data-testid="plan-permit-candidates">
              <p className="text-sm font-medium text-sb-ink">範囲に収まる登録済みの許可・承認（候補）</p>
              <p className="text-sm leading-relaxed text-sb-ink-2">番号を計画の許可番号の欄に入れて保存すると、判定に使われます。提案だけで、いまの判定には使っていません。</p>
              <ul className="flex flex-col border-t border-sb-rule">
                {planPermits.candidates.map((c) => (
                  <li key={c.registrationId} className="flex flex-col gap-0.5 border-b border-l-2 border-b-sb-rule border-l-sb-ink py-2.5 pl-3 text-sm" data-testid="plan-permit-candidate">
                    <span className="break-all sb-num text-sm text-sb-ink">{c.permitNumber}</span>
                    <span className="text-sm text-sb-ink-2">{c.coverageLabel}／{c.kinds.map((k) => k.label).join("、")}／版 {c.versionNo}／{c.validFrom} 〜 {c.validTo}</span>
                  </li>
                ))}
              </ul>
              {updatable ? (
                <Link prefetch={false} href={`/ops/plans/${plan.id}/edit`} className={`${buttonOutlineBrandClass} self-start`} data-testid="plan-permit-edit-link">
                  計画を訂正して番号を入れる
                </Link>
              ) : null}
            </div>
          ) : null}
          <div className="flex flex-col gap-1 border-l-2 border-sb-rule pl-3 text-sm leading-relaxed text-sb-ink-2" data-testid="plan-permit-applied-note">
            {isApplicationSupportEnabled() ? (
              <p>
                「許可・承認の申請済み」の記録（手続きの記録）は利用者の申告で、判定を変えません。許可が下りたら登録し、計画の許可番号の欄に番号を入れると、
                範囲に収まるときだけ判定が変わります。
              </p>
            ) : (
              <p>許可・承認は、利用者本人が DIPS 2.0 などの公式の手続きで取得します。取得した許可・承認を登録し、計画の許可番号の欄に番号を入れると、範囲に収まるときだけ判定が変わります。</p>
            )}
            <Link prefetch={false} href="/ops/permits" className="inline-flex min-h-11 items-center self-start text-sb-ink underline underline-offset-2" data-testid="plan-permits-link">
              許可・承認の登録を見る
            </Link>
          </div>
        </Section>
    </PlanFrame>
  );
}
