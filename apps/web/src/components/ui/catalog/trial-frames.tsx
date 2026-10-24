"use client";

import { useCallback, useId, useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import { cx } from "../cx";
import { FormField, Select } from "../forms";
import { Icon } from "../icons";
import { Button, StatusPill } from "../primitives";
import { Segmented } from "../tabs";
import type { DayKind, JudgeForm } from "./config";
import { JUDGE_INITIAL, TrialPage, type JudgeState, type PageCtx } from "./trial-pages";
import {
  NAV_ICON,
  NAV_OF_PAGE,
  PAGE_TITLE,
  PARENT_PAGE,
  PC_SCRIPTS,
  PHONE_SCRIPTS,
  REGISTER_KIND_LABEL,
  type NavKey,
  type PageId,
  type ScriptDef,
} from "./trial-data";

// The two interactive frames of the menu and home trial: a PC frame (left menu or top tabs) and a phone frame (five tabs,
// or four tabs with a band for the next flight). Each frame counts the taps made inside it and tells when the goal of the
// chosen script is on screen, so a person can feel the difference and the automated test can measure it the same way.

type TrialState = {
  readonly page: PageId;
  readonly taps: number;
  readonly judge: JudgeState;
  readonly scriptId: string;
  readonly arrivedAt: number | null;
};

const INITIAL: TrialState = { page: "home", taps: 0, judge: JUDGE_INITIAL, scriptId: "", arrivedAt: null };

function goalReached(id: string, s: TrialState, day: DayKind): boolean {
  switch (id) {
    case "p1":
      return s.page === "plan-new";
    case "p2":
      return s.page === "judge" && s.judge.point !== null && s.judge.toggles > 0;
    case "p3":
      return s.page === "aircraft-new";
    case "p4":
      return s.page === "pilot-new";
    case "s1":
      return s.page === "inspection-new";
    case "s2":
      return s.page === "journal-new";
    case "s3":
      return s.page === "home" && day === "empty";
    case "s4":
      return s.page === "judge" && s.judge.source === "geo" && s.judge.geo === "done";
    case "s5":
      return s.page === "incident-new";
    default:
      return false;
  }
}

/** Taps are clicks on something that can be pressed. A click on a label's text is counted once, on the box it forwards to. */
function isTap(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  const el = target.closest("button, a[href], summary, input[type='checkbox'], input[type='radio']");
  return el !== null;
}

function useTrial(scripts: readonly ScriptDef[], day: DayKind, onDay: (d: DayKind) => void) {
  const [st, setSt] = useState<TrialState>(INITIAL);
  const script = scripts.find((s) => s.id === st.scriptId) ?? null;
  // The first time the goal is on screen, keep how many taps it took (set while rendering, from this component's own state).
  if (script && st.arrivedAt === null && goalReached(script.id, st, day)) setSt({ ...st, arrivedAt: st.taps });
  const go = useCallback((page: PageId) => setSt((s) => ({ ...s, page })), []);
  const setJudge = useCallback((fn: (prev: JudgeState) => JudgeState) => setSt((s) => ({ ...s, judge: fn(s.judge) })), []);
  // Counted while the click bubbles, not in the capture phase: a render between the capture and the bubble phase would put a controlled checkbox back before React sees it change.
  const onClickTap = useCallback((e: MouseEvent) => {
    if (isTap(e.target)) setSt((s) => ({ ...s, taps: s.taps + 1 }));
  }, []);
  const pick = (id: string): void => {
    const next = scripts.find((s) => s.id === id);
    setSt({ ...INITIAL, scriptId: id });
    if (next?.day && next.day !== day) onDay(next.day);
  };
  const recount = (): void => setSt((s) => ({ ...s, taps: 0, arrivedAt: null }));
  const restart = (): void => setSt((s) => ({ ...INITIAL, scriptId: s.scriptId }));
  return { st, script, go, setJudge, onClickTap, pick, recount, restart };
}

function ScriptBar({
  prefix,
  scripts,
  trial,
  extra,
}: {
  readonly prefix: "pc" | "sp";
  readonly scripts: readonly ScriptDef[];
  readonly trial: ReturnType<typeof useTrial>;
  readonly extra?: ReactNode;
}) {
  const id = useId().replace(/:/g, "");
  const { st, script } = trial;
  const reached = st.arrivedAt !== null;
  return (
    <div data-testid={`${prefix}-script`} className="flex flex-col gap-3 rounded-ctl bg-sunken p-4">
      <FormField id={`${id}-script`} label="作業の台本">
        <Select id={`${id}-script`} value={st.scriptId} onChange={(e) => trial.pick(e.target.value)} data-testid={`${prefix}-script-select`}>
          <option value="">（選ばない）</option>
          {scripts.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </Select>
      </FormField>
      {extra}
      <div aria-live="polite" className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <p className="text-table text-fg">
          押した回数
          <span data-testid={`${prefix}-taps`} className="ml-2 text-h2 font-semibold tabular-nums">
            {st.taps}
          </span>
          回
        </p>
        {script ? (
          reached ? (
            <StatusPill meaning="ok" data-testid={`${prefix}-goal`} data-reached="1">
              着きました（{st.arrivedAt} 回）
            </StatusPill>
          ) : (
            <StatusPill meaning="neutral" icon="clock" data-testid={`${prefix}-goal`} data-reached="0">
              まだ着いていません
            </StatusPill>
          )
        ) : (
          <span data-testid={`${prefix}-goal`} data-reached="0" className="text-table text-fg-mute">
            台本を選ぶと、目標の画面に着くまでを数えます。
          </span>
        )}
      </div>
      {script ? <p className="text-aux text-fg-mute">目標：{script.goal}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={trial.recount} data-testid={`${prefix}-recount`}>
          数え直す
        </Button>
        <Button size="sm" onClick={trial.restart} data-testid={`${prefix}-restart`}>
          ホームに戻して数え直す
        </Button>
      </div>
    </div>
  );
}

function UserMenu({ device }: { readonly device: "pc" | "phone" }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="relative" onKeyDown={(e) => (e.key === "Escape" ? setOpen(false) : undefined)}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        aria-label={device === "phone" ? "利用者のメニュー" : undefined}
        onClick={() => setOpen((o) => !o)}
        data-testid="user-menu-button"
        className="inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-ctl border border-line-strong bg-surface px-2.5 text-table text-fg hov:bg-sunken"
      >
        <Icon name="pilot" size={18} />
        {device === "pc" ? "見本 一郎" : null}
        <Icon name="chevron-down" size={14} className="text-fg-mute" />
      </button>
      {open ? (
        <div id={id} role="group" aria-label="利用者" data-testid="user-menu" className="absolute right-0 top-full z-20 mt-1 flex w-64 flex-col gap-2 rounded-ctl border border-line-strong bg-surface p-3 text-table">
          <p className="font-medium text-fg">見本 一郎</p>
          <p className="text-aux text-fg-mute">運航管理者</p>
          <Button disabled icon="sign-out" className="w-full">
            ログアウト（見本では動きません）
          </Button>
        </div>
      ) : null}
    </div>
  );
}

const SAMPLE_PILL = (
  <StatusPill meaning="neutral" icon="info">
    見本データ
  </StatusPill>
);

// ── PC frame ─────────────────────────────────────────────────────────────────

const PC_VARS = { "--fs-h1": "24px", "--fs-h2": "18px", "--fs-h3": "15px", "--fs-body": "14px", "--fs-table": "13px" } as CSSProperties;
const SP_VARS = { "--fs-h1": "22px", "--fs-h2": "17px", "--fs-h3": "15px", "--fs-body": "15px", "--fs-table": "14px" } as CSSProperties;

const pcTabKey = (page: PageId): NavKey => {
  const k = NAV_OF_PAGE[page];
  return k === "aircraft" || k === "pilots" || k === "permits" || k === "places" ? "register" : k;
};

function RailItem({ k, label, current, onGo, sub }: { readonly k: NavKey; readonly label: string; readonly current: boolean; readonly onGo: () => void; readonly sub?: boolean }) {
  return (
    <button
      type="button"
      onClick={onGo}
      aria-current={current ? "page" : undefined}
      data-testid={`nav-${k}`}
      className={cx(
        "flex min-h-11 w-full items-center gap-3 rounded-ctl px-3 text-left text-table transition-colors duration-[var(--dur)]",
        sub && "pl-9",
        current ? "bg-accent-soft font-semibold text-accent" : "text-fg-soft hov:bg-sunken hov:text-fg",
      )}
    >
      <Icon name={NAV_ICON[k]} size={18} />
      {label}
    </button>
  );
}

export function PcTrial({
  menu,
  judgeLabel,
  judgeForm,
  day,
  onDay,
}: {
  readonly menu: "rail" | "tabs";
  readonly judgeLabel: string;
  readonly judgeForm: JudgeForm;
  readonly day: DayKind;
  readonly onDay: (d: DayKind) => void;
}) {
  const trial = useTrial(PC_SCRIPTS, day, onDay);
  const { st } = trial;
  const ctx: PageCtx = {
    device: "pc",
    day,
    judgeForm,
    judgeLabel,
    plansOnHome: false,
    band: false,
    geoMode: "ok",
    go: trial.go,
    judge: st.judge,
    setJudge: trial.setJudge,
  };
  const current = NAV_OF_PAGE[st.page];
  const main = (
    <main data-testid="pc-main" className="min-h-0 flex-1 overflow-y-auto p-6">
      <TrialPage page={st.page} ctx={ctx} />
    </main>
  );
  const go = (p: PageId) => () => trial.go(p);
  return (
    <div className="flex flex-col gap-3">
      <ScriptBar prefix="pc" scripts={PC_SCRIPTS} trial={trial} />
      <div role="region" aria-label="PC 用の見本（広い画面向け。狭い画面では横にスクロールします）" tabIndex={0} className="overflow-x-auto rounded-ctl border border-line-strong">
        <div
          data-testid="pc-frame"
          data-menu={menu}
          data-page={st.page}
          data-taps={st.taps}
          style={PC_VARS}
          onClick={trial.onClickTap}
          className="h-[44rem] min-w-[68rem] bg-app text-fg"
        >
          {menu === "rail" ? (
            <div className="grid h-full grid-cols-[13.5rem_minmax(0,1fr)]">
              <nav aria-label="運航管理のメニュー（左）" data-testid="pc-nav" className="flex min-h-0 flex-col gap-0.5 overflow-y-auto border-r border-line bg-surface p-3">
                <p className="px-3 pb-3 pt-1 text-h2 font-semibold text-fg">そらばん</p>
                <RailItem k="home" label="ホーム" current={current === "home"} onGo={go("home")} />
                <p className="px-3 pb-1 pt-4 text-aux text-fg-mute">調べる</p>
                <RailItem k="judge" label={judgeLabel} current={current === "judge"} onGo={go("judge")} />
                <p className="px-3 pb-1 pt-4 text-aux text-fg-mute">飛ばす</p>
                <RailItem k="plans" label="計画" current={current === "plans"} onGo={go("plans")} />
                <RailItem k="journal" label="日誌" current={current === "journal"} onGo={go("journal")} />
                <div className="pt-4">
                  <RailItem k="register" label="登録" current={current === "register"} onGo={go("register")} />
                </div>
                {(["aircraft", "pilots", "permits", "places"] as const).map((k) => (
                  <RailItem key={k} k={k} sub label={REGISTER_KIND_LABEL[k]} current={current === k} onGo={go(k)} />
                ))}
              </nav>
              <div className="flex min-h-0 min-w-0 flex-col">
                <div className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-line bg-surface px-6">
                  {SAMPLE_PILL}
                  <UserMenu device="pc" />
                </div>
                {main}
              </div>
            </div>
          ) : (
            <div className="flex h-full flex-col">
              <header className="flex h-14 shrink-0 items-stretch gap-6 border-b border-line bg-surface px-6">
                <p className="flex items-center text-h2 font-semibold text-fg">そらばん</p>
                <nav aria-label="運航管理のメニュー（上）" data-testid="pc-nav" className="flex items-stretch gap-1">
                  {(
                    [
                      ["home", "ホーム"],
                      ["judge", judgeLabel],
                      ["plans", "計画"],
                      ["journal", "日誌"],
                      ["register", "登録"],
                    ] as const
                  ).map(([k, label]) => {
                    const active = pcTabKey(st.page) === k;
                    return (
                      <button
                        key={k}
                        type="button"
                        onClick={go(k)}
                        aria-current={active ? "page" : undefined}
                        data-testid={`nav-${k}`}
                        className={cx(
                          "inline-flex min-w-20 items-center justify-center gap-2 border-b-2 px-3 text-table transition-colors duration-[var(--dur)]",
                          active ? "border-accent font-semibold text-accent" : "border-transparent text-fg-soft hov:text-fg",
                        )}
                      >
                        <Icon name={NAV_ICON[k]} size={18} />
                        {label}
                      </button>
                    );
                  })}
                </nav>
                <div className="ml-auto flex items-center gap-3">
                  {SAMPLE_PILL}
                  <UserMenu device="pc" />
                </div>
              </header>
              {main}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── phone frame ──────────────────────────────────────────────────────────────

export function PhoneTrial({ menu, day, onDay }: { readonly menu: "tabs5" | "tabs4band"; readonly day: DayKind; readonly onDay: (d: DayKind) => void }) {
  const trial = useTrial(PHONE_SCRIPTS, day, onDay);
  const [geoMode, setGeoMode] = useState<"ok" | "denied">("ok");
  const { st } = trial;
  const withPlansTab = menu === "tabs5";
  const ctx: PageCtx = {
    device: "phone",
    day,
    judgeForm: "workspace",
    judgeLabel: "判定",
    plansOnHome: !withPlansTab,
    band: !withPlansTab && day === "busy",
    geoMode,
    go: trial.go,
    judge: st.judge,
    setJudge: trial.setJudge,
  };
  const tabs: readonly { readonly key: NavKey; readonly label: string }[] = withPlansTab
    ? [
        { key: "home", label: "ホーム" },
        { key: "judge", label: "判定" },
        { key: "plans", label: "計画" },
        { key: "journal", label: "日誌" },
        { key: "register", label: "登録" },
      ]
    : [
        { key: "home", label: "ホーム" },
        { key: "judge", label: "判定" },
        { key: "journal", label: "日誌" },
        { key: "register", label: "登録" },
      ];
  const field = st.page === "field";
  const parent: PageId | undefined = field ? "home" : (PARENT_PAGE[st.page] ?? (st.page === "plans" && !withPlansTab ? "home" : undefined));
  const currentKey = pcTabKey(st.page);
  // the home page already shows the flight in full, so the band only appears on the other pages
  const showBand = ctx.band && !field && st.page !== "home";
  return (
    <div className="flex flex-col gap-3">
      <ScriptBar
        prefix="sp"
        scripts={PHONE_SCRIPTS}
        trial={trial}
        extra={
          <div className="flex flex-col gap-1.5">
            <span className="text-table font-medium text-fg">現在地の見本</span>
            <Segmented
              label="現在地の見本"
              value={geoMode}
              onChange={(v) => setGeoMode(v as "ok" | "denied")}
              options={[
                { id: "ok", label: "取得できる" },
                { id: "denied", label: "取得できない" },
              ]}
              data-testid="ctl-geo"
            />
          </div>
        }
      />
      <div
        data-testid="sp-frame"
        data-menu={menu}
        data-page={st.page}
        data-taps={st.taps}
        style={SP_VARS}
        onClick={trial.onClickTap}
        className="mx-auto flex h-[min(46rem,calc(100dvh-4rem))] w-full max-w-[24.5rem] flex-col overflow-hidden rounded-ctl border-2 border-line-strong bg-app text-fg"
      >
        <header className="flex h-14 shrink-0 items-center gap-1 border-b border-line bg-surface px-2">
          {parent ? (
            <button
              type="button"
              onClick={() => trial.go(parent)}
              aria-label={`${PAGE_TITLE[parent]}へ戻る`}
              data-testid="back"
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-ctl text-accent hov:bg-accent-soft"
            >
              <Icon name="chevron-left" size={22} />
            </button>
          ) : null}
          <h3 className={cx("min-w-0 flex-1 truncate text-h2 font-semibold text-fg", parent ? "pl-1" : "pl-2")}>{PAGE_TITLE[st.page]}</h3>
          {field ? null : <UserMenu device="phone" />}
        </header>
        {showBand ? (
          <button
            type="button"
            onClick={() => trial.go("field")}
            data-testid="next-flight-band"
            className="flex min-h-14 w-full shrink-0 items-center gap-3 border-b border-line-strong bg-accent-soft px-4 text-left"
          >
            <span className="text-h2 font-semibold tabular-nums text-fg">10:30</span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-table font-medium text-fg">見本公園の撮影</span>
              <span className="text-aux text-fg-soft">点検 次 ・ 通報 済</span>
            </span>
            <span className="inline-flex items-center gap-0.5 whitespace-nowrap text-table font-semibold text-accent">
              現場モード
              <Icon name="chevron-right" size={16} />
            </span>
          </button>
        ) : null}
        <main data-testid="sp-main" className={cx("min-h-0 flex-1 overflow-y-auto", field ? "bg-app" : "p-4")}>
          <TrialPage page={st.page} ctx={ctx} />
        </main>
        {field ? null : (
          <nav aria-label="運航管理のメニュー（下）" data-testid="sp-nav" className="grid shrink-0 border-t border-line-strong bg-surface" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
            {tabs.map((t) => {
              const active = currentKey === t.key;
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => trial.go(t.key)}
                  aria-current={active ? "page" : undefined}
                  data-testid={`nav-${t.key}`}
                  className={cx("flex min-h-14 flex-col items-center justify-center gap-0.5 border-t-2 px-1 text-table touch-manipulation", active ? "border-accent font-semibold text-accent" : "border-transparent text-fg-soft")}
                >
                  <Icon name={NAV_ICON[t.key]} size={20} />
                  {t.label}
                </button>
              );
            })}
          </nav>
        )}
      </div>
    </div>
  );
}
