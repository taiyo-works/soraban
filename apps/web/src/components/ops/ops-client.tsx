"use client";

// 運航管理（Sprint 10）の画面の入力部品。どれも /api/ops/* を呼ぶだけで、判断はサーバー側（サービス層）が行う。
// 見た目は components/ops/ui.tsx の部品と判定画面の意匠に合わせる。
import { cloneElement, useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactElement, type ReactNode } from "react";
import { setChangeFlash } from "./change-notice";
import { clearOpsDrafts, clearOtherUsersDrafts } from "./drafts";
import { flushOutbox, planIdsWithOutbox, unsavedUnsentCountForMember } from "./field-outbox";
import { clearBundles, clearCurrentMember, clearOtherMembersBundles, setCurrentMember } from "./field-store";
import { flushIncidentOutbox, incidentUnsentTotalForMember, planIdsWithIncidentOutbox } from "./incident-outbox";
import { LOGOUT_UNSENT_WARNING, logoutGuard } from "@/lib/ops-outbox";
import { Icon } from "@/components/ui/icons";
import { FieldErrorMark } from "@/components/ui/sb-parts";
import {
  buttonDangerClass,
  buttonGhostClass,
  buttonPrimaryClass,
  MEMBER_INVITE_NOTICE_TARGET,
  memberNoticeTarget,
  VERSION_NOTICE_TARGET,
} from "./ui";

export type ApiResult = { readonly ok: boolean; readonly status: number; readonly data: Record<string, unknown> };

export const send = async (method: string, url: string, body?: unknown): Promise<ApiResult> => {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "same-origin",
  });
  let data: Record<string, unknown> = {};
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch {
    // 本文なし
  }
  return { ok: res.ok, status: res.status, data };
};

/**
 * 登録・訂正・取消の後に画面を読み直す。router.refresh() は、リンクの先読み等と重なると更新が捨てられることがあった
 * （E2E-DB 17 で数回に 1 回、版の一覧が更新されない。Sprint 10 差し戻し B）。記録の画面は正しさを優先し、通常の読み直しにする。
 */
export const reloadAfterChange = (notice?: { readonly target: string; readonly message: string }): void => {
  if (notice) setChangeFlash(window.location.pathname, notice.target, notice.message);
  window.location.reload();
};

/** 応答の版番号から「版 N として」を作る（版番号が無ければ空）。 */
export const versionOf = (r: ApiResult): string => (typeof r.data["version"] === "number" ? `版 ${r.data["version"]} として` : "");


/**
 * 入力の誤りがあったとき、最初の誤りの項目へフォーカスを移す。項目の誤りが無ければ（版の衝突など）送信の結果のエラーへ移す。
 * 送信の結果の処理で、誤りの状態（setErrors・setMessage）と一緒に requestErrorFocus() を呼ぶ。フォーカスの移動は、
 * それらの状態が描画に反映された後（同じ描画の commit の後の effect）で行う。以前は requestAnimationFrame で次のフレームを
 * 待っていたが、React の描画がそのフレームより後になると誤りの項目がまだ無く、フォーカスが移らないことがあった
 * （Sprint 10 E2E-DB 21 が CI でときどき失敗）。
 */
export const useErrorFocus = () => {
  const formRef = useRef<HTMLFormElement>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (tick === 0) return;
    const form = formRef.current;
    const el =
      form?.querySelector<HTMLElement>('[aria-invalid="true"]') ?? form?.querySelector<HTMLElement>("[data-form-error]");
    if (!el) return;
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: "center" });
  }, [tick]);
  const requestErrorFocus = useCallback(() => setTick((t) => t + 1), []);
  return { formRef, requestErrorFocus };
};

