"use client";

// 許可・承認の登録の入力部品（Sprint 12d 設計 G）。どれも /api/ops/permits* を呼ぶだけで、判断（検査・版・照合・認可）はサーバーが行う。
// 登録は利用者の申告で、そらばんは許可書そのものを確認できない。DIPS には接続しない。
import { useState, type FormEvent } from "react";
import { setChangeFlash } from "./change-notice";
import { newRequestId } from "./drafts";
import {
  checkboxClass,
  checkRowClass,
  Field,
  FieldError,
  fieldErrorsOf,
  FormError,
  Group,
  inputClass,
  messageFor,
  reloadAfterChange,
  send,
  SubmitRow,
  useErrorFocus,
  versionOf,
  type ApiResult,
} from "./ops-client";
import { buttonDangerClass, buttonGhostClass, buttonPrimaryClass, VERSION_NOTICE_TARGET } from "./ui";

const call = async (method: string, url: string, body?: unknown): Promise<ApiResult> => {
  try {
    return await send(method, url, body);
  } catch {
    return { ok: false, status: 0, data: { error: "network" } };
  }
};

const PERMIT_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  duplicate_number: "同じ番号の登録が既にあります。一覧で確かめてください（取消した番号は再登録できます）。",
  revoked: "失効した登録は訂正・失効できません。",
};
const failMessage = (r: ApiResult): string => {
  if (r.status === 0) return "通信できませんでした。入力した内容は画面に残っています。通信が戻ってから、もう一度操作してください。";
  const code = typeof r.data["error"] === "string" ? r.data["error"] : "";
  return PERMIT_ERROR_MESSAGES[code] ?? messageFor(r);
};

export type PermitOption = { readonly id: string; readonly label: string };
export type KindChoice = { readonly value: string; readonly label: string };

type CircleValue = { name: string; lat: string; lng: string; radiusM: string };

export type PermitFormValue = {
  readonly id: string;
  readonly version: number;
  readonly permitNumber: string;
  readonly coverage: "blanket" | "individual";
  readonly kinds: readonly string[];
  readonly airportNames: readonly string[];
  readonly issuedOn: string;
  readonly validFrom: string;
  readonly validTo: string;
  readonly placeScope:
    | { readonly type: "nationwide" }
    | { readonly type: "circles"; readonly circles: readonly { readonly name?: string; readonly lat: number; readonly lng: number; readonly radiusM: number }[] }
    | { readonly type: "text"; readonly text: string };
  readonly aircraftScope: { readonly type: "any" | "listed"; readonly ids: readonly string[] };
  readonly pilotScope: { readonly type: "any" | "listed"; readonly ids: readonly string[] };
  readonly maxAltitudeM: number | null;
  readonly maxWeightKg: number | null;
  readonly requiresObserver: boolean;
  readonly requiresAccessControl: boolean;
  readonly conditionsText: string | null;
};

const emptyCircle = (): CircleValue => ({ name: "", lat: "", lng: "", radiusM: "" });
const toggle = (list: readonly string[], v: string): string[] => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

// 選択肢の行：枠で 1 行ずつ区切り（長い文言は折り返す）、選んだ行は墨の枠と薄い地で示す（チェックの記号と併用）。③b1 の計画の入力（plans-client.tsx）と同じ作り
const rowClass =
  "flex min-h-12 cursor-pointer items-start gap-3 rounded-sb-m border border-sb-rule bg-sb-base px-3 py-2.5 text-sm leading-snug text-sb-ink hover:bg-sb-sunken has-[:checked]:border-sb-ink has-[:checked]:bg-sb-hover has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-sb-focus";
const box = `${checkboxClass} mt-0.5 h-5! w-5!`;

