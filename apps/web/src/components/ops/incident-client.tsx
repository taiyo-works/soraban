"use client";

// 事故・ヒヤリハット（Sprint 12e 設計 E）の入力部品。どれも /api/ops/incidents* を呼ぶだけで、目安・スナップショット・記録者などは
// サーバーが決める。画面は入力中の目安を見せるだけ（保存時にサーバーが再計算する）。見た目は最低限（designer が磨く）。
//   - 事象の類型・けがの有無・機体の損傷には初期値を置かない（選び忘れを防ぐ）。「どれにも当たらない」「まだ分からない」は単独。
//   - 報告の記録は、確認のチェックを入れるまで「記録する」を押せない。取り下げ・取消・訂正は理由の入力が要る。
import { useMemo, useState, type FormEvent } from "react";
import {
  AIRCRAFT_DAMAGE_LABEL,
  EVENT_TYPE_NONE,
  EVENT_TYPE_UNKNOWN,
  INCIDENT_CONSULT_NOTE_HINT,
  INCIDENT_CONTACT_LABEL,
  INCIDENT_CONTACTS,
  INCIDENT_EVENT_TYPE_NOTICE,
  INCIDENT_FACTORS_LABEL,
  INCIDENT_FOLLOW_UP_LABEL,
  INCIDENT_GUIDANCE_LABEL,
  INCIDENT_GUIDANCE_REVISION,
  INCIDENT_KIND_LABEL,
  INCIDENT_KIND_NOTICE,
  INCIDENT_KINDS,
  INCIDENT_LIMITS,
  INCIDENT_PERSONAL_INFO_NOTICE,
  INCIDENT_PHASE_LABEL,
  INCIDENT_PHASES,
  INCIDENT_REPORT_CHANNEL_LABEL,
  INCIDENT_REPORT_CHECK_LABEL,
  INCIDENT_REPORT_REFERENCE_ABSENT_LABEL,
  PEOPLE_INJURY_LABEL,
  YES_NO_UNKNOWN,
  YES_NO_UNKNOWN_LABEL,
  eventTypeOptions,
  guidanceRevisionOf,
  incidentErrorMessage,
  incidentGuidance,
  incidentGuidanceNote,
  incidentHref,
  type IncidentContact,
  type IncidentFollowUp,
  type IncidentKind,
  type IncidentPhase,
  type IncidentReportChannel,
  type YesNoUnknown,
} from "@/lib/ops-incident";
import { newRequestId } from "./drafts";
import { IncidentGuidanceView, IncidentReportRecordNotice } from "./incident-ui";
import { Field, FieldError, FormError, fieldErrorsOf, inputClass, reloadAfterChange, send, SubmitRow, useErrorFocus, type ApiResult } from "./ops-client";
import { confirmBoxClass, confirmRowClass, JstDateTimeField, joinJst, splitJst } from "./report-parts";
import { buttonPrimaryClass, buttonDangerClass, VERSION_NOTICE_TARGET } from "./ui";

const radioRowClass =
  "opx-check-row border-[1.5px] border-transparent has-[:checked]:border-sb-ink has-[:checked]:bg-sb-hover";
const radioClass = "h-5 w-5 shrink-0 cursor-pointer accent-sb-ink";
// 項目のまとまりの見出し（12a・12d のフォームと同じ、下に罫線を引いた小見出し）
const legendClass = "mb-1 flex w-full items-center gap-2 border-b border-sb-rule pb-1.5 text-sm font-bold text-sb-ink";

/** 誤りの文言（項目ごとの誤りがあれば入力欄の下に、無ければ送信ボタンの上に）。 */
const messageOf = (r: ApiResult): string => {
  const code = typeof r.data["error"] === "string" ? r.data["error"] : "";
  if (code === "invalid_input") return "入力に誤りがあります。各項目の案内を確認してください。";
  return code ? incidentErrorMessage(code) : `操作に失敗しました（${r.status}）。`;
};

export type IncidentOption = { readonly id: string; readonly label: string };

