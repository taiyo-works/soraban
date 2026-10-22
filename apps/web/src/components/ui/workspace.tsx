"use client";

import { useCallback, useId, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { cx, type DataAttrs } from "./cx";
import { useKeydown, useMediaQuery } from "./hooks";
import { Icon } from "./icons";
import { BottomTabs, panelId } from "./tabs";

// Workspace (Sprint 12g stage 1a): the layout for screens built around a map (stage 4 uses it for `/` and /ops/places).
//   >= 1024px : [input pane | map | result pane], each pane collapsible from a toggle on its edge ("[" and "]"), plus a
//               "maximize map" button. Floating panels may overlap the map.
//   <  1024px : the map is the whole screen; input and result open as a bottom sheet with three heights
//               (peek / half / full) chosen from a bottom tab bar. The conclusion (`peek`) stays visible at every height.
// Every panel is always in the DOM (the inactive ones are only hidden), so opening, closing or switching never throws
// away what the user typed or what the map shows. Only one copy of each child is rendered at any width.

export type SheetStage = "peek" | "half" | "full";
const STAGES: readonly SheetStage[] = ["peek", "half", "full"];
const STAGE_LABEL: Readonly<Record<SheetStage, string>> = { peek: "最小", half: "半分", full: "全体" };
type TabId = "input" | "result" | "map";

export function Workspace({
  map,
  input,
  result,
  floating,
  peek,
  inputTitle = "入力",
  resultTitle = "結果",
  height = "36rem",
  hotkeys = true,
  ...rest
}: {
  readonly map: ReactNode;
  readonly input: ReactNode;
  readonly result: ReactNode;
  /** Panel floating over the map (>= 1024px only), e.g. a legend. */
  readonly floating?: ReactNode;
  /** One-line conclusion shown in the sheet header at every height (< 1024px). */
  readonly peek: ReactNode;
  readonly inputTitle?: string;
  readonly resultTitle?: string;
  /** CSS height of the frame. Use "100dvh" for a full-screen workspace. */
  readonly height?: string;
  readonly hotkeys?: boolean;
} & DataAttrs) {
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [maximized, setMaximized] = useState(false);
  const [tab, setTab] = useState<TabId>("map");
  const [stage, setStage] = useState<SheetStage>("peek");
  const desktop = useMediaQuery("(min-width: 1024px)");
  const leftId = useId();
  const rightId = useId();
  const prefix = useId();
  const dragY = useRef<number | null>(null);

  const showLeft = leftOpen && !maximized;
  const showRight = rightOpen && !maximized;

  const keys = useCallback(
    (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "[") setLeftOpen((v) => !v);
      else if (e.key === "]") setRightOpen((v) => !v);
    },
    [],
  );
  useKeydown(keys, { enabled: hotkeys && desktop, ignoreEditable: true, ignoreModal: true });

  const step = (dir: 1 | -1): void => {
    setStage((s) => STAGES[Math.min(2, Math.max(0, STAGES.indexOf(s) + dir))]!);
  };
  const cycle = (): void => setStage((s) => STAGES[(STAGES.indexOf(s) + 1) % 3]!);
  const pickTab = (id: string): void => {
    const t = id as TabId;
    setTab(t);
    if (t === "map") setStage("peek");
    else setStage((s) => (s === "peek" ? "half" : s));
  };

  const onHandleDown = (e: ReactPointerEvent<HTMLButtonElement>): void => {
    dragY.current = e.clientY;
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onHandleUp = (e: ReactPointerEvent<HTMLButtonElement>): void => {
    if (dragY.current === null) return;
    const dy = e.clientY - dragY.current;
    dragY.current = null;
    if (Math.abs(dy) < 8) cycle();
    else step(dy < 0 ? 1 : -1);
  };

  const cols = `${showLeft ? "22.5rem" : "0px"} minmax(0, 1fr) ${showRight ? "20rem" : "0px"}`;
  const style = { height, "--ws-cols": cols } as CSSProperties;

  return (
    <div
      {...rest}
      style={style}
      data-sheet-stage={stage}
      className="relative isolate overflow-hidden rounded-card bg-sunken shadow-card lg:grid lg:transition-[grid-template-columns] lg:duration-[var(--dur-sheet)] lg:ease-[var(--ease)] lg:[grid-template-columns:var(--ws-cols)]"
    >
      {/* map layer */}
      <div className="absolute inset-0 min-w-0 lg:relative lg:inset-auto lg:col-start-2 lg:row-start-1" data-testid="workspace-map" id={panelId(prefix, "map")} role="tabpanel" aria-label="地図">
        {map}
        {floating ? <div className="absolute left-3 top-3 z-10 max-w-64 max-lg:hidden">{floating}</div> : null}
        <button
          type="button"
          onClick={() => setMaximized((m) => !m)}
          aria-pressed={maximized}
          aria-label={maximized ? "地図の最大化を戻す" : "地図を最大化"}
          data-testid="workspace-maximize"
          className="glass absolute right-3 top-3 z-10 inline-flex min-h-11 min-w-11 items-center justify-center rounded-ctl text-fg shadow-float hov:bg-sunken max-lg:hidden"
        >
          <Icon name={maximized ? "minimize" : "maximize"} size={18} />
        </button>
        <EdgeToggle side="left" open={showLeft} onClick={() => setLeftOpen((v) => !v)} controls={leftId} label={inputTitle} />
        <EdgeToggle side="right" open={showRight} onClick={() => setRightOpen((v) => !v)} controls={rightId} label={resultTitle} />
      </div>

      {/* dim the map only at the full sheet height (< 1024px) */}
      {stage === "full" ? <button type="button" aria-label="シートを半分に戻す" tabIndex={-1} onClick={() => setStage("half")} className="absolute inset-0 z-10 bg-black/40 lg:hidden" /> : null}

      {/* sheet (< 1024px) / contents (>= 1024px) */}
      <div
        data-testid="workspace-sheet"
        className="absolute inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-20 flex max-h-[calc(100%-4.5rem)] flex-col rounded-t-sheet bg-glass shadow-float transition-[height] duration-[var(--dur-sheet)] ease-[var(--ease)] max-lg:h-[var(--sheet-h)] max-lg:[backdrop-filter:var(--glass-filter)] lg:contents"
      >
        <div className="flex shrink-0 flex-col lg:hidden">
          <button
            type="button"
            aria-label={`シートの高さを変える（現在：${STAGE_LABEL[stage]}）`}
            data-testid="workspace-handle"
            onPointerDown={onHandleDown}
            onPointerUp={onHandleUp}
            onKeyDown={(e) => {
              if (e.key === "ArrowUp") {
                e.preventDefault();
                step(1);
              } else if (e.key === "ArrowDown") {
                e.preventDefault();
                step(-1);
              } else if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                cycle();
              }
            }}
            className="flex min-h-11 w-full touch-none cursor-grab items-center justify-center rounded-t-sheet"
          >
            <span className="h-1 w-9 rounded-pill bg-line-strong" />
          </button>
          <div data-testid="workspace-peek" className="truncate px-4 pb-2 text-table text-fg">
            {peek}
          </div>
        </div>

        <div className="contents">
          <aside
            id={leftId}
            aria-label={inputTitle}
            data-testid="workspace-input"
            inert={desktop && !showLeft}
            className={cx(
              "min-h-0 flex-1 overflow-y-auto px-4 pb-4 lg:col-start-1 lg:row-start-1 lg:flex-none lg:overflow-x-hidden lg:overflow-y-auto lg:border-r lg:border-line lg:bg-surface lg:p-0",
              tab !== "input" && "max-lg:hidden",
            )}
          >
            <div className="lg:w-[22.5rem] lg:p-4">{input}</div>
          </aside>
          <aside
            id={rightId}
            aria-label={resultTitle}
            data-testid="workspace-result"
            inert={desktop && !showRight}
            className={cx(
              "min-h-0 flex-1 overflow-y-auto px-4 pb-4 lg:col-start-3 lg:row-start-1 lg:flex-none lg:overflow-x-hidden lg:overflow-y-auto lg:border-l lg:border-line lg:bg-surface lg:p-0",
              tab !== "result" && "max-lg:hidden",
            )}
          >
            <div className="lg:w-80 lg:p-4">{result}</div>
          </aside>
        </div>
      </div>

      <BottomTabs
        idPrefix={prefix}
        label="パネルの切り替え"
        value={tab}
        onChange={pickTab}
        tabs={[
          { id: "input", label: inputTitle, icon: "sliders" },
          { id: "result", label: resultTitle, icon: "check-circle" },
          { id: "map", label: "地図", icon: "map" },
        ]}
        data-testid="workspace-tabs"
        className="absolute inset-x-0 bottom-0 z-30 lg:hidden"
      />
    </div>
  );
}