/** 登録・訂正のフォーム。訂正では reason と expectedVersion を送る。 */
export function PermitForm({
  initial,
  kindChoices,
  aircraftOptions,
  pilotOptions,
  affectedCount,
}: {
  readonly initial?: PermitFormValue;
  readonly kindChoices: readonly KindChoice[];
  readonly aircraftOptions: readonly PermitOption[];
  readonly pilotOptions: readonly PermitOption[];
  /** 訂正のとき、この登録を根拠にしている計画の数（番号・種類・期間・範囲を変えると「判定が古い」になる旨に添える）。 */
  readonly affectedCount?: number;
}) {
  const editing = initial !== undefined;
  const ps = initial?.placeScope;
  const [v, setV] = useState({
    permitNumber: initial?.permitNumber ?? "",
    coverage: (initial?.coverage ?? "blanket") as "blanket" | "individual",
    kinds: [...(initial?.kinds ?? [])] as string[],
    airportNames: (initial?.airportNames ?? []).join("\n"),
    issuedOn: initial?.issuedOn ?? "",
    validFrom: initial?.validFrom ?? "",
    validTo: initial?.validTo ?? "",
    placeType: (ps?.type ?? "nationwide") as "nationwide" | "circles" | "text",
    circles: (ps?.type === "circles"
      ? ps.circles.map((c) => ({ name: c.name ?? "", lat: String(c.lat), lng: String(c.lng), radiusM: String(c.radiusM) }))
      : [emptyCircle()]) as CircleValue[],
    placeText: ps?.type === "text" ? ps.text : "",
    aircraftType: (initial?.aircraftScope.type ?? "any") as "any" | "listed",
    aircraftIds: [...(initial?.aircraftScope.ids ?? [])] as string[],
    pilotType: (initial?.pilotScope.type ?? "any") as "any" | "listed",
    pilotIds: [...(initial?.pilotScope.ids ?? [])] as string[],
    maxAltitudeM: initial?.maxAltitudeM === null || initial?.maxAltitudeM === undefined ? "" : String(initial.maxAltitudeM),
    maxWeightKg: initial?.maxWeightKg === null || initial?.maxWeightKg === undefined ? "" : String(initial.maxWeightKg),
    requiresObserver: initial?.requiresObserver ?? false,
    requiresAccessControl: initial?.requiresAccessControl ?? false,
    conditionsText: initial?.conditionsText ?? "",
    reason: "",
  });
  const [clientRequestId] = useState(() => newRequestId());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { formRef, requestErrorFocus } = useErrorFocus();
  const set = <K extends keyof typeof v>(k: K, val: (typeof v)[K]) => setV((s) => ({ ...s, [k]: val }));
  const hasAirport = v.kinds.includes("airport");

  const setCircle = (i: number, patch: Partial<CircleValue>) =>
    set("circles", v.circles.map((c, j) => (j === i ? { ...c, ...patch } : c)));

  const body = () => ({
    permitNumber: v.permitNumber,
    coverage: v.coverage,
    kinds: v.kinds,
    airportNames: hasAirport ? v.airportNames.split("\n").map((s) => s.trim()).filter((s) => s !== "") : [],
    issuedOn: v.issuedOn,
    validFrom: v.validFrom,
    validTo: v.validTo,
    placeScope:
      v.placeType === "nationwide"
        ? { type: "nationwide" }
        : v.placeType === "circles"
          ? { type: "circles", circles: v.circles.map((c) => ({ ...(c.name.trim() ? { name: c.name.trim() } : {}), lat: c.lat.trim(), lng: c.lng.trim(), radiusM: c.radiusM.trim() })) }
          : { type: "text", text: v.placeText },
    aircraftScope: v.aircraftType === "any" ? { type: "any" } : { type: "listed", ids: v.aircraftIds },
    pilotScope: v.pilotType === "any" ? { type: "any" } : { type: "listed", ids: v.pilotIds },
    maxAltitudeM: v.maxAltitudeM.trim() === "" ? null : v.maxAltitudeM.trim(),
    maxWeightKg: v.maxWeightKg.trim() === "" ? null : v.maxWeightKg.trim(),
    requiresObserver: v.requiresObserver,
    requiresAccessControl: v.requiresAccessControl,
    conditionsText: v.conditionsText.trim() === "" ? null : v.conditionsText,
  });

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage(null);
    const r = editing
      ? await call("PATCH", `/api/ops/permits/${initial.id}`, { ...body(), expectedVersion: initial.version, reason: v.reason })
      : await call("POST", "/api/ops/permits", { ...body(), clientRequestId });
    setBusy(false);
    if (!r.ok) {
      setErrors(fieldErrorsOf(r));
      setMessage(failMessage(r));
      requestErrorFocus();
      return;
    }
    setErrors({});
    if (editing) {
      const affects = r.data["affectsPlans"] as { note?: string | null } | undefined;
      reloadAfterChange({ target: VERSION_NOTICE_TARGET, message: `${versionOf(r)}訂正しました。${affects?.note ? affects.note : ""}` });
    } else {
      const id = String(r.data["id"]);
      setChangeFlash(`/ops/permits/${id}`, VERSION_NOTICE_TARGET, "許可・承認を登録しました。登録は利用者の入力です。許可書で確認してください。");
      window.location.assign(`/ops/permits/${id}`);
    }
  };

  return (
    <form ref={formRef} onSubmit={onSubmit} className="flex flex-col gap-8" aria-label={editing ? "許可・承認の訂正" : "許可・承認の登録"} data-testid="permit-form">
      <Group title="許可書の記載">
        <Field label="許可・承認の番号" required error={errors["permitNumber"]} hint="許可書の表記のまま。1 通ずつ登録します（区切り文字は使えません）。">
          <input className={`${inputClass} sb-num`} value={v.permitNumber} onChange={(e) => set("permitNumber", e.target.value)} autoComplete="off" spellCheck={false} data-testid="permit-number" />
        </Field>
        <Field label="包括許可／個別許可" required error={errors["coverage"]}>
          <select
            className={`${inputClass} min-h-12`}
            value={v.coverage}
            onChange={(e) => {
              const c = e.target.value as "blanket" | "individual";
              setV((s) => ({ ...s, coverage: c, placeType: c === "individual" && s.placeType === "nationwide" ? "circles" : s.placeType }));
            }}
            data-testid="permit-coverage"
          >
            <option value="blanket">包括許可</option>
            <option value="individual">個別許可</option>
          </select>
        </Field>
        <Field label="許可書発行日" required error={errors["issuedOn"]}>
          <input type="date" className={`${inputClass} min-h-12`} value={v.issuedOn} onChange={(e) => set("issuedOn", e.target.value)} data-testid="permit-issued-on" />
        </Field>
        <span />
        <Field label="許可期間（自）" required error={errors["validFrom"]}>
          <input type="date" className={`${inputClass} min-h-12`} value={v.validFrom} onChange={(e) => set("validFrom", e.target.value)} data-testid="permit-valid-from" />
        </Field>
        <Field label="許可期間（至）" required error={errors["validTo"]}>
          <input type="date" className={`${inputClass} min-h-12`} value={v.validTo} onChange={(e) => set("validTo", e.target.value)} data-testid="permit-valid-to" />
        </Field>
      </Group>

      <fieldset className="flex min-w-0 flex-col gap-3" data-testid="permit-kinds">
        <legend className="mb-1 w-full border-b border-sb-rule pb-1.5 text-sm font-medium text-sb-ink">許可・承認の種類</legend>
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {kindChoices.map((c) => {
            const disabled = c.value === "airport" && v.coverage === "blanket";
            return (
              <label key={c.value} className={`${rowClass} ${disabled ? "opacity-50" : ""}`}>
                <input type="checkbox" className={box} checked={v.kinds.includes(c.value)} disabled={disabled} onChange={() => set("kinds", toggle(v.kinds, c.value))} data-testid={`permit-kind-${c.value}`} />
                {c.label}
              </label>
            );
          })}
        </div>
        <FieldError message={errors["kinds"]} />
        <p className="text-sm leading-relaxed text-sb-ink-3">空港等周辺の許可は個別許可だけです。登録と照合は行いますが、判定の段（要手続き）は変えません。</p>
        {hasAirport ? (
          <Field label="空港名（1 行に 1 件・5 件まで）" required error={errors["airportNames"]} hint="どの空港の許可かの表記です（照合には使いません）。">
            <textarea className={inputClass} rows={2} value={v.airportNames} onChange={(e) => set("airportNames", e.target.value)} data-testid="permit-airport-names" />
          </Field>
        ) : null}
      </fieldset>

      <fieldset className="flex min-w-0 flex-col gap-3" data-testid="permit-place">
        <legend className="mb-1 w-full border-b border-sb-rule pb-1.5 text-sm font-medium text-sb-ink">場所の範囲</legend>
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-3">
          {(
            [
              ["nationwide", "全国"],
              ["circles", "円で指定"],
              ["text", "文章のみ"],
            ] as const
          ).map(([val, label]) => {
            const disabled = val === "nationwide" && (v.coverage === "individual" || hasAirport);
            return (
              <label key={val} className={`${rowClass} ${disabled ? "opacity-50" : ""}`}>
                <input type="radio" name="place-type" className={box} checked={v.placeType === val} disabled={disabled} onChange={() => set("placeType", val)} data-testid={`permit-place-${val}`} />
                {label}
              </label>
            );
          })}
        </div>
        {v.coverage === "individual" ? <p className="text-sm leading-relaxed text-sb-ink-3">個別許可は全国を範囲にできません。</p> : null}
        {v.placeType === "circles" ? (
          <div className="flex flex-col gap-3" data-testid="permit-circles">
            {v.circles.map((c, i) => (
              <div key={i} className="grid grid-cols-1 gap-3 rounded-sb-m bg-sb-sunken p-3 sm:grid-cols-4" data-testid="permit-circle">
                <Field label={`円 ${i + 1} の名称（任意）`}>
                  <input className={inputClass} value={c.name} onChange={(e) => setCircle(i, { name: e.target.value })} data-testid="permit-circle-name" />
                </Field>
                <Field label={`円 ${i + 1} の緯度`}>
                  <input className={`${inputClass} tnum`} inputMode="decimal" value={c.lat} onChange={(e) => setCircle(i, { lat: e.target.value })} data-testid="permit-circle-lat" />
                </Field>
                <Field label={`円 ${i + 1} の経度`}>
                  <input className={`${inputClass} tnum`} inputMode="decimal" value={c.lng} onChange={(e) => setCircle(i, { lng: e.target.value })} data-testid="permit-circle-lng" />
                </Field>
                <Field label={`円 ${i + 1} の半径（m）`}>
                  <input className={`${inputClass} tnum`} inputMode="numeric" value={c.radiusM} onChange={(e) => setCircle(i, { radiusM: e.target.value })} data-testid="permit-circle-radius" />
                </Field>
                {v.circles.length > 1 ? (
                  <button type="button" className={`${buttonGhostClass} self-start sm:col-span-4`} onClick={() => set("circles", v.circles.filter((_, j) => j !== i))} data-testid="permit-circle-remove">
                    円 {i + 1} を削除する
                  </button>
                ) : null}
              </div>
            ))}
            {v.circles.length < 10 ? (
              <button type="button" className={`${buttonGhostClass} self-start`} onClick={() => set("circles", [...v.circles, emptyCircle()])} data-testid="permit-circle-add">
                円を追加する
              </button>
            ) : null}
            <p className="text-sm leading-relaxed text-sb-ink-3">計画の場所（中心と半径）が、いずれか 1 つの円に完全に収まるときだけ範囲内とします。計画の半径が未入力なら、収まりを確かめられないため適用しません。</p>
          </div>
        ) : null}
        {v.placeType === "text" ? (
          <div className="flex flex-col gap-2">
            <Field label="場所（文章）" required={false} hint="300 文字以内">
              <textarea className={inputClass} rows={3} value={v.placeText} onChange={(e) => set("placeText", e.target.value)} data-testid="permit-place-text" />
            </Field>
            <p className="opx-note" data-testid="permit-text-note">
              場所が文章だけの許可は照合できないため、判定には適用しません（要手続きのままです）。
            </p>
          </div>
        ) : null}
        <FieldError message={errors["placeScope"]} />
      </fieldset>

      <ScopePicker
        title="機体の範囲"
        testId="permit-aircraft-scope"
        type={v.aircraftType}
        ids={v.aircraftIds}
        options={aircraftOptions}
        error={errors["aircraftScope"]}
        onType={(t) => set("aircraftType", t)}
        onIds={(ids) => set("aircraftIds", ids)}
        emptyLabel="登録された機体がありません。"
      />
      <ScopePicker
        title="操縦者の範囲"
        testId="permit-pilot-scope"
        type={v.pilotType}
        ids={v.pilotIds}
        options={pilotOptions}
        error={errors["pilotScope"]}
        onType={(t) => set("pilotType", t)}
        onIds={(ids) => set("pilotIds", ids)}
        emptyLabel="登録された操縦者がいません。"
      />

      <Group title="条件">
        <Field label="最大高度の条件（m）" required={false} error={errors["maxAltitudeM"]} hint="0〜2000 の整数。計画の最大高度が未入力なら適用しません。">
          <input className={`${inputClass} tnum`} inputMode="numeric" value={v.maxAltitudeM} onChange={(e) => set("maxAltitudeM", e.target.value)} data-testid="permit-max-altitude" />
        </Field>
        <Field label="機体重量の条件（kg）" required={false} error={errors["maxWeightKg"]} hint="最大離陸重量の上限。機体の重量が分からなければ適用しません。">
          <input className={`${inputClass} tnum`} inputMode="decimal" value={v.maxWeightKg} onChange={(e) => set("maxWeightKg", e.target.value)} data-testid="permit-max-weight" />
        </Field>
        <label className={checkRowClass}>
          <input type="checkbox" className={checkboxClass} checked={v.requiresObserver} onChange={(e) => set("requiresObserver", e.target.checked)} data-testid="permit-requires-observer" />
          補助者の配置が条件
        </label>
        <label className={checkRowClass}>
          <input type="checkbox" className={checkboxClass} checked={v.requiresAccessControl} onChange={(e) => set("requiresAccessControl", e.target.checked)} data-testid="permit-requires-access" />
          立入管理措置が条件
        </label>
        <div className="sm:col-span-2">
          <Field label="照合できない条件（文章）" required={false} error={errors["conditionsText"]} hint="飛行マニュアルの指定など。表示するだけで照合には使いません。適用した許可には常に添えます。">
            <textarea className={inputClass} rows={3} value={v.conditionsText} onChange={(e) => set("conditionsText", e.target.value)} data-testid="permit-conditions" />
          </Field>
        </div>
      </Group>

      {editing ? (
        <div className="flex flex-col gap-3">
          <p className="opx-note" data-testid="permit-affects-note">
            番号・種類・期間・範囲などを変えると、この登録を使っている計画が「判定が古い」になります
            {affectedCount !== undefined ? `（いま根拠にしている計画：${affectedCount} 件）` : ""}。計画ごとに判定をやり直してください（自動では書き換えません）。
          </p>
          <Field label="訂正の理由" required error={errors["reason"]} hint="版の履歴に、訂正した人・日時とともに残ります。">
            <textarea className={inputClass} rows={2} value={v.reason} onChange={(e) => set("reason", e.target.value)} data-testid="permit-reason" />
          </Field>
        </div>
      ) : null}

      <SubmitRow message={message}>
        <button type="submit" data-variant="primary" className={buttonPrimaryClass} disabled={busy} data-testid="permit-submit">
          {editing ? "訂正する" : "登録する"}
        </button>
        {busy ? <span className="text-sm text-sb-ink-3">送信しています…</span> : null}
      </SubmitRow>
    </form>
  );
}