export const ERROR_MESSAGES: Readonly<Record<string, string>> = {
  invalid_input: "入力に誤りがあります。各項目の案内を確認してください。",
  version_conflict: "他の人が先に訂正しました。画面を読み込み直してから、もう一度操作してください。",
  voided: "取消済みのため変更できません。",
  duplicate_registration: "同じ登録記号の機体が既に登録されています。",
  duplicate_email: "このメールアドレスは既に招待されています。",
  member_already_linked: "この利用者は既に別の操縦者に結び付いています。",
  last_manager: "組織の最後の運航管理者は、降格・停止できません。",
  forbidden: "この操作の権限がありません。",
  forbidden_origin: "この操作の権限がありません。",
  unauthenticated: "ログインしていません。",
  no_access: "権限がありません。",
  not_found: "見つかりません。",
  // Sprint 11
  overlap: "同じ機体、または同じ操縦者の別の飛行記録と時間帯が重なっています。時刻を確かめてください。",
  aircraft_unavailable: "取消済み・抹消の機体には記録を作れません。",
  duplicate_request: "同じ内容が既に保存されています。一覧を確かめてください。",
  request_conflict: "この下書きの送信の識別子は別の利用者の記録に使われています。識別子を作り直したので、内容を確かめてもう一度保存してください。",
  // Sprint 12a
  judgement_failed: "判定を実行できませんでした（時間切れまたは失敗）。何も保存していません。入力は残してあります。少し待ってからもう一度保存してください。",
  not_requested: "確認を依頼していない計画（下書き）は、確認できません。",
  already_requested: "既に確認を依頼しています。",
  plan_cancelled: "中止した計画には記録を結べません。",
  // Sprint 12b：通報の記録・手続きの記録
  already_reported: "この計画には、有効な通報の記録が既にあります。変更する場合は「変更」を選んでください。",
  no_active_report: "有効な通報の記録がありません。",
  base_changed: "元の通報が他の操作で変わりました。画面を読み込み直してから、もう一度操作してください。",
  manual_report_exists: "この計画には、利用者の申告による有効な通報の記録が既にあります。",
  adapter_unavailable: "通報の送信元の設定が正しくないため、通報の機能を使えません。管理者に連絡してください。",
  not_correctable: "この状態の記録は訂正できません。",
  invalid_transition: "この状態では、その操作はできません。画面を読み込み直してください。",
  not_latest: "取り下げられるのは、取り下げていない最新の記録だけです。",
  not_retryable: "失敗した送信だけが再送できます。",
  result_not_recorded: "送信の結果を記録できませんでした。登録されたか分かりません。画面を読み込み直して、結果不明として扱ってください。",
  cancel_not_supported: "この送信元は取消を送れません。DIPS の画面で取り消した結果を記録してください。",
  already_recorded: "同じ判定に対する記録が既にあります。画面を読み込み直してください。",
};

export const messageFor = (r: ApiResult): string => {
  const code = typeof r.data["error"] === "string" ? r.data["error"] : "";
  return ERROR_MESSAGES[code] ?? `操作に失敗しました（${r.status}）。`;
};

export const fieldErrorsOf = (r: ApiResult): Record<string, string> =>
  r.data["fields"] && typeof r.data["fields"] === "object" ? (r.data["fields"] as Record<string, string>) : {};

export const inputClass = "sb-input";
export const checkboxClass = "sb-check";
export const checkRowClass = "opx-check-row";
const buttonClass = buttonPrimaryClass;
const subtleButtonClass = buttonGhostClass;

/** 項目名の右に付ける「必須」「任意」の札。読み上げは aria-required で伝えるため、札は読ませない。 */
export const RequiredTag = ({ required }: { readonly required?: boolean }) =>
  required === undefined ? null : (
    <span aria-hidden className={required ? "opx-required" : "opx-optional"}>
      {required ? "必須" : "任意"}
    </span>
  );

export const FieldError = ({ id, message, testId }: { readonly id?: string; readonly message?: string; readonly testId?: string }) =>
  message ? (
    // 16-D D-1：role="alert" にしない（入力欄の aria-describedby で結ぶ。送信の結果は FormError が alert で 1 度だけ知らせる）。記号は SVG＋文字
    <span id={id} className="opx-field-error sb-field-error" data-field-error="" {...(testId ? { "data-testid": testId } : {})}>
      <FieldErrorMark />
      <span>{message}</span>
    </span>
  ) : null;

type ControlProps = {
  id?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
  "aria-required"?: boolean;
};

/**
 * ラベル・必須の札・案内・項目ごとのエラーをまとめた入力欄。
 * 読み上げ名（label）は項目名だけにする。案内とエラーは label の外に置き、aria-describedby で入力欄に結び付ける
 * （label で全体を包むと、案内やエラーの文まで項目名として読まれるため）。
 */
export const Field = ({
  label,
  error,
  children,
  hint,
  required,
}: {
  readonly label: string;
  readonly error?: string;
  readonly children: ReactElement<ControlProps>;
  readonly hint?: string;
  /** true＝必須、false＝任意、省略＝札なし。 */
  readonly required?: boolean;
}) => {
  const id = useId();
  const controlId = children.props.id ?? `${id}-control`;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(" ") || undefined;
  return (
    <div className="flex min-w-0 flex-col gap-1.5 text-sm text-sb-ink">
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <label htmlFor={controlId} className="font-bold [overflow-wrap:anywhere]">
          {label}
        </label>
        <RequiredTag required={required} />
      </span>
      {cloneElement(children, {
        id: controlId,
        "aria-invalid": error ? true : undefined,
        "aria-describedby": describedBy,
        "aria-required": required ? true : undefined,
      })}
      <FieldError id={errorId} message={error} />
      {hint ? (
        <span id={hintId} className="opx-hint">
          {hint}
        </span>
      ) : null}
    </div>
  );
};

/** 送信の結果のエラー。長いフォームでも目に入るよう、送信ボタンの直上に出す。 */
export const FormError = ({ message }: { readonly message: string | null }) =>
  message ? (
    <p role="alert" tabIndex={-1} data-form-error className="opx-form-error outline-none focus-visible:outline-[3px] focus-visible:outline-sb-focus">
      {message}
    </p>
  ) : null;

