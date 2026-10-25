// Style trial (`/ops/design?view=style`): five palettes for the same screens, square corners, a very soft relief only on the
// surfaces near the ground, and contour-line art. A server component with no state: every switch is a link, so a view can be
// shared and photographed. Nothing here is used by the real screens (`/` and `/ops`).
import "./style-trial.css";
import { ContourBand, ContourRule, HERO_SPEC } from "./style-art";
import { PALETTES, ALL_KEYS, paletteCss, resolveSet, type Mode, type SetKey } from "./style-palettes";
import { STYLE_SCREENS, styleHref, type PaletteId, type StyleConfig, type StyleScreen } from "./style-config";
import { HomeScreen, JudgeScreen, MenuPanel, PartsPanel, VerdictPanel } from "./style-screens";

const STYLE_CSS = paletteCss();
const setKey = (id: PaletteId, c: Pick<StyleConfig, "theme" | "field">): SetKey => `${id}-${c.theme}${c.field ? "-field" : ""}` as SetKey;

function PageGround({ c }: { readonly c: StyleConfig }) {
  // the page ground also covers the margins of the window (the body of the real screens has a paper grid)
  const g = resolveSet(c.palette, c.theme, c.field).base.app;
  return <style>{`${STYLE_CSS}\nhtml:has(.sty-page),html:has(.sty-page) body{background:${g};background-image:none}`}</style>;
}

function Controls({ c }: { readonly c: StyleConfig }) {
  return (
    <nav className="sty-controls" aria-label="見本の切り替え">
      <div className="sty-ctl-group">
        <span className="sty-note" id="ctl-pal">パレット</span>
        <ul className="sty-pal-list" aria-labelledby="ctl-pal">
          {PALETTES.map((p) => {
            const r = resolveSet(p.id, c.theme, c.field);
            return (
              <li key={p.id}>
                <a href={styleHref(c, { palette: p.id })} className="sty-pal-link" aria-current={c.palette === p.id && c.layout === "one" ? "true" : undefined}>
                  <span className="sty-swatch" style={{ background: r.base.accentFill }} aria-hidden="true" />
                  <span className="sty-num">{p.id}</span>
                  {p.name}
                </a>
              </li>
            );
          })}
        </ul>
      </div>
      <div className="sty-ctl-group">
        <span className="sty-note" id="ctl-theme">明暗</span>
        <ul className="sty-seg-links" aria-labelledby="ctl-theme">
          <li><a href={styleHref(c, { theme: "light" })} aria-current={c.theme === "light" ? "true" : undefined}>明</a></li>
          <li><a href={styleHref(c, { theme: "dark" })} aria-current={c.theme === "dark" ? "true" : undefined}>暗</a></li>
        </ul>
      </div>
      <div className="sty-ctl-group">
        <span className="sty-note" id="ctl-field">現場</span>
        <ul className="sty-seg-links" aria-labelledby="ctl-field">
          <li><a href={styleHref(c, { field: false })} aria-current={!c.field ? "true" : undefined}>通常</a></li>
          <li><a href={styleHref(c, { field: true })} aria-current={c.field ? "true" : undefined}>現場モード</a></li>
        </ul>
      </div>
      <div className="sty-ctl-group">
        <span className="sty-note" id="ctl-layout">並べ方</span>
        <ul className="sty-seg-links" aria-labelledby="ctl-layout">
          <li><a href={styleHref(c, { layout: "one" })} aria-current={c.layout === "one" ? "true" : undefined}>1 つを大きく</a></li>
          <li><a href={styleHref(c, { layout: "all" })} aria-current={c.layout === "all" ? "true" : undefined}>6 つ並べる</a></li>
        </ul>
      </div>
    </nav>
  );
}