function ScopePicker({
  title,
  testId,
  type,
  ids,
  options,
  error,
  onType,
  onIds,
  emptyLabel,
}: {
  readonly title: string;
  readonly testId: string;
  readonly type: "any" | "listed";
  readonly ids: readonly string[];
  readonly options: readonly PermitOption[];
  readonly error?: string | undefined;
  readonly onType: (t: "any" | "listed") => void;
  readonly onIds: (ids: string[]) => void;
  readonly emptyLabel: string;
}) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-3" data-testid={testId}>
      <legend className="mb-1 w-full border-b border-sb-rule pb-1.5 text-sm font-medium text-sb-ink">{title}</legend>
      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        <label className={rowClass}>
          <input type="radio" name={`${testId}-type`} className={box} checked={type === "any"} onChange={() => onType("any")} data-testid={`${testId}-any`} />
          限定しない
        </label>
        <label className={rowClass}>
          <input type="radio" name={`${testId}-type`} className={box} checked={type === "listed"} onChange={() => onType("listed")} data-testid={`${testId}-listed`} />
          選ぶ
        </label>
      </div>
      {type === "any" ? (
        <p className="opx-note">
          限定しない場合も、許可書に機体・操縦者の限定がないか許可書で確認してください。
        </p>
      ) : options.length === 0 ? (
        <p className="text-sm text-sb-ink-3">{emptyLabel}</p>
      ) : (
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {options.map((o) => (
            <label key={o.id} className={rowClass}>
              <input type="checkbox" className={box} checked={ids.includes(o.id)} onChange={() => onIds(toggle(ids, o.id))} data-testid={`${testId}-option`} data-option-id={o.id} />
              <span className="break-all">{o.label}</span>
            </label>
          ))}
        </div>
      )}
      <FieldError message={error} />
    </fieldset>
  );
}

