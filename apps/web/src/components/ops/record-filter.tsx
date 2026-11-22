import { buttonGhostClass } from "./ui";

// 一覧の絞り込み（機体・期間）。通常の GET の form で送る（JavaScript なしでも使える）。
export function RecordFilter({
  basePath,
  aircraft,
  value,
  hidden = {},
}: {
  readonly basePath: string;
  readonly aircraft: readonly { readonly id: string; readonly registrationMark: string }[];
  readonly value: { readonly aircraftId?: string; readonly from?: string; readonly to?: string; readonly includeVoided?: boolean };
  /** 絞り込みの送信で引き継ぐ値（点検の一覧の区分など）。 */
  readonly hidden?: Readonly<Record<string, string>>;
}) {
  const input = "sb-input sb-input-sm";
  return (
    <form method="get" action={basePath} className="sb-block-soft grid grid-cols-2 gap-x-3 gap-y-3 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end" aria-label="絞り込み">
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <label className="col-span-2 flex min-w-0 flex-col gap-1 text-[0.875rem] font-bold text-sb-ink-2 sm:col-span-1">
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
      <label className="flex min-w-0 flex-col gap-1 text-[0.875rem] font-bold text-sb-ink-2">
        期間（から）
        <input type="date" name="from" defaultValue={value.from ?? ""} className={`${input} tnum`} />
      </label>
      <label className="flex min-w-0 flex-col gap-1 text-[0.875rem] font-bold text-sb-ink-2">
        期間（まで）
        <input type="date" name="to" defaultValue={value.to ?? ""} className={`${input} tnum`} />
      </label>
      <div className="col-span-2 flex flex-wrap items-center justify-between gap-3 sm:col-span-1 sm:justify-start">
        <label className="flex min-h-12 items-center gap-2 text-[0.875rem] text-sb-ink">
          <input type="checkbox" name="includeVoided" value="1" defaultChecked={value.includeVoided} className="sb-check" />
          取消済みも含める
        </label>
        <button type="submit" className={buttonGhostClass}>
          絞り込む
        </button>
      </div>
    </form>
  );
}