function PaletteCard({ id, c }: { readonly id: PaletteId; readonly c: Pick<StyleConfig, "theme" | "field"> }) {
  const p = PALETTES.find((x) => x.id === id)!;
  const r = resolveSet(id, c.theme, c.field);
  const chips: readonly [string, string][] = [
    ["地", r.base.app],
    ["面", r.base.panel],
    ["くぼみ", r.base.sunk],
    ["文字", r.base.fg],
    ["アクセント", r.base.accentFill],
    ["不可", r.verdict.noFly.fg],
    ["要手続き", r.verdict.needs.fg],
    ["済み", r.verdict.done.fg],
    ["不要", r.verdict.clear.fg],
  ];
  return (
    <section className="sty-card sty-palcard" aria-label={`パレット ${id} ${p.name}`}>
      <p className="sty-note sty-num">パレット {id}</p>
      <h3 className="sty-h">{p.name}</h3>
      <p className="sty-body">{p.aim}</p>
      <ul className="sty-chips-list">
        {chips.map(([n, hex]) => (
          <li key={n}>
            <span className="sty-swatch sty-swatch-lg" style={{ background: hex }} aria-hidden="true" />
            <span className="sty-note">{n}</span>
            <span className="sty-note sty-num">{hex}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Heading({ id, title, seed, figure, note }: { readonly id: string; readonly title: string; readonly seed: number; readonly figure: string; readonly note?: string }) {
  return (
    <div className="sty-head">
      <h2 className="sty-h" id={id}>{title}</h2>
      {note ? <p className="sty-note">{note}</p> : null}
      <ContourRule seed={seed} figure={figure} />
    </div>
  );
}

function ScreenOf({ screen, u }: { readonly screen: StyleScreen; readonly u: string }) {
  switch (screen) {
    case "judge":
      return <JudgeScreen uid={u} />;
    case "home":
      return <HomeScreen />;
    case "parts":
      return <div className="sty-phone sty-sheetlike"><PartsPanel u={u} /></div>;
    case "verdict":
      return <div className="sty-phone sty-sheetlike"><VerdictPanel /></div>;
    case "menu":
      return <div className="sty-phone sty-sheetlike"><MenuPanel /></div>;
  }
}

function Compare({ c }: { readonly c: StyleConfig }) {
  return (
    <section aria-labelledby="cmp-h" className="sty-compare">
      <Heading id="cmp-h" title="同じ画面を 6 つのパレットで見比べる" seed={31} figure="212" note="画面を選ぶと 6 つとも同じ画面に変わります。縮小しているので、細部は「1 つを大きく」で見ます。" />
      <ul className="sty-screen-pick" aria-label="見比べる画面">
        {STYLE_SCREENS.map((s) => (
          <li key={s.id}>
            <a href={styleHref(c, { layout: "all", screen: s.id })} aria-current={c.screen === s.id ? "true" : undefined}>{s.label}</a>
          </li>
        ))}
      </ul>
      <ul className="sty-compare-grid">
        {PALETTES.map((p) => (
          <li key={p.id} className="sty-compare-cell">
            <a className="sty-compare-title" href={styleHref(c, { layout: "one", palette: p.id })}>
              <span className="sty-num">{p.id}</span> {p.name}
            </a>
            <div className="sty sty-scale" data-set={setKey(p.id, c)} data-mode={c.theme} data-field={c.field ? "1" : "0"}>
              <ScreenOf screen={c.screen} u={`c${p.id}`} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function One({ c }: { readonly c: StyleConfig }) {
  return (
    <>
      <div className="sty-two">
        <section aria-labelledby="sec-judge" className="sty-col">
          <Heading id="sec-judge" title="判定（スマホ 375px）" seed={41} figure="218" note="地図が主役。結果は下の面に出る。" />
          <JudgeScreen uid="one" />
        </section>
        <section aria-labelledby="sec-home" className="sty-col">
          <Heading id="sec-home" title="ホーム（予定のある日）" seed={52} figure="164" note="次の飛行が 1 行、ほかは台帳の行。" />
          <HomeScreen />
        </section>
        <aside className="sty-col sty-side" aria-label="このパレットの色">
          <PaletteCard id={c.palette} c={c} />
          <section className="sty-card sty-note-card" aria-label="この見本のきまり">
            <h3 className="sty-h">きまり</h3>
            <ul className="sty-rules">
              <li>角は直角。丸いのは、位置の点と件数だけ。</li>
              <li>やわらかい凹凸は、面と入力欄の地だけ。文字・枠線・ボタンは、くっきり。</li>
              <li>アクセントは 1 色。判定の赤・橙・緑と色相を離した。</li>
              <li>「手続き済み」は無彩色。形と言葉で見分ける。</li>
              <li>文字は 3 段（見出し・本文・注釈）。数字は等幅。</li>
              <li>1 画面で強いのは 1 か所。</li>
            </ul>
          </section>
        </aside>
      </div>
      <section aria-labelledby="sec-parts" className="sty-block">
        <Heading id="sec-parts" title="ボタンと入力欄と状態" seed={63} figure="97" note="通常・ホバー・フォーカス・押下・無効・エラー。見本なので、状態を固定して並べている。" />
        <PartsPanel u="one" />
      </section>
      <section aria-labelledby="sec-verdict" className="sty-block">
        <Heading id="sec-verdict" title="判定の 4 段の印" seed={74} figure="305" note="色・形・言葉の 3 つで伝える。" />
        <VerdictPanel />
      </section>
      <section aria-labelledby="sec-menu" className="sty-block">
        <Heading id="sec-menu" title="メニュー（下のタブ）" seed={85} figure="140" />
        <MenuPanel />
      </section>
    </>
  );
}

export function StyleTrial({ config: c }: { readonly config: StyleConfig }) {
  const key = setKey(c.palette, c);
  const known = ALL_KEYS.includes(key);
  const mode: Mode = c.theme;
  return (
    <div className="sty sty-page" data-set={known ? key : "1-light"} data-mode={mode} data-field={c.field ? "1" : "0"} data-testid="style-trial">
      <PageGround c={c} />
      <a className="sty-skip" href="#sty-main">本文へ</a>
      <header className="sty-hero">
        <ContourBand id="hero" spec={HERO_SPEC} className="sty-hero-art" />
        <div className="sty-hero-text">
          <p className="sty-note">そらばん ・ 開発・プレビュー専用</p>
          <h1 className="sty-title">スタイル見本</h1>
          <p className="sty-body">直角、ごく弱い凹凸、等高線。パレット 6 案を、同じ画面で見比べる。</p>
          <p className="sty-note" data-testid="style-notice">名称・数値・日付はすべて見本データで、実際の記録ではありません。実際の画面（/ と /ops 以下）は変えていません。</p>
        </div>
      </header>
      <Controls c={c} />
      <main id="sty-main" className="sty-main">
        {c.layout === "all" ? <Compare c={c} /> : <One c={c} />}
      </main>
    </div>
  );
}
