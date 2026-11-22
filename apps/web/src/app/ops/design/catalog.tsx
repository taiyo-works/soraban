import { VERDICT_LABEL } from "@soraban/regulations";
import type { ItemVerdict } from "@soraban/regulations";
import "./catalog.css";
import { HeroIllustration } from "@/components/hero-illustration";
import { PillButton, SectionHead, VerdictBig, VerdictTag } from "@/components/ui/sb-parts";
import { CatalogAttrs } from "./catalog-attrs";

// デザイン見本 v2（Sprint 16-1。G-1 でユーザーが配色を決める）。認証・DB・外部通信なし。静的な部品の並べだけで、操作の状態は持たない。
// 設定は URL: ?mode=field（現場の値）／?theme=dark（休眠している暗の確認用）／?veil=1（日差しの模擬：白い膜 rgba(255,255,255,.35)）。

export type CatalogConfig = { readonly mode: "field" | null; readonly theme: "dark" | null; readonly veil: boolean };

export const parseCatalogConfig = (q: Readonly<Record<string, string | string[] | undefined>>): CatalogConfig => {
  const one = (k: string): string | undefined => (Array.isArray(q[k]) ? q[k][0] : (q[k] as string | undefined));
  return { mode: one("mode") === "field" ? "field" : null, theme: one("theme") === "dark" ? "dark" : null, veil: one("veil") === "1" };
};

const href = (c: CatalogConfig, over: Partial<Record<"mode" | "theme" | "veil", string | null>>): string => {
  const p = new URLSearchParams();
  const m = "mode" in over ? over.mode : c.mode;
  const t = "theme" in over ? over.theme : c.theme;
  const v = "veil" in over ? over.veil : c.veil ? "1" : null;
  if (m) p.set("mode", m);
  if (t) p.set("theme", t);
  if (v) p.set("veil", v);
  const s = p.toString();
  return s ? `/ops/design?${s}` : "/ops/design";
};

const LEVELS: readonly ItemVerdict[] = ["no_fly", "needs_procedure", "procedure_done", "no_procedure", "unknown"];
const GROUNDS = [
  ["base", "ページの地（白）", "--sb-base"],
  ["surface", "面（ごく薄いグレー）", "--sb-surface"],
  ["sunken", "くぼみ（入力欄・表の見出し・注記）", "--sb-sunken"],
] as const;

function Band({ online, stale }: { readonly online: boolean; readonly stale: boolean }) {
  return (
    <section aria-label="接続と送信の状況（見本）" className="sbx-band" data-testid="cat-band" data-online={online ? "true" : "false"}>
      <span className="font-bold">{online ? "● 接続あり" : "× 接続なし（圏外）"}</span>
      <span className="font-bold">送信待ち {online ? 0 : 2} 件</span>
      <span>最後に保存 11/02 09:41</span>
      <span>
        先読みの最終更新 11/02 07:10
        {stale ? <strong className="ml-1">（古い可能性）</strong> : null}
      </span>
    </section>
  );
}

