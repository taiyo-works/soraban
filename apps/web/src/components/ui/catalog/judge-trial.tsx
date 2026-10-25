"use client";

import { useCallback, useEffect, useId, useReducer, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { cx } from "../cx";
import { Checkbox, TextInput } from "../forms";
import { useMediaQuery } from "../hooks";
import { Icon } from "../icons";
import { Button, NoticeBar, StatusPill, type Meaning } from "../primitives";
import { Segmented } from "../tabs";
import { VerdictStamp } from "../verdict-stamp";
import { MapPlaceholder } from "../workspace";
import {
  ADDRESS_POINT,
  DEFAULT_POINT,
  DISCLAIMER,
  GEO_POINT,
  JUDGE_LAYERS,
  JUDGE_SP,
  LAYER_GROUPS,
  OTHER_GROUP_NOTE,
  PLACE_LABEL,
  judgeAt,
  type JudgeLayerId,
  type JudgeOutcome,
  type JudgeRow,
  type JudgeSp,
  type Point,
  type PointSource,
} from "./judge-trial-data";

// The judgement screen trial (UX stage 3). Three phone arrangements (sp = sheet | tabs | fold) and one PC arrangement
// (three panes). All of it is a static sample: the map is a drawing, the results are made-up data, nothing is sent.
// The point of the trial is how few taps and how little scrolling it takes to reach the answer, so every part that a
// script presses carries a data-testid with the device prefix ("sp-" / "pc-").

type Geo = "idle" | "loading" | "confirm";
type State = {
  readonly point: Point;
  readonly source: PointSource;
  readonly geo: Geo;
  readonly pending: Point | null;
  readonly off: readonly JudgeLayerId[];
  readonly query: string;
  /** How many times the answer was produced (the live region announces each one). */
  readonly judged: number;
};
type Action =
  | { readonly type: "pick"; readonly point: Point; readonly source: PointSource }
  | { readonly type: "geo-start" }
  | { readonly type: "geo-done"; readonly accuracy: number }
  | { readonly type: "geo-cancel" }
  | { readonly type: "layer"; readonly id: JudgeLayerId }
  | { readonly type: "query"; readonly value: string };

const INITIAL: State = { point: DEFAULT_POINT, source: "default", geo: "idle", pending: null, off: [], query: "", judged: 0 };

function reduce(s: State, a: Action): State {
  switch (a.type) {
    case "pick":
      return { ...s, point: a.point, source: a.source, geo: "idle", pending: null, judged: s.judged + 1 };
    case "geo-start":
      return { ...s, geo: "loading" };
    case "geo-done":
      // A position that is not precise (over 100 m) waits for one confirmation; a precise one is judged at once.
      return a.accuracy > 100 ? { ...s, geo: "confirm", pending: GEO_POINT } : { ...s, point: GEO_POINT, source: "geo", geo: "idle", pending: null, judged: s.judged + 1 };
    case "geo-cancel":
      return { ...s, geo: "idle", pending: null };
    case "layer":
      return { ...s, off: s.off.includes(a.id) ? s.off.filter((x) => x !== a.id) : [...s.off, a.id] };
    case "query":
      return { ...s, query: a.value };
  }
}

type Judge = {
  readonly s: State;
  readonly outcome: JudgeOutcome;
  readonly place: string;
  readonly accuracy: number;
  readonly pick: (p: Point, source: PointSource) => void;
  readonly search: () => void;
  readonly geo: () => void;
  readonly confirmGeo: () => void;
  readonly cancelGeo: () => void;
  readonly toggle: (id: JudgeLayerId) => void;
  readonly setQuery: (v: string) => void;
};

function useJudge(accuracy: number): Judge {
  const [s, dispatch] = useReducer(reduce, INITIAL);
  // The position check takes a moment on a real phone; the sample waits a little too.
  useEffect(() => {
    if (s.geo !== "loading") return;
    const t = window.setTimeout(() => dispatch({ type: "geo-done", accuracy }), 500);
    return () => window.clearTimeout(t);
  }, [s.geo, accuracy]);
  const place = s.source === "geo" ? `現在地（精度 約 ${accuracy} m）` : PLACE_LABEL[s.source];
  return {
    s,
    outcome: judgeAt(s.point),
    place,
    accuracy,
    pick: (point, source) => dispatch({ type: "pick", point, source }),
    search: () => dispatch({ type: "pick", point: ADDRESS_POINT, source: "address" }),
    geo: () => dispatch({ type: "geo-start" }),
    confirmGeo: () => dispatch({ type: "pick", point: GEO_POINT, source: "geo" }),
    cancelGeo: () => dispatch({ type: "geo-cancel" }),
    toggle: (id) => dispatch({ type: "layer", id }),
    setQuery: (value) => dispatch({ type: "query", value }),
  };
}

// ── the sample map ───────────────────────────────────────────────────────────

function LayerArt({ id, uid }: { readonly id: JudgeLayerId; readonly uid: string }) {
  switch (id) {
    case "airport":
      return (
        <>
          <ellipse cx="64" cy="44" rx="62" ry="34" stroke="var(--info-line)" strokeWidth="1.8" />
          <ellipse cx="64" cy="44" rx="40" ry="20" stroke="var(--info-line)" strokeWidth="1.2" strokeDasharray="4 4" />
        </>
      );
    case "did":
      return <polygon points="104,92 204,90 206,150 196,244 122,246 100,170" fill={`url(#${uid}-did)`} stroke="var(--warn-line)" strokeWidth="1.4" />;
    case "industrial":
      return <rect x="250" y="216" width="130" height="68" fill={`url(#${uid}-industrial)`} stroke="var(--neutral-line)" strokeWidth="1.4" />;
    case "drone-law":
      return <circle cx="300" cy="62" r="48" stroke="var(--danger-line)" strokeWidth="2.4" strokeDasharray="7 5" fill={`url(#${uid}-drone-law)`} />;
    case "park":
      return <path d="M258 196c16-20 50-24 68-8s14 42-6 54-52 8-62-8-8-28 0-38z" fill={`url(#${uid}-park)`} stroke="var(--ok-line)" strokeWidth="1.2" />;
    case "heritage":
      return <polygon points="330,124 360,150 330,176 300,150" fill={`url(#${uid}-heritage)`} stroke="var(--accent)" strokeWidth="1.4" />;
    case "crowd":
      return (
        <>
          <circle cx="160" cy="268" r="16" stroke="var(--warn-line)" strokeWidth="1.6" strokeDasharray="3 3" />
          <circle cx="226" cy="40" r="14" stroke="var(--warn-line)" strokeWidth="1.6" strokeDasharray="3 3" />
        </>
      );
  }
}

function LayerDefs({ uid }: { readonly uid: string }) {
  return (
    <defs>
      <pattern id={`${uid}-did`} width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <line x1="0" y1="0" x2="0" y2="8" stroke="var(--warn-line)" strokeWidth="1.6" />
      </pattern>
      <pattern id={`${uid}-industrial`} width="9" height="9" patternUnits="userSpaceOnUse">
        <path d="M0 0H9M0 0V9" stroke="var(--neutral-line)" strokeWidth="1" />
      </pattern>
      <pattern id={`${uid}-drone-law`} width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
        <line x1="0" y1="0" x2="0" y2="10" stroke="var(--danger-line)" strokeWidth="0.9" />
      </pattern>
      <pattern id={`${uid}-park`} width="8" height="8" patternUnits="userSpaceOnUse">
        <circle cx="4" cy="4" r="1.3" fill="var(--ok-line)" />
      </pattern>
      <pattern id={`${uid}-heritage`} width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(20)">
        <line x1="0" y1="0" x2="7" y2="0" stroke="var(--accent)" strokeWidth="1" />
      </pattern>
    </defs>
  );
}

/** The small picture in front of a layer name: the same pattern as on the map. */
function Swatch({ id }: { readonly id: JudgeLayerId }) {
  const uid = useId().replace(/:/g, "");
  const box = { x: 1, y: 1, width: 26, height: 16 };
  return (
    <svg viewBox="0 0 28 18" width="28" height="18" fill="none" aria-hidden="true" focusable="false" className="shrink-0">
      <LayerDefs uid={uid} />
      {id === "airport" ? <ellipse cx="14" cy="9" rx="12.5" ry="7.5" stroke="var(--info-line)" strokeWidth="1.5" /> : null}
      {id === "did" ? <rect {...box} fill={`url(#${uid}-did)`} stroke="var(--warn-line)" strokeWidth="1.2" /> : null}
      {id === "industrial" ? <rect {...box} fill={`url(#${uid}-industrial)`} stroke="var(--neutral-line)" strokeWidth="1.2" /> : null}
      {id === "drone-law" ? <rect {...box} fill={`url(#${uid}-drone-law)`} stroke="var(--danger-line)" strokeWidth="2" strokeDasharray="5 3" /> : null}
      {id === "park" ? <rect {...box} fill={`url(#${uid}-park)`} stroke="var(--ok-line)" strokeWidth="1.2" /> : null}
      {id === "heritage" ? <polygon points="14,1 27,9 14,17 1,9" fill={`url(#${uid}-heritage)`} stroke="var(--accent)" strokeWidth="1.2" /> : null}
      {id === "crowd" ? <circle cx="14" cy="9" r="7" stroke="var(--warn-line)" strokeWidth="1.6" strokeDasharray="3 2" /> : null}
    </svg>
  );
}

function SampleMap({ j, t, className }: { readonly j: Judge; readonly t: string; readonly className?: string }) {
  const uid = useId().replace(/:/g, "");
  return (
    <div className={cx("relative overflow-hidden bg-sunken", className)} data-testid={`${t}-map`} data-point={`${Math.round(j.s.point.x)},${Math.round(j.s.point.y)}`} data-hidden-layers={j.s.off.join(",")}>
      <MapPlaceholder site={false} label="地図の見本" />
      <svg viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice" className="pointer-events-none absolute inset-0 h-full w-full" fill="none" aria-hidden="true">
        <LayerDefs uid={uid} />
        {JUDGE_LAYERS.filter((l) => !j.s.off.includes(l.id)).map((l) => (
          <g key={l.id} data-layer={l.id}>
            <LayerArt id={l.id} uid={uid} />
          </g>
        ))}
      </svg>
      <button
        type="button"
        aria-label="地図で地点を指定（見本）"
        data-testid={`${t}-map-pick`}
        className="absolute inset-0 cursor-crosshair"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          // A key press has no position: use the middle.
          const x = e.detail === 0 ? 50 : ((e.clientX - r.left) / r.width) * 100;
          const y = e.detail === 0 ? 50 : ((e.clientY - r.top) / r.height) * 100;
          j.pick({ x, y }, "map");
        }}
      />
      <span className="pointer-events-none absolute z-[1] text-accent" style={{ left: `${j.s.point.x}%`, top: `${j.s.point.y}%`, transform: "translate(-50%, -100%)" }} data-testid={`${t}-pin`}>
        <Icon name="place" size={32} />
      </span>
    </div>
  );
}

