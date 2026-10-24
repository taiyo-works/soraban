import { cx } from "./cx";
import { Icon } from "./icons";

// 行程の 1 行（判定→計画→確認→通報→点検→飛行→日誌。docs/design/ux-audit.md 5.2）。サーバーでも描ける（フックなし）。
// 各段は「文字＋アイコン＋済／次／未」。罫線の色は補助で、状態は文字と印が伝える（色だけに頼らない）。
// 7 段が 320px でも折り返さないよう、段の名前は 1 行・12px 以上にしている。
// 「対象外」だけは 3 文字（36px）で、行が 288px を切ると 1 段が 36px に届かない。そのときは「－」を見せ、文字は読み上げ・コピー用に残す
// （幅の判断は CSS のコンテナクエリ。段の数は変えない）。

export type JourneyLineState = "done" | "next" | "todo" | "skip";
export type JourneyLineStage = { readonly label: string; readonly state: JourneyLineState; readonly stateLabel?: string };

const DEFAULT_STATE_LABEL: Readonly<Record<JourneyLineState, string>> = { done: "済", next: "次", todo: "未", skip: "対象外" };

/** 見本用：済の段数から 7 段を作る（済の次が「次」、それより先は「未」）。 */
export function stagesFromDone(labels: readonly string[], done: number, nextLabel = "次"): JourneyLineStage[] {
  return labels.map((label, i) => ({ label, state: i < done ? "done" : i === done ? "next" : "todo", ...(i === done ? { stateLabel: nextLabel } : {}) }));
}

/**
 * 行程表（ホームの「次の飛行」の主役）。航空日誌の紙面らしく、罫で区切った 7 つの欄に、通し番号（等幅の 01〜07）・段の名前・済／次／未を置く。
 * 「次」の欄だけは面を塗り、押印のような四角い印（「次」）を付ける。番号は CSS の counter で付ける（文書の文字は変えない：テストの読み取りと同じ）。
 * 色は補助で、状態は文字と印（チェック・四角の印）が伝える。欄は 7 つで折り返さない（幅は欄ごとに 1/7）。
 */
export function JourneyLedger({ stages, "data-testid": testId = "route" }: { readonly stages: readonly JourneyLineStage[]; readonly "data-testid"?: string }) {
  return (
    <ol
      aria-label="行程"
      data-testid={testId}
      data-variant="ledger"
      className="@container grid border-b-2 border-fg bg-surface [counter-reset:stage]"
      style={{ gridTemplateColumns: `repeat(${stages.length}, minmax(0, 1fr))` }}
    >
      {stages.map((s, i) => {
        const text = s.stateLabel ?? DEFAULT_STATE_LABEL[s.state];
        return (
          <li
            key={s.label}
            data-stage-state={s.state}
            className={cx(
              "flex min-w-0 flex-col items-start gap-1 border-t-[3px] px-1.5 pb-2.5 pt-1.5 [counter-increment:stage] before:font-mono before:text-[12px] before:leading-none before:tracking-wider before:text-fg-mute before:content-[counter(stage,decimal-leading-zero)] @md:px-3",
              i > 0 && "border-l border-l-line",
              s.state === "done" && "border-t-fg-soft",
              s.state === "next" && "border-t-accent bg-accent-soft before:text-accent",
              s.state === "todo" && "border-t-line-strong",
              s.state === "skip" && "border-t-line-strong border-dashed",
            )}
          >
            <span className={cx("whitespace-nowrap text-body font-semibold leading-snug", s.state === "next" ? "text-accent" : s.state === "done" ? "text-fg" : "text-fg-mute")}>{s.label}</span>
            <span className={cx("inline-flex min-h-6 items-center gap-0.5 whitespace-nowrap text-aux leading-none", s.state === "done" ? "text-fg-soft" : "text-fg-mute")}>
              {s.state === "next" ? (
                <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-[2px] border-2 border-accent-solid bg-accent-solid px-1 text-table font-bold leading-none text-accent-fg">{text}</span>
              ) : s.state === "done" ? (
                <>
                  <Icon name="check" size={13} />
                  {text}
                </>
              ) : s.state === "skip" ? (
                <>
                  <span aria-hidden="true" className="hidden @max-[18rem]:inline">
                    －
                  </span>
                  <span className="@max-[18rem]:sr-only">{text}</span>
                </>
              ) : (
                text
              )}
            </span>
          </li>
        );
      })}
    </ol>
  );
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
    <ol aria-label="行程" data-testid={testId} className={cx("@container grid", compact ? "gap-1" : "gap-1.5")} style={{ gridTemplateColumns: `repeat(${stages.length}, minmax(0, 1fr))` }}>
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
              s.state === "todo" && "border-line",
              s.state === "skip" && "border-dashed border-line-strong",
            )}
          >
            <span className={cx("whitespace-nowrap text-table", s.state === "next" ? "font-semibold text-accent" : s.state === "done" ? "font-medium text-fg" : "text-fg-mute")}>{s.label}</span>
            <span className={cx("inline-flex items-center gap-0.5 whitespace-nowrap text-aux", s.state === "next" ? "font-semibold text-accent" : s.state === "done" ? "text-fg-soft" : "text-fg-mute")}>
              {s.state === "done" ? <Icon name="check" size={12} /> : s.state === "next" ? <Icon name="chevron-right" size={12} /> : s.state === "skip" ? null : <span aria-hidden="true" className="inline-block w-3" />}
              {s.state === "skip" ? (
                <>
                  <span aria-hidden="true" className="hidden @max-[18rem]:inline">
                    －
                  </span>
                  <span className="@max-[18rem]:sr-only">{text}</span>
                </>
              ) : (
                text
              )}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