/** 入力欄のまとまり（狭い画面では 1 列、広い画面では 2 列）。 */
export const Group = ({ title, children }: { readonly title: string; readonly children: ReactNode }) => (
  <fieldset className="flex min-w-0 flex-col gap-3">
    <legend className="mb-1 text-sm font-bold tracking-wider text-sb-ink-2">{title}</legend>
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{children}</div>
  </fieldset>
);

/** 送信ボタンと送信の結果のエラーの並び。 */
export const SubmitRow = ({ message, children }: { readonly message: string | null; readonly children: ReactNode }) => (
  <div className="opx-submit">
    <FormError message={message} />
    <div className="flex flex-wrap items-center gap-3">{children}</div>
  </div>
);

// ---- 機体 ----------------------------------------------------

export type AircraftFormValue = {
  readonly id?: string;
  readonly version?: number;
  readonly registrationMark: string;
  readonly modelName: string;
  readonly manufacturer: string;
  readonly serialNumber: string;
  readonly typeCertified: boolean;
  readonly typeCertCategory: string | null;
  readonly typeCertModel: string | null;
  readonly typeCertNumber: string | null;
  readonly airworthinessClass: "first" | "second" | null;
  readonly airworthinessCertNumber: string | null;
  readonly maxTakeoffWeightKg: number | null;
  readonly initialFlightMinutes: number;
  readonly status: "active" | "suspended" | "deregistered";
};

const EMPTY_AIRCRAFT: AircraftFormValue = {
  registrationMark: "",
  modelName: "",
  manufacturer: "",
  serialNumber: "",
  typeCertified: false,
  typeCertCategory: null,
  typeCertModel: null,
  typeCertNumber: null,
  airworthinessClass: null,
  airworthinessCertNumber: null,
  maxTakeoffWeightKg: null,
  initialFlightMinutes: 0,
  status: "active",
};