// ── parts shared by the arrangements ─────────────────────────────────────────

const MEANING: Readonly<Record<string, Meaning>> = { no_procedure: "ok", needs_procedure: "warn", no_fly: "danger", unknown: "neutral", procedure_done: "info" };

/** The one-line answer: the stamp, the reason, and where the point is. The disclaimer is always named here ("参考情報"). */
function SummaryLine({ j, t, className }: { readonly j: Judge; readonly t: string; readonly className?: string }) {
  return (
    <span className={cx("flex min-w-0 flex-1 items-center gap-3 text-left", className)} data-testid={`${t}-summary`} data-level={j.outcome.level}>
      <VerdictStamp level={j.outcome.level} size="sm" className="shrink-0" />
      <span className="flex min-w-0 flex-col">
        <span className="text-table font-medium text-fg [text-wrap:balance] [word-break:auto-phrase]">{j.outcome.line}</span>
        <span className="text-aux text-fg-mute [word-break:auto-phrase]">
          {j.place} ・ 参考情報
        </span>
      </span>
    </span>
  );
}

function Live({ j }: { readonly j: Judge }) {
  return (
    <p role="status" aria-live="polite" className="sr-only" data-testid="judge-live">
      {j.s.judged > 0 ? `${j.place}の判定：${j.outcome.line}` : ""}
    </p>
  );
}

