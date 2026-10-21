"use client";

// 通報・手続きの記録の画面で共通に使う入力部品（Sprint 12b）。
import { Field, inputClass } from "./ops-client";

/** 日本時間の日付と時刻（`YYYY-MM-DDTHH:MM`）。値が揃っていないときは空文字。 */
export const joinJst = (date: string, time: string): string => (date && time ? `${date}T${time.slice(0, 5)}` : "");

export const splitJst = (v: string | null | undefined): { date: string; time: string } => {
  if (!v) return { date: "", time: "" };
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(v);
  return m ? { date: m[1]!, time: m[2]! } : { date: "", time: "" };
};

export function JstDateTimeField({
  label,
  date,
  time,
  onDate,
  onTime,
  error,
  testId,
  hint = "日本時間",
}: {
  readonly label: string;
  readonly date: string;
  readonly time: string;
  readonly onDate: (v: string) => void;
  readonly onTime: (v: string) => void;
  readonly error?: string;
  readonly testId: string;
  readonly hint?: string;
}) {
  return (
    <div className="grid grid-cols-2 gap-3" data-testid={testId}>
      <Field label={`${label}（日付）`} required error={error} hint={hint}>
        <input type="date" className={`${inputClass} min-h-12 font-mono tnum`} value={date} onChange={(e) => onDate(e.target.value)} data-testid={`${testId}-date`} />
      </Field>
      <Field label={`${label}（時刻）`} required>
        <input type="time" className={`${inputClass} min-h-12 font-mono tnum`} value={time} onChange={(e) => onTime(e.target.value)} data-testid={`${testId}-time`} />
      </Field>
    </div>
  );
}

/** 画面の確認のチェック（44px 以上の行）。 */
export const confirmRowClass =
  "flex min-h-11 cursor-pointer items-start gap-3 rounded-sharp border border-rule-soft bg-paper px-3 py-2.5 text-sm leading-snug text-ink hover:bg-paper-soft has-[:checked]:border-brand-700 has-[:checked]:bg-brand-50 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-700";
export const confirmBoxClass = "mt-0.5 h-5 w-5 shrink-0 cursor-pointer accent-brand-700";
