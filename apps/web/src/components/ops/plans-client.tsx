"use client";

// 飛行計画・よく使う地点の入力部品（Sprint 12a 設計 F・I）。どれも /api/ops/* を呼ぶだけで、判断（判定の実行・版・確認・認可）はサーバーが行う。
// - 計画の保存では、サーバーが判定を実行して保存する（画面は判定の結果を送らない）。保存中は「判定中」と出す。
// - 現在地・住所検索の結果は「候補」として示し、利用者が「この地点を使う」で確定するまで入力欄に入れない。
//   計画を保存するまで座標は送らない（Sprint 9 の方針）。
import { useMemo, useState, useSyncExternalStore, type FormEvent } from "react";
import { SPECIFIC_FLIGHT_FLAG_LABEL, type SpecificFlightFlag } from "@soraban/regulations";
import { searchAddress, type GeocodeResult } from "@/lib/geocode";
import {
  CURRENT_LOCATION_PRIVACY_NOTE,
  formatAccuracy,
  geolocationAvailability,
  isLowAccuracy,
  LOW_ACCURACY_MESSAGE,
  requestCurrentLocation,
} from "@/lib/current-location";
import { roundCoordinate } from "@/lib/ops-time";
import {
  PLAN_ACCESS_CHOICES,
  PLAN_FLAG_CHOICES,
  PLAN_OBSERVER_CHOICES,
  PLAN_PERMIT_CHOICES,
  PLAN_PURPOSE_CHOICES,
  type PlanFormValues,
} from "@/lib/plan-options";
import { setChangeFlash } from "./change-notice";
import { newRequestId } from "./drafts";
import {
    checkboxClass,
  Field,
  fieldErrorsOf,
  FormError,
  inputClass,
  messageFor,
  reloadAfterChange,
  send,
  SubmitRow,
  useErrorFocus,
  versionOf,
  type ApiResult,
} from "./ops-client";
import type { PilotOption } from "./records-client";
import { buttonDangerClass, buttonGhostClass, buttonOutlineBrandClass, buttonPrimaryClass, VERSION_NOTICE_TARGET } from "./ui";

/** 通信できない場合も ApiResult にする（status 0）。 */
const call = async (method: string, url: string, body?: unknown): Promise<ApiResult> => {
  try {
    return await send(method, url, body);
  } catch {
    return { ok: false, status: 0, data: { error: "network" } };
  }
};
const failMessage = (r: ApiResult): string =>
  r.status === 0 ? "通信できませんでした。入力した内容は画面に残っています。通信が戻ってから、もう一度操作してください。" : messageFor(r);

// ---- 飛行計画のフォーム ----------------------------------------

export type PlanAircraftOption = {
  readonly id: string;
  readonly registrationMark: string;
  readonly modelName: string;
  readonly status: "active" | "suspended" | "deregistered";
  /** 最大離陸重量（kg）。未登録は null。計画の判定には、この重量を使う。 */
  readonly maxTakeoffWeightKg: number | null;
};

export type PlacePick = { readonly id: string; readonly name: string; readonly latitude: number; readonly longitude: number };

type Candidate = {
  readonly lat: number;
  readonly lng: number;
  /** 候補の見出し（「現在地」または住所検索の表示名）。 */
  readonly label: string;
  readonly accuracyM?: number;
  /** 場所の名称の初期値に使ってよいか（住所検索の結果）。 */
  readonly asName?: boolean;
};

const noopSubscribe = () => () => {};
const geoReasonSnapshot = (): string => {
  const a = geolocationAvailability({
    geolocation: typeof navigator !== "undefined" ? navigator.geolocation : undefined,
    isSecureContext: typeof window !== "undefined" ? window.isSecureContext : undefined,
  });
  return a.available ? "" : a.reason;
};

const round6 = (n: number): string => String(roundCoordinate(n));
const toggle = (list: readonly string[], v: string): string[] => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

// 選択肢の行：枠で 1 行ずつ区切り（長い文言は折り返す）、選んだ行は藍の枠と薄い地で示す（チェックの記号と併用）。
const planCheckRow =
  "flex min-h-11 cursor-pointer items-start gap-3 rounded-sharp border border-rule-soft bg-paper px-3 py-2.5 text-sm leading-snug text-ink hover:bg-paper-soft has-[:checked]:border-brand-700 has-[:checked]:bg-brand-50 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-700";
