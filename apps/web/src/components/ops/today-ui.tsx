import type { ReactNode } from "react";
import type { IconName } from "@/components/ui/icons";
import { Icon } from "@/components/ui/icons";
import { JourneyLedger, JourneyLine } from "@/components/ui/journey-line";
import { formatDay, formatDaysIn } from "@/lib/ops-day";
import { DEADLINE_GUIDE_DISCLAIMER } from "@soraban/dips";
import { buttonClass, Card, SectionTitle, StatusPill, type Meaning } from "@/components/ui/primitives";
import type { DeadlineDto } from "@/server/ops/deadlines-logic";
import type { TodayBadgeDto, TodayCardDto, TodayDto, TodayRowDto, TodayUpcomingDto } from "@/server/ops/today";
import type { TodayNextAction } from "@/server/ops/today-logic";
import { journeyNext, type JourneyNext } from "./journey-next";
import { MoreRows } from "./more-rows";
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
    <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-baseline gap-x-3 py-1">
      <dt className="text-aux text-fg-mute">{label}</dt>
      <dd className="min-w-0 text-table text-fg [text-wrap:pretty]">{children}</dd>
    </div>
  );
}

/**
 * 行程表の帯（「次の飛行」の主役）。カードの左右いっぱいに、罫で区切った 7 つの欄（番号・段・済／次／未）を置き、「次」の欄に押印のような印を付ける。
 * 帯の下に 1 行：いまの「次」の段と、その段の作業（この計画の次にやること。押すとその作業へ）。
 * 行程の導出（journey-logic）は変えない。ここは見せ方だけ。
 */
function RouteBand({ card, next }: { readonly card: TodayCardDto; readonly next: JourneyNext }) {
  const done = card.journey.filter((s) => s.state === "done").length;
  return (
    <div className="-mx-5 flex flex-col gap-2 sm:-mx-6" data-testid="today-card-route">
      <div className="flex items-baseline justify-between gap-3 px-5 sm:px-6">
        <p className="text-aux font-medium text-fg-mute">行程</p>
        <p className="font-mono text-aux tabular-nums text-fg-mute" data-testid="today-card-route-count">
          済 {done} / {card.journey.length}
        </p>
      </div>
      <JourneyLedger stages={card.journey} />
      <p className="flex flex-wrap items-center gap-x-2 gap-y-0 px-5 text-table text-fg-soft sm:px-6" data-testid="today-card-next">
        {next.stage ? (
          <>
            <span>
              次は<span className="font-semibold text-fg">{next.stage.label}</span>の段
            </span>
            {next.action ? (
              <a
                href={next.action.href}
                className="inline-flex min-h-11 items-center gap-1 font-semibold text-accent hov:underline"
                data-testid="today-card-next-link"
                data-action-id={next.action.id}
              >
                {next.action.label}
                <Icon name="chevron-right" size={16} />
              </a>
            ) : null}
          </>
        ) : (
          <span className="py-2.5">すべての段が終わっています。</span>
        )}
      </p>
    </div>
  );
}

/**
 * 今日（なければ次）の飛行の大きなカード 1 枚。主ボタンは 1 つだけ（当日は「現場モードを開く」）。
 * 読む順：時刻と名称 → 機体・操縦者（何を・誰が） → 行程の 1 行（どこまで進んだか） → 判定・通報・確認（その中身） → 主ボタン。
 * 行程の 1 行と 3 つの行は同じ「判定・確認・通報」を指すが、行程は進み具合（済／次／未）、行は中身（判定の段階・通報の要否と状況・確認の状態の文言）を
 * 担う。機体・操縦者は行程にない情報なので、行から外して名称の下に置いた（5 行を 3 行にし、罫線も減らした）。
 */
