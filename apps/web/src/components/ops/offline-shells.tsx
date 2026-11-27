"use client";

// 圏外用の画面の枠（Sprint 15 設計 2・契約 C・D）。Service Worker が、通信できないときに行き先に応じてこの枠を返す。
// 枠の HTML には利用者のデータが無い（Service Worker が Cookie なしで取得してキャッシュする）。中身は、端末の先読みの束（IndexedDB）と
// 送信待ち（localStorage）から、この画面の中で組み立てる。URL は元の行き先のまま（/ops/plans/<id>/field など）なので、そこから計画を読む。
//   field        現場の画面（先読み済みの計画だけ。無ければ「この計画は端末に保存されていません」）
//   inspection   日常点検（飛行前・飛行後）の入力。9 項目を項目別に、異常は備考が必須。送信待ちに入れる
//   journal      日誌（飛行記録）の入力。離着陸の時刻は現場の記録から引き継ぐ。送信待ちに入れる。サーバーの警告は送信後に出る
//   today        先読み済みの計画の一覧
//   unavailable  圏外では行えない画面（計画の作成・通報・登録・一覧）：圏外であることと、戻ってから行うことを出す
import { SkeletonCard } from "@/components/ui/skeleton";
import { useEffect, useMemo, useState } from "react";
import { FIELD_STATE_MARK, fieldHref } from "@/lib/ops-field";
import { enqueue } from "@/lib/ops-outbox";
import { INSPECTION_ITEMS, INSPECTION_TIMING_LABELS, MAX_LONG_TEXT, SPECIFIC_FLIGHT_TYPE_LABELS, type InspectionItemKey } from "@/lib/ops-records";
import { safeReturnTo } from "@/lib/ops-return";
import { jstDate, jstTime, nowJstInput, toJstInput } from "@/lib/ops-time";
import { composeFieldView, type FieldBundlePlan, type FieldViewDto } from "@/server/ops/field-compose";
import { fieldState, outboxAsEvents, outboxAsInspections } from "@/server/ops/field-logic";
import { newRequestId } from "./drafts";
import { FieldClient } from "./field-client";
import { FieldModeMark } from "./field-mode-mark";
import { flushOutbox, loadPlanOutbox, markOutboxSaved, planOutboxUnsaved, updatePlanOutbox } from "./field-outbox";
import { currentMember, listBundles, loadBundle } from "./field-store";

// 見た目は field-client.tsx と同じ部品（ops-v2.css の .opx-btn／ops-v2-screens.css の .opx-box-*）。現場の値（56／64px・7:1・影なし・動きなし）は、
// 各画面が <FieldModeMark /> で <html data-mode="field"> を付けている間だけ効く（Sprint 16-K K2-1）。主ボタン（data-variant="primary"）は 1 状態に 1 つ。
const BTN = "opx-btn w-full";
const BTN_PRIMARY = "opx-btn opx-btn-primary opx-btn-field w-full";
// 選択中の面（薄い面＋墨の太い縁＋太字＋◉。主色の面にしない：主ボタンだけが主色。16-K designer N-3）
const BTN_SEL = "opx-btn opx-btn-sel opx-btn-field w-full";
const BOX = "opx-box";
const BOX_NOTE = "opx-box opx-box-note";
const BOX_WARN = "opx-box opx-box-warn";
const MAIN = "flex flex-col gap-5 pb-[env(safe-area-inset-bottom)] text-lg leading-[1.7] text-sb-ink touch-manipulation";
const HEADER = "flex flex-col gap-1 border-l-[length:8px] border-sb-ink pl-3";
const INPUT = "sb-input !min-h-14 w-full px-3 !text-lg font-normal";

export const OFFLINE_NOT_SAVED_MESSAGE = "この計画は端末に保存されていません。電波のある場所で一度開いてください。";
export const OFFLINE_UNAVAILABLE_MESSAGE =
  "接続なし（圏外）のため、この画面は開けません。計画の作成・編集、通報の記録、許可・機体・操縦者の登録、一覧の検索は、電波のある場所に戻ってから行ってください。";
export const OFFLINE_NO_MEMBER_MESSAGE = "この端末でログインしていた利用者が分かりません。電波のある場所でログインして、現場の画面を一度開いてください。";

