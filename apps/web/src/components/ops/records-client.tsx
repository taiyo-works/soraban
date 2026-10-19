"use client";

// 飛行記録・日常点検記録の入力（Sprint 11 設計 E）。現場（スマートフォン・屋外）での入力を前提にする。
// - 時刻は日本時間の日付と HH:MM で入れる。「今」ボタンは端末の時計の現在の分（秒は切り捨て）を日本時間で入れる。
// - 離陸から着陸までは DB に記録を作らない。入力中の内容は端末のブラウザに下書きとして保ち（drafts.ts）、保存に成功したら消す。
// - 下書きごとの送信の識別子（clientRequestId）を付けて送るため、応答が分からないまま再送しても記録は 2 件にならない。
// - 「現在地」ボタンは押したときだけ端末の位置を 1 回取得する。保存を押すまで送らない（保存すると離着陸場所として記録される）。
// 判断（飛行時間・総飛行時間・認可）はサーバーと DB が行う。ここでの飛行時間の表示は同じ関数（lib/ops-time.ts）で求める。
import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  flightMinutesFromInput,
  formatHm,
  jstDate,
  nowJstInput,
  roundCoordinate,
  TIME_ERROR_MESSAGES,
  type TimeErrorCode,
} from "@/lib/ops-time";
import {
  INSPECTION_ITEMS,
  INSPECTION_TIMING_LABELS,
  SPECIFIC_FLIGHT_TYPES,
  type InspectionItemKey,
  type InspectionResult,
  type InspectionTiming,
} from "@/lib/ops-records";
import { setChangeFlash } from "./change-notice";
import { clearDraft, DRAFT_KEYS, loadDraft, newRequestId, saveDraft } from "./drafts";
import {
  checkboxClass,
  checkRowClass,
  Field,
  FieldError,
  fieldErrorsOf,
  focusFirstError,
  FormError,
  inputClass,
  messageFor,
  reloadAfterChange,
  RequiredTag,
  send,
  versionOf,
  type ApiResult,
} from "./ops-client";
import { buttonGhostClass, buttonPrimaryClass, VERSION_NOTICE_TARGET } from "./ui";

/** 通信できない（fetch が例外）場合も ApiResult にする。status 0。 */
const trySend = async (method: string, url: string, body?: unknown): Promise<ApiResult> => {
  try {
    return await send(method, url, body);
  } catch {
    return { ok: false, status: 0, data: { error: "network" } };
  }
};

const OFFLINE_MESSAGE = "保存できませんでした。通信が戻ったら「再送する」を押してください。入力した内容はこの端末に残っています。";

/** 屋外で押しやすい大きさ（高さ 44px 以上）。 */
const bigButtonClass = `${buttonPrimaryClass} min-h-12 px-6 text-base`;
const nowButtonClass = `${buttonGhostClass} min-h-12 whitespace-nowrap border-brand-700 text-brand-700 font-medium`;

const WARNING_TEXT = {
  no_inspection_on_day: "この機体の、飛行日の日常点検がありません。",
  recent_inspection_abnormal: "この機体の直近の日常点検に「異常」があります。",
  license_expired: "操縦者の技能証明の有効期限が飛行日より前です。",
  aircraft_suspended: "この機体は休止中です。",
} as const;

export type AircraftOption = {
  readonly id: string;
  readonly registrationMark: string;
  readonly modelName: string;
  readonly status: "active" | "suspended" | "deregistered";
};
export type PilotOption = { readonly id: string; readonly fullName: string; readonly licenseExpiresOn: string | null };

type InspectionCandidate = {
  readonly id: string;
  readonly aircraftId: string;
  readonly inspectedAt: string;
  readonly inspectedAtJst: string;
  readonly inspectedDate: string;
  readonly timing: InspectionTiming;
  readonly hasAbnormal: boolean;
  readonly inspectorName: string;
};

// ---- 部品 ----------------------------------------------------

/** 日付と時刻（HH:MM）の入力。「今」ボタン付き。値は日本時間。 */
function DateTimeInput({
  label,
  nowLabel,
  date,
  time,
  onChange,
  error,
  nextDay,
  testId,
}: {
  readonly label: string;
  readonly nowLabel?: string;
  readonly date: string;
  readonly time: string;
  readonly onChange: (date: string, time: string) => void;
  readonly error?: string;
  readonly nextDay?: boolean;
  readonly testId: string;
}) {
  const id = useId();
  const errorId = error ? `${id}-error` : undefined;
  const now = () => {
    const v = nowJstInput(new Date());
    onChange(v.slice(0, 10), v.slice(11, 16));
  };
  return (
    <fieldset className="flex min-w-0 flex-col gap-1.5" data-testid={testId}>
      <legend className="mb-1.5 flex items-center gap-2 text-sm text-ink">
        <span>{label}</span>
        <RequiredTag required />
        {nextDay ? (
          <span className="rounded-sharp border border-signal-amber/60 bg-signal-amber-soft px-1 text-[11px] text-signal-amber" data-testid={`${testId}-next-day`}>
            翌日
          </span>
        ) : null}
      </legend>
      <div className="flex flex-wrap items-center gap-2">
        {nowLabel ? (
          <button type="button" className={nowButtonClass} onClick={now}>
            {nowLabel}
          </button>
        ) : null}
        <input
          type="date"
          aria-label={`${label.replace(/時刻$/, "")}日`}
          aria-invalid={error ? true : undefined}
          aria-describedby={errorId}
          className={`${inputClass.replace("w-full ", "")} tnum w-[10.5rem]`}
          value={date}
          onChange={(e) => onChange(e.target.value, time)}
        />
        <input
          type="time"
          aria-label={label}
          aria-invalid={error ? true : undefined}
          aria-describedby={errorId}
          step={60}
          className={`${inputClass.replace("w-full ", "")} tnum w-[7.5rem]`}
          value={time}
          onChange={(e) => onChange(date, e.target.value)}
        />
      </div>
      <FieldError id={errorId} message={error} />
      <span className="text-xs text-ink-mute">日本時間（24 時間制、分まで）</span>
    </fieldset>
  );
}