function GeoNotice({ j, t }: { readonly j: Judge; readonly t: string }) {
  if (j.s.geo === "loading")
    return (
      <p role="status" className="flex min-h-11 items-center gap-2 rounded-ctl border border-line-strong bg-surface px-3 text-table text-fg-soft" data-testid={`${t}-geo-loading`}>
        <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-line-strong border-t-accent motion-reduce:animate-none" aria-hidden="true" />
        現在地を確かめています…
      </p>
    );
  if (j.s.geo === "confirm")
    return (
      <div className="flex flex-col gap-2 rounded-ctl border border-warn-line bg-surface p-3" data-testid={`${t}-geo-confirm`}>
        <p className="text-table text-fg">現在地の精度は約 {j.accuracy} m です。この地点で判定しますか。</p>
        <div className="flex gap-2">
          <Button variant="primary" size="sm" onClick={j.confirmGeo} data-testid={`${t}-geo-confirm-yes`}>
            この地点で判定
          </Button>
          <Button size="sm" onClick={j.cancelGeo} data-testid={`${t}-geo-confirm-no`}>
            取消
          </Button>
        </div>
      </div>
    );
  return null;
}

/** Address / coordinates field with its own search button; Enter also searches. */
function AddressField({ j, t, id, className }: { readonly j: Judge; readonly t: string; readonly id: string; readonly className?: string }) {
  return (
    <form
      className={cx("flex min-w-0 gap-2", className)}
      onSubmit={(e) => {
        e.preventDefault();
        j.search();
      }}
    >
      <label htmlFor={id} className="sr-only">
        住所または座標
      </label>
      <TextInput id={id} value={j.s.query} onChange={(e) => j.setQuery(e.target.value)} placeholder="住所・座標" autoComplete="off" data-testid={`${t}-address`} className="min-w-0 flex-1" />
      <Button type="submit" variant="secondary" size="icon" aria-label="住所で位置決定" data-testid={`${t}-search`}>
        <Icon name="search" size={18} />
      </Button>
    </form>
  );
}

function GeoButton({ j, t, className, testId }: { readonly j: Judge; readonly t: string; readonly className?: string; readonly testId?: string }) {
  return (
    <Button variant="primary" icon="place" onClick={j.geo} loading={j.s.geo === "loading"} data-testid={testId ?? `${t}-geo`} className={className}>
      現在地で判定
    </Button>
  );
}

function LayerRow({ j, t, id }: { readonly j: Judge; readonly t: string; readonly id: JudgeLayerId }) {
  const l = JUDGE_LAYERS.find((x) => x.id === id)!;
  return (
    <Checkbox
      checked={!j.s.off.includes(id)}
      onChange={() => j.toggle(id)}
      data-testid={`${t}-layer-${id}`}
      label={
        <span className="inline-flex items-center gap-2">
          <Swatch id={id} />
          {l.label}
        </span>
      }
    />
  );
}

