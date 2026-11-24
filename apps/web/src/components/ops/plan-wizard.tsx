"use client";

// 飛行計画の新規作成を 6 段に分ける枠（Sprint 16-H1。契約 §9）。
//   ① 場所 ② 日時 ③ 飛行の方法と目的 ④ 操縦者・機体・許可 ⑤ 内容の確認（保存） ⑥ 保存後の計画の画面（/ops/plans/[id]）
// - 段の間の入力は React の状態だけに持つ。localStorage・sessionStorage・IndexedDB・Cache には書かない（不変条件 5・K-15）。
//   途中で再読み込みするか、タブを閉じると消えるので、保存の前に離れるときは確認を出す（beforeunload とアプリ内のリンク）。
// - 段の移動は同じ画面の中。URL の ?step=n を履歴に積み、ブラウザの戻る・進むで段を行き来する（入力は状態に残る）。
// - 各段の「次へ」でその段の入力漏れを検べ、漏れがあれば進まずに該当の欄へフォーカスして、欄の下に記号付きの 1 行を出す。
//   サーバーの検証（422 など）は段 ⑤ の保存のときに、該当の段へ戻す導線と一緒に出す。
// - 保存は今の API のまま（POST /api/ops/plans。サーバーが判定を実行して下書きの計画を作る）。
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { SPECIFIC_FLIGHT_FLAG_LABEL, type SpecificFlightFlag } from "@soraban/regulations";
import {
  PLAN_ACCESS_CHOICES,
  PLAN_FLAG_CHOICES,
  PLAN_OBSERVER_CHOICES,
  PLAN_PERMIT_CHOICES,
  PLAN_PURPOSE_CHOICES,
  type PlanFormValues,
} from "@/lib/plan-options";
import type { PermitHelper } from "@/server/ops/permit-page";
import { setChangeFlash } from "./change-notice";
import { newRequestId } from "./drafts";
import { Field, fieldErrorsOf, FieldError, FormError, inputClass, useErrorFocus } from "./ops-client";
import type { PilotOption } from "./records-client";
import {
  appendNumber,
  call,
  failMessage,
  PermitNumberHelper,
  planBody,
  planCheckbox,
  planCheckRow,
  PlaceSearchHelper,
  selectClass,
  toggle,
  type PlanAircraftOption,
  type PlacePick,
} from "./plans-client";
import { buttonGhostClass, buttonPrimaryClass, buttonTextClass, VERSION_NOTICE_TARGET } from "./ui";

export const WIZARD_STEPS = [
  { n: 1, label: "場所" },
  { n: 2, label: "日時" },
  { n: 3, label: "飛行の方法と目的" },
  { n: 4, label: "操縦者・機体・許可" },
  { n: 5, label: "内容の確認" },
  { n: 6, label: "計画の画面" },
] as const;
const LAST_INPUT_STEP = 5;
const TOTAL = WIZARD_STEPS.length;

/** 進捗の帯の読み上げ（「2/6 日時」）。 */
export const progressText = (step: number): string => `${step}/${TOTAL} ${WIZARD_STEPS[step - 1]?.label ?? ""}`;

/** 入力の誤りの項目（API の fields のキー）が属する段。知らないキーは null（段 ⑤ の全体の誤りとして出す）。 */
const STEP_OF_KEY: Readonly<Record<string, number>> = {
  placeName: 1,
  latitude: 1,
  longitude: 1,
  radiusM: 1,
  areas: 1,
  savedPlaceId: 1,
  plannedStartAt: 2,
  startDate: 2,
  startTime: 2,
  durationMinutes: 2,
  title: 3,
  purpose: 3,
  flags: 3,
  maxAltitudeM: 3,
  judgementPurpose: 3,
  accessControl: 3,
  bvlosWithObserver: 3,
  aircraftId: 4,
  pilotId: 4,
  pilotPermits: 4,
  permitNumbers: 4,
  notes: 4,
};
export const stepOfKey = (key: string): number | null => STEP_OF_KEY[key] ?? null;

