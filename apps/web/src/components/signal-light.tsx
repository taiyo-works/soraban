import type { RegulationStatus } from "@soraban/regulations";

type Props = {
  readonly status: RegulationStatus;
  readonly size?: "sm" | "lg";
};

const dotBase = "rounded-full border";

const sizeClass = {
  sm: "h-3 w-3",
  lg: "h-12 w-12",
} as const;

// アクティブな灯火: 製図インク調の色 + 紙地に映える微弱なリング。
// 派手な glow は撤廃して "ledではなくインクで描かれた信号" の語彙に寄せる。
const colorClass: Record<RegulationStatus, string> = {
  red: "bg-signal-red border-signal-red ring-2 ring-signal-red/30",
  yellow: "bg-signal-amber border-signal-amber ring-2 ring-signal-amber/30",
  green: "bg-signal-green border-signal-green ring-2 ring-signal-green/30",
  unknown: "bg-signal-mute border-signal-mute",
};

const dimClass = "bg-paper-deep border-rule";

export function SignalLight({ status, size = "lg" }: Props) {
  const lights: ReadonlyArray<RegulationStatus> = ["red", "yellow", "green"];
  return (
    <div
      role="img"
      aria-label={`総合判定: ${status}`}
      className="inline-flex flex-col items-center gap-1.5 rounded-sharp border border-ink/80 bg-ink p-2.5"
    >
      {lights.map((light) => (
        <span
          key={light}
          className={`${dotBase} ${sizeClass[size]} ${light === status ? colorClass[light] : dimClass}`}
        />
      ))}
    </div>
  );
}