/** The layer list in DIPS's order, with the group names. */
function LayerList({ j, t }: { readonly j: Judge; readonly t: string }) {
  return (
    <div className="flex flex-col gap-3" data-testid={`${t}-layer-list`}>
      {LAYER_GROUPS.map((g) => (
        <fieldset key={g.id} className="flex min-w-0 flex-col" data-group={g.id}>
          <legend className="mb-0.5 text-aux font-semibold text-fg-soft">{g.label}</legend>
          {JUDGE_LAYERS.filter((l) => l.group === g.id).map((l) => (
            <LayerRow key={l.id} j={j} t={t} id={l.id} />
          ))}
          {g.id === "other" ? <p className="text-aux text-fg-mute">{OTHER_GROUP_NOTE}</p> : null}
        </fieldset>
      ))}
    </div>
  );
}

/** The layers as toggle chips, one row per group (the strip under the map on PC). */
function LayerChips({ j, t }: { readonly j: Judge; readonly t: string }) {
  return (
    <div role="group" aria-label="地図に重ねる層" className="flex flex-col" data-testid={`${t}-layer-list`}>
      {LAYER_GROUPS.map((g) => (
        <div key={g.id} className="grid min-h-9 grid-cols-[8.5rem_minmax(0,1fr)] items-center gap-2" data-group={g.id}>
          <span className="text-aux font-semibold text-fg-soft">{g.label}</span>
          <div className="flex flex-wrap gap-1.5 py-0.5">
            {JUDGE_LAYERS.filter((l) => l.group === g.id).map((l) => {
              const on = !j.s.off.includes(l.id);
              return (
                <button
                  key={l.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => j.toggle(l.id)}
                  data-testid={`${t}-layer-${l.id}`}
                  className={cx(
                    "inline-flex min-h-11 items-center gap-1.5 rounded-ctl border bg-surface px-2 text-table transition-colors duration-[var(--dur)] motion-reduce:transition-none field:min-h-14",
                    on ? "border-accent font-medium text-fg" : "border-line-strong text-fg-mute",
                  )}
                >
                  <Swatch id={l.id} />
                  {l.short}
                  {on ? <Icon name="check" size={14} className="text-accent" /> : <span className="text-aux">非表示</span>}
                </button>
              );
            })}
            {g.id === "other" ? <span className="py-2 text-aux text-fg-mute">{OTHER_GROUP_NOTE}</span> : null}
          </div>
        </div>
      ))}
    </div>
  );
}

function RowDisclosure({ r, t }: { readonly r: JudgeRow; readonly t: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <li className="border-b border-line last:border-b-0" data-testid={`${t}-row-${r.id}`}>
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)} className="flex min-h-11 w-full items-center gap-3 py-1 text-left text-table field:min-h-14" data-testid={`${t}-row-${r.id}-toggle`}>
        <span className="min-w-0 flex-1 text-fg">{r.label}</span>
        <StatusPill meaning={MEANING[r.level] ?? "neutral"}>{r.state}</StatusPill>
        <Icon name="chevron-down" size={16} className={cx("shrink-0 text-fg-mute transition-transform duration-[var(--dur)] motion-reduce:transition-none", open && "rotate-180")} />
      </button>
      <p id={id} hidden={!open} className="pb-3 text-aux leading-relaxed text-fg-soft" data-testid={`${t}-row-${r.id}-basis`}>
        {r.basis}
      </p>
    </li>
  );
}

/** The whole result: conclusion, procedures, the items by group, the disclaimer. */
function ResultBody({ j, t, hideConclusion }: { readonly j: Judge; readonly t: string; readonly hideConclusion?: boolean }) {
  const o = j.outcome;
  return (
    <div className="flex flex-col gap-4" data-testid={`${t}-result`}>
      {hideConclusion ? null : (
        <div className="flex flex-col gap-2" data-testid={`${t}-conclusion`} data-level={o.level}>
          <VerdictStamp level={o.level} className="self-start" />
          <p className="text-body font-medium text-fg [text-wrap:balance] [word-break:auto-phrase]">{o.line}</p>
          <p className="text-aux text-fg-mute">{j.place}</p>
        </div>
      )}
      <section aria-label="必要な手続き" className="flex flex-col gap-1">
        <h4 className="text-table font-semibold text-fg">必要な手続き</h4>
        {o.procedures.length === 0 ? (
          <p className="text-table text-fg-soft">この地点で、地点に由来する手続きはありません。</p>
        ) : (
          <ol className="flex flex-col divide-y divide-line border-y border-line">
            {o.procedures.map((p) => (
              <li key={p.label} className="flex min-h-11 items-baseline justify-between gap-3 py-2 text-table">
                <span className="text-fg">{p.label}</span>
                <span className="shrink-0 text-aux text-fg-mute">{p.due}</span>
              </li>
            ))}
          </ol>
        )}
      </section>
      <section aria-label="規制ごとの判定" className="flex flex-col gap-1">
        <h4 className="text-table font-semibold text-fg">規制ごとの判定</h4>
        {LAYER_GROUPS.filter((g) => o.rows.some((r) => r.group === g.id)).map((g) => (
          <div key={g.id} className="flex flex-col">
            <p className="mt-1 text-aux text-fg-mute">{g.label}</p>
            <ul className="flex flex-col border-t border-line">
              {o.rows
                .filter((r) => r.group === g.id)
                .map((r) => (
                  <RowDisclosure key={r.id} r={r} t={t} />
                ))}
            </ul>
          </div>
        ))}
      </section>
      <NoticeBar meaning="neutral" data-testid={`${t}-disclaimer`}>
        {DISCLAIMER}
      </NoticeBar>
    </div>
  );
}

