import type { ReactNode } from "react";
import { Icon } from "@/components/ui/icons";
import { StatusLabel } from "@/components/ui/sb-parts";
import { JudgementMissing } from "@/components/ops/plan-ui";
import type { JournalMismatch } from "@/server/ops/journal-logic";
import { fieldGapLabel, type FieldGapLike } from "@/lib/ops-field";
import { formatHm } from "@/lib/ops-time";
import { JUDGEMENT_LINK_MISSING_LABEL, type FlightDto } from "@/server/ops/records";

// 日誌の食い違いの札・離陸時の未了事項の写し（Sprint 12c 設計 D）。知らせるだけで、保存は止めない。
// 札は記号と文字で示す（色だけにしない）。表示の文言はサーバーが導出した label をそのまま使う。

export function MismatchBadges({ mismatches }: { readonly mismatches: readonly JournalMismatch[] }) {
  if (mismatches.length === 0) return null;
  // 注意の印（ui/primitives の StatusPill と同じ作り）。折り返す文なので札の高さは固定せず、アイコンは先頭に揃える。
  return (
    <span className="flex flex-col items-stretch gap-1.5" data-testid="flight-mismatches">
      {mismatches.map((m) => (
        <span
          key={m.code}
          className="flex items-start gap-2 rounded-sb-m border-[1.5px] border-dashed border-sb-ink bg-sb-base px-3 py-2 text-sm leading-snug text-sb-ink [text-wrap:pretty]"
          data-testid="flight-mismatch"
          data-code={m.code}
        >
          <Icon name="alert" size={16} className="mt-0.5 shrink-0 text-sb-ink" />
          <span className="min-w-0">{m.label}</span>
        </span>
      ))}
    </span>
  );
}

export function TakeoffGaps({ gaps }: { readonly gaps: readonly FieldGapLike[] | null }) {
  if (gaps === null) return null;
  return gaps.length === 0 ? (
    <span data-testid="flight-takeoff-gaps-none">離陸の時点で未了の項目はありませんでした。</span>
  ) : (
    <ul className="flex flex-col gap-1" data-testid="flight-takeoff-gaps">
      {gaps.map((g) => (
        <li key={g.item} className="flex items-start gap-2" data-testid="flight-takeoff-gap" data-item={g.item}>
          <Icon name="alert" size={16} className="mt-1 shrink-0 text-sb-ink" />
          <span>{fieldGapLabel(g)}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * 飛行記録の一覧カードの中身（16-J J-1。日誌 /ops/journal と飛行記録の一覧 /ops/flights が同じ）。ListCardLink の中に置く。
 * 見出し（種別 → 状態）→ 飛行年月日 → 離陸–着陸の時刻と飛行時間（数値の強調・tabular-nums）→ 機体／操縦者（一覧では機体の行に機体の総飛行時間、操縦者は次の行）→ 食い違い・判定の根拠の札。
 * 取消済みは、情報の「取消済み」1 つだけを出す（正常・完了と読める表示を出さない。カードは破線の縁。時刻と日付は取り消し線）。
 * 取り消されていない記録には、状態ラベルを付けない（記録の事実だけ。食い違いの札は注意として別に出る）。
 */
export function FlightCardBody({
  f,
  kindTag,
  showTotal = false,
}: {
  readonly f: FlightDto;
  /** 先頭に置く種別の札（日誌の合算の一覧だけ）。 */
  readonly kindTag?: ReactNode;
  /** 機体の総飛行時間を出す（飛行記録の一覧だけ。取消済みは出さない）。 */
  readonly showTotal?: boolean;
}) {
  const muted = f.voided ? "text-sb-ink-3 line-through" : "text-sb-ink";
  return (
    <>
      {f.voided || kindTag ? (
        // 札の並びは日誌の点検のカードと同じ「種別 → 状態」（N-5）
        <span className="flex flex-wrap items-center gap-2">
          {kindTag}
          {f.voided ? (
            <span data-result="voided">
              <StatusLabel tone="info">取消済み</StatusLabel>
            </span>
          ) : null}
        </span>
      ) : null}
      <span className={`text-body font-bold ${muted}`}>
        <span className="sr-only">飛行年月日</span>
        <span className="sb-num">{f.flightDate}</span>
      </span>
      <span className={`flex flex-wrap items-baseline gap-x-4 gap-y-1 ${muted}`} data-testid="journal-row-times">
        <span className="sb-num sb-stat-num" data-testid="journal-row-takeoff-landing">
          <span className="sr-only">離陸から着陸</span>
          {f.takeoffAtJst.slice(11)}–{f.landingAtJst}
        </span>
        <span className="inline-flex items-baseline gap-2">
          <span data-note="" className="text-sm font-medium text-sb-ink-2">
            飛行時間
          </span>
          <span className="sb-num sb-stat-num" data-testid="journal-row-minutes">
            {formatHm(f.flightMinutes)}
          </span>
        </span>
      </span>
      {showTotal ? (
        // 飛行記録の一覧：機体の行（登録記号＋機体の総飛行時間）と操縦者の行を分ける。総飛行時間が操縦者のものと読めないように、操縦者より前、登録記号のすぐ隣に置く（R-2）
        <>
          <span data-note="" className="flex flex-wrap items-baseline gap-x-4 gap-y-0.5 break-words text-sb-ink-2">
            <span className="sr-only">機体</span>
            <span className="sb-num break-all font-semibold text-sb-ink">{f.registrationMark}</span>
            {f.totalFlightMinutes !== null ? (
              <span className="inline-flex items-baseline gap-1.5">
                <span className="text-sb-ink-3">機体の総飛行時間</span>
                <span className="sb-num font-semibold text-sb-ink" data-testid="journal-row-total">
                  {formatHm(f.totalFlightMinutes)}
                </span>
              </span>
            ) : null}
          </span>
          <span data-note="" className="break-words text-sb-ink-2">
            <span className="text-sb-ink-3">操縦者 </span>
            {f.pilotName}
          </span>
        </>
      ) : (
        <span data-note="" className="break-words text-sb-ink-2">
          <span className="sr-only">機体</span>
          <span className="sb-num break-all">{f.registrationMark}</span>
          <span className="mx-1.5" aria-hidden="true">
            ／
          </span>
          <span className="text-sb-ink-3">操縦者 </span>
          {f.pilotName}
        </span>
      )}
      <MismatchBadges mismatches={f.mismatches} />
      {f.judgementLink === "missing" ? (
        <span data-testid="flight-judgement-missing">
          <JudgementMissing label={JUDGEMENT_LINK_MISSING_LABEL} />
        </span>
      ) : null}
    </>
  );
}