/** 失効（この日以降は使えない）。 */
export function RevokeForm({ id, version }: { readonly id: string; readonly version: number }) {
  const [revokedOn, setRevokedOn] = useState("");
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { formRef, requestErrorFocus } = useErrorFocus();
  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage(null);
    const r = await call("POST", `/api/ops/permits/${id}/revoke`, { expectedVersion: version, revokedOn, reason });
    setBusy(false);
    if (!r.ok) {
      setErrors(fieldErrorsOf(r));
      setMessage(failMessage(r));
      requestErrorFocus();
      return;
    }
    const affects = r.data["affectsPlans"] as { note?: string | null } | undefined;
    reloadAfterChange({ target: VERSION_NOTICE_TARGET, message: `失効を記録しました${typeof r.data["version"] === "number" ? `（版 ${r.data["version"]}）` : ""}。${affects?.note ? affects.note : ""}` });
  };
  return (
    <form ref={formRef} onSubmit={onSubmit} className="flex flex-col gap-4" aria-label="許可・承認の失効" data-testid="permit-revoke-form">
      <Field label="失効日" required error={errors["revokedOn"]} hint="この日以降は使えません（前日までの飛行には適用できます）。">
        <input type="date" className={`${inputClass} min-h-12`} value={revokedOn} onChange={(e) => setRevokedOn(e.target.value)} data-testid="permit-revoked-on" />
      </Field>
      <Field label="失効の理由" required error={errors["reason"]} hint="版の履歴に残ります。">
        <textarea className={inputClass} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="permit-revoke-reason" />
      </Field>
      <SubmitRow message={message}>
        <button type="submit" className={buttonDangerClass} disabled={busy} data-testid="permit-revoke-submit">
          この登録を失効にする
        </button>
      </SubmitRow>
    </form>
  );
}