function ConditionsFold({ t }: { readonly t: string }) {
  return (
    <details className="group rounded-ctl border border-line" data-testid={`${t}-conditions`}>
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 text-table text-fg-soft field:min-h-14 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 flex-1">機体・飛行方法（既定のまま判定できます）</span>
        <Icon name="chevron-down" size={16} className="text-fg-mute transition-transform duration-[var(--dur)] group-open:rotate-180 motion-reduce:transition-none" />
      </summary>
      <div className="flex flex-col gap-1 px-3 pb-3">
        <Checkbox defaultChecked disabled label="DID 上空（自動で判定）" />
        <Checkbox label="夜間飛行" />
        <Checkbox label="目視外飛行" />
        <p className="text-aux text-fg-mute">機体の重量などの入力は、実画面の項目と同じです（見本では省略）。</p>
      </div>
    </details>
  );
}

function LayerToggleButton({ j, t, open, onClick }: { readonly j: Judge; readonly t: string; readonly open: boolean; readonly onClick: () => void }) {
  return (
    <Button size="sm" icon="filter" aria-expanded={open} onClick={onClick} data-testid={`${t}-layers-open`}>
      層 {JUDGE_LAYERS.length - j.s.off.length}/{JUDGE_LAYERS.length}
    </Button>
  );
}

function LayerPopover({ j, t, onClose, className }: { readonly j: Judge; readonly t: string; readonly onClose: () => void; readonly className?: string }) {
  return (
    <div role="group" aria-label="地図に重ねる層" data-testid={`${t}-layer-panel`} className={cx("flex max-h-[60%] flex-col gap-2 overflow-y-auto rounded-ctl border border-line-strong bg-surface p-3", className)}>
      <div className="flex items-center justify-between">
        <h4 className="text-table font-semibold text-fg">地図の層</h4>
        <Button variant="quiet" size="sm" onClick={onClose} data-testid={`${t}-layers-close`}>
          閉じる
        </Button>
      </div>
      <LayerList j={j} t={t} />
    </div>
  );
}

// ── phone A: the map is the page, the answer is a slip that is pulled up ────

type Stage = "peek" | "half" | "full";
const STAGES: readonly Stage[] = ["peek", "half", "full"];
const STAGE_LABEL: Readonly<Record<Stage, string>> = { peek: "1 行", half: "半分", full: "全体" };
const SHEET_H: Readonly<Record<Stage, string>> = { peek: "var(--peek-h)", half: "55%", full: "calc(100% - 3.5rem)" };

