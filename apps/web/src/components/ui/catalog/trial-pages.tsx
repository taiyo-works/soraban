"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import { cx } from "../cx";
import type { DayKind, JudgeForm } from "./config";
import { Checkbox, FormField, Select, TextInput, Textarea } from "../forms";
import { Icon, type IconName } from "../icons";
import { Button, NoticeBar, StatusPill, type Meaning } from "../primitives";
import { VerdictStamp } from "../verdict-stamp";
import { MapPlaceholder } from "../workspace";
import {
  DEADLINES,
  JOURNAL_ENTRIES,
  JOURNAL_KIND_LABEL,
  LAYERS,
  NEXT_ACTIONS,
  PAGE_TITLE,
  PARENT_PAGE,
  REGISTER_KIND_LABEL,
  REGISTER_ROWS,
  SAMPLE_RESULT_ROWS,
  STAGES,
  TODAY_FLIGHT,
  TODAY_LABEL,
  UPCOMING,
  type Flight,
  type JournalKind,
  type LayerId,
  type PageId,
  type RegisterKind,
} from "./trial-data";

// The pages of the menu and home trial (UX stage 2). They are shared by the PC frame and the phone frame; `device`
// decides the layout (not the viewport, so the PC frame looks the same on a narrow screen). Nothing here reads or writes
// a record: it is all sample data, and every input is a stand-in.

export type Device = "pc" | "phone";
export type { DayKind, JudgeForm } from "./config";

export type JudgeState = {
  readonly point: { readonly x: number; readonly y: number } | null;
  readonly off: readonly LayerId[];
  /** How many times a layer was switched (the script "switch one layer" looks at this). */
  readonly toggles: number;
  readonly geo: "idle" | "loading" | "done" | "denied";
  /** How the point was set: by the position button or by a click on the map. */
  readonly source: "geo" | "map" | null;
};
export const JUDGE_INITIAL: JudgeState = { point: null, off: [], toggles: 0, geo: "idle", source: null };

export type PageCtx = {
  readonly device: Device;
  readonly day: DayKind;
  readonly judgeForm: JudgeForm;
  readonly judgeLabel: string;
  /** The phone layout with four tabs: the plans live on the home page. */
  readonly plansOnHome: boolean;
  /** Whether the next-flight band is shown above the pages other than the home page. */
  readonly band: boolean;
  readonly geoMode: "ok" | "denied";
  readonly go: (page: PageId) => void;
  readonly judge: JudgeState;
  readonly setJudge: (next: (prev: JudgeState) => JudgeState) => void;
};

// ── small shared parts ───────────────────────────────────────────────────────

function H({ children, className }: { readonly children: ReactNode; readonly className?: string }) {
  return <h4 className={cx("text-h2 font-semibold text-fg", className)}>{children}</h4>;
}

