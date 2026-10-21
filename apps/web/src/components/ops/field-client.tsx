"use client";

// 現場モード（Sprint 12c 設計 H）。片手・屋外・手袋の可能性を前提に、飛行前の確認 → 離陸・着陸の記録 → 日誌への引き継ぎを 1 画面で行う。
//   - 押した記録（確認・離陸・着陸・取り消す）は、先に端末の送信待ちに 1 行ずつ保存し（lib/ops-outbox.ts）、順番に自分のサーバーへ送る。
//     押した結果は送信の前に画面へ反映する（fieldState に送信待ちの行を足して導出する）。
//   - 確認ダイアログは出さない。押し間違いは「取り消す」で戻す。離陸の二度押し（1.5 秒以内）は無視する。
//   - 飛行中だけ画面の消灯を防ぐ（Screen Wake Lock。非対応なら控えめな注記だけ）。
//   - 押す部品は高さ 56px 以上、離陸・着陸は 80px 以上。文字は 18px 以上。状態は文字と記号で示し、色だけで区別しない。
//   - 見た目は最低限。磨き込みは designer。
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  EMERGENCY_DESIGNATED_WARNING,
  FIELD_AFTER_ENTRY_LABEL,
  FIELD_CHECK_ACTION_LABEL,
  FIELD_CHECK_ITEMS,
  FIELD_CHECK_ITEM_LABEL,
  FIELD_CHECK_RESULT_LABEL,
  FIELD_DOUBLE_TAP_GUARD_MS,
  FIELD_OFFLINE_SCOPE_NOTE,
  FIELD_REPORT_OPEN_LABEL,
  FIELD_STATE_ABNORMAL,
  FIELD_STATE_DONE,
  FIELD_STATE_IN_FLIGHT,
  FIELD_STATE_JOURNAL_DONE,
  FIELD_STATE_JOURNAL_PENDING,
  FIELD_STATE_MARK,
  FIELD_STATE_TODO,
  FIELD_UNDO_LABEL,
  INSPECTION_ABNORMAL_GUIDANCE,
  LANDING_OUTSIDE_PLAN_WINDOW,
  OUTBOX_RETRY_INTERVAL_MS,
  fieldGapLabel,
  fieldHref,
  formatElapsed,
  inspectionNewHref,
  journalNewHref,
  landingRecordedMessage,
  takeoffRecordedMessage,
  type FieldCheckItem,
  type FieldCheckResult,
  type FieldGapLike,
} from "@/lib/ops-field";
import {
  discardRejected,
  emptyOutbox,
  enqueue,
  rejectedEntries,
  unsentCount,
  type OutboxEntry,
  type OutboxState,
} from "@/lib/ops-outbox";
import { jstTime, nowJstInput } from "@/lib/ops-time";
import { WakeLockController, wakeLockNote, type WakeLockStatus } from "@/lib/wake-lock";
import { fieldState, outboxAsEvents, type FieldFlight } from "@/server/ops/field-logic";
import type { FieldViewDto } from "@/server/ops/field";
import { newRequestId } from "./drafts";
import { flushOutbox, loadPlanOutbox, updatePlanOutbox } from "./field-outbox";

const BTN =
  "inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-sharp px-5 py-2 text-lg font-bold touch-manipulation focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-700 focus-visible:ring-offset-2 focus-visible:ring-offset-paper disabled:opacity-60";
const BTN_PRIMARY = `${BTN} border-2 border-brand-700 bg-brand-700 text-paper`;
const BTN_OUTLINE = `${BTN} border-2 border-brand-700 bg-paper text-brand-700`;
const BTN_WARN = `${BTN} border-2 border-signal-red bg-paper text-ink`;
const BTN_FLIGHT =
  "inline-flex min-h-24 w-full items-center justify-center rounded-sharp border-2 border-brand-700 bg-brand-700 px-5 text-4xl font-bold tracking-[0.2em] text-paper touch-manipulation focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-700 focus-visible:ring-offset-2 focus-visible:ring-offset-paper disabled:opacity-60";