type Position = { readonly lat: string; readonly lng: string; readonly acc: string };

/** 場所名と、任意の緯度・経度（世界測地系 WGS84）。「現在地」は押したときだけ 1 回取得する。 */
function PlaceInput({
  label,
  name,
  pos,
  onName,
  onPos,
  errors,
  keys,
}: {
  readonly label: string;
  readonly name: string;
  readonly pos: Position;
  readonly onName: (v: string) => void;
  readonly onPos: (p: Position) => void;
  readonly errors: Record<string, string>;
  readonly keys: { readonly name: string; readonly lat: string; readonly lng: string; readonly acc: string };
}) {
  const [status, setStatus] = useState<string | null>(null);
  const locate = () => {
    if (!("geolocation" in navigator)) {
      setStatus("この端末では現在地を取得できません。");
      return;
    }
    setStatus("現在地を取得しています…");
    navigator.geolocation.getCurrentPosition(
      (p) => {
        onPos({
          lat: String(roundCoordinate(p.coords.latitude)),
          lng: String(roundCoordinate(p.coords.longitude)),
          acc: String(Math.round(p.coords.accuracy)),
        });
        setStatus(`現在地を入れました（精度 約 ${Math.round(p.coords.accuracy)} m）。保存するまで送りません。`);
      },
      () => setStatus("現在地を取得できませんでした。場所名だけでも保存できます。"),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );
  };
  return (
    <div className="flex min-w-0 flex-col gap-3 sm:col-span-2">
      <Field label={label} required error={errors[keys.name]} hint="地名・施設名など、正確な位置が分かる名前（100 文字以内）">
        <input className={inputClass} value={name} onChange={(e) => onName(e.target.value)} />
      </Field>
      <div className="flex flex-col gap-2 border-l-2 border-rule pl-3">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={buttonGhostClass} onClick={locate}>
            現在地を入れる
          </button>
          <span className="text-xs text-ink-mute">緯度・経度（任意）は世界測地系（WGS84）の 10 進度、小数 6 桁まで</span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label={`${label}の緯度`} required={false} error={errors[keys.lat]}>
            <input className={`${inputClass} tnum`} inputMode="decimal" value={pos.lat} onChange={(e) => onPos({ ...pos, lat: e.target.value })} />
          </Field>
          <Field label={`${label}の経度`} required={false} error={errors[keys.lng]}>
            <input className={`${inputClass} tnum`} inputMode="decimal" value={pos.lng} onChange={(e) => onPos({ ...pos, lng: e.target.value })} />
          </Field>
        </div>
        {pos.acc ? <span className="text-xs text-ink-mute">測位の精度：約 {pos.acc} m</span> : null}
        <FieldError message={errors[keys.acc]} />
        {status ? (
          <span role="status" className="text-xs text-ink-soft">
            {status}
          </span>
        ) : null}
        <span className="text-xs leading-relaxed text-ink-mute">
          位置は「保存」を押したときに限り、飛行日誌の記載事項（場所）として送られます。位置を続けて記録することはありません。
        </span>
      </div>
    </div>
  );
}

const posBody = (p: Position) => ({
  lat: p.lat.trim() === "" ? null : p.lat.trim(),
  lng: p.lng.trim() === "" ? null : p.lng.trim(),
  acc: p.acc.trim() === "" ? null : Number(p.acc),
});

const EMPTY_POS: Position = { lat: "", lng: "", acc: "" };
const posOf = (lat: number | null, lng: number | null, acc: number | null): Position => ({
  lat: lat === null ? "" : String(lat),
  lng: lng === null ? "" : String(lng),
  acc: acc === null ? "" : String(acc),
});

function Warnings({ items }: { readonly items: readonly string[] }) {
  if (items.length === 0) return null;
  return (
    <ul data-testid="record-warnings" className="flex flex-col gap-1 rounded-sharp border border-signal-amber/60 bg-signal-amber-soft px-3 py-2 text-sm text-signal-amber">
      {items.map((w) => (
        <li key={w}>
          <span aria-hidden>! </span>
          {w}
          <span className="text-xs text-ink-soft">（保存はできます）</span>
        </li>
      ))}
    </ul>
  );
}

/** 送信の結果のエラーと、通信できなかったときの再送ボタン。 */
function SaveRow({
  message,
  offline,
  busy,
  label,
  onRetry,
  disabled,
  children,
}: {
  readonly message: string | null;
  readonly offline: boolean;
  readonly busy: boolean;
  readonly label: string;
  readonly onRetry: () => void;
  readonly disabled?: boolean;
  readonly children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 border-t border-rule-soft pt-4">
      <FormError message={message} />
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className={bigButtonClass} disabled={busy || disabled}>
          {label}
        </button>
        {offline ? (
          <button type="button" className={`${buttonGhostClass} min-h-12`} onClick={onRetry} disabled={busy}>
            再送する
          </button>
        ) : null}
        {busy ? <span className="text-xs text-ink-mute">送信しています…</span> : null}
        {children}
      </div>
    </div>
  );
}

// ---- 飛行記録 ------------------------------------------------

type DefectState = { occurredOn: string; description: string; actionOn: string; action: string; confirmerName: string };

type FlightState = {
  clientRequestId: string;
  aircraftId: string;
  pilotId: string;
  dailyInspectionId: string;
  takeoffDate: string;
  takeoffTime: string;
  landingDate: string;
  landingTime: string;
  takeoffPlace: string;
  takeoffPos: Position;
  landingPlace: string;
  landingPos: Position;
  purpose: string;
  waypoints: string;
  specificFlightTypes: string[];
  safetyIssue: "" | "no" | "yes";
  safetyIssueDetail: string;
  defects: DefectState[];
};

