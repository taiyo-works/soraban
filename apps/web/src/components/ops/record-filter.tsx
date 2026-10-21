import { buttonGhostClass } from "./ui";

// 一覧の絞り込み（機体・期間）。通常の GET の form で送る（JavaScript なしでも使える）。
export function RecordFilter({
  basePath,
  aircraft,
  value,
}: {
  readonly basePath: string;
  readonly aircraft: readonly { readonly id: string; readonly registrationMark: string }[];
  readonly value: { readonly aircraftId?: string; readonly from?: string; readonly to?: string; readonly includeVoided?: boolean };
}) {
  const input =
    "min-h-11 w-full min-w-0 rounded-sharp border border-rule bg-paper px-3 py-2 text-base text-ink outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-700 sm:text-sm";
  return (
    <form method="get" action={basePath} className="grid grid-cols-2 gap-x-3 gap-y-2.5 rounded-sharp border border-rule-soft p-3 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end" aria-label="絞り込み">
      <label className="col-span-2 flex min-w-0 flex-col gap-1 text-xs text-ink-mute sm:col-span-1">
        機体
        <select name="aircraftId" defaultValue={value.aircraftId ?? ""} className={input}>
          <option value="">すべて</option>
          {aircraft.map((a) => (
            <option key={a.id} value={a.id}>
              {a.registrationMark}
            </option>
          ))}
        </select>
      </label>
      <label className="flex min-w-0 flex-col gap-1 text-xs text-ink-mute">
        期間（から）
        <input type="date" name="from" defaultValue={value.from ?? ""} className={`${input} tnum`} />
      </label>
      <label className="flex min-w-0 flex-col gap-1 text-xs text-ink-mute">
        期間（まで）
        <input type="date" name="to" defaultValue={value.to ?? ""} className={`${input} tnum`} />
      </label>
      <div className="col-span-2 flex flex-wrap items-center justify-between gap-3 sm:col-span-1 sm:justify-start">
        <label className="flex min-h-11 items-center gap-2 text-xs text-ink-soft">
          <input type="checkbox" name="includeVoided" value="1" defaultChecked={value.includeVoided} className="h-4 w-4 accent-brand-700" />
          取消済みも含める
        </label>
        <button type="submit" className={buttonGhostClass}>
          絞り込む
        </button>
      </div>
    </form>
  );
}
