"use client";

// 計画作成の段 ②（日時）のクイック選択（Sprint 16-H2 H2-1）。
// 「今日」「明日」・30 分刻みの開始時刻・飛行時間（15・30・60・90 分）を、押す部品（48px 以上）で先に出す。
// 選択中は aria-pressed="true"＋薄い主色の面＋チェックの記号（色だけに頼らない）。標準の日付・時刻・数値の入力欄は別に残る。
// 入力は React の状態だけ。端末のストレージには書かない（K-15）。
import { jstDate, jstTime } from "@/lib/ops-time";

const DAY_MS = 24 * 60 * 60 * 1000;

/** JST の今日と明日の日付（YYYY-MM-DD）。 */
export const quickDates = (now: Date): { readonly today: string; readonly tomorrow: string } => ({
  today: jstDate(now),
  tomorrow: jstDate(new Date(now.getTime() + DAY_MS)),
});

/** 30 分刻みの開始時刻の候補（HH:MM）の数。 */
export const QUICK_SLOT_COUNT = 12;
/** 今日以外の日の最初の候補。 */
export const QUICK_FIRST_SLOT = "08:00";

const toMinutes = (hm: string): number => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));
const toHm = (m: number): string => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/**
 * 30 分刻みの開始時刻の候補。今日は、今の次の 30 分から（日付が変わる 23:30 まで）。今日以外は 08:00 から。
 * 6 時間分（12 個）まで。
 */
export const quickStartSlots = (dateIsToday: boolean, now: Date): readonly string[] => {
  let first = toMinutes(QUICK_FIRST_SLOT);
  if (dateIsToday) {
    const cur = toMinutes(jstTime(now));
    first = Math.ceil((cur + 1) / 30) * 30;
  }
  const out: string[] = [];
  for (let m = first; m < 24 * 60 && out.length < QUICK_SLOT_COUNT; m += 30) out.push(toHm(m));
  return out;
};

export const QUICK_DURATIONS = [15, 30, 60, 90] as const;

function QuickButton({ pressed, onClick, testId, children }: { readonly pressed: boolean; readonly onClick: () => void; readonly testId: string; readonly children: string }) {
  return (
    <button type="button" className="opx-quick-btn" aria-pressed={pressed} onClick={onClick} data-testid={testId}>
      <svg aria-hidden width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="opx-quick-mark">
        <path d="M5 12.5l4.5 4.5L19 7.5" />
      </svg>
      <span>{children}</span>
    </button>
  );
}

export function QuickWhen({
  now,
  startDate,
  startTime,
  duration,
  onDate,
  onTime,
  onDuration,
}: {
  readonly now: Date;
  readonly startDate: string;
  readonly startTime: string;
  readonly duration: string;
  readonly onDate: (v: string) => void;
  readonly onTime: (v: string) => void;
  readonly onDuration: (v: string) => void;
}) {
  const d = quickDates(now);
  const slots = quickStartSlots(startDate === d.today, now);
  return (
    <div className="flex flex-col gap-4" data-testid="plan-quick">
      <div role="group" aria-labelledby="plan-quick-date-h" className="flex flex-col gap-2" data-testid="plan-quick-date">
        <p id="plan-quick-date-h" className="opx-quick-head">日付をすぐ選ぶ</p>
        <div className="opx-quick-row">
          <QuickButton pressed={startDate === d.today} onClick={() => onDate(d.today)} testId="plan-quick-today">今日</QuickButton>
          <QuickButton pressed={startDate === d.tomorrow} onClick={() => onDate(d.tomorrow)} testId="plan-quick-tomorrow">明日</QuickButton>
        </div>
      </div>
      <div role="group" aria-labelledby="plan-quick-time-h" className="flex flex-col gap-2" data-testid="plan-quick-time">
        <p id="plan-quick-time-h" className="opx-quick-head">開始時刻をすぐ選ぶ（30 分刻み、日本時間）</p>
        {slots.length === 0 ? (
          <p data-note="" className="opx-hint" data-testid="plan-quick-time-empty">
            今日は、このあと 30 分刻みの候補がありません。明日を選ぶか、下の時刻の入力欄に入れてください。
          </p>
        ) : null}
        <div className="opx-quick-grid">
          {slots.map((s) => (
            <QuickButton key={s} pressed={startTime === s} onClick={() => onTime(s)} testId={`plan-quick-time-${s.replace(":", "")}`}>
              {s}
            </QuickButton>
          ))}
        </div>
      </div>
      <div role="group" aria-labelledby="plan-quick-dur-h" className="flex flex-col gap-2" data-testid="plan-quick-duration">
        <p id="plan-quick-dur-h" className="opx-quick-head">飛行時間をすぐ選ぶ</p>
        <div className="opx-quick-row">
          {QUICK_DURATIONS.map((m) => (
            <QuickButton key={m} pressed={duration.trim() === String(m)} onClick={() => onDuration(String(m))} testId={`plan-quick-duration-${m}`}>
              {`${m} 分`}
            </QuickButton>
          ))}
        </div>
      </div>
    </div>
  );
}
