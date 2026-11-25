"use client";

// 通報の画面（Sprint 12b 設計 H）：通報内容を DIPS の入力順に並べ、項目ごとにコピーできる。通報の結果の記録、訂正・取り下げ・
// 結果不明の確定・再送、取消の記録、履歴と監査の表示。
// そらばんは DIPS に送信しない（模擬は同じプロセスの中の結果を返すだけ）。記録するまで「通報済み」とは出さない。
// 判断（二つの確認・番号の有無・未来の日時・版・認可・冪等性）はサーバーが行い、画面は結果を示すだけ。
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  ATTEMPT_RESULT_LABEL,
  COPY_AUDIT_NOTE,
  DIPS_ONLY_LABEL,
  fieldByKey,
  LICENSE_MASKED_NOTE,
  PREPARE_WARNING_MESSAGE,
  MANUAL_CONFIRM_DIPS_DONE,
  MANUAL_CONFIRM_MATCHES_LATEST,
  MANUAL_NUMBER_UNAVAILABLE_LABEL,
  MISSING_VALUE_LABEL,
  MOCK_ASSUMPTION_NOTE,
  NEEDS_CONFIRMATION_MARK,
  NOT_APPLICABLE_LABEL,
  OFFICIAL_PROCEDURE_NOTE,
  REPORT_NOTICE_BY_CHANNEL,
  REPORT_SELF_REPORT_NOTE,
  ROUTE_GUIDE,
  type MockScenario,
  type PreparedItem,
  type ReportInputs,
  type ReportKind,
} from "@soraban/dips";
import { BOUNDARY_REGISTRATION } from "@/lib/boundary";
import type { AttemptDto, PlanReportView, ReportDto } from "@/server/ops/reports";
import { DeadlineBox, ReportBadge, ReportBox, ReportStatusBadge, ReportStatusBox } from "./plan-ui";
import { REPORT_NOTE_SHORT, VOIDED_NO_RECORD_LABEL, VOIDED_NO_RECORD_NOTE } from "@/lib/plan-main";
import { loadDraft, saveDraft, clearDraft, reportDraftKey } from "./drafts";
import { Field, fieldErrorsOf, FieldError, FormError, inputClass, messageFor, reloadAfterChange, send, useErrorFocus, type ApiResult } from "./ops-client";
import { confirmBoxClass, confirmRowClass, joinJst, JstDateTimeField, splitJst } from "./report-parts";
import { buttonDangerClass, buttonGhostClass, buttonOutlineBrandClass, buttonPrimaryClass, Badge, Note, Section } from "./ui";

const call = async (method: string, url: string, body?: unknown): Promise<ApiResult> => {
  try {
    return await send(method, url, body);
  } catch {
    return { ok: false, status: 0, data: { error: "network" } };
  }
};
const failMessage = (r: ApiResult): string =>
  r.status === 0 ? "通信できませんでした。入力した内容は画面に残っています。通信が戻ってから、もう一度操作してください。" : messageFor(r);

const copyToClipboard = async (text: string): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // 続けて古い方法を試す
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
};

// ---- 通報の画面の入力 ------------------------------------------------

type InputsForm = {
  reportName: string;
  purposes: number[];
  otherBusinessText: string;
  otherNonBusinessText: string;
  assistantsNumber: string;
  departurePoint: string;
  destinationPoint: string;
  plannedMaxTime: string;
  flightSpeed: string;
  onsiteControlL3: string;
  onsiteControlL35: string;
  onsiteControl2: string;
  mooring: string;
};

const str = (v: string | number | null | undefined): string => (v === null || v === undefined ? "" : String(v));

const formFrom = (i: ReportInputs): InputsForm => ({
  reportName: str(i.reportName),
  purposes: [...(i.flightPurposes ?? [])],
  otherBusinessText: str(i.otherBusinessText),
  otherNonBusinessText: str(i.otherNonBusinessText),
  assistantsNumber: str(i.assistantsNumber),
  departurePoint: str(i.departurePoint),
  destinationPoint: str(i.destinationPoint),
  plannedMaxTime: str(i.plannedMaxTime),
  flightSpeed: str(i.flightSpeed),
  onsiteControlL3: str(i.onsiteControlL3),
  onsiteControlL35: str(i.onsiteControlL35),
  onsiteControl2: str(i.onsiteControl2),
  mooring: str(i.mooring),
});

const text = (v: string): string | null => (v.trim() === "" ? null : v);
const toInputs = (f: InputsForm): Record<string, unknown> => ({
  reportName: text(f.reportName),
  flightPurposes: f.purposes.length === 0 ? null : f.purposes,
  otherBusinessText: text(f.otherBusinessText),
  otherNonBusinessText: text(f.otherNonBusinessText),
  assistantsNumber: text(f.assistantsNumber),
  departurePoint: text(f.departurePoint),
  destinationPoint: text(f.destinationPoint),
  plannedMaxTime: text(f.plannedMaxTime),
  flightSpeed: text(f.flightSpeed),
  onsiteControlL3: text(f.onsiteControlL3),
  onsiteControlL35: text(f.onsiteControlL35),
  onsiteControl2: text(f.onsiteControl2),
  mooring: text(f.mooring),
});

const FLAG_CHOICES = [
  { value: "", label: "未選択" },
  { value: "1", label: "講じる・行う" },
  { value: "0", label: "講じない・行わない" },
] as const;

const SCENARIOS: readonly { readonly value: MockScenario; readonly label: string }[] = [
  { value: "ok", label: "ok：受理（番号と受付日時を返す）" },
  { value: "rejected", label: "rejected：失敗（パラメータ不正・400 相当）" },
  { value: "unauthorized", label: "unauthorized：失敗（トークン切れ・401 相当）" },
  { value: "server_error", label: "server_error：結果不明（500 相当）" },
  { value: "timeout", label: "timeout：結果不明（応答なし）" },
  { value: "unknown_status", label: "unknown_status：受理（未知の外部状況）" },
];