function EdgeToggle({ side, open, onClick, controls, label }: { readonly side: "left" | "right"; readonly open: boolean; readonly onClick: () => void; readonly controls: string; readonly label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      aria-controls={controls}
      aria-label={`${label}のペインを${open ? "閉じる" : "開く"}（${side === "left" ? "[" : "]"} キー）`}
      data-testid={`workspace-toggle-${side}`}
      className={cx(
        "glass absolute top-1/2 z-10 inline-flex min-h-14 min-w-11 -translate-y-1/2 items-center justify-center text-fg-soft shadow-float hov:text-fg max-lg:hidden",
        side === "left" ? "left-0 rounded-r-ctl" : "right-0 rounded-l-ctl",
      )}
    >
      <Icon name={side === "left" ? (open ? "chevron-left" : "chevron-right") : open ? "chevron-right" : "chevron-left"} size={18} />
    </button>
  );
}

/** A stand-in for the map (stage 4 puts the real map here). Drawn with tokens only; no data. */
export function MapPlaceholder({ label = "地図の場所（見本）" }: { readonly label?: string }) {
  return (
    <div className="relative h-full w-full overflow-hidden bg-sunken" role="img" aria-label={label}>
      <svg viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full text-line-strong" fill="none" aria-hidden="true">
        <path d="M-10 210C70 190 120 230 200 200S330 150 410 175" stroke="currentColor" strokeWidth="10" opacity=".25" strokeLinecap="round" />
        <path d="M60 -10C80 60 130 90 140 150S190 260 230 310" stroke="currentColor" strokeWidth="6" opacity=".3" strokeLinecap="round" />
        <path d="M-10 90C80 100 160 70 260 95S360 60 410 70" stroke="currentColor" strokeWidth="4" opacity=".3" strokeLinecap="round" />
        <path d="M250 -10C260 40 310 70 320 130S300 230 340 310" stroke="currentColor" strokeWidth="4" opacity=".3" strokeLinecap="round" />
        <circle cx="205" cy="150" r="46" stroke="var(--accent)" strokeWidth="1.5" opacity=".7" />
        <circle cx="205" cy="150" r="46" fill="var(--accent)" opacity=".08" />
      </svg>
      <span className="absolute left-1/2 top-1/2 -ml-3 -mt-8 text-accent">
        <Icon name="place" size={28} />
      </span>
      <span className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-pill bg-surface px-3 py-1 text-aux text-fg-mute shadow-card max-lg:hidden">{label}</span>
    </div>
  );
}
