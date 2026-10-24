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

export type CatalogConfig = {
  readonly theme: Theme;
  readonly field: boolean;
  readonly density: Density;
  readonly screen: ScreenId;
};

export const DEFAULT_CONFIG: CatalogConfig = { theme: "auto", field: false, density: "standard", screen: "today" };

/** Read the configuration from the query string (unknown values fall back to the defaults). */
export function parseConfig(q: Readonly<Record<string, string | string[] | undefined>>): CatalogConfig {
  const one = (k: string): string | undefined => (Array.isArray(q[k]) ? q[k]![0] : (q[k] as string | undefined));
  const theme = one("theme");
  const density = one("density");
  const screen = one("screen");
  return {
    theme: theme === "auto" || theme === "light" || theme === "dark" ? theme : DEFAULT_CONFIG.theme,
    field: one("field") === "1",
    density: density === "standard" || density === "compact" ? density : DEFAULT_CONFIG.density,
    screen: SCREENS.some((x) => x.id === screen) ? (screen as ScreenId) : DEFAULT_CONFIG.screen,
  };
}

