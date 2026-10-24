import type { ItemVerdict } from "@soraban/regulations";
import { VERDICT_LABEL, VERDICT_TONE } from "@/lib/verdict-display";
import { cx, type DataAttrs } from "./cx";
import { VerdictMark } from "@/components/verdict-mark";

/**
 * A verdict as a quiet seal: a double ruled frame around the symbol and the words, in the verdict's ink colour.
 * The symbol and the words carry the meaning, the colour only supports them (WCAG 1.4.1). No fill, no rotation, no shadow.
 * Used by the design catalog; the existing screens keep VerdictMark as it is.
 */
export function VerdictStamp({
  level,
  size = "md",
  className,
  labelTestId,
  ...rest
}: {
  readonly level: ItemVerdict;
  readonly size?: "sm" | "md";
  readonly className?: string;
  readonly labelTestId?: string;
} & DataAttrs) {
  return (
    <span
      {...rest}
      data-level={level}
      className={cx(
        "inline-flex max-w-full items-center gap-2 rounded-ctl border border-current font-semibold [outline:1px_solid_currentColor] [outline-offset:-4px] [text-wrap:balance] [word-break:auto-phrase]",
        size === "md" ? "min-h-11 px-3.5 py-1.5 text-body field:min-h-14" : "min-h-8 px-3 py-1 text-aux",
        VERDICT_TONE[level],
        className,
      )}
    >
      <VerdictMark level={level} size={size === "md" ? "md" : "sm"} decorative />
      <span data-testid={labelTestId}>{VERDICT_LABEL[level]}</span>
    </span>
  );
}
