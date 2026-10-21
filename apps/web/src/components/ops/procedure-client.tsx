"use client";

// 手続きの「済み」の記録（Sprint 12b 設計 D3・H）：許可・承認の申請（dips_permit）と、小型無人機等飛行禁止法の同意・通報（small_drone_law）。
// 記録は利用者の申告で、「許可済み」とは出さない（「申請済み（利用者の申告）」）。判断（確認がすべて真か・版・認可）はサーバーが行う。
import { useState } from "react";
import { PROCEDURE_CHECK_LABEL, PROCEDURE_RECORD_NOTE, PROCEDURE_RECORD_STALE_LABEL, type ProcedureRecordKind } from "@soraban/dips";
import type { ProcedureRecordDto, ProcedureRecordSummaryDto } from "@/server/ops/report-dto";
import { fieldErrorsOf, Field, FormError, inputClass, messageFor, reloadAfterChange, send, useErrorFocus, type ApiResult } from "./ops-client";
import { confirmBoxClass, confirmRowClass, joinJst, JstDateTimeField } from "./report-parts";
import { buttonDangerClass, buttonPrimaryClass, Badge, type Tone } from "./ui";

const call = async (method: string, url: string, body?: unknown): Promise<ApiResult> => {
  try {
    return await send(method, url, body);
  } catch {
    return { ok: false, status: 0, data: { error: "network" } };
  }
};

const PROCEDURE_ERRORS: Readonly<Record<string, string>> = {
  already_recorded: "同じ判定に対する記録が既にあります。画面を読み込み直してください。",
  voided: "中止した計画には記録できません。",
};

const failMessage = (r: ApiResult): string => {
  if (r.status === 0) return "通信できませんでした。入力した内容は画面に残っています。通信が戻ってから、もう一度操作してください。";
  const code = typeof r.data["error"] === "string" ? r.data["error"] : "";
  return PROCEDURE_ERRORS[code] ?? messageFor(r);
};

const CHECKS: Readonly<Record<ProcedureRecordKind, readonly (keyof typeof PROCEDURE_CHECK_LABEL)[]>> = {
  dips_permit: ["applicationCompleted"],
  small_drone_law: ["facilityConsentObtained", "policeNoticeDone"],
};

const STATUS_TONE: Readonly<Record<ProcedureRecordSummaryDto["status"], Tone>> = { none: "amber", done: "green", stale: "amber", retracted: "mute" };
// 状況の箱：色は線と背景だけ。意味は札の記号と文字が担う。
const STATUS_BOX: Readonly<Record<ProcedureRecordSummaryDto["status"], string>> = {
  none: "border-rule border-l-signal-amber bg-signal-amber-soft/40",
  done: "border-rule border-l-signal-green bg-signal-green-soft/40",
  stale: "border-rule border-l-signal-amber bg-signal-amber-soft/40",
  retracted: "border-rule border-l-rule bg-paper-soft",
};
const STATUS_GLYPH: Readonly<Record<ProcedureRecordSummaryDto["status"], string>> = { none: "！", done: "✓", stale: "△", retracted: "－" };