export type FlightFormInitial = {
  readonly id: string;
  readonly version: number;
  readonly aircraftId: string;
  readonly pilotId: string;
  readonly dailyInspectionId: string | null;
  readonly takeoffAt: string;
  readonly landingAt: string;
  readonly takeoffPlace: string;
  readonly takeoffLat: number | null;
  readonly takeoffLng: number | null;
  readonly takeoffAccuracyM: number | null;
  readonly landingPlace: string;
  readonly landingLat: number | null;
  readonly landingLng: number | null;
  readonly landingAccuracyM: number | null;
  readonly purpose: string;
  readonly waypoints: string | null;
  readonly specificFlightTypes: readonly string[];
  readonly safetyIssue: boolean;
  readonly safetyIssueDetail: string | null;
  readonly defects: readonly {
    readonly occurredOn: string;
    readonly description: string;
    readonly actionOn: string | null;
    readonly action: string | null;
    readonly confirmerName: string | null;
  }[];
};

const emptyFlight = (aircraftId: string, pilotId: string, inspectionId: string): FlightState => ({
  clientRequestId: newRequestId(),
  aircraftId,
  pilotId,
  dailyInspectionId: inspectionId,
  takeoffDate: "",
  takeoffTime: "",
  landingDate: "",
  landingTime: "",
  takeoffPlace: "",
  takeoffPos: EMPTY_POS,
  landingPlace: "",
  landingPos: EMPTY_POS,
  purpose: "",
  waypoints: "",
  specificFlightTypes: [],
  safetyIssue: "",
  safetyIssueDetail: "",
  defects: [],
});

const flightStateFrom = (f: FlightFormInitial): FlightState => ({
  clientRequestId: "",
  aircraftId: f.aircraftId,
  pilotId: f.pilotId,
  dailyInspectionId: f.dailyInspectionId ?? "",
  takeoffDate: f.takeoffAt.slice(0, 10),
  takeoffTime: f.takeoffAt.slice(11, 16),
  landingDate: f.landingAt.slice(0, 10),
  landingTime: f.landingAt.slice(11, 16),
  takeoffPlace: f.takeoffPlace,
  takeoffPos: posOf(f.takeoffLat, f.takeoffLng, f.takeoffAccuracyM),
  landingPlace: f.landingPlace,
  landingPos: posOf(f.landingLat, f.landingLng, f.landingAccuracyM),
  purpose: f.purpose,
  waypoints: f.waypoints ?? "",
  specificFlightTypes: [...f.specificFlightTypes],
  safetyIssue: f.safetyIssue ? "yes" : "no",
  safetyIssueDetail: f.safetyIssueDetail ?? "",
  defects: f.defects.map((d) => ({
    occurredOn: d.occurredOn,
    description: d.description,
    actionOn: d.actionOn ?? "",
    action: d.action ?? "",
    confirmerName: d.confirmerName ?? "",
  })),
});

const joinDt = (d: string, t: string): string => (d && t ? `${d}T${t.slice(0, 5)}` : "");

