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
import { clearDraft, clearOtherUsersDrafts, draftKey, loadDraft, newRequestId, saveDraft } from "./drafts";
import {
  Field,
  FieldError,
  fieldErrorsOf,
  useErrorFocus,
  FormError,
  inputClass,
  messageFor,
  reloadAfterChange,
  RequiredTag,
  send,
  versionOf,
  type ApiResult,
} from "./ops-client";
import { Badge, buttonFieldClass, buttonGhostClass, buttonOutlineBrandClass, VERSION_NOTICE_TARGET } from "./ui";

/** 通信できない（fetch が例外）場合も ApiResult にする。status 0。 */
const trySend = async (method: string, url: string, body?: unknown): Promise<ApiResult> => {
  try {
    return await send(method, url, body);
  } catch {
    return { ok: false, status: 0, data: { error: "network" } };
  }
};

const OFFLINE_MESSAGE = "保存できませんでした。通信が戻ったら「再送する」を押してください。入力した内容はこの端末に残っています。";

/** 屋外で押しやすい大きさ（高さ 44px 以上。手袋でも押せるよう、主な操作は 48〜56px にする）。 */
const bigButtonClass = buttonFieldClass;
const nowButtonClass = `${buttonOutlineBrandClass
  .replace("min-h-11", "min-h-14")
  .replace("px-4", "px-5")
  .replace("text-sm", "text-base")
  .replace("border border-brand-700", "border-2 border-brand-700")} w-full whitespace-nowrap sm:w-auto sm:min-w-[9rem]`;
const tallGhostClass = buttonGhostClass.replace("min-h-11", "min-h-12");
const smallGhostClass = buttonGhostClass.replace("px-4", "px-3").replace("text-sm", "text-xs");

/** 2 択・多択の選択肢（ラジオ・チェックボックスを枠付きの押しやすい大きさにする）。状態は文字と印で示し、色は補助。 */
const choiceClass = (checked: boolean, tone: "brand" | "red" = "brand") =>
  `flex min-h-12 min-w-0 cursor-pointer items-center gap-2.5 rounded-sharp border px-3.5 text-sm transition-colors ${
    checked
      ? tone === "red"
        ? "border-signal-red bg-signal-red-soft font-medium text-signal-red"
        : "border-brand-700 bg-brand-50 font-medium text-brand-900"
      : "border-rule bg-paper text-ink-soft hover:border-ink-soft"
  }`;
const choiceInputClass = "h-5 w-5 shrink-0 cursor-pointer";
const brandAccent = "accent-brand-700";

/**
 * 入力の段（番号と見出し）。判定画面の節見出しと同じく罫線の上に見出しを置く。
 * fieldset の名前は legend（読み上げ用）で付け、見た目の見出しは読ませない。
 */
function Step({ no, title, children }: { readonly no: string; readonly title: string; readonly children: ReactNode }) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-4 border-t border-rule pt-3">
      <legend className="sr-only">{title}</legend>
      <div aria-hidden className="flex items-baseline gap-2.5">
        <span className="font-mono text-[11px] tnum text-ink-mute">{no}</span>
        <span className="font-display text-lg font-light text-ink">{title}</span>
      </div>
      {children}
    </fieldset>
  );
}

/** 小さな見出し付きの選択肢のまとまり（安全に影響のあった事項・区分など）。 */
function ChoiceGroup({
  legend,
  required,
  error,
  children,
  columns = 2,
  radiogroupLabel,
}: {
  readonly legend: string;
  readonly required?: boolean;
  readonly error?: string;
  readonly children: ReactNode;
  readonly columns?: 2 | 1;
  /** ラジオのまとまりの読み上げ名。渡すと role="radiogroup" にし、誤りのときにフォーカスを移せるようにする。 */
  readonly radiogroupLabel?: string;
}) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-2">
      <legend className="mb-1.5 flex items-center gap-2 text-sm text-ink">
        <span>{legend}</span>
        <RequiredTag required={required} />
      </legend>
      <div
        className={`grid gap-2 rounded-sharp outline-none focus-visible:ring-2 focus-visible:ring-brand-700 ${
          columns === 2 ? "grid-cols-2 sm:max-w-sm" : "grid-cols-1 sm:grid-cols-2"
        }`}
        {...(radiogroupLabel
          ? { role: "radiogroup", tabIndex: -1, "aria-label": radiogroupLabel, "aria-invalid": error ? true : undefined }
          : {})}
      >
        {children}
      </div>
      <FieldError message={error} />
    </fieldset>
  );
}