function DoneForm({ planId, planVersion, kind }: { readonly planId: string; readonly planVersion: number; readonly kind: ProcedureRecordKind }) {
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [reference, setReference] = useState("");
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { formRef, requestErrorFocus } = useErrorFocus();
  const onSubmit = async () => {
    setBusy(true);
    setMessage(null);
    const r = await call("POST", `/api/ops/plans/${planId}/procedure-records`, {
      kind,
      action: "done",
      doneAt: joinJst(date, time) || null,
      reference: reference.trim() === "" ? null : reference,
      checks,
      expectedPlanVersion: planVersion,
    });
    setBusy(false);
    if (!r.ok) {
      setErrors(fieldErrorsOf(r));
      setMessage(failMessage(r));
      requestErrorFocus();
      return;
    }
    setErrors({});
    reloadAfterChange({ target: "procedures", message: "手続きの記録を残しました（利用者の申告）。" });
  };
  return (
    <form
      ref={formRef}
      onSubmit={(e) => {
        e.preventDefault();
        void onSubmit();
      }}
      className="flex flex-col gap-3 rounded-sharp border border-rule-soft bg-paper px-3 py-3"
      aria-label={kind === "dips_permit" ? "許可・承認の申請の記録" : "飛行禁止法の同意・通報の記録"}
      data-testid={`procedure-form-${kind}`}
    >
      <JstDateTimeField
        label={kind === "dips_permit" ? "申請した日時" : "同意・通報の日時"}
        date={date}
        time={time}
        onDate={setDate}
        onTime={setTime}
        error={errors["doneAt"]}
        testId={`procedure-done-at-${kind}`}
      />
      <Field label="控えの番号（申請受付番号など）" required={false} error={errors["reference"]} hint="100 文字以内。任意です。">
        <input className={`${inputClass} min-h-12`} value={reference} onChange={(e) => setReference(e.target.value)} data-testid={`procedure-reference-${kind}`} />
      </Field>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-xs text-ink-mute">確認（すべて必要です）</legend>
        {CHECKS[kind].map((k) => (
          <label key={k} className={confirmRowClass}>
            <input
              type="checkbox"
              className={confirmBoxClass}
              checked={checks[k] === true}
              onChange={(e) => setChecks((s) => ({ ...s, [k]: e.target.checked }))}
              data-testid={`procedure-check-${kind}-${k}`}
            />
            <span>{PROCEDURE_CHECK_LABEL[k]}</span>
          </label>
        ))}
        {CHECKS[kind].some((k) => errors[`checks.${k}`]) ? (
          <span role="alert" className="text-xs text-signal-red">
            <span aria-hidden>! </span>
            すべての確認にチェックを入れてください。
          </span>
        ) : null}
      </fieldset>
      <FormError message={message} />
      <div>
        <button type="submit" className={buttonPrimaryClass} disabled={busy} data-testid={`procedure-submit-${kind}`}>
          {kind === "dips_permit" ? "申請済みとして記録する" : "同意・通報を記録する"}
        </button>
      </div>
    </form>
  );
}

function RetractForm({ planId, planVersion, kind }: { readonly planId: string; readonly planVersion: number; readonly kind: ProcedureRecordKind }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { formRef, requestErrorFocus } = useErrorFocus();
  const onSubmit = async () => {
    setBusy(true);
    setMessage(null);
    const r = await call("POST", `/api/ops/plans/${planId}/procedure-records`, { kind, action: "retract", reason, expectedPlanVersion: planVersion });
    setBusy(false);
    if (!r.ok) {
      setErrors(fieldErrorsOf(r));
      setMessage(failMessage(r));
      requestErrorFocus();
      return;
    }
    reloadAfterChange({ target: "procedures", message: "記録を取り下げました。" });
  };
  if (!open) {
    return (
      <div>
        <button type="button" className={buttonDangerClass} onClick={() => setOpen(true)} data-testid={`procedure-retract-open-${kind}`}>
          記録を取り下げる
        </button>
      </div>
    );
  }
  return (
    <form
      ref={formRef}
      onSubmit={(e) => {
        e.preventDefault();
        void onSubmit();
      }}
      className="flex flex-col gap-3 rounded-sharp border border-signal-red/50 px-3 py-3"
      aria-label="記録の取り下げ"
      data-testid={`procedure-retract-form-${kind}`}
    >
      <Field label="取り下げの理由" required error={errors["reason"]} hint="記録の履歴に残ります。">
        <textarea className={inputClass} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} data-testid={`procedure-retract-reason-${kind}`} />
      </Field>
      <FormError message={message} />
      <div className="flex flex-wrap gap-3">
        <button type="submit" className={buttonDangerClass} disabled={busy} data-testid={`procedure-retract-${kind}`}>
          取り下げる
        </button>
      </div>
    </form>
  );
}