const PLAN_PATH = /^\/ops\/plans\/([0-9a-fA-F-]{36})\/field\/?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Ctx = { readonly ready: boolean; readonly memberId: string | null; readonly planId: string | null; readonly bundle: FieldBundlePlan | null; readonly params: URLSearchParams };

/** 端末の利用者・URL の計画・先読みの束を読む（描画の後に。サーバーの枠には利用者のデータが無い）。 */
const useOfflineContext = (): Ctx => {
  const [ctx, setCtx] = useState<Ctx>({ ready: false, memberId: null, planId: null, bundle: null, params: new URLSearchParams() });
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const params = new URLSearchParams(window.location.search);
      const fromPath = PLAN_PATH.exec(window.location.pathname)?.[1] ?? null;
      const raw = fromPath ?? params.get("planId") ?? params.get("plan");
      const planId = raw && UUID.test(raw) ? raw.toLowerCase() : null;
      const memberId = currentMember();
      const bundle = memberId && planId ? await loadBundle(memberId, planId) : null;
      if (!cancelled) setCtx({ ready: true, memberId, planId, bundle, params });
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return ctx;
};

function OfflineBanner() {
  return (
    <p className={BOX_NOTE} role="status" data-testid="offline-banner">
      <span className="text-xl font-bold">× 接続なし（圏外）で開いています</span>
      <span>端末に保存した内容で表示しています。記録は送信待ちに入り、電波が戻ると順番に送られます。</span>
    </p>
  );
}

function Loading() {
  return (
    <main className={MAIN} data-testid="offline-loading">
      <FieldModeMark />
      <SkeletonCard />
      <p>端末に保存した内容を読み込んでいます…</p>
    </main>
  );
}

function Missing({ message, testId }: { readonly message: string; readonly testId: string }) {
  return (
    <main className={MAIN} data-testid="offline-root">
      <FieldModeMark />
      <OfflineBanner />
      <p className={BOX_WARN} role="alert" data-testid={testId}>
        {message}
      </p>
      <a href="/ops" className={BTN} data-testid="offline-today-link">
        端末に保存した今日の計画を見る
      </a>
    </main>
  );
}

// ---- 現場の画面 -------------------------------------------------------------

export function OfflineFieldShell() {
  const c = useOfflineContext();
  const initial = useMemo((): FieldViewDto | null => (c.bundle ? composeFieldView(c.bundle, { now: new Date() }) : null), [c.bundle]);
  if (!c.ready) return <Loading />;
  if (!c.memberId) return <Missing message={OFFLINE_NO_MEMBER_MESSAGE} testId="offline-no-member" />;
  if (!c.bundle || !initial) return <Missing message={OFFLINE_NOT_SAVED_MESSAGE} testId="offline-not-saved" />;
  return (
    <>
      <FieldModeMark />
      <FieldClient initial={initial} memberId={c.memberId} bundle={c.bundle} />
    </>
  );
}

// ---- 日常点検 ---------------------------------------------------------------

type ItemState = { readonly result: "" | "normal" | "abnormal"; readonly note: string };

