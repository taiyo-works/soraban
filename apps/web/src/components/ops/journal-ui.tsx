import type { JournalMismatch } from "@/server/ops/journal-logic";
import { fieldGapLabel, type FieldGapLike } from "@/lib/ops-field";
import { Badge } from "./ui";

// 日誌の食い違いの札・離陸時の未了事項の写し（Sprint 12c 設計 D）。知らせるだけで、保存は止めない。
// 札は記号と文字で示す（色だけにしない）。表示の文言はサーバーが導出した label をそのまま使う。

export function MismatchBadges({ mismatches }: { readonly mismatches: readonly JournalMismatch[] }) {
  if (mismatches.length === 0) return null;
  return (
    <span className="flex flex-col items-start gap-1" data-testid="flight-mismatches">
      {mismatches.map((m) => (
        <Badge key={m.code} tone="amber" data-testid="flight-mismatch" data-code={m.code}>
          <span aria-hidden>！ </span>
          <span className="whitespace-normal">{m.label}</span>
        </Badge>
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