export function AircraftForm({ initial }: { readonly initial?: AircraftFormValue }) {
  const editing = initial?.id !== undefined;
  const v0 = initial ?? EMPTY_AIRCRAFT;
  const [v, setV] = useState({
    registrationMark: v0.registrationMark,
    modelName: v0.modelName,
    manufacturer: v0.manufacturer,
    serialNumber: v0.serialNumber,
    typeCertified: v0.typeCertified,
    typeCertCategory: v0.typeCertCategory ?? "",
    typeCertModel: v0.typeCertModel ?? "",
    typeCertNumber: v0.typeCertNumber ?? "",
    airworthinessClass: v0.airworthinessClass ?? "",
    airworthinessCertNumber: v0.airworthinessCertNumber ?? "",
    maxTakeoffWeightKg: v0.maxTakeoffWeightKg === null ? "" : String(v0.maxTakeoffWeightKg),
    hours: String(Math.floor(v0.initialFlightMinutes / 60)),
    minutes: String(v0.initialFlightMinutes % 60),
    status: v0.status,
    reason: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const flightId = useId();
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });

  const { formRef, requestErrorFocus } = useErrorFocus();
  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    const h = Number(v.hours || "0");
    const m = Number(v.minutes || "0");
    const minutes = Number.isInteger(h) && Number.isInteger(m) && h >= 0 && m >= 0 && m < 60 ? h * 60 + m : -1;
    const body = {
      registrationMark: v.registrationMark,
      modelName: v.modelName,
      manufacturer: v.manufacturer,
      serialNumber: v.serialNumber,
      typeCertified: v.typeCertified,
      typeCertCategory: v.typeCertified ? v.typeCertCategory : null,
      typeCertModel: v.typeCertified ? v.typeCertModel : null,
      typeCertNumber: v.typeCertified ? v.typeCertNumber : null,
      airworthinessClass: v.airworthinessClass || null,
      airworthinessCertNumber: v.airworthinessClass ? v.airworthinessCertNumber : null,
      maxTakeoffWeightKg: v.maxTakeoffWeightKg === "" ? null : Number(v.maxTakeoffWeightKg),
      initialFlightMinutes: minutes,
      status: v.status,
      ...(editing ? { expectedVersion: initial!.version, reason: v.reason } : {}),
    };
    const r = editing
      ? await send("PATCH", `/api/ops/aircraft/${initial!.id}`, body)
      : await send("POST", "/api/ops/aircraft", body);
    setBusy(false);
    if (!r.ok) {
      setErrors(fieldErrorsOf(r));
      setMessage(messageFor(r));
      requestErrorFocus();
      return;
    }
    setErrors({});
    const id = String(r.data["id"]);
    if (editing) {
      setV({ ...v, reason: "" });
      reloadAfterChange({ target: VERSION_NOTICE_TARGET, message: `${versionOf(r)}訂正しました。` });
    } else {
      // 登録後は通常の画面遷移で詳細を開く。クライアント側の遷移（router.push）が終わる前に、続く訂正の
      // router.refresh() が走ると更新が捨てられることがあるため（Sprint 10 差し戻し B）。
      setChangeFlash(`/ops/aircraft/${id}`, VERSION_NOTICE_TARGET, "機体を登録しました。");
      window.location.assign(`/ops/aircraft/${id}`);
    }
  };

  const flightError = errors["initialFlightMinutes"];
  const flightErrorId = flightError ? `${flightId}-error` : undefined;
  const flightDescribedBy = [flightErrorId, `${flightId}-hint`].filter(Boolean).join(" ");

  return (
    <form ref={formRef} onSubmit={onSubmit} className="flex flex-col gap-6" aria-label={editing ? "機体の訂正" : "機体の登録"}>
      <Group title="機体の識別">
        <Field
          label="登録記号"
          required
          error={errors["registrationMark"]}
          hint="JU で始まる英数字（例：JU1234567890）。小文字で入力しても大文字で保存します。"
        >
          <input
            className={`${inputClass} sb-num uppercase`}
            value={v.registrationMark}
            onChange={set("registrationMark")}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
          />
        </Field>
        <Field label="型式名" required error={errors["modelName"]} hint="製品名など">
          <input className={inputClass} value={v.modelName} onChange={set("modelName")} />
        </Field>
        <Field label="設計製造者" required error={errors["manufacturer"]}>
          <input className={inputClass} value={v.manufacturer} onChange={set("manufacturer")} />
        </Field>
        <Field label="製造番号" required error={errors["serialNumber"]}>
          <input
            className={`${inputClass} sb-num`}
            value={v.serialNumber}
            onChange={set("serialNumber")}
            autoComplete="off"
            spellCheck={false}
          />
        </Field>
      </Group>

      <Group title="認証">
        <div className="flex min-w-0 flex-col gap-3 sm:col-span-2">
          <label className={checkRowClass}>
            <input
              type="checkbox"
              className={checkboxClass}
              checked={v.typeCertified}
              onChange={(e) => setV({ ...v, typeCertified: e.target.checked })}
            />
            型式認証を受けている
          </label>
          {v.typeCertified ? (
            <div className="grid grid-cols-1 gap-4 border-l-2 border-sb-rule pl-3 sm:grid-cols-3">
              <Field label="型式認証の種類" required error={errors["typeCertCategory"]}>
                <input className={inputClass} value={v.typeCertCategory} onChange={set("typeCertCategory")} />
              </Field>
              <Field label="型式" required error={errors["typeCertModel"]}>
                <input className={inputClass} value={v.typeCertModel} onChange={set("typeCertModel")} />
              </Field>
              <Field label="型式認証書番号" required error={errors["typeCertNumber"]}>
                <input className={`${inputClass} sb-num`} value={v.typeCertNumber} onChange={set("typeCertNumber")} />
              </Field>
            </div>
          ) : null}
        </div>
        <Field label="機体認証の区分" required={false} error={errors["airworthinessClass"]}>
          <select className={`${inputClass} min-h-12`} value={v.airworthinessClass} onChange={set("airworthinessClass")}>
            <option value="">なし</option>
            <option value="first">第一種</option>
            <option value="second">第二種</option>
          </select>
        </Field>
        {v.airworthinessClass ? (
          <Field label="機体認証書番号" required error={errors["airworthinessCertNumber"]}>
            <input
              className={`${inputClass} sb-num`}
              value={v.airworthinessCertNumber}
              onChange={set("airworthinessCertNumber")}
            />
          </Field>
        ) : null}
      </Group>

      <Group title="重量・飛行時間・状態">
        <Field label="最大離陸重量（kg）" required={false} error={errors["maxTakeoffWeightKg"]} hint="小数第 1 位まで">
          <input
            className={`${inputClass} tnum`}
            inputMode="decimal"
            value={v.maxTakeoffWeightKg}
            onChange={set("maxTakeoffWeightKg")}
          />
        </Field>
        <Field
          label="状態"
          required
          error={errors["status"]}
          hint="「抹消」は国の登録を抹消した機体です。誤って登録した場合は、詳細画面の「取消」を使います。"
        >
          <select className={`${inputClass} min-h-12`} value={v.status} onChange={set("status")}>
            <option value="active">使用中</option>
            <option value="suspended">休止</option>
            <option value="deregistered">抹消</option>
          </select>
        </Field>
        <fieldset className="flex min-w-0 flex-col gap-1.5 sm:col-span-2">
          <legend className="mb-1.5 flex items-center gap-2 text-sm text-sb-ink">
            <span>使用開始時の既存の総飛行時間</span>
            <RequiredTag required />
          </legend>
          {/* 16-D D-1：見えるラベル（時間・分）を入力欄の上に置く（単位は、これで読める）。読み上げ名は従来の aria-label のまま */}
          <div className="flex items-end gap-3">
            <div className="flex flex-col gap-1">
              <label htmlFor={`${flightId}-hours`} className="sb-label">
                時間
              </label>
              <input
                id={`${flightId}-hours`}
                aria-label="既存の総飛行時間（時間）"
                aria-invalid={flightError ? true : undefined}
                aria-describedby={flightDescribedBy}
                aria-required
                className={`${inputClass.replace("w-full ", "")} tnum w-24 text-right`}
                inputMode="numeric"
                value={v.hours}
                onChange={set("hours")}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor={`${flightId}-minutes`} className="sb-label">
                分
              </label>
              <input
                id={`${flightId}-minutes`}
                aria-label="既存の総飛行時間（分）"
                aria-invalid={flightError ? true : undefined}
                aria-describedby={flightDescribedBy}
                aria-required
                className={`${inputClass.replace("w-full ", "")} tnum w-20 text-right`}
                inputMode="numeric"
                value={v.minutes}
                onChange={set("minutes")}
              />
            </div>
          </div>
          <FieldError id={flightErrorId} message={flightError} />
          <span id={`${flightId}-hint`} className="text-sm leading-relaxed text-sb-ink-3">
            この機体をそらばんで記録し始める前に飛んだ時間の合計。分は 0〜59 で入力します（なければ 0 時間 0 分）。
          </span>
        </fieldset>
      </Group>

      {editing ? (
        <Field
          label="訂正の理由"
          required
          error={errors["reason"]}
          hint="版の一覧に、訂正した人・日時とともに残ります。"
        >
          <textarea className={inputClass} rows={2} value={v.reason} onChange={set("reason")} />
        </Field>
      ) : null}
      <SubmitRow message={message}>
        <button type="submit" data-variant="primary" className={buttonClass} disabled={busy}>
          {editing ? "訂正する" : "登録する"}
        </button>
        {busy ? <span className="text-sm text-sb-ink-3">送信しています…</span> : null}
      </SubmitRow>
    </form>
  );
}