export type IncidentFormInitial = {
  readonly kind: IncidentKind | null;
  readonly occurredAt: string;
  readonly planId: string | null;
  readonly flightRecordId: string | null;
  readonly aircraftId: string | null;
  readonly pilotId: string | null;
  readonly phase: IncidentPhase | null;
  readonly placeName: string;
  readonly eventTypes: readonly string[];
  readonly peopleInjury: YesNoUnknown | null;
  readonly aircraftDamage: YesNoUnknown | null;
  readonly injuredCount: number | null;
  readonly contactsMade: readonly IncidentContact[];
  readonly summary: string;
  readonly details: string;
  readonly factorsNote: string;
  readonly actionsTaken: string;
  readonly preventionNote: string;
  readonly followUpStatus: IncidentFollowUp;
  readonly followUpOn: string | null;
};

/** 「ある／ない／わからない」の選択（初期値なし。色だけで区別しない）。 */
function YesNoUnknownField({
  name,
  legend,
  value,
  onChange,
  error,
  testIdPrefix,
}: {
  readonly name: string;
  readonly legend: string;
  readonly value: YesNoUnknown | null;
  readonly onChange: (v: YesNoUnknown) => void;
  readonly error?: string;
  readonly testIdPrefix: string;
}) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-2" aria-invalid={error ? true : undefined} aria-describedby={error ? `${testIdPrefix}-err` : undefined}>
      <legend className={legendClass}>
        {legend}
        <span aria-hidden className="opx-required">必須</span>
      </legend>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {YES_NO_UNKNOWN.map((v) => (
          <label key={v} className={radioRowClass}>
            <input type="radio" name={name} className={radioClass} checked={value === v} onChange={() => onChange(v)} data-testid={`${testIdPrefix}-${v}`} />
            {YES_NO_UNKNOWN_LABEL[v]}
          </label>
        ))}
      </div>
      <FieldError id={`${testIdPrefix}-err`} message={error} />
    </fieldset>
  );
}

/**
 * 事故・ヒヤリハットの入力（作成・訂正）。作成は POST（clientRequestId で二重送信を防ぐ）、訂正は PATCH（expectedVersion・reason 必須）。
 * 訂正の保存は「詳細の記入」を兼ねる（簡易記録の detail_pending を外す。要約が要る）。
 */
