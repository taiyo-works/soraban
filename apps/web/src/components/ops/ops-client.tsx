"use client";

// 運航管理（Sprint 10）の画面の入力部品。どれも /api/ops/* を呼ぶだけで、判断はサーバー側（サービス層）が行う。
// 見た目は最低限（designer が後で整える）。
import { useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";

type ApiResult = { readonly ok: boolean; readonly status: number; readonly data: Record<string, unknown> };

const send = async (method: string, url: string, body?: unknown): Promise<ApiResult> => {
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

const ERROR_MESSAGES: Readonly<Record<string, string>> = {
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
};

const messageFor = (r: ApiResult): string => {
  const code = typeof r.data["error"] === "string" ? r.data["error"] : "";
  return ERROR_MESSAGES[code] ?? `操作に失敗しました（${r.status}）。`;
};

const fieldErrorsOf = (r: ApiResult): Record<string, string> =>
  r.data["fields"] && typeof r.data["fields"] === "object" ? (r.data["fields"] as Record<string, string>) : {};

const inputClass =
  "w-full min-w-0 rounded-none border border-rule bg-paper px-2 py-2 text-base text-ink focus:border-indigo-500 focus:outline-none";
const buttonClass =
  "inline-flex min-h-11 items-center justify-center border border-indigo-700 bg-indigo-700 px-4 py-2 text-sm text-paper disabled:opacity-50";
const subtleButtonClass =
  "inline-flex min-h-11 items-center justify-center border border-rule bg-paper px-4 py-2 text-sm text-ink disabled:opacity-50";

const Field = ({
  label,
  error,
  children,
  hint,
}: {
  readonly label: string;
  readonly error?: string;
  readonly children: ReactNode;
  readonly hint?: string;
}) => (
  <label className="flex min-w-0 flex-col gap-1 text-sm text-ink">
    <span>{label}</span>
    {children}
    {hint ? <span className="text-xs text-ink-mute">{hint}</span> : null}
    {error ? (
      <span role="alert" className="text-xs text-signal-red">
        {error}
      </span>
    ) : null}
  </label>
);

const FormError = ({ message }: { readonly message: string | null }) =>
  message ? (
    <p role="alert" className="border border-signal-red bg-signal-red-soft px-3 py-2 text-sm text-signal-red">
      {message}
    </p>
  ) : null;

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
  const router = useRouter();
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
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });

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
      return;
    }
    setErrors({});
    const id = String(r.data["id"]);
    if (editing) {
      setV({ ...v, reason: "" });
      router.refresh();
    } else router.push(`/ops/aircraft/${id}`);
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" aria-label={editing ? "機体の訂正" : "機体の登録"}>
      <FormError message={message} />
      <Field label="登録記号" error={errors["registrationMark"]} hint="JU で始まる英数字（例：JU1234567890）">
        <input className={inputClass} value={v.registrationMark} onChange={set("registrationMark")} autoComplete="off" />
      </Field>
      <Field label="型式名" error={errors["modelName"]} hint="製品名など">
        <input className={inputClass} value={v.modelName} onChange={set("modelName")} />
      </Field>
      <Field label="設計製造者" error={errors["manufacturer"]}>
        <input className={inputClass} value={v.manufacturer} onChange={set("manufacturer")} />
      </Field>
      <Field label="製造番号" error={errors["serialNumber"]}>
        <input className={inputClass} value={v.serialNumber} onChange={set("serialNumber")} />
      </Field>
      <fieldset className="flex flex-col gap-2 border border-rule p-3">
        <legend className="px-1 text-sm">型式認証</legend>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={v.typeCertified}
            onChange={(e) => setV({ ...v, typeCertified: e.target.checked })}
          />
          型式認証を受けている
        </label>
        {v.typeCertified ? (
          <>
            <Field label="型式認証の種類" error={errors["typeCertCategory"]}>
              <input className={inputClass} value={v.typeCertCategory} onChange={set("typeCertCategory")} />
            </Field>
            <Field label="型式" error={errors["typeCertModel"]}>
              <input className={inputClass} value={v.typeCertModel} onChange={set("typeCertModel")} />
            </Field>
            <Field label="型式認証書番号" error={errors["typeCertNumber"]}>
              <input className={inputClass} value={v.typeCertNumber} onChange={set("typeCertNumber")} />
            </Field>
          </>
        ) : null}
      </fieldset>
      <Field label="機体認証の区分（任意）" error={errors["airworthinessClass"]}>
        <select className={inputClass} value={v.airworthinessClass} onChange={set("airworthinessClass")}>
          <option value="">なし</option>
          <option value="first">第一種</option>
          <option value="second">第二種</option>
        </select>
      </Field>
      {v.airworthinessClass ? (
        <Field label="機体認証書番号" error={errors["airworthinessCertNumber"]}>
          <input className={inputClass} value={v.airworthinessCertNumber} onChange={set("airworthinessCertNumber")} />
        </Field>
      ) : null}
      <Field label="最大離陸重量（kg、任意）" error={errors["maxTakeoffWeightKg"]}>
        <input className={inputClass} inputMode="decimal" value={v.maxTakeoffWeightKg} onChange={set("maxTakeoffWeightKg")} />
      </Field>
      <fieldset className="flex flex-col gap-1 border border-rule p-3">
        <legend className="px-1 text-sm">使用開始時の既存の総飛行時間</legend>
        <div className="flex items-center gap-2">
          <input
            aria-label="既存の総飛行時間（時間）"
            className={`${inputClass} w-24`}
            inputMode="numeric"
            value={v.hours}
            onChange={set("hours")}
          />
          <span className="text-sm">時間</span>
          <input
            aria-label="既存の総飛行時間（分）"
            className={`${inputClass} w-20`}
            inputMode="numeric"
            value={v.minutes}
            onChange={set("minutes")}
          />
          <span className="text-sm">分</span>
        </div>
        {errors["initialFlightMinutes"] ? (
          <span role="alert" className="text-xs text-signal-red">
            {errors["initialFlightMinutes"]}
          </span>
        ) : null}
      </fieldset>
      <Field label="状態" error={errors["status"]}>
        <select className={inputClass} value={v.status} onChange={set("status")}>
          <option value="active">使用中</option>
          <option value="suspended">休止</option>
          <option value="deregistered">抹消</option>
        </select>
      </Field>
      {editing ? (
        <Field label="訂正の理由" error={errors["reason"]}>
          <textarea className={inputClass} rows={2} value={v.reason} onChange={set("reason")} />
        </Field>
      ) : null}
      <div>
        <button type="submit" className={buttonClass} disabled={busy}>
          {editing ? "訂正する" : "登録する"}
        </button>
      </div>
    </form>
  );
}