/** 取消（誤登録）。reason と expectedVersion を送る。物理削除はしない。 */
export function PermitVoidForm({ id, version }: { readonly id: string; readonly version: number }) {
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { formRef, requestErrorFocus } = useErrorFocus();
  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage(null);
    const r = await call("POST", `/api/ops/permits/${id}/void`, { expectedVersion: version, reason });
    setBusy(false);
    if (!r.ok) {
      setErrors(fieldErrorsOf(r));
      setMessage(failMessage(r));
      requestErrorFocus();
      return;
    }
    const affects = r.data["affectsPlans"] as { note?: string | null } | undefined;
    reloadAfterChange({ target: VERSION_NOTICE_TARGET, message: `取り消しました${typeof r.data["version"] === "number" ? `（版 ${r.data["version"]}）` : ""}。${affects?.note ? affects.note : ""}` });
  };
  return (
    <form ref={formRef} onSubmit={onSubmit} className="flex flex-col gap-4" aria-label="許可・承認の取消" data-testid="permit-void-form">
      <Field label="取消の理由" required error={errors["reason"]} hint="例：別の許可書の番号を誤って登録した。版の履歴に残ります。">
        <textarea className={inputClass} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="permit-void-reason" />
      </Field>
      <FormError message={message} />
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className={buttonDangerClass} disabled={busy} data-testid="permit-void-submit">
          この登録を取り消す
        </button>
      </div>
    </form>
  );
}