function InputsPanel({
  form,
  setForm,
  errors,
  preview,
}: {
  readonly form: InputsForm;
  readonly setForm: (f: (s: InputsForm) => InputsForm) => void;
  readonly errors: Record<string, string>;
  readonly preview: "idle" | "busy";
}) {
  const purposeCodes = fieldByKey("purposes")?.codes ?? {};
  const set = <K extends keyof InputsForm>(k: K, v: InputsForm[K]) => setForm((s) => ({ ...s, [k]: v }));
  const textField = (k: keyof InputsForm, label: string, hint?: string, mode?: "numeric") => (
    <Field label={label} required={false} error={errors[k]} {...(hint ? { hint } : {})}>
      <input
        className={`${inputClass} min-h-12`}
        value={form[k] as string}
        {...(mode ? { inputMode: mode } : {})}
        onChange={(e) => set(k, e.target.value as never)}
        data-testid={`report-input-${k}`}
      />
    </Field>
  );
  const flagField = (k: "onsiteControlL3" | "onsiteControlL35" | "onsiteControl2" | "mooring", label: string) => (
    <Field label={label} required={false} error={errors[k]}>
      <select className={`${inputClass} min-h-12`} value={form[k]} onChange={(e) => set(k, e.target.value)} data-testid={`report-input-${k}`}>
        {FLAG_CHOICES.map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      </select>
    </Field>
  );
  return (
    <div className="flex flex-col gap-4" data-testid="report-inputs">
      <p className="opx-note opx-note-lg text-sb-ink-2">
        計画にない項目を入れます。入力は、この端末の下書きに残り（サーバーには、記録するときに送ります）、下の「DIPS の入力順の項目」に反映されます。
        {preview === "busy" ? <span role="status" className="ml-2 text-sb-ink-2" data-testid="report-preview-busy">更新中…</span> : null}
      </p>
      {textField("reportName", "通報用の名称", "計画名が 30 文字を超えるときに入力します（30 文字以内）。")}
      <fieldset className="flex min-w-0 flex-col gap-2">
        <legend className="mb-1.5 flex flex-wrap items-baseline gap-x-3 text-sm font-medium text-sb-ink">
          <span>飛行目的（複数選べます）</span>
          <span className="sb-num text-sm font-normal tnum text-sb-ink-3" data-testid="report-purpose-count">{form.purposes.length} / {Object.keys(purposeCodes).length} 選択</span>
        </legend>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,8rem),1fr))] gap-2">
          {Object.entries(purposeCodes).map(([code, label]) => {
            const n = Number(code);
            return (
              <label key={code} className={`${confirmRowClass} opx-check-dense gap-2 px-2.5 sm:gap-3 sm:px-3`}>
                <input
                  type="checkbox"
                  className={confirmBoxClass}
                  checked={form.purposes.includes(n)}
                  aria-invalid={errors["flightPurposes"] ? true : undefined}
                  aria-describedby={errors["flightPurposes"] ? "report-err-flightPurposes" : undefined}
                  onChange={(e) => set("purposes", e.target.checked ? [...form.purposes, n].sort((a, b) => a - b) : form.purposes.filter((x) => x !== n))}
                  data-testid={`report-input-purpose-${code}`}
                />
                <span>{label}</span>
              </label>
            );
          })}
        </div>
        <FieldError id="report-err-flightPurposes" message={errors["flightPurposes"]} />
      </fieldset>
      {form.purposes.includes(13) ? textField("otherBusinessText", "その他1（業務）の理由") : null}
      {form.purposes.includes(16) ? textField("otherNonBusinessText", "その他2（業務以外）の理由") : null}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {textField("assistantsNumber", "補助者の人数", "補助者なしは 0。", "numeric")}
        {textField("plannedMaxTime", "航続可能時間（分）", "5 分単位、5〜1440。", "numeric")}
        {textField("flightSpeed", "飛行速度（km/h）", "整数 1〜999。", "numeric")}
        {textField("departurePoint", "出発地", "空欄のときは何も入りません（目的地は、空欄なら計画の場所の名称）。")}
        {textField("destinationPoint", "目的地")}
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {flagField("onsiteControlL3", "立入管理措置（レベル3飛行）")}
        {flagField("onsiteControlL35", "立入管理措置（レベル3.5飛行関連）")}
        {flagField("onsiteControl2", "立入禁止措置")}
        {flagField("mooring", "係留飛行")}
      </div>
    </div>
  );
}

// ---- DIPS の入力順の項目 ---------------------------------------------

