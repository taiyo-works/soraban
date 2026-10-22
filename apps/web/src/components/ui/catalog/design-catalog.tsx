"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore } from "react";
import { cx } from "../cx";
import { CommandPalette, ShortcutSheet, usePaletteHotkey, type Command, type ShortcutGroup } from "../command-palette";
import { Toggle } from "../forms";
import { useKeydown } from "../hooks";
import { Icon } from "../icons";
import { ToastProvider } from "../overlays";
import { Button, NoticeBar, PageHeader, StatusPill } from "../primitives";
import { Segmented, TabPanel, Tabs } from "../tabs";
import { IconsSection, PartsSection, TokensSection } from "./sections";
import { DEFAULT_CONFIG, SCREENS, type CatalogConfig, type Density, type Palette, type ScreenId, type Theme } from "./config";
import { FieldScreen, FormScreen, LegendScreen, ListScreen, TodayScreen, WorkspaceScreen } from "./screens";

// Design catalog (Sprint 12g stage 1a). A static page: no auth, no DB, no network. State lives in the page and in the
// query string (so a configuration can be shared as a link and screenshots are reproducible):
//   ?theme=auto|light|dark  &palette=1|2|3  &field=1  &density=standard|compact  &screen=today|list|form|workspace|field|legend
// The page (server) reads the query string and passes it in as `initial`, so there is no effect-driven setup.

const SECTIONS = [
  { id: "tokens", label: "トークン" },
  { id: "icons", label: "アイコン" },
  { id: "parts", label: "部品と状態" },
  { id: "screens", label: "画面の構成" },
] as const;

const SHORTCUTS: readonly ShortcutGroup[] = [
  {
    title: "全体",
    items: [
      { keys: ["Ctrl", "K"], label: "コマンドを開く（Mac は ⌘ K）" },
      { keys: ["?"], label: "ショートカット一覧を開く" },
    ],
  },
  {
    title: "ワークスペース（1024px 以上）",
    items: [
      { keys: ["["], label: "入力のペインを開閉" },
      { keys: ["]"], label: "結果のペインを開閉" },
    ],
  },
];

