"use client";

import { useCallback, useId, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { cx, type DataAttrs } from "./cx";
import { useKeydown, useMediaQuery } from "./hooks";
import { Icon } from "./icons";
import { BottomTabs, panelId, tabId } from "./tabs";

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
  const prefix = useId();
  // One set of ids for both widths: the bottom tabs (< 1024px) control these panels, and so do the edge toggles (>= 1024px).
  const leftId = panelId(prefix, "input");
  const rightId = panelId(prefix, "result");
  const dragY = useRef<number | null>(null);

  const showLeft = leftOpen && !maximized;
  const showRight = rightOpen && !maximized;

  // While the map is maximized both panes are hidden, so a toggle (edge button or "[" / "]") that only flipped its own
  // flag would look pressed and do nothing. Instead it leaves the maximized state and opens the requested pane.
  const togglePane = useCallback(
    (side: "left" | "right") => {
      const set = side === "left" ? setLeftOpen : setRightOpen;
      if (maximized) {
        set(true);
        setMaximized(false);
      } else set((v) => !v);
    },
    [maximized],
  );

  const keys = useCallback(
    (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "[") togglePane("left");
      else if (e.key === "]") togglePane("right");
    },
    [togglePane],
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
      className="relative isolate overflow-hidden rounded-sheet bg-sunken shadow-lift lg:grid lg:transition-[grid-template-columns] lg:duration-[var(--dur-sheet)] lg:ease-[var(--ease)] lg:[grid-template-columns:var(--ws-cols)]"
    >
      {/* map layer */}
      <div className="absolute inset-0 min-w-0 lg:relative lg:inset-auto lg:col-start-2 lg:row-start-1" data-testid="workspace-map" id={panelId(prefix, "map")} inert={!desktop && tab !== "map"} aria-hidden={!desktop && tab !== "map" ? true : undefined} {...(desktop ? { role: "region", "aria-label": "地図" } : { role: "tabpanel", "aria-labelledby": tabId(prefix, "map") })}>
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
        <EdgeToggle side="left" open={showLeft} onClick={() => togglePane("left")} controls={leftId} label={inputTitle} />
        <EdgeToggle side="right" open={showRight} onClick={() => togglePane("right")} controls={rightId} label={resultTitle} />
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
            {...(desktop ? { "aria-label": inputTitle } : { role: "tabpanel", "aria-labelledby": tabId(prefix, "input") })}
            data-testid="workspace-input"
            inert={desktop && !showLeft}
            aria-hidden={desktop && !showLeft ? true : undefined}
            className={cx(
              "min-h-0 flex-1 overflow-y-auto px-4 pb-4 lg:col-start-1 lg:row-start-1 lg:flex-none lg:overflow-x-hidden lg:overflow-y-auto lg:border-r lg:border-line lg:bg-surface lg:p-0",
              tab !== "input" && "max-lg:hidden",
            )}
          >
            <div className="lg:w-[22.5rem] lg:p-4">{input}</div>
          </aside>
          <aside
            id={rightId}
            {...(desktop ? { "aria-label": resultTitle } : { role: "tabpanel", "aria-labelledby": tabId(prefix, "result") })}
            data-testid="workspace-result"
            inert={desktop && !showRight}
            aria-hidden={desktop && !showRight ? true : undefined}
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

/**
 * A stand-in for the map (stage 4 puts the real map here). Drawn with tokens only; no data: contour lines, a river, a
 * park, a few blocks and two roads, in quiet tones so a floating panel or a pane reads clearly on top of it.
 */
export function MapPlaceholder({ label = "地図の場所（見本）" }: { readonly label?: string }) {
  return (
    <div className="relative h-full w-full overflow-hidden bg-sunken" role="img" aria-label={label}>
      <svg viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full" fill="none" aria-hidden="true">
        {/* park */}
        <path d="M262 196c14-18 46-22 62-8s14 40-6 52-50 8-58-8 -6-26 2-36z" fill="var(--ok-line)" opacity=".1" />
        {/* contour lines around two rises */}
        <g stroke="var(--line-strong)" strokeWidth="0.8" opacity=".3" strokeLinejoin="round">
          <path d="M296 30c26-6 54 6 62 30s-12 50-42 56-62-6-66-32 20-48 46-54z" />
          <path d="M300 44c20-4 40 5 46 22s-9 36-31 40-45-5-48-24 14-34 33-38z" />
          <path d="M304 58c14-2 27 4 30 15s-7 24-22 26-31-3-32-16 10-23 24-25z" />
          <path d="M-10 214c30-26 82-30 110-8s26 66-6 84-86 12-104-18z" />
          <path d="M6 222c24-18 62-20 82-4s18 48-6 62-64 8-76-14z" />
          <path d="M26 234c16-10 40-10 52 0s10 30-6 38-40 4-46-10z" />
        </g>
        {/* river */}
        <path d="M-10 70C40 64 74 96 120 98S190 64 236 80s54 52 100 52 60-26 84-40" stroke="var(--info-line)" strokeWidth="14" opacity=".13" strokeLinecap="round" />
        <path d="M-10 70C40 64 74 96 120 98S190 64 236 80s54 52 100 52 60-26 84-40" stroke="var(--info-line)" strokeWidth="1" opacity=".3" strokeLinecap="round" />
        {/* city blocks */}
        <g fill="var(--line)" opacity=".5">
          <rect x="132" y="108" width="26" height="18" rx="3" />
          <rect x="164" y="112" width="18" height="26" rx="3" />
          <rect x="128" y="188" width="30" height="20" rx="3" />
          <rect x="166" y="196" width="20" height="30" rx="3" />
          <rect x="236" y="104" width="22" height="22" rx="3" />
          <rect x="266" y="112" width="30" height="16" rx="3" />
          <rect x="226" y="168" width="22" height="18" rx="3" />
          <rect x="70" y="120" width="28" height="22" rx="3" />
          <rect x="60" y="168" width="22" height="26" rx="3" />
        </g>
        {/* roads: an edge line first, then the lighter surface line on top */}
        <g strokeLinecap="round" fill="none">
          <path d="M-10 168C60 150 112 176 200 156S330 112 410 134" stroke="var(--line-strong)" strokeWidth="13" opacity=".3" />
          <path d="M60 -10C74 54 112 84 128 140S172 238 204 310" stroke="var(--line-strong)" strokeWidth="10" opacity=".3" />
          <path d="M250 -10C256 36 292 62 304 112S292 214 324 310" stroke="var(--line-strong)" strokeWidth="8" opacity=".26" />
          <path d="M-10 168C60 150 112 176 200 156S330 112 410 134" stroke="var(--bg-surface)" strokeWidth="11" opacity=".95" />
          <path d="M60 -10C74 54 112 84 128 140S172 238 204 310" stroke="var(--bg-surface)" strokeWidth="8" opacity=".95" />
          <path d="M250 -10C256 36 292 62 304 112S292 214 324 310" stroke="var(--bg-surface)" strokeWidth="6" opacity=".95" />
          <path d="M-10 258C70 244 150 270 230 250S370 232 410 244" stroke="var(--bg-surface)" strokeWidth="4" opacity=".8" />
        </g>
        {/* the sample site: a flight area with a pulse and a pin */}
        <circle cx="205" cy="150" r="52" fill="var(--accent)" opacity=".1" />
        <circle cx="205" cy="150" r="52" stroke="var(--accent)" strokeWidth="1.5" strokeDasharray="5 5" opacity=".8" />
        <circle cx="205" cy="150" r="14" fill="var(--accent)" className="ds-ping" />
        <circle cx="205" cy="150" r="7" fill="var(--accent)" stroke="var(--bg-surface)" strokeWidth="3" />
      </svg>
      <span className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-pill bg-glass px-3 py-1 text-aux text-fg-mute shadow-card [backdrop-filter:var(--glass-filter)] max-lg:hidden">{label}</span>
    </div>
  );
}
