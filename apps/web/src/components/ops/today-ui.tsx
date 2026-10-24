import type { ReactNode } from "react";
import type { IconName } from "@/components/ui/icons";
import { Icon } from "@/components/ui/icons";
import { JourneyLine } from "@/components/ui/journey-line";
import { buttonClass, Card, SectionTitle, StatusPill, type Meaning } from "@/components/ui/primitives";
import type { DeadlineDto } from "@/server/ops/deadlines-logic";
import type { TodayBadgeDto, TodayCardDto, TodayDto, TodayRowDto, TodayUpcomingDto } from "@/server/ops/today";
import type { TodayNextAction } from "@/server/ops/today-logic";
import { NextActionItem } from "./plan-ui";
import { Badge, type Tone } from "./ui";

// ホームの部品（Sprint 12c 設計 C・G。Sprint 12g-1b で新しい部品（components/ui）に作り直した）。
// サーバー・クライアントのどちらからも使える（描くだけで、判断はしない）。状態は、色だけでなく記号と文字で示す。
// TodayBadge と TodayNextActions は `/`（判定画面）の「ホーム」の帯も使う（`/` は 12g-1b の B で紙面にする）。

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

const STATUS: Readonly<Record<TodayBadgeDto["code"], { readonly meaning: Meaning; readonly icon: IconName }>> = {
  in_flight: { meaning: "info", icon: "flight" },
  journal_pending: { meaning: "warn", icon: "alert" },
  journaled: { meaning: "ok", icon: "check-circle" },
  ended: { meaning: "neutral", icon: "dot" },
  planned: { meaning: "neutral", icon: "clock" },
};

/** 状況の札（飛行中・日誌待ち・日誌済み・終了・予定）。アイコンと文字で示す。 */
export function TodayStatus({ badge }: { readonly badge: TodayBadgeDto }) {
  const s = STATUS[badge.code];
  return (
    <StatusPill meaning={s.meaning} icon={s.icon} data-testid="today-badge" data-code={badge.code}>
      {badge.label}
    </StatusPill>
  );
}

/** 運航票の 1 行（項目名＋値）。 */
function Fact({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-baseline gap-x-3 py-2">
      <dt className="text-aux text-fg-mute">{label}</dt>
      <dd className="min-w-0 break-words text-table text-fg">{children}</dd>
    </div>
  );
}

/**
 * 今日（なければ次）の飛行の大きなカード 1 枚。主ボタンは 1 つだけ（当日は「現場モードを開く」）。
 * 読む順は、時刻と名称 → 行程の 1 行 → 判定の段階・通報・確認 → 機体・操縦者。
 */
export function TodayCard({ card }: { readonly card: TodayCardDto }) {
  return (
    <Card
      as="section"
      variant="primary"
      aria-label={card.reasonLabel}
      data-testid="today-card"
      data-reason={card.reason}
      data-plan-id={card.planId}
      className="flex flex-col gap-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <p className="text-aux font-medium text-fg-soft" data-testid="today-card-reason">
          {card.reasonLabel}
        </p>
        <TodayStatus badge={card.badge} />
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-stat font-semibold leading-none tabular-nums text-fg" data-testid="today-card-time">
          {card.timeLabel}
        </p>
        <p className="text-table tabular-nums text-fg-mute" data-testid="today-card-date">
          {card.plannedDate}
        </p>
        <h2 className="mt-1 text-h2 font-semibold text-fg" data-testid="today-card-title">
          {card.title}
        </h2>
      </div>
      <JourneyLine stages={card.journey} />
      <dl className="flex flex-col divide-y divide-line border-y border-line">
        <Fact label="判定の段階">
          <span className="font-medium" data-testid="today-card-verdict">
            {card.verdictLabel}
            {card.judgementStale ? "（判定が古い）" : ""}
          </span>
        </Fact>
        <Fact label="通報の状況">
          <span data-testid="today-card-report">
            <span aria-hidden>{card.report.statusMark} </span>
            {card.report.requirementLabel}／{card.report.statusLabel}
          </span>
        </Fact>
        <Fact label="確認の状況">
          <span data-testid="today-card-confirmation">{card.confirmation.label}</span>
        </Fact>
        <Fact label="機体">
          <span data-testid="today-card-aircraft">
            <span className="tabular-nums">{card.registrationMark}</span>（{card.modelName}）
          </span>
        </Fact>
        <Fact label="操縦者">
          <span data-testid="today-card-pilot">{card.pilotName}</span>
        </Fact>
      </dl>
      <a href={card.primary.href} className={buttonClass("primary", "md", "min-h-14 w-full sm:w-auto sm:self-start")} data-testid="today-card-primary" data-kind={card.primary.kind}>
        <Icon name={card.primary.kind === "field" ? "flight" : "plan"} size={18} />
        {card.primary.label}
      </a>
    </Card>
  );
}