function SheetVariant({ j, height }: { readonly j: Judge; readonly height: string }) {
  const t = "sp";
  const [stage, setStage] = useState<Stage>("peek");
  const [layers, setLayers] = useState(false);
  const drag = useRef<number | null>(null);
  const step = (dir: 1 | -1): void => setStage((s) => STAGES[Math.min(2, Math.max(0, STAGES.indexOf(s) + dir))]!);
  const cycle = (): void => setStage((s) => (s === "full" ? "peek" : s === "peek" ? "half" : "full"));
  const aid = useId();

  // Judging again puts the slip down to one line, so the pin is in view (adjusted while rendering, not in an effect).
  const [seen, setSeen] = useState(j.s.judged);
  if (seen !== j.s.judged) {
    setSeen(j.s.judged);
    setStage("peek");
  }

  const onDown = (e: ReactPointerEvent<HTMLButtonElement>): void => {
    drag.current = e.clientY;
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onUp = (e: ReactPointerEvent<HTMLButtonElement>): void => {
    if (drag.current === null) return;
    const dy = e.clientY - drag.current;
    drag.current = null;
    if (Math.abs(dy) < 8) cycle();
    else step(dy < 0 ? 1 : -1);
  };

  return (
    <div
      className="relative isolate overflow-hidden bg-sunken"
      style={{ height }}
      data-testid="sp-frame"
      data-variant="sheet"
      data-stage={stage}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          if (layers) setLayers(false);
          else setStage("peek");
        }
      }}
    >
      <div className={cx("absolute inset-x-0 top-0 h-[120%] transition-transform duration-[var(--dur-sheet)] ease-[var(--ease)] motion-reduce:transition-none", stage === "half" && "-translate-y-[16.7%]")}>
        <SampleMap j={j} t={t} className="h-full w-full" />
      </div>

      <div className="absolute inset-x-0 top-0 z-20 flex flex-col gap-2 border-b border-line-strong bg-surface p-2">
        <div className="flex gap-2">
          <AddressField j={j} t={t} id={`${aid}-addr`} className="flex-1" />
          <GeoButton j={j} t={t} className="shrink-0 px-3" />
        </div>
        {j.s.geo !== "idle" ? <GeoNotice j={j} t={t} /> : null}
      </div>
      <div className="absolute right-2 top-[4.25rem] z-10">
        <LayerToggleButton j={j} t={t} open={layers} onClick={() => setLayers((v) => !v)} />
      </div>
      {layers ? <LayerPopover j={j} t={t} onClose={() => setLayers(false)} className="absolute inset-x-2 top-[7.5rem] z-20" /> : null}

      <section
        aria-label="判定票"
        data-testid="sp-sheet"
        style={{ height: SHEET_H[stage] }}
        className="absolute inset-x-0 bottom-0 z-30 flex flex-col [--peek-h:5rem] field:[--peek-h:8rem] rounded-t-ctl border-t border-line-strong bg-surface transition-[height] duration-[var(--dur-sheet)] ease-[var(--ease)] motion-reduce:transition-none"
      >
        <button
          type="button"
          aria-expanded={stage !== "peek"}
          aria-controls={`${aid}-body`}
          aria-label={`判定票の高さを変える（いま：${STAGE_LABEL[stage]}。上下の矢印キーでも動きます）`}
          data-testid="sp-handle"
          onPointerDown={onDown}
          onPointerUp={onUp}
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
          className="flex min-h-[var(--peek-h)] w-full shrink-0 touch-none cursor-grab flex-col items-center justify-start gap-1 px-3 pt-1.5"
        >
          <span className="h-1 w-9 rounded-ctl bg-line-strong" aria-hidden="true" />
          <span className="flex w-full items-center gap-2">
            <SummaryLine j={j} t={t} />
            <Icon name={stage === "full" ? "chevron-down" : "chevron-up"} size={20} className="shrink-0 text-fg-mute" />
          </span>
        </button>
        <div id={`${aid}-body`} inert={stage === "peek"} aria-hidden={stage === "peek" || undefined} data-testid="sp-sheet-body" className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
          <ResultBody j={j} t={t} hideConclusion />
        </div>
      </section>
      <Live j={j} />
    </div>
  );
}

// ── phone B: three leaves (input / map / result) with an always-visible band ─

type Leaf = "input" | "map" | "result";
const LEAVES: readonly { readonly id: Leaf; readonly label: string }[] = [
  { id: "input", label: "入力" },
  { id: "map", label: "地図" },
  { id: "result", label: "結果" },
];

function TabsVariant({ j, height }: { readonly j: Judge; readonly height: string }) {
  const t = "sp";
  const [leaf, setLeaf] = useState<Leaf>("map");
  const [layers, setLayers] = useState(false);
  const aid = useId();

  // A judgement made from the input leaf shows the map with the new pin; the band carries the answer.
  const [seen, setSeen] = useState(j.s.judged);
  if (seen !== j.s.judged) {
    setSeen(j.s.judged);
    if (leaf === "input") setLeaf("map");
  }

  const tabKeys = (e: React.KeyboardEvent): void => {
    const i = LEAVES.findIndex((x) => x.id === leaf);
    if (e.key === "ArrowRight") setLeaf(LEAVES[(i + 1) % 3]!.id);
    else if (e.key === "ArrowLeft") setLeaf(LEAVES[(i + 2) % 3]!.id);
  };

  return (
    <div className="relative isolate flex flex-col overflow-hidden bg-surface" style={{ height }} data-testid="sp-frame" data-variant="tabs" data-leaf={leaf}>
      <div role="tablist" aria-label="入力・地図・結果" onKeyDown={tabKeys} className="grid shrink-0 grid-cols-3 border-b border-line-strong">
        {LEAVES.map((x) => (
          <button
            key={x.id}
            type="button"
            role="tab"
            id={`${aid}-tab-${x.id}`}
            aria-selected={leaf === x.id}
            aria-controls={`${aid}-leaf-${x.id}`}
            tabIndex={leaf === x.id ? 0 : -1}
            onClick={() => setLeaf(x.id)}
            data-testid={`sp-tab-${x.id}`}
            className={cx("min-h-11 border-b-2 text-table touch-manipulation field:min-h-14", leaf === x.id ? "border-accent font-semibold text-fg" : "border-transparent text-fg-soft")}
          >
            {x.label}
          </button>
        ))}
      </div>
      <button type="button" onClick={() => setLeaf("result")} aria-label="結果の画面を開く" data-testid="sp-band" className="flex min-h-14 shrink-0 items-center gap-2 border-b border-line-strong bg-sunken px-3 text-left">
        <SummaryLine j={j} t={t} />
        <Icon name="chevron-right" size={18} className="shrink-0 text-fg-mute" />
      </button>

      <div className="relative min-h-0 flex-1">
        <div role="tabpanel" id={`${aid}-leaf-map`} aria-labelledby={`${aid}-tab-map`} hidden={leaf !== "map"} className="absolute inset-0">
          <SampleMap j={j} t={t} className="h-full w-full" />
          <div className="absolute right-2 top-2 z-10">
            <LayerToggleButton j={j} t={t} open={layers} onClick={() => setLayers((v) => !v)} />
          </div>
          {layers ? <LayerPopover j={j} t={t} onClose={() => setLayers(false)} className="absolute inset-x-2 top-14 z-20" /> : null}
          <div className="absolute inset-x-2 bottom-2 z-10 flex flex-col gap-2">
            {leaf === "map" ? <GeoNotice j={j} t={t} /> : null}
            <GeoButton j={j} t={t} className="self-start" />
          </div>
        </div>
        <div role="tabpanel" id={`${aid}-leaf-input`} aria-labelledby={`${aid}-tab-input`} hidden={leaf !== "input"} className="absolute inset-0 flex flex-col gap-3 overflow-y-auto p-4">
          <AddressField j={j} t={t} id={`${aid}-addr`} />
          <GeoButton j={j} t={t} className="w-full" testId="sp-geo-input" />
          {leaf === "input" ? <GeoNotice j={j} t={t} /> : null}
          <ConditionsFold t={t} />
        </div>
        <div role="tabpanel" id={`${aid}-leaf-result`} aria-labelledby={`${aid}-tab-result`} hidden={leaf !== "result"} className="absolute inset-0 overflow-y-auto p-4">
          <ResultBody j={j} t={t} />
        </div>
      </div>
      <Live j={j} />
    </div>
  );
}