export function FlightForm({
  aircraft,
  pilots,
  fixedPilotId,
  initialAircraftId,
  initialInspectionId,
  editing,
}: {
  readonly aircraft: readonly AircraftOption[];
  readonly pilots: readonly PilotOption[];
  /** 操縦者役割のとき、自分に結び付いた操縦者（固定）。 */
  readonly fixedPilotId: string | null;
  readonly initialAircraftId?: string;
  readonly initialInspectionId?: string;
  /** 訂正のときの現在の内容（下書きは使わない）。 */
  readonly editing?: FlightFormInitial;
}) {
  const isEdit = editing !== undefined;
  const [v, setV] = useState<FlightState>(() =>
    editing ? flightStateFrom(editing) : emptyFlight(initialAircraftId ?? "", fixedPilotId ?? "", initialInspectionId ?? ""),
  );
  const [loaded, setLoaded] = useState(isEdit);
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [busy, setBusy] = useState(false);
  // 日常点検の候補。どの機体・日の候補かを key で持ち、今の機体・日と違う間は「未取得」とみなす
  const [fetched, setFetched] = useState<{ readonly key: string; readonly list: readonly InspectionCandidate[] } | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  // 下書きの読み込み（新規のときだけ）。点検の画面から来た場合は、その機体・点検を優先する。
  // localStorage はサーバーの描画では読めないため、描画の後に読む（次の処理単位で反映する）。
  useEffect(() => {
    if (isEdit) return;
    const t = window.setTimeout(() => {
      const d = loadDraft<FlightState>(DRAFT_KEYS.flight);
      if (d && typeof d === "object" && typeof d.clientRequestId === "string") {
        setV({
          ...emptyFlight("", fixedPilotId ?? "", ""),
          ...d,
          ...(initialInspectionId ? { aircraftId: initialAircraftId ?? d.aircraftId, dailyInspectionId: initialInspectionId } : {}),
          ...(fixedPilotId ? { pilotId: fixedPilotId } : {}),
        });
      }
      setLoaded(true);
    }, 0);
    return () => window.clearTimeout(t);
    // 初回だけ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 下書きの保存（読み込みの後だけ。読み込み前の空の状態で上書きしない）
  useEffect(() => {
    if (!isEdit && loaded) saveDraft(DRAFT_KEYS.flight, v);
  }, [v, loaded, isEdit]);

  const set = <K extends keyof FlightState>(k: K, value: FlightState[K]) => setV((s) => ({ ...s, [k]: value }));

  const takeoffAt = joinDt(v.takeoffDate, v.takeoffTime);
  const landingAt = joinDt(v.landingDate, v.landingTime);
  const minutes = takeoffAt && landingAt ? flightMinutesFromInput(takeoffAt, landingAt) : null;
  const flightDay = takeoffAt ? v.takeoffDate : loaded ? jstDate(new Date()) : "";

  // 日常点検の候補（同じ機体の、飛行日まで 30 日の点検）。通信できなければ候補なし。
  const candidateKey = loaded && v.aircraftId && flightDay ? `${v.aircraftId}|${flightDay}` : "";
  useEffect(() => {
    if (!candidateKey) return;
    let cancelled = false;
    const [aircraftId, day] = candidateKey.split("|") as [string, string];
    const from = jstDate(new Date(Date.parse(`${day}T00:00:00+09:00`) - 30 * 24 * 3600 * 1000));
    void trySend("GET", `/api/ops/inspections?aircraftId=${aircraftId}&from=${from}&to=${day}`).then((r) => {
      if (cancelled) return;
      const list = r.ok && Array.isArray(r.data["inspections"]) ? (r.data["inspections"] as InspectionCandidate[]) : [];
      setFetched({ key: candidateKey, list });
    });
    return () => {
      cancelled = true;
    };
  }, [candidateKey]);
  const candidates = fetched && fetched.key === candidateKey ? fetched.list : null;

  const sameDay = useMemo(() => (candidates ?? []).filter((c) => c.inspectedDate === flightDay), [candidates, flightDay]);
  const selectedAircraft = aircraft.find((a) => a.id === v.aircraftId);
  const selectedPilot = pilots.find((p) => p.id === v.pilotId);

  const warnings: string[] = [];
  if (v.aircraftId && candidates !== null && sameDay.length === 0) warnings.push(WARNING_TEXT.no_inspection_on_day);
  const latest = (candidates ?? []).find((c) => !takeoffAt || c.inspectedAt <= takeoffAt);
  if (latest?.hasAbnormal) warnings.push(WARNING_TEXT.recent_inspection_abnormal);
  if (selectedPilot?.licenseExpiresOn && flightDay && selectedPilot.licenseExpiresOn < flightDay) warnings.push(WARNING_TEXT.license_expired);
  if (selectedAircraft?.status === "suspended") warnings.push(WARNING_TEXT.aircraft_suspended);

  const body = () => {
    const tp = posBody(v.takeoffPos);
    const lp = posBody(v.landingPos);
    return {
      aircraftId: v.aircraftId || null,
      pilotId: v.pilotId || null,
      dailyInspectionId: v.dailyInspectionId || null,
      purpose: v.purpose,
      waypoints: v.waypoints || null,
      specificFlightTypes: v.specificFlightTypes,
      takeoffPlace: v.takeoffPlace,
      takeoffLat: tp.lat,
      takeoffLng: tp.lng,
      takeoffAccuracyM: tp.acc,
      landingPlace: v.landingPlace,
      landingLat: lp.lat,
      landingLng: lp.lng,
      landingAccuracyM: lp.acc,
      takeoffAt: takeoffAt || null,
      landingAt: landingAt || null,
      safetyIssue: v.safetyIssue === "" ? null : v.safetyIssue === "yes",
      safetyIssueDetail: v.safetyIssue === "yes" ? v.safetyIssueDetail : null,
      defects: v.defects.map((d) => ({
        occurredOn: d.occurredOn,
        description: d.description,
        actionOn: d.actionOn || null,
        action: d.action || null,
        confirmerName: d.confirmerName || null,
      })),
    };
  };

  const submit = async () => {
    setBusy(true);
    setMessage(null);
    const r = isEdit
      ? await trySend("PATCH", `/api/ops/flights/${editing.id}`, { ...body(), expectedVersion: editing.version, reason })
      : await trySend("POST", "/api/ops/flights", { ...body(), clientRequestId: v.clientRequestId });
    setBusy(false);
    if (!r.ok) {
      if (r.status === 0 || r.status === 503 || r.status >= 500) {
        setOffline(true);
        setMessage(OFFLINE_MESSAGE);
      } else {
        setOffline(false);
        setErrors(fieldErrorsOf(r));
        setMessage(messageFor(r));
      }
      focusFirstError(formRef.current);
      return;
    }
    setOffline(false);
    setErrors({});
    const w = Array.isArray(r.data["warnings"]) ? (r.data["warnings"] as (keyof typeof WARNING_TEXT)[]) : [];
    const note = w.length > 0 ? `（注意：${w.map((x) => WARNING_TEXT[x] ?? x).join(" ")}）` : "";
    if (isEdit) {
      setReason("");
      reloadAfterChange({ target: VERSION_NOTICE_TARGET, message: `${versionOf(r)}訂正しました。${note}` });
    } else {
      clearDraft(DRAFT_KEYS.flight);
      const id = String(r.data["id"]);
      setChangeFlash(`/ops/flights/${id}`, VERSION_NOTICE_TARGET, `飛行記録を保存しました。${note}`);
      window.location.assign(`/ops/flights/${id}`);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void submit();
  };

  const timeError = (key: "takeoffAt" | "landingAt"): string | undefined => errors[key];
  const liveMinutesError =
    minutes && !minutes.ok && minutes.code !== "time_format" ? TIME_ERROR_MESSAGES[minutes.code as TimeErrorCode] : null;

  const toggleType = (key: string) =>
    set(
      "specificFlightTypes",
      v.specificFlightTypes.includes(key) ? v.specificFlightTypes.filter((k) => k !== key) : [...v.specificFlightTypes, key],
    );

  const discardDraft = () => {
    clearDraft(DRAFT_KEYS.flight);
    setV(emptyFlight(initialAircraftId ?? "", fixedPilotId ?? "", initialInspectionId ?? ""));
    setErrors({});
    setMessage(null);
    setOffline(false);
  };

  return (
    <form ref={formRef} onSubmit={onSubmit} className="flex flex-col gap-7" aria-label={isEdit ? "飛行記録の訂正" : "飛行記録の入力"}>
      {!isEdit ? (
        <p className="text-xs leading-relaxed text-ink-mute">
          入力中の内容はこの端末に下書きとして残り、再読み込みや通信の切断では消えません。保存すると下書きは消えます。
        </p>
      ) : null}

      <fieldset className="flex min-w-0 flex-col gap-4">
        <legend className="mb-1 font-mono text-[10px] uppercase tracking-wider text-ink-mute">機体・操縦者・日常点検</legend>
        <Field label="機体" required error={errors["aircraftId"]} hint={isEdit ? "機体は訂正で変えられません。誤った場合は取り消して作り直してください。" : undefined}>
          <select
            className={inputClass}
            value={v.aircraftId}
            disabled={isEdit}
            onChange={(e) => setV((s) => ({ ...s, aircraftId: e.target.value, dailyInspectionId: "" }))}
          >
            <option value="">選んでください</option>
            {aircraft.map((a) => (
              <option key={a.id} value={a.id}>
                {a.registrationMark}（{a.modelName}）{a.status === "suspended" ? "［休止］" : ""}
              </option>
            ))}
          </select>
        </Field>
        <Field label="操縦者" required error={errors["pilotId"]} hint={fixedPilotId ? "操縦者の役割では、自分の記録だけを入力できます。" : undefined}>
          <select className={inputClass} value={v.pilotId} disabled={fixedPilotId !== null} onChange={(e) => set("pilotId", e.target.value)}>
            <option value="">選んでください</option>
            {pilots.map((p) => (
              <option key={p.id} value={p.id}>
                {p.fullName}
              </option>
            ))}
          </select>
        </Field>
        <Field label="日常点検" required={false} error={errors["dailyInspectionId"]} hint="同じ機体の、飛行日の点検から選びます。">
          <select className={inputClass} value={v.dailyInspectionId} onChange={(e) => set("dailyInspectionId", e.target.value)} data-testid="inspection-select">
            <option value="">紐付けない</option>
            {(candidates ?? [])
              .filter((c) => c.inspectedDate === flightDay || c.id === v.dailyInspectionId)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.inspectedAtJst} {INSPECTION_TIMING_LABELS[c.timing]}（{c.inspectorName}）{c.hasAbnormal ? "［異常あり］" : ""}
                </option>
              ))}
          </select>
        </Field>
        {v.aircraftId && candidates !== null && sameDay.length === 0 ? (
          <a href={`/ops/inspections/new?aircraftId=${v.aircraftId}`} className="self-start text-sm text-brand-700 underline underline-offset-2">
            日常点検を入力する
          </a>
        ) : null}
        <Warnings items={warnings} />
      </fieldset>

      <fieldset className="flex min-w-0 flex-col gap-4">
        <legend className="mb-1 font-mono text-[10px] uppercase tracking-wider text-ink-mute">離陸</legend>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <PlaceInput
            label="離陸場所"
            name={v.takeoffPlace}
            pos={v.takeoffPos}
            onName={(x) => set("takeoffPlace", x)}
            onPos={(p) => set("takeoffPos", p)}
            errors={errors}
            keys={{ name: "takeoffPlace", lat: "takeoffLat", lng: "takeoffLng", acc: "takeoffAccuracyM" }}
          />
        </div>
        <DateTimeInput
          label="離陸時刻"
          nowLabel="離陸：今"
          testId="takeoff"
          date={v.takeoffDate}
          time={v.takeoffTime}
          error={timeError("takeoffAt")}
          onChange={(d, t) => setV((s) => ({ ...s, takeoffDate: d, takeoffTime: t, landingDate: s.landingDate || d }))}
        />
      </fieldset>

      <fieldset className="flex min-w-0 flex-col gap-4">
        <legend className="mb-1 font-mono text-[10px] uppercase tracking-wider text-ink-mute">着陸</legend>
        <DateTimeInput
          label="着陸時刻"
          nowLabel="着陸：今"
          testId="landing"
          date={v.landingDate}
          time={v.landingTime}
          error={timeError("landingAt")}
          nextDay={Boolean(v.takeoffDate && v.landingDate && v.landingDate > v.takeoffDate)}
          onChange={(d, t) => setV((s) => ({ ...s, landingDate: d, landingTime: t }))}
        />
        <p className="flex flex-wrap items-baseline gap-x-2 text-sm text-ink" aria-live="polite">
          <span className="text-xs text-ink-mute">飛行時間</span>
          {minutes && minutes.ok ? (
            <>
              <span className="font-mono text-xl tnum" data-testid="flight-minutes">
                {formatHm(minutes.minutes)}
              </span>
              {minutes.roundedUp ? <span className="text-xs text-ink-soft">（1 分未満は切り上げ）</span> : null}
            </>
          ) : (
            <span className="text-ink-mute" data-testid="flight-minutes">
              —
            </span>
          )}
          {liveMinutesError ? <span className="text-xs text-signal-red">{liveMinutesError}</span> : null}
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <PlaceInput
            label="着陸場所"
            name={v.landingPlace}
            pos={v.landingPos}
            onName={(x) => set("landingPlace", x)}
            onPos={(p) => set("landingPos", p)}
            errors={errors}
            keys={{ name: "landingPlace", lat: "landingLat", lng: "landingLng", acc: "landingAccuracyM" }}
          />
        </div>
        {v.takeoffPlace && !v.landingPlace ? (
          <button type="button" className={`${buttonGhostClass} self-start`} onClick={() => setV((s) => ({ ...s, landingPlace: s.takeoffPlace, landingPos: s.takeoffPos }))}>
            離陸場所と同じ
          </button>
        ) : null}
      </fieldset>

      <fieldset className="flex min-w-0 flex-col gap-4">
        <legend className="mb-1 font-mono text-[10px] uppercase tracking-wider text-ink-mute">飛行概要</legend>
        <Field label="飛行の目的" required error={errors["purpose"]} hint="例：空撮、インフラ点検、測量（100 文字以内）">
          <input className={inputClass} value={v.purpose} onChange={(e) => set("purpose", e.target.value)} />
        </Field>
        <Field label="経由地" required={false} error={errors["waypoints"]} hint="電源を切らずに経由した場所（200 文字以内）">
          <input className={inputClass} value={v.waypoints} onChange={(e) => set("waypoints", e.target.value)} />
        </Field>
        <fieldset className="flex min-w-0 flex-col gap-1">
          <legend className="mb-1 text-sm text-ink">特定飛行の形態（該当するものをすべて選ぶ。なければ選ばない）</legend>
          <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
            {SPECIFIC_FLIGHT_TYPES.map((t) => (
              <label key={t.key} className={checkRowClass}>
                <input type="checkbox" className={checkboxClass} checked={v.specificFlightTypes.includes(t.key)} onChange={() => toggleType(t.key)} />
                {t.label}
              </label>
            ))}
          </div>
          <FieldError message={errors["specificFlightTypes"]} />
        </fieldset>
      </fieldset>

      <fieldset className="flex min-w-0 flex-col gap-3">
        <legend className="mb-1 flex items-center gap-2 text-sm text-ink">
          <span>飛行の安全に影響のあった事項</span>
          <RequiredTag required />
        </legend>
        <div
          className="flex flex-wrap gap-x-6"
          role="radiogroup"
          tabIndex={-1}
          aria-label="飛行の安全に影響のあった事項の有無"
          aria-invalid={errors["safetyIssue"] ? true : undefined}
        >
          {(
            [
              ["no", "なし"],
              ["yes", "あり"],
            ] as const
          ).map(([val, label]) => (
            <label key={val} className={checkRowClass}>
              <input
                type="radio"
                name="safetyIssue"
                className={checkboxClass}
                checked={v.safetyIssue === val}
                onChange={() => set("safetyIssue", val)}
              />
              {label}
            </label>
          ))}
        </div>
        <FieldError message={errors["safetyIssue"]} />
        {v.safetyIssue === "yes" ? (
          <Field label="影響のあった事項の内容" required error={errors["safetyIssueDetail"]} hint="飛行前後の機体の状況も含めて（500 文字以内）">
            <textarea className={inputClass} rows={3} value={v.safetyIssueDetail} onChange={(e) => set("safetyIssueDetail", e.target.value)} />
          </Field>
        ) : null}
      </fieldset>

      <fieldset className="flex min-w-0 flex-col gap-3">
        <legend className="mb-1 text-sm text-ink">不具合（記事）</legend>
        {v.defects.map((d, i) => {
          const upd = (k: keyof DefectState, val: string) =>
            set(
              "defects",
              v.defects.map((x, j) => (j === i ? { ...x, [k]: val } : x)),
            );
          return (
            <div key={i} className="grid grid-cols-1 gap-3 border-l-2 border-rule pl-3 sm:grid-cols-2" data-testid="defect-row">
              <Field label={`不具合 ${i + 1} の発生日`} required error={errors[`defects.${i}.occurredOn`]}>
                <input type="date" className={`${inputClass} tnum`} value={d.occurredOn} onChange={(e) => upd("occurredOn", e.target.value)} />
              </Field>
              <Field label={`不具合 ${i + 1} の不具合事項`} required error={errors[`defects.${i}.description`]}>
                <input className={inputClass} value={d.description} onChange={(e) => upd("description", e.target.value)} />
              </Field>
              <Field label={`不具合 ${i + 1} の処置日`} required={false} error={errors[`defects.${i}.actionOn`]}>
                <input type="date" className={`${inputClass} tnum`} value={d.actionOn} onChange={(e) => upd("actionOn", e.target.value)} />
              </Field>
              <Field label={`不具合 ${i + 1} の処置その他`} required={false} error={errors[`defects.${i}.action`]}>
                <input className={inputClass} value={d.action} onChange={(e) => upd("action", e.target.value)} />
              </Field>
              <Field label={`不具合 ${i + 1} の確認者の氏名`} required={false} error={errors[`defects.${i}.confirmerName`]}>
                <input className={inputClass} value={d.confirmerName} onChange={(e) => upd("confirmerName", e.target.value)} />
              </Field>
              <button
                type="button"
                className={`${buttonGhostClass} self-end`}
                onClick={() => set("defects", v.defects.filter((_, j) => j !== i))}
              >
                不具合 {i + 1} を外す
              </button>
            </div>
          );
        })}
        <button
          type="button"
          className={`${buttonGhostClass} self-start`}
          onClick={() =>
            set("defects", [...v.defects, { occurredOn: v.takeoffDate, description: "", actionOn: "", action: "", confirmerName: "" }])
          }
        >
          不具合を加える
        </button>
      </fieldset>

      {isEdit ? (
        <Field label="訂正の理由" required error={errors["reason"]} hint="版の一覧に、訂正した人・日時とともに残ります。">
          <textarea className={inputClass} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      ) : null}

      <SaveRow message={message} offline={offline} busy={busy} label={isEdit ? "訂正する" : "保存"} onRetry={() => void submit()}>
        {!isEdit ? (
          <button type="button" className={`${buttonGhostClass} ml-auto`} onClick={discardDraft}>
            下書きを消す
          </button>
        ) : null}
      </SaveRow>
    </form>
  );
}

