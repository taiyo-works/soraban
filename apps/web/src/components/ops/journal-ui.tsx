import type { JournalMismatch } from "@/server/ops/journal-logic";
import { fieldGapLabel, type FieldGapLike } from "@/lib/ops-field";

// 日誌の食い違いの札・離陸時の未了事項の写し（Sprint 12c 設計 D）。知らせるだけで、保存は止めない。
// 札は記号と文字で示す（色だけにしない）。表示の文言はサーバーが導出した label をそのまま使う。

export function MismatchBadges({ mismatches }: { readonly mismatches: readonly JournalMismatch[] }) {
  if (mismatches.length === 0) return null;
  return (
    <span className="flex flex-col items-stretch gap-1.5" data-testid="flight-mismatches">
      {mismatches.map((m) => (
        <span
          key={m.code}
          className="flex items-start gap-2 rounded-sharp border-2 border-signal-amber bg-signal-amber-soft px-2 py-1.5 text-sm leading-snug text-ink"
          data-testid="flight-mismatch"
          data-code={m.code}
        >
          <span aria-hidden className="font-bold">
            ！
          </span>
          <span>{m.label}</span>
        </span>
      ))}
    </span>
  );
}

export function TakeoffGaps({ gaps }: { readonly gaps: readonly FieldGapLike[] | null }) {
  if (gaps === null) return null;
  return gaps.length === 0 ? (
    <span data-testid="flight-takeoff-gaps-none">離陸の時点で未了の項目はありませんでした。</span>
  ) : (
    <ul className="flex flex-col gap-1" data-testid="flight-takeoff-gaps">
      {gaps.map((g) => (
        <li key={g.item} className="flex items-start gap-2" data-testid="flight-takeoff-gap" data-item={g.item}>
          <span aria-hidden>！</span>
          <span>{fieldGapLabel(g)}</span>
        </li>
      ))}
    </ul>
  );
}
