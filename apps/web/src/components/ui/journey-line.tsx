import { cx } from "./cx";
import { Icon } from "./icons";

// 行程の 1 行（判定→計画→確認→通報→点検→飛行→日誌。docs/design/ux-audit.md 5.2）。サーバーでも描ける（フックなし）。
// 各段は「文字＋アイコン＋済／次／未」。罫線の色は補助で、状態は文字と印が伝える（色だけに頼らない）。
// 7 段が 320px でも折り返さないよう、段の名前は 1 行・12px 以上にしている。

export type JourneyLineState = "done" | "next" | "todo" | "skip";
export type JourneyLineStage = { readonly label: string; readonly state: JourneyLineState; readonly stateLabel?: string };

const DEFAULT_STATE_LABEL: Readonly<Record<JourneyLineState, string>> = { done: "済", next: "次", todo: "未", skip: "対象外" };

/** 見本用：済の段数から 7 段を作る（済の次が「次」、それより先は「未」）。 */
export function stagesFromDone(labels: readonly string[], done: number, nextLabel = "次"): JourneyLineStage[] {
  return labels.map((label, i) => ({ label, state: i < done ? "done" : i === done ? "next" : "todo", ...(i === done ? { stateLabel: nextLabel } : {}) }));
}

export function JourneyLine({
  stages,
  compact = false,
  "data-testid": testId = "route",
}: {
  readonly stages: readonly JourneyLineStage[];
  readonly compact?: boolean;
  readonly "data-testid"?: string;
}) {
  return (
    <ol aria-label="行程" data-testid={testId} className={cx("grid", compact ? "gap-1" : "gap-1.5")} style={{ gridTemplateColumns: `repeat(${stages.length}, minmax(0, 1fr))` }}>
      {stages.map((s) => {
        const text = s.stateLabel ?? DEFAULT_STATE_LABEL[s.state];
        return (
          <li
            key={s.label}
            data-stage-state={s.state}
            className={cx(
              "flex min-w-0 flex-col gap-0.5 border-t-2 pt-1.5",
              s.state === "done" && "border-fg-soft",
              s.state === "next" && "border-accent",
              (s.state === "todo" || s.state === "skip") && "border-line",
            )}
          >
            <span className={cx("whitespace-nowrap text-table", s.state === "next" ? "font-semibold text-accent" : s.state === "done" ? "font-medium text-fg" : "text-fg-mute")}>{s.label}</span>
            <span className={cx("inline-flex items-center gap-0.5 whitespace-nowrap text-aux", s.state === "next" ? "font-semibold text-accent" : s.state === "done" ? "text-fg-soft" : "text-fg-mute")}>
              {s.state === "done" ? <Icon name="check" size={12} /> : s.state === "next" ? <Icon name="chevron-right" size={12} /> : s.state === "skip" ? null : <span aria-hidden="true" className="inline-block w-3" />}
              {text}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