const planCheckbox = `${checkboxClass} mt-0.5 h-5! w-5!`;
const selectClass = `${inputClass} min-h-12`;

export function PlanForm({
  aircraft,
  pilots,
  fixedPilotId,
  places,
  initial,
  editing,
  handoffWeightG,
}: {
  readonly aircraft: readonly PlanAircraftOption[];
  readonly pilots: readonly PilotOption[];
  readonly fixedPilotId: string | null;
  readonly places: readonly PlacePick[];
  readonly initial: PlanFormValues;
  /** 訂正のとき（機体は変えられない）。 */
  readonly editing?: { readonly id: string; readonly version: number };
  /** 判定画面から引き継いだ機体の重さ（g）。参考表示だけ。 */
  readonly handoffWeightG?: string;
}) {
  const isEdit = editing !== undefined;
  const [v, setV] = useState<PlanFormValues>({ ...initial, pilotId: fixedPilotId ?? initial.pilotId });
  const [clientRequestId] = useState(() => newRequestId());
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { formRef, requestErrorFocus } = useErrorFocus();
  const set = <K extends keyof PlanFormValues>(k: K, value: PlanFormValues[K]) => setV((s) => ({ ...s, [k]: value }));

  // 場所の候補（現在地・住所検索）。確定するまで入力欄に入れない
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [locStatus, setLocStatus] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<readonly GeocodeResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchNote, setSearchNote] = useState<string | null>(null);

  const selectedAircraft = aircraft.find((a) => a.id === v.aircraftId);
  const withAircraftWeight = useMemo(
    () => (a: PlanAircraftOption) =>
      `${a.registrationMark}（${a.modelName}）${a.status === "suspended" ? "［休止］" : ""}　${
        a.maxTakeoffWeightKg === null ? "重量未登録" : `最大離陸重量 ${a.maxTakeoffWeightKg} kg`
      }`,
    [],
  );

  const pickPlace = (id: string) => {
    const p = places.find((x) => x.id === id);
    if (!p) {
      set("savedPlaceId", "");
      return;
    }
    setV((s) => ({ ...s, savedPlaceId: p.id, placeName: p.name, lat: String(p.latitude), lng: String(p.longitude) }));
  };

  const locate = async () => {
    const a = geolocationAvailability({
      geolocation: typeof navigator !== "undefined" ? navigator.geolocation : undefined,
      isSecureContext: typeof window !== "undefined" ? window.isSecureContext : undefined,
    });
    if (!a.available) {
      setLocStatus(a.reason);
      return;
    }
    setLocating(true);
    setLocStatus("現在地を取得しています…");
    const out = await requestCurrentLocation(navigator.geolocation);
    setLocating(false);
    if (out.ok) {
      setCandidate({ lat: out.candidate.lat, lng: out.candidate.lng, label: "現在地", accuracyM: out.candidate.accuracyM });
      setLocStatus(null);
    } else {
      setLocStatus(out.message);
    }
  };

  const search = async () => {
    setSearching(true);
    setSearchNote(null);
    try {
      const r = await searchAddress(q);
      setHits(r.results);
      if (r.results.length === 0) setSearchNote(r.serviceError ? "住所検索サービスに接続できません。座標を入力してください。" : "該当する住所が見つかりません。");
    } catch {
      setHits(null);
      setSearchNote("住所検索サービスに接続できません。座標を入力してください。");
    }
    setSearching(false);
  };

  const useCandidate = () => {
    if (!candidate) return;
    setV((s) => ({
      ...s,
      lat: round6(candidate.lat),
      lng: round6(candidate.lng),
      savedPlaceId: "",
      placeName: candidate.asName && !s.placeName.trim() ? candidate.label.slice(0, 100) : s.placeName,
    }));
    setCandidate(null);
    setHits(null);
    setLocStatus("この地点を入力欄に入れました。計画を保存するまで送りません。");
  };

  const body = () => ({
    title: v.title,
    aircraftId: v.aircraftId || null,
    pilotId: v.pilotId || null,
    plannedStartAt: v.startDate && v.startTime ? `${v.startDate}T${v.startTime.slice(0, 5)}` : null,
    durationMinutes: v.duration.trim() === "" ? null : v.duration.trim(),
    purpose: v.purpose,
    placeName: v.placeName,
    latitude: v.lat.trim() === "" ? null : v.lat.trim(),
    longitude: v.lng.trim() === "" ? null : v.lng.trim(),
    radiusM: v.radius.trim() === "" ? null : v.radius.trim(),
    savedPlaceId: v.savedPlaceId || null,
    maxAltitudeM: v.altitude.trim() === "" ? null : v.altitude.trim(),
    flags: v.flags,
    pilotPermits: v.permits,
    judgementPurpose: v.judgementPurpose || null,
    accessControl: v.access === "yes" ? true : v.access === "no_third_party" ? false : null,
    thirdPartyOverflight: v.access === "no_third_party" ? true : null,
    bvlosWithObserver: v.flags.includes("method_bvlos") && v.observer !== "" ? v.observer === "with" : null,
    permitNumbers: v.permitNumbers.trim() === "" ? null : v.permitNumbers,
    notes: v.notes.trim() === "" ? null : v.notes,
  });

  const submit = async () => {
    setBusy(true);
    setMessage(null);
    const r = isEdit
      ? await call("PATCH", `/api/ops/plans/${editing.id}`, { ...body(), expectedVersion: editing.version, reason })
      : await call("POST", "/api/ops/plans", { ...body(), clientRequestId });
    setBusy(false);
    if (!r.ok) {
      setErrors(fieldErrorsOf(r));
      setMessage(failMessage(r));
      requestErrorFocus();
      return;
    }
    setErrors({});
    const id = isEdit ? editing.id : String(r.data["id"]);
    setChangeFlash(
      `/ops/plans/${id}`,
      VERSION_NOTICE_TARGET,
      isEdit ? `${versionOf(r)}訂正しました。` : "飛行計画を保存しました。サーバーで判定を実行して保存しています。",
    );
    window.location.assign(`/ops/plans/${id}`);
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!busy) void submit();
  };

  // 位置情報が使えない理由（使えるときは空文字。サーバーの描画では判定しない）
  const unavailableReason = useSyncExternalStore(noopSubscribe, geoReasonSnapshot, () => "");

  return (
    <form ref={formRef} onSubmit={onSubmit} className="flex flex-col gap-8" aria-label={isEdit ? "飛行計画の訂正" : "飛行計画の入力"} data-testid="plan-form">
      {handoffWeightG ? (
        <p className="border-l-2 border-brand-700 pl-3 text-xs leading-relaxed text-ink-soft" data-testid="plan-handoff-note">
          判定画面の入力（地点・飛行の方法・許可・予定日）を引き継ぎました。判定の結果は引き継ぎません。保存すると、サーバーが判定をやり直します。
          判定画面で入れた機体の重さ（{handoffWeightG} g）は参考です。計画の判定には、選んだ機体の登録上の最大離陸重量を使います。
        </p>
      ) : null}

      <section className="flex flex-col gap-4" aria-label="計画の基本">
        <Field label="計画名" required error={errors["title"]} hint="100 文字以内">
          <input className={`${inputClass} min-h-12`} value={v.title} onChange={(e) => set("title", e.target.value)} data-testid="plan-title" />
        </Field>
        <Field
          label="機体"
          required
          error={errors["aircraftId"]}
          hint={isEdit ? "機体は訂正で変えられません。誤った場合は中止して作り直してください。" : "判定には、この機体の最大離陸重量を使います（画面で書き換えられません）。"}
        >
          <select className={selectClass} value={v.aircraftId} disabled={isEdit} onChange={(e) => set("aircraftId", e.target.value)} data-testid="plan-aircraft">
            <option value="">選んでください</option>
            {aircraft.map((a) => (
              <option key={a.id} value={a.id}>
                {withAircraftWeight(a)}
              </option>
            ))}
          </select>
        </Field>
        {selectedAircraft && selectedAircraft.maxTakeoffWeightKg === null ? (
          <p className="border-l-2 border-signal-amber pl-3 text-xs leading-relaxed text-ink-soft" data-testid="plan-weight-unknown">
            この機体は最大離陸重量が登録されていないため、通報の要否は「要確認」になります。機体の登録を訂正すると、判定を最新にできます。
          </p>
        ) : null}
        <Field label="操縦者" required error={errors["pilotId"]} hint={fixedPilotId ? "操縦者の役割では、自分の計画だけを作れます。" : undefined}>
          <select className={selectClass} value={v.pilotId} disabled={fixedPilotId !== null} onChange={(e) => set("pilotId", e.target.value)} data-testid="plan-pilot">
            <option value="">選んでください</option>
            {pilots.map((p) => (
              <option key={p.id} value={p.id}>
                {p.fullName}
              </option>
            ))}
          </select>
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="予定開始（日付）" required error={errors["plannedStartAt"]} hint="日本時間">
            <input type="date" className={`${inputClass} min-h-12 font-mono tnum`} value={v.startDate} onChange={(e) => set("startDate", e.target.value)} data-testid="plan-start-date" />
          </Field>
          <Field label="予定開始（時刻）" required hint="日本時間。分まで">
            <input type="time" className={`${inputClass} min-h-12 font-mono tnum`} value={v.startTime} onChange={(e) => set("startTime", e.target.value)} data-testid="plan-start-time" />
          </Field>
          <Field label="所要時間（分）" required error={errors["durationMinutes"]} hint="1〜1440 分。24 時間を超える飛行は別の計画に分けます。">
            <input inputMode="numeric" className={`${inputClass} min-h-12 font-mono tnum`} value={v.duration} onChange={(e) => set("duration", e.target.value)} data-testid="plan-duration" />
          </Field>
        </div>
        <Field label="飛行の目的" required error={errors["purpose"]} hint="100 文字以内。飛行記録の目的に引き継ぎます。">
          <input className={`${inputClass} min-h-12`} value={v.purpose} onChange={(e) => set("purpose", e.target.value)} data-testid="plan-purpose" />
        </Field>
      </section>

      <fieldset className="flex min-w-0 flex-col gap-4" data-testid="plan-place-section">
        <legend className="mb-1 w-full border-b border-rule pb-1.5 text-sm font-medium text-ink">場所</legend>
        {places.length > 0 ? (
          <Field label="よく使う地点から選ぶ" required={false} hint="選ぶと、名称と座標が入ります。座標は計画に写しとして残ります。">
            <select className={selectClass} value={v.savedPlaceId} onChange={(e) => pickPlace(e.target.value)} data-testid="plan-saved-place">
              <option value="">選ばない</option>
              {places.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
        <Field label="場所の名称" required error={errors["placeName"]} hint="100 文字以内">
          <input className={`${inputClass} min-h-12`} value={v.placeName} onChange={(e) => set("placeName", e.target.value)} data-testid="plan-place-name" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="緯度" required error={errors["latitude"]} hint="世界測地系（WGS84）、小数 6 桁まで">
            <input
              inputMode="decimal"
              className={`${inputClass} min-h-12 font-mono tnum`}
              value={v.lat}
              onChange={(e) => setV((s) => ({ ...s, lat: e.target.value, savedPlaceId: "" }))}
              data-testid="plan-lat"
            />
          </Field>
          <Field label="経度" required error={errors["longitude"]}>
            <input
              inputMode="decimal"
              className={`${inputClass} min-h-12 font-mono tnum`}
              value={v.lng}
              onChange={(e) => setV((s) => ({ ...s, lng: e.target.value, savedPlaceId: "" }))}
              data-testid="plan-lng"
            />
          </Field>
        </div>

        <div className="flex flex-col gap-4 rounded-sharp border border-rule-soft bg-paper-soft px-3 py-3" data-testid="plan-place-helper">
          <p className="text-xs leading-relaxed text-ink-mute">座標は直接入れるほか、現在地や住所から探せます。候補は「この地点を使う」を押すまで入力欄に入りません。</p>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className={buttonGhostClass} onClick={() => void locate()} disabled={locating || unavailableReason !== ""} data-testid="plan-locate">
              現在地を取得する
            </button>
          </div>
          {locStatus ? (
            <p role="status" className="text-xs leading-relaxed text-ink-soft" data-testid="plan-loc-status">
              {locStatus}
            </p>
          ) : null}
          {unavailableReason && !locStatus ? <p className="text-xs leading-relaxed text-ink-mute">{unavailableReason}</p> : null}
          <div className="flex flex-col gap-2">
            <label htmlFor="plan-address-q" className="text-sm text-ink">
              住所で探す
            </label>
            <div className="flex gap-2">
              <input id="plan-address-q" className={`${inputClass} min-h-12`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="例：米子市加茂町" data-testid="plan-address-q" />
              <button type="button" className={`${buttonGhostClass} shrink-0 whitespace-nowrap`} onClick={() => void search()} disabled={searching || q.trim() === ""} data-testid="plan-address-search">
                検索
              </button>
            </div>
            {searchNote ? (
              <p role="status" className="text-xs text-ink-mute">
                {searchNote}
              </p>
            ) : null}
            {hits && hits.length > 0 ? (
              <ul className="flex flex-col divide-y divide-rule-soft rounded-sharp border border-rule" data-testid="plan-address-results">
                {hits.slice(0, 5).map((h) => (
                  <li key={`${h.lat},${h.lng},${h.title}`}>
                    <button
                      type="button"
                      className="flex min-h-11 w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm hover:bg-paper-soft"
                      onClick={() => setCandidate({ lat: h.lat, lng: h.lng, label: h.title, asName: true })}
                    >
                      <span>{h.title}</span>
                      <span className="font-mono text-[11px] tnum text-ink-mute">
                        {h.lat}, {h.lng}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          {candidate ? (
            <div className="flex flex-col gap-2 rounded-sharp border border-brand-500 bg-paper px-3 py-3" data-testid="plan-candidate">
              <p className="text-sm text-ink">
                候補：{candidate.label}
                <span className="ml-2 font-mono text-xs tnum text-ink-soft">
                  {round6(candidate.lat)}, {round6(candidate.lng)}
                </span>
                {candidate.accuracyM !== undefined ? <span className="ml-2 text-xs text-ink-soft">（{formatAccuracy(candidate.accuracyM)}）</span> : null}
              </p>
              {candidate.accuracyM !== undefined && isLowAccuracy(candidate.accuracyM) ? (
                <p className="border-l-2 border-signal-amber pl-2 text-xs leading-relaxed text-ink-soft" role="status">
                  <span className="font-medium">注意：</span>
                  {LOW_ACCURACY_MESSAGE}
                </p>
              ) : null}
              <p className="text-xs text-ink-mute">まだ入力欄に入れていません。{CURRENT_LOCATION_PRIVACY_NOTE}</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={buttonPrimaryClass} onClick={useCandidate} data-testid="plan-use-candidate">
                  この地点を使う
                </button>
                <button type="button" className={buttonGhostClass} onClick={() => setCandidate(null)}>
                  取消
                </button>
              </div>
            </div>
          ) : null}
        </div>

        <div className="grid grid-cols-2 gap-3 sm:gap-4">
          <Field label="範囲の半径（m）" required={false} error={errors["radiusM"]} hint="1〜10000 m。点と半径で表します。">
            <input inputMode="numeric" className={`${inputClass} min-h-12 font-mono tnum`} value={v.radius} onChange={(e) => set("radius", e.target.value)} data-testid="plan-radius" />
          </Field>
          <Field label="最大高度（m）" required={false} error={errors["maxAltitudeM"]} hint="0〜2000 m。150 m 以上は「150m以上の高さ」として判定に入ります。">
            <input inputMode="numeric" className={`${inputClass} min-h-12 font-mono tnum`} value={v.altitude} onChange={(e) => set("altitude", e.target.value)} data-testid="plan-altitude" />
          </Field>
        </div>
      </fieldset>

      <fieldset className="flex min-w-0 flex-col gap-3" data-testid="plan-flags">
        <legend className="mb-1 w-full border-b border-rule pb-1.5 text-sm font-medium text-ink">飛行の方法・空域</legend>
        <p className="text-xs leading-relaxed text-ink-mute">DID（人口集中地区）と空港等周辺は、地点から判定が導きます。ここでは選びません。</p>
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {PLAN_FLAG_CHOICES.map((c) => (
            <label key={c.value} className={planCheckRow}>
              <input type="checkbox" className={planCheckbox} checked={v.flags.includes(c.value)} onChange={() => set("flags", toggle(v.flags, c.value))} data-testid={`plan-flag-${c.value}`} />
              {SPECIFIC_FLIGHT_FLAG_LABEL[c.value as SpecificFlightFlag]}
            </label>
          ))}
        </div>
        <FormErrorLine message={errors["flags"]} />
      </fieldset>

      <fieldset className="flex min-w-0 flex-col gap-3" data-testid="plan-permits">
        <legend className="mb-1 w-full border-b border-rule pb-1.5 text-sm font-medium text-ink">取得済みの許可・承認・同意</legend>
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {PLAN_PERMIT_CHOICES.map((c) => (
            <label key={c.value} className={planCheckRow}>
              <input type="checkbox" className={planCheckbox} checked={v.permits.includes(c.value)} onChange={() => set("permits", toggle(v.permits, c.value))} data-testid={`plan-permit-${c.value}`} />
              {c.label}
            </label>
          ))}
        </div>
        <FormErrorLine message={errors["pilotPermits"]} />
        <p className="text-xs leading-relaxed text-ink-mute">許可の範囲と有効期間は照合していません。許可書で確認してください。</p>
      </fieldset>

      <section className="flex flex-col gap-4" aria-label="判定の条件">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="運航の目的（例外）" required={false} error={errors["judgementPurpose"]} hint="史跡・公園・県条例の例外節と照合します。">
            <select className={selectClass} value={v.judgementPurpose} onChange={(e) => set("judgementPurpose", e.target.value)} data-testid="plan-judgement-purpose">
              {PLAN_PURPOSE_CHOICES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="立入管理措置／第三者上空" required={false} error={errors["accessControl"]}>
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
          <Field label="目視外飛行の補助者" required={false} error={errors["bvlosWithObserver"]}>
            <select className={selectClass} value={v.observer} onChange={(e) => set("observer", e.target.value)} data-testid="plan-observer">
              {PLAN_OBSERVER_CHOICES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
        <Field label="許可・承認の番号" required={false} error={errors["permitNumbers"]} hint="手入力の文字（200 文字以内）。">
          <input className={`${inputClass} min-h-12`} value={v.permitNumbers} onChange={(e) => set("permitNumbers", e.target.value)} data-testid="plan-permit-numbers" />
        </Field>
        <Field label="メモ" required={false} error={errors["notes"]} hint="500 文字以内">
          <textarea className={inputClass} rows={3} value={v.notes} onChange={(e) => set("notes", e.target.value)} data-testid="plan-notes" />
        </Field>
        {isEdit ? (
          <Field label="訂正の理由" required error={errors["reason"]} hint="版の一覧に残ります。">
            <textarea className={inputClass} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="plan-reason" />
          </Field>
        ) : null}
      </section>

      <SubmitRow message={message}>
        <button type="submit" className={buttonPrimaryClass} disabled={busy} data-testid="plan-submit">
          {isEdit ? "訂正を保存する" : "計画を保存する"}
        </button>
        {busy ? (
          <span role="status" className="text-sm text-ink-soft" data-testid="plan-judging">
            判定中…（サーバーで判定を実行して保存します）
          </span>
        ) : (
          <span className="text-xs text-ink-mute">保存すると、サーバーが判定を実行し、その結果を判定の根拠として残します。</span>
        )}
      </SubmitRow>
    </form>
  );
}

const FormErrorLine = ({ message }: { readonly message?: string }) =>
  message ? (
    <span role="alert" className="text-xs leading-relaxed text-signal-red">
      <span aria-hidden>! </span>
      {message}
    </span>
  ) : null;

// ---- 確認の依頼・再判定・確認 ----------------------------------

/** 確認を依頼する（下書き → 確認待ち）。 */
export function RequestConfirmationButton({ planId, version }: { readonly planId: string; readonly version: number }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const onClick = async () => {
    setBusy(true);
    setMessage(null);
    const r = await call("POST", `/api/ops/plans/${planId}/request-confirmation`, { expectedVersion: version });
    setBusy(false);
    if (!r.ok) {
      setMessage(failMessage(r));
      return;
    }
    reloadAfterChange({ target: VERSION_NOTICE_TARGET, message: `${versionOf(r)}確認を依頼しました。` });
  };
  return (
    <div className="flex flex-col gap-2">
      <button type="button" className={buttonOutlineBrandClass} onClick={() => void onClick()} disabled={busy} data-testid="plan-request-confirmation">
        確認を依頼する
      </button>
      <FormError message={message} />
    </div>
  );
}

/** 判定をやり直す（新しいスナップショットと、計画の新しい版ができる）。 */
export function RejudgeButton({ planId, version, highlight }: { readonly planId: string; readonly version: number; readonly highlight?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const onClick = async () => {
    setBusy(true);
    setMessage(null);
    const r = await call("POST", `/api/ops/plans/${planId}/rejudge`, { expectedVersion: version });
    setBusy(false);
    if (!r.ok) {
      setMessage(failMessage(r));
      return;
    }
    reloadAfterChange({ target: VERSION_NOTICE_TARGET, message: `${versionOf(r)}判定をやり直しました。前の判定は履歴に残っています。` });
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={highlight ? buttonPrimaryClass : buttonOutlineBrandClass} onClick={() => void onClick()} disabled={busy} data-testid="plan-rejudge">
          判定をやり直す
        </button>
        {busy ? (
          <span role="status" className="text-xs text-ink-soft" data-testid="plan-judging">
            判定中…
          </span>
        ) : null}
      </div>
      <FormError message={message} />
    </div>
  );
}

/** 運航管理者の確認・差し戻し。差し戻しは理由が必須。 */
export function ConfirmPanel({ planId, version, stale }: { readonly planId: string; readonly version: number; readonly stale: boolean }) {
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { formRef, requestErrorFocus } = useErrorFocus();
  const submit = async (decision: "approved" | "returned") => {
    setBusy(true);
    setMessage(null);
    const r = await call("POST", `/api/ops/plans/${planId}/confirmations`, { decision, reason, expectedVersion: version });
    setBusy(false);
    if (!r.ok) {
      setErrors(fieldErrorsOf(r));
      setMessage(failMessage(r));
      requestErrorFocus();
      return;
    }
    reloadAfterChange({ target: "confirmations", message: decision === "approved" ? "確認を記録しました。" : "差し戻しを記録しました。" });
  };
  return (
    <form
      ref={formRef}
      onSubmit={(e) => e.preventDefault()}
      className="flex flex-col gap-3 rounded-sharp border border-brand-500 bg-paper px-3 py-3 sm:px-4"
      aria-label="確認・差し戻し"
      data-testid="plan-confirm-panel"
    >
      {stale ? (
        <p className="border-l-2 border-signal-amber pl-3 text-xs leading-relaxed text-ink-soft">
          判定が古くなっています。確認の前に「判定をやり直す」ことをお勧めします（やり直すと計画の版が上がり、確認は新しい版に対して行います）。
        </p>
      ) : null}
      <Field label="理由" required={false} error={errors["reason"]} hint="差し戻しのときは必須です（500 文字以内）。">
        <textarea className={inputClass} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="plan-confirm-reason" />
      </Field>
      <FormError message={message} />
      <div className="grid grid-cols-2 gap-3 sm:flex sm:flex-wrap sm:items-center">
        <button type="button" className={buttonPrimaryClass} disabled={busy} onClick={() => void submit("approved")} data-testid="plan-confirm-approve">
          確認する
        </button>
        <button type="button" className={buttonDangerClass} disabled={busy} onClick={() => void submit("returned")} data-testid="plan-confirm-return">
          差し戻す
        </button>
      </div>
    </form>
  );
}

// ---- よく使う地点 ----------------------------------------------

export type PlaceFormValue = {
  readonly id?: string;
  readonly version?: number;
  readonly name: string;
  readonly addressText: string | null;
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly note: string | null;
};

export function PlaceForm({ initial }: { readonly initial?: PlaceFormValue }) {
  const editing = initial?.id !== undefined;
  const [v, setV] = useState({
    name: initial?.name ?? "",
    addressText: initial?.addressText ?? "",
    lat: initial?.latitude === null || initial?.latitude === undefined ? "" : String(initial.latitude),
    lng: initial?.longitude === null || initial?.longitude === undefined ? "" : String(initial.longitude),
    note: initial?.note ?? "",
    reason: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { formRef, requestErrorFocus } = useErrorFocus();
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });
  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    const body = {
      name: v.name,
      addressText: v.addressText.trim() === "" ? null : v.addressText,
      latitude: v.lat.trim() === "" ? null : v.lat.trim(),
      longitude: v.lng.trim() === "" ? null : v.lng.trim(),
      note: v.note.trim() === "" ? null : v.note,
      ...(editing ? { expectedVersion: initial!.version, reason: v.reason } : {}),
    };
    const r = editing ? await call("PATCH", `/api/ops/places/${initial!.id}`, body) : await call("POST", "/api/ops/places", body);
    setBusy(false);
    if (!r.ok) {
      setErrors(fieldErrorsOf(r));
      setMessage(failMessage(r));
      requestErrorFocus();
      return;
    }
    setErrors({});
    if (editing) {
      setV({ ...v, reason: "" });
      reloadAfterChange({ target: VERSION_NOTICE_TARGET, message: `${versionOf(r)}訂正しました。` });
    } else {
      const id = String(r.data["id"]);
      setChangeFlash(`/ops/places/${id}`, VERSION_NOTICE_TARGET, "よく使う地点を登録しました。");
      window.location.assign(`/ops/places/${id}`);
    }
  };
  return (
    <form ref={formRef} onSubmit={onSubmit} className="flex flex-col gap-4" aria-label={editing ? "よく使う地点の訂正" : "よく使う地点の登録"} data-testid="place-form">
      <Field label="名称" required error={errors["name"]} hint="100 文字以内（取消していない地点の中で重複しない名前）">
        <input className={`${inputClass} min-h-12`} value={v.name} onChange={set("name")} data-testid="place-name" />
      </Field>
      <Field label="住所" required={false} error={errors["addressText"]} hint="200 文字以内。表示用の文字です。座標とは別に保存します。">
        <input className={`${inputClass} min-h-12`} value={v.addressText} onChange={set("addressText")} data-testid="place-address" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="緯度" required error={errors["latitude"]} hint="世界測地系（WGS84）、小数 6 桁まで">
          <input inputMode="decimal" className={`${inputClass} min-h-12 font-mono tnum`} value={v.lat} onChange={set("lat")} data-testid="place-lat" />
        </Field>
        <Field label="経度" required error={errors["longitude"]}>
          <input inputMode="decimal" className={`${inputClass} min-h-12 font-mono tnum`} value={v.lng} onChange={set("lng")} data-testid="place-lng" />
        </Field>
      </div>
      <p className="text-xs leading-relaxed text-ink-mute">
        登録する前に、地図で位置を目で確かめてください。座標が実際の位置とずれていると、判定が実際の地点とずれます。
      </p>
      <Field label="メモ" required={false} error={errors["note"]} hint="200 文字以内">
        <textarea className={inputClass} rows={2} value={v.note} onChange={set("note")} data-testid="place-note" />
      </Field>
      {editing ? (
        <Field label="訂正の理由" required error={errors["reason"]} hint="版の一覧に残ります。">
          <textarea className={inputClass} rows={2} value={v.reason} onChange={set("reason")} data-testid="place-reason" />
        </Field>
      ) : null}
      <SubmitRow message={message}>
        <button type="submit" className={buttonPrimaryClass} disabled={busy} data-testid="place-submit">
          {editing ? "訂正を保存する" : "登録する"}
        </button>
        {busy ? <span className="text-xs text-ink-mute">送信しています…</span> : null}
      </SubmitRow>
    </form>
  );
}
