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

const colorClass: Record<RegulationStatus, string> = {
  red: "bg-rose-500 border-rose-600 shadow-[0_0_18px_rgba(244,63,94,0.55)]",
  yellow: "bg-amber-400 border-amber-500 shadow-[0_0_18px_rgba(251,191,36,0.55)]",
  green: "bg-emerald-500 border-emerald-600 shadow-[0_0_18px_rgba(16,185,129,0.55)]",
};

const dimClass = "bg-zinc-200 border-zinc-300 dark:bg-zinc-800 dark:border-zinc-700";

export function SignalLight({ status, size = "lg" }: Props) {
  const lights: ReadonlyArray<RegulationStatus> = ["red", "yellow", "green"];
  return (
    <div
      role="img"
      aria-label={`総合判定: ${status}`}
      className="inline-flex flex-col items-center gap-1.5 rounded-2xl border border-zinc-300 bg-zinc-900 p-2 dark:border-zinc-700"
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