// 札（枠）。意味は枠の太さ・左の太線・記号と文字が担い、色は補助。済は実線、未は破線。
const BOX = "flex flex-col gap-3 rounded-sharp border-2 border-rule bg-paper p-3";
const BOX_TODO = "flex flex-col gap-3 rounded-sharp border-2 border-dashed border-ink-mute bg-paper p-3";
const BOX_DONE = "flex flex-col gap-3 rounded-sharp border-2 border-l-8 border-signal-green bg-paper p-3";
const BOX_BAD = "flex flex-col gap-3 rounded-sharp border-2 border-l-8 border-signal-red bg-paper p-3";
const BOX_WARN = "flex flex-col gap-2 rounded-sharp border-2 border-l-8 border-signal-red bg-signal-red-soft p-3 text-ink";
const BOX_NOTE = "flex flex-col gap-2 rounded-sharp border-2 border-l-8 border-signal-amber bg-signal-amber-soft p-3 text-ink";
const BOX_OK = "flex flex-col gap-2 rounded-sharp border-2 border-l-8 border-signal-green bg-signal-green-soft p-3 text-ink";
// 緊急用務空域が「指定されている」：画面で最も目立たせる（太い枠・大きな見出し・記号と文字）
const BOX_ALARM = "flex flex-col gap-2 rounded-sharp border-[6px] border-signal-red bg-signal-red-soft p-4 text-ink";

type Banner = {
  readonly id: string;
  readonly kind: "takeoff" | "landing" | "check" | "undo";
  readonly hm: string;
  readonly gaps: readonly FieldGapLike[] | null;
  readonly notice: string | null;
  /** 取り消す対象（行の ID か端末の識別子）。取り消せないときは null。 */
  readonly undoRef: string | null;
  readonly text: string;
};

const KIND_LABEL: Readonly<Record<OutboxEntry["kind"], string>> = {
  check: "確認",
  takeoff: "離陸",
  landing: "着陸",
  undo: "取り消し",
};