export function TodayCard({ card, today, nextActions = [] }: { readonly card: TodayCardDto; readonly today: string; readonly nextActions?: readonly TodayNextAction[] }) {
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
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <p className="text-stat font-semibold leading-none tabular-nums text-fg" data-testid="today-card-time">
            {card.timeLabel}
          </p>
          <p className="text-table tabular-nums text-fg-mute" data-testid="today-card-date">
            <time dateTime={card.plannedDate}>{formatDay(card.plannedDate, today)}</time>
          </p>
        </div>
        <h2 className="mt-1.5 text-h2 font-semibold text-fg [text-wrap:balance]" data-testid="today-card-title">
          {card.title}
        </h2>
        <p className="flex flex-wrap gap-x-4 gap-y-0.5 text-table text-fg-soft">
          <span>
            <span className="text-aux text-fg-mute">機体 </span>
            <span data-testid="today-card-aircraft">
              <span className="tabular-nums">{card.registrationMark}</span>（{card.modelName}）
            </span>
          </span>
          <span>
            <span className="text-aux text-fg-mute">操縦者 </span>
            <span data-testid="today-card-pilot">{card.pilotName}</span>
          </span>
        </p>
      </div>
      <RouteBand card={card} next={journeyNext(card.journey, nextActions, card.planId)} />
      <dl className="flex flex-col border-t border-line pt-2">
        <Fact label="判定の段階">
          <span className="font-semibold" data-testid="today-card-verdict">
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

const PLAN_NEW_HREF = "/ops/plans/new";

/** 空の状態：何がないかと、次にできること（件数だけのタイルは作らない）。 */
export function TodayEmpty({ empty, canPlan = true }: { readonly empty: NonNullable<TodayDto["empty"]>; readonly canPlan?: boolean }) {
  // 計画を作れない役割（閲覧者・操縦者の行に結び付いていない操縦者）には「飛行計画を作る」を出さない（押しても作れない）。サーバーの文言・経路は変えない
  const actions = canPlan ? empty.actions : empty.actions.filter((a) => a.href !== PLAN_NEW_HREF);
  return (
    <Card as="section" variant="primary" aria-label="今日の飛行" className="flex flex-col gap-4" data-testid="today-empty">
      <p className="text-h2 font-semibold text-fg" data-testid="today-empty-message">
        {empty.message}
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        {actions.map((a, i) => (
          <a key={a.href} href={a.href} className={buttonClass(i === 0 ? "primary" : "secondary", "md", "min-h-14 sm:min-h-11")} data-testid="today-empty-action">
            {a.label}
          </a>
        ))}
      </div>
    </Card>
  );
}

/** 次にやること：最初の画面に出す件数（残りは「ほか N 件を見る」で開く。近づく期限などが最初の画面から落ちないようにする）。 */
export const NEXT_ACTIONS_INITIAL = 3;

// 期限の札（見本の「近づく期限」と同じ StatusPill）。状態は札の文字と印で伝え、色は補助。
const TIER_PILL: Readonly<Record<number, { readonly meaning: Meaning; readonly icon: IconName; readonly text: string }>> = {
  1: { meaning: "danger", icon: "alert", text: "最優先" },
  2: { meaning: "warn", icon: "clock", text: "期限超過" },
  3: { meaning: "neutral", icon: "dot", text: "未了" },
  4: { meaning: "info", icon: "info", text: "確認・変更" },
  5: { meaning: "neutral", icon: "dot", text: "推奨" },
};

/**
 * 期限の文（dueLabel）は、サーバーが「期限の状態」と「社内の目安の注記」を空白 1 つで連結している（句点がなく、2 文が続いて見える）。
 * 文言は変えず、注記（DEADLINE_GUIDE_DISCLAIMER）で終わるときだけ、2 つの行に分けて描く。
 */
export const splitDueLabel = (due: string): { readonly head: string; readonly note: string | null } => {
  if (due.endsWith(DEADLINE_GUIDE_DISCLAIMER)) {
    const head = due.slice(0, due.length - DEADLINE_GUIDE_DISCLAIMER.length).trimEnd();
    if (head !== "") return { head, note: DEADLINE_GUIDE_DISCLAIMER };
  }
  return { head: due, note: null };
};

/**
 * ホームの「次にやること」の 1 行。上から 札（急ぎ度）・計画名 → 動詞で始まる作業名 → 理由 → 期限（状態を 1 行、注記を小さく別の行）。
 * 押すとその作業の画面へ直接移る（canAct が偽なら押せず、理由を文で示す）。日付は読みやすい形（1/5（火））にする。
 */
function HomeActionRow({ action, today }: { readonly action: TodayNextAction; readonly today: string | undefined }) {
  const pill = TIER_PILL[action.tier] ?? TIER_PILL[5]!;
  const day = (t: string): string => (today ? formatDaysIn(t, today) : t);
  const due = action.dueLabel ? splitDueLabel(action.dueLabel) : null;
  const body = (
    <>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <StatusPill meaning={pill.meaning} icon={pill.icon}>
            {pill.text}
          </StatusPill>
          {action.planTitle ? (
            <span className="min-w-0 text-aux text-fg-mute" data-testid="today-next-action-plan">
              {action.planTitle}
            </span>
          ) : null}
        </span>
        <span className="text-body font-medium leading-snug text-fg" data-testid="today-next-action-label">
          {action.label}
        </span>
        <span className="text-table text-fg-soft [text-wrap:pretty]">{day(action.reason)}</span>
        {due ? (
          <span className="flex flex-col gap-0.5" data-testid="today-next-action-due">
            <span className="text-table text-fg [text-wrap:pretty]">{day(due.head)}</span>
            {due.note ? <span className="text-aux text-fg-mute [text-wrap:pretty]">{due.note}</span> : null}
          </span>
        ) : null}
        {!action.canAct ? (
          <span className="text-table text-fg-mute" data-testid="today-next-action-cannot">
            {action.id === "register_permit" ? "運航管理者に依頼してください（許可・承認の登録は運航管理者だけが行えます）。" : "この操作は運航管理者または計画の操縦者本人が行います。"}
          </span>
        ) : null}
      </span>
      {action.canAct ? <Icon name="chevron-right" size={18} className="mt-1 shrink-0 self-start text-fg-mute" /> : null}
    </>
  );
  const box = "flex min-h-14 items-start gap-3 py-3 transition-colors duration-[var(--dur)] [line-break:strict] [word-break:auto-phrase]";
  return action.canAct ? (
    <a href={action.href} className={`${box} hov:bg-accent-soft`} data-testid="today-next-action-link" data-action-id={action.id}>
      {body}
    </a>
  ) : (
    <div className={box} data-testid="today-next-action-link" data-action-id={action.id}>
      {body}
    </div>
  );
}

/**
 * 次にやること（動詞で始まる行、押すとその作業へ直接）。最初は上位 NEXT_ACTIONS_INITIAL 件だけ出し、残りは「ほか N 件を見る」で開く。
 * 総数（total）は見出しの横に出し続ける。`/` の帯（上位 3 件）は開閉の対象にならない（3 件以下）。
 */
export function TodayNextActions({
  actions,
  total,
  plansHref,
  today,
  heading = true,
}: {
  readonly actions: readonly TodayNextAction[];
  readonly total?: number;
  readonly plansHref?: string;
  /** 今日（YYYY-MM-DD）。渡すと、行の中の日付を「1/5（火）」にする。 */
  readonly today?: string;
  readonly heading?: boolean;
}) {
  const row = (a: TodayNextAction, i: number) => (
    <li key={`${a.id}-${a.planId ?? ""}-${i}`} data-testid="today-next-action" data-action-id={a.id} data-tier={String(a.tier)} data-plan-id={a.planId ?? ""}>
      <HomeActionRow action={a} today={today} />
    </li>
  );
  const head = actions.slice(0, NEXT_ACTIONS_INITIAL);
  const tail = actions.slice(NEXT_ACTIONS_INITIAL);
  return (
    <section aria-label="次にやること" className="flex flex-col gap-2" data-testid="today-next-actions">
      {heading ? <SectionTitle aside={total ? <span className="text-table tabular-nums text-fg-mute">{total} 件</span> : undefined}>次にやること</SectionTitle> : null}
      {actions.length === 0 ? (
        <p className="flex items-center gap-2 border-y border-line py-4 text-table text-fg-soft" data-testid="today-next-actions-empty">
          <Icon name="check-circle" size={18} className="shrink-0 text-fg-mute" />
          いま、やることはありません。
        </p>
      ) : (
        <div className="flex flex-col border-y border-line">
          <ul className="flex flex-col divide-y divide-line">{head.map((a, i) => row(a, i))}</ul>
          {tail.length > 0 ? <MoreRows count={tail.length} data-testid="today-next-more">{tail.map((a, i) => row(a, head.length + i))}</MoreRows> : null}
        </div>
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
export function TodayDeadlines({ deadlines, today }: { readonly deadlines: readonly DeadlineDto[]; readonly today: string }) {
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
                  <span className="text-table tabular-nums text-fg">
                    <time dateTime={d.date}>{formatDay(d.date, today)}</time>
                  </span>
                  {d.overdue || d.daysLeft <= 30 ? (
                    <StatusPill meaning={d.overdue ? "danger" : "warn"} icon={d.overdue ? "alert" : "clock"}>
                      {d.leftLabel}
                    </StatusPill>
                  ) : (
                    <span className="text-aux text-fg-mute">{d.leftLabel}</span>
                  )}
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
export function TodayUpcoming({ flights, today }: { readonly flights: readonly TodayUpcomingDto[]; readonly today: string }) {
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
                    <span className="tabular-nums">
                      <time dateTime={f.plannedDate}>{formatDay(f.plannedDate, today)}</time>
                    </span>{" "}
                    {f.title}
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
