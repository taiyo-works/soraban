"use client";

import { useMemo, useState } from "react";
import { VerdictMark } from "@/components/verdict-mark";
import { VERDICT_LABEL, VERDICT_SCALE } from "@/lib/verdict-display";
import type { ItemVerdict } from "@soraban/regulations";
import { cx } from "../cx";
import { DataTable, FilterBar, Sparkline, type Column } from "../data";
import { Checkbox, ErrorSummary, FormField, FormGroup, FormRow, Radio, SaveBar, Select, TextInput, Textarea, Toggle, describedBy } from "../forms";
import { useMediaQuery } from "../hooks";
import { Icon, type IconName } from "../icons";
import { Dialog, InfoPopover, useToast } from "../overlays";
import { Button, Card, Disclosure, EmptyState, Kbd, NoticeBar, PageHeader, SectionTitle, StatTile, StatusPill, type Meaning } from "../primitives";
import { Segmented } from "../tabs";
import { MapPlaceholder, Workspace } from "../workspace";
import { PLAN_STATUS_LABEL, PLAN_STATUS_MEANING, SAMPLE_FLIGHTS_14D, SAMPLE_PLANS, type SamplePlan } from "./sample-data";

// The six sample screens of the catalog (contract 1a-6). All data is made up.

const SAMPLE_BADGE = <StatusPill meaning="neutral" icon="info">見本データ</StatusPill>;

// ── 1. Today dashboard ───────────────────────────────────────────────────────

const STEPS: readonly { readonly label: string; readonly state: string; readonly meaning: Meaning; readonly icon: IconName }[] = [
  { label: "判定", state: "済み", meaning: "ok", icon: "check-circle" },
  { label: "通報", state: "済み", meaning: "ok", icon: "check-circle" },
  { label: "確認", state: "待ち", meaning: "warn", icon: "clock" },
  { label: "携行品", state: "未", meaning: "neutral", icon: "dot" },
];

const STEP_TONE: Readonly<Record<Meaning, string>> = {
  ok: "bg-ok-bg text-ok-fg shadow-[inset_0_0_0_1px_var(--ok-line)]",
  warn: "bg-warn-bg text-warn-fg shadow-[inset_0_0_0_1px_var(--warn-line)]",
  danger: "bg-danger-bg text-danger-fg shadow-[inset_0_0_0_1px_var(--danger-line)]",
  info: "bg-info-bg text-info-fg shadow-[inset_0_0_0_1px_var(--info-line)]",
  neutral: "bg-sunken text-fg-mute shadow-[inset_0_0_0_1px_var(--line)]",
};

const FACTS: readonly { readonly icon: IconName; readonly label: string; readonly value: string }[] = [
  { icon: "place", label: "地点", value: "見本の地点 A" },
  { icon: "aircraft", label: "機体", value: "見本機 01" },
  { icon: "pilot", label: "操縦者", value: "見本 一郎" },
];

