import type { ItemVerdict, LegalTier } from "@soraban/regulations";
import {
  legalTierWeight,
  VERDICT_GEOMETRY as G,
  VERDICT_LABEL,
  VERDICT_SHAPE,
  VERDICT_TONE,
} from "@/lib/verdict-display";

type Props = {
  readonly level: ItemVerdict;
  readonly size?: "sm" | "md" | "lg";
  /** 読み上げの言葉を省く（隣に段階の言葉があるとき）。 */
  readonly decorative?: boolean;
};

const SIZE = { sm: 14, md: 20, lg: 40 } as const;
// 線の太さ（viewBox 24 の単位）。大きい記号ほど細くし、画面上の線幅を 1.5〜2.2px に揃える。
const STROKE = { sm: 2.4, md: 2, lg: 1.35 } as const;

/** 記号の形だけ（色は currentColor）。結論の目盛りなど、data-testid を付けない場面でも使う。 */
export function VerdictGlyph({ level, strokeWidth }: { level: ItemVerdict; strokeWidth: number }) {
  const shape = VERDICT_SHAPE[level];
  const line = { stroke: "currentColor", strokeWidth, fill: "none", strokeLinecap: "butt", strokeLinejoin: "miter" } as const;
  return (
    <>
      {shape === "slashed-circle" ? (
        <>
          <circle {...G.ring} {...line} />
          <line {...G.slash} {...line} />
        </>
      ) : null}
      {shape === "triangle" ? (
        <>
          <polygon points={G.triangle} {...line} />
          <line {...G.triangleBar} {...line} />
        </>
      ) : null}
      {shape === "checked-ring" ? (
        <>
          <circle {...G.ring} {...line} />
          <polyline points={G.check} {...line} />
        </>
      ) : null}
      {shape === "filled-circle" ? (
        <>
          <circle {...G.ring} {...line} />
          <circle {...G.disc} fill="currentColor" stroke="none" />
        </>
      ) : null}
      {shape === "dashed-square" ? (
        <>
          <rect x={G.square.x} y={G.square.y} width={G.square.size} height={G.square.size} {...line} strokeDasharray={G.square.dash} />
          <path d={G.question} {...line} />
          <circle {...G.questionDot} fill="currentColor" stroke="none" />
        </>
      ) : null}
    </>
  );
}

// 段階の記号（Sprint 11d。信号の 3 灯の置き換え）。形で段階を区別し、色は補助（currentColor）。
// 形の定義は lib/verdict-display.ts（PDF と共通）。計器の表示に倣い、細い線・切り落とした端で描く。
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
      {...(decorative
        ? { "aria-hidden": true }
        : { role: "img", "aria-label": VERDICT_LABEL[level] })}
    >
      <VerdictGlyph level={level} strokeWidth={STROKE[size]} />
    </svg>
  );
}

/** 法的な重さの目盛り（3 本の棒。国の法律 = 3、条例 = 2、施設管理者の取り決め = 1）。 */
export function TierGauge({ tier }: { tier: LegalTier }) {
  const w = legalTierWeight(tier);
  return (
    <span aria-hidden className="inline-flex items-end gap-[2px]">
      {[1, 2, 3].map((i) => (
        <span
          key={i}
          className={`w-[3px] ${i <= w ? "bg-ink" : "bg-rule"}`}
          style={{ height: `${4 + i * 3}px` }}
        />
      ))}
    </span>
  );
}
