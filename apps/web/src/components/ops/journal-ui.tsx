import { Icon } from "@/components/ui/icons";
import type { JournalMismatch } from "@/server/ops/journal-logic";
import { fieldGapLabel, type FieldGapLike } from "@/lib/ops-field";

// 日誌の食い違いの札・離陸時の未了事項の写し（Sprint 12c 設計 D）。知らせるだけで、保存は止めない。
// 札は記号と文字で示す（色だけにしない）。表示の文言はサーバーが導出した label をそのまま使う。

export function MismatchBadges({ mismatches }: { readonly mismatches: readonly JournalMismatch[] }) {
  if (mismatches.length === 0) return null;
  // 注意の印（ui/primitives の StatusPill と同じ作り）。折り返す文なので札の高さは固定せず、アイコンは先頭に揃える。
  return (
    <span className="flex flex-col items-stretch gap-1.5" data-testid="flight-mismatches">
      {mismatches.map((m) => (
        <span
          key={m.code}
          className="flex items-start gap-2 rounded-sb-m border-[1.5px] border-dashed border-sb-ink bg-sb-base px-3 py-2 text-[0.875rem] leading-snug text-sb-ink [text-wrap:pretty]"
          data-testid="flight-mismatch"
          data-code={m.code}
        >
          <Icon name="alert" size={16} className="mt-0.5 shrink-0 text-sb-ink" />
          <span className="min-w-0">{m.label}</span>
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
          <Icon name="alert" size={16} className="mt-1 shrink-0 text-sb-ink" />
          <span>{fieldGapLabel(g)}</span>
        </li>
      ))}
    </ul>
  );
}