// ---- 日常点検記録 --------------------------------------------

type ItemState = { result: "" | InspectionResult; note: string };

type InspectionState = {
  clientRequestId: string;
  aircraftId: string;
  pilotId: string;
  date: string;
  time: string;
  timing: InspectionTiming;
  placeName: string;
  pos: Position;
  items: Record<InspectionItemKey, ItemState>;
  specialNotes: string;
};

export type InspectionFormInitial = {
  readonly id: string;
  readonly version: number;
  readonly aircraftId: string;
  readonly pilotId: string;
  readonly inspectedAt: string;
  readonly timing: InspectionTiming;
  readonly placeName: string;
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly accuracyM: number | null;
  readonly items: readonly { readonly key: InspectionItemKey; readonly result: InspectionResult; readonly note: string | null }[];
  readonly specialNotes: string | null;
};

const emptyItems = (): Record<InspectionItemKey, ItemState> =>
  Object.fromEntries(INSPECTION_ITEMS.map((it) => [it.key, { result: "", note: "" }])) as Record<InspectionItemKey, ItemState>;

const emptyInspection = (aircraftId: string, pilotId: string): InspectionState => ({
  clientRequestId: newRequestId(),
  aircraftId,
  pilotId,
  date: "",
  time: "",
  timing: "pre_flight",
  placeName: "",
  pos: EMPTY_POS,
  items: emptyItems(),
  specialNotes: "",
});