// ---- 取消 ----------------------------------------------------

export function VoidForm({ url, version, label }: { readonly url: string; readonly version: number; readonly label: string }) {
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { formRef, requestErrorFocus } = useErrorFocus();
  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const r = await send("POST", url, { expectedVersion: version, reason });
    setBusy(false);
    if (!r.ok) {
      setErrors(fieldErrorsOf(r));
      setMessage(messageFor(r));
      requestErrorFocus();
      return;
    }
    reloadAfterChange({ target: VERSION_NOTICE_TARGET, message: typeof r.data["version"] === "number" ? `取消しました（版 ${r.data["version"]}）。` : "取消しました。" });
  };
  return (
    <form ref={formRef} onSubmit={onSubmit} className="flex flex-col gap-4" aria-label={`${label}の取消`}>
      <Field
        label="取消の理由"
        required
        error={errors["reason"]}
        hint="例：別の機体の情報を誤って登録した。版の一覧に残ります。"
      >
        <textarea className={inputClass} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <SubmitRow message={message}>
        <button type="submit" className={buttonDangerClass} disabled={busy}>
          {label}を取り消す
        </button>
        {busy ? <span className="text-sm text-sb-ink-3">送信しています…</span> : null}
      </SubmitRow>
    </form>
  );
}

// ---- 操縦者 --------------------------------------------------

export type PilotFormValue = {
  readonly id?: string;
  readonly version?: number;
  readonly fullName: string;
  readonly hasLicense: boolean;
  readonly licenseClass: "first" | "second" | null;
  readonly licenseNumber: string | null;
  readonly licenseExpiresOn: string | null;
  readonly limitationType: boolean;
  readonly limitationWeight: boolean;
  readonly limitationDaytime: boolean;
  readonly limitationVlos: boolean;
  readonly memberId: string | null;
};

export type MemberOption = { readonly id: string; readonly label: string };