export function OfflineInspectionShell() {
  const c = useOfflineContext();
  const [timing, setTiming] = useState<"pre_flight" | "post_flight">("pre_flight");
  const [items, setItems] = useState<Record<InspectionItemKey, ItemState>>(
    () => Object.fromEntries(INSPECTION_ITEMS.map((it) => [it.key, { result: "", note: "" }])) as Record<InspectionItemKey, ItemState>,
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (c.params.get("timing") === "post_flight") {
      const t = window.setTimeout(() => setTiming("post_flight"), 0);
      return () => window.clearTimeout(t);
    }
  }, [c.params]);
  if (!c.ready) return <Loading />;
  if (!c.memberId) return <Missing message={OFFLINE_NO_MEMBER_MESSAGE} testId="offline-no-member" />;
  if (!c.bundle || !c.planId) return <Missing message={OFFLINE_NOT_SAVED_MESSAGE} testId="offline-not-saved" />;
  const b = c.bundle;
  const memberId = c.memberId;
  const planId = c.planId;
  const selected = INSPECTION_ITEMS.filter((it) => items[it.key].result !== "").length;
  const back = safeReturnTo(c.params.get("returnTo")) ?? fieldHref(planId, timing === "post_flight" ? "post" : "preflight");
  const setItem = (k: InspectionItemKey, p: Partial<ItemState>) => setItems((cur) => ({ ...cur, [k]: { ...cur[k], ...p } }));

  const save = async () => {
    setError(null);
    if (selected < INSPECTION_ITEMS.length) {
      setError(`9 項目すべてで「正常」「異常」を選んでください（残り ${INSPECTION_ITEMS.length - selected} 項目）。`);
      return;
    }
    // 既存の入力検査と同じ：異常の項目は備考が必須（500 文字まで）
    for (const it of INSPECTION_ITEMS) {
      const st = items[it.key];
      if (st.result === "abnormal" && st.note.trim() === "") return setError(`${it.label}が「異常」の場合は備考を入力してください。`);
      if (st.note.trim().length > MAX_LONG_TEXT) return setError(`${it.label}の備考は ${MAX_LONG_TEXT} 文字以内にしてください。`);
    }
    setBusy(true);
    const clientEventId = newRequestId();
    const next = updatePlanOutbox(planId, memberId, (s) =>
      enqueue(s, {
        clientEventId,
        kind: "inspection",
        occurredAt: nowJstInput(new Date()),
        inspection: {
          timing,
          aircraftId: b.form.aircraftId,
          pilotId: b.form.pilotId,
          items: Object.fromEntries(
            INSPECTION_ITEMS.map((it) => [it.key, items[it.key].result === "abnormal" ? { result: "abnormal", note: items[it.key].note.trim() } : { result: "normal" }]),
          ) as never,
        },
      }),
    );
    if (!next.entries.some((e) => e.clientEventId === clientEventId)) {
      setBusy(false);
      return setError("点検を端末に保存できませんでした。入力を確かめてください。");
    }
    markOutboxSaved(memberId);
    // 通信できれば送る（送れなくても、送信待ちに残る）
    if (navigator.onLine) await Promise.race([flushOutbox(planId, memberId), new Promise((r) => window.setTimeout(r, 4000))]);
    if (planOutboxUnsaved(planId, memberId)) {
      // 端末に保存できない環境：画面を閉じると失われるので、この画面のまま知らせる（D-6）
      setBusy(false);
      return setError("この端末では送信待ちを保存できません。電波が戻って送信されるまで、この画面を閉じないでください。");
    }
    window.location.assign(back);
  };

  return (
    <main className={MAIN} data-testid="offline-root" aria-label="日常点検の入力（圏外）">
      <FieldModeMark />
      <OfflineBanner />
      <header className={HEADER}>
        <h1 className="opx-h1">日常点検の入力</h1>
        <p data-testid="offline-inspection-plan">{b.plan.title}</p>
        <p>
          <span className="sb-num">{b.plan.registrationMark}</span>（{b.plan.modelName}）／{b.plan.pilotName}／{b.plan.placeName}
        </p>
        <p className="sb-num">実施時刻：保存した時刻（端末の時計）</p>
      </header>
      {!b.perms.canInspect || !b.perms.canRecord ? (
        <p className={BOX_WARN} data-testid="offline-inspection-noaccess">
          日常点検は、点検できる人が記入します。
        </p>
      ) : (
        <>
          {b.form.lastInspection ? (
            <p className={BOX} data-testid="offline-inspection-last">
              直近の点検：{jstTime(new Date(b.form.lastInspection.inspectedAt))}（{INSPECTION_TIMING_LABELS[b.form.lastInspection.timing]}）
              {b.form.lastInspection.hasAbnormal ? "　！ 異常あり" : "　異常なし"}
            </p>
          ) : null}
          <div role="radiogroup" aria-label="区分" className="grid grid-cols-2 gap-3">
            {(["pre_flight", "post_flight"] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={timing === t}
                className={timing === t ? BTN_SEL : BTN}
                data-testid={`offline-inspection-timing-${t}`}
                onClick={() => setTiming(t)}
              >
                <span aria-hidden>{timing === t ? "◉" : "○"}</span>
                {INSPECTION_TIMING_LABELS[t]}
              </button>
            ))}
          </div>
          <button
            type="button"
            className={BTN}
            data-testid="offline-inspection-all-normal"
            onClick={() => setItems((cur) => Object.fromEntries(INSPECTION_ITEMS.map((it) => [it.key, { result: "normal", note: cur[it.key].note }])) as Record<InspectionItemKey, ItemState>)}
          >
            すべて正常
          </button>
          <p aria-live="polite" data-testid="offline-inspection-count">
            選択 {selected} / {INSPECTION_ITEMS.length}
          </p>
          <ol className="flex flex-col gap-3">
            {INSPECTION_ITEMS.map((it) => {
              const st = items[it.key];
              return (
                <li key={it.key} className={BOX} data-testid={`offline-inspection-item-${it.key}`}>
                  <p className="font-bold">{it.label}</p>
                  <div role="radiogroup" aria-label={`${it.label}の結果`} className="grid grid-cols-2 gap-3">
                    {(["normal", "abnormal"] as const).map((r) => (
                      <button
                        key={r}
                        type="button"
                        role="radio"
                        aria-checked={st.result === r}
                        className={st.result === r ? BTN_SEL : BTN}
                        data-testid={`offline-inspection-${it.key}-${r}`}
                        onClick={() => setItem(it.key, { result: r })}
                      >
                        <span aria-hidden>{st.result === r ? "◉" : "○"}</span>
                        {r === "normal" ? "正常" : "異常"}
                      </button>
                    ))}
                  </div>
                  {st.result === "abnormal" ? (
                    <label className="flex flex-col gap-1 font-bold">
                      {it.label}の備考（必須）
                      <input
                        className={INPUT}
                        value={st.note}
                        maxLength={MAX_LONG_TEXT}
                        onChange={(e) => setItem(it.key, { note: e.target.value })}
                        data-testid={`offline-inspection-note-${it.key}`}
                      />
                    </label>
                  ) : null}
                </li>
              );
            })}
          </ol>
          <p className={BOX} data-testid="offline-inspection-storage-note">
            圏外では、9 項目の結果と「異常」の項目の備考だけを、この端末の送信待ちに保存します（送れたら消えます）。実施場所は計画の場所が入ります。位置・特記事項は、電波のある場所で訂正して入れられます。
          </p>
          {error ? (
            <p className={BOX_WARN} role="alert" data-testid="offline-inspection-error">
              {error}
            </p>
          ) : null}
          <button type="button" data-variant="primary" className={BTN_PRIMARY} disabled={busy} onClick={() => void save()} data-testid="offline-inspection-save">
            端末に保存する（電波が戻ると送ります）
          </button>
        </>
      )}
      <a href={back} className={BTN} data-testid="offline-back">
        現場の画面へ戻る
      </a>
    </main>
  );
}