export function FieldClient({ initial, memberId }: { readonly initial: FieldViewDto; readonly memberId: string }) {
  const planId = initial.plan.id;
  const [view, setView] = useState<FieldViewDto>(initial);
  const [outbox, setOutbox] = useState<OutboxState>(emptyOutbox());
  const [banner, setBanner] = useState<Banner | null>(null);
  const [nowMs, setNowMs] = useState(0);
  // 水和（操作できる状態）が済んだ印。E2E が、押す前に待つ
  const [hydrated, setHydrated] = useState(false);
  const [wl, setWl] = useState<WakeLockStatus>("idle");
  const [emSource, setEmSource] = useState("");
  const [emResult, setEmResult] = useState<"" | "not_designated" | "designated">("");
  const lastPress = useRef(Number.NEGATIVE_INFINITY);
  const wake = useRef<WakeLockController | null>(null);

  const reloadOutbox = useCallback(() => setOutbox(loadPlanOutbox(planId, memberId)), [planId, memberId]);

  const reloadView = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch(`/api/ops/plans/${planId}/field`, { credentials: "same-origin" });
      if (!res.ok) return false;
      setView((await res.json()) as FieldViewDto);
      return true;
    } catch {
      // 通信できないときは、いまの表示のまま
      return false;
    }
  }, [planId]);

  const flush = useCallback(async () => {
    const r = await flushOutbox(planId, memberId, (info) => {
      // 送れたとき、押した直後の帯を、サーバーが導出した未了事項・時間帯の知らせで置き換える
      const gaps = Array.isArray(info.data["gaps"]) ? (info.data["gaps"] as FieldGapLike[]) : null;
      const wn = info.data["windowNotice"] as { label?: string } | null | undefined;
      setBanner((b) =>
        b && b.id === info.entry.clientEventId ? { ...b, gaps: gaps ?? b.gaps, notice: wn?.label ?? b.notice } : b,
      );
    });
    // 送れた行は、サーバーの状態を読み直してから端末の送信待ちの表示を更新する
    // （先に送信待ちの表示から消すと、読み直しまでの間、離陸した直後の画面が「離陸前」に一瞬戻る）
    if (r.sent > 0) await reloadView();
    reloadOutbox();
    return r;
  }, [planId, memberId, reloadOutbox, reloadView]);

  // 画面を開いたとき・接続が戻ったとき・開いている間 15 秒ごとに、送信待ちを送る
  useEffect(() => {
    const t = window.setTimeout(() => {
      reloadOutbox();
      setHydrated(true);
      void flush();
    }, 0);
    const iv = window.setInterval(() => {
      if (unsentCount(loadPlanOutbox(planId, memberId)) > 0) void flush();
    }, OUTBOX_RETRY_INTERVAL_MS);
    const onOnline = () => void flush();
    window.addEventListener("online", onOnline);
    return () => {
      window.clearTimeout(t);
      window.clearInterval(iv);
      window.removeEventListener("online", onOnline);
    };
  }, [flush, reloadOutbox, planId, memberId]);

  // ---- 状態（行から毎回導出する。送信待ちの行も足す） -------------------------------------
  const state = useMemo(() => {
    const serverClientIds = new Set(view.stateInput.events.map((e) => e.clientEventId));
    const pending = outboxAsEvents(outbox.entries.filter((e) => !serverClientIds.has(e.clientEventId)));
    return fieldState({
      events: [...view.stateInput.events, ...pending],
      inspections: view.stateInput.inspections,
      flightRecords: view.stateInput.flightRecords,
      day: view.stateInput.day,
    });
  }, [view, outbox]);

  const serverIds = useMemo(() => new Set(view.stateInput.events.map((e) => e.id)), [view]);
  // 端末の識別子で指していた行が、サーバーに届いて行の ID を持ったら、行の ID に置き換える
  const resolveRef = (ref: string): string => view.stateInput.events.find((e) => e.clientEventId === ref)?.id ?? ref;
  const targetFor = (ref: string): { targetEventId?: string; targetClientEventId?: string } => {
    const r = resolveRef(ref);
    return serverIds.has(r) ? { targetEventId: r } : { targetClientEventId: r };
  };

  const open = state.openFlight;
  const inFlight = open !== null;
  const unsent = unsentCount(outbox);
  const rejected = rejectedEntries(outbox);

  // 飛行中の経過時間
  useEffect(() => {
    if (!inFlight) return;
    const tick = () => setNowMs(Date.now());
    const t = window.setTimeout(tick, 0);
    const iv = window.setInterval(tick, 1000);
    return () => {
      window.clearTimeout(t);
      window.clearInterval(iv);
    };
  }, [inFlight]);

  // 画面の消灯の防止（飛行中だけ）
  useEffect(() => {
    const c = new WakeLockController(
      {
        wakeLock: (navigator as Navigator & { wakeLock?: { request(type: "screen"): Promise<{ release(): Promise<void> }> } }).wakeLock,
        isSecureContext: window.isSecureContext,
        visibility: () => (document.visibilityState === "visible" ? "visible" : "hidden"),
        onVisibilityChange: (l) => {
          document.addEventListener("visibilitychange", l);
          return () => document.removeEventListener("visibilitychange", l);
        },
      },
      setWl,
    );
    wake.current = c;
    return () => {
      wake.current = null;
      void c.destroy();
    };
  }, []);
  useEffect(() => {
    const c = wake.current;
    // 取得できない端末（非対応・HTTPS でない）は状態が変わらず通知されないため、結果の状態を読み直して注記に使う
    void c?.setInFlight(inFlight).then(() => setWl(c.status));
  }, [inFlight]);

  // ---- 記録する ---------------------------------------------------------------------
  const record = (p: Omit<Parameters<typeof enqueue>[1], "clientEventId" | "occurredAt">): { id: string; hm: string } => {
    const clientEventId = newRequestId();
    const occurredAt = nowJstInput(new Date());
    updatePlanOutbox(planId, memberId, (s) => enqueue(s, { ...p, clientEventId, occurredAt }));
    reloadOutbox();
    void flush();
    return { id: clientEventId, hm: occurredAt.slice(11, 16) };
  };

  const guard = (): boolean => {
    const t = performance.now();
    if (t - lastPress.current < FIELD_DOUBLE_TAP_GUARD_MS) return false;
    lastPress.current = t;
    return true;
  };

  const onTakeoff = () => {
    if (!guard()) return;
    const { id, hm } = record({ kind: "takeoff" });
    setBanner({ id, kind: "takeoff", hm, gaps: view.takeoffPreview, notice: null, undoRef: id, text: "" });
  };

  const onLanding = () => {
    if (!guard() || !open) return;
    const { id, hm } = record({ kind: "landing", ...targetFor(open.takeoffEventId) });
    setBanner({ id, kind: "landing", hm, gaps: null, notice: null, undoRef: id, text: "" });
  };

  const onCheck = (item: Exclude<FieldCheckItem, "inspection">, extra: { result?: FieldCheckResult; source?: string } = {}) => {
    const { id, hm } = record({ kind: "check", item, ...extra });
    setBanner({ id, kind: "check", hm, gaps: null, notice: null, undoRef: id, text: `${FIELD_CHECK_ITEM_LABEL[item]}を記録しました（${hm}）。` });
  };

  const onUndo = (ref: string, label: string) => {
    const { id, hm } = record({ kind: "undo", ...targetFor(ref) });
    setBanner({ id, kind: "undo", hm, gaps: null, notice: null, undoRef: null, text: `${label}を取り消しました（${hm}）。` });
  };

  // 取り消す対象が、まだ有効（取り消されていない）か
  const activeRefs = new Set<string>();
  for (const f of state.flights) {
    activeRefs.add(f.takeoffEventId);
    if (f.landingEventId) activeRefs.add(f.landingEventId);
  }
  for (const item of FIELD_CHECK_ITEMS) {
    const e = state.checks[item].eventId;
    if (e) activeRefs.add(e);
  }

  const bannerText = (b: Banner): string => {
    if (b.kind === "takeoff") return takeoffRecordedMessage(b.hm, b.gaps ?? []);
    if (b.kind === "landing") return `${landingRecordedMessage(b.hm)}${b.notice ? ` ${LANDING_OUTSIDE_PLAN_WINDOW}${b.notice}` : ""}`;
    return b.text;
  };

  // ---- 表示用 -------------------------------------------------------------------------
  const plan = view.plan;
  const allChecked = FIELD_CHECK_ITEMS.every((i) => state.checks[i].done);
  const stage: 1 | 2 | 3 = inFlight ? 2 : state.pendingJournal.length > 0 ? 3 : allChecked ? 2 : 1;
  const hm = (iso: string): string => jstTime(new Date(iso));
  const elapsed = open && nowMs > 0 ? formatElapsed(nowMs - new Date(open.takeoffAt).getTime()) : formatElapsed(0);
  const wlNote = wakeLockNote(wl, inFlight);
  const cancelled = plan.voided;
  const sourceChosen = emSource !== "" && emResult !== "";

  const stepMark = (n: 1 | 2 | 3): string => (stage === n ? FIELD_STATE_MARK.in_flight : stage > n ? FIELD_STATE_MARK.done : "○");
  const steps: readonly [1 | 2 | 3, string, string][] = [
    [1, "① 飛行前", "#preflight"],
    [2, "② 離着陸", "#flight"],
    [3, "③ 日誌", "#journal"],
  ];

  const journalHref = (f: FieldFlight): string => journalNewHref(planId, f.takeoffEventId);
  const goJournal = async (e: React.MouseEvent<HTMLAnchorElement>, href: string) => {
    if (unsentCount(loadPlanOutbox(planId, memberId)) === 0) return;
    // 現場の記録がまだ端末にあるときは、先に送ってから日誌を開く（送れなければそのまま開き、日誌の保存のときにもう一度送る）
    e.preventDefault();
    await Promise.race([flush(), new Promise((r) => window.setTimeout(r, 4000))]);
    window.location.assign(href);
  };

  const stateWord = (done: boolean, abnormal: boolean): string => (!done ? FIELD_STATE_TODO : abnormal ? FIELD_STATE_ABNORMAL : FIELD_STATE_DONE);
  const stateMark = (done: boolean, abnormal: boolean): string => (!done ? FIELD_STATE_MARK.todo : abnormal ? FIELD_STATE_MARK.abnormal : FIELD_STATE_MARK.done);

  // 押した結果。離陸・着陸のときは離着陸のボタンのすぐ下（押した指の近く・着陸のボタンを押し下げない位置）、確認・取り消しのときは上
  const bannerEl = banner ? (
    <div className={BOX_OK} role="status" aria-live="polite" data-testid="field-banner">
      <p className="text-xl font-bold" data-testid="field-banner-text">
        ✓ {bannerText(banner)}
      </p>
      {banner.undoRef && activeRefs.has(resolveRef(banner.undoRef)) ? (
        <button
          type="button"
          className={BTN_OUTLINE}
          data-testid="field-banner-undo"
          onClick={() =>
            onUndo(banner.undoRef!, banner.kind === "takeoff" ? "離陸" : banner.kind === "landing" ? "着陸" : "確認")
          }
        >
          {FIELD_UNDO_LABEL}
        </button>
      ) : null}
    </div>
  ) : null;
  const bannerBelow = banner !== null && (banner.kind === "takeoff" || banner.kind === "landing");

  const preflightEl = (
    <section id="preflight" aria-labelledby="field-h-preflight" className="flex scroll-mt-4 flex-col gap-3" data-testid="field-preflight">
      <h2 id="field-h-preflight" className="text-2xl font-bold">
        ① 飛行前の確認
      </h2>
      <ul className="flex flex-col gap-3">
        {FIELD_CHECK_ITEMS.map((item) => {
          const c = state.checks[item];
          const word = stateWord(c.done, c.abnormal);
          const mark = stateMark(c.done, c.abnormal);
          const time = c.at ? hm(c.at) : null;
          return (
            <li key={item} className={!c.done ? BOX_TODO : c.abnormal ? BOX_BAD : BOX_DONE} data-testid={`field-item-${item}`} data-done={c.done ? "true" : "false"}>
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <h3 className="text-xl font-bold">{FIELD_CHECK_ITEM_LABEL[item]}</h3>
                <p className="text-xl font-bold" data-testid={`field-item-state-${item}`}>
                  <span aria-hidden>{mark} </span>
                  {word}
                  {time ? <span className="font-mono">（{time}）</span> : null}
                </p>
              </div>

              {item === "inspection" ? (
                <>
                  {c.done && c.abnormal ? (
                    <p className={BOX_WARN} role="alert" data-testid="field-inspection-abnormal">
                      <span className="text-xl font-bold">！ 異常あり</span>
                      {INSPECTION_ABNORMAL_GUIDANCE}
                    </p>
                  ) : null}
                  {c.done ? (
                    <a href={`/ops/inspections/${c.inspectionId}`} className={BTN_OUTLINE} data-testid="field-inspection-view">
                      点検の記録を見る
                    </a>
                  ) : view.canInspect ? (
                    <a href={inspectionNewHref(planId)} className={BTN_PRIMARY} data-testid="field-inspection-link">
                      {FIELD_CHECK_ACTION_LABEL.inspection}
                    </a>
                  ) : (
                    <p>今日の飛行前の点検がありません。点検できる人に依頼してください。</p>
                  )}
                </>
              ) : null}

              {item === "emergency_airspace" ? (
                <>
                  {c.done ? (
                    <p data-testid="field-emergency-result">
                      {c.result ? FIELD_CHECK_RESULT_LABEL[c.result] : ""}
                      {c.source ? `（${view.emergencySources.find((s) => s.id === c.source)?.title ?? c.source}）` : ""}
                    </p>
                  ) : null}
                  {!c.done && view.canRecord && !cancelled ? (
                    <div className="flex flex-col gap-3">
                      <label className="flex flex-col gap-1 font-bold" htmlFor="field-em-source">
                        確認した情報源
                      </label>
                      <select
                        id="field-em-source"
                        className="min-h-14 w-full rounded-sharp border-2 border-ink-soft bg-paper px-3 text-lg text-ink"
                        value={emSource}
                        onChange={(e) => setEmSource(e.target.value)}
                        data-testid="field-em-source"
                      >
                        <option value="">選んでください</option>
                        {view.emergencySources.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.title}
                          </option>
                        ))}
                      </select>
                      <div role="radiogroup" aria-label="緊急用務空域の確認結果" className="flex flex-col gap-3">
                        {(["not_designated", "designated"] as const).map((r) => (
                          <button
                            key={r}
                            type="button"
                            role="radio"
                            aria-checked={emResult === r}
                            className={emResult === r ? BTN_PRIMARY : BTN_OUTLINE}
                            data-testid={`field-em-result-${r}`}
                            onClick={() => setEmResult(r)}
                          >
                            <span aria-hidden>{emResult === r ? "◉" : "○"}</span>
                            {FIELD_CHECK_RESULT_LABEL[r]}
                          </button>
                        ))}
                      </div>
                      <button
                        type="button"
                        className={BTN_PRIMARY}
                        disabled={!sourceChosen}
                        data-testid="field-em-submit"
                        onClick={() => {
                          if (!sourceChosen) return;
                          onCheck("emergency_airspace", { result: emResult as FieldCheckResult, source: emSource });
                          setEmSource("");
                          setEmResult("");
                        }}
                      >
                        {FIELD_CHECK_ACTION_LABEL.emergency_airspace}
                      </button>
                      {!sourceChosen ? <p data-testid="field-em-hint">情報源と結果を選ぶと記録できます。</p> : null}
                    </div>
                  ) : null}
                </>
              ) : null}

              {item === "report_recheck" ? (
                <>
                  <p data-testid="field-report-status">
                    <span aria-hidden>{view.report.statusMark} </span>
                    {view.report.requirementLabel}／{view.report.statusLabel}
                  </p>
                  {view.report.detail ? (
                    <p data-testid="field-report-detail">
                      {view.report.detail}
                      {view.report.channelLabel ? `（${view.report.channelLabel}）` : ""}
                    </p>
                  ) : null}
                  {view.report.notRequiredNote ? <p data-testid="field-report-not-required">{view.report.notRequiredNote}</p> : null}
                  {view.report.warning ? (
                    <p className={BOX_WARN} role="alert" data-testid="field-report-warning">
                      <span className="text-xl font-bold">！ 通報の確認</span>
                      {view.report.warning}
                    </p>
                  ) : null}
                  {view.report.warning ? (
                    <a href={view.report.reportHref} className={BTN_OUTLINE} data-testid="field-report-open">
                      {FIELD_REPORT_OPEN_LABEL}
                    </a>
                  ) : null}
                  {!c.done && view.canRecord && !cancelled && view.report.canRecheck ? (
                    <button type="button" className={BTN_PRIMARY} data-testid="field-recheck-submit" onClick={() => onCheck("report_recheck")}>
                      {FIELD_CHECK_ACTION_LABEL.report_recheck}
                    </button>
                  ) : null}
                </>
              ) : null}

              {item === "carry" ? (
                <>
                  <p data-testid="field-permits">
                    {plan.permitNumbers ? `許可・承認の番号：${plan.permitNumbers}` : "許可・承認の番号の登録はありません。"}
                  </p>
                  {!c.done && view.canRecord && !cancelled ? (
                    <button type="button" className={BTN_PRIMARY} data-testid="field-carry-submit" onClick={() => onCheck("carry")}>
                      {FIELD_CHECK_ACTION_LABEL.carry}
                    </button>
                  ) : null}
                </>
              ) : null}

              {c.eventId && view.canRecord ? (
                <button
                  type="button"
                  className={BTN_OUTLINE}
                  data-testid={`field-item-undo-${item}`}
                  onClick={() => onUndo(c.eventId!, FIELD_CHECK_ITEM_LABEL[item])}
                >
                  {FIELD_UNDO_LABEL}
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );

  const flightEl = (
    <section id="flight" aria-labelledby="field-h-flight" className="flex scroll-mt-4 flex-col gap-3" data-testid="field-flight">
      <h2 id="field-h-flight" className="text-2xl font-bold">
        ② 離着陸
      </h2>
      {inFlight ? (
        <div className="flex flex-col gap-1 rounded-sharp border-2 border-l-8 border-brand-700 bg-brand-50 p-3 text-ink" data-testid="field-in-flight">
          <p className="text-2xl font-bold">
            <span aria-hidden>{FIELD_STATE_MARK.in_flight} </span>
            {FIELD_STATE_IN_FLIGHT}
            <span className="font-mono">（離陸 {hm(open!.takeoffAt)}）</span>
          </p>
          <p className="font-mono text-6xl font-bold leading-tight tabular-nums" data-testid="field-elapsed" aria-label="経過時間">
            {elapsed}
          </p>
        </div>
      ) : null}
      {inFlight ? (
        <button
          type="button"
          className={BTN_FLIGHT}
          data-testid="field-flight-button"
          data-action="landing"
          disabled={!view.canRecord}
          onClick={onLanding}
        >
          着陸
        </button>
      ) : view.canRecord ? (
        <>
          <button
            type="button"
            className={BTN_FLIGHT}
            data-testid="field-flight-button"
            data-action="takeoff"
            disabled={cancelled}
            onClick={onTakeoff}
          >
            離陸
          </button>
          {cancelled ? (
            <p className={BOX_WARN} data-testid="field-takeoff-blocked">
              計画は中止されています。新しい離陸は記録できません。
            </p>
          ) : view.takeoffPreview.length > 0 ? (
            <p className={BOX_NOTE} data-testid="field-takeoff-preview">
              いま離陸すると、次の項目が未了です：{view.takeoffPreview.map(fieldGapLabel).join("、")}
            </p>
          ) : null}
        </>
      ) : null}

      {bannerBelow ? bannerEl : null}

      {state.flights.length > 0 ? (
        <ol className="flex flex-col gap-3" data-testid="field-flights">
          {state.flights.map((f, i) => {
            const dto = view.flights.find((x) => x.takeoffEventId === f.takeoffEventId);
            const phaseLabel =
              f.phase === "in_flight" ? FIELD_STATE_IN_FLIGHT : f.phase === "journal_pending" ? FIELD_STATE_JOURNAL_PENDING : FIELD_STATE_JOURNAL_DONE;
            const phaseMark = f.phase === "in_flight" ? FIELD_STATE_MARK.in_flight : f.phase === "journal_pending" ? "！" : FIELD_STATE_MARK.done;
            return (
              <li key={f.takeoffEventId} className={BOX} data-testid="field-flight-row" data-phase={f.phase}>
                <p className="text-xl font-bold">
                  {i + 1} 回目：<span aria-hidden>{phaseMark} </span>
                  {phaseLabel}
                </p>
                <p className="font-mono">
                  離陸 {hm(f.takeoffAt)}
                  {f.landingAt ? ` → 着陸 ${hm(f.landingAt)}` : ""}
                </p>
                {dto?.windowNotice ? (
                  <p className={BOX_NOTE} data-testid="field-window-notice">
                    {LANDING_OUTSIDE_PLAN_WINDOW}
                    {dto.windowNotice.label}
                  </p>
                ) : null}
                {f.gaps.length > 0 ? (
                  <p data-testid="field-flight-gaps">
                    離陸時の未了：{f.gaps.map(fieldGapLabel).join("、")}
                  </p>
                ) : null}
                {f.phase === "journaled" && f.flightRecordId ? (
                  <a href={`/ops/flights/${f.flightRecordId}`} className={BTN_OUTLINE} data-testid="field-flight-record-link">
                    日誌の記録を見る
                  </a>
                ) : null}
                {view.canRecord && f.phase === "in_flight" ? (
                  <button type="button" className={BTN_OUTLINE} data-testid="field-undo-takeoff" onClick={() => onUndo(f.takeoffEventId, "離陸")}>
                    離陸を{FIELD_UNDO_LABEL}
                  </button>
                ) : null}
                {view.canRecord && f.phase === "journal_pending" && f.landingEventId ? (
                  <button type="button" className={BTN_OUTLINE} data-testid="field-undo-landing" onClick={() => onUndo(f.landingEventId!, "着陸")}>
                    着陸を{FIELD_UNDO_LABEL}
                  </button>
                ) : null}
              </li>
            );
          })}
        </ol>
      ) : null}
    </section>
  );

  const journalEl = (
    <section id="journal" aria-labelledby="field-h-journal" className="flex scroll-mt-4 flex-col gap-3" data-testid="field-journal">
      <h2 id="field-h-journal" className="text-2xl font-bold">
        ③ 日誌
      </h2>
      {state.pendingJournal.length > 0 && view.canJournal ? (
        state.pendingJournal.map((f) => (
          <a
            key={f.takeoffEventId}
            href={journalHref(f)}
            className={BTN_PRIMARY}
            data-testid="field-journal-link"
            onClick={(e) => void goJournal(e, journalHref(f))}
          >
            日誌を記入する（離陸 {hm(f.takeoffAt)}）
          </a>
        ))
      ) : (
        <p data-testid="field-journal-none">{state.pendingJournal.length > 0 ? "日誌は、記録できる人が記入します。" : "着陸した飛行の日誌は、ここから記入します。"}</p>
      )}
      {view.canJournal ? (
        <a href={journalNewHref(planId)} className={BTN_OUTLINE} data-testid="field-after-entry">
          {FIELD_AFTER_ENTRY_LABEL}
        </a>
      ) : null}
    </section>
  );

  // 並び：いま必要な操作を上に（段階 1＝飛行前が先、飛行中・離陸待ち＝離着陸が先、着陸後＝日誌が先）。画面の並びと読み上げ・Tab の順を一致させる
  const sectionOrder: readonly ("preflight" | "flight" | "journal")[] =
    stage === 1 ? ["preflight", "flight", "journal"] : stage === 3 ? ["journal", "flight", "preflight"] : ["flight", "journal", "preflight"];
  const emergencyDesignated = state.checks.emergency_airspace.designated;

  return (
    <main
      className="flex flex-col gap-5 bg-paper pb-[env(safe-area-inset-bottom)] text-lg leading-relaxed text-ink touch-manipulation"
      data-testid="field-root"
      data-hydrated={hydrated ? "true" : "false"}
      aria-label="現場モード"
    >
      {/* 緊急用務空域が「指定されている」：最上位の警告。画面の最上部に、ほかのどの表示よりも大きく出す */}
      {emergencyDesignated ? (
        <p className={BOX_ALARM} role="alert" data-testid="field-emergency-warning">
          <span className="text-3xl font-bold leading-tight">！ 緊急用務空域：指定されている</span>
          <span className="text-xl font-bold">最上位の警告</span>
          <span>{EMERGENCY_DESIGNATED_WARNING}</span>
        </p>
      ) : null}

      {/* 上部：計画の要点（運航票の見出し）と「今日へ戻る」 */}
      <header className="flex flex-col gap-3 border-b-2 border-ink-mute pb-4">
        <div className="flex flex-col gap-1 border-l-8 border-brand-700 pl-3">
          <h1 className="text-2xl font-bold leading-snug" data-testid="field-plan-title">
            {plan.title}
          </h1>
          <p className="font-mono tabular-nums" data-testid="field-plan-time">
            {plan.timeLabel}
          </p>
          <p data-testid="field-plan-who">
            <span className="font-mono">{plan.registrationMark}</span>（{plan.modelName}）／<span className="whitespace-nowrap">{plan.pilotName}</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <a href="/ops" className={`${BTN_OUTLINE} !w-auto shrink-0`} data-testid="field-back">
            <span aria-hidden>←</span> 今日へ戻る
          </a>
          {view.sameDayPlans.length > 1 ? (
            <nav aria-label="同じ日の計画" className="flex min-w-0 flex-[1_1_100%] flex-wrap gap-3" data-testid="field-same-day">
              {view.sameDayPlans.map((p) => (
                <a
                  key={p.id}
                  href={fieldHref(p.id)}
                  aria-current={p.isCurrent ? "page" : undefined}
                  className={`${p.isCurrent ? BTN_PRIMARY : BTN_OUTLINE} min-w-0 flex-1 basis-36 !gap-0 !px-3 !py-1 flex-col`}
                  data-testid="field-same-day-link"
                >
                  <span className="font-mono">
                    {p.isCurrent ? "▶ " : ""}
                    {p.timeLabel}
                  </span>
                  <span className="w-full truncate text-center">{p.title}</span>
                </a>
              ))}
            </nav>
          ) : null}
        </div>
      </header>

      {/* 段階：いまの位置は ▶ と塗りと下線、済みは ✓、これからは ○ */}
      <nav aria-label="段階" className="grid grid-cols-3 gap-3" data-testid="field-steps">
        {steps.map(([n, label, href]) => (
          <a
            key={n}
            href={href}
            aria-current={stage === n ? "step" : undefined}
            className={`${stage === n ? BTN_PRIMARY : BTN_OUTLINE} flex-col !gap-0 !px-1 text-center`}
            data-testid={`field-step-${n}`}
            data-current={stage === n ? "true" : "false"}
          >
            <span aria-hidden>{stepMark(n)}</span>
            <span className={`whitespace-nowrap ${stage === n ? "underline underline-offset-4" : ""}`}>{label}</span>
          </a>
        ))}
      </nav>

      {/* 送信の状況・注記 */}
      <section aria-label="送信の状況" className="flex flex-col gap-3">
        <p className={unsent > 0 ? BOX_NOTE : "flex items-center gap-2 px-1 text-ink-soft"} role="status" data-testid="field-unsent" data-count={unsent}>
          <span className={unsent > 0 ? "text-2xl font-bold" : "font-bold"}>{unsent > 0 ? `！ 未送信 ${unsent} 件` : "✓ 送信済み"}</span>
          {unsent > 0 ? <span>電波が戻ると自動で送ります。</span> : null}
        </p>
        {cancelled ? (
          <p className={BOX_WARN} role="alert" data-testid="field-cancelled">
            <span className="text-xl font-bold">！ この計画は中止されています</span>
            新しい確認・離陸は記録できません。開いている離陸の着陸と、取り消しは記録できます。
          </p>
        ) : null}
        {!view.canRecord ? (
          <p className={BOX_NOTE} data-testid="field-readonly">
            この計画の現場の記録は、運航管理者または計画の操縦者本人が行います。
          </p>
        ) : null}
        {wlNote ? (
          <p className={BOX_NOTE} data-testid="field-wake-note">
            {wlNote}
          </p>
        ) : null}
      </section>

      {!bannerBelow ? bannerEl : null}

      {/* 送れなかった行（黙って捨てない） */}
      {rejected.length > 0 ? (
        <section aria-label="送れなかった記録" className="flex flex-col gap-3" data-testid="field-rejected">
          <h2 className="text-2xl font-bold">！ 送れなかった記録</h2>
          {rejected.map((e) => (
            <div key={e.clientEventId} className={BOX_WARN} role="alert" data-testid="field-rejected-row" data-code={e.rejection?.code}>
              <p className="font-bold">
                {KIND_LABEL[e.kind]} {e.occurredAt.slice(11, 16)}
              </p>
              <p data-testid="field-rejected-reason">送れませんでした。{e.rejection?.message}</p>
              <a href={journalNewHref(planId)} className={BTN_OUTLINE} data-testid="field-rejected-after-entry">
                {FIELD_AFTER_ENTRY_LABEL}
              </a>
              <button
                type="button"
                className={BTN_WARN}
                data-testid="field-rejected-discard"
                onClick={() => {
                  updatePlanOutbox(planId, memberId, (s) => discardRejected(s, e.clientEventId));
                  reloadOutbox();
                }}
              >
                この記録を破棄する
              </button>
            </div>
          ))}
        </section>
      ) : null}

      {sectionOrder.map((k) => (
        <Fragment key={k}>{k === "preflight" ? preflightEl : k === "flight" ? flightEl : journalEl}</Fragment>
      ))}

      <p className={BOX} data-testid="field-offline-note">
        {FIELD_OFFLINE_SCOPE_NOTE}
      </p>
    </main>
  );
}
