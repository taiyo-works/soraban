"use client";

// ホームの準備カード（Sprint 16-G。契約 HM-1 ②・HM-5。語と状態の選び方は server/ops/prep-card-logic.ts）。
// 3 行（通報・飛行前点検・判定（参考））を、記号＋文字で出す。帯の色は 3 行のうちいちばん重い状態（色は補助）。
// 判定の行が取れないとき（判定の記録が無い・読み込みの失敗）は、行の中に「未確認」と「再読み込み」を出し、画面の他の部分は出る。
// 判定の記録が無いときは判定の画面の再判定へのリンク、通信の失敗のときは「再読み込み」。
// 描くだけで判断はしない。「再読み込み」のために、クライアントの部品にしている（ページを開き直すだけで、何も送らない・保存しない）。
import { VerdictSign, PillButton, PillLink } from "@/components/ui/sb-parts";
import {
  PREP_INSPECTION_LABEL,
  PREP_JUDGEMENT_LABEL,
  PREP_JUDGEMENT_NOTE,
  PREP_REPORT_LABEL,
  PREP_TITLE,
  prepModel,
  type PrepInput,
  type PrepRow,
  type PrepTone,
} from "@/server/ops/prep-card-logic";

function Row({ id, label, row, foot, planId }: { readonly id: string; readonly label: string; readonly row: PrepRow; readonly foot?: string; readonly planId?: string }) {
  return (
    <li className="home-prep-row" data-tone={row.tone} data-testid={`home-prep-${id}`}>
      <span className="home-prep-sign">
        <VerdictSign level={row.level} />
      </span>
      <span className="home-prep-k">{label}</span>
      <span className="home-prep-v" data-testid={`home-prep-${id}-text`}>
        {row.text}
      </span>
      {row.action === "reload" ? (
        <PillButton small className="home-prep-reload" data-testid="home-prep-reload" onClick={() => window.location.reload()}>
          再読み込み
        </PillButton>
      ) : null}
      {row.action === "rejudge" && planId ? (
        // 判定の記録が無いときは、判定の画面の再判定（既存の plan-rejudge の導線）へ。ページを開き直しても記録は増えない
        <PillLink small className="home-prep-reload" href={`/ops/plans/${planId}/judgement#rejudge`} data-testid="home-prep-rejudge">
          再判定へ
        </PillLink>
      ) : null}
      {row.note ? (
        <span data-note="" className="home-prep-note" data-testid={`home-prep-${id}-note`}>
          {row.note}
        </span>
      ) : null}
      {foot ? (
        <span data-note="" className="home-prep-foot" data-testid="home-prep-note">
          {foot}
        </span>
      ) : null}
    </li>
  );
}

export function HomePrepCard({ input, when, place, planId }: { readonly input: PrepInput; /** 日時（補足） */ readonly when: string; readonly place: string; /** 再判定の行き先（判定の記録が無いとき） */ readonly planId?: string }) {
  const m = prepModel(input);
  const tone: PrepTone = m.tone;
  return (
    <section
      className="sb-card sb-card-state home-prep"
      {...(tone !== "unknown" ? { "data-state": tone } : {})}
      data-tone={tone}
      aria-label={m.readout}
      data-testid="home-prep"
    >
      <div className="home-prep-head">
        <h2 className="home-prep-title" data-testid="home-prep-title">
          {PREP_TITLE}
        </h2>
        <span data-note="" className="home-prep-when" data-testid="home-prep-when" title={`${when}　${place}`}>
          {when}　{place}
        </span>
      </div>
      <ul className="home-prep-rows">
        <Row id="report" label={PREP_REPORT_LABEL} row={m.report} />
        <Row id="inspection" label={PREP_INSPECTION_LABEL} row={m.inspection} />
        <Row id="judgement" label={PREP_JUDGEMENT_LABEL} row={m.judgement} foot={PREP_JUDGEMENT_NOTE} {...(planId ? { planId } : {})} />
      </ul>
    </section>
  );
}