export function InspectionForm({
  aircraft,
  pilots,
  fixedPilotId,
  initialAircraftId,
  editing,
}: {
  readonly aircraft: readonly AircraftOption[];
  readonly pilots: readonly PilotOption[];
  readonly fixedPilotId: string | null;
  readonly initialAircraftId?: string;
  readonly editing?: InspectionFormInitial;
}) {
  const isEdit = editing !== undefined;
  const [v, setV] = useState<InspectionState>(() =>
    editing
      ? {
          clientRequestId: "",
          aircraftId: editing.aircraftId,
          pilotId: editing.pilotId,
          date: editing.inspectedAt.slice(0, 10),
          time: editing.inspectedAt.slice(11, 16),
          timing: editing.timing,
          placeName: editing.placeName,
          pos: posOf(editing.latitude, editing.longitude, editing.accuracyM),
          items: Object.fromEntries(editing.items.map((it) => [it.key, { result: it.result, note: it.note ?? "" }])) as Record<
            InspectionItemKey,
            ItemState
          >,
          specialNotes: editing.specialNotes ?? "",
        }
      : emptyInspection(initialAircraftId ?? "", fixedPilotId ?? ""),
  );
  const [loaded, setLoaded] = useState(isEdit);
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [busy, setBusy] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  // 下書きの読み込み。無ければ実施日時の既定を「今」にする（端末の時計。描画の後に行う）。
  useEffect(() => {
    if (isEdit) return;
    const t = window.setTimeout(() => {
      const d = loadDraft<InspectionState>(DRAFT_KEYS.inspection);
      const now = nowJstInput(new Date());
      if (d && typeof d === "object" && typeof d.clientRequestId === "string" && d.items) {
        setV({
          ...emptyInspection("", fixedPilotId ?? ""),
          ...d,
          ...(initialAircraftId ? { aircraftId: initialAircraftId } : {}),
          ...(fixedPilotId ? { pilotId: fixedPilotId } : {}),
        });
      } else {
        setV((s) => ({ ...s, date: now.slice(0, 10), time: now.slice(11, 16) }));
      }
      setLoaded(true);
    }, 0);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!isEdit && loaded) saveDraft(DRAFT_KEYS.inspection, v);
  }, [v, loaded, isEdit]);

  const set = <K extends keyof InspectionState>(k: K, value: InspectionState[K]) => setV((s) => ({ ...s, [k]: value }));
  const setItem = (key: InspectionItemKey, patch: Partial<ItemState>) =>
    setV((s) => ({ ...s, items: { ...s.items, [key]: { ...s.items[key], ...patch } } }));
  const allSelected = INSPECTION_ITEMS.every((it) => v.items[it.key].result !== "");
  const selectedAircraft = aircraft.find((a) => a.id === v.aircraftId);

  const submit = async () => {
    setBusy(true);
    setMessage(null);
    const p = posBody(v.pos);
    const body = {
      aircraftId: v.aircraftId || null,
      pilotId: v.pilotId || null,
      inspectedAt: joinDt(v.date, v.time) || null,
      timing: v.timing,
      placeName: v.placeName,
      latitude: p.lat,
      longitude: p.lng,
      accuracyM: p.acc,
      items: Object.fromEntries(
        INSPECTION_ITEMS.map((it) => [it.key, { result: v.items[it.key].result || null, note: v.items[it.key].note || null }]),
      ),
      specialNotes: v.specialNotes || null,
    };
    const r = isEdit
      ? await trySend("PATCH", `/api/ops/inspections/${editing.id}`, { ...body, expectedVersion: editing.version, reason })
      : await trySend("POST", "/api/ops/inspections", { ...body, clientRequestId: v.clientRequestId });
    setBusy(false);
    if (!r.ok) {
      if (r.status === 0 || r.status >= 500) {
        setOffline(true);
        setMessage(OFFLINE_MESSAGE);
      } else {
        setOffline(false);
        setErrors(fieldErrorsOf(r));
        setMessage(messageFor(r));
      }
      focusFirstError(formRef.current);
      return;
    }
    setOffline(false);
    setErrors({});
    if (isEdit) {
      setReason("");
      reloadAfterChange({ target: VERSION_NOTICE_TARGET, message: `${versionOf(r)}訂正しました。` });
    } else {
      clearDraft(DRAFT_KEYS.inspection);
      const id = String(r.data["id"]);
      setChangeFlash(`/ops/inspections/${id}`, VERSION_NOTICE_TARGET, "日常点検を保存しました。");
      window.location.assign(`/ops/inspections/${id}`);
    }
  };

  return (
    <form
      ref={formRef}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="flex flex-col gap-7"
      aria-label={isEdit ? "日常点検の訂正" : "日常点検の入力"}
    >
      <fieldset className="flex min-w-0 flex-col gap-4">
        <legend className="mb-1 font-mono text-[10px] uppercase tracking-wider text-ink-mute">機体・実施者・日時・場所</legend>
        <Field label="機体" required error={errors["aircraftId"]} hint={isEdit ? "機体は訂正で変えられません。" : undefined}>
          <select className={inputClass} value={v.aircraftId} disabled={isEdit} onChange={(e) => set("aircraftId", e.target.value)}>
            <option value="">選んでください</option>
            {aircraft.map((a) => (
              <option key={a.id} value={a.id}>
                {a.registrationMark}（{a.modelName}）{a.status === "suspended" ? "［休止］" : ""}
              </option>
            ))}
          </select>
        </Field>
        {selectedAircraft?.status === "suspended" ? <Warnings items={[WARNING_TEXT.aircraft_suspended]} /> : null}
        <Field label="実施者" required error={errors["pilotId"]}>
          <select className={inputClass} value={v.pilotId} disabled={fixedPilotId !== null} onChange={(e) => set("pilotId", e.target.value)}>
            <option value="">選んでください</option>
            {pilots.map((p) => (
              <option key={p.id} value={p.id}>
                {p.fullName}
              </option>
            ))}
          </select>
        </Field>
        <DateTimeInput
          label="実施時刻"
          nowLabel="今"
          testId="inspected"
          date={v.date}
          time={v.time}
          error={errors["inspectedAt"]}
          onChange={(d, t) => setV((s) => ({ ...s, date: d, time: t }))}
        />
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 text-sm text-ink">区分</legend>
          <div className="flex flex-wrap gap-x-6">
            {(["pre_flight", "post_flight"] as const).map((t) => (
              <label key={t} className={checkRowClass}>
                <input type="radio" name="timing" className={checkboxClass} checked={v.timing === t} onChange={() => set("timing", t)} />
                {INSPECTION_TIMING_LABELS[t]}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <PlaceInput
            label="実施場所"
            name={v.placeName}
            pos={v.pos}
            onName={(x) => set("placeName", x)}
            onPos={(p) => set("pos", p)}
            errors={errors}
            keys={{ name: "placeName", lat: "latitude", lng: "longitude", acc: "accuracyM" }}
          />
        </div>
      </fieldset>

      <fieldset className="flex min-w-0 flex-col gap-3">
        <legend className="mb-1 flex flex-wrap items-center gap-2 text-sm text-ink">
          <span>点検項目（様式2）</span>
          <RequiredTag required />
        </legend>
        <p className="text-xs leading-relaxed text-ink-mute">
          9 項目すべてで「正常」「異常」のどちらかを選ぶと保存できます。具体的な点検内容は機体の取扱説明書によります。「異常」の項目は備考が必須です。
        </p>
        <button
          type="button"
          className={`${bigButtonClass} self-start`}
          onClick={() =>
            setV((s) => ({
              ...s,
              items: Object.fromEntries(INSPECTION_ITEMS.map((it) => [it.key, { result: "normal", note: s.items[it.key].note }])) as Record<
                InspectionItemKey,
                ItemState
              >,
            }))
          }
        >
          すべて正常
        </button>
        <ol className="flex flex-col border-t border-rule">
          {INSPECTION_ITEMS.map((it, i) => {
            const st = v.items[it.key];
            const resultError = errors[`items.${it.key}`];
            const noteError = errors[`items.${it.key}.note`];
            return (
              <li key={it.key} className="flex flex-col gap-2 border-b border-rule-soft py-3" data-testid={`inspection-item-${it.key}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm text-ink">
                    <span className="mr-2 font-mono text-xs tnum text-ink-mute">{String(i + 1).padStart(2, "0")}</span>
                    {it.label}
                  </span>
                  <div
                    className="flex gap-x-4"
                    role="radiogroup"
                    tabIndex={-1}
                    aria-label={`${it.label}の結果`}
                    aria-invalid={resultError ? true : undefined}
                  >
                    {(["normal", "abnormal"] as const).map((r) => (
                      <label key={r} className={checkRowClass}>
                        <input
                          type="radio"
                          name={`item-${it.key}`}
                          className={checkboxClass}
                          checked={st.result === r}
                          onChange={() => setItem(it.key, { result: r })}
                        />
                        {r === "normal" ? "正常" : "異常"}
                      </label>
                    ))}
                  </div>
                </div>
                <FieldError message={resultError} />
                {st.result === "abnormal" || st.note || noteError ? (
                  <Field label={`${it.label}の備考`} required={st.result === "abnormal"} error={noteError}>
                    <input className={inputClass} value={st.note} onChange={(e) => setItem(it.key, { note: e.target.value })} />
                  </Field>
                ) : null}
              </li>
            );
          })}
        </ol>
      </fieldset>

      <Field label="特記事項" required={false} error={errors["specialNotes"]} hint="取扱説明書の追加の点検項目など（500 文字以内）">
        <textarea className={inputClass} rows={2} value={v.specialNotes} onChange={(e) => set("specialNotes", e.target.value)} />
      </Field>

      {isEdit ? (
        <Field label="訂正の理由" required error={errors["reason"]} hint="版の一覧に、訂正した人・日時とともに残ります。">
          <textarea className={inputClass} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      ) : null}

      <SaveRow
        message={message}
        offline={offline}
        busy={busy}
        label={isEdit ? "訂正する" : "保存"}
        onRetry={() => void submit()}
        disabled={!allSelected}
      >
        {!allSelected ? <span className="text-xs text-ink-mute">9 項目すべてを選ぶと保存できます</span> : null}
      </SaveRow>
    </form>
  );
}
