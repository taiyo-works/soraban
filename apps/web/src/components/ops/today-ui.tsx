import type { ReactNode } from "react";
import Link from "next/link";
import { Icon } from "@/components/ui/icons";
import { formatDay, formatDaysIn } from "@/lib/ops-day";
import { DEADLINE_GUIDE_DISCLAIMER } from "@soraban/dips";
import { LICENSE_RENEWAL_LABEL } from "@/server/ops/license";
import { Disclosure, ListCardLink, PillLink, SectionHead, StatusLabel, type StatusTone } from "@/components/ui/sb-parts";
import type { DeadlineDto } from "@/server/ops/deadlines-logic";
import type { TodayBadgeDto, TodayCardDto, TodayDto, TodayRowDto, TodayUpcomingDto } from "@/server/ops/today";
import type { TodayNextAction } from "@/server/ops/today-logic";
import { journeyNext, type JourneyNext } from "./journey-next";
import { MoreRows } from "./more-rows";

// ホームの部品（Sprint 12c 設計 C・G。Sprint 12h PR ③b で v2 に）。見本：docs/design/warm-final/home.html。
// サーバー・クライアントのどちらからも使える（描くだけで、判断はしない）。状態は、色だけでなく記号と文字で示す。
// TodayBadge と TodayNextActions は `/`（判定画面）のログイン済みの帯も使う。`/` は app/ops/ops-v2.css を読まないので、この 2 つと MoreRows は
// 共通の soraban-ui.css の .sb-*（と Tailwind の --sb-* の名前）だけで描く（`/` の CSS を増やさない）。

const BADGE_CLASS: Readonly<Record<TodayBadgeDto["code"], string>> = {
  in_flight: "sb-tag sb-tag-strong",
  journal_pending: "sb-tag sb-tag-deadline",
  journaled: "sb-tag",
  ended: "sb-tag",
  planned: "sb-tag",
};

export function TodayBadge({ badge }: { readonly badge: TodayBadgeDto }) {
  return (
    <span className={BADGE_CLASS[badge.code]} data-testid="today-badge" data-code={badge.code}>
      <span aria-hidden>{badge.mark} </span>
      {badge.label}
    </span>
  );
}

/** 状況の札（飛行中・日誌待ち・日誌済み・終了・予定）。印と文字で示す。 */
export function TodayStatus({ badge }: { readonly badge: TodayBadgeDto }) {
  return (
    <span className={BADGE_CLASS[badge.code]} data-testid="today-badge" data-code={badge.code}>
      <span aria-hidden>{badge.mark} </span>
      {badge.label}
    </span>
  );
}

// 行程の 1 行（判定→計画→確認→通報→点検→飛行→日誌）。各段は「丸い印＋段の名前＋済／次／未」。「次」の段だけ主色の面。
// 状態は文字と印の形（チェック・▶・破線の輪）が伝える（色だけに頼らない）。7 段が 320px でも折り返さない。
type RouteStage = { readonly label: string; readonly state: "done" | "next" | "todo" | "skip"; readonly stateLabel?: string };
const ROUTE_STATE_LABEL = { done: "済", next: "次", todo: "未", skip: "対象外" } as const;

function RouteDot({ state }: { readonly state: RouteStage["state"] }) {
  if (state === "done")
    return (
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3 8.5 L6.5 12 L13 4.5" />
      </svg>
    );
  if (state === "next")
    return (
      <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        <path d="M5 3 L13 8 L5 13 Z" />
      </svg>
    );
  return null;
}

function Route({ stages, compact = false }: { readonly stages: readonly RouteStage[]; readonly compact?: boolean }) {
  return (
    <ol aria-label="行程" data-note="" data-testid="route" data-variant="dots" className={compact ? "opx-route opx-route-compact" : "opx-route"} style={{ gridTemplateColumns: `repeat(${stages.length}, minmax(0, 1fr))` }}>
      {stages.map((st) => (
        <li key={st.label} data-stage-state={st.state} className={`opx-rs opx-rs-${st.state}`}>
          <span className="opx-rs-dot" aria-hidden="true">
            <RouteDot state={st.state} />
          </span>
          <span className="opx-rs-name">{st.label}</span>
          <span className="opx-rs-state">{st.stateLabel ?? ROUTE_STATE_LABEL[st.state]}</span>
        </li>
      ))}
    </ol>
  );
}