/** 今日の残りの計画：1 行ずつ（時間・名称・状況の札）。 */
export function TodayRest({ rows }: { readonly rows: readonly TodayRowDto[] }) {
  if (rows.length === 0) return null;
  return (
    <section aria-label="今日の残りの飛行" className="flex flex-col gap-2" data-testid="today-rest">
      <SectionTitle>今日の残りの飛行</SectionTitle>
      <ul className="flex flex-col divide-y divide-line border-y border-line">
        {rows.map((r) => (
          <li key={r.planId} data-testid="today-rest-row">
            <a href={r.href} className="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-1 py-2 text-table transition-colors hov:bg-accent-soft" data-testid="today-rest-link">
              <span className="tabular-nums text-fg">{r.timeLabel}</span>
              <span className="min-w-0 flex-1 break-words text-body font-medium text-fg">{r.title}</span>
              <TodayStatus badge={r.badge} />
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
    <Card as="section" variant="primary" aria-label="今日の飛行" className="flex flex-col gap-4" data-testid="today-empty">
      <p className="text-h2 font-semibold text-fg" data-testid="today-empty-message">
        {empty.message}
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        {empty.actions.map((a, i) => (
          <a key={a.href} href={a.href} className={buttonClass(i === 0 ? "primary" : "secondary", "md", "min-h-14 sm:min-h-11")} data-testid="today-empty-action">
            {a.label}
          </a>
        ))}
      </div>
    </Card>
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
      {heading ? <SectionTitle aside={total ? <span className="text-table tabular-nums text-fg-mute">{total} 件</span> : undefined}>次にやること</SectionTitle> : null}
      {actions.length === 0 ? (
        <p className="flex items-center gap-2 border-y border-line py-4 text-table text-fg-soft" data-testid="today-next-actions-empty">
          <Icon name="check-circle" size={18} className="text-fg-mute" />
          いま、やることはありません。
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-line border-y border-line">
          {actions.map((a, i) => (
            <li key={`${a.id}-${a.planId ?? ""}-${i}`} data-testid="today-next-action" data-action-id={a.id} data-tier={String(a.tier)} data-plan-id={a.planId ?? ""}>
              {a.planTitle ? (
                <p className="border-l-4 border-transparent px-3 pt-3 text-aux text-fg-soft" data-testid="today-next-action-plan">
                  {a.planTitle}
                </p>
              ) : null}
              <NextActionItem action={a} testId="today-next-action" tall />
            </li>
          ))}
        </ul>
      )}
      {plansHref ? (
        <a href={plansHref} className="inline-flex min-h-11 items-center self-start text-table text-accent underline underline-offset-2" data-testid="today-plans-link">
          計画の一覧へ
        </a>
      ) : null}
    </section>
  );
}

/** 近づく期限（技能証明の有効期限と、許可・承認の有効な最終日。60 日以内、最大 5 件）。機体の期限は記録する場所が無いため出ない。 */
export function TodayDeadlines({ deadlines }: { readonly deadlines: readonly DeadlineDto[] }) {
  return (
    <section aria-label="近づく期限" data-testid="home-deadlines" className="flex flex-col gap-2">
      <SectionTitle>近づく期限</SectionTitle>
      {deadlines.length === 0 ? (
        <p className="border-y border-line py-4 text-table text-fg-soft" data-testid="home-deadlines-empty">
          60 日以内に近づく期限はありません。
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-line border-y border-line">
          {deadlines.map((d) => (
            <li key={`${d.kind}-${d.id}`} data-testid="deadline-row" data-kind={d.kind}>
              <a href={d.href} className="flex min-h-14 items-center gap-3 py-2 transition-colors hov:bg-accent-soft" data-testid="deadline-link">
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-body font-medium text-fg">{d.what}</span>
                  <span className="break-words text-aux text-fg-mute">
                    {d.subject}
                    {d.licenseStatus === "renewal_window" ? "　更新の申請期間" : d.licenseStatus === "past_deadline" ? "　更新の申請期限を過ぎています" : d.licenseStatus === "expired" ? "　有効期限切れ" : ""}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-0.5">
                  <span className="text-table tabular-nums text-fg">{d.date}</span>
                  <StatusPill meaning={d.overdue ? "danger" : d.daysLeft <= 30 ? "warn" : "neutral"} icon={d.overdue ? "alert" : "clock"}>
                    {d.leftLabel}
                  </StatusPill>
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
      <p className="text-aux text-fg-mute" data-testid="home-deadlines-note">
        機体の期限は、記録する場所がまだないため出ません。
      </p>
    </section>
  );
}

/** 直近の飛行（今日より先の日に始まる計画）。行程の 1 行つき。 */
export function TodayUpcoming({ flights }: { readonly flights: readonly TodayUpcomingDto[] }) {
  return (
    <section aria-label="直近の飛行" data-testid="home-upcoming" className="flex flex-col gap-2">
      <SectionTitle>直近の飛行</SectionTitle>
      {flights.length === 0 ? (
        <p className="border-y border-line py-4 text-table text-fg-soft" data-testid="home-upcoming-empty">
          今日から 7 日以内に、ほかの飛行の予定はありません。
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-line border-y border-line">
          {flights.map((f) => (
            <li key={f.planId} data-testid="upcoming-row" data-plan-id={f.planId}>
              <a href={f.href} className="flex flex-col gap-2 py-3 transition-colors hov:bg-accent-soft" data-testid="upcoming-link">
                <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="min-w-0 text-body font-medium text-fg">
                    <span className="tabular-nums">{f.plannedDate}</span> {f.title}
                  </span>
                  <span className="text-aux text-fg-mute">あと {f.daysLeft} 日</span>
                </span>
                <JourneyLine stages={f.journey} compact />
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