function ItemRow({
  item,
  copied,
  onCopy,
  maskedLicense,
}: {
  readonly item: PreparedItem;
  readonly copied: boolean;
  readonly onCopy: (item: PreparedItem) => void;
  readonly maskedLicense: boolean;
}) {
  const isRoute = item.status === "route";
  const showApi = item.apiValue !== null && item.apiValue !== item.value && !isRoute && item.status === "filled";
  // そらばんが持たない項目（DIPS で入力）は、値もコピーも無いので 1 行に縮める（縦を稼ぐ）。
  const compact = item.status === "dips_only" || item.status === "not_applicable";
  const canCopy = item.copyable && item.copyText !== null;
  return (
    <li
      className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-0 border-b border-sb-rule px-2 sm:grid-cols-[minmax(0,15rem)_minmax(0,1fr)_auto] sm:gap-x-5 sm:px-3 lg:grid-cols-[minmax(0,9rem)_minmax(0,1fr)_auto] lg:gap-x-3 break-inside-avoid py-0.5 ${
        item.status === "missing" ? "bg-sb-sunken" : ""
      } ${compact ? "max-sm:px-0" : ""}`}
      data-testid={`report-item-${item.key}`}
      data-status={item.status}
    >
      {/* 項目名（左）。必須は項目名に並べ、API 名・DIPS の画面での名前は 1 行の小さな字にまとめる */}
      <div className="col-start-1 row-start-1 flex min-w-0 flex-col">
        <span data-note="" className="flex flex-wrap items-baseline gap-x-2 text-sm font-medium leading-snug text-sb-ink">
          {compact ? <span aria-hidden className="sb-num text-sb-ink-3">－</span> : null}
          <span data-testid={`report-item-label-${item.key}`}>{item.label}</span>
          {item.required && item.status !== "dips_only" ? <span className="opx-required">必須</span> : null}
          {item.apiField || item.dipsScreenLabel ? (
            <span className="break-all text-sm font-normal leading-snug text-sb-ink-3">
              {item.apiField ? <span className="sb-num">{item.apiField}</span> : null}
              {item.apiField && item.dipsScreenLabel ? "／" : ""}
              {item.dipsScreenLabel ? <>DIPS の画面：{item.dipsScreenLabel}</> : null}
            </span>
          ) : null}
        </span>
      </div>

      {/* コピー（右。44px 以上）とコピー済みの表示 */}
      {canCopy || copied ? (
        <div className="col-start-2 row-span-2 row-start-1 flex flex-col items-end gap-1 sm:col-start-3 sm:row-span-1">
          {canCopy ? (
            <button
              type="button"
              className={`${buttonGhostClass} min-w-[5.25rem] border-sb-ink font-medium text-sb-ink hover:bg-sb-hover`}
              onClick={() => onCopy(item)}
              data-testid={`report-copy-${item.key}`}
              aria-label={`${item.label}をコピー`}
            >
              コピー
            </button>
          ) : null}
          {copied ? (
            <span role="status" className="inline-flex items-center gap-1 rounded-sb-m border border-sb-ink bg-sb-base px-1.5 text-sm leading-5 text-sb-ink" data-testid={`report-copied-${item.key}`}>
              <span aria-hidden className="sb-num font-bold text-sb-ink">✓</span>コピーしました
            </span>
          ) : null}
        </div>
      ) : null}

      {/* 値・補足 */}
      <div className={`flex min-w-0 flex-col gap-1 sm:col-span-1 sm:col-start-2 sm:row-start-1 ${canCopy || copied ? "col-start-1 row-start-2" : "col-span-2 row-start-2"}`}>
        {item.status === "filled" ? (
          <span className="min-w-0 break-all rounded-sb-m bg-sb-sunken px-2 py-0.5 sb-num tnum text-sb-ink" data-testid={`report-item-value-${item.key}`}>
            {item.value}
            {item.unit ? <span className="ml-1 text-sb-ink-2">{item.unit}</span> : null}
          </span>
        ) : item.status === "missing" ? (
          <span className="inline-flex items-start gap-2 font-medium text-sb-ink" data-testid={`report-item-value-${item.key}`}>
            <span aria-hidden data-note="" className="mt-px inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-sb-m border border-sb-ink bg-sb-st-warn-face sb-num text-sm font-bold leading-none">!</span>
            <span>{MISSING_VALUE_LABEL}</span>
          </span>
        ) : item.status === "dips_only" ? (
          <span data-note="" className="text-sm text-sb-ink-2" data-testid={`report-item-value-${item.key}`}>
            <span>{item.apiField && item.value ? item.value.replace(`（${item.apiField}）`, "") : (item.value ?? DIPS_ONLY_LABEL)}</span>
          </span>
        ) : item.status === "not_applicable" ? (
          <span data-note="" className="inline-flex items-start gap-2 text-sm text-sb-ink-2" data-testid={`report-item-value-${item.key}`}>
            <span aria-hidden className="w-5 shrink-0 text-center sb-num text-sb-ink-3">－</span>
            <span>{NOT_APPLICABLE_LABEL}</span>
          </span>
        ) : (
          <span className="min-w-0 break-all rounded-sb-m bg-sb-sunken px-2 py-0.5 sb-num tnum text-sb-ink" data-testid={`report-item-value-${item.key}`}>
            {item.value}
          </span>
        )}
        {item.key === "skill_number" && maskedLicense ? (
          <p data-note="" className="text-sm leading-relaxed text-sb-ink-2" data-testid="report-license-masked-note">
            {LICENSE_MASKED_NOTE}
          </p>
        ) : null}
        {isRoute ? (
          <div className="flex flex-col gap-1.5 opx-note opx-note-lg" data-testid="report-route">
            <p className="text-sb-ink-2" data-testid="report-route-guide">
              {ROUTE_GUIDE}
            </p>
            {item.apiValue ? (
              <details className="text-sb-ink-3">
                <summary className="inline-flex min-h-12 cursor-pointer select-none items-center text-sb-ink underline-offset-2 hover:underline">API 形式（参考）</summary>
                <p data-note="" className="break-all sb-num tnum" data-testid="report-route-geojson">{item.apiValue}</p>
              </details>
            ) : null}
          </div>
        ) : null}
        {showApi ? (
          <p data-note="" className="break-all sb-num text-sm leading-relaxed tnum text-sb-ink-3" data-testid={`report-item-api-${item.key}`}>
            API 形式：{item.apiValue}
          </p>
        ) : null}
        {item.warnings.length > 0 ? (
          <ul className="flex flex-col gap-1 text-sb-ink-2" data-testid={`report-item-warnings-${item.key}`}>
            {item.warnings.map((w) => (
              <li key={w.code} className="flex gap-2 opx-note opx-note-lg">
                <span aria-hidden className="sb-num font-bold text-sb-ink">!</span>
                <span>{w.message}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </li>
  );
}

// ---- 記録のフォーム --------------------------------------------------

type ManualFields = {
  date: string;
  time: string;
  dipsNumber: string;
  numberUnavailable: boolean;
  memo: string;
  confirmedDipsDone: boolean;
  confirmedMatchesLatest: boolean;
};

const EMPTY_MANUAL: ManualFields = { date: "", time: "", dipsNumber: "", numberUnavailable: false, memo: "", confirmedDipsDone: false, confirmedMatchesLatest: false };

const manualBody = (m: ManualFields) => ({
  reportedAt: joinJst(m.date, m.time) || null,
  dipsNumber: m.numberUnavailable || m.dipsNumber.trim() === "" ? null : m.dipsNumber,
  numberUnavailable: m.numberUnavailable,
  memo: m.memo.trim() === "" ? null : m.memo,
  confirmedDipsDone: m.confirmedDipsDone,
  confirmedMatchesLatest: m.confirmedMatchesLatest,
});

function ManualFormFields({
  m,
  setM,
  errors,
  testPrefix,
  withConfirmations,
}: {
  readonly m: ManualFields;
  readonly setM: (f: (s: ManualFields) => ManualFields) => void;
  readonly errors: Record<string, string>;
  readonly testPrefix: string;
  readonly withConfirmations: boolean;
}) {
  return (
    <>
      <JstDateTimeField
        label="通報した日時"
        date={m.date}
        time={m.time}
        onDate={(v) => setM((s) => ({ ...s, date: v }))}
        onTime={(v) => setM((s) => ({ ...s, time: v }))}
        error={errors["reportedAt"]}
        testId={`${testPrefix}-reported-at`}
        hint="DIPS で通報した日時（日本時間）。未来の日時は記録できません。"
      />
      <Field label="DIPS の番号" required={false} error={errors["dipsNumber"] ?? errors["numberUnavailable"]} hint="DIPS の画面に表示された番号。表示されなかったときは、下の宣言を選びます。">
        <input
          className={`${inputClass} min-h-12 sb-num tnum`}
          value={m.dipsNumber}
          disabled={m.numberUnavailable}
          onChange={(e) => setM((s) => ({ ...s, dipsNumber: e.target.value }))}
          data-testid={`${testPrefix}-dips-number`}
        />
      </Field>
      <label className={confirmRowClass}>
        <input
          type="checkbox"
          className={confirmBoxClass}
          checked={m.numberUnavailable}
          onChange={(e) => setM((s) => ({ ...s, numberUnavailable: e.target.checked, dipsNumber: e.target.checked ? "" : s.dipsNumber }))}
          data-testid={`${testPrefix}-number-unavailable`}
        />
        <span>{MANUAL_NUMBER_UNAVAILABLE_LABEL}</span>
      </label>
      <Field
        label="控えのメモ"
        required={m.numberUnavailable}
        error={errors["memo"]}
        hint={m.numberUnavailable ? "番号がないときは必須です（画面の表示・時刻など。500 文字以内）。" : "500 文字以内"}
      >
        <textarea className={inputClass} rows={2} value={m.memo} onChange={(e) => setM((s) => ({ ...s, memo: e.target.value }))} data-testid={`${testPrefix}-memo`} />
      </Field>
      {withConfirmations ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm text-sb-ink-3">確認（どちらも必要です）</legend>
          <label className={confirmRowClass}>
            <input
              type="checkbox"
              className={confirmBoxClass}
              checked={m.confirmedDipsDone}
              aria-invalid={errors["confirmedDipsDone"] ? true : undefined}
              aria-describedby={errors["confirmedDipsDone"] ? `${testPrefix}-err-confirmedDipsDone` : undefined}
              onChange={(e) => setM((s) => ({ ...s, confirmedDipsDone: e.target.checked }))}
              data-testid={`${testPrefix}-confirm-done`}
            />
            <span>{MANUAL_CONFIRM_DIPS_DONE}</span>
          </label>
          <FieldError id={`${testPrefix}-err-confirmedDipsDone`} message={errors["confirmedDipsDone"]} />
          <label className={confirmRowClass}>
            <input
              type="checkbox"
              className={confirmBoxClass}
              checked={m.confirmedMatchesLatest}
              aria-invalid={errors["confirmedMatchesLatest"] ? true : undefined}
              aria-describedby={errors["confirmedMatchesLatest"] ? `${testPrefix}-err-confirmedMatchesLatest` : undefined}
              onChange={(e) => setM((s) => ({ ...s, confirmedMatchesLatest: e.target.checked }))}
              data-testid={`${testPrefix}-confirm-latest`}
            />
            <span>{MANUAL_CONFIRM_MATCHES_LATEST}</span>
          </label>
          <FieldError id={`${testPrefix}-err-confirmedMatchesLatest`} message={errors["confirmedMatchesLatest"]} />
        </fieldset>
      ) : null}
    </>
  );
}

// ---- 履歴の 1 行と操作 -----------------------------------------------

type ActionKind = "correct" | "retract" | "resolve" | "retry";

function RowActions({ report }: { readonly report: ReportDto }) {
  const [open, setOpen] = useState<ActionKind | null>(null);
  const [reason, setReason] = useState("");
  const [m, setM] = useState<ManualFields>(() => {
    const at = splitJst(report.reportedAt);
    return { ...EMPTY_MANUAL, date: at.date, time: at.time, dipsNumber: report.dipsNumber ?? "", numberUnavailable: report.numberUnavailable, memo: report.memo ?? "" };
  });
  const [outcome, setOutcome] = useState<"reported" | "not_reported">("reported");
  const [confirmSend, setConfirmSend] = useState(false);
  const [scenario, setScenario] = useState<MockScenario>("ok");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { formRef, requestErrorFocus } = useErrorFocus();
  const base = `/api/ops/plans/${report.planId}/reports/${report.id}`;
  const a = report.actions;
  if (!a.correct && !a.retract && !a.resolve && !a.retry) return null;

  const done = async (r: ApiResult, notice: string) => {
    setBusy(false);
    if (!r.ok) {
      setErrors(fieldErrorsOf(r));
      setMessage(failMessage(r));
      requestErrorFocus();
      return;
    }
    reloadAfterChange({ target: "report", message: notice });
  };

  const submit = async () => {
    setBusy(true);
    setMessage(null);
    setErrors({});
    if (open === "correct") {
      const b = manualBody(m);
      await done(
        await call("PATCH", base, { expectedVersion: report.version, reason, reportedAt: b.reportedAt, dipsNumber: b.dipsNumber, numberUnavailable: b.numberUnavailable, memo: b.memo }),
        "記録を訂正しました。元の値は履歴に残っています。",
      );
    } else if (open === "retract") {
      await done(await call("POST", `${base}/retract`, { expectedVersion: report.version, reason }), "記録を取り下げました。元の記録は履歴に残っています。");
    } else if (open === "resolve") {
      await done(
        await call("POST", `${base}/resolve`, {
          expectedVersion: report.version,
          reason,
          outcome,
          ...(outcome === "reported" ? { manual: manualBody({ ...m, confirmedDipsDone: true, confirmedMatchesLatest: true }) } : {}),
        }),
        outcome === "reported" ? "結果不明を、通報済み（利用者の申告）として確定しました。" : "結果不明を、通報されていなかったものとして確定しました。",
      );
    } else if (open === "retry") {
      await done(await call("POST", `${base}/retry`, { confirmSend, mockScenario: scenario }), "再送しました（模擬）。");
    }
  };

  const btn = (k: ActionKind, label: string, danger = false) => (
    <button
      type="button"
      className={danger ? buttonDangerClass : buttonOutlineBrandClass}
      aria-expanded={open === k}
      onClick={() => {
        setOpen(open === k ? null : k);
        setMessage(null);
        setErrors({});
      }}
      data-testid={`report-action-${k}`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex flex-col gap-3 border-t border-sb-rule pt-3" data-testid="report-actions">
      <div className="flex flex-wrap gap-2">
        {a.correct ? btn("correct", "記録を訂正する") : null}
        {a.retract ? btn("retract", "記録を取り下げる", true) : null}
        {a.resolve ? btn("resolve", "結果不明を確定する") : null}
        {a.retry ? btn("retry", "再送する（模擬）") : null}
      </div>
      {open ? (
        <form
          ref={formRef}
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          className="flex flex-col gap-3 rounded-sb-m border border-sb-rule bg-sb-sunken px-3 py-3 sm:px-4"
          aria-label={open === "correct" ? "記録の訂正" : open === "retract" ? "記録の取り下げ" : open === "resolve" ? "結果不明の確定" : "失敗した送信の再送"}
          data-testid={`report-${open}-form`}
        >
          {open === "retract" ? (
            <Note tone="red" body>
              取り下げは「記録の誤り（通報していないのに記録した）」を直す操作です。通報を取り消す場合は、取消の記録を使います。元の記録は履歴に残ります。
            </Note>
          ) : null}
          {open === "resolve" ? (
            <>
              <Note body>DIPS の画面で確かめた結果を選んでください。自動では再送しません。</Note>
              <Field label="DIPS の画面で確かめた結果" required>
                <select className={`${inputClass} min-h-12`} value={outcome} onChange={(e) => setOutcome(e.target.value as "reported" | "not_reported")} data-testid="report-resolve-outcome">
                  <option value="reported">通報されていた</option>
                  <option value="not_reported">通報されていなかった</option>
                </select>
              </Field>
              {outcome === "reported" ? <ManualFormFields m={m} setM={setM} errors={errors} testPrefix="resolve" withConfirmations={false} /> : null}
            </>
          ) : null}
          {open === "correct" ? <ManualFormFields m={m} setM={setM} errors={errors} testPrefix="correct" withConfirmations={false} /> : null}
          {open === "retry" ? (
            <>
              <Note body>同じ行・同じ冪等性キーで再送します（二重にはなりません）。{MOCK_ASSUMPTION_NOTE}</Note>
              <Field label="模擬のシナリオ（開発用）" required={false}>
                <select className={`${inputClass} min-h-12`} value={scenario} onChange={(e) => setScenario(e.target.value as MockScenario)} data-testid="report-retry-scenario">
                  {SCENARIOS.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </Field>
              <label className={confirmRowClass}>
                <input type="checkbox" className={confirmBoxClass} checked={confirmSend} onChange={(e) => setConfirmSend(e.target.checked)} data-testid="report-retry-confirm" />
                <span>送信内容を確認した（実際の DIPS には送信されません）</span>
              </label>
            </>
          ) : (
            <Field label={open === "correct" ? "訂正の理由" : open === "retract" ? "取り下げの理由" : "確定の理由"} required error={errors["reason"]} hint="記録の履歴に残ります。">
              <textarea className={inputClass} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} data-testid={`report-${open}-reason`} />
            </Field>
          )}
          <FormError message={message} />
          <div>
            <button type="submit" data-variant={open === "retract" ? undefined : "primary"} className={open === "retract" ? buttonDangerClass : buttonPrimaryClass} disabled={busy || (open === "retry" && !confirmSend)} data-testid={`report-${open}-submit`}>
              {open === "correct" ? "訂正を保存する" : open === "retract" ? "取り下げる" : open === "resolve" ? "確定する" : "再送する"}
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

function ReportRow({ r }: { readonly r: ReportDto }) {
  const tone = r.effectiveState === "reported_manual" || r.effectiveState === "submitted_api" ? "green" : r.effectiveState === "retracted" ? "mute" : r.effectiveState === "failed" ? "red" : "amber";
  const glyph = { reported_manual: "✓", submitted_api: "✓", retracted: "－", failed: "×", unknown: "？", prepared: "…" }[r.effectiveState];
  const pair = (k: string, v: ReactNode, testId?: string, wide = false) => (
    <div className={`flex min-w-0 flex-col gap-0.5 ${wide ? "col-span-2 sm:col-span-4" : ""}`}>
      <dt className="text-sm text-sb-ink-2">{k}</dt>
      <dd data-note="" className="min-w-0 break-all sb-num text-sm tnum text-sb-ink" {...(testId ? { "data-testid": testId } : {})}>
        {v}
      </dd>
    </div>
  );
  const idBox = "inline-block max-w-full rounded-sb-m bg-sb-sunken px-1.5 py-0.5 text-sm leading-relaxed";
  return (
    <li
      className={`flex flex-col gap-3 border-b border-sb-rule py-4 ${r.isEffective ? "opx-edge-hl" : ""}`}
      data-testid="report-row"
      data-id={r.id}
      data-kind={r.kind}
      data-status={r.effectiveState}
      data-channel={r.channel}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        {r.isEffective ? (
          <Badge tone="green" data-testid="report-row-effective">
            <span aria-hidden className="mr-1">●</span>有効な通報
          </Badge>
        ) : null}
        <Badge tone="brand" data-testid="report-row-kind">{r.kindLabel}</Badge>
        <Badge tone="neutral" data-testid="report-row-channel">{r.channelLabel}</Badge>
        <Badge tone={tone} data-testid="report-row-state">
          <span aria-hidden className="mr-1">{glyph}</span>
          <span data-testid="report-row-status">{r.statusLabel}</span>
        </Badge>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 sm:grid-cols-4">
        <div className="col-span-2 flex min-w-0 flex-col gap-0.5">
          <dt className="text-sm text-sb-ink-2">通報日時</dt>
          <dd data-note="" className="sb-num text-sm font-medium tnum text-sb-ink" data-testid="report-row-reported-at">{r.reportedAtJst ?? "—"}</dd>
        </div>
        <div className="col-span-2 flex min-w-0 flex-col gap-0.5">
          <dt className="text-sm text-sb-ink-2">DIPS の番号</dt>
          <dd data-note="" className="min-w-0 break-all sb-num text-sm font-medium tnum text-sb-ink" data-testid="report-row-number">
            {r.dipsNumber ?? (r.numberUnavailable ? "番号なし（表示されなかった）" : "—")}
          </dd>
        </div>
        <details className="col-span-2 sm:col-span-4" data-testid="report-row-details">
          <summary className="flex min-h-12 cursor-pointer select-none items-center text-sm text-sb-ink underline-offset-2 hover:underline">記録の詳細（版・証跡 ID・記録した日時）</summary>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 pb-2 sm:grid-cols-4">
        {pair("記録の版", r.version, "report-row-version")}
        {pair("計画の版", r.planVersion, "report-row-plan-version")}
        {pair("対応表の版", r.mapRevision, "report-row-map-revision")}
        {pair("判定の通し番号", r.snapshotSeq)}
        <div className="col-span-2 flex min-w-0 flex-col gap-0.5 sm:col-span-4">
          <dt className="text-sm text-sb-ink-2">地点判定の証跡 ID</dt>
          <dd data-note="" className="min-w-0"><span className={`${idBox} break-all sb-num tnum text-sb-ink`} data-testid="report-row-check-evidence">{r.checkEvidenceId}</span></dd>
        </div>
        <div className="col-span-2 flex min-w-0 flex-col gap-0.5 sm:col-span-4">
          <dt className="text-sm text-sb-ink-2">飛行の方法を含む判定の証跡 ID</dt>
          <dd data-note="" className="min-w-0"><span className={`${idBox} break-all sb-num tnum text-sb-ink`} data-testid="report-row-diagnosis-evidence">{r.diagnosisEvidenceId}</span></dd>
        </div>
        {pair("記録した日時", r.createdAtJst, undefined, true)}
          </div>
        </details>
      </dl>
      {r.memo ? <p className="break-all opx-note opx-note-lg text-sb-ink-2" data-testid="report-row-memo">メモ：{r.memo}</p> : null}
      {r.errorMessage ? (
        <p className="opx-note opx-note-lg text-sb-ink" data-testid="report-row-error">
          <span aria-hidden className="mr-1.5 sb-num font-bold">×</span>
          {r.errorMessage}
        </p>
      ) : null}
      {r.externalStatusLabel ? <p className="text-sb-ink-2" data-testid="report-row-external-status">{r.externalStatusLabel}</p> : null}
      {r.stale ? (
        <p className="opx-note opx-note-lg text-sb-ink" data-testid="report-row-stale">
          <span aria-hidden className="mr-1.5 sb-num font-bold">!</span>
          送信の途中で止まった可能性があります。自動では再送しません。
        </p>
      ) : null}
      <RowActions report={r} />
    </li>
  );
}

function AuditList({ audit }: { readonly audit: readonly AttemptDto[] }) {
  if (audit.length === 0) return <p className="text-sb-ink-3" data-testid="report-audit-empty">監査の記録はまだありません。</p>;
  return (
    <ol className="flex flex-col border-t border-sb-rule" data-testid="report-audit">
      {audit.map((a) => (
        <li key={a.id} data-note="" className="flex flex-col gap-0.5 border-b border-sb-rule py-2 text-sm text-sb-ink-2" data-testid="report-audit-row" data-operation={a.operation} data-result={a.result}>
          <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
            <span className="font-medium text-sb-ink">{a.operationLabel}</span>
            <span>{ATTEMPT_RESULT_LABEL[a.result] ?? a.result}</span>
            <span>{a.memberName}（{a.memberRole}）</span>
            <span>送信元：{a.adapter}</span>
            <time dateTime={a.createdAt} className="sb-num tnum">{a.createdAtJst}</time>
          </span>
          {a.summary ? <span className="break-all">{a.summary}</span> : null}
        </li>
      ))}
    </ol>
  );
}

// ---- 画面全体 --------------------------------------------------------

export function ReportScreen({ initial, memberId }: { readonly initial: PlanReportView; readonly memberId: string }) {
  const [view, setView] = useState<PlanReportView>(initial);
  const [kind, setKind] = useState<ReportKind>(initial.kind);
  const [form, setFormState] = useState<InputsForm>(() => formFrom(initial.inputs));
  const [inputErrors, setInputErrors] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<"idle" | "busy">("idle");
  const [copied, setCopied] = useState<Record<string, boolean>>({});
  const dirty = useRef(false);
  const seqRef = useRef(0);
  const draftKey = reportDraftKey(initial.planId, memberId);

  const setForm = useCallback((f: (s: InputsForm) => InputsForm) => {
    dirty.current = true;
    setFormState(f);
  }, []);

  // 端末の下書きを読む（初回の描画のあと。サーバーの描画と食い違わないよう effect で）
  useEffect(() => {
    const t = window.setTimeout(() => {
      const d = loadDraft<InputsForm>(draftKey);
      if (d && typeof d === "object") {
        dirty.current = true;
        setFormState((s) => ({ ...s, ...d, purposes: Array.isArray(d.purposes) ? d.purposes : s.purposes }));
      }
    }, 0);
    return () => window.clearTimeout(t);
  }, [draftKey]);

  // 入力か種別が変わったら、少し待ってから整形のプレビューを取り直す（保存はしない）。下書きも更新する
  useEffect(() => {
    if (!dirty.current) return;
    saveDraft(draftKey, form);
    const my = ++seqRef.current;
    setPreview("busy");
    const t = window.setTimeout(async () => {
      const r = await call("POST", `/api/ops/plans/${initial.planId}/report`, { kind, inputs: toInputs(form) });
      if (my !== seqRef.current) return;
      setPreview("idle");
      if (r.ok) {
        setView(r.data as unknown as PlanReportView);
        setInputErrors({});
      } else {
        setInputErrors(fieldErrorsOf(r));
      }
    }, 450);
    return () => window.clearTimeout(t);
  }, [form, kind, draftKey, initial.planId]);

  const onCopy = async (item: PreparedItem) => {
    if (item.copyText === null) return;
    const ok = await copyToClipboard(item.copyText);
    if (!ok) return;
    setCopied((s) => ({ ...s, [item.key]: true }));
    // 監査（誰がいつどの項目をコピーしたか。値は記録しない）。送れなくてもコピーは止めない
    if (view.permissions.record) void call("POST", `/api/ops/plans/${view.planId}/reports/audit`, { keys: [item.key] });
  };

  const direct = view.adapter.mode === "direct";
  const isCancel = kind === "cancel";
  const hasEffective = view.effective !== null;
  const kindAvailable: Record<ReportKind, boolean> = {
    new: !hasEffective && !view.planVoided,
    change: hasEffective && !view.planVoided,
    cancel: hasEffective,
  };
  const kindLabels: Record<ReportKind, string> = { new: "新規の通報", change: "変更の通報", cancel: "取消の記録" };
  const maskedLicense = !view.permissions.revealLicenseNumber;
  const notice = REPORT_NOTICE_BY_CHANNEL[view.adapter.name];
  // 中止した計画で通報の記録が無い：手順バー・入力の案内は出さず、事実だけを示す（主画面と同じ文言）
  const voidedNone = view.planVoided && view.status.code === "no_record";
  // 期限の警告・通報時からの変更点・対応が要る状況のときは、状況の詳細を開いたままにする
  const statusOpen =
    view.deadline.state === "overdue_started" ||
    view.deadline.state === "past_guide" ||
    view.fingerprintChanges.length > 0 ||
    ["cancel_needed", "change_review", "unknown", "failed"].includes(view.status.code);
  const keepVisibleIds = new Set([view.effective?.id, view.status.latestId].filter((x): x is string => !!x));
  const isShownRow = (r: ReportDto, i: number): boolean => i === 0 || keepVisibleIds.has(r.id);
  const olderReports = view.reports.filter((r, i) => !isShownRow(r, i));

  // ---- 記録（手動／取消）
  const [m, setM] = useState<ManualFields>(EMPTY_MANUAL);
  const [confirmSend, setConfirmSend] = useState(false);
  const [scenario, setScenario] = useState<MockScenario>("ok");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { formRef, requestErrorFocus } = useErrorFocus();

  const submitRecord = async () => {
    setBusy(true);
    setMessage(null);
    setErrors({});
    const useManual = !direct || isCancel;
    const r = await call("POST", `/api/ops/plans/${view.planId}/reports`, {
      kind,
      ...(kind !== "new" && view.effective ? { baseReportId: view.effective.id } : {}),
      expectedPlanVersion: view.planVersion,
      ...(isCancel ? {} : { inputs: toInputs(form) }),
      ...(useManual ? { manual: manualBody(m) } : { confirmSend, mockScenario: scenario }),
    });
    setBusy(false);
    if (!r.ok) {
      setErrors(fieldErrorsOf(r));
      setMessage(failMessage(r));
      requestErrorFocus();
      return;
    }
    clearDraft(draftKey);
    const rep = (r.data as { report?: ReportDto }).report;
    reloadAfterChange({
      target: "report",
      message: useManual
        ? isCancel
          ? "取消の結果を記録しました（利用者の申告）。"
          : "通報の結果を記録しました（利用者の申告・手動記録）。"
        : `送信しました（模擬・開発用）。結果：${rep?.statusLabel ?? ""}`,
    });
  };

  return (
    <div className="flex flex-col gap-4 sm:gap-6 [&_section[id]]:scroll-mt-28" data-testid="report-screen" data-adapter={view.adapter.name} data-kind={kind}>
        {/* 固定の文言：画面の先頭で最初に読める大きさと枠で置く（送信しない・記録するまで通報済みにならない・公式の手続き） */}
        {/* 固定の文言：短い版を先頭に置き、全文は 1 回で開く（DOM には全文が残る） */}
        <div
          className="opx-notice flex flex-col gap-1 !px-4 !py-1 !text-base !font-medium !leading-snug"
          data-meaning="warn"
          data-testid="report-notice"
          data-adapter={view.adapter.name}
        >
          <span data-testid="report-notice-short">{view.adapter.name === "mock" ? REPORT_NOTICE_BY_CHANNEL.mock : REPORT_NOTE_SHORT}</span>
          <details>
            <summary className="flex min-h-12 cursor-pointer select-none flex-wrap items-center gap-x-3 gap-y-1 text-sm font-normal text-sb-ink">
              <span className="underline underline-offset-2">固定の文言の全文{view.adapter.name === "mock" ? "（模擬の前提を含む）" : ""}</span>
              <span className="ml-auto flex items-center gap-x-2 text-sm text-sb-ink-2">
                <span>送信元：</span>
                <Badge tone={view.adapter.name === "mock" ? "amber" : "brand"} data-testid="report-adapter" data-adapter={view.adapter.name}>
                  {view.adapter.name === "mock" ? <span aria-hidden className="mr-1">◇</span> : null}
                  {view.adapter.label}
                </Badge>
                <span data-testid="report-adapter-mode">{view.adapter.modeLabel}</span>
              </span>
            </summary>
            <div className="flex flex-col gap-2 pb-1">
              <span>{notice}</span>
              {view.adapter.name === "mock" ? (
                <span className="text-sm font-normal leading-relaxed text-sb-ink-2" data-testid="report-mock-assumption">{MOCK_ASSUMPTION_NOTE}{OFFICIAL_PROCEDURE_NOTE}</span>
              ) : (
                <span className="text-sm font-normal leading-relaxed text-sb-ink-2">{REPORT_SELF_REPORT_NOTE}</span>
              )}
            </div>
          </details>
        </div>

      {voidedNone ? null : (
      <nav
          aria-label="通報の手順"
          className="sticky top-0 z-20 -mx-1 grid grid-cols-3 gap-1 rounded-sb-pill bg-sb-sunken p-0.5 max-sm:-mt-3 lg:top-14"
          data-testid="report-stepper"
        >
          {[
            ["#inputs", "① 内容を整える", "report-step-inputs"],
            ["#items", "② DIPS に入力", "report-step-items"],
            ["#record", "③ 結果を記録", "report-step-record"],
          ].map(([href, label, id]) => (
            <a key={id} href={href} data-testid={id} className="flex min-h-12 min-w-0 items-center justify-center rounded-sb-pill px-1 text-center text-sm font-bold leading-tight text-sb-ink hover:bg-sb-hover">
              {label}
            </a>
          ))}
        </nav>
      )}

      <div className="flex flex-col gap-3 sm:gap-6 max-sm:-mt-3" data-testid="report-status-and-kinds">
      {voidedNone ? (
        <section id="status" aria-label="通報の要否と状況" className="flex scroll-mt-28 flex-col gap-2 rounded-sb-l bg-sb-base px-4 py-3 opx-shadow" data-testid="report-status-line" data-voided-none="1">
          <p className="font-bold text-sb-ink">{VOIDED_NO_RECORD_LABEL}</p>
          <p className="text-sb-ink-2">{VOIDED_NO_RECORD_NOTE}</p>
        </section>
      ) : null}
      {voidedNone ? null : (
      <section id="status" aria-label="通報の要否と状況" className="flex scroll-mt-28 flex-col gap-2" data-testid="report-status-line">
        {/* 記録の前に読むべき警告は、畳まずに 1 行ずつ出す */}
        {view.warnings.length > 0 ? (
          <ul className="flex flex-col gap-1.5" data-testid="report-warnings">
            {view.warnings.map((w) => (
              <li key={w.code} className="opx-note opx-note-lg text-sb-ink" data-code={w.code}>
                {w.message}
              </li>
            ))}
          </ul>
        ) : null}
        <details className="rounded-sb-l bg-sb-base opx-shadow" data-testid="report-status-details" open={statusOpen}>
          <summary className="flex min-h-12 cursor-pointer select-none flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm text-sb-ink">
            <ReportBadge report={view.requirement} bare />
            <span className="ml-auto font-bold underline underline-offset-2">詳細</span>
            <span className="flex basis-full flex-wrap items-center gap-x-2 gap-y-0.5">
              <ReportStatusBadge status={view.status} bare />
              {view.deadline.message ? <span className="min-w-0 flex-1 text-sm leading-snug text-sb-ink-2">{view.deadline.message}</span> : null}
            </span>
          </summary>
          <div className="flex flex-col gap-4 px-4 pb-4 pt-2">
            <ReportBox report={view.requirement} />
            <ReportStatusBox status={view.status} changes={view.fingerprintChanges} />
            <DeadlineBox deadline={view.deadline} />
          </div>
        </details>
      </section>
      )}

      <nav aria-label="通報の種別" className="grid grid-cols-3 gap-2 sm:flex sm:flex-wrap" data-testid="report-kind-tabs">
        {(["new", "change", "cancel"] as const).map((k) => (
          <button
            key={k}
            type="button"
            disabled={!kindAvailable[k]}
            aria-pressed={kind === k}
            onClick={() => setKind(k)}
            className={`${buttonGhostClass} !px-1.5 sm:!px-5 ${kind === k ? "!border-transparent !bg-sb-inverse !text-sb-inverse-fg" : ""}`}
            data-testid={`report-kind-${k}`}
          >
            {kindLabels[k]}
          </button>
        ))}
      </nav>
      </div>

      {voidedNone ? null : !isCancel ? (
        <>
          <Section id="inputs" title="通報の画面で入力する項目" aria-label="通報の画面で入力する項目">
            <InputsPanel form={form} setForm={setForm} errors={inputErrors} preview={preview} />
          </Section>

          <Section
            id="items"
            title="DIPS の入力順の項目"
            aria-label="DIPS の入力順の項目"
            description="項目ごとに「コピー」を押して、DIPS 2.0 の通報画面に貼り付けます。そらばんが持たない項目は、DIPS で入力してください。"
          >
            <details data-testid="report-map-details">
              <summary className="flex min-h-12 cursor-pointer select-none items-center text-sm text-sb-ink underline-offset-2 hover:underline">項目の対応表について（版 {view.prepared.mapRevision}）・DIPS の通報画面の入力順とは照合していません</summary>
            <div className="flex flex-col gap-1.5 text-sm leading-relaxed text-sb-ink-2" data-testid="report-map-info" >
              <p data-note="">
                項目の対応表：版 <span className="sb-num tnum" data-testid="report-map-revision">{view.prepared.mapRevision}</span>・確認日{" "}
                <span className="sb-num tnum" data-testid="report-map-verified">{view.prepared.mapVerifiedAt.slice(0, 10)}</span>
              </p>
              <p data-note="">項目の並びは、DIPS 2.0 API 飛行計画通報ガイドライン 1.10 版の項目の並びです。DIPS の通報画面の入力順とは照合していません。</p>
              <p data-note="">{COPY_AUDIT_NOTE}</p>
            </div>
            </details>
            <p
              className={`opx-edge-row !flex-row flex-wrap items-baseline gap-x-3 gap-y-1 text-base leading-relaxed text-sb-ink ${
                view.prepared.missingRequiredCount > 0 ? "opx-edge-attn" : ""
              }`}
              data-testid="report-missing-count"
              data-count={String(view.prepared.missingRequiredCount)}
            >
              <span aria-hidden className="sb-num font-bold">{view.prepared.missingRequiredCount > 0 ? "!" : "✓"}</span>
              <span className="font-medium">
                未入力の必須項目：<span className="sb-num tnum">{view.prepared.missingRequiredCount}</span> 件
              </span>
              <span data-note="" className="text-sm text-sb-ink-2">（未入力があっても記録はできます。DIPS で入力してください）</span>
            </p>
            {view.prepared.warnings.length > 0 ? (
              <ul className="flex flex-col gap-1.5" data-testid="report-prepare-warnings">
                {view.prepared.warnings.map((w) => (
                  <li key={`${w.code}-${w.message}`} className="flex gap-2 opx-note opx-note-lg text-sb-ink-2">
                    <span aria-hidden className="sb-num font-bold text-sb-ink">!</span>
                    <span>{w.message}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="flex flex-col gap-2 sm:gap-4" data-testid="report-groups">
              {view.prepared.groups.map((g) => (
                <section key={g.id} aria-label={g.label} className="flex flex-col" data-testid={`report-group-${g.id}`} data-needs-confirmation={g.needsConfirmation ? "1" : "0"}>
                  <h3 className="flex flex-wrap items-center gap-x-3 gap-y-1 border-y border-sb-rule bg-sb-sunken px-2 py-1 text-sm font-medium text-sb-ink sm:px-3">
                    <span>{g.label}</span>
                    {g.needsConfirmation ? (
                      <span className="inline-flex items-center gap-1 rounded-sb-m border border-sb-ink bg-sb-st-warn-face px-1.5 text-sm font-normal leading-5 text-sb-ink" data-testid={`report-group-mark-${g.id}`}>
                        {NEEDS_CONFIRMATION_MARK}
                      </span>
                    ) : null}
                    <span className="ml-auto sb-num text-sm font-normal tnum text-sb-ink-3">{g.itemKeys.length} 項目</span>
                  </h3>
                  <ul className="flex flex-col lg:block lg:columns-2 lg:gap-x-8">
                    {g.itemKeys.map((k) => {
                      const item = view.prepared.items.find((i) => i.key === k);
                      return item ? <ItemRow key={k} item={item} copied={copied[k] === true} onCopy={(i) => void onCopy(i)} maskedLicense={maskedLicense} /> : null;
                    })}
                  </ul>
                </section>
              ))}
            </div>
          </Section>
        </>
      ) : (
        <Section id="cancel-info" title="取り消す通報" aria-label="取り消す通報">
          <p className="text-sb-ink-2" data-testid="report-cancel-info">
            DIPS 2.0 の画面で通報を取り消し、その結果をここに記録してください。そらばんは取消を DIPS に送りません。
          </p>
          {view.effective ? (
            <p data-note="" className="sb-num text-sm tnum text-sb-ink-2">
              取り消す通報：{view.effective.reportedAtJst ?? "—"}・{view.effective.dipsNumber ?? (view.effective.numberUnavailable ? "番号なし" : "—")}
            </p>
          ) : (
            <Note body>取り消せる有効な通報がありません。</Note>
          )}
        </Section>
      )}

      <Section id="record" title={isCancel ? "取消の結果を記録する" : direct ? "送信内容の確認と送信" : "通報の結果を記録する"} aria-label="通報の記録">
        {!view.permissions.record ? (
          <Note body>記録は、運航管理者と、この計画の操縦者本人だけが行えます。</Note>
        ) : !view.recordable.allowed ? (
          <div data-testid="report-record-blocked" data-reason={view.recordable.reason ?? ""}>
            <p className="opx-note opx-note-lg">
              {view.recordable.reason === "draft"
                ? "計画が下書きのため、通報の記録はできません。先に確認を依頼してください。"
                : view.recordable.reason === "multiple_areas"
                  ? `${PREPARE_WARNING_MESSAGE.route_multiple_areas}。範囲が複数の間は、新規・変更の通報の記録はできません${view.effective ? "（取消の記録はできます）" : ""}。`
                  : "計画は中止されています。通報の記録はできません（取消の記録はできます）。"}
            </p>
          </div>
        ) : isCancel && !view.effective ? (
          <Note body>取り消せる有効な通報がありません。</Note>
        ) : (
          <form
            ref={formRef}
            onSubmit={(e) => {
              e.preventDefault();
              void submitRecord();
            }}
            className="flex flex-col gap-4"
            aria-label="通報の記録"
            data-testid="report-record-form"
            data-mode={direct && !isCancel ? "direct" : "manual"}
          >
            {direct && !isCancel ? (
              <>
                <p
                  className="flex items-start gap-3 rounded-sb-m border-2 border-dashed border-sb-ink bg-sb-st-info-face px-3 py-3 font-medium text-sb-ink"
                  data-testid="mock-notice"
                >
                  <span aria-hidden data-note="" className="mt-px inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-sb-m border border-sb-ink bg-sb-base sb-num text-sm font-bold leading-none">◇</span>
                  <span>{REPORT_NOTICE_BY_CHANNEL.mock}</span>
                </p>
                <p className="text-sb-ink-2">{MOCK_ASSUMPTION_NOTE}</p>
                <Field label="模擬のシナリオ（開発用）" required={false}>
                  <select className={`${inputClass} min-h-12`} value={scenario} onChange={(e) => setScenario(e.target.value as MockScenario)} data-testid="send-scenario">
                    {SCENARIOS.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <label className={confirmRowClass}>
                  <input type="checkbox" className={confirmBoxClass} checked={confirmSend} aria-invalid={errors["confirmSend"] ? true : undefined} aria-describedby={errors["confirmSend"] ? "send-err-confirmSend" : undefined} onChange={(e) => setConfirmSend(e.target.checked)} data-testid="send-confirm" />
                  <span>上の項目の内容を確認した（実際の DIPS には送信されません）</span>
                </label>
                <FieldError id="send-err-confirmSend" message={errors["confirmSend"]} />
              </>
            ) : (
              <ManualFormFields m={m} setM={setM} errors={errors} testPrefix="record" withConfirmations />
            )}
            <FormError message={message} />
            <div>
              <button type="submit" data-variant="primary" className={buttonPrimaryClass} disabled={busy || (direct && !isCancel && !confirmSend)} data-testid={direct && !isCancel ? "send-submit" : "record-submit"}>
                {direct && !isCancel ? "送信する（模擬）" : isCancel ? "取消の結果を記録する" : "通報の結果を記録する"}
              </button>
            </div>
          </form>
        )}
      </Section>

      <Section id="history" title="通報の履歴" aria-label="通報の履歴" description="新しい順です。訂正・取り下げ・確定は理由つきの新しい版として残り、元の値は消えません。">
        {view.reports.length === 0 ? (
          <p className="text-sb-ink-3" data-testid="report-history-empty">
            通報の記録はまだありません。
          </p>
        ) : (
          <ol className="flex flex-col border-t border-sb-rule" data-testid="report-history">
            {view.reports.filter((r, i) => isShownRow(r, i)).map((r) => (
              <ReportRow key={r.id} r={r} />
            ))}
          </ol>
        )}
        {olderReports.length > 0 ? (
          <details data-testid="report-history-older">
            <summary className="flex min-h-12 cursor-pointer select-none items-center text-sm font-bold text-sb-ink">過去の記録を見る（{olderReports.length} 件）</summary>
            <ol className="flex flex-col border-t border-sb-rule">
              {olderReports.map((r) => (
                <ReportRow key={r.id} r={r} />
              ))}
            </ol>
          </details>
        ) : null}
      </Section>

      <Section id="audit" title="操作の監査" aria-label="操作の監査" description="誰が・いつ・何を・どこへ・結果を残します。値の全文・秘密・技能証明書番号・氏名は記録しません。">
        <details data-testid="report-audit-details">
          <summary className="flex min-h-12 cursor-pointer select-none items-center text-sm font-bold text-sb-ink">監査の記録を見る（{view.audit.length} 件）</summary>
          <AuditList audit={view.audit} />
        </details>
      </Section>
      {/* 機体・操縦者の DIPS への登録は利用者本人が行う（Sprint 18-3）。作業台の末尾に 1 行。第一画面の並びは変えない */}
      <p className="text-base leading-relaxed text-sb-ink-2" data-testid="boundary-registration">{BOUNDARY_REGISTRATION}</p>
    </div>
  );
}