/** 運航票の 1 行（項目名＋値）。 */
function Fact({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-baseline gap-x-3 py-1">
      <dt className="text-sm text-sb-ink-3">{label}</dt>
      <dd className="min-w-0 text-sb-ink [text-wrap:pretty]">{children}</dd>
    </div>
  );
}

/**
 * 行程表の帯（「次の飛行」の主役）。7 つの段（丸い印・段の名前・済／次／未）を 1 行に置き、「次」の段を主色の面にする。
 * 帯の下に 1 行：いまの「次」の段と、その段の作業（この計画の次にやること。押すとその作業へ）。
 * 行程の導出（journey-logic）は変えない。ここは見せ方だけ。
 */
function RouteBand({ card, next }: { readonly card: TodayCardDto; readonly next: JourneyNext }) {
  const done = card.journey.filter((s) => s.state === "done").length;
  return (
    <div className="flex flex-col gap-2" data-testid="today-card-route">
      <div className="flex items-baseline justify-between gap-3">
        <p data-note="" className="text-sm font-bold text-sb-ink-2">行程</p>
        <p data-note="" className="opx-num text-sm text-sb-ink-3" data-testid="today-card-route-count">
          済 {done} / {card.journey.length}
        </p>
      </div>
      <Route stages={card.journey} />
      <p className="flex flex-wrap items-center gap-x-2 gap-y-0 text-sb-ink-2" data-testid="today-card-next">
        {next.stage ? (
          <>
            <span>
              次は<span className="font-bold text-sb-ink">{next.stage.label}</span>の段
            </span>
            {next.action ? (
              <a href={next.action.href} className="opx-underlink" data-testid="today-card-next-link" data-action-id={next.action.id}>
                {next.action.label}
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
 * 読む順：時刻と名称 → 機体・操縦者（何を・誰が） → 判定・通報・確認（その中身） → 行程の 1 行（どこまで進んだか） → 主ボタン。
 * 行程の 1 行と 3 つの行は同じ「判定・確認・通報」を指すが、行程は進み具合（済／次／未）、行は中身（判定の段階・通報の要否と状況・確認の状態の文言）を担う。
 */
export function TodayCard({ card, today, nextActions = [] }: { readonly card: TodayCardDto; readonly today: string; readonly nextActions?: readonly TodayNextAction[] }) {
  return (
    <section aria-label={card.reasonLabel} data-testid="today-card" data-reason={card.reason} data-plan-id={card.planId} className="sb-block opx-nc">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <p data-note="" className="text-sm font-bold text-sb-ink-2" data-testid="today-card-reason">
          {card.reasonLabel}
        </p>
        <TodayStatus badge={card.badge} />
      </div>
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <p className="opx-nc-time" data-testid="today-card-time">
            {card.timeLabel}
          </p>
          <p data-note="" className="opx-num text-sm text-sb-ink-3" data-testid="today-card-date">
            <time dateTime={card.plannedDate}>{formatDay(card.plannedDate, today)}</time>
          </p>
        </div>
        <h2 className="opx-nc-title mt-1.5 [text-wrap:balance]" data-testid="today-card-title">
          {card.title}
        </h2>
        <p className="flex flex-wrap gap-x-4 gap-y-0.5 text-sb-ink-2">
          <span className="[overflow-wrap:anywhere]">
            <span data-note="" className="text-sm text-sb-ink-3">機体 </span>
            <span className="font-bold text-sb-ink" data-testid="today-card-aircraft">
              <span className="opx-num">{card.registrationMark}</span>（{card.modelName}）
            </span>
          </span>
          <span>
            <span data-note="" className="text-sm text-sb-ink-3">操縦者 </span>
            <span className="font-bold text-sb-ink" data-testid="today-card-pilot">
              {card.pilotName}
            </span>
          </span>
        </p>
      </div>
      <dl className="flex flex-col">
        <Fact label="判定の段階">
          <span className="font-bold" data-testid="today-card-verdict">
            {card.verdictLabel}
            {card.judgementStale ? "（判定が古い）" : ""}
          </span>
        </Fact>
        <Fact label="通報の状況">
          <span className="font-bold" data-testid="today-card-report">
            <span aria-hidden>{card.report.statusMark} </span>
            {card.report.requirementLabel}／{card.report.statusLabel}
          </span>
        </Fact>
        <Fact label="確認の状況">
          <span className="font-bold" data-testid="today-card-confirmation">
            {card.confirmation.label}
          </span>
        </Fact>
      </dl>
      <RouteBand card={card} next={journeyNext(card.journey, nextActions, card.planId)} />
      {/* 16-G（K-8）：ホームの主ボタンは 1 つ（home-primary）。「すべての予定」の中のこのカードの入口は副ボタン */}
      <a href={card.primary.href} className="opx-btn opx-nc-primary" data-testid="today-card-primary" data-kind={card.primary.kind}>
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
      <SectionHead id="today-rest-h" title="今日の残りの飛行" />
      <ul className="sb-block sb-rows !py-1">
        {rows.map((r) => (
          <li key={r.planId} data-testid="today-rest-row">
            <a href={r.href} className="sb-row flex-wrap" data-testid="today-rest-link">
              <span className="opx-num font-bold">{r.timeLabel}</span>
              <span className="min-w-0 flex-1 break-words font-bold">{r.title}</span>
              <TodayStatus badge={r.badge} />
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

const PLAN_NEW_HREF = "/ops/plans/new";

/**
 * 空の状態（HM-4）：アイコン・一文・主ボタン「計画を作る」だけ。計画を作れない役割（閲覧者・操縦者の行に結び付いていない操縦者）には、
 * 押しても作れない「計画を作る」を出さず、サーバーの文言・経路の先頭（地点を判定する）を主ボタンにする。
 */
export function TodayEmpty({ empty, canPlan = true }: { readonly empty: NonNullable<TodayDto["empty"]>; readonly canPlan?: boolean }) {
  const action = canPlan ? { label: "計画を作る", href: PLAN_NEW_HREF } : empty.actions.filter((a) => a.href !== PLAN_NEW_HREF)[0];
  return (
    <section aria-label="今日の飛行" className="sb-block home-empty flex flex-col items-start gap-3" data-testid="today-empty">
      <Icon name="plan" size={32} className="text-sb-ink-3" />
      <p className="text-[1.125rem] font-bold leading-snug" data-testid="today-empty-message">
        {empty.message}
      </p>
      {action ? (
        <PillLink variant="primary" block href={action.href} data-testid="today-empty-action">
          {action.label}
        </PillLink>
      ) : null}
    </section>
  );
}

const BADGE_TONE: Readonly<Record<TodayBadgeDto["code"], StatusTone>> = {
  in_flight: "flying",
  journal_pending: "warn",
  journaled: "safe",
  ended: "info",
  planned: "info",
};

/** 次の予定（HM-1 ③）：直近の 1 件の一覧カード。状態ラベル・日時・場所。カード全体が計画の画面への入口（地図のサムネイルは 19-2a の後）。 */
export function HomeNextCard({ card, today }: { readonly card: TodayCardDto; readonly today: string }) {
  return (
    <section aria-label="次の予定" className="flex flex-col gap-2" data-testid="home-next">
      <ListCardLink href={`/ops/plans/${card.planId}`} className="home-next-card" data-testid="home-next-link">
        <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <StatusLabel tone={BADGE_TONE[card.badge.code]} testId="home-next-status">
            {card.badge.label}
          </StatusLabel>
          <span className="opx-num text-sm text-sb-ink-3" data-testid="home-next-when">
            <time dateTime={card.plannedDate}>{formatDay(card.plannedDate, today)}</time>　{card.timeLabel}
          </span>
        </span>
        <span className="home-next-title text-[1.0625rem] font-bold leading-snug" data-testid="home-next-title">
          {card.title}
        </span>
        <span className="home-next-place text-sm text-sb-ink-2" data-testid="home-next-place">
          {card.placeName}
        </span>
      </ListCardLink>
    </section>
  );
}

/**
 * クイック操作（HM-1 ⑤）：飛行前点検・新しい計画・飛行記録。幅を 3 等分した副ボタン（48px 以上。記号を上、文字を下）。
 * 記録を入力できない役割（閲覧者）には出さない。計画を作れない役割には「新しい計画」を除く。ops-enter-* の識別子は 16-F・12c から引き継ぐ。
 */
export function HomeQuick({ canEnter, canPlan }: { readonly canEnter: boolean; readonly canPlan: boolean }) {
  if (!canEnter) return null;
  return (
    <nav aria-label="クイック操作" className="home-quick" data-count={canPlan ? 3 : 2} data-testid="home-quick">
      <Link prefetch={false} href="/ops/inspections/new" className="sb-pill sb-pill-secondary home-quick-btn" data-testid="ops-enter-inspection">
        <Icon name="inspection" size={24} />
        <span className="home-quick-label">飛行前点検</span>
      </Link>
      {canPlan ? (
        <Link prefetch={false} href="/ops/plans/new" className="sb-pill sb-pill-secondary home-quick-btn" data-testid="ops-enter-plan">
          <Icon name="plus" size={24} />
          <span className="home-quick-label">新しい計画</span>
        </Link>
      ) : null}
      <Link prefetch={false} href="/ops/flights/new" className="sb-pill sb-pill-secondary home-quick-btn" data-testid="ops-enter-flight">
        <Icon name="flight" size={24} />
        <span className="home-quick-label">飛行記録</span>
      </Link>
    </nav>
  );
}

/**
 * ホームの主ボタン（HM-2）：準備カードの計画の、押せる次の行動（呼び出し側が選ぶ）。無ければ「新しい計画」。作れない役割は出さない。
 * 別の計画の行動を主ボタンにしない（準備カードの計画と取り違えない）。別の計画の行動は、畳んだ「すべての予定」の次にやることに出る。
 * （対象の計画名を 14px で 1 行添える案は、375×812 で最初の画面に入らなかった：クイック操作の下端が下部ナビの上端を 25px 越えた。）
 */
export function HomePrimary({ action, canPlan }: { readonly action: TodayNextAction | null; readonly canPlan: boolean }) {
  if (action)
    return (
      <PillLink variant="primary" block href={action.href} data-testid="home-primary" data-action-id={action.id}>
        {action.label}
      </PillLink>
    );
  if (!canPlan) return null;
  return (
    <PillLink variant="primary" block href={PLAN_NEW_HREF} data-testid="home-primary" data-action-id="new_plan">
      新しい計画
    </PillLink>
  );
}

/** 下段の「すべての予定」：判定へのピル・今日のカードの詳細・残りの予定・次にやること・先の予定を畳む（HM-1）。 */
export function HomeAllPlans({ children }: { readonly children: ReactNode }) {
  return (
    <Disclosure title="すべての予定" note="判定への入口・次にやること・直近の飛行" testId="home-all" summaryTestId="home-all-toggle">
      <div className="flex flex-col gap-4" data-testid="home-all-body">
        {children}
      </div>
    </Disclosure>
  );
}

/** 「計画の一覧へ」（次にやることの見出しの右。押す高さは 44px 以上）。 */
function PlansLink({ href }: { readonly href: string }) {
  return (
    <a href={href} className="inline-flex min-h-12 items-center text-sm font-bold text-sb-ink underline decoration-sb-primary decoration-[3px] underline-offset-4" data-testid="today-plans-link">
      計画の一覧へ
    </a>
  );
}

/** 次にやること：最初の画面に出す件数（残りは「ほか N 件を見る」で開く。近づく期限などが最初の画面から落ちないようにする）。 */
export const NEXT_ACTIONS_INITIAL = 3;

// 急ぎ度の札（見本の「次にやること」の札）。状態は札の文字と印で伝え、主色・状態色は「急ぎ」の面だけに使う（判定の色は使わない）。
const TIER_PILL: Readonly<Record<number, { readonly cls: string; readonly mark: string; readonly text: string; readonly meaning: string }>> = {
  1: { cls: "sb-tag sb-tag-strong", mark: "！", text: "最優先", meaning: "danger" },
  2: { cls: "sb-tag sb-tag-strong", mark: "！", text: "期限超過", meaning: "warn" },
  3: { cls: "sb-tag sb-tag-deadline", mark: "○", text: "未了", meaning: "neutral" },
  4: { cls: "sb-tag", mark: "ⓘ", text: "確認・変更", meaning: "info" },
  5: { cls: "sb-tag", mark: "○", text: "推奨", meaning: "neutral" },
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
        <span className="flex flex-wrap items-center gap-x-1 gap-y-1">
          <span className={pill.cls} data-meaning={pill.meaning}>
            <span aria-hidden>{pill.mark}</span>
            {pill.text}
          </span>
          {action.planTitle ? (
            <span className="min-w-0 text-sm text-sb-ink-3" data-testid="today-next-action-plan">
              {action.planTitle}
            </span>
          ) : null}
        </span>
        <span className="text-[1rem] font-bold leading-snug text-sb-ink" data-testid="today-next-action-label">
          {action.label}
        </span>
        <span className="text-sm leading-relaxed text-sb-ink-2 [text-wrap:pretty]">{day(action.reason)}</span>
        {due ? (
          <span className="flex flex-col gap-0.5" data-testid="today-next-action-due">
            <span className="text-sm leading-relaxed text-sb-ink [text-wrap:pretty]">{day(due.head)}</span>
            {due.note ? <span className="text-sm leading-relaxed text-sb-ink-3 [text-wrap:pretty]">{due.note}</span> : null}
          </span>
        ) : null}
        {!action.canAct ? (
          <span className="text-sm text-sb-ink-3" data-testid="today-next-action-cannot">
            {action.id === "register_permit" ? "運航管理者に依頼してください（許可・承認の登録は運航管理者だけが行えます）。" : "この操作は運航管理者または計画の操縦者本人が行います。"}
          </span>
        ) : null}
      </span>
      {action.canAct ? (
        <span className="sb-go-dot" aria-hidden="true">
          <Icon name="chevron-right" size={20} />
        </span>
      ) : null}
    </>
  );
  return action.canAct ? (
    <a href={action.href} className="sb-row !items-start" data-testid="today-next-action-link" data-action-id={action.id}>
      {body}
    </a>
  ) : (
    <div className="sb-row !items-start" data-testid="today-next-action-link" data-action-id={action.id}>
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
      {heading ? (
        <div className="sb-sec-head sb-sec-row">
          <h2 id="today-next-h">次にやること</h2>
          <span className="flex items-center gap-x-4">
            {total ? <span className="sb-num text-sm text-sb-ink-3">{total} 件</span> : null}
            {plansHref ? <PlansLink href={plansHref} /> : null}
          </span>
        </div>
      ) : null}
      {actions.length === 0 ? (
        <p className="flex items-center gap-2 text-sb-ink-2" data-testid="today-next-actions-empty">
          <Icon name="check-circle" size={18} className="shrink-0 text-sb-ink-3" />
          いま、やることはありません。
        </p>
      ) : (
        <div className={heading ? "sb-block !py-1" : ""}>
          <ul className="sb-rows">{head.map((a, i) => row(a, i))}</ul>
          {tail.length > 0 ? <MoreRows count={tail.length} data-testid="today-next-more">{tail.map((a, i) => row(a, head.length + i))}</MoreRows> : null}
        </div>
      )}
      {plansHref && !heading ? <PlansLink href={plansHref} /> : null}
    </section>
  );
}

/** ホームに最初から出す期限の行数（残りは「ほか N 件を見る」。最初の画面に、クイック操作まで入れるため）。 */
export const HOME_DEADLINES_INITIAL = 1;

function DeadlineRow({ d, today }: { readonly d: DeadlineDto; readonly today: string }) {
  return (
    <li data-testid="deadline-row" data-kind={d.kind}>
      {/* 一覧の行は上下 14px。ここだけ 8px に戻す。最初の画面（下タブ 60px を除く）に、期限の先頭の行までを収めるため */}
      <a href={d.href} className="sb-row" data-testid="deadline-link">
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-[1rem] font-bold leading-snug">{d.what}</span>
          <span className="break-words text-sm text-sb-ink-2">
            {d.subject}
            {d.licenseStatus ? `　${LICENSE_RENEWAL_LABEL[d.licenseStatus]}` : ""}
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1">
          <span className="sb-num text-sm text-sb-ink">
            <time dateTime={d.date}>{formatDay(d.date, today)}</time>
          </span>
          {d.overdue || d.daysLeft <= 30 ? (
            <span className={d.overdue ? "sb-tag sb-tag-strong" : "sb-tag sb-tag-deadline"}>
              <span aria-hidden>{d.overdue ? "！" : "○"}</span>
              {d.leftLabel}
            </span>
          ) : (
            <span className="text-sm text-sb-ink-3">{d.leftLabel}</span>
          )}
        </span>
      </a>
    </li>
  );
}

/**
 * 近づく期限（HM-1 ④。技能証明の有効期限と、許可・承認の有効な最終日。残り 60 日以内）。無いときは段ごと出さない。
 * 最初の画面にクイック操作まで入れるため、上段には期限の近い 1 件だけを出し、残りは「すべての予定」の中（TodayDeadlinesRest）に置く。
 * 「ほか N 件」の件数は見出しの行に出す（押す部品は増やさない）。機体の期限は記録する場所が無いため出ない（注記を 1 行）。
 */
export function TodayDeadlines({ deadlines, today }: { readonly deadlines: readonly DeadlineDto[]; readonly today: string }) {
  if (deadlines.length === 0) return null;
  const head = deadlines.slice(0, HOME_DEADLINES_INITIAL);
  const rest = deadlines.length - head.length;
  return (
    <section aria-label="近づく期限" data-testid="home-deadlines" className="flex flex-col gap-2">
      <div className="sb-block !py-1">
        {/* 見出しは枠の中の 1 行（h2 のまま。節の見出しの大きさは使わない） */}
        <div className="home-dl-head">
          <h2 id="home-deadlines-h">近づく期限</h2>
          <span data-note="" className="text-sm text-sb-ink-3" data-testid="home-deadlines-count">
            60 日以内{rest > 0 ? `・ほか ${rest} 件` : ""}
          </span>
        </div>
        <ul className="sb-rows">
          {head.map((d) => (
            <DeadlineRow key={`${d.kind}-${d.id}`} d={d} today={today} />
          ))}
        </ul>
      </div>
      <p data-note="" className="text-sm text-sb-ink-3" data-testid="home-deadlines-note">
        機体の期限は、記録する場所がまだないため出ません。
      </p>
    </section>
  );
}

/** 近づく期限の残り（上段に出した 1 件より後ろ）。「すべての予定」の中に置く。 */
export function TodayDeadlinesRest({ deadlines, today }: { readonly deadlines: readonly DeadlineDto[]; readonly today: string }) {
  const tail = deadlines.slice(HOME_DEADLINES_INITIAL);
  if (tail.length === 0) return null;
  return (
    <section aria-label="近づく期限（残り）" data-testid="home-deadlines-rest" className="flex flex-col gap-2">
      <SectionHead id="home-deadlines-rest-h" title="近づく期限（残り）" note="60 日以内" />
      <div className="sb-block !py-1">
        <ul className="sb-rows">
          {tail.map((d) => (
            <DeadlineRow key={`${d.kind}-${d.id}`} d={d} today={today} />
          ))}
        </ul>
      </div>
    </section>
  );
}

/** 直近の飛行（今日より先の日に始まる計画）。行程の 1 行つき。 */
export function TodayUpcoming({ flights, today }: { readonly flights: readonly TodayUpcomingDto[]; readonly today: string }) {
  return (
    <section aria-label="直近の飛行" data-testid="home-upcoming" className="flex flex-col gap-2">
      <SectionHead id="home-upcoming-h" title="直近の飛行" note="7 日以内" />
      {flights.length === 0 ? (
        <p className="text-sb-ink-2" data-testid="home-upcoming-empty">
          今日から 7 日以内に、ほかの飛行の予定はありません。
        </p>
      ) : (
        <ul className="sb-block sb-rows !py-1">
          {flights.map((f) => (
            <li key={f.planId} data-testid="upcoming-row" data-plan-id={f.planId}>
              <a href={f.href} className="sb-row !flex-col !items-stretch !gap-2" data-testid="upcoming-link">
                <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="min-w-0 text-[1rem] font-bold leading-snug">
                    <span className="sb-num">
                      <time dateTime={f.plannedDate}>{formatDay(f.plannedDate, today)}</time>
                    </span>{" "}
                    {f.title}
                  </span>
                  <span className="text-sm text-sb-ink-3">あと {f.daysLeft} 日</span>
                </span>
                <Route stages={f.journey} compact />
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