const WARNING_TEXT = {
  no_inspection_on_day: "この機体の、飛行日の日常点検がありません。",
  inspections_unavailable: "日常点検の候補を取得できません（通信を確かめてください）。点検の有無は確かめられていません。",
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
  onNow,
  stale,
}: {
  readonly label: string;
  readonly nowLabel?: string;
  readonly date: string;
  readonly time: string;
  readonly onChange: (date: string, time: string) => void;
  readonly error?: string;
  readonly nextDay?: boolean;
  readonly testId: string;
  /** 「今」を押したとき（省略時は onChange）。手で入れた値と区別する場合に渡す。 */
  readonly onNow?: (date: string, time: string) => void;
  /** 前回の入力の続きで、日時が今日でない（目立たせる）。 */
  readonly stale?: boolean;
}) {
  const id = useId();
  const errorId = error ? `${id}-error` : undefined;
  const hintId = `${id}-hint`;
  const describedBy = [errorId, hintId].filter(Boolean).join(" ");
  const now = () => {
    const v = nowJstInput(new Date());
    (onNow ?? onChange)(v.slice(0, 10), v.slice(11, 16));
  };
  return (
    <fieldset className="flex min-w-0 flex-col gap-2" data-testid={testId}>
      <legend className="mb-1.5 flex items-center gap-2 text-sm text-ink">
        <span>{label}</span>
        <RequiredTag required />
        {nextDay ? <Badge tone="amber" data-testid={`${testId}-next-day`}>翌日</Badge> : null}
        {stale ? <Badge tone="amber" data-testid={`${testId}-stale`}>前回の入力のまま</Badge> : null}
      </legend>
      {/* 狭い画面：「今」を 1 行で大きく、その下に日付と時刻を 2 列。広い画面：1 行に並べる。 */}
      <div className="grid min-w-0 grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
        {nowLabel ? (
          <button type="button" className={`${nowButtonClass} col-span-2`} onClick={now}>
            {nowLabel}
          </button>
        ) : null}
        <input
          type="date"
          aria-label={`${label.replace(/時刻$/, "")}日`}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={`${inputClass} tnum min-h-12 sm:w-[11rem]`}
          value={date}
          onChange={(e) => onChange(e.target.value, time)}
        />
        <input
          type="time"
          aria-label={label}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          step={60}
          className={`${inputClass} tnum min-h-12 sm:w-[8.5rem]`}
          value={time}
          onChange={(e) => onChange(date, e.target.value)}
        />
      </div>
      <FieldError id={errorId} message={error} />
      <span id={hintId} className="text-xs text-ink-mute">
        日本時間（24 時間制、分まで）。「今」は秒を切り捨てた現在の分を入れます。手で直せます。
      </span>
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
  const hasPos = pos.lat !== "" || pos.lng !== "";
  // 緯度・経度の欄は折りたたむ（場所名だけでも記録できるため）。値か誤りがあるときは開いておく。
  const coordOpen = hasPos || Boolean(errors[keys.lat] || errors[keys.lng] || errors[keys.acc]);
  return (
    <div className="flex min-w-0 flex-col gap-2.5">
      <Field label={label} required error={errors[keys.name]} hint="地名・施設名など、正確な位置が分かる名前（100 文字以内）">
        <input className={`${inputClass} min-h-12`} value={name} onChange={(e) => onName(e.target.value)} />
      </Field>
      <div className="flex flex-col gap-2 border-l-2 border-rule pl-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <button type="button" className={`${tallGhostClass}`} onClick={locate}>
            現在地を入れる
          </button>
          {hasPos ? (
            <span className="font-mono text-xs tnum text-ink-soft">
              {pos.lat || "—"}, {pos.lng || "—"}
              {pos.acc ? `（精度 約 ${pos.acc} m）` : ""}
            </span>
          ) : null}
        </div>
        {status ? (
          <span role="status" className="text-xs text-ink-soft">
            {status}
          </span>
        ) : null}
        <details open={coordOpen || undefined} className="group/coord">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-xs text-brand-700 [&::-webkit-details-marker]:hidden">
            <span aria-hidden className="inline-block transition-transform group-open/coord:rotate-90">
              ›
            </span>
            緯度・経度（世界測地系）を手で入れる（任意）
          </summary>
          <div className="flex flex-col gap-2 pt-1">
            <div className="grid grid-cols-2 gap-2">
              <Field label={`${label}の緯度`} required={false} error={errors[keys.lat]}>
                <input className={`${inputClass} tnum`} inputMode="decimal" value={pos.lat} onChange={(e) => onPos({ ...pos, lat: e.target.value })} />
              </Field>
              <Field label={`${label}の経度`} required={false} error={errors[keys.lng]}>
                <input className={`${inputClass} tnum`} inputMode="decimal" value={pos.lng} onChange={(e) => onPos({ ...pos, lng: e.target.value })} />
              </Field>
            </div>
            <span className="text-xs text-ink-mute">世界測地系（WGS84）の 10 進度、小数 6 桁まで。</span>
          </div>
        </details>
        <FieldError message={errors[keys.acc]} />
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
    <div data-testid="record-warnings" className="flex flex-col gap-1.5 border-l-2 border-signal-amber bg-signal-amber-soft px-3 py-2.5">
      <p className="text-xs font-medium text-ink-soft">確認してください（保存は止めません）</p>
      <ul className="flex flex-col gap-1 text-sm text-ink">
        {items.map((w) => (
          <li key={w} className="flex gap-1.5">
            <span aria-hidden className="font-medium text-signal-amber">
              !
            </span>
            <span>{w}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 下書きの状態（新規の入力だけ）。前回の入力の続きであることと、下書きを消す操作を、保存ボタンから離れた画面の上に置く。 */
function DraftBar({
  restored,
  canDiscard,
  onDiscard,
  staleNote,
  refreshNote,
}: {
  readonly restored: boolean;
  readonly canDiscard: boolean;
  readonly onDiscard: () => void;
  /** 前回の入力の日時が今日でないときの注意（例：「実施日時が 2027-01-04 10:15 のままです。」）。 */
  readonly staleNote?: string | null;
  /** 何も入力のない下書きの日時を今に入れ直したときの知らせ（例：「実施日時を今（2027-01-05 08:10）に入れ直しました。」）。 */
  readonly refreshNote?: string | null;
}) {
  return (
    <div
      data-testid="draft-status"
      className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-sharp border px-3 py-2 ${
        restored ? "border-brand-500 bg-brand-50" : "border-rule-soft"
      }`}
    >
      <p className="min-w-0 flex-1 text-xs leading-relaxed text-ink-soft">
        {restored ? (
          <>
            <span className="font-medium text-ink">前回の入力の続きです。</span>
            この端末に残っていた下書きを読み込みました。
            {staleNote ? (
              <span className="mt-1 block font-medium text-signal-amber" data-testid="draft-stale-note">
                <span aria-hidden>! </span>
                {staleNote}日時を確かめてください。
              </span>
            ) : null}
          </>
        ) : (
          "入力中の内容はこの端末に下書きとして残り、再読み込みや通信の切断では消えません。保存すると下書きは消えます。"
        )}
        {refreshNote ? (
          <span role="status" className="mt-1 block font-medium text-ink" data-testid="draft-refresh-note">
            {refreshNote}
          </span>
        ) : null}
      </p>
      {canDiscard ? (
        <button type="button" className={smallGhostClass} onClick={onDiscard}>
          下書きを消す
        </button>
      ) : null}
    </div>
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
    <div className="flex flex-col gap-3 border-t border-rule pt-4">
      {offline && message ? (
        // 通信できなかったとき：誤りではないため赤ではなく注意の色にし、下書きが残っていることと再送の操作をまとめて示す
        <div
          role="alert"
          tabIndex={-1}
          data-form-error
          className="flex flex-col gap-3 rounded-sharp border border-signal-amber/70 bg-signal-amber-soft px-3 py-3 outline-none focus-visible:ring-2 focus-visible:ring-signal-amber"
        >
          <p className="text-sm leading-relaxed text-ink">
            <span className="mr-1.5 font-medium text-signal-amber">未送信</span>
            {message}
          </p>
          <button type="button" className={`${bigButtonClass} w-full sm:w-auto sm:self-start`} onClick={onRetry} disabled={busy}>
            再送する
          </button>
        </div>
      ) : (
        <FormError message={message} />
      )}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
        <button
          type="submit"
          className={offline ? `${tallGhostClass} w-full sm:w-auto` : `${bigButtonClass} w-full sm:w-auto`}
          disabled={busy || disabled}
        >
          {label}
        </button>
        <span aria-live="polite" className="text-xs text-ink-mute">
          {busy ? "送信しています…" : null}
        </span>
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

/** 下書きに、利用者が入れた内容があるか（表示の切り替えだけに使う。機体・操縦者は画面の既定で入るため数えない）。 */
const flightHasInput = (d: Partial<FlightState>): boolean =>
  Boolean(d.takeoffTime || d.landingTime || d.takeoffPlace || d.landingPlace || d.purpose || d.waypoints || d.safetyIssue || d.defects?.length);

const joinDt = (d: string, t: string): string => (d && t ? `${d}T${t.slice(0, 5)}` : "");

export function FlightForm({
  aircraft,
  pilots,
  fixedPilotId,
  initialAircraftId,
  initialInspectionId,
  editing,
  memberId,
}: {
  readonly aircraft: readonly AircraftOption[];
  readonly pilots: readonly PilotOption[];
  /** 操縦者役割のとき、自分に結び付いた操縦者（固定）。 */
  readonly fixedPilotId: string | null;
  /** ログイン中の利用者の内部 ID（下書きを利用者ごとに分ける）。 */
  readonly memberId: string;
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
  // 前回の入力の続き（下書きに入力済みの項目があった）かどうか。表示だけに使う。
  const [restored, setRestored] = useState(false);
  // 前回の入力の離陸日時が今日でないとき、その日時（日時を目立たせる。離陸の日時を直すと消える）
  const [staleDt, setStaleDt] = useState<string | null>(null);
  // 日常点検の候補。どの機体・日の候補かを key で持ち、今の機体・日と違う間は「未取得」とみなす
  const [fetched, setFetched] = useState<{
    readonly key: string;
    readonly ok: boolean;
    readonly list: readonly InspectionCandidate[];
  } | null>(null);
  const { formRef, requestErrorFocus } = useErrorFocus();

  // 下書きの読み込み（新規のときだけ）。点検の画面から来た場合は、その機体・点検を優先する。
  // localStorage はサーバーの描画では読めないため、描画の後に読む（次の処理単位で反映する）。
  useEffect(() => {
    if (isEdit) return;
    const t = window.setTimeout(() => {
      // 共用の端末で、前の利用者の下書きを読まない・残さない
      clearOtherUsersDrafts(memberId);
      const d = loadDraft<FlightState>(draftKey("flight", memberId));
      if (d && typeof d === "object" && typeof d.clientRequestId === "string") {
        setV({
          ...emptyFlight("", fixedPilotId ?? "", ""),
          ...d,
          ...(initialInspectionId ? { aircraftId: initialAircraftId ?? d.aircraftId, dailyInspectionId: initialInspectionId } : {}),
          ...(fixedPilotId ? { pilotId: fixedPilotId } : {}),
        });
        setRestored(flightHasInput(d));
        // 離陸・着陸の日時は利用者が「今」か手で入れたもの。今日でなければ前回の入力のままと示す（勝手に変えない）
        if (d.takeoffDate && d.takeoffTime && d.takeoffDate !== jstDate(new Date())) {
          setStaleDt(`${d.takeoffDate} ${d.takeoffTime.slice(0, 5)}`);
        }
      }
      setLoaded(true);
    }, 0);
    return () => window.clearTimeout(t);
    // 初回だけ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 下書きの保存（読み込みの後だけ。読み込み前の空の状態で上書きしない）
  useEffect(() => {
    if (!isEdit && loaded) saveDraft(draftKey("flight", memberId), v);
  }, [v, loaded, isEdit, memberId]);

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
      const ok = r.ok && Array.isArray(r.data["inspections"]);
      setFetched({ key: candidateKey, ok, list: ok ? (r.data["inspections"] as InspectionCandidate[]) : [] });
    });
    return () => {
      cancelled = true;
    };
  }, [candidateKey]);
  const current = fetched && fetched.key === candidateKey ? fetched : null;
  // 取得できなかった（通信なし等）ときは null のまま（「点検がない」とは区別する）
  const candidates = current && current.ok ? current.list : null;
  const candidatesFailed = current !== null && !current.ok;

  const sameDay = useMemo(() => (candidates ?? []).filter((c) => c.inspectedDate === flightDay), [candidates, flightDay]);
  const selectedAircraft = aircraft.find((a) => a.id === v.aircraftId);
  const selectedPilot = pilots.find((p) => p.id === v.pilotId);

  const warnings: string[] = [];
  if (v.aircraftId && candidates !== null && sameDay.length === 0) warnings.push(WARNING_TEXT.no_inspection_on_day);
  if (v.aircraftId && candidatesFailed) warnings.push(WARNING_TEXT.inspections_unavailable);
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
        // 別の利用者の記録と送信の識別子がぶつかった：識別子を作り直して、次の保存では新しい記録として送る
        if (r.data["error"] === "request_conflict") setV((s) => ({ ...s, clientRequestId: newRequestId() }));
      }
      requestErrorFocus();
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
      clearDraft(draftKey("flight", memberId));
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
    clearDraft(draftKey("flight", memberId));
    setV(emptyFlight(initialAircraftId ?? "", fixedPilotId ?? "", initialInspectionId ?? ""));
    setErrors({});
    setMessage(null);
    setOffline(false);
    setRestored(false);
    setStaleDt(null);
  };

  const noInspectionOnDay = Boolean(v.aircraftId && candidates !== null && sameDay.length === 0);

  return (
    <form ref={formRef} onSubmit={onSubmit} className="flex flex-col gap-8" aria-label={isEdit ? "飛行記録の訂正" : "飛行記録の入力"}>
      {!isEdit ? (
        <DraftBar
          restored={restored}
          canDiscard={restored || flightHasInput(v)}
          onDiscard={discardDraft}
          staleNote={staleDt ? `離陸日時が前回の入力（${staleDt}）のままです。` : null}
        />
      ) : null}

      <Step no="01" title="機体・操縦者・日常点検">
        <Field label="機体" required error={errors["aircraftId"]} hint={isEdit ? "機体は訂正で変えられません。誤った場合は取り消して作り直してください。" : undefined}>
          <select
            className={`${inputClass} min-h-12`}
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
          <select className={`${inputClass} min-h-12`} value={v.pilotId} disabled={fixedPilotId !== null} onChange={(e) => set("pilotId", e.target.value)}>
            <option value="">選んでください</option>
            {pilots.map((p) => (
              <option key={p.id} value={p.id}>
                {p.fullName}
              </option>
            ))}
          </select>
        </Field>
        <Field label="日常点検" required={false} error={errors["dailyInspectionId"]} hint="同じ機体の、飛行日の点検から選びます。">
          <select className={`${inputClass} min-h-12`} value={v.dailyInspectionId} onChange={(e) => set("dailyInspectionId", e.target.value)} data-testid="inspection-select">
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
        <Warnings items={warnings} />
        {noInspectionOnDay ? (
          <a href={`/ops/inspections/new?aircraftId=${v.aircraftId}`} className={`${buttonOutlineBrandClass} self-start`}>
            日常点検を入力する
          </a>
        ) : null}
      </Step>

      <Step no="02" title="離陸">
        <PlaceInput
          label="離陸場所"
          name={v.takeoffPlace}
          pos={v.takeoffPos}
          onName={(x) => set("takeoffPlace", x)}
          onPos={(p) => set("takeoffPos", p)}
          errors={errors}
          keys={{ name: "takeoffPlace", lat: "takeoffLat", lng: "takeoffLng", acc: "takeoffAccuracyM" }}
        />
        <DateTimeInput
          label="離陸時刻"
          nowLabel="離陸：今"
          testId="takeoff"
          date={v.takeoffDate}
          time={v.takeoffTime}
          error={timeError("takeoffAt")}
          stale={staleDt !== null}
          onChange={(d, t) => {
            setStaleDt(null);
            setV((s) => ({ ...s, takeoffDate: d, takeoffTime: t, landingDate: s.landingDate || d }));
          }}
        />
      </Step>

      <Step no="03" title="着陸">
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
        <div
          className={`flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-sharp border px-4 py-3 ${
            liveMinutesError ? "border-signal-red/60" : "border-rule bg-paper"
          }`}
          aria-live="polite"
        >
          <span className="text-xs text-ink-mute">飛行時間</span>
          {minutes && minutes.ok ? (
            <>
              <span className="font-mono text-3xl leading-none tnum text-ink" data-testid="flight-minutes">
                {formatHm(minutes.minutes)}
              </span>
              {minutes.roundedUp ? <span className="text-xs text-ink-soft">（1 分未満は切り上げ）</span> : null}
            </>
          ) : (
            <span className="font-mono text-3xl leading-none text-ink-mute" data-testid="flight-minutes">
              —
            </span>
          )}
          {liveMinutesError ? (
            <span className="basis-full text-xs text-signal-red">
              <span aria-hidden>! </span>
              {liveMinutesError}
            </span>
          ) : !minutes ? (
            <span className="basis-full text-xs text-ink-mute">離陸・着陸の時刻を入れると、ここに表示します。</span>
          ) : null}
        </div>
        <PlaceInput
          label="着陸場所"
          name={v.landingPlace}
          pos={v.landingPos}
          onName={(x) => set("landingPlace", x)}
          onPos={(p) => set("landingPos", p)}
          errors={errors}
          keys={{ name: "landingPlace", lat: "landingLat", lng: "landingLng", acc: "landingAccuracyM" }}
        />
        {v.takeoffPlace && !v.landingPlace ? (
          <button type="button" className={`${tallGhostClass} self-start`} onClick={() => setV((s) => ({ ...s, landingPlace: s.takeoffPlace, landingPos: s.takeoffPos }))}>
            離陸場所と同じにする
          </button>
        ) : null}
      </Step>

      <Step no="04" title="飛行概要">
        <Field label="飛行の目的" required error={errors["purpose"]} hint="例：空撮、インフラ点検、測量（100 文字以内）">
          <input className={`${inputClass} min-h-12`} value={v.purpose} onChange={(e) => set("purpose", e.target.value)} />
        </Field>
        <Field label="経由地" required={false} error={errors["waypoints"]} hint="電源を切らずに経由した場所（200 文字以内）">
          <input className={inputClass} value={v.waypoints} onChange={(e) => set("waypoints", e.target.value)} />
        </Field>
        <fieldset className="flex min-w-0 flex-col gap-3">
          <legend className="mb-1 text-sm text-ink">
            特定飛行の形態
            <span className="ml-2 text-xs text-ink-mute">該当するものをすべて選びます。なければ選びません。</span>
          </legend>
          {(
            [
              ["airspace", "飛行禁止空域"],
              ["method", "飛行の方法"],
            ] as const
          ).map(([group, title]) => (
            <div key={group} className="flex flex-col gap-2">
              <p aria-hidden className="font-mono text-[10px] uppercase tracking-wider text-ink-mute">
                {title}
              </p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {SPECIFIC_FLIGHT_TYPES.filter((t) => t.group === group).map((t) => {
                  const checked = v.specificFlightTypes.includes(t.key);
                  return (
                    <label key={t.key} className={choiceClass(checked)}>
                      <input type="checkbox" className={`${choiceInputClass} ${brandAccent}`} checked={checked} onChange={() => toggleType(t.key)} />
                      {t.label}
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
          <FieldError message={errors["specificFlightTypes"]} />
        </fieldset>
      </Step>

      <Step no="05" title="安全に影響のあった事項・不具合">
        <ChoiceGroup
          legend="飛行の安全に影響のあった事項"
          required
          error={errors["safetyIssue"]}
          radiogroupLabel="飛行の安全に影響のあった事項の有無"
        >
          {(
            [
              ["no", "なし"],
              ["yes", "あり"],
            ] as const
          ).map(([val, label]) => (
            <label key={val} className={choiceClass(v.safetyIssue === val)}>
              <input
                type="radio"
                name="safetyIssue"
                className={`${choiceInputClass} ${brandAccent}`}
                checked={v.safetyIssue === val}
                onChange={() => set("safetyIssue", val)}
              />
              {label}
            </label>
          ))}
        </ChoiceGroup>
        {v.safetyIssue === "yes" ? (
          <Field label="影響のあった事項の内容" required error={errors["safetyIssueDetail"]} hint="飛行前後の機体の状況も含めて（500 文字以内）">
            <textarea className={inputClass} rows={3} value={v.safetyIssueDetail} onChange={(e) => set("safetyIssueDetail", e.target.value)} />
          </Field>
        ) : null}

        <fieldset className="flex min-w-0 flex-col gap-3">
          <legend className="mb-1 flex items-center gap-2 text-sm text-ink">
            <span>不具合（記事）</span>
            <span className="text-xs text-ink-mute">{v.defects.length === 0 ? "なし" : `${v.defects.length} 件`}</span>
          </legend>
          {v.defects.map((d, i) => {
            const upd = (k: keyof DefectState, val: string) =>
              set(
                "defects",
                v.defects.map((x, j) => (j === i ? { ...x, [k]: val } : x)),
              );
            return (
              <div key={i} className="flex flex-col gap-3 rounded-sharp border border-rule p-3" data-testid="defect-row">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-mono text-xs tnum text-ink-mute">不具合 {i + 1}</span>
                  <button type="button" className={smallGhostClass} onClick={() => set("defects", v.defects.filter((_, j) => j !== i))}>
                    不具合 {i + 1} を外す
                  </button>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
                </div>
              </div>
            );
          })}
          <button
            type="button"
            className={`${tallGhostClass} self-start`}
            onClick={() =>
              set("defects", [...v.defects, { occurredOn: v.takeoffDate, description: "", actionOn: "", action: "", confirmerName: "" }])
            }
          >
            不具合を加える
          </button>
          <span className="text-xs text-ink-mute">処置日・処置・確認者は、処置の後に訂正で追記できます。</span>
        </fieldset>
      </Step>

      {isEdit ? (
        <Field label="訂正の理由" required error={errors["reason"]} hint="版の一覧に、訂正した人・日時とともに残ります。">
          <textarea className={inputClass} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      ) : null}

      <SaveRow message={message} offline={offline} busy={busy} label={isEdit ? "訂正する" : "保存"} onRetry={() => void submit()} />
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
  /** 実施日時を利用者が手で直したか。直していない（既定の「今」のまま）下書きは、読み込み時に現在の分で入れ直す。 */
  timeTouched?: boolean;
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

/** 下書きに、利用者が入れた内容があるか（表示の切り替えだけに使う）。 */
const inspectionHasInput = (d: Partial<InspectionState>): boolean =>
  Boolean(d.placeName || d.specialNotes || (d.items && Object.values(d.items).some((it) => it && (it.result || it.note))));

export function InspectionForm({
  aircraft,
  pilots,
  fixedPilotId,
  initialAircraftId,
  editing,
  memberId,
}: {
  readonly aircraft: readonly AircraftOption[];
  readonly pilots: readonly PilotOption[];
  readonly fixedPilotId: string | null;
  readonly initialAircraftId?: string;
  readonly editing?: InspectionFormInitial;
  /** ログイン中の利用者の内部 ID（下書きを利用者ごとに分ける）。 */
  readonly memberId: string;
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
  const [restored, setRestored] = useState(false);
  // 手で入れた実施日時が今日でない下書きを読み込んだとき、その日時（目立たせる。日時を直すと消える）
  const [staleDt, setStaleDt] = useState<string | null>(null);
  // 何も入力のない下書きの実施日時を今に入れ直したとき、その日時（知らせを出す。日時を直すと消える）
  const [refreshDt, setRefreshDt] = useState<string | null>(null);
  const { formRef, requestErrorFocus } = useErrorFocus();

  // 下書きの読み込み。実施日時の既定は「今」（端末の時計。描画の後に行う）。
  // 日時を利用者が入れた（手で直した・「今」を押した）下書きと、9 項目・場所など他の入力がある下書きは、日時を保つ
  // （保存に失敗した点検を翌日開き直しても、実際の日時のまま。今日でなければ「前回の入力のまま」と示す）。
  // 何も入力のない下書きだけ、読み込んだ時点の分で入れ直し、そのことを画面に示す（設計 E「既定は今」）。
  useEffect(() => {
    if (isEdit) return;
    const t = window.setTimeout(() => {
      clearOtherUsersDrafts(memberId);
      const d = loadDraft<InspectionState>(draftKey("inspection", memberId));
      const now = nowJstInput(new Date());
      if (d && typeof d === "object" && typeof d.clientRequestId === "string" && d.items) {
        const has = inspectionHasInput(d);
        const hasTime = Boolean(d.date && d.time);
        const keepTime = hasTime && (d.timeTouched === true || has);
        setV({
          ...emptyInspection("", fixedPilotId ?? ""),
          ...d,
          ...(keepTime ? {} : { date: now.slice(0, 10), time: now.slice(11, 16), timeTouched: false }),
          ...(initialAircraftId ? { aircraftId: initialAircraftId } : {}),
          ...(fixedPilotId ? { pilotId: fixedPilotId } : {}),
        });
        setRestored(has || keepTime);
        if (keepTime && d.date !== now.slice(0, 10)) setStaleDt(`${d.date} ${d.time.slice(0, 5)}`);
        // 入れ直して日時が変わった場合は知らせる
        if (!keepTime && hasTime && `${d.date}T${d.time.slice(0, 5)}` !== now) {
          setRefreshDt(`${now.slice(0, 10)} ${now.slice(11, 16)}`);
        }
      } else {
        setV((s) => ({ ...s, date: now.slice(0, 10), time: now.slice(11, 16) }));
      }
      setLoaded(true);
    }, 0);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!isEdit && loaded) saveDraft(draftKey("inspection", memberId), v);
  }, [v, loaded, isEdit, memberId]);

  const set = <K extends keyof InspectionState>(k: K, value: InspectionState[K]) => setV((s) => ({ ...s, [k]: value }));
  const setItem = (key: InspectionItemKey, patch: Partial<ItemState>) =>
    setV((s) => ({ ...s, items: { ...s.items, [key]: { ...s.items[key], ...patch } } }));
  const allSelected = INSPECTION_ITEMS.every((it) => v.items[it.key].result !== "");
  const selectedCount = INSPECTION_ITEMS.filter((it) => v.items[it.key].result !== "").length;
  const abnormalCount = INSPECTION_ITEMS.filter((it) => v.items[it.key].result === "abnormal").length;
  const selectedAircraft = aircraft.find((a) => a.id === v.aircraftId);

  const discardDraft = () => {
    clearDraft(draftKey("inspection", memberId));
    const now = nowJstInput(new Date());
    setV({ ...emptyInspection(initialAircraftId ?? "", fixedPilotId ?? ""), date: now.slice(0, 10), time: now.slice(11, 16) });
    setErrors({});
    setMessage(null);
    setOffline(false);
    setRestored(false);
    setStaleDt(null);
    setRefreshDt(null);
  };

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
        // 別の利用者の記録と送信の識別子がぶつかった：識別子を作り直して、次の保存では新しい記録として送る
        if (r.data["error"] === "request_conflict") setV((s) => ({ ...s, clientRequestId: newRequestId() }));
      }
      requestErrorFocus();
      return;
    }
    setOffline(false);
    setErrors({});
    if (isEdit) {
      setReason("");
      reloadAfterChange({ target: VERSION_NOTICE_TARGET, message: `${versionOf(r)}訂正しました。` });
    } else {
      clearDraft(draftKey("inspection", memberId));
      const id = String(r.data["id"]);
      setChangeFlash(`/ops/inspections/${id}`, VERSION_NOTICE_TARGET, "日常点検を保存しました。");
      window.location.assign(`/ops/inspections/${id}`);
    }
  };

  const setAllNormal = () =>
    setV((s) => ({
      ...s,
      items: Object.fromEntries(INSPECTION_ITEMS.map((it) => [it.key, { result: "normal", note: s.items[it.key].note }])) as Record<
        InspectionItemKey,
        ItemState
      >,
    }));

  return (
    <form
      ref={formRef}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="flex flex-col gap-8"
      aria-label={isEdit ? "日常点検の訂正" : "日常点検の入力"}
    >
      {!isEdit ? (
        <DraftBar
          restored={restored}
          canDiscard={restored || inspectionHasInput(v)}
          onDiscard={discardDraft}
          staleNote={staleDt ? `実施日時が前回の入力（${staleDt}）のままです。` : null}
          refreshNote={refreshDt ? `実施日時を今（${refreshDt}）に入れ直しました。` : null}
        />
      ) : null}

      <Step no="01" title="機体・実施者・日時・場所">
        <Field label="機体" required error={errors["aircraftId"]} hint={isEdit ? "機体は訂正で変えられません。" : undefined}>
          <select className={`${inputClass} min-h-12`} value={v.aircraftId} disabled={isEdit} onChange={(e) => set("aircraftId", e.target.value)}>
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
          <select className={`${inputClass} min-h-12`} value={v.pilotId} disabled={fixedPilotId !== null} onChange={(e) => set("pilotId", e.target.value)}>
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
          stale={staleDt !== null}
          onChange={(d, t) => {
            setStaleDt(null);
            setRefreshDt(null);
            // 手で直した日時も「今」で入れた日時も、利用者が入れた日時として保つ
            setV((s) => ({ ...s, date: d, time: t, timeTouched: true }));
          }}
        />
        <ChoiceGroup legend="区分">
          {(["pre_flight", "post_flight"] as const).map((t) => (
            <label key={t} className={choiceClass(v.timing === t)}>
              <input type="radio" name="timing" className={`${choiceInputClass} ${brandAccent}`} checked={v.timing === t} onChange={() => set("timing", t)} />
              {INSPECTION_TIMING_LABELS[t]}
            </label>
          ))}
        </ChoiceGroup>
        <PlaceInput
          label="実施場所"
          name={v.placeName}
          pos={v.pos}
          onName={(x) => set("placeName", x)}
          onPos={(p) => set("pos", p)}
          errors={errors}
          keys={{ name: "placeName", lat: "latitude", lng: "longitude", acc: "accuracyM" }}
        />
      </Step>

      <Step no="02" title="点検項目（様式2）">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs leading-relaxed text-ink-mute sm:max-w-md">
            9 項目すべてで「正常」「異常」のどちらかを選びます。「異常」の項目は備考が必須です。具体的な点検内容は機体の取扱説明書によります。
          </p>
          <button type="button" className={`${bigButtonClass} w-full shrink-0 sm:w-auto`} onClick={setAllNormal}>
            すべて正常
          </button>
        </div>
        <p className="flex flex-wrap items-baseline gap-x-3 font-mono text-xs tnum text-ink-soft" aria-live="polite">
          <span>
            選択 {selectedCount} / {INSPECTION_ITEMS.length}
          </span>
          {abnormalCount > 0 ? <span className="text-signal-red">異常 {abnormalCount} 項目</span> : null}
        </p>
        <ol className="flex flex-col border-t border-rule">
          {INSPECTION_ITEMS.map((it, i) => {
            const st = v.items[it.key];
            const resultError = errors[`items.${it.key}`];
            const noteError = errors[`items.${it.key}.note`];
            const abnormal = st.result === "abnormal";
            return (
              <li
                key={it.key}
                className={`flex flex-col gap-2 border-b border-rule-soft py-2.5 pr-0.5 ${
                  abnormal ? "-ml-3 border-l-2 border-l-signal-red pl-2.5" : ""
                }`}
                data-testid={`inspection-item-${it.key}`}
              >
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                  <span className="flex min-w-0 items-baseline gap-2 text-sm text-ink">
                    <span aria-hidden className="font-mono text-xs tnum text-ink-mute">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    {it.label}
                  </span>
                  <div
                    className="grid grid-cols-2 gap-2 rounded-sharp outline-none focus-visible:ring-2 focus-visible:ring-brand-700"
                    role="radiogroup"
                    tabIndex={-1}
                    aria-label={`${it.label}の結果`}
                    aria-invalid={resultError ? true : undefined}
                  >
                    {(["normal", "abnormal"] as const).map((r) => (
                      <label key={r} className={`${choiceClass(st.result === r, r === "abnormal" ? "red" : "brand")} w-[5.75rem]`}>
                        <input
                          type="radio"
                          name={`item-${it.key}`}
                          className={`${choiceInputClass} ${r === "abnormal" ? "accent-signal-red" : brandAccent}`}
                          checked={st.result === r}
                          onChange={() => setItem(it.key, { result: r })}
                        />
                        {r === "normal" ? "正常" : "異常"}
                      </label>
                    ))}
                  </div>
                </div>
                <FieldError message={resultError} />
                {abnormal || st.note || noteError ? (
                  <Field label={`${it.label}の備考`} required={abnormal} error={noteError} hint={abnormal ? "異常の内容と、行った処置を書きます。" : undefined}>
                    <input className={`${inputClass} min-h-12`} value={st.note} onChange={(e) => setItem(it.key, { note: e.target.value })} />
                  </Field>
                ) : null}
              </li>
            );
          })}
        </ol>
      </Step>

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
        {!allSelected ? (
          <span className="text-xs text-ink-mute">
            9 項目すべてを選ぶと保存できます（残り {INSPECTION_ITEMS.length - selectedCount} 項目）
          </span>
        ) : null}
      </SaveRow>
    </form>
  );
}
