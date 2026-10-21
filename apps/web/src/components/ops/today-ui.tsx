import type { TodayBadgeDto, TodayCardDto, TodayDto, TodayRowDto } from "@/server/ops/today";
import type { TodayNextAction } from "@/server/ops/today-logic";
import { NextActionItem } from "./plan-ui";
import { buttonFieldClass, buttonOutlineBrandClass, Badge, type Tone } from "./ui";

// 「今日」の部品（Sprint 12c 設計 C・G）。サーバー・クライアントのどちらからも使える（描くだけで、判断はしない）。
// 状況は、色だけでなく記号と文字で示す。見た目は最低限（designer が磨く）。

const BADGE_TONE: Readonly<Record<TodayBadgeDto["code"], Tone>> = {
  in_flight: "brand",
  journal_pending: "amber",
  journaled: "green",
  ended: "mute",
  planned: "neutral",
};

export function TodayBadge({ badge }: { readonly badge: TodayBadgeDto }) {
  return (
    <Badge tone={BADGE_TONE[badge.code]} data-testid="today-badge" data-code={badge.code}>
      <span aria-hidden>{badge.mark} </span>
      {badge.label}
    </Badge>
  );
}

/** 今日（なければ次）の飛行の大きなカード 1 枚。主ボタンは 1 つだけ。 */
export function TodayCard({ card }: { readonly card: TodayCardDto }) {
  return (
    <section
      aria-label={card.reasonLabel}
      className="flex flex-col gap-4 rounded-sharp border-2 border-brand-700 bg-paper px-4 py-5"
      data-testid="today-card"
      data-reason={card.reason}
      data-plan-id={card.planId}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className="eyebrow" data-testid="today-card-reason">
          {card.reasonLabel}
        </p>
        <TodayBadge badge={card.badge} />
      </div>
      <div className="flex flex-col gap-1">
        <p className="font-mono text-3xl tnum text-ink" data-testid="today-card-time">
          {card.timeLabel}
        </p>
        <p className="text-xs text-ink-soft" data-testid="today-card-date">
          {card.plannedDate}
        </p>
        <h2 className="font-display text-2xl font-light leading-snug text-ink" data-testid="today-card-title">
          {card.title}
        </h2>
      </div>
      <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
        <div className="flex flex-col">
          <dt className="text-xs text-ink-soft">機体</dt>
          <dd data-testid="today-card-aircraft">
            <span className="font-mono">{card.registrationMark}</span>（{card.modelName}）
          </dd>
        </div>
        <div className="flex flex-col">
          <dt className="text-xs text-ink-soft">操縦者</dt>
          <dd data-testid="today-card-pilot">{card.pilotName}</dd>
        </div>
        <div className="flex flex-col">
          <dt className="text-xs text-ink-soft">判定の段階</dt>
          <dd data-testid="today-card-verdict">
            {card.verdictLabel}
            {card.judgementStale ? "（判定が古い）" : ""}
          </dd>
        </div>
        <div className="flex flex-col">
          <dt className="text-xs text-ink-soft">通報の状況</dt>
          <dd data-testid="today-card-report">
            <span aria-hidden>{card.report.statusMark} </span>
            {card.report.requirementLabel}／{card.report.statusLabel}
          </dd>
        </div>
        <div className="flex flex-col sm:col-span-2">
          <dt className="text-xs text-ink-soft">確認の状況</dt>
          <dd data-testid="today-card-confirmation">{card.confirmation.label}</dd>
        </div>
      </dl>
      <a href={card.primary.href} className={`${buttonFieldClass} w-full sm:w-auto sm:self-start`} data-testid="today-card-primary" data-kind={card.primary.kind}>
        {card.primary.label}
      </a>
    </section>
  );
}

/** 今日の残りの計画：1 行ずつ（時間・名称・状況の札）。 */
export function TodayRest({ rows }: { readonly rows: readonly TodayRowDto[] }) {
  if (rows.length === 0) return null;
  return (
    <section aria-label="今日の残りの飛行" className="flex flex-col gap-2" data-testid="today-rest">
      <h2 className="eyebrow">今日の残りの飛行</h2>
      <ul className="flex flex-col divide-y divide-rule-soft rounded-sharp border border-rule bg-paper">
        {rows.map((r) => (
          <li key={r.planId} data-testid="today-rest-row">
            <a href={r.href} className="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-3 text-sm hover:bg-paper-soft" data-testid="today-rest-link">
              <span className="font-mono tnum text-ink">{r.timeLabel}</span>
              <span className="min-w-0 flex-1 break-words text-ink">{r.title}</span>
              <TodayBadge badge={r.badge} />
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** 空の状態：何がないかと、次にできること（件数だけのタイルは作らない）。 */
export function TodayEmpty({ empty }: { readonly empty: NonNullable<TodayDto["empty"]> }) {
  return (
    <section aria-label="今日の飛行" className="flex flex-col gap-4 rounded-sharp border border-rule bg-paper px-4 py-5" data-testid="today-empty">
      <p className="text-base text-ink" data-testid="today-empty-message">
        {empty.message}
      </p>
      <div className="flex flex-col gap-3 sm:flex-row">
        {empty.actions.map((a, i) => (
          <a key={a.href} href={a.href} className={i === 0 ? buttonFieldClass : buttonOutlineBrandClass.replace("min-h-11", "min-h-14")} data-testid="today-empty-action">
            {a.label}
          </a>
        ))}
      </div>
    </section>
  );
}

/** 次にやること（動詞で始まる 1 行、押すとその作業へ直接）。どの計画の作業かを添える。 */
export function TodayNextActions({
  actions,
  total,
  plansHref,
  heading = true,
}: {
  readonly actions: readonly TodayNextAction[];
  readonly total?: number;
  readonly plansHref?: string;
  readonly heading?: boolean;
}) {
  return (
    <section aria-label="次にやること" className="flex flex-col gap-2" data-testid="today-next-actions">
      {heading ? <h2 className="eyebrow">次にやること{total ? <span className="ml-2 font-mono tnum normal-case tracking-normal">{total} 件</span> : null}</h2> : null}
      {actions.length === 0 ? (
        <p className="rounded-sharp border border-rule bg-paper px-3 py-3 text-sm text-ink-soft" data-testid="today-next-actions-empty">
          いま、やることはありません。
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-rule-soft rounded-sharp border border-rule bg-paper">
          {actions.map((a, i) => (
            <li key={`${a.id}-${a.planId ?? ""}-${i}`} data-testid="today-next-action" data-action-id={a.id} data-tier={String(a.tier)} data-plan-id={a.planId ?? ""}>
              {a.planTitle ? (
                <p className="px-3 pt-2 text-xs text-ink-soft" data-testid="today-next-action-plan">
                  {a.planTitle}
                </p>
              ) : null}
              <NextActionItem action={a} testId="today-next-action" />
            </li>
          ))}
        </ul>
      )}
      {plansHref ? (
        <a href={plansHref} className="inline-flex min-h-11 items-center self-start text-sm text-brand-700 underline underline-offset-2" data-testid="today-plans-link">
          計画の一覧へ
        </a>
      ) : null}
    </section>
  );
}

