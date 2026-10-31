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
  FIELD_DOC_BASIS_LABEL,
  FIELD_DOC_CONFIRM_ACTION,
  FIELD_DOC_FIX_LABEL,
  FIELD_DOC_HUMAN_CONFIRMED_LABEL,
  FIELD_DOC_STATUS_LABEL,
  FIELD_DOC_STATUS_MARK,
  FIELD_NEXT_FLIGHT_LABEL,
  FIELD_POST_DEFECT_GUIDE,
  FIELD_POST_INSPECTION_ACTION,
  FIELD_POST_INSPECTION_LABEL,
  FIELD_POST_INSPECTION_LATER,
  FIELD_POST_INSPECTION_PENDING_NOTE,
  FIELD_RESTRICTION_ACTION,
  FIELD_RESTRICTION_LABEL,
  FIELD_ROUND_LABEL,
  FIELD_TAKEOFF_WITH_GAPS_NOTE,
  SITE_FIELDS,
  SITE_FIELD_LABEL,
  SITE_NOTE_MAX,
  SITE_NOTE_REQUIRED_MESSAGE,
  SITE_OPTIONS,
  SITE_TEMP_RANGE,
  SITE_THRESHOLD_NOTE,
  SITE_WIND_RANGE,
  fieldErrorMessage,
  postInspectionNewHref,
  siteHasAttention,
  type FieldDocKey,
  type FieldSiteValues,
  type FieldRecordableCheckItem,
  FIELD_CHECK_ACTION_LABEL,
  FIELD_CHECK_ITEMS,
  FIELD_CHECK_ITEM_LABEL,
  FIELD_CHECK_RESULT_LABEL,
  FIELD_DOUBLE_TAP_GUARD_MS,
  FIELD_OFFLINE_SCOPE_NOTE,
  FIELD_REPORT_OPEN_LABEL,
  FIELD_REPORT_RECORD_BEFORE_TAKEOFF,
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
  OUTBOX_UNSAVED_NOTE,
  fieldGapLabel,
  fieldHref,
  formatElapsed,
  inspectionNewHref,
  journalNewHref,
  landingRecordedMessage,
  takeoffRecordedMessage,
  type FieldCheckResult,
  type FieldGapLike,
} from "@/lib/ops-field";
import {
  OUTBOX_EXPIRY_WARNING,
  discardRejected,
  emptyOutbox,
  enqueue,
  expiringSoon,
  rejectedEntries,
  unsentCount,
  type OutboxEntry,
  type OutboxState,
} from "@/lib/ops-outbox";
import { jstDate, jstTime, nowJstInput } from "@/lib/ops-time";
import { DEVICE_STORAGE_NOTES } from "@/lib/pwa";
import { WakeLockController, wakeLockNote, type WakeLockStatus } from "@/lib/wake-lock";
import { fieldState, outboxAsEvents, outboxAsInspections, type FieldFlight } from "@/server/ops/field-logic";
import { composeFieldView, fieldBundleIsStale, type FieldBundlePlan, type FieldViewDto } from "@/server/ops/field-compose";
import { newRequestId } from "./drafts";
import {
  fieldEventsUrl,
  flushOutbox,
  loadPlanOutbox,
  markOutboxSaved,
  outboxAuthRequired,
  outboxMeta,
  planOutboxUnsaved,
  updatePlanOutbox,
} from "./field-outbox";
import { fetchBundles, loadBundle, setCurrentMember } from "./field-store";
import { reportServerBuild } from "./pwa-register";
import { WARNING_TEXT } from "./records-client";
import { FIELD_BACK } from "./ops-nav-model";

const BTN =
  "inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-sharp px-5 py-2 text-lg font-bold touch-manipulation focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-700 focus-visible:ring-offset-2 focus-visible:ring-offset-paper disabled:opacity-60";
const BTN_PRIMARY = `${BTN} border-2 border-brand-700 bg-brand-700 text-paper`;
const BTN_OUTLINE = `${BTN} border-2 border-brand-700 bg-paper text-brand-700`;
const BTN_WARN = `${BTN} border-2 border-signal-red bg-paper text-ink`;
const BTN_FLIGHT =
  "inline-flex min-h-24 w-full items-center justify-center rounded-sharp border-2 border-brand-700 bg-brand-700 px-5 text-4xl font-bold tracking-[0.2em] text-paper touch-manipulation focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-700 focus-visible:ring-offset-2 focus-visible:ring-offset-paper disabled:opacity-60";
// Sprint 12e：事故・ヒヤリハットの簡易記録への帯。離着陸の「1 つの大きなボタン」と競わないよう、塗りのない淡い紙の地・左寄せ・
// 太字にしない帯にする（高さ 56px・全幅・文字 18px は保つ）。行き先は右端の矢印で示す。
const BAND_INCIDENT =
  "flex min-h-14 w-full items-center gap-3 rounded-sharp border-2 border-rule bg-paper-soft px-3 py-2 text-left text-lg font-medium text-ink touch-manipulation focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-700 focus-visible:ring-offset-2 focus-visible:ring-offset-paper";
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

/** 電波が戻ってから送り始めるまでの待ち（ミリ秒）。 */
const ONLINE_RESEND_DELAY_MS = 1000;

const KIND_LABEL: Readonly<Record<OutboxEntry["kind"], string>> = {
  check: "確認",
  takeoff: "離陸",
  landing: "着陸",
  undo: "取り消し",
  inspection: "日常点検",
  journal: "日誌",
};