export function DesignCatalogV2({ config }: { readonly config: CatalogConfig }) {
  return (
    <div className="sbx-catalog" data-testid="design-catalog" data-mode={config.mode ?? "normal"} data-theme-forced={config.theme ?? "light"}>
      <CatalogAttrs mode={config.mode} theme={config.theme} />
      {config.veil ? <div className="sbx-veil" data-testid="cat-veil" aria-hidden="true" /> : null}
      <header className="flex flex-col gap-2">
        <h1>デザイン見本（静かな管制室）</h1>
        <p className="sbx-note">地は薄いグレー、面は白、くぼみは一段濃いグレー。影は使わず罫で分ける。主色は空色の 1 色で、操作と現在地だけに使う。判定色は状態色から引き、形・言葉は変えない。</p>
        {config.mode ? (
          <p className="sbx-note" data-testid="cat-field-note">
            現場の見本：色・罫・押す部品の大きさ・文字の大きさ（本文 18px、状態の語 20px）を現場の基準に合わせて並べています。挿絵や帯など一部の部品は通常と同じ寸法のままなので、現場の最終の見え方は実画面で確かめてください。
          </p>
        ) : null}
        <nav aria-label="見本の設定" className="sbx-nav" data-testid="cat-nav">
          <a className="sb-pill sb-pill-sm sb-pill-secondary" href={href(config, { mode: null })} aria-current={config.mode ? undefined : "true"} data-testid="cat-normal">
            <span className="sb-pill-label">通常</span>
          </a>
          <a className="sb-pill sb-pill-sm sb-pill-secondary" href={href(config, { mode: "field" })} aria-current={config.mode ? "true" : undefined} data-testid="cat-field">
            <span className="sb-pill-label">現場</span>
          </a>
          <a className="sb-pill sb-pill-sm sb-pill-secondary" href={href(config, { veil: config.veil ? null : "1" })} aria-current={config.veil ? "true" : undefined} data-testid="cat-veil-toggle">
            <span className="sb-pill-label">日差しの模擬（白い膜）{config.veil ? "：入" : "：切"}</span>
          </a>
        </nav>
      </header>

      <section className="sbx-section" aria-labelledby="cat-grounds" data-testid="cat-grounds">
        <h2 id="cat-grounds">地の三段と文字</h2>
        <div className="sbx-grid">
          {GROUNDS.map(([key, label, token]) => (
            <div key={key} className="sbx-ground" data-ground={key}>
              <strong>{label}</strong>
              <span className="sbx-note">{token}</span>
              <p>本文（墨）。ひらがなと漢字の混ざった文を、この地の上で読む。</p>
              <p style={{ color: "var(--sb-ink-2)" }}>第二の文字。補助の説明に使う。</p>
              <p style={{ color: "var(--sb-ink-3)" }}>注釈の文字。小さな補足に使う。</p>
            </div>
          ))}
        </div>
      </section>

      <section className="sbx-section" aria-labelledby="cat-buttons" data-testid="cat-buttons">
        <h2 id="cat-buttons">ボタン（主色の面＋白の文字）</h2>
        <div className="sbx-row">
          <PillButton variant="primary" data-testid="cat-primary">主ボタン（保存する）</PillButton>
          <PillButton data-testid="cat-secondary">副ボタン</PillButton>
          <PillButton disabled data-testid="cat-disabled">押せない</PillButton>
        </div>
        <div className="sbx-row">
          <button type="button" className="opx-btn opx-btn-primary" data-testid="cat-opx-primary">運航管理の主ボタン</button>
          <button type="button" className="opx-btn" data-testid="cat-opx-secondary">副ボタン</button>
          <button type="button" className="opx-btn opx-btn-danger" data-testid="cat-opx-danger">取り消す</button>
        </div>
        <p className="sbx-note">主色の面と地の比は 5:1 以上（現場は 7:1 以上）。面だけで境界を満たす。</p>
      </section>

      <section className="sbx-section" aria-labelledby="cat-forms" data-testid="cat-forms">
        <h2 id="cat-forms">面と罫・入力欄・選択中の面</h2>
        <div className="sbx-grid">
          <div className="sb-block" data-testid="cat-block">
            <strong>ブロック（罫で分ける）</strong>
            <p className="sbx-note">影なし。罫は 1px（現場 1.5px）。</p>
          </div>
          <div className="sb-block-soft" data-testid="cat-block-soft">
            <strong>ごく薄いグレーの面</strong>
            <p className="sbx-note">注記・補足に使う。</p>
          </div>
          <label className="flex flex-col gap-1">
            <span>入力欄（縁は 3:1 以上）</span>
            <input className="sbx-input" placeholder="例：機体の名前" data-testid="cat-input" />
          </label>
          <div className="sb-check-row is-on" data-testid="cat-selected" style={{ padding: "12px" }}>
            <span>選択中の面（薄い主色の面＋縁）</span>
          </div>
        </div>
      </section>

      <section className="sbx-section" aria-labelledby="cat-verdict" data-testid="cat-verdict">
        <h2 id="cat-verdict">判定の五段（値・形・言葉は変えない）</h2>
        <div className="sbx-row">
          {LEVELS.map((l) => (
            <VerdictTag key={l} level={l} testId={`cat-verdict-${l}`}>
              {VERDICT_LABEL[l]}
            </VerdictTag>
          ))}
        </div>
        <div className="sbx-row">
          {LEVELS.map((l) => (
            <VerdictBig key={l} level={l} />
          ))}
        </div>
      </section>

      <section className="sbx-section" aria-labelledby="cat-primary-use" data-testid="cat-orange">
        <h2 id="cat-primary-use">主色の使いどころ（操作と現在地だけ）</h2>
        <SectionHead id="cat-primary-head" as="h3" title="見出し（左に主色の太い線だけ）" note="背後の大きな数字はやめた" />
        <p>
          <span className="sbx-dot" aria-hidden="true" /> 現在地の印（小さな主色の丸）。
        </p>
      </section>

      <section className="sbx-section" aria-labelledby="cat-band" data-testid="cat-band-section">
        <h2 id="cat-band">状態の帯（現場）</h2>
        <Band online stale={false} />
        <Band online stale />
        <Band online={false} stale={false} />
      </section>

      <section className="sbx-section" aria-labelledby="cat-art" data-testid="cat-art-section">
        <h2 id="cat-art">`/` の挿絵（線画。色は墨と白だけ）</h2>
        <div className="sb-hero" style={{ borderRadius: "var(--sb-r-l)" }}>
          <HeroIllustration />
        </div>
      </section>
    </div>
  );
}