// ---- 日誌 -------------------------------------------------------------------

export function OfflineJournalShell() {
  const c = useOfflineContext();
  const [safety, setSafety] = useState<"" | "no" | "yes">("");
  const [detail, setDetail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const flight = useMemo(() => {
    if (!c.bundle || !c.memberId || !c.planId) return null;
    const ref = (c.params.get("takeoffEventId") ?? "").toLowerCase();
    const ob = loadPlanOutbox(c.planId, c.memberId);
    const st = fieldState({
      events: [...c.bundle.state.events, ...outboxAsEvents(ob.entries)],
      inspections: [...c.bundle.state.inspections, ...outboxAsInspections(ob.entries)],
      flightRecords: c.bundle.state.flightRecords,
      day: jstDate(new Date()),
      planVersion: c.bundle.state.planVersion,
    });
    const f = st.flights.find((x) => x.takeoffEventId === ref || x.takeoffClientEventId === ref) ?? null;
    const tempInspections = new Set(outboxAsInspections(ob.entries).map((x) => x.id));
    return f ? { f, inspectionIsTemp: f.preInspectionId !== null && tempInspections.has(f.preInspectionId) } : null;
  }, [c]);
  if (!c.ready) return <Loading />;
  if (!c.memberId) return <Missing message={OFFLINE_NO_MEMBER_MESSAGE} testId="offline-no-member" />;
  if (!c.bundle || !c.planId) return <Missing message={OFFLINE_NOT_SAVED_MESSAGE} testId="offline-not-saved" />;
  const b = c.bundle;
  const memberId = c.memberId;
  const planId = c.planId;
  const back = fieldHref(planId, "journal");
  const at = (iso: string): string => toJstInput(new Date(iso));

  const save = async () => {
    setError(null);
    if (!flight || flight.f.landingAt === null) return setError("着陸が記録された飛行が見つかりません。現場の画面から開いてください。");
    if (safety === "") return setError("飛行の安全に影響のあった事項の有無を選んでください。");
    if (safety === "yes" && detail.trim() === "") return setError("「あり」の場合は内容を入力してください。");
    if (detail.trim().length > MAX_LONG_TEXT) return setError(`内容は ${MAX_LONG_TEXT} 文字以内にしてください。`);
    setBusy(true);
    const clientEventId = newRequestId();
    const f = flight.f;
    const next = updatePlanOutbox(planId, memberId, (s) =>
      enqueue(s, {
        clientEventId,
        kind: "journal",
        occurredAt: nowJstInput(new Date()),
        journal: {
          aircraftId: b.form.aircraftId,
          pilotId: b.form.pilotId,
          takeoffAt: at(f.takeoffAt),
          landingAt: at(f.landingAt!),
          takeoffRef: f.takeoffEventId,
          ...(f.preInspectionId ? (flight.inspectionIsTemp ? { inspectionClientRef: f.preInspectionId } : { inspectionId: f.preInspectionId }) : {}),
          safetyIssue: safety === "yes",
          ...(safety === "yes" ? { safetyIssueDetail: detail.trim() } : {}),
        },
      }),
    );
    if (!next.entries.some((e) => e.clientEventId === clientEventId)) {
      setBusy(false);
      return setError("日誌を端末に保存できませんでした。入力を確かめてください。");
    }
    markOutboxSaved(memberId);
    if (navigator.onLine) await Promise.race([flushOutbox(planId, memberId), new Promise((r) => window.setTimeout(r, 4000))]);
    if (planOutboxUnsaved(planId, memberId)) {
      setBusy(false);
      return setError("この端末では送信待ちを保存できません。電波が戻って送信されるまで、この画面を閉じないでください。");
    }
    window.location.assign(back);
  };

  return (
    <main className={MAIN} data-testid="offline-root" aria-label="日誌の入力（圏外）">
      <FieldModeMark />
      <OfflineBanner />
      <header className={HEADER}>
        <h1 className="opx-h1">日誌（飛行記録）の入力</h1>
        <p>{b.plan.title}</p>
        <p>
          <span className="sb-num">{b.plan.registrationMark}</span>（{b.plan.modelName}）／{b.plan.pilotName}／{b.plan.placeName}
        </p>
      </header>
      {!b.perms.canJournal ? (
        <p className={BOX_WARN} data-testid="offline-journal-noaccess">
          日誌は、記録できる人が記入します。
        </p>
      ) : !flight || flight.f.landingAt === null ? (
        <p className={BOX_WARN} role="alert" data-testid="offline-journal-no-flight">
          着陸が記録された飛行が見つかりません。現場の画面から開いてください。
        </p>
      ) : (
        <>
          <dl className={BOX} data-testid="offline-journal-flight">
            <div>
              <dt className="font-bold">離陸・着陸（現場の記録から）</dt>
              <dd className="sb-num tabular-nums" data-testid="offline-journal-times">
                {jstTime(new Date(flight.f.takeoffAt))} → {jstTime(new Date(flight.f.landingAt))}
              </dd>
            </div>
            <div>
              <dt className="font-bold">飛行前の日常点検</dt>
              <dd data-testid="offline-journal-inspection">
                {flight.f.preInspectionId ? `${FIELD_STATE_MARK.done} あり${flight.inspectionIsTemp ? "（送信待ち）" : ""}` : `${FIELD_STATE_MARK.todo} なし`}
              </dd>
            </div>
            <div>
              <dt className="font-bold">特定飛行の形態（計画から）</dt>
              <dd>{b.form.specificFlightTypes.length > 0 ? b.form.specificFlightTypes.map((t) => SPECIFIC_FLIGHT_TYPE_LABELS[t] ?? t).join("・") : "なし"}</dd>
            </div>
          </dl>
          <div role="radiogroup" aria-label="飛行の安全に影響のあった事項" className="flex flex-col gap-3">
            <p className="font-bold">飛行の安全に影響のあった事項</p>
            <div className="grid grid-cols-2 gap-3">
              {(["no", "yes"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  role="radio"
                  aria-checked={safety === v}
                  className={safety === v ? BTN_SEL : BTN}
                  data-testid={`offline-journal-safety-${v}`}
                  onClick={() => setSafety(v)}
                >
                  <span aria-hidden>{safety === v ? "◉" : "○"}</span>
                  {v === "no" ? "なし" : "あり"}
                </button>
              ))}
            </div>
            {safety === "yes" ? (
              <label className="flex flex-col gap-1 font-bold">
                内容（必須）
                <textarea
                  rows={3}
                  maxLength={MAX_LONG_TEXT}
                  className={`${INPUT} py-2`}
                  value={detail}
                  onChange={(e) => setDetail(e.target.value)}
                  data-testid="offline-journal-safety-detail"
                />
              </label>
            ) : null}
          </div>
          <p className={BOX_NOTE} data-testid="offline-journal-warning-note">
            点検なし・計画との相違などのサーバーの確認事項は、送信した後に現場の画面に出ます。飛行の目的・離着陸の場所は計画の内容が入ります。不具合の記事は、電波のある場所で訂正して入れられます。
          </p>
          {error ? (
            <p className={BOX_WARN} role="alert" data-testid="offline-journal-error">
              {error}
            </p>
          ) : null}
          <button type="button" data-variant="primary" className={BTN_PRIMARY} disabled={busy} onClick={() => void save()} data-testid="offline-journal-save">
            端末に保存する（電波が戻ると送ります）
          </button>
        </>
      )}
      <a href={back} className={BTN} data-testid="offline-back">
        現場の画面へ戻る
      </a>
    </main>
  );
}

// ---- 今日（先読み済みの計画） ---------------------------------------------------

export function OfflineTodayShell() {
  const [state, setState] = useState<{ ready: boolean; memberId: string | null; bundles: FieldBundlePlan[] }>({ ready: false, memberId: null, bundles: [] });
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const memberId = currentMember();
      const bundles = memberId ? await listBundles(memberId) : [];
      if (!cancelled) setState({ ready: true, memberId, bundles });
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  if (!state.ready) return <Loading />;
  if (!state.memberId) return <Missing message={OFFLINE_NO_MEMBER_MESSAGE} testId="offline-no-member" />;
  return (
    <main className={MAIN} data-testid="offline-root" aria-label="今日（圏外）">
      <FieldModeMark />
      <OfflineBanner />
      <h1 className="opx-h1">端末に保存した計画</h1>
      {state.bundles.length === 0 ? (
        <p className={BOX_WARN} data-testid="offline-today-empty">
          端末に保存した計画はありません。電波のある場所で「ホーム」を開くと、今日と明日の計画を保存します。
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {state.bundles.map((b) => (
            <li key={b.planId}>
              <a href={fieldHref(b.planId)} className={`${BTN} flex-col !items-start py-2 !text-left`} data-testid="offline-today-plan">
                <span className="sb-num tabular-nums">
                  {b.plan.plannedDate} {b.plan.timeLabel}
                </span>
                <span>{b.plan.title}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

// ---- 圏外では行えない画面 ---------------------------------------------------------

export function OfflineUnavailableShell() {
  return (
    <main className={MAIN} data-testid="offline-root" aria-label="圏外">
      <FieldModeMark />
      <OfflineBanner />
      <p className={BOX_WARN} role="alert" data-testid="offline-unavailable">
        {OFFLINE_UNAVAILABLE_MESSAGE}
      </p>
      <button type="button" className={BTN} onClick={() => window.history.back()} data-testid="offline-unavailable-back">
        前の画面へ戻る
      </button>
      <a href="/ops" className={BTN} data-testid="offline-today-link">
        端末に保存した今日の計画を見る
      </a>
    </main>
  );
}