export function PilotForm({
  initial,
  memberOptions,
}: {
  readonly initial?: PilotFormValue;
  /** 結び付ける利用者の選択肢（運航管理者のときだけ渡す）。 */
  readonly memberOptions?: readonly MemberOption[];
}) {
  const editing = initial?.id !== undefined;
  const [v, setV] = useState({
    fullName: initial?.fullName ?? "",
    hasLicense: initial?.hasLicense ?? false,
    licenseClass: initial?.licenseClass ?? "",
    licenseNumber: initial?.licenseNumber ?? "",
    licenseExpiresOn: initial?.licenseExpiresOn ?? "",
    limitationType: initial?.limitationType ?? false,
    limitationWeight: initial?.limitationWeight ?? false,
    limitationDaytime: initial?.limitationDaytime ?? false,
    limitationVlos: initial?.limitationVlos ?? false,
    memberId: initial?.memberId ?? "",
    reason: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });
  const check = (k: keyof typeof v) => (e: { target: { checked: boolean } }) => setV({ ...v, [k]: e.target.checked });

  const { formRef, requestErrorFocus } = useErrorFocus();
  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    const body = {
      fullName: v.fullName,
      hasLicense: v.hasLicense,
      licenseClass: v.hasLicense ? v.licenseClass || null : null,
      licenseNumber: v.hasLicense ? v.licenseNumber : null,
      licenseExpiresOn: v.licenseExpiresOn || null,
      limitationType: v.limitationType,
      limitationWeight: v.limitationWeight,
      limitationDaytime: v.limitationDaytime,
      limitationVlos: v.limitationVlos,
      ...(memberOptions ? { memberId: v.memberId || null } : {}),
      ...(editing ? { expectedVersion: initial!.version, reason: v.reason } : {}),
    };
    const r = editing
      ? await send("PATCH", `/api/ops/pilots/${initial!.id}`, body)
      : await send("POST", "/api/ops/pilots", body);
    setBusy(false);
    if (!r.ok) {
      setErrors(fieldErrorsOf(r));
      setMessage(messageFor(r));
      requestErrorFocus();
      return;
    }
    setErrors({});
    if (editing) {
      setV({ ...v, reason: "" });
      reloadAfterChange({ target: VERSION_NOTICE_TARGET, message: `${versionOf(r)}訂正しました。` });
    } else {
      setChangeFlash(`/ops/pilots/${String(r.data["id"])}`, VERSION_NOTICE_TARGET, "操縦者を登録しました。");
      window.location.assign(`/ops/pilots/${String(r.data["id"])}`);
    }
  };

  return (
    <form ref={formRef} onSubmit={onSubmit} className="flex flex-col gap-6" aria-label={editing ? "操縦者の訂正" : "操縦者の登録"}>
      <Group title="操縦者">
        <Field label="氏名" required error={errors["fullName"]}>
          <input className={inputClass} value={v.fullName} onChange={set("fullName")} />
        </Field>
        {memberOptions ? (
          <Field
            label="結び付ける利用者"
            required={false}
            error={errors["memberId"]}
            hint="結び付けた利用者は、この操縦者の情報を自分で訂正でき、技能証明書番号の全桁を見られます。"
          >
            <select className={`${inputClass} min-h-12`} value={v.memberId} onChange={set("memberId")}>
              <option value="">なし</option>
              {memberOptions.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
      </Group>

      <Group title="技能証明">
        <div className="flex min-w-0 flex-col gap-3 sm:col-span-2">
          <label className={checkRowClass}>
            <input type="checkbox" className={checkboxClass} checked={v.hasLicense} onChange={check("hasLicense")} />
            技能証明の交付を受けている
          </label>
          {v.hasLicense ? (
            <div className="grid grid-cols-1 gap-4 border-l-2 border-sb-rule pl-3 sm:grid-cols-2">
              <Field label="技能証明の区分" required error={errors["licenseClass"]}>
                <select className={`${inputClass} min-h-12`} value={v.licenseClass} onChange={set("licenseClass")}>
                  <option value="">選んでください</option>
                  <option value="first">一等</option>
                  <option value="second">二等</option>
                </select>
              </Field>
              <Field
                label="技能証明書番号"
                required
                error={errors["licenseNumber"]}
                hint="英数字と「-」で 30 文字以内。一覧では末尾 4 桁以外を伏せて表示します。"
              >
                <input
                  className={`${inputClass} sb-num`}
                  value={v.licenseNumber}
                  onChange={set("licenseNumber")}
                  autoComplete="off"
                  spellCheck={false}
                />
              </Field>
            </div>
          ) : (
            <FieldError message={errors["licenseNumber"]} />
          )}
        </div>
        <Field label="技能証明の有効期限" required={false} error={errors["licenseExpiresOn"]}>
          <input type="date" className={`${inputClass} tnum`} value={v.licenseExpiresOn} onChange={set("licenseExpiresOn")} />
        </Field>
      </Group>

      <fieldset className="flex min-w-0 flex-col gap-1">
        <legend className="mb-1 sb-num text-sm uppercase tracking-wider text-sb-ink-3">限定事項（該当するものを選ぶ）</legend>
        <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
          <label className={checkRowClass}>
            <input type="checkbox" className={checkboxClass} checked={v.limitationType} onChange={check("limitationType")} />
            種類の限定あり
          </label>
          <label className={checkRowClass}>
            <input type="checkbox" className={checkboxClass} checked={v.limitationWeight} onChange={check("limitationWeight")} />
            重量の限定あり
          </label>
          <label className={checkRowClass}>
            <input type="checkbox" className={checkboxClass} checked={v.limitationDaytime} onChange={check("limitationDaytime")} />
            昼間の限定あり
          </label>
          <label className={checkRowClass}>
            <input type="checkbox" className={checkboxClass} checked={v.limitationVlos} onChange={check("limitationVlos")} />
            目視内の限定あり
          </label>
        </div>
      </fieldset>

      {editing ? (
        <Field
          label="訂正の理由"
          required
          error={errors["reason"]}
          hint="版の一覧に、訂正した人・日時とともに残ります。"
        >
          <textarea className={inputClass} rows={2} value={v.reason} onChange={set("reason")} />
        </Field>
      ) : null}
      <SubmitRow message={message}>
        <button type="submit" data-variant="primary" className={buttonClass} disabled={busy}>
          {editing ? "訂正する" : "登録する"}
        </button>
        {busy ? <span className="text-sm text-sb-ink-3">送信しています…</span> : null}
      </SubmitRow>
    </form>
  );
}

// ---- 利用者 --------------------------------------------------

export function MemberInviteForm() {
  const [v, setV] = useState({ email: "", displayName: "", role: "pilot" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { formRef, requestErrorFocus } = useErrorFocus();
  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    const r = await send("POST", "/api/ops/members", v);
    setBusy(false);
    if (!r.ok) {
      setErrors(fieldErrorsOf(r));
      setMessage(messageFor(r));
      requestErrorFocus();
      return;
    }
    setErrors({});
    setV({ email: "", displayName: "", role: "pilot" });
    reloadAfterChange({ target: MEMBER_INVITE_NOTICE_TARGET, message: "招待しました。利用者の一覧に「招待中」として加わりました。" });
  };
  return (
    <form ref={formRef} onSubmit={onSubmit} className="flex flex-col gap-5" aria-label="利用者の招待">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field
          label="メールアドレス"
          required
          error={errors["email"]}
          hint="本人がログインに使う Google アカウントのメールアドレス"
        >
          <input
            type="email"
            className={inputClass}
            value={v.email}
            onChange={(e) => setV({ ...v, email: e.target.value })}
            autoComplete="off"
            spellCheck={false}
          />
        </Field>
        <Field label="表示名" required error={errors["displayName"]} hint="版の一覧などに出る名前">
          <input className={inputClass} value={v.displayName} onChange={(e) => setV({ ...v, displayName: e.target.value })} />
        </Field>
        <Field label="役割" required error={errors["role"]}>
          <select className={`${inputClass} min-h-12`} value={v.role} onChange={(e) => setV({ ...v, role: e.target.value })}>
            <option value="manager">運航管理者</option>
            <option value="pilot">操縦者</option>
            <option value="viewer">閲覧者</option>
          </select>
        </Field>
      </div>
      <SubmitRow message={message}>
        <button type="submit" data-variant="primary" className={buttonClass} disabled={busy}>
          招待する
        </button>
        {busy ? <span className="text-sm text-sb-ink-3">送信しています…</span> : null}
      </SubmitRow>
    </form>
  );
}

export function MemberControls({
  member,
}: {
  readonly member: {
    readonly id: string;
    readonly displayName: string;
    readonly role: "manager" | "pilot" | "viewer";
    readonly status: "invited" | "active" | "disabled";
    readonly version: number;
  };
}) {
  const [role, setRole] = useState<string>(member.role);
  const [status, setStatus] = useState<string>(member.status === "disabled" ? "disabled" : "active");
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { formRef, requestErrorFocus } = useErrorFocus();
  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    const r = await send("PATCH", `/api/ops/members/${member.id}`, {
      role,
      status,
      expectedVersion: member.version,
      reason,
    });
    setBusy(false);
    if (!r.ok) {
      setErrors(fieldErrorsOf(r));
      setMessage(messageFor(r));
      requestErrorFocus();
      return;
    }
    setErrors({});
    setReason("");
    reloadAfterChange({ target: memberNoticeTarget(member.id), message: `${versionOf(r)}役割・利用を変更しました。` });
  };
  return (
    <form ref={formRef} onSubmit={onSubmit} className="flex flex-col gap-4" aria-label={`${member.displayName}の変更`}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="役割" error={errors["role"]}>
          <select className={`${inputClass} min-h-12`} value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="manager">運航管理者</option>
            <option value="pilot">操縦者</option>
            <option value="viewer">閲覧者</option>
          </select>
        </Field>
        <Field label="利用" error={errors["status"]}>
          <select className={`${inputClass} min-h-12`} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="active">利用できる</option>
            <option value="disabled">停止</option>
          </select>
        </Field>
      </div>
      <Field label="変更の理由" required error={errors["reason"]} hint="版の一覧に残ります。">
        <input className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <SubmitRow message={message}>
        <button type="submit" className={subtleButtonClass} disabled={busy}>
          変更する
        </button>
        {busy ? <span className="text-sm text-sb-ink-3">送信しています…</span> : null}
      </SubmitRow>
    </form>
  );
}

// ---- ログイン・ログアウト ------------------------------------

export function SignOutButton({ provider, memberId }: { readonly provider: "neon" | "test"; readonly memberId?: string }) {
  const [busy, setBusy] = useState(false);
  // 未送信の現場の記録があるときの警告（黙って消さない。Sprint 12c 設計 F）
  const [warning, setWarning] = useState<string | null>(null);
  const [sendFailed, setSendFailed] = useState(false);

  const signOut = async (keepOutbox = false) => {
    setBusy(true);
    // 入力中の下書き（氏名・場所を含みうる）は、ログアウトで端末から消す（Sprint 11 設計 G）。
    // 未送信の現場の記録が残っているときは、警告のあとの確認を経たときだけここへ来る（Sprint 12c）。
    // Sprint 15：先読みの束（IndexedDB）はログアウトで必ず消す。送信待ちは「残してログアウト」を選んだときだけ残す。
    clearOpsDrafts(keepOutbox && memberId ? { keepOutboxOf: memberId } : {});
    await clearBundles();
    clearCurrentMember();
    try {
      if (provider === "test") {
        await send("POST", "/api/test-auth/sign-out");
      } else {
        const { createAuthClient } = await import("@neondatabase/auth/next");
        await createAuthClient().signOut();
      }
    } finally {
      window.location.assign("/ops/sign-in");
    }
  };

  // 端末に保存できていない未送信（メモリだけにある分）も数に入れる。Sprint 12e：現場の簡易記録（事故・ヒヤリハット）の未送信も数える
  const guardNow = (): { warn: boolean; message: string | null } => {
    if (!memberId) return { warn: false, message: null };
    const g = logoutGuard(window.localStorage, memberId);
    const count = g.count + unsavedUnsentCountForMember(memberId) + incidentUnsentTotalForMember(memberId);
    return { warn: count > 0, message: count > 0 ? LOGOUT_UNSENT_WARNING(count) : null };
  };

  const onClick = async () => {
    const g = guardNow();
    if (g.warn) {
      setWarning(g.message);
      setSendFailed(false);
      return;
    }
    await signOut();
  };

  // 送ってからログアウトする。すべて送れたときだけログアウトし、送れなかったときは残して知らせる
  const sendThenSignOut = async () => {
    if (!memberId) return;
    setBusy(true);
    for (const planId of planIdsWithOutbox(memberId)) await flushOutbox(planId, memberId);
    for (const planId of planIdsWithIncidentOutbox(memberId)) await flushIncidentOutbox(planId, memberId);
    const g = guardNow();
    if (g.warn) {
      setWarning(g.message);
      setSendFailed(true);
      setBusy(false);
      return;
    }
    await signOut();
  };

  // 共通のボタン（.opx-btn。16-N2 で旧い ui/primitives から替えた）で描く。3 択は安全な順（送る → やめる）に並べ、記録を捨てる操作は離して最後に置く。
  // 警告の面は注意の色 1 つ。左の太い線・二重の枠・「！」の文字は使わない（印はアイコン、意味は文）。
  return (
    <div className="flex flex-col gap-3">
      <button type="button" className={"opx-btn w-full"} onClick={onClick} disabled={busy} data-testid="signout">
        <Icon name="sign-out" size={18} />
        ログアウト
      </button>
      {warning ? (
        <div role="alert" className="flex flex-col gap-3 rounded-sb-m border border-sb-ink bg-sb-surface p-3 text-table text-sb-ink" data-testid="signout-warning">
          <p className="flex items-start gap-2 font-medium [text-wrap:pretty]">
            <Icon name="alert" size={18} className="mt-0.5 shrink-0" />
            <span className="min-w-0">
              {warning}
              {sendFailed ? "。送れませんでした。通信を確かめてください。" : ""}
            </span>
          </p>
          <div className="flex flex-col gap-2">
            <button type="button" className={"opx-btn opx-btn-primary w-full"} data-variant="primary" onClick={() => void sendThenSignOut()} disabled={busy} data-testid="signout-send">
              送ってからログアウト
            </button>
            <button type="button" className={"opx-btn min-h-14 w-full"} onClick={() => setWarning(null)} disabled={busy} data-testid="signout-cancel">
              やめる
            </button>
            <button
              type="button"
              className={"opx-btn min-h-14 w-full flex-col gap-0 py-1.5"}
              onClick={() => void signOut(true)}
              disabled={busy}
              data-testid="signout-keep"
            >
              <span>送信待ちを残してログアウト</span>
              {/* 16-N3：375 で文の途中（「ログインすると」の前後）で折れていた。文言は同じまま、文節ごとのまとまり（inline-block）にして、折れるのを文節の切れ目だけにする。 */}
              <span className="text-aux font-normal [text-wrap:balance]">
                <span className="inline-block">（先読みは消します。</span>
                <span className="inline-block">同じ人がログインすると</span>
                <span className="inline-block">続きを送ります）</span>
              </span>
            </button>
            <button type="button" className={"opx-btn opx-btn-danger mt-2 min-h-14 w-full flex-col gap-0 py-1.5"} onClick={() => void signOut()} disabled={busy} data-testid="signout-discard">
              <span>送らずにログアウト</span>
              <span className="text-aux font-normal">（記録を捨てる）</span>
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function GoogleSignInButton() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const onClick = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const { createAuthClient } = await import("@neondatabase/auth/next");
      await createAuthClient().signIn.social({ provider: "google", callbackURL: "/ops" });
    } catch {
      setMessage("ログインを始められませんでした。時間をおいてもう一度お試しください。");
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-3">
      <button type="button" data-variant="primary" className={`${buttonClass} w-full sm:w-auto sm:self-start`} onClick={onClick} disabled={busy}>
        Google でログイン
      </button>
      <FormError message={message} />
    </div>
  );
}

/** ログイン後のトップで、他の利用者の下書き（共用の端末で前の人が残したもの）を端末から消す（Sprint 11）。表示はしない。 */
export function DraftOwnerGuard({ memberId }: { readonly memberId: string }) {
  useEffect(() => {
    clearOtherUsersDrafts(memberId);
    // Sprint 15：別の利用者がログインしたら、前の利用者の先読みの束も消す。圏外で開くときの利用者を覚える
    void clearOtherMembersBundles(memberId);
    setCurrentMember(memberId);
  }, [memberId]);
  return null;
}