/** Page head. On the phone the top bar already carries the title, so only the actions are drawn. */
export function Head({ ctx, page, meta, actions }: { readonly ctx: PageCtx; readonly page: PageId; readonly meta?: string; readonly actions?: ReactNode }) {
  const parent = PARENT_PAGE[page];
  if (ctx.device === "phone") return actions ? <div className="flex flex-col gap-2">{actions}</div> : null;
  return (
    <header className="flex flex-col gap-1">
      {parent ? (
        <button
          type="button"
          onClick={() => ctx.go(parent)}
          data-testid="back"
          className="-mb-1 inline-flex min-h-11 items-center gap-1 self-start rounded-ctl pr-2 text-aux text-accent hov:underline"
        >
          <Icon name="chevron-left" size={16} />
          {PAGE_TITLE[parent]}へ戻る
        </button>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3">
          <h3 className="text-h1 font-semibold text-fg">{page === "judge" ? ctx.judgeLabel : PAGE_TITLE[page]}</h3>
          {meta ? <span className="text-table text-fg-mute">{meta}</span> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}

/** The seven stages of a flight as one ruled line. State is the word and the mark; the rule colour only supports them. */
export function Route({ done, nextLabel = "次", compact = false }: { readonly done: number; readonly nextLabel?: string; readonly compact?: boolean }) {
  return (
    <ol aria-label="行程" data-testid="route" className={cx("grid grid-cols-7", compact ? "gap-1" : "gap-1.5")}>
      {STAGES.map((stage, i) => {
        const state = i < done ? "done" : i === done ? "next" : "todo";
        return (
          <li
            key={stage}
            data-stage-state={state}
            className={cx("flex min-w-0 flex-col gap-0.5 border-t-2 pt-1.5", state === "done" && "border-fg-soft", state === "next" && "border-accent", state === "todo" && "border-line")}
          >
            <span className={cx("whitespace-nowrap text-table", state === "next" ? "font-semibold text-accent" : state === "done" ? "font-medium text-fg" : "text-fg-mute")}>{stage}</span>
            <span className={cx("inline-flex items-center gap-0.5 whitespace-nowrap text-aux", state === "next" ? "font-semibold text-accent" : state === "done" ? "text-fg-soft" : "text-fg-mute")}>
              {state === "done" ? <Icon name="check" size={12} /> : state === "next" ? <Icon name="chevron-right" size={12} /> : <span aria-hidden="true" className="inline-block w-3" />}
              {state === "done" ? "済" : state === "next" ? nextLabel : "未"}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function FlightFacts({ flight }: { readonly flight: Flight }) {
  return (
    <dl className="flex flex-wrap gap-x-6 gap-y-1 text-table">
      <div className="flex gap-2">
        <dt className="text-fg-mute">機体</dt>
        <dd className="text-fg">{flight.aircraft}</dd>
      </div>
      <div className="flex gap-2">
        <dt className="text-fg-mute">操縦者</dt>
        <dd className="text-fg">{flight.pilot}</dd>
      </div>
    </dl>
  );
}

/** Today's flight, large. It is drawn only on a day that has one. */
function FlightCard({ ctx, flight }: { readonly ctx: PageCtx; readonly flight: Flight }) {
  const phone = ctx.device === "phone";
  return (
    <section aria-label="今日の飛行" data-testid="home-flight" className={cx("flex flex-col gap-4 rounded-ctl border border-line-strong bg-surface", phone ? "p-4" : "p-5")}>
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-aux text-fg-mute">次の飛行・今日 {TODAY_LABEL}</p>
          <p className="flex flex-wrap items-baseline gap-x-3">
            <span className="text-stat font-semibold leading-none tabular-nums text-fg">{flight.time}</span>
            <span className="min-w-0 text-h3 font-semibold text-fg">{flight.place}</span>
          </p>
        </div>
      </div>
      <FlightFacts flight={flight} />
      <Route done={flight.done} compact={phone} />
      {phone ? (
        <Button variant="primary" icon="flight" onClick={() => ctx.go("field")} data-testid="act-field" className="w-full">
          現場モードを開く
        </Button>
      ) : null}
    </section>
  );
}

/** A day without a flight: say so, and offer the next step. */
function EmptyDayCard({ ctx }: { readonly ctx: PageCtx }) {
  const next = UPCOMING[0]!;
  const phone = ctx.device === "phone";
  return (
    <section aria-label="今日の飛行" data-testid="home-empty" className={cx("flex flex-col gap-3 rounded-ctl border border-line-strong bg-surface", phone ? "p-4" : "p-5")}>
      <p className="text-aux text-fg-mute">今日 {TODAY_LABEL}</p>
      <H>今日は飛行の予定がありません</H>
      <p className="text-table text-fg-soft">
        次の飛行は {next.when} の{next.place}です。先に計画を作るか、場所の規制を調べておけます。
      </p>
      <div className={cx("flex gap-2", phone ? "flex-col" : "flex-wrap")}>
        <Button variant="primary" icon="plus" onClick={() => ctx.go("plan-new")} data-testid="act-plan-new-card">
          飛行計画を作る
        </Button>
        <Button icon="place" onClick={() => ctx.go("judge")} data-testid="act-judge-card">
          地点を判定する
        </Button>
      </div>
    </section>
  );
}

function ActionsSection({ ctx }: { readonly ctx: PageCtx }) {
  const busy = ctx.day === "busy";
  return (
    <section aria-label="次にやること" data-testid="home-actions" className="flex flex-col gap-2">
      <H>次にやること{busy ? `（${NEXT_ACTIONS.length}）` : ""}</H>
      {busy ? (
        <ul className="flex flex-col divide-y divide-line border-y border-line">
          {NEXT_ACTIONS.map((a) => (
            <li key={a.id}>
              <button
                type="button"
                onClick={() => ctx.go(a.go)}
                data-testid={`act-${a.id}`}
                className="flex min-h-14 w-full items-center gap-3 py-2 text-left transition-colors duration-[var(--dur)] hov:bg-accent-soft"
              >
                <StatusPill meaning={a.meaning}>{a.urgency}</StatusPill>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-body font-medium text-fg">{a.label}</span>
                  <span className="truncate text-aux text-fg-mute">{a.meta}</span>
                </span>
                <Icon name="chevron-right" size={18} className="text-fg-mute" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="border-y border-line py-3 text-table text-fg-soft">いまやることはありません。</p>
      )}
    </section>
  );
}

function DeadlinesSection() {
  return (
    <section aria-label="近づく期限" data-testid="home-deadlines" className="flex flex-col gap-2">
      <H>近づく期限</H>
      <ul className="flex flex-col divide-y divide-line border-y border-line">
        {DEADLINES.map((d) => (
          <li key={d.id} className="flex min-h-14 items-center gap-3 py-2">
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-body font-medium text-fg">{d.what}</span>
              <span className="truncate text-aux text-fg-mute">{d.who}</span>
            </span>
            <span className="flex shrink-0 flex-col items-end gap-0.5">
              <span className="text-table tabular-nums text-fg">{d.date}</span>
              <StatusPill meaning={d.meaning === "warn" ? "warn" : "neutral"} icon={d.meaning === "warn" ? "clock" : "dot"}>
                {d.left}
              </StatusPill>
            </span>
          </li>
        ))}
      </ul>
      <p className="text-aux text-fg-mute">機体の期限は、記録する場所がまだないため出ません。</p>
    </section>
  );
}

function UpcomingSection({ ctx, flights, title }: { readonly ctx: PageCtx; readonly flights: readonly Flight[]; readonly title: string }) {
  return (
    <section aria-label={title} data-testid="home-upcoming" className="flex flex-col gap-2">
      <H>{title}</H>
      <ul className="flex flex-col divide-y divide-line border-y border-line">
        {flights.map((f) => (
          <li key={f.id} className="flex flex-col gap-2 py-3">
            <p className="flex flex-wrap items-baseline justify-between gap-x-3">
              <span className="min-w-0 text-body font-medium text-fg">
                <span className="tabular-nums">{f.when}</span> {f.place}
              </span>
              {f.daysLeft !== undefined ? <span className="text-aux text-fg-mute">あと {f.daysLeft} 日</span> : null}
            </p>
            <Route done={f.done} compact />
          </li>
        ))}
      </ul>
      {ctx.plansOnHome ? (
        <div className={cx("flex gap-2 pt-1", ctx.device === "phone" ? "flex-col" : "flex-wrap")}>
          <Button variant="primary" icon="plus" onClick={() => ctx.go("plan-new")} data-testid="act-plan-new-home">
            飛行計画を作る
          </Button>
          <Button onClick={() => ctx.go("plans")} data-testid="act-plans-list">
            計画の一覧
          </Button>
        </div>
      ) : null}
    </section>
  );
}

// ── pages ────────────────────────────────────────────────────────────────────

function HomePage({ ctx }: { readonly ctx: PageCtx }) {
  const busy = ctx.day === "busy";
  const flights = UPCOMING;
  if (ctx.device === "phone") {
    return (
      <div className="flex flex-col gap-6" data-testid="page-home">
        {busy ? <FlightCard ctx={ctx} flight={TODAY_FLIGHT} /> : <EmptyDayCard ctx={ctx} />}
        <ActionsSection ctx={ctx} />
        <DeadlinesSection />
        {busy ? null : <UpcomingSection ctx={ctx} flights={flights.slice(0, 2)} title="直近の飛行" />}
        {busy && ctx.plansOnHome ? <UpcomingSection ctx={ctx} flights={flights} title="これからの飛行" /> : null}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-5" data-testid="page-home">
      <Head
        ctx={ctx}
        page="home"
        meta={TODAY_LABEL}
        actions={
          <>
            <Button variant="primary" icon="plus" onClick={() => ctx.go("plan-new")} data-testid="act-plan-new-head">
              飛行計画を作る
            </Button>
            <Button icon="place" onClick={() => ctx.go("judge")} data-testid="act-judge-head">
              地点を判定する
            </Button>
          </>
        }
      />
      <div className="grid grid-cols-[minmax(0,1fr)_21rem] items-start gap-8">
        <div className="flex flex-col gap-6">
          {busy ? <FlightCard ctx={ctx} flight={TODAY_FLIGHT} /> : <EmptyDayCard ctx={ctx} />}
          <ActionsSection ctx={ctx} />
        </div>
        <div className="flex flex-col gap-6">
          <DeadlinesSection />
          <UpcomingSection ctx={ctx} flights={flights} title="直近の飛行" />
        </div>
      </div>
    </div>
  );
}

function PlansPage({ ctx }: { readonly ctx: PageCtx }) {
  const all: readonly Flight[] = ctx.day === "busy" ? [TODAY_FLIGHT, ...UPCOMING] : UPCOMING;
  return (
    <div className="flex flex-col gap-5" data-testid="page-plans">
      <Head
        ctx={ctx}
        page="plans"
        actions={
          <Button variant="primary" icon="plus" onClick={() => ctx.go("plan-new")} data-testid="act-plan-new-list" className={ctx.device === "phone" ? "w-full" : undefined}>
            飛行計画を作る
          </Button>
        }
      />
      <ul className="flex flex-col divide-y divide-line border-y border-line">
        {all.map((f) => (
          <li key={f.id} className="flex flex-col gap-2 py-3">
            <p className="flex flex-wrap items-baseline justify-between gap-x-3">
              <span className="min-w-0 text-body font-medium text-fg">
                <span className="tabular-nums">{f.when === "今日" ? `今日 ${f.time}` : f.when}</span> {f.place}
              </span>
              <span className="text-aux text-fg-mute">
                {f.aircraft} ・ {f.pilot}
              </span>
            </p>
            <Route done={f.done} compact />
          </li>
        ))}
      </ul>
    </div>
  );
}

const JOURNAL_FILTERS: readonly { readonly id: "all" | JournalKind; readonly label: string }[] = [
  { id: "all", label: "すべて" },
  { id: "flight", label: JOURNAL_KIND_LABEL.flight },
  { id: "inspection", label: JOURNAL_KIND_LABEL.inspection },
  { id: "incident", label: JOURNAL_KIND_LABEL.incident },
];

function JournalPage({ ctx }: { readonly ctx: PageCtx }) {
  const [filter, setFilter] = useState<"all" | JournalKind>("all");
  const rows = JOURNAL_ENTRIES.filter((e) => filter === "all" || e.kind === filter);
  const phone = ctx.device === "phone";
  return (
    <div className="flex flex-col gap-5" data-testid="page-journal">
      <Head ctx={ctx} page="journal" />
      <div className={cx("flex gap-2", phone ? "flex-col" : "flex-wrap")}>
        <Button variant="primary" icon="flight" onClick={() => ctx.go("journal-new")} data-testid="act-journal-flight">
          飛行記録を入力
        </Button>
        <Button icon="inspection" onClick={() => ctx.go("inspection-new")} data-testid="act-journal-inspection">
          日常点検をする
        </Button>
        <Button icon="incident" onClick={() => ctx.go("incident-new")} data-testid="act-journal-incident">
          事故・ヒヤリハットを記録
        </Button>
      </div>
      <div role="group" aria-label="種類で絞り込み" className="flex flex-wrap gap-2">
        {JOURNAL_FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            aria-pressed={filter === f.id}
            onClick={() => setFilter(f.id)}
            className={cx(
              "inline-flex min-h-11 items-center gap-1.5 rounded-ctl border px-3 text-table transition-colors duration-[var(--dur)]",
              filter === f.id ? "border-accent bg-surface font-semibold text-accent" : "border-line-strong text-fg-soft hov:bg-sunken",
            )}
          >
            {filter === f.id ? <Icon name="check" size={14} /> : null}
            {f.label}
          </button>
        ))}
      </div>
      <ul className="flex flex-col divide-y divide-line border-y border-line" aria-label="日誌の一覧（見本）">
        {rows.map((e) => (
          <li key={e.id} className="flex min-h-14 items-center gap-3 py-2">
            <span className="w-11 shrink-0 text-table tabular-nums text-fg-mute">{e.date}</span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-body font-medium text-fg">{e.title}</span>
              <span className="truncate text-aux text-fg-mute">{e.note}</span>
            </span>
            <StatusPill meaning={e.kind === "incident" ? "warn" : "neutral"} icon={e.kind === "incident" ? "alert" : "dot"}>
              {JOURNAL_KIND_LABEL[e.kind]}
            </StatusPill>
          </li>
        ))}
      </ul>
    </div>
  );
}

const REGISTER_KINDS: readonly { readonly id: RegisterKind; readonly icon: IconName }[] = [
  { id: "aircraft", icon: "aircraft" },
  { id: "pilots", icon: "pilot" },
  { id: "permits", icon: "permit" },
  { id: "places", icon: "place" },
];

function RegisterPage({ ctx }: { readonly ctx: PageCtx }) {
  return (
    <div className="flex flex-col gap-6" data-testid="page-register">
      <Head ctx={ctx} page="register" />
      <ul className="flex flex-col divide-y divide-line border-y border-line">
        {REGISTER_KINDS.map((k) => (
          <li key={k.id}>
            <button
              type="button"
              onClick={() => ctx.go(k.id)}
              data-testid={`register-${k.id}`}
              className="flex min-h-14 w-full items-center gap-3 py-2 text-left transition-colors duration-[var(--dur)] hov:bg-accent-soft"
            >
              <Icon name={k.icon} size={20} className="text-fg-mute" />
              <span className="min-w-0 flex-1 text-body font-medium text-fg">{REGISTER_KIND_LABEL[k.id]}</span>
              <span className="text-table tabular-nums text-fg-mute">{REGISTER_ROWS[k.id].length} 件</span>
              <Icon name="chevron-right" size={18} className="text-fg-mute" />
            </button>
          </li>
        ))}
      </ul>
      <DipsNote />
    </div>
  );
}

/** A quiet place for the DIPS link: nothing here works yet, and it says so. */
function DipsNote() {
  const rows: readonly { readonly what: string; readonly state: string }[] = [
    { what: "機体・操縦者の取り込み", state: "未接続" },
    { what: "登録元の表示", state: "いまはすべて「アプリ」" },
    { what: "通報の状態", state: "手動で記録" },
  ];
  return (
    <section aria-label="DIPS との接続" data-testid="dips-note" className="flex flex-col gap-2 rounded-ctl bg-sunken p-4">
      <p className="flex items-center gap-2 text-table font-medium text-fg">
        <Icon name="lock" size={16} className="text-fg-mute" />
        DIPS との接続：未接続
      </p>
      <dl className="flex flex-col divide-y divide-line">
        {rows.map((r) => (
          <div key={r.what} className="flex flex-wrap items-baseline justify-between gap-x-4 py-1.5 text-table">
            <dt className="text-fg-soft">{r.what}</dt>
            <dd className="text-fg-mute">{r.state}</dd>
          </div>
        ))}
      </dl>
      <p className="text-aux text-fg-mute">つながるまでは、アプリの中で登録し、通報は DIPS で行った結果を手で記録します。</p>
    </section>
  );
}

const NEW_PAGE_OF: Readonly<Partial<Record<RegisterKind, PageId>>> = { aircraft: "aircraft-new", pilots: "pilot-new" };

function RegisterListPage({ ctx, kind }: { readonly ctx: PageCtx; readonly kind: RegisterKind }) {
  const target = NEW_PAGE_OF[kind];
  const phone = ctx.device === "phone";
  const label = REGISTER_KIND_LABEL[kind];
  const importable = kind === "aircraft" || kind === "pilots";
  return (
    <div className="flex flex-col gap-5" data-testid={`page-${kind}`}>
      <Head
        ctx={ctx}
        page={kind}
        actions={
          <>
            {target ? (
              <Button variant="primary" icon="plus" onClick={() => ctx.go(target)} data-testid="act-register-new" className={phone ? "w-full" : undefined}>
                {label}を登録
              </Button>
            ) : null}
            {importable ? (
              <Button disabled icon="download" className={phone ? "w-full" : undefined} data-testid="act-dips-import">
                DIPS から取り込む（未接続）
              </Button>
            ) : null}
          </>
        }
      />
      {target ? null : <p className="text-table text-fg-mute">{label}の登録画面は、この見本には入れていません。</p>}
      <ul className="flex flex-col divide-y divide-line border-y border-line" aria-label={`${label}の一覧（見本）`}>
        {REGISTER_ROWS[kind].map((r) => (
          <li key={r.id} className="flex min-h-14 items-center gap-3 py-2">
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-body font-medium text-fg">{r.name}</span>
              <span className="truncate text-aux text-fg-mute">{r.detail}</span>
            </span>
            <StatusPill meaning="neutral" icon="dot">
              登録元：アプリ
            </StatusPill>
          </li>
        ))}
      </ul>
    </div>
  );
}

type StubField = { readonly label: string; readonly kind: "text" | "date" | "time" | "select" | "textarea"; readonly options?: readonly string[]; readonly required?: boolean; readonly hint?: string; readonly placeholder?: string };

const STUBS: Readonly<Record<string, { readonly fields: readonly StubField[]; readonly checks?: readonly string[]; readonly route?: boolean }>> = {
  "plan-new": {
    route: true,
    fields: [
      { label: "計画名", kind: "text", required: true, placeholder: "例：見本公園の撮影" },
      { label: "飛行する日", kind: "date", required: true },
      { label: "場所", kind: "select", required: true, options: ["登録した地点から選ぶ", "見本公園", "見本橋梁", "見本河川敷"], hint: "判定から来たときは、地点・飛行方法・許可が入ります。" },
      { label: "機体", kind: "select", required: true, options: ["見本機 01", "見本機 02", "見本機 03"] },
      { label: "操縦者", kind: "select", required: true, options: ["見本 一郎", "見本 二郎", "見本 三郎"] },
    ],
  },
  "aircraft-new": {
    fields: [
      { label: "機体の名前", kind: "text", required: true, placeholder: "例：見本機 04" },
      { label: "型式", kind: "text" },
      { label: "登録記号", kind: "text" },
      { label: "重さ", kind: "select", options: ["100g 未満", "100g 以上 250g 未満", "250g 以上"] },
    ],
  },
  "pilot-new": {
    fields: [
      { label: "氏名", kind: "text", required: true, placeholder: "例：見本 四郎" },
      { label: "技能証明の番号", kind: "text" },
      { label: "技能証明の期限", kind: "date" },
    ],
  },
  "inspection-new": {
    fields: [
      { label: "機体", kind: "select", required: true, options: ["見本機 01", "見本機 02", "見本機 03"] },
      { label: "実施した場所", kind: "text", placeholder: "例：見本公園" },
    ],
    checks: ["プロペラに傷や緩みがない", "バッテリーが十分に充電されている", "機体の外観に破損がない", "送信機と機体がつながる"],
  },
  "journal-new": {
    fields: [
      { label: "計画", kind: "select", options: ["10:30 見本公園の撮影", "計画なしで記録する"] },
      { label: "離陸の時刻", kind: "time" },
      { label: "着陸の時刻", kind: "time" },
      { label: "メモ", kind: "textarea" },
    ],
  },
  "incident-new": {
    fields: [
      { label: "種類", kind: "select", required: true, options: ["ヒヤリハット", "事故"] },
      { label: "起きた日時", kind: "text", placeholder: "例：10/24 10:40" },
      { label: "場所", kind: "text" },
      { label: "何が起きたか", kind: "textarea", required: true },
    ],
  },
};

function StubPage({ ctx, page }: { readonly ctx: PageCtx; readonly page: PageId }) {
  const uid = useId().replace(/:/g, "");
  const spec = STUBS[page]!;
  const [checked, setChecked] = useState<readonly boolean[]>(() => (spec.checks ?? []).map(() => false));
  return (
    <div className={cx("flex flex-col gap-5", ctx.device === "pc" && "max-w-xl")} data-testid={`stub-${page}`}>
      <Head ctx={ctx} page={page} />
      {spec.route ? <Route done={1} nextLabel="いま" compact={ctx.device === "phone"} /> : null}
      <NoticeBar meaning="neutral" icon="info">
        入力欄の並びだけを示す見本です。保存はできません。
      </NoticeBar>
      {spec.fields.map((f, i) => {
        const id = `${uid}-${i}`;
        return (
          <FormField key={id} id={id} label={f.label} required={f.required} hint={f.hint}>
            {f.kind === "select" ? (
              <Select id={id}>
                {f.options!.map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </Select>
            ) : f.kind === "textarea" ? (
              <Textarea id={id} />
            ) : (
              <TextInput id={id} type={f.kind === "date" ? "date" : f.kind === "time" ? "time" : "text"} placeholder={f.placeholder} />
            )}
          </FormField>
        );
      })}
      {spec.checks ? (
        <fieldset className="flex flex-col">
          <legend className="mb-1 text-table font-medium text-fg">点検の項目</legend>
          {spec.checks.map((c, i) => (
            <Checkbox key={c} label={c} checked={checked[i] ?? false} onChange={(e) => setChecked((prev) => prev.map((v, j) => (j === i ? e.target.checked : v)))} />
          ))}
        </fieldset>
      ) : null}
      <Button variant="primary" disabled className={ctx.device === "phone" ? "w-full" : "self-start"}>
        保存する（見本では保存しません）
      </Button>
    </div>
  );
}

function FieldPage({ ctx }: { readonly ctx: PageCtx }) {
  return (
    <div className="field flex min-h-full flex-col gap-4 bg-app p-4" data-testid="page-field">
      <div className="flex flex-col gap-1">
        <p className="text-aux text-fg-mute">今日の飛行</p>
        <p className="text-h2 font-semibold text-fg">
          <span className="tabular-nums">{TODAY_FLIGHT.time}</span> {TODAY_FLIGHT.place}
        </p>
      </div>
      <Route done={TODAY_FLIGHT.done} compact />
      <Button variant="primary" icon="inspection" onClick={() => ctx.go("inspection-new")} data-testid="field-inspection" className="w-full">
        日常点検をする
      </Button>
      <Button icon="journal" onClick={() => ctx.go("journal-new")} data-testid="field-journal" className="w-full">
        日誌を記入する
      </Button>
      <Button icon="incident" onClick={() => ctx.go("incident-new")} data-testid="field-incident" className="w-full">
        事故・ヒヤリハットを記録する
      </Button>
      <p className="text-aux text-fg-mute">離陸と着陸のボタンは実画面にあります。この見本には入れていません。</p>
    </div>
  );
}

// ── judge: the sample map, layers, and the three arrangements ────────────────

function LayerArt({ id, uid }: { readonly id: LayerId; readonly uid: string }) {
  switch (id) {
    case "did":
      return <polygon points="108,96 196,92 202,150 192,238 120,242 102,170" fill={`url(#${uid}-did)`} stroke="var(--warn-line)" strokeWidth="1.4" />;
    case "urgent":
      return (
        <>
          <circle cx="300" cy="62" r="48" fill={`url(#${uid}-urgent)`} />
          <circle cx="300" cy="62" r="48" stroke="var(--danger-line)" strokeWidth="2.4" strokeDasharray="7 5" />
        </>
      );
    case "industrial":
      return <rect x="250" y="216" width="130" height="68" fill={`url(#${uid}-industrial)`} stroke="var(--neutral-line)" strokeWidth="1.4" />;
    case "airport":
      return (
        <>
          <ellipse cx="64" cy="44" rx="62" ry="34" stroke="var(--info-line)" strokeWidth="1.8" />
          <ellipse cx="64" cy="44" rx="40" ry="20" stroke="var(--info-line)" strokeWidth="1.2" strokeDasharray="4 4" />
        </>
      );
    case "park":
      return <path d="M258 196c16-20 50-24 68-8s14 42-6 54-52 8-62-8-8-28 0-38z" fill={`url(#${uid}-park)`} stroke="var(--ok-line)" strokeWidth="1.2" />;
  }
}

function LayerDefs({ uid }: { readonly uid: string }) {
  return (
    <defs>
      <pattern id={`${uid}-did`} width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <line x1="0" y1="0" x2="0" y2="8" stroke="var(--warn-line)" strokeWidth="1.6" />
      </pattern>
      <pattern id={`${uid}-urgent`} width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
        <line x1="0" y1="0" x2="0" y2="10" stroke="var(--danger-line)" strokeWidth="0.9" />
      </pattern>
      <pattern id={`${uid}-industrial`} width="9" height="9" patternUnits="userSpaceOnUse">
        <path d="M0 0H9M0 0V9" stroke="var(--neutral-line)" strokeWidth="1" />
      </pattern>
      <pattern id={`${uid}-park`} width="8" height="8" patternUnits="userSpaceOnUse">
        <circle cx="4" cy="4" r="1.3" fill="var(--ok-line)" />
      </pattern>
    </defs>
  );
}

/** The little picture that sits in front of a layer name. It uses the same pattern as the map. */
function LayerSwatch({ id }: { readonly id: LayerId }) {
  const uid = useId().replace(/:/g, "");
  return (
    <svg viewBox="0 0 28 18" width="28" height="18" fill="none" aria-hidden="true" focusable="false" className="shrink-0">
      <LayerDefs uid={uid} />
      {id === "did" ? <rect x="1" y="1" width="26" height="16" fill={`url(#${uid}-did)`} stroke="var(--warn-line)" strokeWidth="1.2" /> : null}
      {id === "urgent" ? <rect x="1" y="1" width="26" height="16" fill={`url(#${uid}-urgent)`} stroke="var(--danger-line)" strokeWidth="2" strokeDasharray="5 3" /> : null}
      {id === "industrial" ? <rect x="1" y="1" width="26" height="16" fill={`url(#${uid}-industrial)`} stroke="var(--neutral-line)" strokeWidth="1.2" /> : null}
      {id === "airport" ? (
        <>
          <ellipse cx="14" cy="9" rx="12.5" ry="7.5" stroke="var(--info-line)" strokeWidth="1.5" />
          <ellipse cx="14" cy="9" rx="7" ry="3.8" stroke="var(--info-line)" strokeWidth="1" strokeDasharray="3 2" />
        </>
      ) : null}
      {id === "park" ? <rect x="1" y="1" width="26" height="16" rx="5" fill={`url(#${uid}-park)`} stroke="var(--ok-line)" strokeWidth="1.2" /> : null}
    </svg>
  );
}

function LayerMap({ judge, setJudge, className, children }: { readonly judge: JudgeState; readonly setJudge: PageCtx["setJudge"]; readonly className?: string; readonly children?: ReactNode }) {
  const uid = useId().replace(/:/g, "");
  return (
    <div className={cx("relative overflow-hidden bg-sunken", className)} data-testid="judge-map">
      <MapPlaceholder site={false} label="地図の見本" />
      <svg viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice" className="pointer-events-none absolute inset-0 h-full w-full" fill="none" aria-hidden="true">
        <LayerDefs uid={uid} />
        {LAYERS.filter((l) => !judge.off.includes(l.id)).map((l) => (
          <g key={l.id} data-layer={l.id}>
            <LayerArt id={l.id} uid={uid} />
          </g>
        ))}
      </svg>
      <button
        type="button"
        aria-label="地図で地点を指定（見本）"
        data-testid="map-pick"
        className="absolute inset-0 cursor-crosshair"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          // a keyboard press has no position: use the middle
          const x = e.detail === 0 ? 50 : ((e.clientX - r.left) / r.width) * 100;
          const y = e.detail === 0 ? 50 : ((e.clientY - r.top) / r.height) * 100;
          setJudge((j) => ({ ...j, point: { x, y }, geo: "done", source: "map" }));
        }}
      />
      {judge.point ? (
        <span className="pointer-events-none absolute z-[1] text-accent" style={{ left: `${judge.point.x}%`, top: `${judge.point.y}%`, transform: "translate(-50%, -100%)" }} data-testid="map-pin">
          <Icon name="place" size={32} />
        </span>
      ) : null}
      <span className="pointer-events-none absolute left-2 top-2 rounded-ctl border border-line bg-surface px-2 text-aux text-fg-mute">見本の絵・実際の区域ではありません</span>
      {children}
    </div>
  );
}

function toggleLayer(setJudge: PageCtx["setJudge"], id: LayerId): void {
  setJudge((j) => ({ ...j, off: j.off.includes(id) ? j.off.filter((x) => x !== id) : [...j.off, id], toggles: j.toggles + 1 }));
}

function LayerChips({ judge, setJudge, className }: { readonly judge: JudgeState; readonly setJudge: PageCtx["setJudge"]; readonly className?: string }) {
  return (
    <div role="group" aria-label="地図に重ねる層" data-testid="layer-chips" className={cx("flex flex-wrap gap-2", className)}>
      {LAYERS.map((l) => {
        const on = !judge.off.includes(l.id);
        return (
          <button
            key={l.id}
            type="button"
            aria-pressed={on}
            data-testid={`layer-${l.id}`}
            onClick={() => toggleLayer(setJudge, l.id)}
            className={cx(
              "inline-flex min-h-11 items-center gap-2 rounded-ctl border bg-surface px-2.5 text-table transition-colors duration-[var(--dur)]",
              on ? "border-accent font-medium text-fg" : "border-line-strong text-fg-mute",
            )}
          >
            <LayerSwatch id={l.id} />
            {l.short}
            {on ? <Icon name="check" size={14} className="text-accent" /> : <span className="text-aux">非表示</span>}
          </button>
        );
      })}
    </div>
  );
}

function ResultBody({ ctx, judge }: { readonly ctx: PageCtx; readonly judge: JudgeState }) {
  const phone = ctx.device === "phone";
  if (judge.geo === "loading")
    return (
      <p role="status" className="flex items-center gap-2 text-table text-fg-soft" data-testid="judge-loading">
        <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-line-strong border-t-accent" aria-hidden="true" />
        現在地を確かめています…
      </p>
    );
  if (judge.geo === "denied")
    return (
      <div data-testid="judge-denied" className="flex flex-col gap-2">
        <NoticeBar meaning="warn">現在地を取得できませんでした。端末の位置情報の許可を確かめるか、地図で地点を指定してください。</NoticeBar>
        <Button onClick={() => ctx.setJudge((j) => ({ ...j, geo: "loading" }))} data-testid="judge-retry">
          もう一度試す
        </Button>
      </div>
    );
  if (!judge.point)
    return (
      <p className="text-table text-fg-mute" data-testid="judge-empty">
        地点を指定すると、ここに結果が出ます。
      </p>
    );
  return (
    <div className="flex flex-col gap-3" data-testid="judge-result">
      <VerdictStamp level="needs_procedure" className="self-start" />
      <ul className="flex flex-col divide-y divide-line border-y border-line" aria-label="確認項目（見本）">
        {SAMPLE_RESULT_ROWS.map((r) => (
          <li key={r.label} className="flex min-h-11 items-center justify-between gap-3 text-table">
            <span className="text-fg">{r.label}</span>
            <StatusPill meaning={r.meaning as Meaning}>{r.state}</StatusPill>
          </li>
        ))}
      </ul>
      <p className="text-aux text-fg-mute">層の表示を切り替えても、結果は変わりません。</p>
      <NoticeBar meaning="neutral">判定は目安です。手続きは公式の窓口で行います。（見本の文言）</NoticeBar>
      <Button variant="primary" onClick={() => ctx.go("plan-new")} data-testid="act-plan-from-judge" className={phone ? "w-full" : undefined}>
        この判定で飛行計画を作る
      </Button>
    </div>
  );
}

function JudgePage({ ctx }: { readonly ctx: PageCtx }) {
  const { judge, setJudge, geoMode } = ctx;
  // the position check takes a moment on a real phone; the sample waits a little too
  useEffect(() => {
    if (judge.geo !== "loading") return;
    const t = window.setTimeout(() => setJudge((j) => ({ ...j, geo: geoMode === "denied" ? "denied" : "done", point: geoMode === "denied" ? j.point : { x: 52, y: 52 }, source: geoMode === "denied" ? j.source : "geo" })), 600);
    return () => window.clearTimeout(t);
  }, [judge.geo, geoMode, setJudge]);

  if (ctx.device === "phone") {
    return (
      <div className="flex flex-col gap-4" data-testid="page-judge">
        <LayerMap judge={judge} setJudge={setJudge} className="h-52 shrink-0 rounded-ctl border border-line-strong" />
        <Button
          variant="primary"
          icon="place"
          onClick={() => setJudge((j) => ({ ...j, geo: "loading" }))}
          data-testid="act-geo"
          className="w-full"
        >
          現在地で判定する
        </Button>
        <section aria-label="判定の結果" aria-live="polite" className="flex flex-col gap-2">
          <H>結果</H>
          <ResultBody ctx={ctx} judge={judge} />
        </section>
        <section aria-label="地図に重ねる層" className="flex flex-col gap-2">
          <H>地図の層</H>
          <LayerChips judge={judge} setJudge={setJudge} />
        </section>
      </div>
    );
  }

  if (ctx.judgeForm === "stack") {
    return (
      <div className="flex max-w-3xl flex-col gap-4" data-testid="page-judge">
        <Head ctx={ctx} page="judge" meta="現状の並び（見本）" />
        <NoticeBar meaning="neutral">判定は目安です。手続きは公式の窓口で行います。（見本の文言）</NoticeBar>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <FormField id="stack-address" label="住所">
              <TextInput id="stack-address" placeholder="例：見本市 見本町 1-2-3" />
            </FormField>
          </div>
          <FormField id="stack-lat" label="緯度">
            <TextInput id="stack-lat" placeholder="35.0000" inputMode="decimal" />
          </FormField>
          <FormField id="stack-lng" label="経度">
            <TextInput id="stack-lng" placeholder="133.0000" inputMode="decimal" />
          </FormField>
        </div>
        <Button variant="primary" className="self-start" onClick={() => setJudge((j) => ({ ...j, point: j.point ?? { x: 52, y: 52 }, geo: "done", source: j.source ?? "map" }))} data-testid="act-check">
          規制をチェック
        </Button>
        <LayerMap judge={judge} setJudge={setJudge} className="h-[22rem] shrink-0 rounded-ctl border border-line-strong" />
        <fieldset className="flex flex-col" data-testid="legend-list">
          <legend className="mb-1 text-table font-medium text-fg">凡例</legend>
          <div className="grid grid-cols-2 gap-x-4">
            {LAYERS.map((l) => (
              <Checkbox
                key={l.id}
                data-testid={`legend-${l.id}`}
                checked={!judge.off.includes(l.id)}
                onChange={() => toggleLayer(setJudge, l.id)}
                label={
                  <span className="inline-flex items-center gap-2">
                    <LayerSwatch id={l.id} />
                    {l.label}
                  </span>
                }
              />
            ))}
          </div>
        </fieldset>
        <section aria-label="判定の結果" aria-live="polite" className="flex flex-col gap-2">
          <H>結果</H>
          <ResultBody ctx={ctx} judge={judge} />
        </section>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4" data-testid="page-judge">
      <Head ctx={ctx} page="judge" meta="地図を中心にした並び（見本）" />
      <div className="grid h-[32rem] grid-cols-[15rem_minmax(0,1fr)_16rem] overflow-hidden rounded-ctl border border-line-strong bg-surface" data-testid="judge-workspace">
        <aside aria-label="入力" className="flex min-h-0 flex-col gap-4 overflow-y-auto border-r border-line p-4">
          <H>入力</H>
          <FormField id="ws-address" label="住所または座標">
            <TextInput id="ws-address" placeholder="例：見本市 見本町 1-2-3" />
          </FormField>
          <FormField id="ws-method" label="飛行方法">
            <Select id="ws-method">
              <option>目視内</option>
              <option>目視外</option>
            </Select>
          </FormField>
          <Button variant="primary" onClick={() => setJudge((j) => ({ ...j, point: j.point ?? { x: 52, y: 52 }, geo: "done", source: j.source ?? "map" }))} data-testid="act-check">
            規制をチェック
          </Button>
          <p className="text-aux text-fg-mute">地図をクリックしても、地点を指定できます。</p>
        </aside>
        <LayerMap judge={judge} setJudge={setJudge} className="h-full min-w-0">
          <div className="absolute inset-x-0 bottom-0 z-[2] border-t border-line-strong bg-surface p-2">
            <LayerChips judge={judge} setJudge={setJudge} />
          </div>
        </LayerMap>
        <aside aria-label="結果" aria-live="polite" className="flex min-h-0 flex-col gap-3 overflow-y-auto border-l border-line p-4">
          <H>結果</H>
          <ResultBody ctx={ctx} judge={judge} />
        </aside>
      </div>
    </div>
  );
}

export function TrialPage({ page, ctx }: { readonly page: PageId; readonly ctx: PageCtx }) {
  switch (page) {
    case "home":
      return <HomePage ctx={ctx} />;
    case "judge":
      return <JudgePage ctx={ctx} />;
    case "plans":
      return <PlansPage ctx={ctx} />;
    case "journal":
      return <JournalPage ctx={ctx} />;
    case "register":
      return <RegisterPage ctx={ctx} />;
    case "aircraft":
    case "pilots":
    case "permits":
    case "places":
      return <RegisterListPage ctx={ctx} kind={page} />;
    case "field":
      return <FieldPage ctx={ctx} />;
    case "plan-new":
    case "aircraft-new":
    case "pilot-new":
    case "inspection-new":
    case "journal-new":
    case "incident-new":
      return <StubPage ctx={ctx} page={page} />;
  }
}