// ── phone C: the page keeps its order, the answer is pinned, details fold ───

function FoldVariant({ j, height }: { readonly j: Judge; readonly height: string }) {
  const t = "sp";
  const [layers, setLayers] = useState(false);
  const aid = useId();
  const o = j.outcome;
  return (
    <div className="flex flex-col bg-surface" style={{ minHeight: height }} data-testid="sp-frame" data-variant="fold">
      <div className="sticky top-0 z-30 flex min-h-14 items-center gap-2 border-b border-line-strong bg-sunken px-3 py-1.5" data-testid="sp-band">
        <SummaryLine j={j} t={t} />
      </div>

      <section aria-label="地点" className="flex flex-col gap-2 border-b border-line p-3">
        <div className="flex gap-2">
          <AddressField j={j} t={t} id={`${aid}-addr`} className="flex-1" />
          <GeoButton j={j} t={t} className="shrink-0 px-3" />
        </div>
        <GeoNotice j={j} t={t} />
        <ConditionsFold t={t} />
      </section>

      <section aria-label="地図" className="flex flex-col border-b border-line">
        <SampleMap j={j} t={t} className="h-[42dvh] min-h-60 w-full" />
        <div className="flex flex-col gap-2 p-3">
          <button type="button" aria-expanded={layers} onClick={() => setLayers((v) => !v)} data-testid="sp-layers-open" className="flex min-h-11 w-full items-center gap-2 text-left text-table text-fg field:min-h-14">
            <Icon name="filter" size={18} className="text-fg-mute" />
            <span className="flex-1">層 {JUDGE_LAYERS.length - j.s.off.length}/{JUDGE_LAYERS.length}</span>
            <Icon name="chevron-down" size={16} className={cx("text-fg-mute transition-transform duration-[var(--dur)] motion-reduce:transition-none", layers && "rotate-180")} />
          </button>
          {layers ? (
            <div data-testid="sp-layer-panel">
              <LayerList j={j} t={t} />
            </div>
          ) : null}
        </div>
      </section>

      <section aria-label="結果" className="flex flex-col gap-3 p-3" data-testid="sp-result">
        <div className="flex flex-col gap-1" data-testid="sp-conclusion" data-level={o.level}>
          <h3 className="text-h2 font-semibold text-fg [text-wrap:balance] [word-break:auto-phrase]">{o.line}</h3>
          <p className="text-aux text-fg-mute">{j.place}</p>
        </div>
        {o.procedures.length > 0 ? (
          <ol className="flex flex-col divide-y divide-line border-y border-line">
            {o.procedures.map((p) => (
              <li key={p.label} className="flex min-h-11 items-baseline justify-between gap-3 py-2 text-table">
                <span className="text-fg">{p.label}</span>
                <span className="shrink-0 text-aux text-fg-mute">{p.due}</span>
              </li>
            ))}
          </ol>
        ) : null}
        {LAYER_GROUPS.filter((g) => o.rows.some((r) => r.group === g.id)).map((g) => (
          <details key={g.id} className="group rounded-ctl border border-line" data-testid={`sp-fold-${g.id}`} open={g.id === "aviation" ? true : undefined}>
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 text-table font-medium text-fg field:min-h-14 [&::-webkit-details-marker]:hidden">
              <span className="flex-1">{g.label}</span>
              <span className="text-aux text-fg-mute">{o.rows.filter((r) => r.group === g.id).length} 件</span>
              <Icon name="chevron-down" size={16} className="text-fg-mute transition-transform duration-[var(--dur)] group-open:rotate-180 motion-reduce:transition-none" />
            </summary>
            <ul className="flex flex-col px-3">
              {o.rows
                .filter((r) => r.group === g.id)
                .map((r) => (
                  <RowDisclosure key={r.id} r={r} t={t} />
                ))}
            </ul>
          </details>
        ))}
        <NoticeBar meaning="neutral" data-testid="sp-disclaimer">
          {DISCLAIMER}
        </NoticeBar>
      </section>
      <Live j={j} />
    </div>
  );
}

