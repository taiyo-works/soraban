// Catalog configuration (Sprint 12g stage 1a). Plain module (no "use client") so the server page can parse the query string.
import type { IconName } from "../icons";

export type Theme = "auto" | "light" | "dark";
export type Density = "standard" | "compact";
export const SCREENS = [
  { id: "today", label: "今日", icon: "today" as IconName },
  { id: "list", label: "一覧", icon: "list" },
  { id: "form", label: "フォーム", icon: "plan" },
  { id: "workspace", label: "ワークスペース", icon: "map" },
  { id: "field", label: "現場モード", icon: "flight" },
  { id: "legend", label: "凡例", icon: "info" },
] as const;
export type ScreenId = (typeof SCREENS)[number]["id"];

// UX stage 2: the menu and home trial. `view=menu` shows it instead of the parts and screens (the default view is unchanged).
export type View = "parts" | "menu";
export type PcMenu = "rail" | "tabs";
export type SpMenu = "tabs5" | "tabs4band";
export type DayKind = "busy" | "empty";
export type PcName = "judge" | "map";
export type JudgeForm = "workspace" | "stack";

export type CatalogConfig = {
  readonly theme: Theme;
  readonly field: boolean;
  readonly density: Density;
  readonly screen: ScreenId;
  readonly view: View;
  /** PC menu: a left menu in the order of the work, or tabs along the top. */
  readonly pc: PcMenu;
  /** Phone menu: five bottom tabs, or four bottom tabs with a band for the next flight. */
  readonly sp: SpMenu;
  /** A day with a flight, or a day without one. */
  readonly day: DayKind;
  /** The PC name of the judgement page: "判定" or "地図・判定". */
  readonly pcname: PcName;
  /** The PC judgement page: map first (workspace) or the current stack (form, map, result). */
  readonly judge: JudgeForm;
};

export const DEFAULT_CONFIG: CatalogConfig = {
  theme: "auto",
  field: false,
  density: "standard",
  screen: "today",
  view: "parts",
  pc: "rail",
  sp: "tabs5",
  day: "busy",
  pcname: "judge",
  judge: "workspace",
};

/** Read the configuration from the query string (unknown values fall back to the defaults). */
export function parseConfig(q: Readonly<Record<string, string | string[] | undefined>>): CatalogConfig {
  const one = (k: string): string | undefined => (Array.isArray(q[k]) ? q[k]![0] : (q[k] as string | undefined));
  const theme = one("theme");
  const density = one("density");
  const screen = one("screen");
  const view = one("view");
  const pc = one("pc");
  const sp = one("sp");
  const day = one("day");
  const pcname = one("pcname");
  const judge = one("judge");
  return {
    theme: theme === "auto" || theme === "light" || theme === "dark" ? theme : DEFAULT_CONFIG.theme,
    field: one("field") === "1",
    density: density === "standard" || density === "compact" ? density : DEFAULT_CONFIG.density,
    screen: SCREENS.some((x) => x.id === screen) ? (screen as ScreenId) : DEFAULT_CONFIG.screen,
    view: view === "menu" ? "menu" : DEFAULT_CONFIG.view,
    pc: pc === "rail" || pc === "tabs" ? pc : DEFAULT_CONFIG.pc,
    sp: sp === "tabs5" || sp === "tabs4band" ? sp : DEFAULT_CONFIG.sp,
    day: day === "busy" || day === "empty" ? day : DEFAULT_CONFIG.day,
    pcname: pcname === "judge" || pcname === "map" ? pcname : DEFAULT_CONFIG.pcname,
    judge: judge === "workspace" || judge === "stack" ? judge : DEFAULT_CONFIG.judge,
  };
}