export function FieldClient({
  initial,
  memberId,
  incidentHref = null,
  bundle: initialBundle = null,
}: {
  readonly initial: FieldViewDto;
  readonly memberId: string;
  /** Sprint 12e：現場の簡易記録（事故・ヒヤリハット）への経路。記録できない利用者には渡さない（帯を出さない）。 */
  readonly incidentHref?: string | null;
  /**
   * Sprint 15：圏外で開いたとき（Service Worker が返した枠）の先読みの束。渡されたら、画面は束と端末の送信待ちから組み立てる
   * （サーバーから読み直せたら、サーバーの内容に切り替える）。
   */
  readonly bundle?: FieldBundlePlan | null;
}) {
  const planId = initial.plan.id;
  const [serverView, setView] = useState<FieldViewDto>(initial);
  // Sprint 15：画面の出どころ（サーバー／端末の先読みの束）と、端末の先読みの束
  const [source, setSource] = useState<"server" | "bundle">(initialBundle ? "bundle" : "server");
  const [bundle, setBundle] = useState<FieldBundlePlan | null>(initialBundle);
  const [online, setOnline] = useState(true);
  const [sentWarnings, setSentWarnings] = useState<readonly string[]>([]);
  const [authRequired, setAuthRequired] = useState(false);
  // 状態の帯の時刻の判定（先読みの古さ・72 時間の期限）に使う現在。開いたときと 30 秒ごとに更新する
  const [clockMs, setClockMs] = useState(0);
  const [outbox, setOutbox] = useState<OutboxState>(emptyOutbox());
  const [banner, setBanner] = useState<Banner | null>(null);
  const [nowMs, setNowMs] = useState(0);
  // 水和（操作できる状態）が済んだ印。E2E が、押す前に待つ
  const [hydrated, setHydrated] = useState(false);
  const [wl, setWl] = useState<WakeLockStatus>("idle");
  const [emSource, setEmSource] = useState("");
  const [emResult, setEmResult] = useState<"" | "not_designated" | "designated">("");
  // Sprint 14：現場状況の入力（選択・数値・備考）と、飛行後点検を「あとで」にした飛行
  const [siteSel, setSiteSel] = useState<Record<string, string>>({});
  const [siteWind, setSiteWind] = useState("");
  const [siteTemp, setSiteTemp] = useState("");
  const [siteNote, setSiteNote] = useState("");
  const [siteMsg, setSiteMsg] = useState<string | null>(null);
  const [siteBusy, setSiteBusy] = useState(false);
  const [postLater, setPostLater] = useState<ReadonlySet<string>>(new Set());
  const lastPress = useRef(Number.NEGATIVE_INFINITY);
  const wake = useRef<WakeLockController | null>(null);

  const reloadOutbox = useCallback(() => setOutbox(loadPlanOutbox(planId, memberId)), [planId, memberId]);

  const reloadView = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch(`/api/ops/plans/${planId}/field`, { credentials: "same-origin", cache: "no-store" });
      if (!res.ok) return false;
      setView((await res.json()) as FieldViewDto);
      setSource("server");
      return true;
    } catch {
      // 通信できないときは、いまの表示のまま
      return false;
    }
  }, [planId]);

  // Sprint 15：先読みの束を取り直して端末に保存する（オンラインのとき。登録が変わっていれば、圏外の判定も最新になる）
  const refreshBundle = useCallback(async () => {
    const r = await fetchBundles(memberId, planId);
    if (r) reportServerBuild(r.build);
    const b = await loadBundle(memberId, planId);
    if (b) setBundle(b);
  }, [memberId, planId]);

  const flush = useCallback(async () => {
    const warned: string[] = [];
    const r = await flushOutbox(planId, memberId, (info) => {
      // Sprint 15：送信待ちの日誌のサーバーの警告（点検なし・計画との相違など）は、送れた後に出す（契約 D-3）
      if (info.entry.kind === "journal" && Array.isArray(info.data["warnings"])) {
        for (const w of info.data["warnings"] as unknown[]) {
          const text = typeof w === "string" ? (WARNING_TEXT as Record<string, string>)[w] : undefined;
          if (text) warned.push(`日誌（離陸 ${info.entry.journal?.takeoffAt.slice(11, 16) ?? ""}）：${text}`);
        }
      }
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
    if (warned.length > 0) setSentWarnings((cur) => [...cur, ...warned]);
    setAuthRequired(outboxAuthRequired());
    reloadOutbox();
    return r;
  }, [planId, memberId, reloadOutbox, reloadView]);

  // 画面を開いたとき・接続が戻ったとき・開いている間 15 秒ごとに、送信待ちを送る
  useEffect(() => {
    const t = window.setTimeout(() => {
      reloadOutbox();
      setOnline(navigator.onLine);
      setHydrated(true);
      // Sprint 15：この端末でログインしている利用者を覚え（圏外で開くときに使う）、先読みの束を取り直す
      setCurrentMember(memberId);
      void (async () => {
        await flush();
        if (navigator.onLine) {
          // 圏外の枠で開いた画面も、通信できればサーバーの内容に切り替える
          if (source === "bundle") await reloadView();
          await refreshBundle();
        } else if (!bundle) {
          const b = await loadBundle(memberId, planId);
          if (b) setBundle(b);
        }
      })();
    }, 0);
    const iv = window.setInterval(() => {
      if (unsentCount(loadPlanOutbox(planId, memberId)) > 0) void flush();
    }, OUTBOX_RETRY_INTERVAL_MS);
    // 戻ったら送り、サーバーの内容と先読みの束を最新にする（契約 B-4・E-1）。電波が戻った直後は接続が揺れやすいため、
    // 少し待ってから送る（その間に再び圏外になれば送らない。送らなくても、15 秒ごとの再試行と「いま送る」がある）
    let onlineTimer: number | undefined;
    const onOnline = () => {
      setOnline(true);
      window.clearTimeout(onlineTimer);
      onlineTimer = window.setTimeout(() => {
        if (!navigator.onLine) return;
        void flush().then(async () => {
          await reloadView();
          await refreshBundle();
        });
      }, ONLINE_RESEND_DELAY_MS);
    };
    const onOffline = () => {
      window.clearTimeout(onlineTimer);
      setOnline(false);
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.clearTimeout(t);
      window.clearInterval(iv);
      window.clearTimeout(onlineTimer);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
    // 画面を開いたときと、接続の変化のときだけ（source・bundle の変化では張り直さない）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flush, reloadOutbox, reloadView, refreshBundle, planId, memberId]);

  useEffect(() => {
    const tick = () => setClockMs(Date.now());
    const t = window.setTimeout(tick, 0);
    const iv = window.setInterval(tick, 30_000);
    return () => {
      window.clearTimeout(t);
      window.clearInterval(iv);
    };
  }, [outbox]);

  // Sprint 15：圏外の枠で開いたときは、先読みの束と端末の送信待ちから画面を組み立てる（送信待ちが変わるたびに作り直す。契約 B-5・D-1）
  const view = useMemo((): FieldViewDto => {
    if (source !== "bundle" || !bundle) return serverView;
    return composeFieldView(bundle, {
      now: new Date(),
      extraEvents: outboxAsEvents(outbox.entries),
      extraInspections: outboxAsInspections(outbox.entries),
    });
  }, [source, bundle, serverView, outbox]);

  // ---- 状態（行から毎回導出する。送信待ちの行も足す） -------------------------------------
  const state = useMemo(() => {
    const serverClientIds = new Set(view.stateInput.events.map((e) => e.clientEventId));
    const pending = outboxAsEvents(outbox.entries.filter((e) => !serverClientIds.has(e.clientEventId)));
    // Sprint 15：送信待ちの点検（圏外で保存した点検）も、送れる前から画面に反映する
    const inspIds = new Set(view.stateInput.inspections.map((x) => x.id));
    return fieldState({
      events: [...view.stateInput.events, ...pending],
      inspections: [...view.stateInput.inspections, ...outboxAsInspections(outbox.entries).filter((x) => !inspIds.has(x.id))],
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
    markOutboxSaved(memberId);
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

  const CHECK_LABEL: Readonly<Record<FieldRecordableCheckItem, string>> = {
    emergency_airspace: FIELD_CHECK_ITEM_LABEL.emergency_airspace,
    report_recheck: FIELD_CHECK_ITEM_LABEL.report_recheck,
    carry: FIELD_CHECK_ITEM_LABEL.carry,
    docs_confirm: "書類・手続きの確認",
    flight_restriction: FIELD_RESTRICTION_LABEL,
    site_conditions: "現場状況",
  };
  const onCheck = (
    item: FieldRecordableCheckItem,
    extra: { result?: FieldCheckResult; source?: string; docKey?: FieldDocKey; site?: FieldSiteValues } = {},
  ) => {
    const { id, hm } = record({ kind: "check", item, ...extra });
    setBanner({ id, kind: "check", hm, gaps: null, notice: null, undoRef: id, text: `${CHECK_LABEL[item]}を記録しました（${hm}）。` });
  };

  // 現場状況：注意あり（いる／あり／制限あり）は備考が必須。備考は端末に残さないため、送信待ちを経由せず、いま送る
  const siteValues = (): FieldSiteValues | null => {
    const sel = siteSel;
    if (!sel["third_party"] || !sel["other_aircraft"] || !sel["rain"] || !sel["visibility"]) return null;
    const numOf = (raw: string, range: { min: number; max: number }): number | null | undefined => {
      if (raw.trim() === "") return null;
      const n = Number(raw);
      return Number.isFinite(n) && n >= range.min && n <= range.max ? Math.round(n * 10) / 10 : undefined;
    };
    const windMs = numOf(siteWind, SITE_WIND_RANGE);
    const tempC = numOf(siteTemp, SITE_TEMP_RANGE);
    if (windMs === undefined || tempC === undefined) return null;
    return {
      thirdParty: sel["third_party"] as FieldSiteValues["thirdParty"],
      otherAircraft: sel["other_aircraft"] as FieldSiteValues["otherAircraft"],
      rain: sel["rain"] as FieldSiteValues["rain"],
      visibility: sel["visibility"] as FieldSiteValues["visibility"],
      windMs,
      tempC,
    };
  };
  const onSiteSubmit = async () => {
    const v = siteValues();
    if (!v || siteBusy) return;
    setSiteMsg(null);
    if (!siteHasAttention(v)) {
      onCheck("site_conditions", { site: v });
      setSiteSel({});
      setSiteWind("");
      setSiteTemp("");
      setSiteNote("");
      return;
    }
    if (siteNote.trim() === "") {
      setSiteMsg(SITE_NOTE_REQUIRED_MESSAGE);
      return;
    }
    setSiteBusy(true);
    // 送信待ち（着陸など）が残っていると、この記録が前のラウンドに数えられる。先に送り切る（送り切れなければ押せない）
    if (unsentCount(loadPlanOutbox(planId, memberId)) > 0) {
      await flush();
      if (unsentCount(loadPlanOutbox(planId, memberId)) > 0) {
        setSiteMsg("送信待ちの記録が残っています。通信できるときに、送られてからもう一度押してください。");
        setSiteBusy(false);
        return;
      }
    }
    const clientEventId = newRequestId();
    const occurredAt = nowJstInput(new Date());
    try {
      const res = await fetch(fieldEventsUrl(planId), {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ kind: "check", item: "site_conditions", clientEventId, occurredAt, queued: false, site: v, note: siteNote.trim() }),
      });
      if (res.ok) {
        await reloadView();
        setBanner({ id: clientEventId, kind: "check", hm: occurredAt.slice(11, 16), gaps: null, notice: null, undoRef: clientEventId, text: `現場状況を記録しました（${occurredAt.slice(11, 16)}）。` });
        setSiteSel({});
        setSiteWind("");
        setSiteTemp("");
        setSiteNote("");
      } else {
        let code = "";
        try {
          code = String(((await res.json()) as { error?: unknown }).error ?? "");
        } catch {
          // 本文なし
        }
        setSiteMsg(fieldErrorMessage(code));
      }
    } catch {
      setSiteMsg("通信できません。備考つきの現場状況は端末に残せないため、通信できるときにもう一度押してください。");
    } finally {
      setSiteBusy(false);
    }
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
  if (state.round.restriction.eventId) activeRefs.add(state.round.restriction.eventId);
  if (state.round.site.eventId) activeRefs.add(state.round.site.eventId);
  for (const c of Object.values(state.docConfirms)) if (c) activeRefs.add(c.eventId);

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

  // ---- Sprint 14：書類・手続き（登録内容から自動判定。足りないものだけ人が確認する） ----------------------
  const docRows = view.docs.map((d) => {
    // 人の確認は、自動判定が要確認で、通報以外の項目だけ有効（サーバーと同じ規則）
    const human = d.status === "needs_check" && d.key !== "report" ? state.docConfirms[d.key] : undefined;
    const effective: "confirmed_auto" | "confirmed_human" | "needs_check" | "unmet" =
      d.status === "unmet" ? "unmet" : d.status === "confirmed" ? "confirmed_auto" : human ? "confirmed_human" : "needs_check";
    return { d, human, effective, canConfirm: d.status === "needs_check" && !human && d.key !== "report" && view.canRecord && !cancelled };
  });
  const docsEl = (
    <section aria-labelledby="field-h-docs" className="flex flex-col gap-3" data-testid="field-docs">
      <h3 id="field-h-docs" className="text-xl font-bold">
        書類・手続き
      </h3>
      <p className="text-ink" data-testid="field-docs-note">
        登録内容から自動で判定しています。足りないもの（要確認）だけ、確認してください。登録は利用者の入力です。
      </p>
      <ul className="flex flex-col gap-3">
        {docRows.map(({ d, human, effective, canConfirm }) => {
          const word = effective === "confirmed_human" ? FIELD_DOC_HUMAN_CONFIRMED_LABEL : FIELD_DOC_STATUS_LABEL[d.status];
          const mark = effective === "confirmed_human" ? FIELD_DOC_STATUS_MARK.confirmed : FIELD_DOC_STATUS_MARK[d.status];
          const cls = effective === "unmet" ? BOX_BAD : effective === "needs_check" ? BOX_TODO : BOX_DONE;
          return (
            <li key={d.key} className={cls} data-testid={`field-docs-item-${d.key}`} data-status={d.status} data-effective={effective}>
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <h4 className="text-xl font-bold">{d.label}</h4>
                <p className="text-xl font-bold" data-testid={`field-docs-state-${d.key}`}>
                  <span aria-hidden>{mark} </span>
                  {word}
                </p>
              </div>
              {d.basis.length > 0 ? (
                <ul className="flex flex-col gap-1 border-l-4 border-ink-soft pl-3" data-testid={`field-docs-basis-${d.key}`} aria-label={`${d.label}の根拠`}>
                  {d.basis.map((b) => (
                    <li key={b} className="break-words">
                      {b}
                    </li>
                  ))}
                </ul>
              ) : null}
              {d.notes.length > 0 ? (
                <ul className="flex flex-col gap-1" data-testid={`field-docs-notes-${d.key}`}>
                  {d.notes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              ) : null}
              {d.href ? (
                <a href={d.href} className={BTN_OUTLINE} data-testid={d.status === "unmet" ? `field-docs-fix-${d.key}` : `field-docs-link-${d.key}`}>
                  {d.status === "unmet" ? FIELD_DOC_FIX_LABEL : d.status === "confirmed" ? FIELD_DOC_BASIS_LABEL : `${d.label}の登録を開く`}
                </a>
              ) : null}
              {canConfirm ? (
                <button type="button" className={BTN_PRIMARY} data-testid={`field-docs-confirm-${d.key}`} onClick={() => onCheck("docs_confirm", { docKey: d.key })}>
                  {FIELD_DOC_CONFIRM_ACTION}
                </button>
              ) : null}
              {human && view.canRecord ? (
                <button
                  type="button"
                  className={BTN_OUTLINE}
                  data-testid={`field-docs-undo-${d.key}`}
                  onClick={() => onUndo(human.eventId, d.label)}
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

  // ---- Sprint 14：飛行自粛要請の確認（ラウンドごと） -----------------------------------------------
  const rs = state.round.restriction;
  const restrictionEl = (
    <section
      aria-labelledby="field-h-restriction"
      className={rs.done ? BOX_DONE : BOX_TODO}
      data-testid="field-restriction"
      data-done={rs.done ? "true" : "false"}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h3 id="field-h-restriction" className="text-xl font-bold">
          {FIELD_RESTRICTION_LABEL}
        </h3>
        <p className="text-xl font-bold" data-testid="field-restriction-state">
          <span aria-hidden>{rs.done ? FIELD_STATE_MARK.done : FIELD_STATE_MARK.todo} </span>
          {rs.done ? FIELD_STATE_DONE : FIELD_STATE_TODO}
          {rs.at ? <span className="font-mono">（{hm(rs.at)}）</span> : null}
        </p>
      </div>
      <p data-testid="field-restriction-note">{view.round.restriction.note}</p>
      {view.round.restriction.url ? (
        <a href={view.round.restriction.url} target="_blank" rel="noopener noreferrer" className={BTN_OUTLINE} data-testid="field-restriction-link">
          {view.round.restriction.sourceTitle}を開く
        </a>
      ) : null}
      {!rs.done && view.canRecord && !cancelled ? (
        <button type="button" className={BTN_PRIMARY} data-testid="field-restriction-submit" onClick={() => onCheck("flight_restriction")}>
          {FIELD_RESTRICTION_ACTION}
        </button>
      ) : null}
      {rs.eventId && view.canRecord ? (
        <button type="button" className={BTN_OUTLINE} data-testid="field-restriction-undo" onClick={() => onUndo(rs.eventId!, FIELD_RESTRICTION_LABEL)}>
          {FIELD_UNDO_LABEL}
        </button>
      ) : null}
    </section>
  );

  // ---- Sprint 14：現場状況（毎回人が確認する事実。合否の閾値は決めない） -----------------------------
  const st = state.round.site;
  const draftSite = siteValues();
  const draftAttention = draftSite !== null && siteHasAttention(draftSite);
  const siteCanSubmit = draftSite !== null && (!draftAttention || siteNote.trim() !== "");
  const siteEl = (
    <section
      aria-labelledby="field-h-site"
      className={!st.done ? BOX_TODO : st.attention ? BOX_BAD : BOX_DONE}
      data-testid="field-site"
      data-done={st.done ? "true" : "false"}
      data-attention={st.attention ? "true" : "false"}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h3 id="field-h-site" className="text-xl font-bold">
          現場状況
        </h3>
        <p className="text-xl font-bold" data-testid="field-site-state">
          <span aria-hidden>{!st.done ? FIELD_STATE_MARK.todo : st.attention ? FIELD_STATE_MARK.abnormal : FIELD_STATE_MARK.done} </span>
          {!st.done ? FIELD_STATE_TODO : st.attention ? "注意あり" : FIELD_STATE_DONE}
          {st.at ? <span className="font-mono">（{hm(st.at)}）</span> : null}
        </p>
      </div>
      {st.done && st.values ? (
        <ul className="flex flex-col gap-1" data-testid="field-site-values">
          {SITE_FIELDS.map((f) => {
            const key = f === "third_party" ? "thirdParty" : f === "other_aircraft" ? "otherAircraft" : f;
            const val = (st.values as unknown as Record<string, string>)[key];
            return (
              <li key={f}>
                {SITE_FIELD_LABEL[f]}：{SITE_OPTIONS[f].find((o) => o.value === val)?.label ?? val}
              </li>
            );
          })}
          <li>風速：{st.values.windMs === null ? "未入力" : `${st.values.windMs} m/s`}</li>
          <li>気温：{st.values.tempC === null ? "未入力" : `${st.values.tempC} ℃`}</li>
          {view.round.site.note ? <li data-testid="field-site-recorded-note">備考：{view.round.site.note}</li> : null}
        </ul>
      ) : null}
      {!st.done && view.canRecord && !cancelled ? (
        <div className="flex flex-col gap-3" data-testid="field-site-form">
          {SITE_FIELDS.map((f) => (
            <div key={f} role="radiogroup" aria-label={SITE_FIELD_LABEL[f]} className="flex flex-col gap-3">
              <p className="font-bold">{SITE_FIELD_LABEL[f]}</p>
              <div className="grid grid-cols-2 gap-3">
                {SITE_OPTIONS[f].map((o) => {
                  const on = siteSel[f] === o.value;
                  return (
                    <button
                      key={o.value}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      className={on ? BTN_PRIMARY : BTN_OUTLINE}
                      data-testid={`field-site-${f}-${o.value}`}
                      onClick={() => setSiteSel((cur) => ({ ...cur, [f]: o.value }))}
                    >
                      <span aria-hidden>{on ? "◉" : "○"}</span>
                      {o.label}
                      {o.attention ? <span aria-hidden>！</span> : null}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 font-bold" htmlFor="field-site-wind">
              風速（m/s・任意）
              <input
                id="field-site-wind"
                type="number"
                inputMode="decimal"
                step="0.1"
                min={SITE_WIND_RANGE.min}
                max={SITE_WIND_RANGE.max}
                className="min-h-14 w-full rounded-sharp border-2 border-ink-soft bg-paper px-3 text-lg font-normal text-ink"
                value={siteWind}
                onChange={(e) => setSiteWind(e.target.value)}
                data-testid="field-site-wind"
              />
            </label>
            <label className="flex flex-col gap-1 font-bold" htmlFor="field-site-temp">
              気温（℃・任意）
              <input
                id="field-site-temp"
                type="number"
                inputMode="decimal"
                step="0.1"
                min={SITE_TEMP_RANGE.min}
                max={SITE_TEMP_RANGE.max}
                className="min-h-14 w-full rounded-sharp border-2 border-ink-soft bg-paper px-3 text-lg font-normal text-ink"
                value={siteTemp}
                onChange={(e) => setSiteTemp(e.target.value)}
                data-testid="field-site-temp"
              />
            </label>
          </div>
          <label className="flex flex-col gap-1 font-bold" htmlFor="field-site-note">
            備考{draftAttention ? "（必須）" : "（任意）"}
            <textarea
              id="field-site-note"
              rows={2}
              maxLength={SITE_NOTE_MAX}
              className="min-h-14 w-full rounded-sharp border-2 border-ink-soft bg-paper px-3 py-2 text-lg font-normal text-ink"
              value={siteNote}
              onChange={(e) => setSiteNote(e.target.value)}
              aria-required={draftAttention}
              data-testid="field-site-note"
            />
          </label>
          {draftAttention ? (
            <p className={BOX_NOTE} data-testid="field-site-note-required">
              {SITE_NOTE_REQUIRED_MESSAGE}備考は端末に残さないため、通信できるときに記録します。
            </p>
          ) : null}
          {siteMsg ? (
            <p className={BOX_WARN} role="alert" data-testid="field-site-error">
              {siteMsg}
            </p>
          ) : null}
          <button type="button" className={BTN_PRIMARY} disabled={!siteCanSubmit || siteBusy} data-testid="field-site-submit" onClick={() => void onSiteSubmit()}>
            現場状況を記録する
          </button>
          {!draftSite ? <p data-testid="field-site-hint">第三者・他機・雨・視程を選ぶと記録できます（風速・気温は未入力でも記録できます）。</p> : null}
        </div>
      ) : null}
      <p className="text-ink" data-testid="field-site-threshold-note">
        {SITE_THRESHOLD_NOTE}
      </p>
      {st.eventId && view.canRecord ? (
        <button type="button" className={BTN_OUTLINE} data-testid="field-site-undo" onClick={() => onUndo(st.eventId!, "現場状況")}>
          {FIELD_UNDO_LABEL}
        </button>
      ) : null}
    </section>
  );

  const preflightEl = (
    <section id="preflight" aria-labelledby="field-h-preflight" className="flex scroll-mt-4 flex-col gap-3" data-testid="field-preflight">
      <h2 id="field-h-preflight" className="text-2xl font-bold">
        ① 飛行前の確認
      </h2>
      <p className="font-bold" data-testid="field-round-label">
        {FIELD_ROUND_LABEL(state.round.index + 1)}
        {inFlight ? "（飛行中）" : ""}
      </p>
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
                  <p className="text-ink" data-testid="field-emergency-note">
                    {view.round.emergencyNote}
                  </p>
                  {view.emergencySources.map((src) => (
                    <a
                      key={src.id}
                      href={src.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={BTN_OUTLINE}
                      data-testid="field-emergency-link"
                    >
                      {src.title}を開く
                    </a>
                  ))}
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
                  {/* Sprint 15（U-2）：通報の記録が無い・まだの計画では、離陸の前にそらばんへ記録するよう案内する（判定と離陸の未了は変えない） */}
                  {(view.report.requirementKind === "required" || view.report.requirementKind === "confirm") && view.report.effectiveReportId === null ? (
                    <p className={BOX_NOTE} data-testid="field-report-record-before-takeoff">
                      {FIELD_REPORT_RECORD_BEFORE_TAKEOFF}
                    </p>
                  ) : null}
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
                  {plan.permitStates.length > 0 ? (
                    <ul className="flex flex-col gap-3 border-l-4 border-ink-soft pl-3 text-lg" data-testid="field-permit-states">
                      {plan.permitStates.map((n) => (
                        <li key={n.numberText} data-testid="field-permit-state" data-status={n.status}>
                          <span className="break-all font-mono">{n.numberText}</span>：{n.statusLabel}
                        </li>
                      ))}
                      <li className="text-base text-ink-soft">登録は利用者の入力です。許可書を携行し、書かれた条件を確認してください。</li>
                    </ul>
                  ) : null}
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
      {restrictionEl}
      {siteEl}
      {docsEl}
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
          {state.flights.map((f) => {
            const dto = view.flights.find((x) => x.takeoffEventId === f.takeoffEventId);
            const phaseLabel =
              f.phase === "in_flight" ? FIELD_STATE_IN_FLIGHT : f.phase === "journal_pending" ? FIELD_STATE_JOURNAL_PENDING : FIELD_STATE_JOURNAL_DONE;
            const phaseMark = f.phase === "in_flight" ? FIELD_STATE_MARK.in_flight : f.phase === "journal_pending" ? "！" : FIELD_STATE_MARK.done;
            return (
              <li key={f.takeoffEventId} className={BOX} data-testid="field-flight-row" data-phase={f.phase}>
                <p className="text-xl font-bold">
                  {f.roundIndex + 1} 回目：<span aria-hidden>{phaseMark} </span>
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
                    <span className="font-bold" data-testid="field-flight-gaps-notice">
                      {FIELD_TAKEOFF_WITH_GAPS_NOTE}。
                    </span>
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
                {view.canRecord && f.phase === "journal_pending" && f.landingEventId && !state.flights.some((x) => x.roundIndex > f.roundIndex) ? (
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

  // ---- Sprint 14：飛行後点検（着陸のあと。後回しにできる。未了として残る） -------------------------------
  const landedFlights = state.flights.filter((f) => f.landingEventId !== null);
  const postEl = (
    <section id="post" aria-labelledby="field-h-post" className="flex scroll-mt-4 flex-col gap-3" data-testid="field-post">
      <h2 id="field-h-post" className="text-2xl font-bold">
        {FIELD_POST_INSPECTION_LABEL}
      </h2>
      {landedFlights.length === 0 ? (
        <p data-testid="field-post-none">着陸を記録すると、ここから飛行後点検に進めます。</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {landedFlights.map((f) => {
            const later = postLater.has(f.takeoffEventId);
            return (
              <li
                key={f.takeoffEventId}
                className={f.post.done ? (f.post.abnormal ? BOX_BAD : BOX_DONE) : BOX_TODO}
                data-testid="field-post-row"
                data-done={f.post.done ? "true" : "false"}
              >
                <p className="text-xl font-bold" data-testid="field-post-state">
                  {FIELD_ROUND_LABEL(f.roundIndex + 1)}：<span aria-hidden>{f.post.done ? (f.post.abnormal ? FIELD_STATE_MARK.abnormal : FIELD_STATE_MARK.done) : FIELD_STATE_MARK.todo} </span>
                  {f.post.done ? (f.post.abnormal ? FIELD_STATE_ABNORMAL : FIELD_STATE_DONE) : FIELD_STATE_TODO}
                  {f.post.at ? <span className="font-mono">（{hm(f.post.at)}）</span> : null}
                </p>
                {f.post.done && f.post.inspectionId ? (
                  <a href={`/ops/inspections/${f.post.inspectionId}`} className={BTN_OUTLINE} data-testid="field-post-view">
                    点検の記録を見る
                  </a>
                ) : null}
                {f.post.done && f.post.abnormal ? (
                  <p className={BOX_WARN} role="alert" data-testid="field-post-defect">
                    <span className="text-xl font-bold">！ 異常あり</span>
                    {FIELD_POST_DEFECT_GUIDE}
                  </p>
                ) : null}
                {!f.post.done && view.canInspect && !later ? (
                  <>
                    <a href={postInspectionNewHref(planId)} className={BTN_PRIMARY} data-testid="field-post-link">
                      {FIELD_POST_INSPECTION_ACTION}
                    </a>
                    <button
                      type="button"
                      className={BTN_OUTLINE}
                      data-testid="field-post-later"
                      onClick={() => setPostLater((cur) => new Set([...cur, f.takeoffEventId]))}
                    >
                      {FIELD_POST_INSPECTION_LATER}
                    </button>
                  </>
                ) : null}
                {!f.post.done && later ? (
                  <>
                    <p className={BOX_NOTE} data-testid="field-post-pending">
                      {FIELD_POST_INSPECTION_PENDING_NOTE}
                    </p>
                    <a href={postInspectionNewHref(planId)} className={BTN_OUTLINE} data-testid="field-post-link-later">
                      {FIELD_POST_INSPECTION_ACTION}
                    </a>
                  </>
                ) : null}
                {!f.post.done && !view.canInspect ? <p data-testid="field-post-noaccess">飛行後点検は、点検できる人が記入します。</p> : null}
              </li>
            );
          })}
        </ul>
      )}
      {!inFlight && state.flights.length > 0 ? (
        <a href="#preflight" className={BTN_OUTLINE} data-testid="field-next-flight">
          {FIELD_NEXT_FLIGHT_LABEL}（{FIELD_ROUND_LABEL(state.round.index + 1)}）
        </a>
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
  const sectionOrder: readonly ("preflight" | "flight" | "post" | "journal")[] =
    stage === 1
      ? ["preflight", "flight", "post", "journal"]
      : stage === 3
        ? ["journal", "post", "flight", "preflight"]
        : ["flight", "post", "journal", "preflight"];
  const emergencyDesignated = state.checks.emergency_airspace.designated;

  // ---- Sprint 15：状態の帯（接続・送信待ち・最後に保存した時刻・先読みの最終更新。色だけでなく文字で示す） ----------------
  const meta = hydrated ? outboxMeta(memberId) : { savedAt: null, sentAt: null };
  const bundleStale = bundle !== null && clockMs > 0 && fieldBundleIsStale(bundle.fetchedAt, clockMs);
  const expiryHours = clockMs > 0 ? expiringSoon(outbox, clockMs) : null;
  const dayTime = (iso: string): string => `${jstDate(new Date(iso)).slice(5).replace("-", "/")} ${jstTime(new Date(iso))}`;
  const bandEl = (
    <section
      aria-label="接続と送信の状況"
      className="sticky top-0 z-20 -mx-1 flex flex-wrap items-center gap-x-4 gap-y-1 border-b-2 border-ink-mute bg-paper px-1 py-2 text-lg leading-snug"
      data-testid="field-status-band"
      data-online={online ? "true" : "false"}
    >
      <span className="font-bold" data-testid="field-status-connection">
        {online ? "● 接続あり" : "× 接続なし（圏外）"}
      </span>
      <span className="font-bold" data-testid="field-status-unsent" data-count={unsent}>
        送信待ち {unsent} 件
      </span>
      <span data-testid="field-status-saved">最後に保存 {meta.savedAt ? dayTime(meta.savedAt) : "—"}</span>
      <span data-testid="field-status-prefetch">
        先読みの最終更新 {bundle ? dayTime(bundle.fetchedAt) : "なし"}
        {bundleStale ? (
          <strong className="ml-1" data-testid="field-status-prefetch-stale">
            （古い可能性があります。登録が変わっていないか、電波のある場所で開き直してください）
          </strong>
        ) : null}
      </span>
    </section>
  );

  return (
    <main
      className="flex flex-col gap-5 bg-paper pb-[env(safe-area-inset-bottom)] text-lg leading-relaxed text-ink touch-manipulation"
      data-testid="field-root"
      data-hydrated={hydrated ? "true" : "false"}
      aria-label="現場モード"
    >
      {bandEl}
      {/* 緊急用務空域が「指定されている」：最上位の警告。画面の最上部に、ほかのどの表示よりも大きく出す */}
      {emergencyDesignated ? (
        <p className={BOX_ALARM} role="alert" data-testid="field-emergency-warning">
          <span className="text-3xl font-bold leading-tight">！ 緊急用務空域：指定されている</span>
          <span className="text-xl font-bold">最上位の警告</span>
          <span>{EMERGENCY_DESIGNATED_WARNING}</span>
        </p>
      ) : null}

      {/* 上部：計画の要点（運航票の見出し）と「ホームへ戻る」 */}
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
          <a href={FIELD_BACK.href} className={`${BTN_OUTLINE} !w-auto shrink-0`} data-testid="field-back">
            <span aria-hidden>←</span> {FIELD_BACK.label}
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
        {/* Sprint 12e：事故・ヒヤリハットの簡易記録への帯。常に見える小さめの帯（大きなボタンにしない）。離陸・着陸のボタンの隣・直上・直下に置かない
            （ヘッダーの中に置き、段階・送信の状況を挟んで 24px 以上離す）。押すと簡易記録の画面へ移るだけで、その場では記録しない */}
        {incidentHref ? (
          <a href={incidentHref} className={BAND_INCIDENT} data-testid="field-incident-link">
            <span aria-hidden className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-sharp border-2 border-ink-soft leading-none">
              ＋
            </span>
            <span className="min-w-0 flex-1">事故・ヒヤリハットを記録する</span>
            <span aria-hidden className="shrink-0 text-ink-soft">
              →
            </span>
          </a>
        ) : null}
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
        {/* 帯（画面の上に固定）には押す部品を置かない（スクロールした操作の上に重ならない）。「いま送る」は送信の状況に置く */}
        {unsent > 0 && online ? (
          <button type="button" className={BTN_OUTLINE} data-testid="field-send-now" onClick={() => void flush()}>
            いま送る
          </button>
        ) : null}
        {expiryHours !== null ? (
          <p className={BOX_WARN} role="alert" data-testid="field-expiry-warning">
            {OUTBOX_EXPIRY_WARNING(expiryHours)}
          </p>
        ) : null}
        {authRequired ? (
          <div className={BOX_WARN} role="alert" data-testid="field-auth-required">
            <p className="font-bold">ログインの有効期限が切れています。送信待ちの記録は端末に残っています。</p>
            <p>もう一度ログインすると、続きを送ります。</p>
            <a href="/ops/sign-in" className={BTN_OUTLINE} data-testid="field-auth-signin">
              ログインする
            </a>
          </div>
        ) : null}
        {sentWarnings.length > 0 ? (
          <div className={BOX_NOTE} role="status" data-testid="field-sent-warnings">
            <p className="font-bold">送信した記録の確認事項（保存はされています）</p>
            <ul className="flex flex-col gap-1">
              {sentWarnings.map((w, i) => (
                <li key={`${i}-${w}`} data-testid="field-sent-warning">
                  {w}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {planOutboxUnsaved(planId, memberId) ? (
          <p className={BOX_WARN} role="alert" data-testid="field-outbox-unsaved">
            {OUTBOX_UNSAVED_NOTE}
          </p>
        ) : null}
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
        <Fragment key={k}>{k === "preflight" ? preflightEl : k === "flight" ? flightEl : k === "post" ? postEl : journalEl}</Fragment>
      ))}

      <p className={BOX} data-testid="field-offline-note">
        {FIELD_OFFLINE_SCOPE_NOTE}
      </p>
      <details className={BOX} data-testid="field-device-storage">
        <summary className="min-h-14 cursor-pointer py-3 font-bold">端末に保存されている内容</summary>
        <ul className="flex list-disc flex-col gap-2 pl-5">
          {DEVICE_STORAGE_NOTES.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      </details>
    </main>
  );
}
