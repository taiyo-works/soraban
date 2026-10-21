"use client";

// 通報の画面（Sprint 12b 設計 H）：通報内容を DIPS の入力順に並べ、項目ごとにコピーできる。通報の結果の記録、訂正・取り下げ・
// 結果不明の確定・再送、取消の記録、履歴と監査の表示。
// そらばんは DIPS に送信しない（模擬は同じプロセスの中の結果を返すだけ）。記録するまで「通報済み」とは出さない。
// 判断（二つの確認・番号の有無・未来の日時・版・認可・冪等性）はサーバーが行い、画面は結果を示すだけ。
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ATTEMPT_RESULT_LABEL,
  COPY_AUDIT_NOTE,
  DIPS_ONLY_LABEL,
  fieldByKey,
  LICENSE_MASKED_NOTE,
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
import type { AttemptDto, PlanReportView, ReportDto } from "@/server/ops/reports";
import { DeadlineBox, ReportBox, ReportStatusBox } from "./plan-ui";
import { loadDraft, saveDraft, clearDraft, reportDraftKey } from "./drafts";
import { Field, fieldErrorsOf, FormError, inputClass, messageFor, reloadAfterChange, send, useErrorFocus, type ApiResult } from "./ops-client";
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
      <p className="text-xs leading-relaxed text-ink-mute">
        計画にない項目を入れます。入力は、この端末の下書きに残り（サーバーには、記録するときに送ります）、下の「DIPS の入力順の項目」に反映されます。
        {preview === "busy" ? <span role="status" className="ml-2 text-ink-soft" data-testid="report-preview-busy">更新中…</span> : null}
      </p>
      {textField("reportName", "通報用の名称", "計画名が 30 文字を超えるときに入力します（30 文字以内）。")}
      <fieldset className="flex min-w-0 flex-col gap-2">
        <legend className="mb-1 text-sm text-ink">飛行目的（複数選べます）</legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {Object.entries(purposeCodes).map(([code, label]) => {
            const n = Number(code);
            return (
              <label key={code} className={confirmRowClass}>
                <input
                  type="checkbox"
                  className={confirmBoxClass}
                  checked={form.purposes.includes(n)}
                  onChange={(e) => set("purposes", e.target.checked ? [...form.purposes, n].sort((a, b) => a - b) : form.purposes.filter((x) => x !== n))}
                  data-testid={`report-input-purpose-${code}`}
                />
                <span>{label}</span>
              </label>
            );
          })}
        </div>
        {errors["flightPurposes"] ? (
          <span role="alert" className="text-xs text-signal-red">
            <span aria-hidden>! </span>
            {errors["flightPurposes"]}
          </span>
        ) : null}
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
  return (
    <li
      className="flex flex-col gap-1.5 border-b border-rule-soft py-3"
      data-testid={`report-item-${item.key}`}
      data-status={item.status}
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <span className="text-sm font-medium text-ink" data-testid={`report-item-label-${item.key}`}>
          {item.label}
        </span>
        {item.apiField ? <span className="font-mono text-[10px] text-ink-mute">{item.apiField}</span> : null}
        {item.required && item.status !== "dips_only" ? <span className="text-[10px] text-ink-mute">必須</span> : null}
        {item.dipsScreenLabel ? <span className="text-[11px] text-ink-mute">DIPS の画面：{item.dipsScreenLabel}</span> : null}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {item.status === "filled" ? (
          <span className="min-w-0 break-all font-mono text-sm tnum text-ink" data-testid={`report-item-value-${item.key}`}>
            {item.value}
            {item.unit ? <span className="ml-1 text-xs text-ink-mute">{item.unit}</span> : null}
          </span>
        ) : item.status === "missing" ? (
          <span className="text-sm text-signal-amber" data-testid={`report-item-value-${item.key}`}>
            <span aria-hidden>！ </span>
            {MISSING_VALUE_LABEL}
          </span>
        ) : item.status === "dips_only" ? (
          <span className="text-sm text-ink-mute" data-testid={`report-item-value-${item.key}`}>
            {item.value ?? DIPS_ONLY_LABEL}
          </span>
        ) : item.status === "not_applicable" ? (
          <span className="text-sm text-ink-mute" data-testid={`report-item-value-${item.key}`}>
            {NOT_APPLICABLE_LABEL}
          </span>
        ) : (
          <span className="min-w-0 break-all font-mono text-sm tnum text-ink" data-testid={`report-item-value-${item.key}`}>
            {item.value}
          </span>
        )}
        {item.copyable && item.copyText !== null ? (
          <button type="button" className={buttonGhostClass} onClick={() => onCopy(item)} data-testid={`report-copy-${item.key}`} aria-label={`${item.label}をコピー`}>
            コピー
          </button>
        ) : null}
        {copied ? (
          <span role="status" className="text-xs text-signal-green" data-testid={`report-copied-${item.key}`}>
            <span aria-hidden>✓ </span>コピーしました
          </span>
        ) : null}
      </div>
      {item.key === "skill_number" && maskedLicense ? (
        <p className="text-xs text-ink-mute" data-testid="report-license-masked-note">
          {LICENSE_MASKED_NOTE}
        </p>
      ) : null}
      {isRoute ? (
        <div className="flex flex-col gap-1.5 border-l-2 border-brand-700 pl-3" data-testid="report-route">
          <p className="text-xs leading-relaxed text-ink-soft" data-testid="report-route-guide">
            {ROUTE_GUIDE}
          </p>
          {item.apiValue ? (
            <details className="text-xs text-ink-mute">
              <summary className="inline-flex min-h-11 cursor-pointer select-none items-center text-brand-700 underline-offset-2 hover:underline">API 形式（参考）</summary>
              <p className="break-all font-mono tnum" data-testid="report-route-geojson">{item.apiValue}</p>
            </details>
          ) : null}
        </div>
      ) : null}
      {showApi ? (
        <p className="break-all font-mono text-[11px] tnum text-ink-mute" data-testid={`report-item-api-${item.key}`}>
          API 形式：{item.apiValue}
        </p>
      ) : null}
      {item.warnings.length > 0 ? (
        <ul className="flex flex-col gap-0.5 text-xs leading-relaxed text-signal-amber" data-testid={`report-item-warnings-${item.key}`}>
          {item.warnings.map((w) => (
            <li key={w.code}>
              <span aria-hidden>! </span>
              <span className="text-ink-soft">{w.message}</span>
            </li>
          ))}
        </ul>
      ) : null}
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
          className={`${inputClass} min-h-12 font-mono tnum`}
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
          <legend className="mb-1 text-xs text-ink-mute">確認（どちらも必要です）</legend>
          <label className={confirmRowClass}>
            <input
              type="checkbox"
              className={confirmBoxClass}
              checked={m.confirmedDipsDone}
              onChange={(e) => setM((s) => ({ ...s, confirmedDipsDone: e.target.checked }))}
              data-testid={`${testPrefix}-confirm-done`}
            />
            <span>{MANUAL_CONFIRM_DIPS_DONE}</span>
          </label>
          {errors["confirmedDipsDone"] ? (
            <span role="alert" className="text-xs text-signal-red">
              <span aria-hidden>! </span>
              {errors["confirmedDipsDone"]}
            </span>
          ) : null}
          <label className={confirmRowClass}>
            <input
              type="checkbox"
              className={confirmBoxClass}
              checked={m.confirmedMatchesLatest}
              onChange={(e) => setM((s) => ({ ...s, confirmedMatchesLatest: e.target.checked }))}
              data-testid={`${testPrefix}-confirm-latest`}
            />
            <span>{MANUAL_CONFIRM_MATCHES_LATEST}</span>
          </label>
          {errors["confirmedMatchesLatest"] ? (
            <span role="alert" className="text-xs text-signal-red">
              <span aria-hidden>! </span>
              {errors["confirmedMatchesLatest"]}
            </span>
          ) : null}
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
    <div className="flex flex-col gap-3 pt-2" data-testid="report-actions">
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
          className="flex flex-col gap-3 rounded-sharp border border-rule bg-paper px-3 py-3"
          aria-label={open === "correct" ? "記録の訂正" : open === "retract" ? "記録の取り下げ" : open === "resolve" ? "結果不明の確定" : "失敗した送信の再送"}
          data-testid={`report-${open}-form`}
        >
          {open === "retract" ? (
            <Note tone="red">
              取り下げは「記録の誤り（通報していないのに記録した）」を直す操作です。通報を取り消す場合は、取消の記録を使います。元の記録は履歴に残ります。
            </Note>
          ) : null}
          {open === "resolve" ? (
            <>
              <Note>DIPS の画面で確かめた結果を選んでください。自動では再送しません。</Note>
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
              <Note>同じ行・同じ冪等性キーで再送します（二重にはなりません）。{MOCK_ASSUMPTION_NOTE}</Note>
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
            <button type="submit" className={open === "retract" ? buttonDangerClass : buttonPrimaryClass} disabled={busy || (open === "retry" && !confirmSend)} data-testid={`report-${open}-submit`}>
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
  return (
    <li
      className="flex flex-col gap-2 border-b border-rule-soft py-3 text-sm"
      data-testid="report-row"
      data-id={r.id}
      data-kind={r.kind}
      data-status={r.effectiveState}
      data-channel={r.channel}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <Badge tone="brand" data-testid="report-row-kind">{r.kindLabel}</Badge>
        <Badge tone="neutral" data-testid="report-row-channel">{r.channelLabel}</Badge>
        <Badge tone={tone} data-testid="report-row-state">
          <span aria-hidden className="mr-1">{glyph}</span>
          <span data-testid="report-row-status">{r.statusLabel}</span>
        </Badge>
        {r.isEffective ? <Badge tone="green" data-testid="report-row-effective">有効な通報</Badge> : null}
      </div>
      <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
        <div className="flex gap-2">
          <dt className="shrink-0 text-ink-mute">通報日時</dt>
          <dd className="font-mono tnum text-ink" data-testid="report-row-reported-at">{r.reportedAtJst ?? "—"}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="shrink-0 text-ink-mute">DIPS の番号</dt>
          <dd className="min-w-0 break-all font-mono tnum text-ink" data-testid="report-row-number">
            {r.dipsNumber ?? (r.numberUnavailable ? "番号なし（表示されなかった）" : "—")}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="shrink-0 text-ink-mute">記録の版</dt>
          <dd className="font-mono tnum text-ink" data-testid="report-row-version">{r.version}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="shrink-0 text-ink-mute">計画の版</dt>
          <dd className="font-mono tnum text-ink" data-testid="report-row-plan-version">{r.planVersion}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="shrink-0 text-ink-mute">対応表の版</dt>
          <dd className="font-mono tnum text-ink" data-testid="report-row-map-revision">{r.mapRevision}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="shrink-0 text-ink-mute">判定の通し番号</dt>
          <dd className="font-mono tnum text-ink">{r.snapshotSeq}</dd>
        </div>
        <div className="flex min-w-0 gap-2 sm:col-span-2">
          <dt className="shrink-0 text-ink-mute">地点判定の証跡 ID</dt>
          <dd className="min-w-0 break-all font-mono tnum text-ink" data-testid="report-row-check-evidence">{r.checkEvidenceId}</dd>
        </div>
        <div className="flex min-w-0 gap-2 sm:col-span-2">
          <dt className="shrink-0 text-ink-mute">申請支援の証跡 ID</dt>
          <dd className="min-w-0 break-all font-mono tnum text-ink" data-testid="report-row-diagnosis-evidence">{r.diagnosisEvidenceId}</dd>
        </div>
        <div className="flex gap-2 sm:col-span-2">
          <dt className="shrink-0 text-ink-mute">記録した日時</dt>
          <dd className="font-mono tnum text-ink">{r.createdAtJst}</dd>
        </div>
      </dl>
      {r.memo ? <p className="break-all text-xs text-ink-soft" data-testid="report-row-memo">メモ：{r.memo}</p> : null}
      {r.errorMessage ? <p className="text-xs text-signal-red" data-testid="report-row-error">{r.errorMessage}</p> : null}
      {r.externalStatusLabel ? <p className="text-xs text-ink-soft" data-testid="report-row-external-status">{r.externalStatusLabel}</p> : null}
      {r.stale ? <p className="text-xs text-signal-amber" data-testid="report-row-stale">送信の途中で止まった可能性があります。自動では再送しません。</p> : null}
      <RowActions report={r} />
    </li>
  );
}

function AuditList({ audit }: { readonly audit: readonly AttemptDto[] }) {
  if (audit.length === 0) return <p className="text-sm text-ink-mute" data-testid="report-audit-empty">監査の記録はまだありません。</p>;
  return (
    <ol className="flex flex-col border-t border-rule" data-testid="report-audit">
      {audit.map((a) => (
        <li key={a.id} className="flex flex-col gap-0.5 border-b border-rule-soft py-2 text-xs text-ink-soft" data-testid="report-audit-row" data-operation={a.operation} data-result={a.result}>
          <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
            <span className="font-medium text-ink">{a.operationLabel}</span>
            <span>{ATTEMPT_RESULT_LABEL[a.result] ?? a.result}</span>
            <span>{a.memberName}（{a.memberRole}）</span>
            <span>送信元：{a.adapter}</span>
            <time dateTime={a.createdAt} className="font-mono tnum">{a.createdAtJst}</time>
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
    <div className="flex flex-col gap-10" data-testid="report-screen" data-adapter={view.adapter.name} data-kind={kind}>
      <div className="flex flex-col gap-3">
        <p
          className="flex flex-col gap-1.5 rounded-sharp border border-l-4 border-rule border-l-brand-700 bg-paper px-3 py-3 text-sm leading-relaxed text-ink"
          data-testid="report-notice"
          data-adapter={view.adapter.name}
        >
          <span>{notice}</span>
          {view.adapter.name === "mock" ? <span className="text-xs text-ink-soft" data-testid="report-mock-assumption">{MOCK_ASSUMPTION_NOTE}{OFFICIAL_PROCEDURE_NOTE}</span> : <span className="text-xs text-ink-soft">{REPORT_SELF_REPORT_NOTE}</span>}
        </p>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-soft">
          <span>送信元：</span>
          <Badge tone={view.adapter.name === "mock" ? "amber" : "brand"} data-testid="report-adapter" data-adapter={view.adapter.name}>
            {view.adapter.label}
          </Badge>
          <span data-testid="report-adapter-mode">{view.adapter.modeLabel}</span>
        </p>
      </div>

      <Section id="status" title="通報の要否と状況" aria-label="通報の要否と状況">
        <ReportBox report={view.requirement} />
        <ReportStatusBox status={view.status} changes={view.fingerprintChanges} />
        <DeadlineBox deadline={view.deadline} />
        {view.warnings.length > 0 ? (
          <ul className="flex flex-col gap-1.5" data-testid="report-warnings">
            {view.warnings.map((w) => (
              <li key={w.code} className="border-l-2 border-signal-amber pl-3 text-xs leading-relaxed text-ink-soft" data-code={w.code}>
                {w.message}
              </li>
            ))}
          </ul>
        ) : null}
      </Section>

      <nav aria-label="通報の種別" className="flex flex-wrap gap-2" data-testid="report-kind-tabs">
        {(["new", "change", "cancel"] as const).map((k) => (
          <button
            key={k}
            type="button"
            disabled={!kindAvailable[k]}
            aria-pressed={kind === k}
            onClick={() => setKind(k)}
            className={`${kind === k ? buttonPrimaryClass : buttonGhostClass}`}
            data-testid={`report-kind-${k}`}
          >
            {kindLabels[k]}
          </button>
        ))}
      </nav>

      {!isCancel ? (
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
            <div className="flex flex-col gap-2 text-xs text-ink-soft" data-testid="report-map-info">
              <p>
                項目の対応表：版 <span className="font-mono tnum" data-testid="report-map-revision">{view.prepared.mapRevision}</span>・確認日{" "}
                <span className="font-mono tnum" data-testid="report-map-verified">{view.prepared.mapVerifiedAt.slice(0, 10)}</span>
              </p>
              <p>項目の並びは、DIPS 2.0 API 飛行計画通報ガイドライン 1.10 版の項目の並びです。DIPS の通報画面の入力順とは照合していません。</p>
              <p>{COPY_AUDIT_NOTE}</p>
            </div>
            <p className="rounded-sharp border border-rule bg-paper px-3 py-2 text-sm text-ink" data-testid="report-missing-count" data-count={String(view.prepared.missingRequiredCount)}>
              未入力の必須項目：{view.prepared.missingRequiredCount} 件
              <span className="ml-2 text-xs text-ink-mute">（未入力があっても記録はできます。DIPS で入力してください）</span>
            </p>
            {view.prepared.warnings.length > 0 ? (
              <ul className="flex flex-col gap-1" data-testid="report-prepare-warnings">
                {view.prepared.warnings.map((w) => (
                  <li key={`${w.code}-${w.message}`} className="text-xs leading-relaxed text-ink-soft">
                    <span aria-hidden className="text-signal-amber">! </span>
                    {w.message}
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="flex flex-col gap-8" data-testid="report-groups">
              {view.prepared.groups.map((g) => (
                <section key={g.id} aria-label={g.label} className="flex flex-col" data-testid={`report-group-${g.id}`} data-needs-confirmation={g.needsConfirmation ? "1" : "0"}>
                  <h3 className="flex flex-wrap items-baseline gap-x-3 border-b border-rule pb-1.5 text-sm font-medium text-ink">
                    <span>{g.label}</span>
                    {g.needsConfirmation ? (
                      <span className="text-xs font-normal text-signal-amber" data-testid={`report-group-mark-${g.id}`}>
                        {NEEDS_CONFIRMATION_MARK}
                      </span>
                    ) : null}
                  </h3>
                  <ul className="flex flex-col">
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
          <p className="text-sm leading-relaxed text-ink-soft" data-testid="report-cancel-info">
            DIPS 2.0 の画面で通報を取り消し、その結果をここに記録してください。そらばんは取消を DIPS に送りません。
          </p>
          {view.effective ? (
            <p className="font-mono text-xs tnum text-ink-soft">
              取り消す通報：{view.effective.reportedAtJst ?? "—"}・{view.effective.dipsNumber ?? (view.effective.numberUnavailable ? "番号なし" : "—")}
            </p>
          ) : (
            <Note>取り消せる有効な通報がありません。</Note>
          )}
        </Section>
      )}

      <Section id="record" title={isCancel ? "取消の結果を記録する" : direct ? "送信内容の確認と送信" : "通報の結果を記録する"} aria-label="通報の記録">
        {!view.permissions.record ? (
          <Note>記録は、運航管理者と、この計画の操縦者本人だけが行えます。</Note>
        ) : !view.recordable.allowed ? (
          <Note>
            {view.recordable.reason === "draft"
              ? "計画が下書きのため、通報の記録はできません。先に確認を依頼してください。"
              : "計画は中止されています。通報の記録はできません（取消の記録はできます）。"}
          </Note>
        ) : isCancel && !view.effective ? (
          <Note>取り消せる有効な通報がありません。</Note>
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
                <p className="rounded-sharp border border-signal-amber/60 bg-signal-amber-soft px-3 py-2 text-sm text-ink" data-testid="mock-notice">
                  {REPORT_NOTICE_BY_CHANNEL.mock}
                </p>
                <p className="text-xs leading-relaxed text-ink-soft">{MOCK_ASSUMPTION_NOTE}</p>
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
                  <input type="checkbox" className={confirmBoxClass} checked={confirmSend} onChange={(e) => setConfirmSend(e.target.checked)} data-testid="send-confirm" />
                  <span>上の項目の内容を確認した（実際の DIPS には送信されません）</span>
                </label>
                {errors["confirmSend"] ? (
                  <span role="alert" className="text-xs text-signal-red">
                    <span aria-hidden>! </span>
                    {errors["confirmSend"]}
                  </span>
                ) : null}
              </>
            ) : (
              <ManualFormFields m={m} setM={setM} errors={errors} testPrefix="record" withConfirmations />
            )}
            <FormError message={message} />
            <div>
              <button type="submit" className={buttonPrimaryClass} disabled={busy || (direct && !isCancel && !confirmSend)} data-testid={direct && !isCancel ? "send-submit" : "record-submit"}>
                {direct && !isCancel ? "送信する（模擬）" : isCancel ? "取消の結果を記録する" : "通報の結果を記録する"}
              </button>
            </div>
          </form>
        )}
      </Section>

      <Section id="history" title="通報の履歴" aria-label="通報の履歴" description="新しい順です。訂正・取り下げ・確定は理由つきの新しい版として残り、元の値は消えません。">
        {view.reports.length === 0 ? (
          <p className="text-sm text-ink-mute" data-testid="report-history-empty">
            通報の記録はまだありません。
          </p>
        ) : (
          <ol className="flex flex-col border-t border-rule" data-testid="report-history">
            {view.reports.map((r) => (
              <ReportRow key={r.id} r={r} />
            ))}
          </ol>
        )}
      </Section>

      <Section id="audit" title="操作の監査" aria-label="操作の監査" description="誰が・いつ・何を・どこへ・結果を残します。値の全文・秘密・技能証明書番号・氏名は記録しません。">
        <AuditList audit={view.audit} />
      </Section>
    </div>
  );
}