const KEYS_OF_STEP = (step: number): string[] => Object.keys(STEP_OF_KEY).filter((k) => STEP_OF_KEY[k] === step);

/** 段ごとの入力漏れ（必須の欄が空）。文言はサーバーの検証と同じ「〜を入力してください」。 */
export const validateStep = (step: number, v: PlanFormValues): Record<string, string> => {
  const e: Record<string, string> = {};
  const blank = (s: string) => s.trim() === "";
  if (step === 1) {
    if (blank(v.placeName)) e["placeName"] = "場所の名称を入力してください";
    if (blank(v.lat)) e["latitude"] = "緯度を入力してください";
    if (blank(v.lng)) e["longitude"] = "経度を入力してください";
  } else if (step === 2) {
    if (blank(v.startDate)) e["startDate"] = "予定開始の日付を入力してください";
    if (blank(v.startTime)) e["startTime"] = "予定開始の時刻を入力してください";
    if (blank(v.duration)) e["durationMinutes"] = "所要時間（分）を入力してください";
  } else if (step === 3) {
    if (blank(v.title)) e["title"] = "計画名を入力してください";
    if (blank(v.purpose)) e["purpose"] = "飛行の目的を入力してください";
  } else if (step === 4) {
    if (blank(v.aircraftId)) e["aircraftId"] = "機体を選んでください";
    if (blank(v.pilotId)) e["pilotId"] = "操縦者を選んでください";
  }
  return e;
};

const LEAVE_MESSAGE = "入力した内容はまだ保存されていません。このページを離れると、入力した内容は消えます。離れますか？";

const withStep = (n: number): string => {
  const u = new URL(window.location.href);
  u.searchParams.set("step", String(n));
  return `${u.pathname}${u.search}${u.hash}`;
};
const stepFromLocation = (): number => {
  const n = Number(new URL(window.location.href).searchParams.get("step"));
  return Number.isInteger(n) && n >= 1 && n <= LAST_INPUT_STEP ? n : 1;
};

/** 上に固定の進捗の帯（高さ 4・主色）と「2/6 日時」の文字。 */
export function WizardProgress({ step }: { readonly step: number }) {
  return (
    <div className="opx-wiz-progress" data-testid="plan-wizard-progress-band">
      <div
        className="opx-wiz-bar"
        role="progressbar"
        aria-label="計画作成の進み具合"
        aria-valuemin={1}
        aria-valuemax={TOTAL}
        aria-valuenow={step}
        aria-valuetext={progressText(step)}
        data-testid="plan-wizard-progress"
      >
        <div className="opx-wiz-fill" style={{ width: `${(step / TOTAL) * 100}%` }} />
      </div>
      <p className="opx-wiz-step" data-testid="plan-wizard-step-text">
        {progressText(step)}
      </p>
    </div>
  );
}