/** 計画の詳細の「手続きの記録」の節。 */
export function ProcedureRecordsPanel({
  planId,
  planVersion,
  summary,
  records,
  canRecord,
  voided,
}: {
  readonly planId: string;
  readonly planVersion: number;
  readonly summary: readonly ProcedureRecordSummaryDto[];
  readonly records: readonly ProcedureRecordDto[];
  readonly canRecord: boolean;
  readonly voided: boolean;
}) {
  const shown = summary.filter((s) => s.applicable || s.latest !== null);
  if (shown.length === 0) {
    return (
      <p className="text-sm text-ink-mute" data-testid="procedure-none">
        この計画の判定には、DIPS の許可・承認の申請や、小型無人機等飛行禁止法の手続きはありません。
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-4" data-testid="plan-procedures">
      {/* 記録は利用者の申告で、許可・承認が下りたことを示すものではない。カードの上で先に読めるよう、枠つきで置く。 */}
      <p className="rounded-sharp border border-l-4 border-rule border-l-brand-700 bg-paper-soft px-3 py-2.5 text-sm leading-relaxed text-ink">{PROCEDURE_RECORD_NOTE}</p>
      {shown.map((s) => {
        const mine = records.filter((r) => r.kind === s.kind);
        const done = s.status === "done";
        return (
          <article key={s.kind} className="flex flex-col gap-3 rounded-sharp border border-rule bg-paper" data-testid={`procedure-${s.kind}`} data-status={s.status}>
            <header className="flex flex-col gap-2.5 border-b border-rule-soft px-3 pb-3 pt-3 sm:px-4">
              <h3 className="text-sm font-medium text-ink">{s.kindLabel}</h3>
              <div className={`flex flex-col gap-1 rounded-sharp border border-l-4 px-3 py-2.5 ${STATUS_BOX[s.status]}`}>
                <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
                  <Badge tone={STATUS_TONE[s.status]} data-testid={`procedure-status-${s.kind}`} data-status={s.status}>
                    <span aria-hidden className="mr-1">{STATUS_GLYPH[s.status]}</span>
                    {s.statusLabel}
                  </Badge>
                  {s.latest && done ? (
                    <span className="font-mono text-xs tnum text-ink" data-testid={`procedure-latest-${s.kind}`}>
                      {s.latest.doneAtJst}
                      {s.latest.reference ? `・控え ${s.latest.reference}` : ""}
                    </span>
                  ) : null}
                </p>
                {s.deadlineLabel ? (
                  <p className="text-xs leading-relaxed text-ink-soft" data-testid={`procedure-deadline-${s.kind}`}>
                    {s.deadlineLabel}
                  </p>
                ) : null}
                {s.status === "stale" ? (
                  <p className="text-xs leading-relaxed text-ink" data-testid={`procedure-stale-${s.kind}`}>
                    {PROCEDURE_RECORD_STALE_LABEL}
                  </p>
                ) : null}
              </div>
            </header>
            <div className="flex flex-col gap-3 px-3 sm:px-4">
              {canRecord && !voided ? (
                done ? (
                  <RetractForm planId={planId} planVersion={planVersion} kind={s.kind} />
                ) : s.applicable ? (
                  <DoneForm planId={planId} planVersion={planVersion} kind={s.kind} />
                ) : null
              ) : !canRecord ? (
                <p className="text-xs text-ink-mute">記録は運航管理者と、この計画の操縦者本人だけが行えます。</p>
              ) : null}
            </div>
            {mine.length > 0 ? (
              <ol className="mx-3 mb-3 flex flex-col border-t border-rule-soft sm:mx-4" data-testid={`procedure-history-${s.kind}`}>
                {mine.map((r) => (
                  <li key={r.id} className="flex flex-col gap-1 border-b border-rule-soft py-2.5 text-xs text-ink-soft last:border-b-0" data-testid="procedure-history-row" data-action={r.action}>
                    <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                      <span className="text-sm font-medium text-ink">{r.label}</span>
                      {r.doneAtJst ? <span className="font-mono tnum text-ink">{r.doneAtJst}</span> : null}
                    </span>
                    <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                      <span>版 {r.planVersion}</span>
                      <time dateTime={r.createdAt} className="font-mono tnum">{r.createdAtJst}</time>
                      <span>{r.recordedByName}</span>
                    </span>
                    {r.reference ? <span className="break-all">控え：{r.reference}</span> : null}
                    {r.reason ? <span className="break-all">理由：{r.reason}</span> : null}
                    {!r.forCurrentSnapshot && r.action === "done" ? <span className="text-ink-mute">前の判定に対する記録です。</span> : null}
                  </li>
                ))}
              </ol>
            ) : (
              <span className="pb-0.5" />
            )}
          </article>
        );
      })}
    </div>
  );
}
