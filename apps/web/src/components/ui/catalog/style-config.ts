// Style trial configuration (`/ops/design?view=style`). Plain module so the server page can read the query string.
// ?palette=1..6  &theme=light|dark  &field=1  &layout=all (six palettes side by side)  &screen=judge|home|parts|verdict|menu (for layout=all)

export type PaletteId = 1 | 2 | 3 | 4 | 5 | 6;
export type StyleTheme = "light" | "dark";
export type StyleScreen = "judge" | "home" | "parts" | "verdict" | "menu";
export type StyleLayout = "one" | "all";

export const STYLE_SCREENS: readonly { readonly id: StyleScreen; readonly label: string }[] = [
  { id: "judge", label: "判定" },
  { id: "home", label: "ホーム" },
  { id: "parts", label: "ボタンと入力欄" },
  { id: "verdict", label: "判定の印" },
  { id: "menu", label: "メニュー" },
];

export type StyleConfig = {
  readonly palette: PaletteId;
  readonly theme: StyleTheme;
  readonly field: boolean;
  readonly layout: StyleLayout;
  readonly screen: StyleScreen;
};

export const DEFAULT_STYLE_CONFIG: StyleConfig = { palette: 1, theme: "light", field: false, layout: "one", screen: "judge" };

type Query = Readonly<Record<string, string | string[] | undefined>>;
const one = (q: Query, k: string): string | undefined => {
  const v = q[k];
  return Array.isArray(v) ? v[0] : v;
};

export const isStyleView = (q: Query): boolean => one(q, "view") === "style";

export function parseStyleConfig(q: Query): StyleConfig {
  const p = Number(one(q, "palette"));
  const screen = one(q, "screen");
  return {
    palette: p === 1 || p === 2 || p === 3 || p === 4 || p === 5 || p === 6 ? p : DEFAULT_STYLE_CONFIG.palette,
    theme: one(q, "theme") === "dark" ? "dark" : "light",
    field: one(q, "field") === "1",
    layout: one(q, "layout") === "all" ? "all" : "one",
    screen: STYLE_SCREENS.some((s) => s.id === screen) ? (screen as StyleScreen) : DEFAULT_STYLE_CONFIG.screen,
  };
}

/** A link to the same view with some values changed. Defaults are left out of the query. */
export function styleHref(c: StyleConfig, change: Partial<StyleConfig>): string {
  const n = { ...c, ...change };
  const q = new URLSearchParams({ view: "style" });
  if (n.palette !== DEFAULT_STYLE_CONFIG.palette) q.set("palette", String(n.palette));
  if (n.theme !== "light") q.set("theme", n.theme);
  if (n.field) q.set("field", "1");
  if (n.layout === "all") {
    q.set("layout", "all");
    if (n.screen !== DEFAULT_STYLE_CONFIG.screen) q.set("screen", n.screen);
  }
  return `/ops/design?${q.toString()}`;
}