// ---- 取消 ----------------------------------------------------

export function VoidForm({ url, version, label }: { readonly url: string; readonly version: number; readonly label: string }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const r = await send("POST", url, { expectedVersion: version, reason });
    setBusy(false);
    if (!r.ok) {
      setErrors(fieldErrorsOf(r));
      setMessage(messageFor(r));
      return;
    }
    router.refresh();
  };
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3" aria-label={`${label}の取消`}>
      <FormError message={message} />
      <Field label="取消の理由" error={errors["reason"]}>
        <textarea className={inputClass} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <div>
        <button type="submit" className={subtleButtonClass} disabled={busy}>
          {label}を取り消す
        </button>
      </div>
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
  const router = useRouter();
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
      return;
    }
    setErrors({});
    if (editing) {
      setV({ ...v, reason: "" });
      router.refresh();
    } else router.push(`/ops/pilots/${String(r.data["id"])}`);
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" aria-label={editing ? "操縦者の訂正" : "操縦者の登録"}>
      <FormError message={message} />
      <Field label="氏名" error={errors["fullName"]}>
        <input className={inputClass} value={v.fullName} onChange={set("fullName")} />
      </Field>
      <fieldset className="flex flex-col gap-2 border border-rule p-3">
        <legend className="px-1 text-sm">技能証明</legend>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={v.hasLicense} onChange={check("hasLicense")} />
          技能証明の交付を受けている
        </label>
        {v.hasLicense ? (
          <>
            <Field label="技能証明の区分" error={errors["licenseClass"]}>
              <select className={inputClass} value={v.licenseClass} onChange={set("licenseClass")}>
                <option value="">選んでください</option>
                <option value="first">一等</option>
                <option value="second">二等</option>
              </select>
            </Field>
            <Field label="技能証明書番号" error={errors["licenseNumber"]}>
              <input className={inputClass} value={v.licenseNumber} onChange={set("licenseNumber")} autoComplete="off" />
            </Field>
          </>
        ) : errors["licenseNumber"] ? (
          <span role="alert" className="text-xs text-signal-red">
            {errors["licenseNumber"]}
          </span>
        ) : null}
        <Field label="技能証明の有効期限（任意）" error={errors["licenseExpiresOn"]}>
          <input type="date" className={inputClass} value={v.licenseExpiresOn} onChange={set("licenseExpiresOn")} />
        </Field>
      </fieldset>
      <fieldset className="flex flex-col gap-2 border border-rule p-3">
        <legend className="px-1 text-sm">限定事項</legend>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={v.limitationType} onChange={check("limitationType")} />
          種類の限定あり
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={v.limitationWeight} onChange={check("limitationWeight")} />
          重量の限定あり
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={v.limitationDaytime} onChange={check("limitationDaytime")} />
          昼間の限定あり
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={v.limitationVlos} onChange={check("limitationVlos")} />
          目視内の限定あり
        </label>
      </fieldset>
      {memberOptions ? (
        <Field label="結び付ける利用者（任意）" error={errors["memberId"]}>
          <select className={inputClass} value={v.memberId} onChange={set("memberId")}>
            <option value="">なし</option>
            {memberOptions.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </Field>
      ) : null}
      {editing ? (
        <Field label="訂正の理由" error={errors["reason"]}>
          <textarea className={inputClass} rows={2} value={v.reason} onChange={set("reason")} />
        </Field>
      ) : null}
      <div>
        <button type="submit" className={buttonClass} disabled={busy}>
          {editing ? "訂正する" : "登録する"}
        </button>
      </div>
    </form>
  );
}

