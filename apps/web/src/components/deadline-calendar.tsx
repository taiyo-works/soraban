"use client";

import {
  classifyDeadlineUrgency,
  daysBetween,
  toJstIsoDate,
  type DeadlineUrgency,
  type RequiredProcedure,
} from "@soraban/regulations";
import type { DiagnoseResponse } from "@/lib/diagnose";

type Props = {
  readonly diagnosis: DiagnoseResponse;
  /** 入力中の飛行予定日（ISO 日付）。未入力なら空文字。期限算出の根拠表示に使う。 */
  readonly plannedDate: string;
};

// 逼迫度 → North Star 信号色のトーン。意味の担い手はラベル（urgencyLabel）であり、
// 色は補助。overdue=red / urgent=amber / ok=green-ish（通常）/ none=控えめ。
// mark: 製図記号（procedure-card / diagnosis-panel と同じ語彙）で色に頼らない符号化。
//   diamond=ok / square=urgent / triangle=overdue。aria-hidden 前提（装飾）。
const urgencyTone: Readonly<
  Record<
    DeadlineUrgency,
    {
      rule: string;
      accent: string;
      surface: string;
      label: string;
      mark: "diamond" | "square" | "triangle" | "none";
    }
  >
> = {
  overdue: {
    rule: "border-sb-v-no-fg",
    accent: "text-sb-v-no-fg",
    surface: "bg-sb-surface",
    label: "期限超過",
    mark: "triangle",
  },
  urgent: {
    rule: "border-sb-v-needs-fg",
    accent: "text-sb-v-needs-fg",
    surface: "bg-sb-surface",
    label: "期限が近い",
    mark: "square",
  },
  ok: {
    rule: "border-sb-v-none-fg",
    accent: "text-sb-v-none-fg",
    surface: "bg-sb-base",
    label: "余裕あり",
    mark: "diamond",
  },
  none: {
    rule: "border-sb-rule",
    accent: "text-sb-ink-3",
    surface: "bg-sb-base",
    label: "—",
    mark: "none",
  },
};

// 残り日数の人間可読表現。
const remainingLabel = (todayIso: string, submitBy: string): string => {
  const remaining = daysBetween(todayIso, submitBy);
  if (remaining === null) return "";
  if (remaining < 0) return `${Math.abs(remaining)} 日 超過`;
  if (remaining === 0) return "本日が期限";
  return `残り ${remaining} 日`;
};

// ISO 日付 → 年・月日・曜日に分解。「2026 / 07/16（木）」を組版する素材にする。
const WEEKDAY_JA = ["日", "月", "火", "水", "木", "金", "土"] as const;
type DateParts = { readonly year: string; readonly md: string; readonly weekday: string };
const splitJaDate = (iso: string): DateParts | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const weekday = WEEKDAY_JA[new Date(`${iso}T00:00:00Z`).getUTCDay()] ?? "";
  return { year: m[1]!, md: `${m[2]}/${m[3]}`, weekday };
};
// 飛行予定日ヘッダ等のインライン表記用「2026/07/16（木）」。
const formatJaDate = (iso: string): string => {
  const p = splitJaDate(iso);
  return p ? `${p.year}/${p.md}（${p.weekday}）` : iso;
};

// 逼迫度の製図記号。CSS の border だけで描く（新規トークン・画像・絵文字を増やさない）。
function UrgencyMark({
  shape,
  className,
}: {
  shape: "diamond" | "square" | "triangle" | "none";
  className?: string;
}) {
  if (shape === "triangle") {
    return (
      <span
        aria-hidden
        className={`inline-block h-0 w-0 border-x-[5px] border-b-[9px] border-x-transparent border-b-current ${className ?? ""}`}
      />
    );
  }
  if (shape === "square") {
    return <span aria-hidden className={`inline-block h-2 w-2 bg-current ${className ?? ""}`} />;
  }
  if (shape === "diamond") {
    return (
      <span aria-hidden className={`inline-block h-2 w-2 rotate-45 bg-current ${className ?? ""}`} />
    );
  }
  return null;
}

