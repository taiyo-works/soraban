import type { ItemVerdict } from "@soraban/regulations";
import { VERDICT_LABEL, VERDICT_SHAPE, VERDICT_TONE } from "@/lib/verdict-display";

type Props = {
  readonly level: ItemVerdict;
  readonly size?: "sm" | "md" | "lg";
  /** 読み上げの言葉を省く（隣に段階の言葉があるとき）。 */
  readonly decorative?: boolean;
};

const SIZE = { sm: 14, md: 20, lg: 44 } as const;

// 段階の記号（Sprint 11d D1。信号の 3 灯の置き換え）。形で段階を区別し、色は補助（currentColor）。
// 形の定義は lib/verdict-display.ts（PDF と共通）。線の太さ・寸法・配色は designer が磨く。
export function VerdictMark({ level, size = "md", decorative = false }: Props) {
  const px = SIZE[size];
  const shape = VERDICT_SHAPE[level];
  return (
    <svg
      data-testid="verdict-mark"
      data-level={level}
      data-shape={shape}
      width={px}
      height={px}
      viewBox="0 0 24 24"
      className={`shrink-0 ${VERDICT_TONE[level]}`}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      {...(decorative
        ? { "aria-hidden": true }
        : { role: "img", "aria-label": VERDICT_LABEL[level] })}
    >
      {shape === "slashed-circle" ? (
        <>
          <circle cx="12" cy="12" r="9" />
          <line x1="5.6" y1="18.4" x2="18.4" y2="5.6" />
        </>
      ) : null}
      {shape === "triangle" ? <polygon points="12,3 21.5,20 2.5,20" strokeLinejoin="round" /> : null}
      {shape === "checked-ring" ? (
        <>
          <circle cx="12" cy="12" r="9" />
          <polyline points="7.5,12.5 10.5,15.5 16.5,8.5" strokeLinecap="round" strokeLinejoin="round" />
        </>
      ) : null}
      {shape === "filled-circle" ? <circle cx="12" cy="12" r="8" fill="currentColor" /> : null}
      {shape === "dashed-square" ? (
        <>
          <rect x="3" y="3" width="18" height="18" strokeDasharray="3 2.5" />
          <text
            x="12"
            y="16.5"
            textAnchor="middle"
            fontSize="12"
            fontWeight="700"
            fill="currentColor"
            stroke="none"
          >
            ?
          </text>
        </>
      ) : null}
    </svg>
  );
}