export function TodayScreen() {
  const nextActions = [
    { urgency: "今日", meaning: "danger" as const, text: "運航管理者の確認を済ませる", due: "10:00" },
    { urgency: "今日", meaning: "warn" as const, text: "携行品を確かめる", due: "10:30" },
    { urgency: "明日", meaning: "info" as const, text: "日誌を記入する", due: "11/05" },
  ];
  const schedule = [
    { time: "10:30", name: "見本の地点 A の撮影", day: "今日", now: true },
    { time: "15:00", name: "見本の地点 B の点検", day: "今日", now: false },
    { time: "11/05", name: "見本の地点 C の測量", day: "明日", now: false },
  ];
  return (
    <div className="flex flex-col gap-6" data-testid="sample-today">
      <PageHeader
        as="h3"
        title="今日"
        meta="2026-11-04（水）"
        actions={
          <>
            {SAMPLE_BADGE}
            <Button variant="primary" icon="plus">
              新規
            </Button>
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-12">
        <Card variant="primary" className="flex flex-col gap-6 lg:col-span-8">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-4">
              <span className="mt-1 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] bg-accent-soft text-accent">
                <Icon name="flight" size={22} />
              </span>
              <div className="min-w-0">
                <p className="text-aux font-medium text-fg-mute">今日の運航</p>
                <p className="text-[2.5rem] font-semibold leading-none tracking-tight tabular-nums text-fg">10:30</p>
                <p className="mt-1.5 text-h3 font-semibold text-fg">見本の地点 A の撮影</p>
              </div>
            </div>
            <StatusPill meaning="warn">確認待ち</StatusPill>
          </div>
          <ol className="grid grid-cols-4" aria-label="進行の帯">
            {STEPS.map((st, i) => (
              <li key={st.label} className="relative flex flex-col items-center gap-1.5 text-center">
                {i < STEPS.length - 1 ? (
                  <span aria-hidden="true" className={cx("absolute left-1/2 top-3.5 h-0.5 w-full -translate-y-1/2 rounded-pill", st.meaning === "ok" ? "bg-ok-line" : "bg-line")} />
                ) : null}
                <span className={cx("relative inline-flex h-7 w-7 items-center justify-center rounded-pill", STEP_TONE[st.meaning])}>
                  <Icon name={st.icon} size={16} />
                </span>
                <span className="flex flex-col">
                  <span className="text-table font-medium text-fg">{st.label}</span>
                  <span className="text-aux text-fg-soft">{st.state}</span>
                </span>
              </li>
            ))}
          </ol>
          <dl className="grid grid-cols-1 gap-3 rounded-[12px] bg-sunken px-4 py-3 sm:grid-cols-3 sm:gap-0 sm:divide-x sm:divide-line">
            {FACTS.map((f) => (
              <div key={f.label} className="flex min-w-0 items-center gap-3 sm:px-4 sm:first:pl-0 sm:last:pr-0">
                <Icon name={f.icon} size={20} className="text-fg-mute" />
                <div className="min-w-0">
                  <dt className="text-aux text-fg-mute">{f.label}</dt>
                  <dd className="truncate text-table font-medium text-fg">{f.value}</dd>
                </div>
              </div>
            ))}
          </dl>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="inline-flex items-center gap-2 text-table text-fg-soft">
              <Icon name="clock" size={16} className="text-fg-mute" />
              確認の期限は 10:00 です
            </p>
            <Button variant="primary">確認の画面を開く</Button>
          </div>
        </Card>
        <div className="flex flex-col gap-2 lg:col-span-4">
          <StatTile size="lead" label="次にやること" value={3} unit="件" status="期限が近い" meaning="warn" href="#" />
          <StatTile label="今日の飛行" value={2} unit="件" href="#" />
          <StatTile label="飛行中" value={0} unit="件" status="なし" meaning="ok" href="#" />
          <StatTile label="日誌が未記入" value={1} unit="件" status="要記入" meaning="warn" href="#" />
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-12">
        <section className="flex flex-col gap-3 lg:col-span-7">
          <SectionTitle>次にやること</SectionTitle>
          <ul className="flex flex-col divide-y divide-line rounded-card bg-surface px-4 shadow-card">
            {nextActions.map((a) => (
              <li key={a.text} className="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
                <StatusPill meaning={a.meaning}>{a.urgency}</StatusPill>
                <span className="min-w-0 flex-1 text-body text-fg">{a.text}</span>
                <span className="text-table tabular-nums text-fg-mute">{a.due}</span>
              </li>
            ))}
          </ul>
        </section>
        <section className="flex flex-col gap-3 lg:col-span-5">
          <SectionTitle aside={<Sparkline values={SAMPLE_FLIGHTS_14D} summary={`直近 14 日の飛行回数（見本）：合計 ${SAMPLE_FLIGHTS_14D.reduce((a, b) => a + b, 0)} 件`} />}>今日の残りと今後の予定</SectionTitle>
          <ul className="flex flex-col rounded-card bg-sunken p-1.5">
            {schedule.map((r) => (
              <li key={r.name} className={cx("flex min-h-12 items-center gap-3 rounded-[10px] px-3 py-2", r.now && "bg-surface shadow-card")}>
                <span className="w-12 shrink-0 text-table font-medium tabular-nums text-fg-soft">{r.time}</span>
                <span className="min-w-0 flex-1 truncate text-body text-fg">{r.name}</span>
                <span className="text-aux text-fg-mute">{r.day}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
      <NoticeBar meaning="neutral" icon="info" title="判定について（見本の文言）">
        判定は目安です。手続きは公式の窓口で行います。
      </NoticeBar>
    </div>
  );
}

// ── 2. List: filter bar + data table + inspector ─────────────────────────────

const PLAN_COLUMNS: Column<SamplePlan>[] = [
  { key: "name", header: "計画名", primary: true, cell: (p) => p.name, sortValue: (p) => p.name },
  { key: "date", header: "日付", mono: true, cell: (p) => p.date, sortValue: (p) => p.date },
  {
    key: "status",
    header: "状態",
    cell: (p) => <StatusPill meaning={PLAN_STATUS_MEANING[p.status]}>{PLAN_STATUS_LABEL[p.status]}</StatusPill>,
    sortValue: (p) => PLAN_STATUS_LABEL[p.status],
  },
  { key: "aircraft", header: "機体", cell: (p) => p.aircraft },
  { key: "pilot", header: "操縦者", cell: (p) => p.pilot },
];

export function ListScreen({ density }: { readonly density: "standard" | "compact" }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"" | SamplePlan["status"]>("");
  const [selected, setSelected] = useState<SamplePlan | null>(null);
  const wide = useMediaQuery("(min-width: 1280px)");
  const toast = useToast();

  const rows = useMemo(
    () => SAMPLE_PLANS.filter((p) => (status ? p.status === status : true) && (query ? p.name.includes(query) || p.pilot.includes(query) : true)),
    [query, status],
  );
  const chips = [
    ...(status ? [{ id: "status", label: "状態", value: PLAN_STATUS_LABEL[status], onRemove: () => setStatus("") }] : []),
    ...(query ? [{ id: "q", label: "語", value: query, onRemove: () => setQuery("") }] : []),
  ];

  return (
    <div className="flex flex-col gap-4" data-testid="sample-list">
      <PageHeader as="h3" title="飛行計画" meta="一覧の見本" actions={<><StatusPill meaning="neutral" icon="info">見本データ</StatusPill><Button variant="primary" icon="plus">新規</Button></>} />
      <NoticeBar meaning="info" data-testid="sample-notice">
        固定の注意書きは、見出しの直下に、この形で常に表示します（折りたたみやホバーには入れません）。
      </NoticeBar>
      <FilterBar
        search={query}
        onSearch={setQuery}
        searchLabel="計画名・操縦者で絞り込み"
        chips={chips}
        count={rows.length}
        onClear={() => {
          setQuery("");
          setStatus("");
        }}
      >
        <div className="w-40">
          <Select aria-label="状態で絞り込み" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            <option value="">状態：すべて</option>
            {(Object.keys(PLAN_STATUS_LABEL) as SamplePlan["status"][]).map((k) => (
              <option key={k} value={k}>
                {PLAN_STATUS_LABEL[k]}
              </option>
            ))}
          </Select>
        </div>
      </FilterBar>
      <div className={cx("grid gap-4", wide && selected && "grid-cols-[minmax(0,1fr)_22rem]")}>
        <DataTable
          caption="飛行計画の一覧（見本）"
          columns={PLAN_COLUMNS}
          rows={rows}
          rowKey={(p) => p.id}
          rowHref={(p) => `#plan-${p.id}`}
          rowTestId={(p) => `sample-row-${p.id}`}
          density={density}
          defaultSort={{ key: "date", dir: "asc" }}
          selectedKey={selected?.id ?? null}
          rowAction={(p) => (
            <Button variant="quiet" size="icon" className="compact:-my-1" aria-label={`${p.name}のプレビューを開く`} data-testid={`sample-preview-${p.id}`} onClick={() => setSelected(p)}>
              <Icon name="sidebar" size={18} />
            </Button>
          )}
          empty={
            <EmptyState
              icon="filter"
              title="条件に合う計画がありません"
              action={
                <Button
                  onClick={() => {
                    setQuery("");
                    setStatus("");
                  }}
                >
                  絞り込みを解除
                </Button>
              }
            >
              絞り込みの条件を変えるか、解除してください。
            </EmptyState>
          }
        />
        {wide && selected ? (
          <Inspector plan={selected} onClose={() => setSelected(null)} onCopy={() => toast.show("リンクをコピーしました（見本）")} />
        ) : null}
      </div>
      {!wide ? (
        <Dialog open={selected !== null} onClose={() => setSelected(null)} title="プレビュー" kind="drawer" footer={<Button onClick={() => setSelected(null)}>閉じる</Button>}>
          {selected ? <InspectorBody plan={selected} /> : null}
        </Dialog>
      ) : null}
    </div>
  );
}

function InspectorBody({ plan }: { readonly plan: SamplePlan }) {
  return (
    <dl className="flex flex-col divide-y divide-line text-body" data-testid="sample-inspector-body">
      {[
        ["計画名", plan.name],
        ["日付", plan.date],
        ["機体", plan.aircraft],
        ["操縦者", plan.pilot],
      ].map(([k, v]) => (
        <div key={k} className="grid grid-cols-[6rem_minmax(0,1fr)] gap-3 py-2.5">
          <dt className="text-table text-fg-mute">{k}</dt>
          <dd className="min-w-0 break-words text-fg">{v}</dd>
        </div>
      ))}
      <div className="grid grid-cols-[6rem_minmax(0,1fr)] gap-3 py-2.5">
        <dt className="text-table text-fg-mute">状態</dt>
        <dd>
          <StatusPill meaning={PLAN_STATUS_MEANING[plan.status]}>{PLAN_STATUS_LABEL[plan.status]}</StatusPill>
        </dd>
      </div>
    </dl>
  );
}

function Inspector({ plan, onClose, onCopy }: { readonly plan: SamplePlan; readonly onClose: () => void; readonly onCopy: () => void }) {
  return (
    <Card as="aside" variant="standard" className="flex h-fit flex-col gap-3" aria-label="プレビュー" data-testid="sample-inspector">
      <div className="flex items-center justify-between gap-2">
        <h3 className="inline-flex items-center gap-2 text-h3 font-semibold text-fg">
          <Icon name="sidebar" size={18} className="text-fg-mute" />
          プレビュー
        </h3>
        <Button variant="quiet" size="icon" aria-label="プレビューを閉じる" onClick={onClose}>
          <Icon name="x" size={18} />
        </Button>
      </div>
      <InspectorBody plan={plan} />
      <div className="flex gap-2">
        <Button variant="primary" className="flex-1">
          詳細を開く
        </Button>
        <Button icon="copy" onClick={onCopy}>
          リンク
        </Button>
      </div>
    </Card>
  );
}

// ── 3. Long form ─────────────────────────────────────────────────────────────

export function FormScreen() {
  const [name, setName] = useState("見本の拠点");
  const [dirty, setDirty] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notify, setNotify] = useState(true);
  const toast = useToast();
  const errors = showErrors ? [{ id: "f-name", message: "名称を入力してください" }, { id: "f-address", message: "住所を入力してください" }] : [];
  const save = (): void => {
    setSaving(true);
    window.setTimeout(() => {
      setSaving(false);
      setDirty(false);
      toast.show("保存しました（見本）");
    }, 1200);
  };
  return (
    <div className="flex flex-col gap-5" data-testid="sample-form">
      <PageHeader
        as="h3"
        title="地点の登録"
        meta="フォームの見本"
        back={{ href: "#list", label: "一覧へ戻る" }}
        actions={
          <>
            <StatusPill meaning="neutral" icon="info">見本データ</StatusPill>
            <Button onClick={() => setShowErrors((v) => !v)} aria-pressed={showErrors}>
              エラー表示を切り替え
            </Button>
          </>
        }
      />
      <ErrorSummary errors={errors} />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,44rem)_12rem]">
        <form
          className="flex flex-col gap-6"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
          onChange={() => setDirty(true)}
        >
          <FormGroup title="基本" footer="必須の項目には「必須」と表示します。">
            <FormField id="f-name" label="名称" required error={errors[0]?.message}>
              <TextInput id="f-name" value={name} onChange={(e) => setName(e.target.value)} invalid={Boolean(errors[0]) && name.trim() === ""} aria-describedby={describedBy("f-name", { error: Boolean(errors[0]) })} />
            </FormField>
            <FormField id="f-address" label="住所" required error={errors[1]?.message} hint="番地まで入力します。">
              <TextInput id="f-address" defaultValue="" invalid={Boolean(errors[1])} aria-describedby={describedBy("f-address", { hint: true, error: Boolean(errors[1]) })} />
            </FormField>
            <FormRow label="表示名" htmlFor="f-short">
              <TextInput id="f-short" placeholder="省略した呼び名（任意）" />
            </FormRow>
            <FormRow label="種別">
              <fieldset className="flex flex-wrap gap-x-6">
                <legend className="sr-only">種別</legend>
                <Radio name="kind" label="社内の拠点" defaultChecked />
                <Radio name="kind" label="取引先" />
                <Radio name="kind" label="その他" />
              </fieldset>
            </FormRow>
          </FormGroup>
          <FormGroup title="通知">
            <div className="flex min-h-11 items-center justify-between gap-4">
              <span className="text-body text-fg">変更を通知する</span>
              <Toggle label="変更を通知する" checked={notify} onChange={(v) => { setNotify(v); setDirty(true); }} />
            </div>
            <Checkbox label="週のまとめも受け取る" hint="毎週月曜にまとめて送ります。" />
          </FormGroup>
          <FormGroup title="メモ">
            <FormField id="f-memo" label="メモ" optional>
              <Textarea id="f-memo" placeholder="自由に記入できます" />
            </FormField>
          </FormGroup>
          <SaveBar
            status={
              <span className="inline-flex items-center gap-2">
                {saving ? <Icon name="clock" size={16} /> : dirty ? <Icon name="alert" size={16} className="text-warn-line" /> : <Icon name="check-circle" size={16} className="text-ok-line" />}
                {saving ? "保存しています" : dirty ? "未保存の変更があります" : "変更はありません"}
              </span>
            }
          >
            <Button type="button" onClick={() => setDirty(false)}>
              取り消す
            </Button>
            <Button type="submit" variant="primary" loading={saving} disabled={!dirty && !saving}>
              保存
            </Button>
          </SaveBar>
        </form>
        <nav aria-label="節の目次" className="sticky top-4 hidden h-fit flex-col xl:flex">
          <p className="mb-1 px-3 text-aux font-semibold tracking-wide text-fg-mute">この画面の節</p>
          {["基本", "通知", "メモ"].map((sec, i) => (
            <a key={sec} href="#sample-form" aria-current={i === 0 ? "true" : undefined} className={cx("inline-flex min-h-9 items-center border-l-2 px-3 text-table transition-colors duration-[var(--dur-fast)] hov:text-fg", i === 0 ? "border-accent font-medium text-fg" : "border-line text-fg-soft")}>
              {sec}
            </a>
          ))}
        </nav>
      </div>
    </div>
  );
}

// ── 4. Workspace ─────────────────────────────────────────────────────────────

const VERDICT_HINT: Readonly<Record<ItemVerdict, string>> = {
  no_fly: "この条件では飛行できない区分があります。",
  needs_procedure: "飛行の前に行う手続きがあります。",
  procedure_done: "入力された手続きの範囲で、条件付きです。",
  no_procedure: "この条件で必要な手続きは見つかりませんでした。",
  unknown: "データが未整備のため、判定できません。",
};

function PaneTitle({ icon, children }: { readonly icon: IconName; readonly children: string }) {
  return (
    <h3 className="inline-flex items-center gap-2 text-h3 font-semibold text-fg">
      <span className="inline-flex h-7 w-7 items-center justify-center rounded-[8px] bg-accent-soft text-accent">
        <Icon name={icon} size={16} />
      </span>
      {children}
    </h3>
  );
}

export function WorkspaceScreen() {
  const [verdict, setVerdict] = useState<ItemVerdict>("needs_procedure");
  const [purpose, setPurpose] = useState("photo");
  const toast = useToast();
  return (
    <div className="flex flex-col gap-4" data-testid="sample-workspace">
      <PageHeader as="h3" title="地点の判定" meta="ワークスペースの見本" actions={SAMPLE_BADGE} />
      <p className="text-aux text-fg-mute">
        1024px 以上は左右のペインと地図、1024px 未満は地図の上のボトムシート（最小・半分・全体）と下のタブ。ペインの端のボタンか <Kbd>[</Kbd> <Kbd>]</Kbd> で開閉します。
      </p>
      <Workspace
        height="min(40rem, calc(100dvh - 12rem))"
        input={
          <div className="flex flex-col gap-5">
            <PaneTitle icon="sliders">条件</PaneTitle>
            <FormField id="ws-address" label="住所または座標" required>
              <TextInput id="ws-address" placeholder="例：見本市 見本町 1-2-3" />
            </FormField>
            <FormField id="ws-weight" label="機体の重量">
              <Select id="ws-weight" defaultValue="250">
                <option value="100">100g 未満</option>
                <option value="250">100g 以上 250g 未満</option>
                <option value="900">250g 以上</option>
              </Select>
            </FormField>
            <div className="flex flex-col gap-1.5">
              <span className="text-table font-medium text-fg">目的</span>
              <Segmented
                label="目的"
                value={purpose}
                onChange={setPurpose}
                options={[
                  { id: "photo", label: "撮影" },
                  { id: "survey", label: "測量" },
                  { id: "other", label: "その他" },
                ]}
              />
            </div>
            <Button variant="primary" onClick={() => toast.show("判定しました（見本）", "info")}>
              判定する
            </Button>
            <div className="flex flex-col gap-1.5 border-t border-line pt-4">
              <p className="text-aux font-semibold tracking-wide text-fg-mute">最近の地点（見本）</p>
              <ul className="flex flex-col">
                {["見本の地点 A", "見本の地点 B", "見本の地点 C"].map((n) => (
                  <li key={n} className="flex min-h-10 items-center gap-2.5 text-table text-fg-soft">
                    <Icon name="place" size={16} className="text-fg-mute" />
                    {n}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        }
        result={
          <div className="flex flex-col gap-5">
            <PaneTitle icon="check-circle">結果</PaneTitle>
            <div className="flex flex-col gap-3 rounded-card bg-sunken p-4">
              <div className="flex items-center gap-3">
                <VerdictMark level={verdict} size="md" decorative />
                <p className="text-h2 font-semibold text-fg" data-testid="sample-verdict-label">{VERDICT_LABEL[verdict]}</p>
              </div>
              <p className="text-table leading-relaxed text-fg-soft">{VERDICT_HINT[verdict]}</p>
            </div>
            <ul className="flex flex-col divide-y divide-line rounded-card bg-surface px-3 shadow-card" aria-label="確認項目（見本）">
              {[
                ["空港等の周辺", "ok", "対象外"],
                ["人口集中地区", "warn", "対象"],
                ["飛行禁止の区域", "ok", "対象外"],
              ].map(([k, m, v]) => (
                <li key={k} className="flex min-h-11 items-center justify-between gap-3 text-table">
                  <span className="text-fg">{k}</span>
                  <StatusPill meaning={m as Meaning}>{v}</StatusPill>
                </li>
              ))}
            </ul>
            <label className="flex flex-col gap-1.5 text-table font-medium text-fg">
              結論の見本を切り替え
              <Select value={verdict} onChange={(e) => setVerdict(e.target.value as ItemVerdict)} aria-label="結論の見本を切り替え">
                {([...VERDICT_SCALE, "unknown"] as ItemVerdict[]).map((v) => (
                  <option key={v} value={v}>
                    {VERDICT_LABEL[v]}
                  </option>
                ))}
              </Select>
            </label>
            <NoticeBar meaning="neutral">判定は目安です。手続きは公式の窓口で行います。（見本の文言）</NoticeBar>
          </div>
        }
        peek={
          <span className="inline-flex items-center gap-2">
            <VerdictMark level={verdict} size="sm" decorative />
            <span className="font-semibold">{VERDICT_LABEL[verdict]}</span>
          </span>
        }
        floating={
          <Card variant="standard" className="glass flex flex-col gap-2 !p-3.5 !shadow-float">
            <p className="text-aux font-semibold tracking-wide text-fg-mute">凡例（見本）</p>
            {([...VERDICT_SCALE, "unknown"] as ItemVerdict[]).map((v) => (
              <span key={v} className="inline-flex items-center gap-2 text-aux text-fg">
                <VerdictMark level={v} size="sm" decorative />
                {VERDICT_LABEL[v]}
              </span>
            ))}
          </Card>
        }
        map={<MapPlaceholder />}
        data-testid="sample-workspace-frame"
      />
    </div>
  );
}

// ── 5. Field mode ────────────────────────────────────────────────────────────

export function FieldScreen() {
  const [recorded, setRecorded] = useState(false);
  const rows: readonly { readonly name: string; readonly state: string; readonly meaning: Meaning; readonly icon: IconName }[] = [
    { name: "判定", state: "済み", meaning: "ok", icon: "check-circle" },
    { name: "通報", state: "済み", meaning: "ok", icon: "check-circle" },
    { name: "運航管理者の確認", state: "済み", meaning: "ok", icon: "check-circle" },
    { name: "携行品", state: "未確認", meaning: "warn", icon: "alert" },
  ];
  return (
    <div className="field ds mx-auto flex max-w-xl flex-col gap-4 rounded-card bg-app p-4 text-fg" data-testid="sample-field">
      <header className="flex flex-col gap-1">
        <p className="text-aux text-fg-mute">現場モード（見本）</p>
        <h3 className="text-h1 font-bold text-fg">見本の地点 A の撮影</h3>
        <div className="mt-2 flex items-center gap-3" aria-label="進み具合 3 / 4">
          <span aria-hidden="true" className="flex h-2 flex-1 overflow-hidden rounded-pill bg-sunken">
            <span className="h-full w-3/4 rounded-pill bg-ok-line" />
          </span>
          <span className="text-aux font-semibold tabular-nums text-fg-soft">3 / 4</span>
        </div>
      </header>
      <ul className="flex flex-col gap-2" aria-label="項目の状態">
        {rows.map((r) => (
          <li key={r.name} className={cx("flex min-h-14 items-center gap-3 rounded-card bg-surface px-4 py-3 shadow-card", r.meaning === "warn" && "shadow-[inset_0_0_0_2px_var(--warn-line)]")}>
            <Icon name={r.icon} size={32} className={r.meaning === "ok" ? "text-ok-fg" : "text-warn-fg"} />
            <span className="min-w-0 flex-1 text-body font-medium text-fg">{r.name}</span>
            <span className={cx("text-state font-bold", r.meaning === "ok" ? "text-ok-fg" : "text-warn-fg")}>{r.state}</span>
          </li>
        ))}
      </ul>
      <Button variant="primary" className="w-full !min-h-16 !text-state !font-bold" onClick={() => setRecorded(true)} data-testid="sample-field-primary">
        {recorded ? "離陸を記録しました" : "離陸を記録する"}
      </Button>
      <div className="flex items-center justify-between gap-3 rounded-card bg-surface px-4 py-3 shadow-card" aria-live="polite">
        <span className="text-body text-fg">送信待ち</span>
        <StatusPill meaning={recorded ? "warn" : "ok"}>{recorded ? "1 件 送信待ち" : "0 件"}</StatusPill>
      </div>
      <NoticeBar meaning="warn" title="離陸の前に（見本の文言）">
        足元と周囲の安全を確かめてから操作します。
      </NoticeBar>
      <Disclosure summary="通信について" icon="info">
        電波が弱い場所では、記録は端末に保存され、通信が戻ると送信されます。
      </Disclosure>
    </div>
  );
}

// ── 6. Legend ────────────────────────────────────────────────────────────────

const MEANING_ROWS: readonly { readonly meaning: Meaning; readonly name: string; readonly example: string }[] = [
  { meaning: "ok", name: "成功", example: "確認済み" },
  { meaning: "warn", name: "注意", example: "確認待ち" },
  { meaning: "danger", name: "危険", example: "期限が過ぎています" },
  { meaning: "info", name: "情報", example: "確認済み" },
  { meaning: "neutral", name: "中立", example: "下書き" },
];

export function LegendScreen() {
  return (
    <div className="flex flex-col gap-6" data-testid="sample-legend">
      <PageHeader as="h3" title="状態の凡例" meta="色・形・文言をそろえて示します" actions={SAMPLE_BADGE} />
      <section className="flex flex-col gap-3">
        <SectionTitle>5 つの意味</SectionTitle>
        <ul className="flex flex-col divide-y divide-line rounded-card bg-surface px-4 shadow-card">
          {MEANING_ROWS.map((m) => (
            <li key={m.meaning} className="grid items-center gap-x-4 gap-y-2 py-3 sm:grid-cols-[5rem_9rem_minmax(0,1fr)]">
              <span className="text-table font-medium text-fg">{m.name}</span>
              <span className="flex"><StatusPill meaning={m.meaning}>{m.example}</StatusPill></span>
              <NoticeBar meaning={m.meaning}>地の上の文字（{m.name}）</NoticeBar>
            </li>
          ))}
        </ul>
      </section>
      <section className="flex flex-col gap-3">
        <SectionTitle aside={<InfoPopover label="判定の段階について">判定は 4 段階と「判定不能」で示します。言葉・記号・色の 3 つで見分けます。</InfoPopover>}>判定の 4 段階と判定不能</SectionTitle>
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {([...VERDICT_SCALE, "unknown"] as ItemVerdict[]).map((v) => (
            <li key={v} className="flex items-center gap-3 rounded-card bg-surface px-4 py-3.5 shadow-card" data-testid={`sample-verdict-${v}`}>
              <VerdictMark level={v} size="md" decorative />
              <span className="min-w-0 text-body font-semibold text-fg">{VERDICT_LABEL[v]}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