export function IncidentForm({
  mode,
  initial,
  plans,
  aircraft,
  pilots,
  id,
  version,
}: {
  readonly mode: "create" | "correct";
  readonly initial: IncidentFormInitial;
  readonly plans: readonly IncidentOption[];
  readonly aircraft: readonly IncidentOption[];
  readonly pilots: readonly IncidentOption[];
  readonly id?: string;
  readonly version?: number;
}) {
  const [requestId] = useState(() => newRequestId());
  const [kind, setKind] = useState<IncidentKind | null>(initial.kind);
  const at0 = splitJst(initial.occurredAt);
  const [date, setDate] = useState(at0.date);
  const [time, setTime] = useState(at0.time);
  const [planId, setPlanId] = useState(initial.planId ?? "");
  const [aircraftId, setAircraftId] = useState(initial.aircraftId ?? "");
  const [pilotId, setPilotId] = useState(initial.pilotId ?? "");
  const [phase, setPhase] = useState<string>(initial.phase ?? "");
  const [placeName, setPlaceName] = useState(initial.placeName);
  const [eventTypes, setEventTypes] = useState<string[]>([...initial.eventTypes]);
  const [peopleInjury, setPeopleInjury] = useState<YesNoUnknown | null>(initial.peopleInjury);
  const [aircraftDamage, setAircraftDamage] = useState<YesNoUnknown | null>(initial.aircraftDamage);
  const [injuredCount, setInjuredCount] = useState(initial.injuredCount === null ? "" : String(initial.injuredCount));
  const [contacts, setContacts] = useState<IncidentContact[]>([...initial.contactsMade]);
  const [summary, setSummary] = useState(initial.summary);
  const [details, setDetails] = useState(initial.details);
  const [factorsNote, setFactorsNote] = useState(initial.factorsNote);
  const [actionsTaken, setActionsTaken] = useState(initial.actionsTaken);
  const [preventionNote, setPreventionNote] = useState(initial.preventionNote);
  const [followUp, setFollowUp] = useState<IncidentFollowUp>(initial.followUpStatus);
  const [followUpOn, setFollowUpOn] = useState(initial.followUpOn ?? "");
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { formRef, requestErrorFocus } = useErrorFocus();

  const options = useMemo(() => eventTypeOptions(INCIDENT_GUIDANCE_REVISION), []);
  const factOnlyKeys = useMemo(
    () => new Set(guidanceRevisionOf(INCIDENT_GUIDANCE_REVISION).eventTypes.filter((t) => t.guidance === "fact_only").map((t) => t.key)),
    [],
  );
  const possibleOpts = options.filter((o) => !o.exclusive && !factOnlyKeys.has(o.key));
  const factOnlyOpts = options.filter((o) => factOnlyKeys.has(o.key));
  const exclusiveOpts = options.filter((o) => o.exclusive);

  const toggleType = (key: string, exclusive: boolean) => {
    setEventTypes((cur) => {
      if (cur.includes(key)) return cur.filter((k) => k !== key);
      if (exclusive) return [key];
      return [...cur.filter((k) => k !== EVENT_TYPE_NONE && k !== EVENT_TYPE_UNKNOWN), key];
    });
  };

  const live = eventTypes.length > 0 ? incidentGuidance(eventTypes) : null;

  const typeOption = (o: (typeof options)[number]) => (
    <li key={o.key}>
      <label className={`${radioRowClass} items-start !py-3 ${o.exclusive ? "border-dashed" : ""}`} data-testid="incident-event-type" data-key={o.key}>
        <input
          type="checkbox"
          className={`${radioClass} mt-0.5`}
          checked={eventTypes.includes(o.key)}
          onChange={() => toggleType(o.key, o.exclusive)}
          data-testid={`incident-event-type-${o.key}`}
        />
        <span className="flex min-w-0 flex-col gap-1.5">
          <span className="text-[1rem] font-medium leading-snug" data-testid={`incident-event-type-label-${o.key}`}>
            {o.label}
          </span>
          {o.description ? (
            <span className="text-sm leading-relaxed text-sb-ink-2" data-testid={`incident-event-type-desc-${o.key}`}>
              {o.description}
            </span>
          ) : null}
        </span>
      </label>
    </li>
  );

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    const body: Record<string, unknown> = {
      kind,
      occurredAt: joinJst(date, time) || null,
      planId: planId || null,
      flightRecordId: initial.flightRecordId,
      aircraftId: aircraftId || null,
      pilotId: pilotId || null,
      phase: phase || null,
      placeName: placeName.trim() || null,
      eventTypes,
      peopleInjury,
      aircraftDamage,
      injuredCount: peopleInjury === "yes" && injuredCount.trim() !== "" ? injuredCount.trim() : null,
      contactsMade: contacts,
      summary: summary.trim() || null,
      details: details.trim() || null,
      factorsNote: factorsNote.trim() || null,
      actionsTaken: actionsTaken.trim() || null,
      preventionNote: preventionNote.trim() || null,
      followUpStatus: followUp,
      followUpOn: followUp === "done" ? followUpOn || null : null,
    };
    // 訂正では座標を送らない（入力欄を持たないため、保存済みの値をそのまま残す）
    const r =
      mode === "create"
        ? await send("POST", "/api/ops/incidents", { mode: "full", ...body, latitude: null, longitude: null, clientRequestId: requestId })
        : await send("PATCH", `/api/ops/incidents/${id}`, { ...body, detailPending: false, expectedVersion: version, reason });
    setBusy(false);
    if (!r.ok) {
      setErrors(fieldErrorsOf(r));
      setMessage(messageOf(r));
      requestErrorFocus();
      return;
    }
    if (mode === "create") {
      window.location.assign(incidentHref(String(r.data["id"])));
      return;
    }
    reloadAfterChange({ target: VERSION_NOTICE_TARGET, message: typeof r.data["version"] === "number" ? `訂正しました（版 ${r.data["version"]}）。` : "訂正しました。" });
  };

  return (
    <form ref={formRef} onSubmit={onSubmit} className="flex flex-col gap-8" aria-label={mode === "create" ? "事故・ヒヤリハットの記録" : "事故・ヒヤリハットの訂正"} data-testid="incident-form" noValidate>
      {/* 区分（利用者が選ぶ。法令上の区分ではない） */}
      <fieldset className="flex min-w-0 flex-col gap-2" aria-invalid={errors["kind"] ? true : undefined} aria-describedby={errors["kind"] ? "incident-err-kind" : undefined}>
        <legend className={legendClass}>
          区分
          <span aria-hidden className="opx-required">必須</span>
        </legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {INCIDENT_KINDS.map((k) => (
            <label key={k} className={radioRowClass}>
              <input type="radio" name="incident-kind" className={radioClass} checked={kind === k} onChange={() => setKind(k)} data-testid={`incident-kind-${k}`} />
              {INCIDENT_KIND_LABEL[k]}
            </label>
          ))}
        </div>
        <p className="text-sm leading-relaxed text-sb-ink-2" data-testid="incident-kind-notice">
          {INCIDENT_KIND_NOTICE}
        </p>
        <FieldError id="incident-err-kind" message={errors["kind"]} />
      </fieldset>

      <JstDateTimeField label="起きた日時" date={date} time={time} onDate={setDate} onTime={setTime} error={errors["occurredAt"]} testId="incident-occurred" />

      <fieldset className="flex min-w-0 flex-col gap-3">
        <legend className={legendClass}>飛行・機体・操縦者・場所（任意）</legend>
        <Field label="飛行計画" required={false} error={errors["planId"]} hint="選ぶと、空欄の機体・操縦者・場所を計画から引き継ぎ、そのときの判定スナップショットを記録します。">
          <select className={`${inputClass} min-h-12`} value={planId} onChange={(e) => setPlanId(e.target.value)} data-testid="incident-plan">
            <option value="">計画なし（計画外の飛行・地上での取り扱いなど）</option>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="機体" required={false} error={errors["aircraftId"]}>
            <select className={`${inputClass} min-h-12`} value={aircraftId} onChange={(e) => setAircraftId(e.target.value)} data-testid="incident-aircraft">
              <option value="">選ばない</option>
              {aircraft.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="操縦者" required={false} error={errors["pilotId"]}>
            <select className={`${inputClass} min-h-12`} value={pilotId} onChange={(e) => setPilotId(e.target.value)} data-testid="incident-pilot">
              <option value="">選ばない</option>
              {pilots.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="起きた場面" required={false} error={errors["phase"]}>
            <select className={`${inputClass} min-h-12`} value={phase} onChange={(e) => setPhase(e.target.value)} data-testid="incident-phase">
              <option value="">選ばない</option>
              {INCIDENT_PHASES.map((p) => (
                <option key={p} value={p}>
                  {INCIDENT_PHASE_LABEL[p]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="場所の名称" required={false} error={errors["placeName"]}>
            <input className={inputClass} value={placeName} maxLength={INCIDENT_LIMITS.placeName} onChange={(e) => setPlaceName(e.target.value)} data-testid="incident-place" />
          </Field>
        </div>
      </fieldset>

      {/* 事象の類型（複数選択。初期値なし）。目安に効く類型・事実の類型・排他の 2 つを間を空けて分ける */}
      <fieldset className="flex min-w-0 flex-col gap-3" aria-invalid={errors["eventTypes"] ? true : undefined} aria-describedby={errors["eventTypes"] ? "incident-err-eventTypes" : undefined} data-testid="incident-event-types">
        <legend className={legendClass}>
          起きた事象の類型
          <span aria-hidden className="opx-required">必須</span>
        </legend>
        <p className="text-sm leading-relaxed text-sb-ink-2" data-testid="incident-event-type-notice">
          {INCIDENT_EVENT_TYPE_NOTICE}
        </p>
        <ul className="flex flex-col gap-2" data-testid="incident-event-types-possible">
          {possibleOpts.map(typeOption)}
        </ul>
        {/* 事実の類型（目安には効かない）。点線の区切りで目安に効く 7 類型から離す（「当たらない」の意味に見えないよう、選択肢の形は同じ） */}
        <ul className="mt-3 flex flex-col gap-2 border-t border-dashed border-sb-edge pt-5" data-testid="incident-event-types-fact-only">
          {factOnlyOpts.map(typeOption)}
        </ul>
        {/* 排他の 2 つ（同時に選べない）。実線の区切りでさらに離し、選択肢の枠を破線にして形でも区別する */}
        <ul className="mt-5 flex flex-col gap-2 border-t border-sb-rule pt-5" data-testid="incident-event-types-exclusive">
          {exclusiveOpts.map(typeOption)}
        </ul>
        <FieldError id="incident-err-eventTypes" message={errors["eventTypes"]} testId="incident-event-types-error" />
      </fieldset>

      {/* 入力中の目安（保存時にサーバーが再計算する） */}
      {live ? (
        <IncidentGuidanceView
          g={{ level: live.level, label: INCIDENT_GUIDANCE_LABEL[live.level].label, mark: INCIDENT_GUIDANCE_LABEL[live.level].mark, text: live.text, note: incidentGuidanceNote() }}
          testId="incident-live-guidance"
        />
      ) : (
        <p className="rounded-sb-m border border-dashed border-sb-edge px-4 py-3.5 text-sm leading-relaxed text-sb-ink-2" data-testid="incident-live-guidance-empty">
          事象の類型を選ぶと、報告の対象になる可能性の目安がここに出ます。
        </p>
      )}

      <YesNoUnknownField name="incident-injury" legend={PEOPLE_INJURY_LABEL} value={peopleInjury} onChange={setPeopleInjury} error={errors["peopleInjury"]} testIdPrefix="incident-injury" />
      {peopleInjury === "yes" ? (
        <Field label="けがをした人の人数" required={false} error={errors["injuredCount"]} hint="人数だけを記録します（氏名は記録しません）。">
          <input className={`${inputClass} max-w-40`} inputMode="numeric" value={injuredCount} onChange={(e) => setInjuredCount(e.target.value)} data-testid="incident-injured-count" />
        </Field>
      ) : null}
      <YesNoUnknownField name="incident-damage" legend={AIRCRAFT_DAMAGE_LABEL} value={aircraftDamage} onChange={setAircraftDamage} error={errors["aircraftDamage"]} testIdPrefix="incident-damage" />

      <fieldset className="flex min-w-0 flex-col gap-2" aria-invalid={errors["contactsMade"] ? true : undefined} aria-describedby={errors["contactsMade"] ? "incident-err-contactsMade" : undefined}>
        <legend className={legendClass}>連絡した先（任意）</legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {INCIDENT_CONTACTS.map((c) => (
            <label key={c} className={radioRowClass}>
              <input
                type="checkbox"
                className={radioClass}
                checked={contacts.includes(c)}
                onChange={() => setContacts((cur) => (cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c]))}
                data-testid={`incident-contact-${c}`}
              />
              {INCIDENT_CONTACT_LABEL[c]}
            </label>
          ))}
        </div>
        <FieldError id="incident-err-contactsMade" message={errors["contactsMade"]} />
      </fieldset>

      <fieldset className="flex min-w-0 flex-col gap-4">
        <legend className={legendClass}>起きたこと</legend>
        <p className="opx-note" data-testid="incident-personal-notice">
          {INCIDENT_PERSONAL_INFO_NOTICE}
        </p>
        <Field label="何が起きたか" required error={errors["summary"]} hint={`${INCIDENT_LIMITS.summary} 文字まで`}>
          <input className={inputClass} value={summary} maxLength={INCIDENT_LIMITS.summary} onChange={(e) => setSummary(e.target.value)} data-testid="incident-summary" />
        </Field>
        <Field label="経過" required={false} error={errors["details"]}>
          <textarea className={inputClass} rows={4} value={details} maxLength={INCIDENT_LIMITS.details} onChange={(e) => setDetails(e.target.value)} data-testid="incident-details" />
        </Field>
        <Field label="とった対応" required={false} error={errors["actionsTaken"]}>
          <textarea className={inputClass} rows={3} value={actionsTaken} maxLength={INCIDENT_LIMITS.actionsTaken} onChange={(e) => setActionsTaken(e.target.value)} data-testid="incident-actions" />
        </Field>
        <Field label={INCIDENT_FACTORS_LABEL} required={false} error={errors["factorsNote"]}>
          <textarea className={inputClass} rows={3} value={factorsNote} maxLength={INCIDENT_LIMITS.factorsNote} onChange={(e) => setFactorsNote(e.target.value)} data-testid="incident-factors" />
        </Field>
        <Field label="再発防止" required={false} error={errors["preventionNote"]}>
          <textarea className={inputClass} rows={3} value={preventionNote} maxLength={INCIDENT_LIMITS.preventionNote} onChange={(e) => setPreventionNote(e.target.value)} data-testid="incident-prevention" />
        </Field>
      </fieldset>

      <fieldset className="flex min-w-0 flex-col gap-2">
        <legend className={legendClass}>対応の状況</legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {(["open", "done"] as const).map((s) => (
            <label key={s} className={radioRowClass}>
              <input type="radio" name="incident-follow-up" className={radioClass} checked={followUp === s} onChange={() => setFollowUp(s)} data-testid={`incident-follow-up-${s}`} />
              {INCIDENT_FOLLOW_UP_LABEL[s]}
            </label>
          ))}
        </div>
        {followUp === "done" ? (
          <Field label="対応が済んだ日" required error={errors["followUpOn"]}>
            <input type="date" className={`${inputClass} max-w-56 sb-num`} value={followUpOn} onChange={(e) => setFollowUpOn(e.target.value)} data-testid="incident-follow-up-on" />
          </Field>
        ) : null}
      </fieldset>

      {mode === "correct" ? (
        <Field label="訂正の理由" required error={errors["reason"]} hint="版の一覧に残ります。">
          <textarea className={inputClass} rows={2} value={reason} maxLength={INCIDENT_LIMITS.reason} onChange={(e) => setReason(e.target.value)} data-testid="incident-reason" />
        </Field>
      ) : null}

      <SubmitRow message={message}>
        <button type="submit" data-variant="primary" className={`${buttonPrimaryClass} min-h-12 w-full sm:w-auto`} disabled={busy} data-testid="incident-submit">
          {mode === "create" ? "記録する" : "訂正を保存する"}
        </button>
        {busy ? <span className="text-sm text-sb-ink-3">送信しています…</span> : null}
      </SubmitRow>
    </form>
  );
}

/** 対応の状況だけを更新する（訂正の一種。理由が要る）。 */
export function IncidentFollowUpForm({ id, version, status, on }: { readonly id: string; readonly version: number; readonly status: IncidentFollowUp; readonly on: string | null }) {
  const [s, setS] = useState<IncidentFollowUp>(status === "open" ? "done" : "open");
  const [date, setDate] = useState(on ?? "");
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { formRef, requestErrorFocus } = useErrorFocus();
  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const r = await send("PATCH", `/api/ops/incidents/${id}`, { expectedVersion: version, reason, followUpStatus: s, followUpOn: s === "done" ? date || null : null });
    setBusy(false);
    if (!r.ok) {
      setErrors(fieldErrorsOf(r));
      setMessage(messageOf(r));
      requestErrorFocus();
      return;
    }
    reloadAfterChange({ target: VERSION_NOTICE_TARGET, message: "対応の状況を更新しました。" });
  };
  return (
    <form ref={formRef} onSubmit={onSubmit} className="flex flex-col gap-4" aria-label="対応の状況の更新" data-testid="incident-follow-up-form">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {(["open", "done"] as const).map((v) => (
          <label key={v} className={radioRowClass}>
            <input type="radio" name="incident-follow-up-update" className={radioClass} checked={s === v} onChange={() => setS(v)} data-testid={`incident-follow-up-update-${v}`} />
            {INCIDENT_FOLLOW_UP_LABEL[v]}
          </label>
        ))}
      </div>
      {s === "done" ? (
        <Field label="対応が済んだ日" required error={errors["followUpOn"]}>
          <input type="date" className={`${inputClass} max-w-56 sb-num`} value={date} onChange={(e) => setDate(e.target.value)} data-testid="incident-follow-up-update-on" />
        </Field>
      ) : null}
      <Field label="更新の理由" required error={errors["reason"]}>
        <textarea className={inputClass} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="incident-follow-up-update-reason" />
      </Field>
      <SubmitRow message={message}>
        <button type="submit" data-variant="primary" className={buttonPrimaryClass} disabled={busy} data-testid="incident-follow-up-update-submit">
          対応の状況を更新する
        </button>
      </SubmitRow>
    </form>
  );
}

/** 報告の結果を記録する（DIPS 2.0 等で報告した。利用者の申告）。確認のチェックが入るまで押せない。 */
export function IncidentReportedForm({ id, defaultDoneAt }: { readonly id: string; readonly defaultDoneAt: string }) {
  const d0 = splitJst(defaultDoneAt);
  const [date, setDate] = useState(d0.date);
  const [time, setTime] = useState(d0.time);
  const [channel, setChannel] = useState<IncidentReportChannel>("dips");
  const [channelNote, setChannelNote] = useState("");
  const [reference, setReference] = useState("");
  const [absent, setAbsent] = useState(false);
  const [note, setNote] = useState("");
  const [checked, setChecked] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { formRef, requestErrorFocus } = useErrorFocus();
  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!checked) return;
    setBusy(true);
    const r = await send("POST", `/api/ops/incidents/${id}/reports`, {
      action: "reported",
      doneAt: joinJst(date, time) || null,
      channel,
      ...(channel === "other" ? { channelNote } : {}),
      ...(absent ? { referenceAbsent: true } : { reference: reference.trim() || null }),
      note: note.trim() || null,
      checks: { reportCompleted: true },
    });
    setBusy(false);
    if (!r.ok) {
      setErrors(fieldErrorsOf(r));
      setMessage(messageOf(r));
      requestErrorFocus();
      return;
    }
    reloadAfterChange({ target: "incident-report", message: "報告の結果を記録しました（利用者の申告）。" });
  };
  return (
    <form ref={formRef} onSubmit={onSubmit} className="flex flex-col gap-4" aria-label="報告の結果の記録" data-testid="incident-report-form">
      <IncidentReportRecordNotice />
      <JstDateTimeField label="報告した日時" date={date} time={time} onDate={setDate} onTime={setTime} error={errors["doneAt"]} testId="incident-report-done" />
      <fieldset className="flex min-w-0 flex-col gap-2" aria-invalid={errors["channel"] ? true : undefined} aria-describedby={errors["channel"] ? "incident-report-err-channel" : undefined}>
        <legend className={legendClass}>報告の方法</legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {(["dips", "other"] as const).map((c) => (
            <label key={c} className={radioRowClass}>
              <input type="radio" name="incident-report-channel" className={radioClass} checked={channel === c} onChange={() => setChannel(c)} data-testid={`incident-report-channel-${c}`} />
              {INCIDENT_REPORT_CHANNEL_LABEL[c]}
            </label>
          ))}
        </div>
        <FieldError id="incident-report-err-channel" message={errors["channel"]} />
      </fieldset>
      {channel === "other" ? (
        <Field label="その他の方法" required error={errors["channelNote"]} hint="例：電子メール（報告要領に定める方法）。相手の氏名は書かないでください。">
          <input className={inputClass} value={channelNote} maxLength={INCIDENT_LIMITS.channelNote} onChange={(e) => setChannelNote(e.target.value)} data-testid="incident-report-channel-note" />
        </Field>
      ) : null}
      <Field label="報告の番号" required={!absent} error={errors["reference"]} hint="番号が表示されなかったときは、下のチェックを入れてください。">
        <input className={inputClass} value={reference} disabled={absent} maxLength={INCIDENT_LIMITS.reference} onChange={(e) => setReference(e.target.value)} data-testid="incident-report-reference" />
      </Field>
      <label className={confirmRowClass}>
        <input type="checkbox" className={confirmBoxClass} checked={absent} onChange={(e) => setAbsent(e.target.checked)} data-testid="incident-report-reference-absent" />
        <span>{INCIDENT_REPORT_REFERENCE_ABSENT_LABEL}</span>
      </label>
      <Field label="メモ" required={false} error={errors["note"]}>
        <textarea className={inputClass} rows={2} value={note} maxLength={INCIDENT_LIMITS.reportNote} onChange={(e) => setNote(e.target.value)} data-testid="incident-report-note" />
      </Field>
      <label className={confirmRowClass}>
        <input type="checkbox" className={confirmBoxClass} checked={checked} aria-invalid={errors["checks"] ? true : undefined} aria-describedby={errors["checks"] ? "incident-report-err-checks" : undefined} onChange={(e) => setChecked(e.target.checked)} data-testid="incident-report-check" />
        <span>{INCIDENT_REPORT_CHECK_LABEL.reportCompleted}</span>
      </label>
      <FieldError id="incident-report-err-checks" message={errors["checks"]} />
      <SubmitRow message={message}>
        <button type="submit" data-variant="primary" className={buttonPrimaryClass} disabled={busy || !checked} data-testid="incident-report-submit">
          報告の結果を記録する
        </button>
        {!checked ? <span className="text-sm text-sb-ink-2">確認のチェックを入れると記録できます。</span> : null}
      </SubmitRow>
    </form>
  );
}

/** 報告の要否を国土交通省などに確かめたことを記録する（利用者の申告）。 */
export function IncidentConsultedForm({ id, defaultDoneAt }: { readonly id: string; readonly defaultDoneAt: string }) {
  const d0 = splitJst(defaultDoneAt);
  const [date, setDate] = useState(d0.date);
  const [time, setTime] = useState(d0.time);
  const [note, setNote] = useState("");
  const [checked, setChecked] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { formRef, requestErrorFocus } = useErrorFocus();
  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!checked) return;
    setBusy(true);
    const r = await send("POST", `/api/ops/incidents/${id}/reports`, {
      action: "consulted",
      doneAt: joinJst(date, time) || null,
      note: note.trim() || null,
      checks: { consultationDone: true },
    });
    setBusy(false);
    if (!r.ok) {
      setErrors(fieldErrorsOf(r));
      setMessage(messageOf(r));
      requestErrorFocus();
      return;
    }
    reloadAfterChange({ target: "incident-report", message: "報告の要否を確かめたことを記録しました（利用者の申告）。" });
  };
  return (
    <form ref={formRef} onSubmit={onSubmit} className="flex flex-col gap-4" aria-label="報告の要否を確かめた記録" data-testid="incident-consult-form">
      <IncidentReportRecordNotice />
      <JstDateTimeField label="確かめた日時" date={date} time={time} onDate={setDate} onTime={setTime} error={errors["doneAt"]} testId="incident-consult-done" />
      <Field label="確かめた相手と結果の要点" required error={errors["note"]} hint={INCIDENT_CONSULT_NOTE_HINT}>
        <textarea className={inputClass} rows={3} value={note} maxLength={INCIDENT_LIMITS.reportNote} onChange={(e) => setNote(e.target.value)} data-testid="incident-consult-note" />
      </Field>
      <label className={confirmRowClass}>
        <input type="checkbox" className={confirmBoxClass} checked={checked} aria-invalid={errors["checks"] ? true : undefined} aria-describedby={errors["checks"] ? "incident-consult-err-checks" : undefined} onChange={(e) => setChecked(e.target.checked)} data-testid="incident-consult-check" />
        <span>{INCIDENT_REPORT_CHECK_LABEL.consultationDone}</span>
      </label>
      <FieldError id="incident-consult-err-checks" message={errors["checks"]} />
      <SubmitRow message={message}>
        <button type="submit" data-variant="primary" className={buttonPrimaryClass} disabled={busy || !checked} data-testid="incident-consult-submit">
          要否を確かめたことを記録する
        </button>
        {!checked ? <span className="text-sm text-sb-ink-2">確認のチェックを入れると記録できます。</span> : null}
      </SubmitRow>
    </form>
  );
}