export function DeadlineCalendar({ diagnosis, plannedDate }: Props) {
  const todayIso = toJstIsoDate();

  // 提出期限の逆算対象（leadTime > 0）の手続きだけを対象にする。
  // deadlines は leadTime 0 を既に除外済みなので、procedures との突合で順序を保つ。
  const deadlineMap = new Map(diagnosis.deadlines.map((d) => [d.procedureId, d]));
  const items: ReadonlyArray<{
    readonly procedure: RequiredProcedure;
    readonly submitBy?: string;
    readonly basis: string;
  }> = diagnosis.procedures
    .filter((p) => deadlineMap.has(p.id))
    .map((p) => {
      const d = deadlineMap.get(p.id)!;
      return { procedure: p, submitBy: d.submitBy, basis: d.basis };
    });

  const hasPlannedDate = plannedDate.trim().length > 0;

  return (
    <section className="flex flex-col gap-3" aria-labelledby="deadline-calendar-heading">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <p id="deadline-calendar-heading" className="sb-eyebrow">
          提出期限カレンダー
        </p>
        {hasPlannedDate ? (
          // 起算日（飛行予定日）。すべての提出期限はここから逆算される — その関係を
          // 「起算日 →」のラベルで明示し、日付は mono の tnum で固定幅に揃える。
          <p className="flex items-baseline gap-2 text-xs tracking-wide text-sb-ink-3">
            <span aria-hidden className="inline-block h-1.5 w-1.5 rotate-45 border border-sb-edge" />
            起算日 — 飛行予定日
            <span className="tnum text-xs font-medium normal-case tracking-normal text-sb-ink">
              {formatJaDate(plannedDate)}
            </span>
          </p>
        ) : null}
      </div>

      {/* 飛行予定日 未入力時のガイダンス（誤った日付を出さない契約）。
          S1 の空状態と同じ border-dashed の控えめなプレースホルダ体裁で統一する。 */}
      {!hasPlannedDate ? (
        <div className="flex items-start gap-3 border border-dashed border-sb-rule bg-sb-base px-4 py-5 text-sm leading-relaxed text-sb-ink-2 rounded-sb-m">
          <span
            aria-hidden
            className="mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rotate-45 bg-sb-ink-3"
          />
          <span>
            飛行予定日を入力してください。飛行日が決まると、各手続きの提出期限（飛行日 −
            10 開庁日・土日祝を除く）を具体的な日付で表示します。
          </span>
        </div>
      ) : items.length === 0 ? (
        <p className="border border-dashed border-sb-rule bg-sb-base px-4 py-5 text-sm leading-relaxed text-sb-ink-2 rounded-sb-m">
          提出期限の逆算対象となる申請手続き（許可・承認）はありません。
        </p>
      ) : (
        <ol className="flex flex-col">
          {items.map(({ procedure, submitBy, basis }, idx) => {
            const urgency = classifyDeadlineUrgency(
              submitBy,
              todayIso,
              procedure.leadTimeBusinessDays,
            );
            const tone = urgencyTone[urgency];
            const isOverdue = urgency === "overdue";
            const parts = submitBy ? splitJaDate(submitBy) : null;
            return (
              <li
                key={procedure.id}
                className={`group/row relative grid grid-cols-[auto_1fr] items-stretch gap-x-3 border-l-2 ${tone.rule} ${tone.surface} ${
                  idx > 0 ? "mt-px" : ""
                } sm:grid-cols-[auto_1fr_auto]`}
              >
                {/* 行番号（register の通し番号）。coverage 一覧・手続きカードと同じ
                    mono 数字の語彙で「台帳の一葉」感を出す。 */}
                <span
                  aria-hidden
                  className="flex select-none items-center justify-center self-stretch border-r border-sb-rule px-2.5 sb-num text-xs tnum text-sb-ink-3"
                >
                  {String(idx + 1).padStart(2, "0")}
                </span>

                {/* 手続き名 + 逆算根拠（「何を」を担う列）。 */}
                <div className="flex flex-col justify-center gap-0.5 py-3 pr-3 sm:pr-0">
                  <span className=" text-sm font-medium leading-snug text-sb-ink">
                    {procedure.title}
                  </span>
                  <span className="text-xs leading-relaxed text-sb-ink-3">
                    {procedure.leadTimeBusinessDays} 開庁日前まで（土日・国民の祝日を除く）
                  </span>
                </div>

                {/* 期限日（「いつまで」を担う列＝この行の主役）。
                    日付を  の大きめ数字で組み、残り日数とアラートを真下に重ねる。 */}
                <div className="col-span-2 flex items-center justify-between gap-3 border-t border-sb-rule px-3 py-2.5 sm:col-span-1 sm:flex-col sm:items-end sm:justify-center sm:border-l sm:border-t-0 sm:py-3 sm:pl-4">
                  {submitBy && parts ? (
                    <>
                      {/* 主役の日付。MM/DD は ink で最大の可読性（WCAG AA）を確保し、
                          逼迫度は先頭の製図記号（accent 色）と下のバッジ・左罫・地色で符号化する。 */}
                      <p className="flex items-baseline gap-1.5  leading-none tnum text-sb-ink">
                        <span className={`flex items-baseline self-center ${tone.accent}`}>
                          <UrgencyMark shape={tone.mark} />
                        </span>
                        <span className="text-xs font-normal text-sb-ink-3 tnum">
                          {parts.year}
                        </span>
                        <span className="text-xl font-medium tracking-tight tnum sm:text-2xl">
                          {parts.md}
                        </span>
                        <span className="text-xs font-normal text-sb-ink-3">（{parts.weekday}）</span>
                      </p>

                      {/* アラート＝色＋符号＋テキストの三重符号化。
                          overdue は赤の塗りバッジで最も強く、urgent は amber 罫、ok は控えめ。 */}
                      <span
                        className={`inline-flex shrink-0 items-center gap-1.5 border px-2 py-1 sb-num text-xs uppercase tracking-wider ${
                          isOverdue
                            ? "border-sb-v-no-fg bg-sb-v-no-fg font-medium text-sb-base"
                            : `${tone.rule} bg-sb-base text-sb-ink-2`
                        }`}
                      >
                        {/* 逼迫度の符号（色）は glyph と枠線が担い、ラベル文字は ink-soft で可読性を確保。 */}
                        <span className={isOverdue ? "" : tone.accent}>
                          <UrgencyMark shape={tone.mark} />
                        </span>
                        <span>{tone.label}</span>
                        <span aria-hidden className="opacity-40">
                          ·
                        </span>
                        <span className="tnum normal-case tracking-normal">
                          {remainingLabel(todayIso, submitBy)}
                        </span>
                      </span>
                    </>
                  ) : (
                    <span className="sb-num text-xs text-sb-ink-3">{basis}</span>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {/* 期限は目安である旨の断り（spec §11-C: 標準処理期間は目安）。 */}
      {hasPlannedDate && items.length > 0 ? (
        <p className="text-xs leading-relaxed text-sb-ink-3">
          ※ 「飛行開始の 10 開庁日以上前」を計算根拠としていますが、標準処理期間は目安であり、
          確定的な法定処理期間ではありません（内容により前後します）。祝日は内閣府公開データに基づきます。
          最終的な提出可否は DIPS／航空局でご確認ください。
        </p>
      ) : null}
    </section>
  );
}