export function PlanWizard({
  aircraft,
  pilots,
  fixedPilotId,
  places,
  initial,
  handoff,
  handoffWeightG,
  permitHelper,
}: {
  readonly aircraft: readonly PlanAircraftOption[];
  readonly pilots: readonly PilotOption[];
  readonly fixedPilotId: string | null;
  readonly places: readonly PlacePick[];
  readonly initial: PlanFormValues;
  /** 判定画面から入力を引き継いだか。 */
  readonly handoff: boolean;
  readonly handoffWeightG?: string;
  readonly permitHelper?: PermitHelper;
}) {
  const [v, setV] = useState<PlanFormValues>(() => ({ ...initial, pilotId: fixedPilotId ?? initial.pilotId }));
  const [initialJson] = useState(() => JSON.stringify({ ...initial, pilotId: fixedPilotId ?? initial.pilotId }));
  const [clientRequestId] = useState(() => newRequestId());
  const [step, setStep] = useState(1);
  const [clientErrors, setClientErrors] = useState<Record<string, string>>({});
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [fromReview, setFromReview] = useState(false);
  const savedRef = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const { formRef, requestErrorFocus } = useErrorFocus();
  const set = <K extends keyof PlanFormValues>(k: K, value: PlanFormValues[K]) => setV((s) => ({ ...s, [k]: value }));
  const err = (k: string): string | undefined => clientErrors[k] ?? serverErrors[k];

  const selectedAircraft = aircraft.find((a) => a.id === v.aircraftId);
  const withAircraftWeight = (a: PlanAircraftOption) =>
    `${a.registrationMark}（${a.modelName}）${a.status === "suspended" ? "［休止］" : ""}　${
      a.maxTakeoffWeightKg === null ? "重量未登録" : `最大離陸重量 ${a.maxTakeoffWeightKg} kg`
    }`;

  // ---- 段の移動（?step=n を履歴に積む。戻る・進むは popstate で受ける） ----
  useEffect(() => {
    // 再読み込みや、別の画面から履歴で戻ってきたときは入力が無いので、①から始める
    if (new URL(window.location.href).searchParams.has("step") && stepFromLocation() !== 1) window.history.replaceState(null, "", withStep(1));
    const onPop = () => {
      setStep(stepFromLocation());
      setFromReview(false);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const goTo = useCallback((n: number) => {
    window.history.pushState(null, "", withStep(n));
    setStep(n);
  }, []);

  // 段が変わったら、段の見出しへフォーカスを移す（誤りの欄があるときは、その欄が先）
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    if (formRef.current?.querySelector('[aria-invalid="true"]')) return;
    headingRef.current?.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
  }, [step, formRef]);

  // ---- 保存の前の離脱の確認 ----
  const dirtyRef = useRef(false);
  // 保存が済んだら（再描画の前に画面を移すので、savedRef も見る）確認を出さない
  const dirty = JSON.stringify(v) !== initialJson;
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!dirtyRef.current || savedRef.current) return;
      e.preventDefault();
      e.returnValue = "";
    };
    const onClick = (e: MouseEvent) => {
      if (!dirtyRef.current || savedRef.current || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || (a.target && a.target !== "_self") || a.hasAttribute("download")) return;
      const u = new URL(a.href, window.location.href);
      if (u.origin !== window.location.origin || u.pathname === window.location.pathname) return;
      if (!window.confirm(LEAVE_MESSAGE)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, []);

  // ---- 次へ・戻る・修正 ----
  const next = () => {
    const found = validateStep(step, v);
    const keys = KEYS_OF_STEP(step);
    setServerErrors((s) => Object.fromEntries(Object.entries(s).filter(([k]) => !keys.includes(k))));
    setClientErrors((s) => ({ ...Object.fromEntries(Object.entries(s).filter(([k]) => !keys.includes(k))), ...found }));
    if (Object.keys(found).length > 0) {
      requestErrorFocus();
      return;
    }
    if (fromReview) {
      setFromReview(false);
      goTo(LAST_INPUT_STEP);
    } else goTo(step + 1);
  };
  const back = () => {
    setFromReview(false);
    goTo(step - 1);
  };
  const edit = (n: number) => {
    setFromReview(true);
    goTo(n);
  };

  // ---- 保存（段 ⑤）。今の API のまま。サーバーの誤りは、該当の段へ戻す導線と一緒に出す ----
  const save = async () => {
    setBusy(true);
    setMessage(null);
    const r = await call("POST", "/api/ops/plans", { ...planBody(v), clientRequestId });
    setBusy(false);
    if (!r.ok) {
      setServerErrors(fieldErrorsOf(r));
      setMessage(failMessage(r));
      requestErrorFocus();
      return;
    }
    setServerErrors({});
    savedRef.current = true;
    const id = String(r.data["id"]);
    setChangeFlash(`/ops/plans/${id}`, VERSION_NOTICE_TARGET, "飛行計画を保存しました。サーバーで判定を実行して保存しています。");
    window.location.assign(`/ops/plans/${id}`);
  };
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (step === LAST_INPUT_STEP) void save();
    else next();
  };

  const serverEntries = Object.entries(serverErrors);
  const serverGroups = (() => {
    const out = new Map<number | "other", string[]>();
    for (const [k, m] of serverEntries) {
      const s = stepOfKey(k) ?? "other";
      out.set(s, [...(out.get(s) ?? []), m]);
    }
    return out;
  })();

  const heading = WIZARD_STEPS[step - 1]!;
  const circled = ["①", "②", "③", "④", "⑤", "⑥"][step - 1];

  return (
    <>
      <WizardProgress step={step} />
      <form ref={formRef} onSubmit={onSubmit} noValidate className="opx-form flex flex-col gap-6" aria-label="飛行計画の入力" data-testid="plan-form" data-step={step}>
        <div className="flex flex-col gap-2">
          <h2 ref={headingRef} tabIndex={-1} className="opx-wiz-heading" data-testid="plan-step-heading">
            {circled} {heading.label}
          </h2>
          {step === 1 && handoff ? (
            <p className="opx-note" data-testid="plan-handoff-note">
              判定画面の入力（地点・飛行の方法・許可・予定日）を引き継ぎました。判定の結果は引き継ぎません。保存すると、サーバーが判定をやり直します。
              {handoffWeightG
                ? `判定画面で入れた機体の重さ（${handoffWeightG} g）は参考です。計画の判定には、選んだ機体の登録上の最大離陸重量を使います。`
                : ""}
            </p>
          ) : null}
        </div>

        {step === 1 ? (
          <fieldset className="flex min-w-0 flex-col gap-4" data-testid="plan-place-section">
            <legend>場所</legend>
            {places.length > 0 ? (
              <Field label="よく使う地点から選ぶ" required={false} hint="選ぶと、名称と座標が入ります。座標は計画に写しとして残ります。">
                <select
                  className={selectClass}
                  value={v.savedPlaceId}
                  onChange={(e) => {
                    const p = places.find((x) => x.id === e.target.value);
                    if (!p) set("savedPlaceId", "");
                    else setV((s) => ({ ...s, savedPlaceId: p.id, placeName: p.name, lat: String(p.latitude), lng: String(p.longitude) }));
                  }}
                  data-testid="plan-saved-place"
                >
                  <option value="">選ばない</option>
                  {places.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}
            <Field label="場所の名称" required error={err("placeName")} hint="100 文字以内">
              <input className={`${inputClass} min-h-12`} value={v.placeName} onChange={(e) => set("placeName", e.target.value)} data-testid="plan-place-name" />
            </Field>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-3">
              <Field label="緯度" required error={err("latitude")} hint="世界測地系（WGS84）、小数 6 桁まで">
                <input
                  inputMode="decimal"
                  className={`${inputClass} min-h-12 sb-num tnum`}
                  value={v.lat}
                  onChange={(e) => setV((s) => ({ ...s, lat: e.target.value, savedPlaceId: "" }))}
                  data-testid="plan-lat"
                />
              </Field>
              <Field label="経度" required error={err("longitude")}>
                <input
                  inputMode="decimal"
                  className={`${inputClass} min-h-12 sb-num tnum`}
                  value={v.lng}
                  onChange={(e) => setV((s) => ({ ...s, lng: e.target.value, savedPlaceId: "" }))}
                  data-testid="plan-lng"
                />
              </Field>
            </div>
            <PlaceSearchHelper
              candidatePrimary={false}
              onPick={(c) => setV((s) => ({ ...s, lat: c.lat, lng: c.lng, savedPlaceId: "", placeName: c.name !== null && !s.placeName.trim() ? c.name : s.placeName }))}
            />
            <Field label="範囲の半径（m）" required={false} error={err("radiusM") ?? err("areas")} hint="1〜10000 m。点と半径で表します。">
              <input inputMode="numeric" className={`${inputClass} min-h-12 sb-num tnum`} value={v.radius} onChange={(e) => set("radius", e.target.value)} data-testid="plan-radius" />
            </Field>
          </fieldset>
        ) : null}

        {step === 2 ? (
          <section className="flex flex-col gap-4" aria-label="日時" data-testid="plan-when-section">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field label="予定開始（日付）" required error={err("startDate") ?? err("plannedStartAt")} hint="日本時間">
                <input type="date" className={`${inputClass} min-h-12 sb-num tnum`} value={v.startDate} onChange={(e) => set("startDate", e.target.value)} data-testid="plan-start-date" />
              </Field>
              <Field label="予定開始（時刻）" required error={err("startTime")} hint="日本時間。分まで">
                <input type="time" className={`${inputClass} min-h-12 sb-num tnum`} value={v.startTime} onChange={(e) => set("startTime", e.target.value)} data-testid="plan-start-time" />
              </Field>
              <Field label="所要時間（分）" required error={err("durationMinutes")} hint="1〜1440 分。24 時間を超える飛行は別の計画に分けます。">
                <input inputMode="numeric" className={`${inputClass} min-h-12 sb-num tnum`} value={v.duration} onChange={(e) => set("duration", e.target.value)} data-testid="plan-duration" />
              </Field>
            </div>
          </section>
        ) : null}

        {step === 3 ? (
          <>
            <section className="flex flex-col gap-4" aria-label="計画の基本">
              <Field label="計画名" required error={err("title")} hint="100 文字以内">
                <input className={`${inputClass} min-h-12`} value={v.title} onChange={(e) => set("title", e.target.value)} data-testid="plan-title" />
              </Field>
              <Field label="飛行の目的" required error={err("purpose")} hint="100 文字以内。飛行記録の目的に引き継ぎます。">
                <input className={`${inputClass} min-h-12`} value={v.purpose} onChange={(e) => set("purpose", e.target.value)} data-testid="plan-purpose" />
              </Field>
              <Field label="最大高度（m）" required={false} error={err("maxAltitudeM")} hint="0〜2000 m。150 m 以上は「150m以上の高さ」として判定に入ります。">
                <input inputMode="numeric" className={`${inputClass} min-h-12 sb-num tnum`} value={v.altitude} onChange={(e) => set("altitude", e.target.value)} data-testid="plan-altitude" />
              </Field>
            </section>
            <fieldset className="flex min-w-0 flex-col gap-3" aria-describedby={err("flags") ? "plan-err-flags" : undefined} data-testid="plan-flags">
              <legend>飛行の方法・空域</legend>
              <p data-note="" className="text-sb-ink-3">DID（人口集中地区）と空港等周辺は、地点から判定が導きます。ここでは選びません。</p>
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {PLAN_FLAG_CHOICES.map((c) => (
                  <label key={c.value} className={planCheckRow}>
                    <input type="checkbox" className={planCheckbox} checked={v.flags.includes(c.value)} onChange={() => set("flags", toggle(v.flags, c.value))} data-testid={`plan-flag-${c.value}`} />
                    {SPECIFIC_FLIGHT_FLAG_LABEL[c.value as SpecificFlightFlag]}
                  </label>
                ))}
              </div>
              <FieldError id="plan-err-flags" message={err("flags")} />
            </fieldset>
            <section className="flex flex-col gap-4" aria-label="判定の条件">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="運航の目的（例外）" required={false} error={err("judgementPurpose")} hint="史跡・公園・県条例の例外節と照合します。">
                  <select className={selectClass} value={v.judgementPurpose} onChange={(e) => set("judgementPurpose", e.target.value)} data-testid="plan-judgement-purpose">
                    {PLAN_PURPOSE_CHOICES.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="立入管理措置／第三者上空" required={false} error={err("accessControl")}>
                  <select className={selectClass} value={v.access} onChange={(e) => set("access", e.target.value)} data-testid="plan-access">
                    {PLAN_ACCESS_CHOICES.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              {v.flags.includes("method_bvlos") ? (
                <Field label="目視外飛行の補助者" required={false} error={err("bvlosWithObserver")}>
                  <select className={selectClass} value={v.observer} onChange={(e) => set("observer", e.target.value)} data-testid="plan-observer">
                    {PLAN_OBSERVER_CHOICES.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </Field>
              ) : null}
            </section>
          </>
        ) : null}

        {step === 4 ? (
          <>
            <section className="flex flex-col gap-4" aria-label="機体と操縦者">
              <Field label="機体" required error={err("aircraftId")} hint="判定には、この機体の最大離陸重量を使います（画面で書き換えられません）。">
                <select className={`${selectClass} max-w-full truncate`} value={v.aircraftId} onChange={(e) => set("aircraftId", e.target.value)} data-testid="plan-aircraft">
                  <option value="">選んでください</option>
                  {aircraft.map((a) => (
                    <option key={a.id} value={a.id}>
                      {withAircraftWeight(a)}
                    </option>
                  ))}
                </select>
              </Field>
              {selectedAircraft && selectedAircraft.maxTakeoffWeightKg === null ? (
                <p className="opx-note" data-testid="plan-weight-unknown">
                  この機体は最大離陸重量が登録されていないため、通報の要否は「要確認」になります。機体の登録を訂正すると、判定を最新にできます。
                </p>
              ) : null}
              <Field label="操縦者" required error={err("pilotId")} hint={fixedPilotId ? "操縦者の役割では、自分の計画だけを作れます。" : undefined}>
                <select className={selectClass} value={v.pilotId} disabled={fixedPilotId !== null} onChange={(e) => set("pilotId", e.target.value)} data-testid="plan-pilot">
                  <option value="">選んでください</option>
                  {pilots.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.fullName}
                    </option>
                  ))}
                </select>
              </Field>
            </section>
            <fieldset className="flex min-w-0 flex-col gap-3" aria-describedby={err("pilotPermits") ? "plan-err-pilotPermits" : undefined} data-testid="plan-permits">
              <legend>取得済みの同意・通報・許可（DIPS の許可・承認を除く）</legend>
              <p className="opx-note opx-note-lg" data-testid="plan-permit-registry-note">
                国土交通省の許可・承認（DIPS）は、ここでは選びません。登録した許可の番号を、下の「許可・承認の番号」の欄に入れたときだけ、
                計画の日時・場所・機体・操縦者が範囲に収まるものが判定に使われます。許可・承認は登録から照合します。
              </p>
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {PLAN_PERMIT_CHOICES.map((c) => (
                  <label key={c.value} className={planCheckRow}>
                    <input type="checkbox" className={planCheckbox} checked={v.permits.includes(c.value)} onChange={() => set("permits", toggle(v.permits, c.value))} data-testid={`plan-permit-${c.value}`} />
                    {c.label}
                  </label>
                ))}
              </div>
              <FieldError id="plan-err-pilotPermits" message={err("pilotPermits")} />
              <p data-note="" className="text-sb-ink-3">これらの同意・通報・許可は、範囲と有効期間を照合していません。許可書で確認してください。</p>
            </fieldset>
            <section className="flex flex-col gap-4" aria-label="許可・承認の番号とメモ">
              <Field label="許可・承認の番号" required={false} error={err("permitNumbers")} hint="登録した許可の番号。複数は「,」「、」「;」か改行で区切ります（200 文字以内）。">
                <input className={`${inputClass} min-h-12`} value={v.permitNumbers} onChange={(e) => set("permitNumbers", e.target.value)} data-testid="plan-permit-numbers" />
              </Field>
              <PermitNumberHelper value={v.permitNumbers} helper={permitHelper} isEdit={false} onInsert={(n) => set("permitNumbers", appendNumber(v.permitNumbers, n))} />
              <Field label="メモ" required={false} error={err("notes")} hint="500 文字以内">
                <textarea className={inputClass} rows={3} value={v.notes} onChange={(e) => set("notes", e.target.value)} data-testid="plan-notes" />
              </Field>
            </section>
          </>
        ) : null}

        {step === 5 ? (
          <Review
            v={v}
            aircraft={aircraft}
            pilots={pilots}
            places={places}
            serverGroups={serverGroups}
            serverErrors={serverErrors}
            onEdit={edit}
            onFix={(n) => {
              setFromReview(true);
              goTo(n);
              requestErrorFocus();
            }}
          />
        ) : null}

        <div className="opx-submit">
          <FormError message={message} />
          <div className="flex flex-wrap items-center gap-3">
            {step > 1 ? (
              <button type="button" className={buttonGhostClass} onClick={back} disabled={busy} data-testid="plan-wizard-back">
                戻る
              </button>
            ) : null}
            {step < LAST_INPUT_STEP ? (
              <button type="submit" data-variant="primary" className={buttonPrimaryClass} data-testid="plan-wizard-next">
                {fromReview ? "確認に戻る" : "次へ"}
              </button>
            ) : (
              <button type="submit" data-variant="primary" className={buttonPrimaryClass} disabled={busy} data-testid="plan-submit">
                計画を保存
              </button>
            )}
            {step === LAST_INPUT_STEP && busy ? (
              <span role="status" className="text-sb-ink-2" data-testid="plan-judging">
                判定中…（サーバーで判定を実行して保存します）
              </span>
            ) : null}
          </div>
          {step === LAST_INPUT_STEP && !busy ? (
            <p data-note="" className="text-sb-ink-3">保存すると、サーバーが判定を実行し、その結果を判定の根拠として残します。</p>
          ) : null}
        </div>
      </form>
    </>
  );
}

// ---- 段 ⑤：読み取りのカード＋各「修正」 ----------------------------------

const dash = "入力なし";
const or = (s: string): string => (s.trim() === "" ? dash : s.trim());

function Row({ label, children, testId }: { readonly label: string; readonly children: ReactNode; readonly testId?: string }) {
  return (
    <div className="opx-wiz-row">
      <dt>{label}</dt>
      <dd {...(testId ? { "data-testid": testId } : {})}>{children}</dd>
    </div>
  );
}

function Review({
  v,
  aircraft,
  pilots,
  places,
  serverGroups,
  serverErrors,
  onEdit,
  onFix,
}: {
  readonly v: PlanFormValues;
  readonly aircraft: readonly PlanAircraftOption[];
  readonly pilots: readonly PilotOption[];
  readonly places: readonly PlacePick[];
  readonly serverGroups: ReadonlyMap<number | "other", readonly string[]>;
  readonly serverErrors: Readonly<Record<string, string>>;
  readonly onEdit: (n: number) => void;
  readonly onFix: (n: number) => void;
}) {
  const ac = aircraft.find((a) => a.id === v.aircraftId);
  const pilot = pilots.find((p) => p.id === v.pilotId);
  const saved = places.find((p) => p.id === v.savedPlaceId);
  const flagLabels = v.flags.map((f) => SPECIFIC_FLIGHT_FLAG_LABEL[f as SpecificFlightFlag]);
  const permitLabels = v.permits.map((p) => PLAN_PERMIT_CHOICES.find((c) => c.value === p)?.label ?? p);
  const choice = <T extends { readonly value: string; readonly label: string }>(list: readonly T[], value: string) => list.find((c) => c.value === value)?.label ?? dash;
  const cards: { n: number; title: string; body: ReactNode }[] = [
    {
      n: 1,
      title: "場所",
      body: (
        <>
          <Row label="場所の名称" testId="plan-review-place-name">{or(v.placeName)}</Row>
          <Row label="緯度・経度" testId="plan-review-coords"><span className="sb-num tnum">{or(v.lat)}, {or(v.lng)}</span></Row>
          {saved ? <Row label="よく使う地点">{saved.name}</Row> : null}
          <Row label="範囲の半径">{v.radius.trim() === "" ? dash : `${v.radius.trim()} m`}</Row>
        </>
      ),
    },
    {
      n: 2,
      title: "日時",
      body: (
        <>
          <Row label="予定開始（日本時間）" testId="plan-review-start"><span className="sb-num tnum">{or(v.startDate)} {or(v.startTime)}</span></Row>
          <Row label="所要時間" testId="plan-review-duration">{v.duration.trim() === "" ? dash : `${v.duration.trim()} 分`}</Row>
        </>
      ),
    },
    {
      n: 3,
      title: "飛行の方法と目的",
      body: (
        <>
          <Row label="計画名" testId="plan-review-title">{or(v.title)}</Row>
          <Row label="飛行の目的" testId="plan-review-purpose">{or(v.purpose)}</Row>
          <Row label="最大高度">{v.altitude.trim() === "" ? dash : `${v.altitude.trim()} m`}</Row>
          <Row label="飛行の方法・空域" testId="plan-review-flags">{flagLabels.length > 0 ? flagLabels.join("、") : dash}</Row>
          <Row label="運航の目的（例外）">{choice(PLAN_PURPOSE_CHOICES, v.judgementPurpose)}</Row>
          <Row label="立入管理措置／第三者上空">{v.access === "" ? dash : choice(PLAN_ACCESS_CHOICES, v.access)}</Row>
          {v.flags.includes("method_bvlos") ? <Row label="目視外飛行の補助者">{v.observer === "" ? dash : choice(PLAN_OBSERVER_CHOICES, v.observer)}</Row> : null}
        </>
      ),
    },
    {
      n: 4,
      title: "操縦者・機体・許可",
      body: (
        <>
          <Row label="機体" testId="plan-review-aircraft">{ac ? `${ac.registrationMark}（${ac.modelName}）` : dash}</Row>
          <Row label="操縦者" testId="plan-review-pilot">{pilot ? pilot.fullName : dash}</Row>
          <Row label="同意・通報・許可">{permitLabels.length > 0 ? permitLabels.join("、") : dash}</Row>
          <Row label="許可・承認の番号" testId="plan-review-permit-numbers">{or(v.permitNumbers)}</Row>
          <Row label="メモ">{or(v.notes)}</Row>
        </>
      ),
    },
  ];
  const other = serverGroups.get("other");
  return (
    <>
      {serverGroups.size > 0 ? (
        <section className="flex flex-col gap-3" aria-label="保存できなかった項目" data-testid="plan-review-errors">
          <p className="opx-wiz-errlead">
            <span aria-hidden>▲ </span>入力に誤りがあり、保存できませんでした。該当の段へ戻って直してください。
          </p>
          <ul className="flex flex-col gap-2">
            {Object.entries(serverErrors)
              .filter(([k]) => stepOfKey(k) !== null)
              .map(([k, m]) => {
                const n = stepOfKey(k)!;
                return (
                  <li key={k} className="flex flex-wrap items-center justify-between gap-2" data-testid="plan-review-error">
                    <span className="min-w-0">
                      <span className="font-bold">{WIZARD_STEPS[n - 1]!.label}：</span>
                      {m}
                    </span>
                    <button type="button" className={buttonTextClass} onClick={() => onFix(n)} data-testid={`plan-review-error-fix-${n}`}>
                      {WIZARD_STEPS[n - 1]!.label}の段へ戻る
                    </button>
                  </li>
                );
              })}
            {other?.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </section>
      ) : null}
      {cards.map((c) => (
        <section key={c.n} className="flex flex-col gap-3" aria-labelledby={`plan-review-h-${c.n}`} data-testid={`plan-review-${c.n}`}>
          <div className="opx-wiz-cardhead">
            <h3 id={`plan-review-h-${c.n}`}>{c.title}</h3>
            <button type="button" className={buttonTextClass} onClick={() => onEdit(c.n)} aria-label={`${c.title}を修正`} data-testid={`plan-review-edit-${c.n}`}>
              修正
            </button>
          </div>
          <dl className="opx-wiz-dl">{c.body}</dl>
        </section>
      ))}
    </>
  );
}