export function DesignCatalog({ initial = DEFAULT_CONFIG }: { readonly initial?: CatalogConfig }) {
  const [theme, setTheme] = useState<Theme>(initial.theme);
  const [palette, setPalette] = useState<Palette>(initial.palette);
  const [field, setField] = useState(initial.field);
  const [density, setDensity] = useState<Density>(initial.density);
  const [screen, setScreen] = useState<ScreenId>(initial.screen);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  // true once the client has taken over (tests wait for it before interacting)
  const hydrated = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  // Manual theme: html[data-theme]. A layout effect, so that children reading the computed styles see the new theme.
  useLayoutEffect(() => {
    const root = document.documentElement;
    if (theme === "auto") delete root.dataset.theme;
    else root.dataset.theme = theme;
    return () => {
      delete root.dataset.theme;
    };
  }, [theme]);

  // Keep the URL in step with the configuration (replaceState: no history entries).
  useEffect(() => {
    const q = new URLSearchParams();
    if (theme !== "auto") q.set("theme", theme);
    if (palette !== "1") q.set("palette", palette);
    if (field) q.set("field", "1");
    if (density !== "standard") q.set("density", density);
    if (screen !== "today") q.set("screen", screen);
    const s = q.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${s ? `?${s}` : ""}${window.location.hash}`);
  }, [theme, palette, field, density, screen]);

  const togglePalette = useCallback(() => setPaletteOpen((v) => !v), []);
  usePaletteHotkey(togglePalette, !field);
  useKeydown(
    useCallback((e: KeyboardEvent) => {
      if (e.key === "?" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setHelpOpen(true);
      }
    }, []),
    { enabled: !field, ignoreEditable: true, ignoreModal: true },
  );

  const commands = useMemo<Command[]>(
    () => [
      ...SECTIONS.map((s) => ({
        id: `go-${s.id}`,
        label: `${s.label}へ移動`,
        group: "移動",
        icon: "chevron-right" as const,
        onSelect: () => document.getElementById(s.id)?.scrollIntoView({ behavior: "smooth", block: "start" }),
      })),
      ...(["auto", "light", "dark"] as Theme[]).map((t) => ({
        id: `theme-${t}`,
        label: `テーマ：${{ auto: "自動", light: "明", dark: "暗" }[t]}`,
        group: "表示",
        icon: (t === "auto" ? "monitor" : t === "light" ? "sun" : "moon") as "monitor" | "sun" | "moon",
        keywords: "theme",
        onSelect: () => setTheme(t),
      })),
      { id: "field", label: field ? "現場モードをやめる" : "現場モードにする", group: "表示", icon: "flight" as const, onSelect: () => setField((v) => !v) },
      { id: "help", label: "ショートカット一覧", group: "ヘルプ", icon: "keyboard" as const, keys: ["?"], onSelect: () => setHelpOpen(true) },
    ],
    [field],
  );

  const context = `${theme}-${palette}-${field ? "field" : "normal"}`;

  return (
    <ToastProvider>
      <div
        className={cx("ds ds-page min-h-dvh", field && "field")}
        data-palette={palette}
        data-density={density}
        data-testid="design-catalog"
        data-hydrated={hydrated ? "1" : "0"}
        data-catalog-theme={theme}
        data-catalog-field={field ? "1" : "0"}
      >
        <div className="glass sticky top-0 z-30 border-b border-line max-md:static">
          <div className="mx-auto flex max-w-[80rem] flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2 sm:px-6 lg:px-8">
            <Segmented
              label="テーマ"
              value={theme}
              onChange={(v) => setTheme(v as Theme)}
              options={[
                { id: "auto", label: "自動", icon: "monitor" },
                { id: "light", label: "明", icon: "sun" },
                { id: "dark", label: "暗", icon: "moon" },
              ]}
              data-testid="ctl-theme"
            />
            <Segmented
              label="配色案"
              value={palette}
              onChange={(v) => setPalette(v as Palette)}
              options={[
                { id: "1", label: "案 1 ブルー" },
                { id: "2", label: "案 2 藍" },
                { id: "3", label: "案 3 チャコール" },
              ]}
              data-testid="ctl-palette"
            />
            <Segmented
              label="密度"
              value={density}
              onChange={(v) => setDensity(v as Density)}
              options={[
                { id: "standard", label: "標準" },
                { id: "compact", label: "コンパクト" },
              ]}
              data-testid="ctl-density"
            />
            <span className="inline-flex items-center gap-2 text-table text-fg">
              現場モード
              <Toggle label="現場モード" checked={field} onChange={setField} data-testid="ctl-field" />
            </span>
            <Button variant="secondary" size="sm" icon="command" onClick={togglePalette} data-testid="ctl-command" className="ml-auto">
              コマンド
            </Button>
          </div>
        </div>

        <div className="mx-auto flex max-w-[80rem] flex-col gap-10 px-4 py-6 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-4">
            <PageHeader
              title="デザイン見本"
              meta="Sprint 12g 段階 1a"
              actions={
                <StatusPill meaning="neutral" icon="lock">
                  開発・プレビュー専用
                </StatusPill>
              }
            />
            <NoticeBar meaning="neutral" icon="info" data-testid="catalog-notice">
              確認用の画面です。名称・数値・日付はすべて見本データで、実際の記録ではありません。本番の環境には表示されません。
            </NoticeBar>
            <nav aria-label="見本の目次" className="flex flex-wrap gap-2">
              {SECTIONS.map((s) => (
                <a key={s.id} href={`#${s.id}`} className="inline-flex min-h-11 items-center gap-1.5 rounded-pill bg-sunken px-4 text-table text-fg-soft hov:bg-accent-soft hov:text-accent">
                  {s.label}
                  <Icon name="chevron-down" size={14} />
                </a>
              ))}
            </nav>
          </div>

          <Block id="tokens" title="トークン（色・文字・コントラスト）">
            <TokensSection context={context} />
          </Block>
          <Block id="icons" title="アイコンとアプリのアイコン案">
            <IconsSection />
          </Block>
          <Block id="parts" title="部品と状態">
            <PartsSection density={density} />
          </Block>
          <Block id="screens" title="画面の構成（6 種）">
            <div className="flex flex-col gap-4">
              <Tabs
                idPrefix="screen"
                label="画面の見本"
                value={screen}
                onChange={(v) => setScreen(v as ScreenId)}
                tabs={SCREENS.map((s) => ({ id: s.id, label: s.label, icon: s.icon }))}
                data-testid="ctl-screen"
              />
              <TabPanel idPrefix="screen" id="today" active={screen === "today"}>
                {screen === "today" ? <TodayScreen /> : null}
              </TabPanel>
              <TabPanel idPrefix="screen" id="list" active={screen === "list"}>
                {screen === "list" ? <ListScreen density={density} /> : null}
              </TabPanel>
              <TabPanel idPrefix="screen" id="form" active={screen === "form"}>
                {screen === "form" ? <FormScreen /> : null}
              </TabPanel>
              <TabPanel idPrefix="screen" id="workspace" active={screen === "workspace"}>
                {screen === "workspace" ? <WorkspaceScreen /> : null}
              </TabPanel>
              <TabPanel idPrefix="screen" id="field" active={screen === "field"}>
                {screen === "field" ? <FieldScreen /> : null}
              </TabPanel>
              <TabPanel idPrefix="screen" id="legend" active={screen === "legend"}>
                {screen === "legend" ? <LegendScreen /> : null}
              </TabPanel>
            </div>
          </Block>
        </div>

        <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} commands={commands} />
        <ShortcutSheet open={helpOpen} onClose={() => setHelpOpen(false)} groups={SHORTCUTS} />
      </div>
    </ToastProvider>
  );
}

function Block({ id, title, children }: { readonly id: string; readonly title: string; readonly children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="flex scroll-mt-16 flex-col gap-5">
      <h2 id={`${id}-h`} className="text-h2 font-semibold text-fg">
        {title}
      </h2>
      {children}
    </section>
  );
}