/** 報告・確認の記録の取り下げ（理由が要る。元の行は残る）。 */
export function IncidentRetractForm({ id, targetRecordId }: { readonly id: string; readonly targetRecordId: string }) {
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { formRef, requestErrorFocus } = useErrorFocus();
  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const r = await send("POST", `/api/ops/incidents/${id}/reports`, { action: "retract", targetRecordId, reason });
    setBusy(false);
    if (!r.ok) {
      setErrors(fieldErrorsOf(r));
      setMessage(messageOf(r));
      requestErrorFocus();
      return;
    }
    reloadAfterChange({ target: "incident-report", message: "記録を取り下げました。元の記録は残っています。" });
  };
  return (
    <form ref={formRef} onSubmit={onSubmit} className="flex flex-col gap-3" aria-label="記録の取り下げ" data-testid="incident-retract-form">
      <Field label="取り下げの理由" required error={errors["reason"]} hint="例：別の記録に付けてしまった。元の記録は消えずに残ります。">
        <textarea className={inputClass} rows={2} value={reason} maxLength={INCIDENT_LIMITS.reason} onChange={(e) => setReason(e.target.value)} data-testid="incident-retract-reason" />
      </Field>
      <FormError message={message} />
      <button type="submit" className={`${buttonDangerClass} self-start`} disabled={busy} data-testid="incident-retract-submit">
        この記録を取り下げる
      </button>
    </form>
  );
}