// ── PC: input on the left, the map in the middle with the layers under it, the result on the right ──

function ThreePane({ j, height }: { readonly j: Judge; readonly height: string }) {
  const t = "pc";
  const aid = useId();
  return (
    <div className="grid grid-cols-[19rem_minmax(0,1fr)_22rem] overflow-hidden border-y border-line-strong bg-surface" style={{ height }} data-testid="pc-frame" data-variant="three">
      <aside aria-label="入力" className="flex min-h-0 flex-col gap-3 overflow-y-auto border-r border-line p-4">
        <h3 className="text-h2 font-semibold text-fg">地点</h3>
        <AddressField j={j} t={t} id={`${aid}-addr`} />
        <GeoButton j={j} t={t} className="w-full" />
        <GeoNotice j={j} t={t} />
        <p className="text-aux text-fg-mute">地図をクリックしても、地点を指定できます。</p>
        <ConditionsFold t={t} />
      </aside>
      <section aria-label="地図と層" className="grid min-h-0 min-w-0 grid-rows-[minmax(0,1fr)_auto]">
        <SampleMap j={j} t={t} className="h-full min-h-0 w-full" />
        <div className="border-t border-line-strong bg-surface px-3 py-2">
          <LayerChips j={j} t={t} />
        </div>
      </section>
      <aside aria-label="結果" className="flex min-h-0 flex-col gap-3 overflow-y-auto border-l border-line p-4">
        <h3 className="text-h2 font-semibold text-fg">結果</h3>
        <ResultBody j={j} t={t} />
      </aside>
      <Live j={j} />
    </div>
  );
}

// ── the page ─────────────────────────────────────────────────────────────────

export function JudgeTrial({ sp, onSp }: { readonly sp: JudgeSp; readonly onSp: (v: JudgeSp) => void }) {
  const desktop = useMediaQuery("(min-width: 1024px)");
  const [accuracy, setAccuracy] = useState<30 | 150>(30);
  const pcJudge = useJudge(accuracy);
  const spJudge = useJudge(accuracy);
  const setAcc = useCallback((v: string) => setAccuracy(v === "150" ? 150 : 30), []);
  // Phone: the frame fills the screen under the strip. PC: the three-pane frame fills the screen, the phone frame is a fixed size.
  const phoneHeight = desktop ? "46rem" : "calc(100dvh - var(--strip-h))";
  const pcHeight = "calc(100dvh - var(--strip-h))";

  const accuracyControl = (
    <Segmented
      label="現在地の精度（見本）"
      value={String(accuracy)}
      onChange={setAcc}
      options={[
        { id: "30", label: "精度 30m" },
        { id: "150", label: "150m" },
      ]}
      data-testid="ctl-acc"
    />
  );
  const strip: ReactNode = (
    <div className="flex min-h-[var(--strip-h)] flex-wrap items-center gap-x-3 gap-y-1 border-b border-line-strong bg-surface px-3 py-1" data-testid="judge-strip">
      <StatusPill meaning="neutral" icon="lock" data-testid="judge-sample-pill">
        見本データ
      </StatusPill>
      <Segmented label="スマホの案" value={sp} onChange={(v) => onSp(v as JudgeSp)} options={JUDGE_SP.map((x) => ({ id: x.id, label: x.label }))} data-testid="ctl-jsp" />
      {desktop ? accuracyControl : null}
    </div>
  );

  const phone =
    sp === "sheet" ? <SheetVariant j={spJudge} height={phoneHeight} /> : sp === "tabs" ? <TabsVariant j={spJudge} height={phoneHeight} /> : <FoldVariant j={spJudge} height={phoneHeight} />;

  return (
    <div data-testid="judge-trial" data-sp={sp} data-device={desktop ? "pc" : "phone"} className="flex flex-col [--strip-h:3.25rem] field:[--strip-h:7rem]">
      {strip}
      {desktop ? (
        <>
          <ThreePane j={pcJudge} height={pcHeight} />
          <section aria-label="スマホの見え方" className="flex flex-col gap-3 border-t border-line-strong bg-app px-6 py-6">
            <h2 className="text-h2 font-semibold text-fg">スマホの見え方（幅 375px の枠。案は上の切り替え）</h2>
            <div className="w-[375px] max-w-full overflow-hidden rounded-ctl border border-line-strong">{phone}</div>
          </section>
        </>
      ) : (
        phone
      )}
      <div className="flex flex-col gap-2 px-3 py-3" data-testid="judge-note">
        {desktop ? null : accuracyControl}
        <p className="text-aux text-fg-mute">確認用の見本です。地図は絵、結果は見本データで、実際の判定ではありません。本番の環境には表示されません。</p>
        <a href="?view=parts" className="text-aux text-accent underline">
          部品と画面へ戻る
        </a>
      </div>
    </div>
  );
}