// ---- 利用者 --------------------------------------------------

export function MemberInviteForm() {
  const router = useRouter();
  const [v, setV] = useState({ email: "", displayName: "", role: "pilot" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    const r = await send("POST", "/api/ops/members", v);
    setBusy(false);
    if (!r.ok) {
      setErrors(fieldErrorsOf(r));
      setMessage(messageFor(r));
      return;
    }
    setErrors({});
    setV({ email: "", displayName: "", role: "pilot" });
    router.refresh();
  };
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3" aria-label="利用者の招待">
      <FormError message={message} />
      <Field label="メールアドレス" error={errors["email"]} hint="本人がログインに使う Google アカウントのメールアドレス">
        <input
          type="email"
          className={inputClass}
          value={v.email}
          onChange={(e) => setV({ ...v, email: e.target.value })}
          autoComplete="off"
        />
      </Field>
      <Field label="表示名" error={errors["displayName"]}>
        <input className={inputClass} value={v.displayName} onChange={(e) => setV({ ...v, displayName: e.target.value })} />
      </Field>
      <Field label="役割" error={errors["role"]}>
        <select className={inputClass} value={v.role} onChange={(e) => setV({ ...v, role: e.target.value })}>
          <option value="manager">運航管理者</option>
          <option value="pilot">操縦者</option>
          <option value="viewer">閲覧者</option>
        </select>
      </Field>
      <div>
        <button type="submit" className={buttonClass} disabled={busy}>
          招待する
        </button>
      </div>
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
  const router = useRouter();
  const [role, setRole] = useState<string>(member.role);
  const [status, setStatus] = useState<string>(member.status === "disabled" ? "disabled" : "active");
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
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
      return;
    }
    setErrors({});
    setReason("");
    router.refresh();
  };
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2" aria-label={`${member.displayName}の変更`}>
      <FormError message={message} />
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Field label="役割" error={errors["role"]}>
          <select className={inputClass} value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="manager">運航管理者</option>
            <option value="pilot">操縦者</option>
            <option value="viewer">閲覧者</option>
          </select>
        </Field>
        <Field label="利用" error={errors["status"]}>
          <select className={inputClass} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="active">利用できる</option>
            <option value="disabled">停止</option>
          </select>
        </Field>
      </div>
      <Field label="変更の理由" error={errors["reason"]}>
        <input className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <div>
        <button type="submit" className={subtleButtonClass} disabled={busy}>
          変更する
        </button>
      </div>
    </form>
  );
}

// ---- ログイン・ログアウト ------------------------------------

export function SignOutButton({ provider }: { readonly provider: "neon" | "test" }) {
  const [busy, setBusy] = useState(false);
  const onClick = async () => {
    setBusy(true);
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
  return (
    <button type="button" className={subtleButtonClass} onClick={onClick} disabled={busy}>
      ログアウト
    </button>
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
    <div className="flex flex-col gap-2">
      <FormError message={message} />
      <div>
        <button type="button" className={buttonClass} onClick={onClick} disabled={busy}>
          Google でログイン
        </button>
      </div>
    </div>
  );
}
